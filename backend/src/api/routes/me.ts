/**
 * Current-account endpoints. `GET /api/me/credit` returns the caller's daily
 * credit status so the UI can show a meter and disable Analyze before the
 * server has to reject it. Mounted behind requireAuth in routes/index.ts.
 */
import { Router } from "express";
import { checkCredit } from "../services/creditGate.js";

export const meRouter = Router();

meRouter.get("/credit", async (req, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const status = await checkCredit(user.id, user.email);
    res.json(status);
  } catch (err) {
    console.error("[me/credit] failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Could not load credit status" });
  }
});
