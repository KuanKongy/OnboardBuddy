import type { Request, Response, NextFunction } from "express";
import { isUuid } from "../lib/uuid.js";

/**
 * #74/B11: every id in this API is a `uuid` column, so a path segment that is
 * not a uuid went to Postgres as one and came back "invalid input syntax for
 * type uuid" — a 500 for a request that plainly names something which cannot
 * exist. 404 is the truthful answer and it costs a round trip to the database.
 *
 * Applied per route, never to a whole router: not every segment in an id slot
 * is an id. A literal sibling such as `/members/me` occupies the same position
 * as `:userId` and has to survive this check, so the routes that opt in are the
 * ones whose parameter really does reach SQL.
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
