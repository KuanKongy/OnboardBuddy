import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { resolveForRequest } from "../services/packageResolver.js";

export const workflowsRouter = Router({ mergeParams: true });

workflowsRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    if (!ctx) {
      res.json({ workflows: [] });
      return;
    }
    const snapshotId = ctx.snapshotId;

    const wfResult = await query(
      `SELECT w.id, w.title, w.trigger_type, w.purpose,
              COALESCE((w.metadata->>'importance_score')::numeric, 0) AS importance_score,
              w.confidence,
              COALESCE(cs.score, (w.metadata->>'importance_score')::numeric, 0) AS composite_score,
              (SELECT COUNT(*)::int FROM workflow_steps s WHERE s.workflow_id = w.id) AS step_count,
              COALESCE(cs.reasons, '{}') AS reasons,
              COALESCE(cs.score_breakdown, '{}') AS score_breakdown
       FROM workflows w
       LEFT JOIN criticality_scores cs
         ON cs.snapshot_id = w.snapshot_id AND cs.phase = 'candidate' AND cs.view = 'candidate'
        AND cs.target_type = 'workflow' AND cs.stable_key = w.stable_key AND cs.role = 'general'
       WHERE w.snapshot_id = $1
       ORDER BY composite_score DESC`,
      [snapshotId],
    );

    res.json({ workflows: wfResult.rows, snapshotId });
  } catch (err) {
    console.error("Workflows list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

workflowsRouter.get("/:workflowId/walkthrough", requireProjectAccess(), async (req, res) => {
  try {
    const { workflowId } = req.params;

    const wfResult = await query(
      `SELECT w.id, w.title, w.trigger_type, w.purpose,
              COALESCE((w.metadata->>'importance_score')::numeric, 0) AS importance_score,
              w.confidence
       FROM workflows w WHERE w.id = $1`,
      [workflowId],
    );
    if (wfResult.rows.length === 0) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    const workflow = wfResult.rows[0];

    const stepsResult = await query(
      `SELECT ws.id, ws.step_order, ws.file_path, ws.symbol_name,
              ws.line_start, ws.line_end, ws.explanation,
              ws.step_kind, ws.deterministic_description,
              ws.role_relevance
       FROM workflow_steps ws
       WHERE ws.workflow_id = $1
       ORDER BY ws.step_order ASC`,
      [workflowId],
    );

    res.json({
      workflow,
      steps: stepsResult.rows,
    });
  } catch (err) {
    console.error("Workflow walkthrough error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
