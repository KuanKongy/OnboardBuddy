/**
 * Current-account endpoints. `GET /api/me/credit` returns the caller's daily
 * credit status so the UI can show a meter and disable Analyze before the
 * server has to reject it. Mounted behind requireAuth in routes/index.ts.
 *
 * This read also records the caller's device signals, because the meter loads on
 * far more pages than a spend does and that is where most of the detector's
 * history comes from. Unlike a spend it NEVER rejects for a missing device
 * header: a signed-in account must always be able to read its own status, and a
 * meter that 403s would look like a broken app.
 */
import { Router } from "express";
import { checkCredit } from "../services/creditGate.js";
import { extractClientSignals, hashClientSignals, recordSignals } from "../services/signals.js";

export const meRouter = Router();

meRouter.get("/credit", async (req, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const hashed = hashClientSignals(extractClientSignals(req));
    await recordSignals(user.id, hashed).catch((err) => {
      console.error("[me/credit] signal record failed:", err instanceof Error ? err.message : err);
    });
    const status = await checkCredit(user.id, user.email, undefined, new Date(), { deviceHash: hashed.deviceHash });
    res.json(status);
  } catch (err) {
    console.error("[me/credit] failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Could not load credit status" });
  }
});
