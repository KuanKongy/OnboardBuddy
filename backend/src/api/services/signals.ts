/**
 * Hashed device/browser/network signals for the free-tier multi-account
 * detector (services/creditGate.ts). This module only RECORDS and hashes; the
 * decision lives in the credit gate.
 *
 * Three kinds, and only one of them can ever change an outcome:
 *   - 'device': the random UUID the client stores in localStorage
 *     (frontend/src/lib/deviceId.ts). The ONLY enforcement key.
 *   - 'fp': a hash over passive browser properties (user agent, screen, time
 *     zone, ...). Evidence only.
 *   - 'ip': the request address. Evidence only.
 * A campus lab or an office is one IP and a row of near-identical laptops, so
 * those two signals match honest strangers constantly. They exist so a human
 * reading the table can tell a farm from a classroom; nothing reads them.
 *
 * Values are salted-SHA-256 before they are stored: the rows are then useless
 * to anyone who gets a copy of the table, and the backend never needs the
 * plaintext back (every query is an equality match on a hash).
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { query as defaultQuery } from '../../lib/db.js';
import { sendEmail, type SendEmailFn } from '../../lib/mailer.js';
import type { QueryFn } from './creditGate.js';

/** Raw, untrusted values straight off the request. */
export interface ClientSignals {
  deviceId: string | null;
  fp: string | null;
  ip: string | null;
}

/** The same values, hashed, as stored and queried. */
export interface HashedSignals {
  deviceHash: string | null;
  fpHash: string | null;
  ipHash: string | null;
}

export const DEVICE_ID_HEADER = 'x-device-id';
export const DEVICE_FP_HEADER = 'x-device-fp';

/**
 * The salt exists to make the stored hashes non-reversible, not to authenticate
 * anything, so deriving it from a key that already has to exist beats adding a
 * required variable to every deployment. Explicit SIGNAL_HASH_SALT wins;
 * otherwise it is derived from TOKEN_ENCRYPTION_KEY under a static context
 * string so the two never produce the same digest for the same input.
 *
 * Rotating either value orphans the existing rows (old hashes stop matching new
 * ones), which costs the detector its history until devices are seen again. It
 * never breaks a request.
 */
const SALT_CONTEXT = 'onboardbuddy.user_signals.v1';
let warnedMissingSalt = false;

function signalSalt(env: NodeJS.ProcessEnv): string {
  const explicit = env.SIGNAL_HASH_SALT?.trim();
  if (explicit) return explicit;
  const derived = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (derived) return createHash('sha256').update(`${SALT_CONTEXT}:${derived}`).digest('hex');
  if (!warnedMissingSalt && env.NODE_ENV !== 'test') {
    warnedMissingSalt = true;
    console.warn('[signals] neither SIGNAL_HASH_SALT nor TOKEN_ENCRYPTION_KEY is set - signal hashes are unsalted');
  }
  return SALT_CONTEXT;
}

export function hashSignal(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHash('sha256').update(`${signalSalt(env)}:${value}`).digest('hex');
}

/**
 * Header shapes are validated before anything is stored, so a hostile or broken
 * client cannot fill the table with junk of its choosing: the device id is what
 * crypto.randomUUID() produces (plus a little slack for a future format) and the
 * fingerprint is a hex digest. Anything else is dropped, not rejected - a
 * missing signal is handled one layer up, where the tier is known.
 */
function validDeviceId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9._:-]{8,64}$/.test(raw) ? raw : null;
}

function validFp(raw: unknown): string | null {
  return typeof raw === 'string' && /^[0-9a-f]{16,64}$/.test(raw) ? raw : null;
}

export function extractClientSignals(req: Request): ClientSignals {
  const headers = req.headers as Record<string, unknown>;
  return {
    deviceId: validDeviceId(headers[DEVICE_ID_HEADER]),
    fp: validFp(headers[DEVICE_FP_HEADER]),
    // req.ip honors x-forwarded-for only because app.ts sets 'trust proxy'.
    ip: typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null,
  };
}

export function hashClientSignals(raw: ClientSignals, env: NodeJS.ProcessEnv = process.env): HashedSignals {
  return {
    deviceHash: raw.deviceId ? hashSignal(raw.deviceId, env) : null,
    fpHash: raw.fp ? hashSignal(raw.fp, env) : null,
    ipHash: raw.ip ? hashSignal(raw.ip, env) : null,
  };
}

const RECORD_SIGNALS = `
  INSERT INTO user_signals (user_id, kind, value_hash)
  SELECT $1::uuid, k, v FROM unnest($2::varchar[], $3::varchar[]) AS t(k, v)
      ON CONFLICT (user_id, kind, value_hash) DO UPDATE SET last_seen = now()`;

/**
 * Upsert up to three rows in one statement. `first_seen` keeps the value from
 * the original insert (an upsert only touches last_seen), which is what makes
 * the row a usable history marker.
 *
 * Callers must not let a failure here fail the request: this is observation,
 * not a gate, and the caller's own budget check is the thing that protects
 * money.
 */
export async function recordSignals(
  userId: string,
  signals: HashedSignals,
  db: QueryFn = defaultQuery,
): Promise<void> {
  const kinds: string[] = [];
  const values: string[] = [];
  if (signals.deviceHash) { kinds.push('device'); values.push(signals.deviceHash); }
  if (signals.fpHash) { kinds.push('fp'); values.push(signals.fpHash); }
  if (signals.ipHash) { kinds.push('ip'); values.push(signals.ipHash); }
  if (kinds.length === 0) return;
  await db(RECORD_SIGNALS, [userId, kinds, values]);
}

// ── First-flag operator alert ────────────────────────────────────────────────
// A flag refuses someone's spend, so the owner should see the first one on each
// device and be able to check whether the detector got it right. One email per
// device per process lifetime: a restart (or a second API instance) can send
// the same device again, which is the cheap trade for not keeping state.

const alertedDevices = new Set<string>();

/** Exposed for tests. */
export function __resetAbuseAlerts(): void {
  alertedDevices.clear();
}

export interface AbuseAlertContext {
  deviceHash: string;
  userId: string;
  email: string | null | undefined;
  /** Distinct accounts seen on the device inside the window. */
  accountCount: number;
  /** How many of them were created inside the creation-span window. */
  clusteredAccounts: number;
  /** Combined current-month spend of those accounts, in credits (CA$). */
  combinedCredits: number;
  /** The combined-spend line the detector had to cross, in credits (CA$). */
  spendThreshold: number;
}

export type AbuseAlertOutcome = 'sent' | 'skipped_duplicate' | 'skipped_no_recipient' | 'failed';

export async function maybeSendAbuseAlert(
  ctx: AbuseAlertContext,
  opts: { env?: NodeJS.ProcessEnv; send?: SendEmailFn } = {},
): Promise<AbuseAlertOutcome> {
  const env = opts.env ?? process.env;
  const send = opts.send ?? sendEmail;

  if (alertedDevices.has(ctx.deviceHash)) return 'skipped_duplicate';
  const to = env.ALERT_EMAIL_TO?.trim();
  if (!to) return 'skipped_no_recipient';
  alertedDevices.add(ctx.deviceHash);

  const ok = await send(
    {
      to,
      subject: '[OnboardBuddy] Free-tier multi-account activity flagged on one device',
      text: [
        'Free-tier spend was refused on a device that tripped all three detector conditions.',
        '',
        `Device hash: ${ctx.deviceHash}`,
        `Requesting user: ${ctx.email ?? '(no email)'} (${ctx.userId})`,
        `Accounts on this device: ${ctx.accountCount} (${ctx.clusteredAccounts} created close together)`,
        `Combined spend this month: CA$${ctx.combinedCredits.toFixed(2)} (threshold CA$${ctx.spendThreshold.toFixed(2)})`,
        '',
        'Nothing was written to users.tier. The flag is recomputed per request and',
        'clears itself once the activity falls out of the window. Inspect with:',
        `  select user_id, kind, first_seen, last_seen from user_signals where kind = 'device' and value_hash = '${ctx.deviceHash}';`,
      ].join('\n'),
    },
    env,
  );
  return ok ? 'sent' : 'failed';
}

/** Fire-and-forget wrapper for the request path. */
export function notifyAbuseFlag(ctx: AbuseAlertContext): void {
  void maybeSendAbuseAlert(ctx).catch((err) => {
    console.error('[signals] abuse alert failed:', err instanceof Error ? err.message : err);
  });
}
