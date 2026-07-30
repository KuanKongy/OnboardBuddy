import type { Request, Response, NextFunction } from "express";
import { isUuid } from "../lib/uuid.js";

/**
 * 404 for a path segment that is not a uuid, before Postgres raises a cast error.
 * Applied per route, never to a whole router: a literal sibling like `/members/me`
 * sits in the same position as `:userId` and must survive.
 */
export function requireUuidParam(...names: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const name of names) {
      if (!isUuid(req.params[name])) {
        res.status(404).json({ error: "Not found" });
        return;
      }
    }
    next();
  };
}
