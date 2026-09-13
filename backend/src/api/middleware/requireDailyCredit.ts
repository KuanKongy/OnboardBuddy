/**
 * Fast pre-check gating every AI-spending route on the requester's monthly +
 * rate credit budget (services/creditGate.ts). Runs after
 * requireAuth/requireProjectAccess. On success it stashes the status on
 * req.credit so the handler can drive the non-dev analysis alert without a
 * second query. The analyze endpoint additionally re-checks inside its
 * transaction under a per-user advisory lock (the authoritative, race-safe
 * guard); this middleware is the friendly first line for all six routes.
 *
 * Fails CLOSED (503): a spend must never proceed on an unverifiable budget.
 */
import type { Request, Response, NextFunction } from 'express';
import { checkCredit, creditRejection } from '../services/creditGate.js';

export async function requireDailyCredit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const status = await checkCredit(user.id, user.email);
    if (!status.allowed) {
      const { http, body } = creditRejection(status);
      res.status(http).json(body);
      return;
    }
    req.credit = status;
    next();
  } catch (err) {
    console.error('[requireDailyCredit] check failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Could not verify your analysis credit, please retry.', code: 'credit_check_failed' });
  }
}
