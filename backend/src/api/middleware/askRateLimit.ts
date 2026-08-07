import { fixedWindowRateLimit } from "./rateLimit.js";

/**
 * Throttle for `POST /projects/:id/ask` — the one route that triggers a real,
 * billed LLM call per request. Keyed on the authenticated user id (not IP: the
 * API has no other IP-based controls, and a shared NAT would otherwise punish
 * unrelated users together).
 *
 * `requireAuth` runs first in the route chain, so an anonymous request cannot
 * reach here; if one somehow did, `keyOf` returns null and the request passes
 * — failing open to "no limiter" rather than blocking on a bug in this file.
 */
export const askRateLimit = fixedWindowRateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  keyOf: (req) => req.user?.id ?? null,
  message: "Too many questions. Try again in a few minutes.",
});
