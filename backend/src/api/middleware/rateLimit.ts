import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Fixed-window rate limiting, in memory.
 *
 * In-memory by design: the API runs as a single process, so a Redis-backed
 * limiter would add operational coupling for a small-deployment control with no
 * corresponding benefit. Revisit if the API ever runs multiple instances —
 * with N instances each window allows N × `max`.
 *
 * Keys are chosen by the caller (`keyOf`) because the right bucket differs per
 * route: an authenticated, billed route buckets by user id, while an
 * unauthenticated one has nothing but the client address and whatever
 * identifier is in the body.
 */
export interface FixedWindowOptions {
  windowMs: number;
  max: number;
  /** Bucket key for this request, or `null` to let the request through unlimited. */
  keyOf: (req: Request) => string | null;
  /** Body of the 429 response. */
  message: string;
}

export interface RateLimiter extends RequestHandler {
  /** Drops all windows. Tests only — no production caller should need this. */
  reset(): void;
}

/**
 * Windows are only ever removed lazily (on the next request for that key), so
 * a limiter keyed on attacker-supplied values — an address, an email — would
 * otherwise grow without bound under a spray. Sweeping once the map is large
 * keeps that a bounded cost rather than a slow leak.
 */
const SWEEP_THRESHOLD = 5_000;

export function fixedWindowRateLimit(options: FixedWindowOptions): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const key = options.keyOf(req);
    if (key === null) {
      next();
      return;
    }

    const now = Date.now();

    if (windows.size >= SWEEP_THRESHOLD) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    }

    const existing = windows.get(key);

    if (!existing || existing.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (existing.count >= options.max) {
      // Retry-After lets a well-behaved client back off instead of hammering,
      // and tells an honest user how long the lockout lasts.
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((existing.resetAt - now) / 1000))));
      res.status(429).json({ error: options.message });
      return;
    }

    existing.count += 1;
    next();
  };

  middleware.reset = (): void => windows.clear();
  return middleware as RateLimiter;
}

/** The client address, as well as we can know it. */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
