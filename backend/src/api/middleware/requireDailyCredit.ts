/**
 * Fast pre-check gating every AI-spending route on the requester's monthly +
 * rate credit budget (services/creditGate.ts). Runs after
 * requireAuth/requireProjectAccess. On success it stashes the status on
 * req.credit so the handler can drive the non-dev analysis alert without a
 * second query. The analyze endpoint additionally re-checks inside its
 * transaction under a per-user advisory lock (the authoritative, race-safe
 * guard); this middleware is the friendly first line for all six routes.
 *
 * It is also where device signals are recorded (services/signals.ts) and where
 * a free-tier spend is required to identify its device at all. Without that
 * requirement the multi-account detector would be opt-out by simply dropping a
 * header, so a free request with no X-Device-Id is refused with
 * `client_required` - which the real frontend always satisfies, and a stale tab
 * fixes with a reload. Paid tiers and dev are never asked for it: they are not
 * what the detector is for, and an API user on Pro should not need a browser.
 *
 * Fails CLOSED (503): a spend must never proceed on an unverifiable budget.
 */
import type { Request, Response, NextFunction } from 'express';
import { checkCredit, creditRejection } from '../services/creditGate.js';
import { extractClientSignals, hashClientSignals, recordSignals } from '../services/signals.js';

export async function requireDailyCredit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const hashed = hashClientSignals(extractClientSignals(req));
    // Observation, never a gate: a failed upsert costs the detector one data
    // point, and failing the request over it would turn a bookkeeping problem
    // into an outage. The budget check below is the guard that protects money.
    await recordSignals(user.id, hashed).catch((err) => {
      console.error('[requireDailyCredit] signal record failed:', err instanceof Error ? err.message : err);
    });

    const status = await checkCredit(user.id, user.email, undefined, new Date(), { deviceHash: hashed.deviceHash });
    if (!status.allowed) {
      const { http, body } = creditRejection(status);
      res.status(http).json(body);
      return;
    }
    if (status.tier === 'free' && !hashed.deviceHash) {
      const { http, body } = creditRejection({ ...status, allowed: false, reason: 'client_required' });
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
