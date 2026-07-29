import type { RequestHandler } from "express";
import { clientIp, fixedWindowRateLimit } from "./rateLimit.js";

/**
 * Throttling for the unauthenticated auth surface (bug #66).
 *
 * Without it, `POST /api/auth/login` proxies the auth provider with unlimited
 * attempts — and because every attempt reaches the provider from the backend's
 * own address, the provider's throttling degrades sign-in for *all* users
 * rather than for the attacker. Two windows, because they stop different
 * attacks and one alone is a hole:
 *
 * - **Per credential** (address + email): stops password guessing against one
 *   account. The email is in the key so that a shared address — office NAT, or
 *   a platform proxy when the deployment has not set `trust proxy` — cannot
 *   have one attacker lock every colleague out of their own account.
 * - **Per address**: stops the same client rotating through emails to stay
 *   under the per-credential window. Set well above human use so an honest
 *   shared address is never the one that trips it.
 *
 * The real frontend signs in through the Supabase client, not this route, so
 * these ceilings sit far above anything the product itself generates.
 */
const WINDOW_MS = 15 * 60 * 1000;

function emailOf(req: { body?: unknown }): string {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
}

export const perCredentialAuthRateLimit = fixedWindowRateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  keyOf: (req) => `cred:${clientIp(req)}|${emailOf(req)}`,
  message: "Too many sign-in attempts — try again in a few minutes",
});

export const perAddressAuthRateLimit = fixedWindowRateLimit({
  windowMs: WINDOW_MS,
  max: 60,
  keyOf: (req) => `addr:${clientIp(req)}`,
  message: "Too many sign-in attempts — try again in a few minutes",
});

/** Mount with a spread: `router.post("/login", ...authRateLimit, handler)`. */
export const authRateLimit: RequestHandler[] = [
  perCredentialAuthRateLimit,
  perAddressAuthRateLimit,
];

/** Tests only: clears both windows so ordering between specs cannot matter. */
export function __resetAuthRateLimitForTests(): void {
  perCredentialAuthRateLimit.reset();
  perAddressAuthRateLimit.reset();
}
