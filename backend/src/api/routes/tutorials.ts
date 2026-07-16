import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { resolveForRequest } from "../services/packageResolver.js";

export const tutorialsRouter = Router({ mergeParams: true });

const TUTORIAL_LIST_SELECT = `
  SELECT t.id, t.stable_key, t.title, t.summary, t.status, t.confidence,
         t.unknowns, t.created_at, t.workflow_id,
         t.generation_context->>'goal' AS goal,
         w.trigger_type, w.purpose,
         op.role AS package_role, op.analyzed_commit, op.branch AS package_branch,
         (SELECT count(*)::int FROM tutorial_steps ts WHERE ts.tutorial_id = t.id) AS step_count
  FROM tutorials t
  LEFT JOIN workflows w ON w.id = t.workflow_id
  LEFT JOIN onboarding_packages op ON op.id = t.package_id`;

/**
 * Generated request-flow tutorials (doc/Pipeline.md "Tutorials"): traced
 * workflow steps with code snippets, explanations, and per-step receipts.
 * Diagrams intentionally excluded — tutorials are the code-first view;
 * diagrams live in onboarding sections and the graph tabs.
 *
 * Selection: ?package_id= pins one package's tutorials (a package already
 * implies a role); legacy ?role= keeps the old role-latest behavior; with
 * neither, the caller's member default (then latest) resolves the package.
 */
tutorialsRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const role = (req.query.role as string) ?? null;

    let packageId: string | null = null;
    if (req.query.package_id !== undefined || !role) {
      const ctx = await resolveForRequest(req, res, { role });
      if (ctx === false) return;
      packageId = ctx?.packageId ?? null;
      // Resolved to a bare snapshot (no package generated yet): fall through
      // to the role-latest query, which returns [] the same way it used to.
    }

    if (packageId) {
      const tutorials = (await query(
        `${TUTORIAL_LIST_SELECT}
         WHERE t.package_id = $1 AND op.project_id = $2
         ORDER BY t.created_at DESC`,
        [packageId, projectId],
      )).rows;
      res.json({ tutorials, packageId });
      return;
    }

    const rows = (await query(
      `${TUTORIAL_LIST_SELECT}
       WHERE op.project_id = $1 AND ($2::varchar IS NULL OR op.role = $2)
       ORDER BY t.created_at DESC`,
      [projectId, role],
    )).rows;

    // Latest tutorial per workflow+role: older regenerations stay in the DB
    // for audit but the list shows one entry per flow.
    const seen = new Set<string>();
    const tutorials = rows.filter((t: Record<string, unknown>) => {
      const key = `${t.stable_key}:${t.package_role}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ tutorials, packageId: null });
  } catch (err) {
    console.error("Tutorials list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

tutorialsRouter.get("/:tutorialId", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { tutorialId } = req.params;

    const tutResult = await query(
      `SELECT t.id, t.stable_key, t.title, t.summary, t.status, t.confidence,
              t.unknowns, t.workflow_id,
              t.generation_context->>'goal' AS goal,
              w.trigger_type, w.purpose,
              op.role AS package_role, op.analyzed_commit
       FROM tutorials t
       LEFT JOIN workflows w ON w.id = t.workflow_id
       LEFT JOIN onboarding_packages op ON op.id = t.package_id
       WHERE t.id = $1 AND op.project_id = $2`,
      [tutorialId, projectId],
    );
    if (tutResult.rows.length === 0) {
      res.status(404).json({ error: "Tutorial not found" });
      return;
    }

    const steps = (await query(
      `SELECT ts.id, ts.step_order, ts.file_path, ts.symbol_name,
              ts.line_start, ts.line_end, ts.snippet, ts.explanation, ts.receipt_ids
       FROM tutorial_steps ts
       WHERE ts.tutorial_id = $1
       ORDER BY ts.step_order`,
      [tutorialId],
    )).rows as Array<{ id: string; receipt_ids: string[] } & Record<string, unknown>>;

    const receiptIds = steps.flatMap((s) => s.receipt_ids ?? []);
    const receipts = receiptIds.length > 0
      ? (await query(
          `SELECT id, receipt_kind, trust_level, file_path, symbol_name,
                  line_start, line_end, snippet, commit_hash
           FROM source_receipts WHERE id = ANY($1::uuid[])`,
          [receiptIds],
        )).rows
      : [];
    const receiptById = new Map((receipts as Array<{ id: string }>).map((r) => [r.id, r]));

    res.json({
      tutorial: tutResult.rows[0],
      steps: steps.map((s) => ({
        ...s,
        receipts: (s.receipt_ids ?? []).map((id) => receiptById.get(id)).filter(Boolean),
      })),
    });
  } catch (err) {
    console.error("Tutorial detail error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
