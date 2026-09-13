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
 */
import { query as defaultQuery } from '../../lib/db.js';
import { resolveTier, tierLimits, cadPerUsd, type Tier } from '../../lib/tiers.js';

export type CreditReason =
  | 'ok'
  | 'monthly_exhausted'
  | 'rate_limited'
  | 'analysis_in_progress'
  | 'blocked';

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

export async function checkCredit(
  userId: string,
  email: string | null | undefined,
  db: QueryFn = defaultQuery,
  now: Date = new Date(),
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
          : `You have used this month's analysis credits. They reset ${status.monthResetAt}.`;
  return {
    http: status.reason === 'blocked' ? 403 : 429,
    body: {
      error: message,
      code: status.reason,
      monthResetAt: status.monthResetAt,
      rateResetAt: status.rateResetAt,
    },
  };
}
