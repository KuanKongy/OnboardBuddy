import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { resolveForRequest } from "../services/packageResolver.js";

export const tutorialsRouter = Router({ mergeParams: true });

const TUTORIAL_LIST_SELECT = `
  SELECT t.id, t.stable_key, t.title, t.summary, t.status, t.confidence,
         t.unknowns, t.created_at, t.workflow_id,
         t.generation_context->>'goal' AS goal,
         t.generation_context->>'procedure_kind' AS procedure_kind,
         COALESCE((t.generation_context->>'rank')::int, 99) AS rank,
         w.trigger_type, w.purpose,
         COALESCE(w.metadata->>'tier', 'supporting') AS tier,
         op.role AS package_role, op.analyzed_commit, op.branch AS package_branch,
         (SELECT count(*)::int FROM tutorial_steps ts WHERE ts.tutorial_id = t.id) AS step_count
  FROM tutorials t
  LEFT JOIN workflows w ON w.id = t.workflow_id
  LEFT JOIN onboarding_packages op ON op.id = t.package_id`;

/** Rank is the generator's own ordering: "get it running" before "trace a flow". */
const TUTORIAL_ORDER = `ORDER BY rank ASC, t.created_at DESC`;

interface SelectionReport {
  cap?: number;
  considered?: number;
  eligible?: number;
  emitted?: number;
  capBinding?: boolean;
  byTier?: { core: number; supporting: number; surface: number };
  skipped?: Array<{ title: string; reason: string; detail: string }>;
  overflow?: Array<{ title: string; kind: string }>;
}

/**
 * Why this tab is showing what it is showing — including nothing.
 *
 * A tutorial is now a procedure, and a procedure needs evidence that supports
 * an action: something you can run, and a flow with a traced effect to watch.
 * When that evidence is absent the honest answer is zero tutorials, so this
 * endpoint has to be able to say WHY zero, in the repo's own terms, rather
 * than leaving the tab to guess ("analyze the repository first") at a project
 * that has already been analyzed.
 *
 * Two sources, merged. The generator's own selection report is authoritative
 * and survives a zero-tutorial run because it rides in the validation phase's
 * metrics rather than on a tutorial row. The structural counts below are
 * recomputed live, so a snapshot analyzed before this endpoint existed — or
 * one whose generation never ran — still gets a real answer.
 */
async function buildCoverage(snapshotId: string, emitted: number): Promise<Record<string, unknown>> {
  const [phaseRow] = (await query(
    `SELECT metrics->'tutorials' AS tutorials FROM snapshot_phases
     WHERE snapshot_id = $1 AND phase = 'validation'`,
    [snapshotId],
  )).rows as Array<{ tutorials: { selection?: SelectionReport } | null }>;
  const selection: SelectionReport = phaseRow?.tutorials?.selection ?? {};

  const tiers = (await query(
    `SELECT COALESCE(metadata->>'tier', 'supporting') AS tier, count(*)::int AS n
     FROM workflows WHERE snapshot_id = $1 GROUP BY 1`,
    [snapshotId],
  )).rows as Array<{ tier: string; n: number }>;
  const byTier = {
    core: tiers.find((t) => t.tier === 'core')?.n ?? 0,
    supporting: tiers.find((t) => t.tier === 'supporting')?.n ?? 0,
    surface: tiers.find((t) => t.tier === 'surface')?.n ?? 0,
  };

  // What this repository says about how to run itself. Same config nodes the
  // generator reads, so the tab and the generator cannot disagree.
  const configRows = (await query(
    `SELECT file_path, metadata FROM graph_nodes
     WHERE snapshot_id = $1 AND type = 'config'
       AND (metadata ? 'topology' OR metadata ? 'scripts')`,
    [snapshotId],
  )).rows as Array<{ file_path: string; metadata: Record<string, unknown> }>;
  let compose: string | null = null;
  let hasStart = false;
  let hasTests = false;
  for (const row of configRows) {
    if (row.metadata.topology) {
      if (/test/i.test(row.file_path.split("/").pop() ?? "")) hasTests = true;
      else { compose = row.file_path; hasStart = true; }
    }
    const scripts = row.metadata.scripts as Record<string, string> | undefined;
    if (scripts) {
      if (["dev", "start", "serve", "start:dev", "develop", "dev:all"].some((s) => scripts[s])) hasStart = true;
      if (["test", "test:unit", "test:all", "tests"].some((s) => scripts[s])) hasTests = true;
    }
  }

  const total = byTier.core + byTier.supporting + byTier.surface;
  const reasons: string[] = [];
  if (emitted === 0) {
    if (total === 0) {
      reasons.push("No flow was traced in this repository, so there is nothing to walk through step by step.");
    } else if (byTier.core === 0 && byTier.supporting === 0) {
      reasons.push(
        `${byTier.surface} entry point${byTier.surface === 1 ? " was" : "s were"} found, but no side effect was traced from any of them. ` +
        "A procedure needs an effect to watch for — without one there is nothing to verify, and a walkthrough would just be prose.",
      );
    }
    if (!hasStart && !hasTests) {
      reasons.push(
        "Nothing in this repository says how to run it — no compose file and no start or test script — so no step here could be a command you could actually execute.",
      );
    }
    if (reasons.length === 0 && (selection.skipped?.length ?? 0) === 0) {
      reasons.push("Onboarding generation has not produced tutorials for this package yet.");
    }
  }

  return {
    cap: selection.cap ?? null,
    capBinding: selection.capBinding ?? false,
    considered: selection.considered ?? total,
    eligible: selection.eligible ?? null,
    emitted,
    byTier,
    runnable: { start: hasStart, tests: hasTests, compose },
    skipped: (selection.skipped ?? []).slice(0, 12),
    overflow: (selection.overflow ?? []).slice(0, 12),
    reasons,
  };
}

/**
 * Generated procedures (doc/REWORK_PLAN.md Phase 7): each step carries an
 * action, an expected observable result, a verification and its file/line,
 * all computed from evidence rather than written by a model.
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
    let snapshotId: string | null = null;
    if (req.query.package_id !== undefined || !role) {
      const ctx = await resolveForRequest(req, res, { role });
      if (ctx === false) return;
      packageId = ctx?.packageId ?? null;
      snapshotId = ctx?.snapshotId ?? null;
      // Resolved to a bare snapshot (no package generated yet): fall through
      // to the role-latest query, which returns [] the same way it used to.
    }

    if (packageId) {
      const tutorials = (await query(
        `${TUTORIAL_LIST_SELECT}
         WHERE t.package_id = $1 AND op.project_id = $2
         ${TUTORIAL_ORDER}`,
        [packageId, projectId],
      )).rows;
      res.json({
        tutorials,
        packageId,
        coverage: snapshotId ? await buildCoverage(snapshotId, tutorials.length) : null,
      });
      return;
    }

    // Newest first HERE, deliberately: the dedupe below keeps the first row it
    // sees per key, so ordering by rank first would let an older regeneration
    // with a stronger rank win over the current one. Rank is applied after.
    const rows = (await query(
      `${TUTORIAL_LIST_SELECT}
       WHERE op.project_id = $1 AND ($2::varchar IS NULL OR op.role = $2)
       ORDER BY t.created_at DESC`,
      [projectId, role],
    )).rows;

    // Latest tutorial per workflow+role: older regenerations stay in the DB
    // for audit but the list shows one entry per flow.
    const seen = new Set<string>();
    const tutorials = rows
      .filter((t: Record<string, unknown>) => {
        const key = `${t.stable_key}:${t.package_role}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.rank) - Number(b.rank));

    res.json({
      tutorials,
      packageId: null,
      coverage: snapshotId ? await buildCoverage(snapshotId, tutorials.length) : null,
    });
  } catch (err) {
    console.error("Tutorials list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * One step, as the reader needs it: what to do, what to expect, how to check.
 *
 * `action`/`expected`/`verify` live in `tutorial_steps.metadata` because the
 * table predates the procedural rewrite and has no columns for them. Steps
 * written by the old essay generator have none of these keys, so every field
 * is nullable and the client falls back to the note alone.
 */
function presentStep(row: Record<string, unknown>, receiptById: Map<string, unknown>): Record<string, unknown> {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const { metadata: _metadata, receipt_ids: receiptIds, ...rest } = row as Record<string, unknown> & { receipt_ids?: string[] };
  return {
    ...rest,
    receipt_ids: receiptIds ?? [],
    kind: (meta.stepKind as string) ?? null,
    action: (meta.action as string) ?? null,
    command: (meta.command as string) ?? null,
    expected: (meta.expected as string) ?? null,
    verify: (meta.verify as string) ?? null,
    verify_command: (meta.verify_command as string) ?? null,
    evidence: (meta.evidence as string) ?? null,
    receipts: (receiptIds ?? []).map((id) => receiptById.get(id)).filter(Boolean),
  };
}

tutorialsRouter.get("/:tutorialId", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { tutorialId } = req.params;

    const tutResult = await query(
      `SELECT t.id, t.stable_key, t.title, t.summary, t.status, t.confidence,
              t.unknowns, t.workflow_id,
              t.generation_context->>'goal' AS goal,
              t.generation_context->>'procedure_kind' AS procedure_kind,
              t.generation_context->'selection' AS selection,
              w.trigger_type, w.purpose,
              COALESCE(w.metadata->>'tier', 'supporting') AS tier,
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
              ts.line_start, ts.line_end, ts.snippet, ts.explanation,
              ts.receipt_ids, ts.metadata
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
      steps: steps.map((s) => presentStep(s, receiptById)),
    });
  } catch (err) {
    console.error("Tutorial detail error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
