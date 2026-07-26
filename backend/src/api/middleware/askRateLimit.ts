import type { NextFunction, Request, Response } from "express";

/**
 * Fixed-window rate limiter for `POST /projects/:id/ask` — the one route that
 * triggers a real, billed LLM call per request. Keyed on the authenticated
 * user id (not IP: the API has no other IP-based controls, and a shared NAT
 * would otherwise punish unrelated users together).
 *
 * In-memory by design: the API runs as a single process, so a Redis-backed
 * limiter would add operational coupling for a course-scope control with no
 * corresponding benefit. Revisit if the API ever runs multiple instances.
 */
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

interface Window {
  count: number;
  resetAt: number;
}
const windowsByUser = new Map<string, Window>();

export function askRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.id;
  if (!userId) {
    // requireAuth runs first in the route chain; this is unreachable in
    // practice, but fail open to "no limiter" rather than block on a bug here.
    next();
    return;
  }

  const now = Date.now();
  const existing = windowsByUser.get(userId);

  if (!existing || existing.resetAt <= now) {
    windowsByUser.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (existing.count >= MAX_REQUESTS_PER_WINDOW) {
    res.status(429).json({ error: "Too many questions — try again in a few minutes" });
    return;
  }

  existing.count += 1;
  next();
}
