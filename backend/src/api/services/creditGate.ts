/**
 * Per-user credit gate. A credit is one Canadian dollar of AI spend. Every
 * spend endpoint checks this before enqueueing so one account cannot drain the
 * owner's OpenRouter balance.
 *
 * Two windows, both enforced:
 *   - Monthly budget: spend since the start of the UTC month.
 *   - Rolling rate cap: spend in the trailing `rateWindowHours`.
 * Spend is SUM(ai_generation_runs.estimated_cost_usd) attributed to the user
 * via analysis_jobs.requested_by, converted to credits with CAD_PER_USD. All AI
 * spend counts (analysis, its auto-chained generation, standalone generation,
 * regeneration) - there is no per-action token.
 *
 * The dollar figures read RECORDED spend, which lags a run by minutes, so a
 * burst of concurrent starts would all pass. The authoritative guard against
 * that lives in the analyze transaction (a per-user advisory lock + this same
 * check on the txn client); `maxConcurrent` = 1 serializes a user's analyses so
 * recorded spend is current before the next start.
 *
 * MULTI-ACCOUNT DETECTOR (free tier only)
 * The budget above is per ACCOUNT, and accounts are free, so the cheapest
 * attack on the owner's balance is a handful of signups on one laptop. The
 * limits stay strictly per-account anyway - this does not pool or share
 * anyone's budget. Instead, a free-tier request is refused when all THREE of
 * these hold for the caller's device (services/signals.ts, thresholds in
 * lib/tiers.ts):
 *   (a) >= minAccounts distinct accounts seen on the device in the trailing
 *       windowDays,
 *   (b) >= minAccounts of those accounts were CREATED within creationSpanDays
 *       of each other (users.created_at), and
 *   (c) their combined spend this UTC month is >= spendMultiplier x one free
 *       monthly budget.
 * Any one or two of those is an honest shape - a shared family laptop, a
 * workshop signing up together, a user spending their own free credits - so
 * none of them is punished alone. Only the combination is budget farming.
 *
 * The flag is COMPUTED LIVE from those windowed queries and is never written to
 * users.tier, so it decays by itself as the activity ages out of the window; no
 * one has to remember to un-flag a device. The only key that can refuse a
 * request is the client's own stored random device id. The fingerprint and IP
 * hashes are recorded as evidence for a human and are read by nothing here: a
 * campus is one shared IP and a rack of identical laptops, and a false positive
 * there would lock out a real user for someone else's behaviour.
 */
import { query as defaultQuery } from '../../lib/db.js';
import { resolveTier, tierLimits, cadPerUsd, abuseThresholds, freeMonthlyCredits, type Tier } from '../../lib/tiers.js';
import { notifyAbuseFlag } from './signals.js';

export type CreditReason =
  | 'ok'
  | 'monthly_exhausted'
  | 'rate_limited'
  | 'analysis_in_progress'
  | 'blocked'
  | 'abuse_detected'
  | 'client_required';

export interface CreditStatus {
  tier: Tier;
  /** null = unlimited (dev). Values are in credits (CA$). */
  monthlyCredits: number | null;
  monthlyUsed: number;
  monthlyRemaining: number | null;
  /** ISO of the start of next UTC month. */
  monthResetAt: string;
  rateCredits: number | null;
  rateWindowHours: number | null;
  rateUsed: number;
  /** ISO of when the rate window frees enough to run again; null unless rate-limited. */
  rateResetAt: string | null;
  /** Current queued+running jobs for the user (the hidden serialization guard). */
  inFlight: number;
  allowed: boolean;
  reason: CreditReason;
}

/** Minimal query surface so tests can inject a fake (and the analyze txn can pass its client). */
export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export function startOfUtcMonth(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function startOfNextUtcMonth(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function windowStartIso(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

const SPEND_SINCE = `
  SELECT COALESCE(SUM(agr.estimated_cost_usd), 0) AS usd, MIN(aj.created_at) AS oldest
    FROM analysis_jobs aj
    JOIN ai_generation_runs agr ON agr.job_id = aj.id
   WHERE aj.requested_by = $1 AND aj.created_at >= $2`;

/**
 * Every account seen on one device inside the window. The unique constraint on
 * (user_id, kind, value_hash) means one row per account, so these rows ARE the
 * distinct accounts. Rows whose user_id was nulled by an account deletion are
 * skipped by the join: they are history a human can read, but they carry no
 * creation date or spend to judge.
 */
const DEVICE_ACCOUNTS = `
  SELECT u.id, u.created_at
    FROM user_signals s
    JOIN users u ON u.id = s.user_id
   WHERE s.kind = 'device' AND s.value_hash = $1 AND s.last_seen >= $2`;

const COMBINED_MONTH_SPEND = `
  SELECT COALESCE(SUM(agr.estimated_cost_usd), 0) AS usd
    FROM analysis_jobs aj
    JOIN ai_generation_runs agr ON agr.job_id = aj.id
   WHERE aj.requested_by = ANY($1::uuid[]) AND aj.created_at >= $2`;

/**
 * The largest number of accounts whose creation dates all fall inside one
 * `spanDays` window. Sorted + sliding window rather than a SQL self-join: the
 * row count here is the handful of accounts on one device, and the arithmetic is
 * far easier to read (and to test) in one place.
 */
export function maxAccountsCreatedWithin(createdAt: Date[], spanDays: number): number {
  if (createdAt.length === 0) return 0;
  const times = createdAt.map((d) => d.getTime()).sort((a, b) => a - b);
  const spanMs = spanDays * 86_400_000;
  let best = 1;
  let start = 0;
  for (let end = 0; end < times.length; end += 1) {
    while (times[end]! - times[start]! > spanMs) start += 1;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

/**
 * Runs only for an otherwise-allowed free-tier request that presented a device
 * id. Costs one query in the common case: condition (a) fails for a normal
 * device (it sees one account), and the spend query is never reached.
 */
async function detectMultiAccountAbuse(
  userId: string,
  email: string | null | undefined,
  deviceHash: string,
  db: QueryFn,
  now: Date,
): Promise<boolean> {
  const t = abuseThresholds();
  const windowStart = new Date(now.getTime() - t.windowDays * 86_400_000).toISOString();
  const accounts = await db(DEVICE_ACCOUNTS, [deviceHash, windowStart]);
  if (accounts.rows.length < t.minAccounts) return false;

  const created = accounts.rows
    .map((r) => (r.created_at ? new Date(r.created_at as string | Date) : null))
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  const clustered = maxAccountsCreatedWithin(created, t.creationSpanDays);
  if (clustered < t.minAccounts) return false;

  const ids = accounts.rows.map((r) => r.id as string);
  const spendRes = await db(COMBINED_MONTH_SPEND, [ids, startOfUtcMonth(now)]);
  const combinedCredits = Number(spendRes.rows[0]?.usd ?? 0) * cadPerUsd();
  const spendThreshold = t.spendMultiplier * freeMonthlyCredits();
  if (combinedCredits < spendThreshold) return false;

  notifyAbuseFlag({
    deviceHash,
    userId,
    email,
    accountCount: accounts.rows.length,
    clusteredAccounts: clustered,
    combinedCredits,
    spendThreshold,
  });
  return true;
}

export async function checkCredit(
  userId: string,
  email: string | null | undefined,
  db: QueryFn = defaultQuery,
  now: Date = new Date(),
  signals?: { deviceHash: string | null },
): Promise<CreditStatus> {
  const tierRow = await db(`SELECT tier FROM users WHERE id = $1`, [userId]);
  const dbTier = (tierRow.rows[0]?.tier as string | undefined) ?? null;
  const tier = resolveTier(email, dbTier);
  const monthResetAt = startOfNextUtcMonth(now);

  if (tier === 'dev') {
    return {
      tier, monthlyCredits: null, monthlyUsed: 0, monthlyRemaining: null, monthResetAt,
      rateCredits: null, rateWindowHours: null, rateUsed: 0, rateResetAt: null,
      inFlight: 0, allowed: true, reason: 'ok',
    };
  }

  const limits = tierLimits(tier);
  const rate = cadPerUsd();
  const [monthRes, rateRes, concRes] = await Promise.all([
    db(SPEND_SINCE, [userId, startOfUtcMonth(now)]),
    db(SPEND_SINCE, [userId, windowStartIso(now, limits.rateWindowHours)]),
    db(`SELECT COUNT(*)::int AS n FROM analysis_jobs WHERE requested_by = $1 AND status IN ('queued','running')`, [userId]),
  ]);

  const monthlyUsed = Number(monthRes.rows[0]?.usd ?? 0) * rate;
  const rateUsed = Number(rateRes.rows[0]?.usd ?? 0) * rate;
  const inFlight = Number(concRes.rows[0]?.n ?? 0);
  const monthlyCredits = limits.monthlyCredits;
  const rateCredits = limits.rateCredits;
  const monthlyRemaining = Math.max(0, monthlyCredits - monthlyUsed);

  let allowed = true;
  let reason: CreditReason = 'ok';
  let rateResetAt: string | null = null;
  if (tier === 'blocked') {
    allowed = false;
    reason = 'blocked';
  } else if (monthlyUsed >= monthlyCredits) {
    allowed = false;
    reason = 'monthly_exhausted';
  } else if (rateUsed >= rateCredits) {
    allowed = false;
    reason = 'rate_limited';
    // Approximate: the earliest spend in the window ages out at oldest + window.
    const oldest = rateRes.rows[0]?.oldest as string | Date | null | undefined;
    if (oldest) {
      rateResetAt = new Date(new Date(oldest).getTime() + limits.rateWindowHours * 3_600_000).toISOString();
    }
  } else if (inFlight >= limits.maxConcurrent) {
    allowed = false;
    reason = 'analysis_in_progress';
  }

  // Last, and only when the account's own budget would have let this through:
  // the detector costs extra queries, and an already-rejected request does not
  // need a second reason. Paid tiers never reach here (and `dev` returned
  // above) - someone who is paying is not farming free budgets. A free request
  // with no device header is NOT refused here, so GET /me/credit stays readable
  // for any signed-in user; the middleware is what insists on the header for a
  // spend.
  if (allowed && tier === 'free' && signals?.deviceHash) {
    if (await detectMultiAccountAbuse(userId, email, signals.deviceHash, db, now)) {
      allowed = false;
      reason = 'abuse_detected';
    }
  }

  return {
    tier, monthlyCredits, monthlyUsed, monthlyRemaining, monthResetAt,
    rateCredits, rateWindowHours: limits.rateWindowHours, rateUsed, rateResetAt,
    inFlight, allowed, reason,
  };
}

/** Shared HTTP shape for a rejection, used by the middleware and the analyze txn. */
export function creditRejection(status: CreditStatus): { http: number; body: Record<string, unknown> } {
  const message =
    status.reason === 'analysis_in_progress'
      ? 'An analysis is already running on your account. It will free up when that finishes.'
      : status.reason === 'rate_limited'
        ? `You have reached your usage rate. It frees up ${status.rateResetAt ?? 'shortly'}.`
        : status.reason === 'blocked'
          ? 'This account cannot start analyses.'
          : status.reason === 'abuse_detected'
            // Deliberately says what to do next rather than what was detected:
            // a real user hitting this needs the contact page, and an attacker
            // learns nothing about the thresholds from it.
            ? 'Free usage on this device is paused while we review unusual multi-account activity. Contact us through the contact page and we will take a look.'
            : status.reason === 'client_required'
              ? 'Please use the OnboardBuddy app for this action. If you are already in the app, reload the page and try again.'
              : `You have used this month's analysis credits. They reset ${status.monthResetAt}.`;
  // 403, not 429: nothing frees up by waiting, so a client that retries on a
  // 429's schedule would just keep knocking.
  const forbidden =
    status.reason === 'blocked' || status.reason === 'abuse_detected' || status.reason === 'client_required';
  return {
    http: forbidden ? 403 : 429,
    body: {
      error: message,
      code: status.reason,
      monthResetAt: status.monthResetAt,
      rateResetAt: status.rateResetAt,
    },
  };
}
