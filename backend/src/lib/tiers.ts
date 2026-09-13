/**
 * Subscription tiers and the limits code ENFORCES. A "credit" is one Canadian
 * dollar of AI spend (the owner's unit); cost data is in USD, so credits =
 * usd * CAD_PER_USD. Each tier has a monthly credit budget and a rolling-window
 * rate cap (credits per window). `maxConcurrent` is a HIDDEN money-safety guard,
 * not a pricing feature: a dollar cap reads recorded spend, which lags a run, so
 * serializing a user's analyses (1 at a time) keeps recorded spend current
 * before the next start. Marketing perks on the pricing page (SSO, API, support
 * SLAs) are copy only and are not represented here.
 *
 * `dev` is the hidden unlimited tier (DEV_TIER_EMAILS allowlist). `blocked` is
 * the abuse block state.
 */
import { envInt, envNum } from './env.js';

export type Tier = 'free' | 'pro' | 'max' | 'dev' | 'blocked';

export interface TierLimits {
  /** Monthly credit budget (CA$). Infinity = unlimited (dev). */
  monthlyCredits: number;
  /** Max credits (CA$) spendable within one rolling `rateWindowHours` window. */
  rateCredits: number;
  /** Length of the rolling rate window, in hours. */
  rateWindowHours: number;
  /** Hidden per-user in-flight serialization guard. Infinity = unlimited. */
  maxConcurrent: number;
}

export const VALID_TIERS: readonly Tier[] = ['free', 'pro', 'max', 'dev', 'blocked'];

/** Credits are CA$; AI cost is USD. Tunable so the owner can dial without a deploy. */
export function cadPerUsd(env: NodeJS.ProcessEnv = process.env): number {
  return envNum('CAD_PER_USD', 1.38, env);
}

/** Free monthly budget is env-tunable; other tiers are fixed constants. */
export function freeMonthlyCredits(env: NodeJS.ProcessEnv = process.env): number {
  return envNum('FREE_MONTHLY_CREDITS', 5, env);
}

export function tierLimits(tier: Tier, env: NodeJS.ProcessEnv = process.env): TierLimits {
  switch (tier) {
    case 'dev':
      return { monthlyCredits: Infinity, rateCredits: Infinity, rateWindowHours: 24, maxConcurrent: Infinity };
    case 'max':
      return { monthlyCredits: 100, rateCredits: 5, rateWindowHours: 12, maxConcurrent: 1 };
    case 'pro':
      return { monthlyCredits: 30, rateCredits: 2, rateWindowHours: 24, maxConcurrent: 1 };
    case 'blocked':
      return { monthlyCredits: 0, rateCredits: 0, rateWindowHours: 24, maxConcurrent: 0 };
    case 'free':
    default:
      return { monthlyCredits: freeMonthlyCredits(env), rateCredits: 1, rateWindowHours: 120, maxConcurrent: 1 };
  }
}

/**
 * Thresholds for the free-tier multi-account detector in
 * services/creditGate.ts. All THREE must trip at once on a single device
 * before any free-tier spend is refused, because each one alone is an honest
 * shape: a shared laptop has several accounts, a workshop creates a dozen
 * accounts in an afternoon, and one person spending their own free budget is
 * the product working. Only the combination (same device, several accounts
 * born together, combined spend already past a multiple of one free budget)
 * describes budget farming. Env-overridable so the owner can tighten or
 * loosen without a deploy.
 */
export interface AbuseThresholds {
  /** Distinct accounts on one device needed before the shape is even considered. */
  minAccounts: number;
  /** How close together `minAccounts` of those accounts must have been created. */
  creationSpanDays: number;
  /** Combined monthly spend, in multiples of one free monthly budget. */
  spendMultiplier: number;
  /** Trailing window of device activity the detector looks at. */
  windowDays: number;
}

export function abuseThresholds(env: NodeJS.ProcessEnv = process.env): AbuseThresholds {
  return {
    minAccounts: envInt('ABUSE_MIN_ACCOUNTS', 3, env),
    creationSpanDays: envInt('ABUSE_CREATION_SPAN_DAYS', 7, env),
    spendMultiplier: envNum('ABUSE_SPEND_MULTIPLIER', 2, env),
    windowDays: envInt('ABUSE_WINDOW_DAYS', 30, env),
  };
}

function devEmails(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(
    (env.DEV_TIER_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * A user's effective tier. The DEV_TIER_EMAILS allowlist wins over everything,
 * then the persisted `users.tier`, then `free`.
 */
export function resolveTier(
  email: string | null | undefined,
  dbTier: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Tier {
  if (email && devEmails(env).has(email.trim().toLowerCase())) return 'dev';
  if (dbTier && (VALID_TIERS as readonly string[]).includes(dbTier)) return dbTier as Tier;
  return 'free';
}
