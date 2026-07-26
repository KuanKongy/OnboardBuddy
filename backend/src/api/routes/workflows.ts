import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { resolveForRequest } from "../services/packageResolver.js";
import { buildCandidateProvenance } from "../services/scoreProvenance.js";

export const workflowsRouter = Router({ mergeParams: true });

/**
 * How the rail is ordered, written next to the ORDER BY that does it.
 *
 * The list header claims "most critical first" and the tooltip beside it used
 * to explain a per-target score, which is not what orders this list at all —
 * tier wins before any score is compared. Serving the real sequence from here
 * is the only version that cannot drift away from the query below.
 */
const WORKFLOW_ORDERING = {
  summary: "Tier first, then business capability, then the flow's own importance score.",
  steps: [
    "Tier: core user flows, then supporting (jobs, admin, dev), then untraced endpoints & pages",
    "Within a tier: flows that realize a named business capability come first",
    "Then the flow's importance score (trigger type and traced effects, not step count)",
    "Ties break alphabetically by title",
  ],
} as const;

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
              cs.score_breakdown,
              -- composite_score above falls back to the extractor's own
              -- importance score when no candidate row exists. That is a
              -- different number with different inputs, so the response has to
              -- say which one the reader is looking at rather than serve both
              -- under one name.
              (cs.score IS NOT NULL) AS has_candidate_score,
              -- capability_members is polymorphic: (member_type, member_id),
              -- NOT a node_id column. Joining on cm.node_id threw
              -- "column cm.node_id does not exist", which failed this whole
              -- statement — so the endpoint 500'd and the Workflows tab was
              -- empty for every project. It was missed because the ordering
              -- was checked by running SQL against the database directly
              -- rather than through this route.
              EXISTS (
                SELECT 1 FROM workflow_steps ws
                JOIN capability_members cm
                  ON cm.member_type = 'node' AND cm.member_id = ws.node_id
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

    type WorkflowRow = {
      composite_score: string | number;
      score_breakdown: unknown;
      has_candidate_score: boolean;
      reasons: string[] | null;
    } & Record<string, unknown>;

    const workflows = (wfResult.rows as WorkflowRow[]).map(({ score_breakdown, has_candidate_score, ...wf }) => ({
      ...wf,
      provenance: buildCandidateProvenance({
        label: "Criticality",
        score: Number(wf.composite_score),
        breakdown: has_candidate_score ? score_breakdown : null,
        reasons: wf.reasons,
        targetType: "workflow",
        unavailableReason:
          "This flow has no candidate-ranking row in this snapshot, so the number shown is the extractor's own importance score (trigger type, tier and traced effects) with no signal breakdown behind it.",
      }),
    }));

    res.json({ workflows, ordering: WORKFLOW_ORDERING, snapshotId });
  } catch (err) {
    console.error("Workflows list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Every step of one flow, in order — the canvas source for the Workflows tab.
 *
 * It serves ONE ROW PER STEP, deliberately. `/graph/workflows/:id` folds the
 * path down to one node per distinct symbol, which is where two owner-reported
 * defects came from at once: the rail advertised `COUNT(*) workflow_steps`
 * while the canvas drew the folded set (OnboardBuddy: 774 steps → 650 nodes,
 * and its top-ranked flow claimed 8 steps over a 4-node picture), and the
 * serpentine gate — which needs a chain of 6+ — was measuring the folded count,
 * so flows the rail called long were laid out as short vertical columns.
 *
 * A step that re-enters a file it already visited is genuinely a later step in
 * the trace, so the row it gets here is not a duplicate.
 *
 * `explanation` is the narrated text and is only written for steps a tutorial
 * covered (~5% of them); `deterministic_description` is always present. Both
 * are returned, and which one a reader is looking at is not guesswork on the
 * client: `explanationSource` says so.
 */
workflowsRouter.get("/:workflowId/walkthrough", requireProjectAccess(), async (req, res) => {
  try {
    const { workflowId } = req.params;
    const projectId = req.params.id;

    // Scoped to the project in the path: the id came from the URL, and
    // membership was checked against that project, not against whatever
    // snapshot this workflow belongs to.
    const wfResult = await query(
      `SELECT w.id, w.title, w.trigger_type, w.purpose,
              COALESCE((w.metadata->>'importance_score')::numeric, 0) AS importance_score,
              w.confidence
       FROM workflows w
       JOIN analysis_snapshots s ON s.id = w.snapshot_id
       WHERE w.id = $1 AND s.project_id = $2`,
      [workflowId, projectId],
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
              ws.role_relevance, ws.metadata, ws.node_id, n.stable_key
       FROM workflow_steps ws
       LEFT JOIN graph_nodes n ON n.id = ws.node_id
       WHERE ws.workflow_id = $1
       ORDER BY ws.step_order ASC`,
      [workflowId],
    );

    type StepRow = {
      id: string; step_order: number; file_path: string; symbol_name: string | null;
      line_start: number | null; line_end: number | null; explanation: string | null;
      step_kind: string; deterministic_description: string; role_relevance: unknown;
      metadata: { syntheticReturn?: boolean } | null; node_id: string | null;
      stable_key: string | null;
    };
    const rows = stepsResult.rows as StepRow[];

    const steps = rows.map((s) => {
      const narrated = (s.explanation ?? "").trim();
      return {
        id: s.id,
        stepOrder: s.step_order,
        filePath: s.file_path,
        symbolName: s.symbol_name,
        lineStart: s.line_start,
        lineEnd: s.line_end,
        stepKind: s.step_kind,
        /** Always populated; a formatter wrote it. */
        deterministicDescription: s.deterministic_description,
        /** Written by the narration pass for the minority of covered steps. */
        explanation: narrated || null,
        explanationSource: narrated ? ("narrated" as const) : ("deterministic" as const),
        /** For the node-detail lookup, which accepts a stable key or a UUID. */
        nodeKey: s.stable_key ?? s.node_id,
        syntheticReturn: s.metadata?.syntheticReturn === true,
        roleRelevance: s.role_relevance,
        // Kept for callers written against the pre-camelCase shape.
        step_order: s.step_order,
        file_path: s.file_path,
        symbol_name: s.symbol_name,
        line_start: s.line_start,
        line_end: s.line_end,
        step_kind: s.step_kind,
        deterministic_description: s.deterministic_description,
        role_relevance: s.role_relevance,
      };
    });

    res.json({
      workflow,
      steps,
      /**
       * What the canvas is entitled to claim. `stepCount` is the same
       * `COUNT(*)` the rail shows, and it is also `steps.length` — the tab has
       * one number, not a headline number and a smaller drawn one.
       */
      counts: {
        stepCount: steps.length,
        narratedSteps: steps.filter((s) => s.explanationSource === "narrated").length,
        distinctFiles: new Set(steps.map((s) => s.filePath)).size,
        distinctSymbols: new Set(steps.map((s) => s.symbolName).filter(Boolean)).size,
      },
    });
  } catch (err) {
    console.error("Workflow walkthrough error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
