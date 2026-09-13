/**
 * Owner alert: email when a NON-dev account starts an analysis. During the
 * pre-commercial phase, real analysis traffic from outside the team is rare and
 * worth knowing about (and is the abuse tripwire).
 *
 * Throttled per user so a raid produces at most one email per attacker per
 * window, never a flood. Fire-and-forget: notifyNonDevAnalysis never throws and
 * never blocks the request; maybeSendAnalysisAlert is the awaitable core tests
 * drive directly.
 */
import { sendEmail, type SendEmailFn } from '../../lib/mailer.js';
import type { CreditStatus } from './creditGate.js';

export interface AlertContext {
  userId: string;
  email: string | null | undefined;
  projectName: string;
  repoFullName?: string | null;
  status: CreditStatus;
}

export type AlertOutcome =
  | 'sent'
  | 'skipped_dev'
  | 'skipped_throttled'
  | 'skipped_no_recipient'
  | 'failed';

/** Per-user last-alert timestamps (single process, like the rate limiter). */
const lastAlertAt = new Map<string, number>();

/** Exposed for tests. */
export function __resetAlertThrottle(): void {
  lastAlertAt.clear();
}

function throttleMs(env: NodeJS.ProcessEnv): number {
  const mins = Number(env.ALERT_THROTTLE_MINUTES);
  return (Number.isFinite(mins) && mins > 0 ? mins : 60) * 60_000;
}

export async function maybeSendAnalysisAlert(
  ctx: AlertContext,
  opts: { env?: NodeJS.ProcessEnv; send?: SendEmailFn; now?: () => number } = {},
): Promise<AlertOutcome> {
  const env = opts.env ?? process.env;
  const send = opts.send ?? sendEmail;
  const now = opts.now ?? Date.now;

  if (ctx.status.tier === 'dev') return 'skipped_dev';
  const to = env.ALERT_EMAIL_TO?.trim();
  if (!to) return 'skipped_no_recipient';

  // Absence means "never alerted" and must always send - distinct from a real
  // timestamp of 0, so don't collapse it to 0 with ??.
  const last = lastAlertAt.get(ctx.userId);
  const t = now();
  if (last !== undefined && t - last < throttleMs(env)) return 'skipped_throttled';
  lastAlertAt.set(ctx.userId, t);

  const credit =
    ctx.status.monthlyCredits === null
      ? 'unlimited'
      : `CA$${ctx.status.monthlyUsed.toFixed(2)} of ${ctx.status.monthlyCredits} monthly credits used, ` +
        `${(ctx.status.monthlyRemaining ?? 0).toFixed(2)} left`;

  const ok = await send(
    {
      to,
      subject: `[OnboardBuddy] ${ctx.email ?? ctx.userId} started an analysis (${ctx.status.tier})`,
      text: [
        'A non-dev account started an analysis.',
        '',
        `User: ${ctx.email ?? '(no email)'} (${ctx.userId})`,
        `Tier: ${ctx.status.tier}`,
        `Project: ${ctx.projectName}${ctx.repoFullName ? ` (${ctx.repoFullName})` : ''}`,
        `Credit: ${credit}`,
      ].join('\n'),
    },
    env,
  );
  return ok ? 'sent' : 'failed';
}

/** Fire-and-forget wrapper for request handlers. */
export function notifyNonDevAnalysis(ctx: AlertContext): void {
  void maybeSendAnalysisAlert(ctx).catch((err) => {
    console.error('[analysisAlert] unexpected failure:', err instanceof Error ? err.message : err);
  });
}
