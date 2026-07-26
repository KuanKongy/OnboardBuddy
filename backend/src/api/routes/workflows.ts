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

    // Ordered by tier first, then by score within the tier. `composite_score`
    // alone put whatever traced deepest on top, because the old
    // importance_score was a step count in disguise.
    //
    // `realizes_capability` is the one ranking signal that does not exist at
    // extraction time — capabilities are produced later by the semantic pass —
    // so it is applied here, where it does: a flow that delivers a named
    // business capability outranks one that delivers nothing nameable.
    const wfResult = await query(
      `SELECT w.id, w.title, w.trigger_type, w.purpose,
              COALESCE((w.metadata->>'importance_score')::numeric, 0) AS importance_score,
              w.confidence,
              COALESCE(w.metadata->>'tier', 'supporting') AS tier,
              COALESCE(cs.score, (w.metadata->>'importance_score')::numeric, 0) AS composite_score,
              (SELECT COUNT(*)::int FROM workflow_steps s WHERE s.workflow_id = w.id) AS step_count,
              COALESCE(
                CASE WHEN jsonb_typeof(w.metadata->'ranking_reasons') = 'array'
                     THEN ARRAY(SELECT jsonb_array_elements_text(w.metadata->'ranking_reasons'))
                END,
                cs.reasons, '{}') AS reasons,
              COALESCE(cs.score_breakdown, '{}') AS score_breakdown,
              EXISTS (
                SELECT 1 FROM workflow_steps ws
                JOIN capability_members cm ON cm.node_id = ws.node_id
                WHERE ws.workflow_id = w.id
              ) AS realizes_capability
       FROM workflows w
       LEFT JOIN criticality_scores cs
         ON cs.snapshot_id = w.snapshot_id AND cs.phase = 'candidate' AND cs.view = 'candidate'
        AND cs.target_type = 'workflow' AND cs.stable_key = w.stable_key AND cs.role = 'general'
       WHERE w.snapshot_id = $1
       ORDER BY
         CASE COALESCE(w.metadata->>'tier', 'supporting')
           WHEN 'core' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END,
         realizes_capability DESC,
         COALESCE((w.metadata->>'importance_score')::numeric, 0) DESC,
         w.title ASC`,
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
