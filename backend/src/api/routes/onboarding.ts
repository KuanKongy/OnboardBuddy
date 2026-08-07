import { Router } from "express";
import { query } from "../../lib/db.js";
import { roleTitle } from "../../lib/roleDisplay.js";
import { latestSnapshotOrderSql } from "../../lib/snapshotOrdering.js";
import { enqueueSummaryRun } from "../services/analysisStarter.js";
import { buildWeightTableProvenance } from "../services/scoreProvenance.js";
import { CHAPTERS, SECTION_SPECS, SECTION_TYPES, type SectionType } from "../../worker/generation/sectionSpecs.js";
import {
  ageLabelFrom,
  claimCounts,
  claimForReceipt,
  confidenceReasonFor,
  inlineMarkersToText,
  packageGenerationMode,
  receiptStaleness,
  receiptVerification,
  sectionPrivacyMode,
} from "../lib/receiptPresentation.js";
import { groupGaps, summarizeGaps, type RawGap } from "../lib/gapSummary.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { requireUuidParam } from "../middleware/requireUuidParam.js";
import {
  BadPackageParamError,
  readPackageParam,
  resolveForRequest,
  resolvePackageContext,
} from "../services/packageResolver.js";
import { summarizeRunBudget } from "../../worker/ai/budgetEnforcer.js";

export const onboardingRouter = Router({ mergeParams: true });

/**
 * Regenerate one section (doc/Pipeline.md "Regeneration"): rebuilds the
 * section's bundle against the same snapshot — or the latest complete
 * snapshot of the scope when regenerating a stale section — regenerates,
 * revalidates, and replaces the content in the same package; old
 * generation runs stay for audit.
 */
onboardingRouter.post("/sections/:sectionId/regenerate", requireProjectAccess("owner", "admin"), requireUuidParam("sectionId"), async (req, res) => {
  try {
    const projectId = String(req.params.id);
    const { sectionId } = req.params;
    const userId = req.user!.id;

    const sectionResult = await query(
      `SELECT ps.type, ps.snapshot_id, ps.role, ps.review_status, ps.package_id, op.scope_id,
              op.branch AS package_branch
       FROM package_sections ps
       JOIN onboarding_packages op ON op.id = ps.package_id
       WHERE ps.id = $1 AND op.project_id = $2`,
      [sectionId, projectId],
    );
    const section = sectionResult.rows[0] as
      | { type: string; snapshot_id: string; role: string | null; review_status: string;
          package_id: string; scope_id: string; package_branch: string | null }
      | undefined;
    if (!section) {
      res.status(404).json({ error: "Section not found" });
      return;
    }

    // Stale sections regenerate against the newest analyzed code, not the
    // snapshot that made them stale in the first place.
    let targetSnapshotId = section.snapshot_id;
    if (section.review_status === "stale") {
      const latest = await query(
        `SELECT id FROM analysis_snapshots s
         WHERE scope_id = $1 AND status = 'complete'
         ORDER BY ${latestSnapshotOrderSql('s', '$2::varchar')} LIMIT 1`,
        [section.scope_id, section.package_branch],
      );
      targetSnapshotId = (latest.rows[0] as { id: string } | undefined)?.id ?? section.snapshot_id;
    }

    // No privacy-mode gate: under ai_disabled the worker regenerates the
    // section deterministically (facts-only markdown, zero LLM calls), so
    // regeneration always works — the mode decides HOW, not WHETHER.
    await query(
      `UPDATE package_sections SET review_status = 'regenerate_requested' WHERE id = $1`,
      [sectionId],
    );
    // checkpoint.sectionType lets the run history label this row ("Regenerated
    // section X") before any generation-run rows exist for it.
    const jobId = ((await query(
      `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, role, status, current_step, branch, checkpoint)
       VALUES ($1, $2, $3, 'regenerate_section', $4, 'queued', 'Waiting for worker', $5, $6::jsonb)
       RETURNING id`,
      [projectId, targetSnapshotId, userId, section.role ?? "general",
       section.package_branch, JSON.stringify({ sectionType: section.type })],
    )).rows[0] as { id: string }).id;

    await enqueueSummaryRun(jobId, projectId, "regenerate_section", {
      jobId,
      snapshotId: targetSnapshotId,
      projectId,
      triggeredBy: userId,
      role: section.role ?? "general",
      sectionType: section.type,
      packageId: section.package_id,
    });

    res.status(202).json({ job: { id: jobId, status: "queued", section_type: section.type } });
  } catch (err) {
    console.error("Regenerate section error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * On-demand per-role generation: builds the onboarding package for one role
 * against the latest analyzed snapshot, without re-analyzing the repo.
 * Any member can generate their own role's package — that's the product's
 * core loop for a newly joined developer; budgets cap the spend.
 *
 * `only_stale` narrows the same job to the stale sections and tutorials of an
 * existing package: the cheap answer to "N sections are stale" when a full
 * rebuild would pay to regenerate the eleven that are still current.
 */
onboardingRouter.post("/generate", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = String(req.params.id);
    const userId = req.user!.id;
    const body = (req.body ?? {}) as {
      role?: string; package_id?: string; snapshot_id?: string; branch?: string; only_stale?: boolean;
    };
    const role = body.role;
    if (!role || !["backend", "frontend", "devops", "qa", "general"].includes(role)) {
      res.status(400).json({ error: "role must be one of backend/frontend/devops/qa/general" });
      return;
    }
    const onlyStale = body.only_stale === true;

    // Target context: an explicit package (generate another role for the
    // same scope/commit/branch) > an explicit snapshot > the latest complete
    // snapshot. Branch defaults to the context's branch.
    let snapshot: { id: string; scope_id: string | null; commit_hash: string | null; branch: string | null } | undefined;
    let branch = typeof body.branch === "string" && body.branch !== "" ? body.branch : null;
    let targetPackageId: string | null = null;
    try {
      const packageId = readPackageParam(body.package_id);
      targetPackageId = packageId ?? null;
      if (packageId) {
        const pkg = (await query(
          `SELECT op.snapshot_id, op.branch, s.scope_id, s.commit_hash, s.branch AS snapshot_branch
           FROM onboarding_packages op JOIN analysis_snapshots s ON s.id = op.snapshot_id
           WHERE op.id = $1 AND op.project_id = $2`,
          [packageId, projectId],
        )).rows[0] as { snapshot_id: string; branch: string; scope_id: string | null; commit_hash: string | null; snapshot_branch: string | null } | undefined;
        if (!pkg) {
          res.status(404).json({ error: "Package not found" });
          return;
        }
        snapshot = { id: pkg.snapshot_id, scope_id: pkg.scope_id, commit_hash: pkg.commit_hash, branch: pkg.snapshot_branch };
        branch = branch ?? pkg.branch;
      } else if (body.snapshot_id) {
        snapshot = (await query(
          `SELECT id, scope_id, commit_hash, branch FROM analysis_snapshots
           WHERE id = $1 AND project_id = $2 AND status = 'complete'`,
          [String(body.snapshot_id), projectId],
        )).rows[0] as typeof snapshot;
        if (!snapshot) {
          res.status(404).json({ error: "Snapshot not found or not complete" });
          return;
        }
      }
    } catch (err) {
      if (err instanceof BadPackageParamError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    // "Only the stale parts" is meaningless without a package to read the
    // stale parts from — the worker would have nothing to scope the rebuild to
    // and would fall back to minting a fresh package at the new commit.
    if (onlyStale && !targetPackageId) {
      res.status(400).json({ error: "only_stale requires package_id" });
      return;
    }

    if (!snapshot) {
      // Newest by PUSH recency on the requested (or default) branch — NOT by
      // analysis_snapshots.created_at, which is stamped when the run reached
      // persistResults and so orders by "which analysis got to run first".
      // lib/snapshotOrdering.ts has the full rationale.
      snapshot = (await query(
        `SELECT id, scope_id, commit_hash, branch FROM analysis_snapshots s
         WHERE project_id = $1 AND status = 'complete'
         ORDER BY ${latestSnapshotOrderSql('s', '$2::varchar')} LIMIT 1`,
        [projectId, branch],
      )).rows[0] as typeof snapshot;
    }
    if (!snapshot) {
      res.status(404).json({ error: "No completed analysis. Run an analysis first." });
      return;
    }
    branch = branch ?? snapshot.branch;
    // The worker reads the project's CURRENT privacy mode: ai_disabled
    // yields a deterministic package, the other modes an AI-narrated one.

    if (onlyStale && targetPackageId) {
      // Stale content regenerates against the newest analyzed code, not the
      // snapshot the package was built from — same rule (and same query) as
      // the per-section route above; a rebuild against the old snapshot would
      // reproduce the content that went stale.
      const latest = await query(
        `SELECT id, scope_id, commit_hash, branch FROM analysis_snapshots s
         WHERE scope_id = $1 AND status = 'complete'
         ORDER BY ${latestSnapshotOrderSql('s', '$2::varchar')} LIMIT 1`,
        [snapshot.scope_id, branch],
      );
      snapshot = (latest.rows[0] as typeof snapshot) ?? snapshot;

      // Nothing stale = nothing to do, and a job that generates nothing is
      // worse than a refusal: it bills a run and reports "complete" over an
      // unchanged package. The UI hides the option at zero; this is the race.
      const counts = (await query(
        `SELECT (SELECT count(*) FROM package_sections ps
                  WHERE ps.package_id = $1 AND ps.review_status = 'stale')::int AS stale_sections,
                (SELECT count(*) FROM tutorials t
                  WHERE t.package_id = $1 AND t.status = 'stale')::int AS stale_tutorials`,
        [targetPackageId],
      )).rows[0] as { stale_sections: number; stale_tutorials: number };
      if (counts.stale_sections === 0 && counts.stale_tutorials === 0) {
        res.status(409).json({ error: "Nothing in this package is stale" });
        return;
      }
    }

    // Concurrency is per package identity: only the same (snapshot, role,
    // branch) generation conflicts; other roles/branches/snapshots run in
    // parallel.
    const active = await query(
      `SELECT id FROM analysis_jobs
       WHERE project_id = $1 AND job_type = 'generate_package' AND role = $2
         AND snapshot_id = $3 AND COALESCE(branch, '') = COALESCE($4, '')
         AND status IN ('queued', 'running')
       LIMIT 1`,
      [projectId, role, snapshot.id, branch],
    );
    if (active.rows.length > 0) {
      res.status(409).json({
        error: "Generation for this role is already in progress for this snapshot and branch",
        active_job_id: active.rows[0].id,
      });
      return;
    }

    // checkpoint.onlyStale is what the run history labels this row by, and —
    // because Resume rebuilds the job payload from the row — what keeps a
    // retried run scoped to the stale parts of the existing package.
    const jobId = ((await query(
      `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, role, status, current_step, branch, commit_hash, scope_id, checkpoint)
       VALUES ($1, $2, $3, 'generate_package', $4, 'queued', 'Waiting for worker', $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [projectId, snapshot.id, userId, role, branch, snapshot.commit_hash, snapshot.scope_id,
       onlyStale ? JSON.stringify({ onlyStale: true, packageId: targetPackageId }) : null],
    )).rows[0] as { id: string }).id;

    await enqueueSummaryRun(jobId, projectId, `generate_summary_${role}`, {
      jobId,
      snapshotId: snapshot.id,
      projectId,
      triggeredBy: userId,
      role,
      branch: branch ?? undefined,
      packageId: onlyStale ? targetPackageId ?? undefined : undefined,
      onlyStale: onlyStale || undefined,
    });

    res.status(202).json({ job: { id: jobId, status: "queued", role, only_stale: onlyStale } });
  } catch (err) {
    console.error("On-demand generate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Matches the sibling /staleness cap. The ORDER BY is newest-first, so the cap
// only ever drops the least interesting end.
const PACKAGE_LIST_LIMIT = 100;

/**
 * Package cards (doc/PLAN.md "Onboarding package = (scope, role, commit)"):
 * every package with scope, role, status, commit, staleness and confidence
 * rollups — the data behind the card grid and its filters.
 */
onboardingRouter.get("/packages", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    // is_latest_commit is per (scope, branch): "behind" means behind the
    // newest complete analysis of the SAME branch (effective branch stamped
    // on analysis jobs). Legacy rows without job branches fall back to the
    // old per-scope semantics.
    const rows = (await query(
      `SELECT op.id, op.snapshot_id, op.role, op.status, op.analyzed_commit, op.branch,
              op.created_at, op.updated_at,
              sc.display_name AS scope_name, sc.path_prefix, sc.kind AS scope_kind,
              s.semantic_depth, s.privacy_mode,
              sec.section_count, sec.stale_sections, sec.approved_sections,
              sec.low_confidence_sections,
              tut.tutorial_count, tut.stale_tutorials,
              -- The subject line of the commit this package was built from,
              -- carried on the analyze job that produced the snapshot
              -- (checkpoint.commitMessage, stamped at INSERT by
              -- analysisStarter). EARLIEST matching job wins: that is the run
              -- that created the snapshot, so its message is the one that
              -- describes this commit. Null for every package analyzed before
              -- the key existed — the card falls back to the short SHA rather
              -- than inventing a subject.
              (SELECT aj.checkpoint->>'commitMessage' FROM analysis_jobs aj
               WHERE aj.snapshot_id = op.snapshot_id
                 AND aj.job_type IN ('analyze_scope', 'incremental_update')
                 AND aj.checkpoint ? 'commitMessage'
               ORDER BY aj.created_at ASC LIMIT 1) AS commit_message,
              (op.analyzed_commit = COALESCE(
                (SELECT aj.commit_hash FROM analysis_jobs aj
                 WHERE aj.project_id = op.project_id AND aj.scope_id = op.scope_id
                   AND aj.branch = op.branch AND aj.commit_hash IS NOT NULL
                   AND aj.status = 'complete'
                   AND aj.job_type IN ('analyze_scope', 'incremental_update')
                 ORDER BY aj.created_at DESC LIMIT 1),
                (SELECT s2.commit_hash FROM analysis_snapshots s2
                 WHERE s2.scope_id = op.scope_id AND s2.status = 'complete'
                 ORDER BY ${latestSnapshotOrderSql('s2', 'op.branch')} LIMIT 1)
              )) AS is_latest_commit
       FROM onboarding_packages op
       JOIN analysis_scopes sc ON sc.id = op.scope_id
       JOIN analysis_snapshots s ON s.id = op.snapshot_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS section_count,
                (count(*) FILTER (WHERE ps.review_status = 'stale'))::int AS stale_sections,
                (count(*) FILTER (WHERE ps.review_status = 'approved'))::int AS approved_sections,
                (count(*) FILTER (WHERE ps.confidence = 'low'))::int AS low_confidence_sections
         FROM package_sections ps
         WHERE ps.package_id = op.id
       ) sec ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS tutorial_count,
                count(*) FILTER (WHERE t.status = 'stale')::int AS stale_tutorials
         FROM tutorials t
         WHERE t.package_id = op.id
       ) tut ON true
       WHERE op.project_id = $1
       ORDER BY op.updated_at DESC
       LIMIT ${PACKAGE_LIST_LIMIT}`,
      [projectId],
    )).rows;

    // Which of these cards the tabs are actually serving right now. The client
    // cannot derive it from this list: the order is `updated_at DESC`, while
    // resolution runs member-default first and only then "latest", so the
    // selector's idea of the current package would disagree with every other
    // tab the moment a member pinned an older one. No packageId argument, so
    // this can never throw PackageNotFoundError — it only reads.
    const ctx = await resolvePackageContext({ projectId: String(projectId), userId: req.user?.id ?? null });

    res.json({ packages: rows, resolved_package_id: ctx?.packageId ?? null });
  } catch (err) {
    console.error("Packages list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Unresolved staleness for the project (incremental runs write stale_flags):
 * what went stale, why, and which files changed — the honest "your docs are
 * outdated" signal.
 */
onboardingRouter.get("/staleness", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    // ?package_id= narrows the stale list to that package's scope (what the
    // reader for a pinned package cares about); default stays project-wide.
    let scopeId: string | null = null;
    if (req.query.package_id !== undefined) {
      const ctx = await resolveForRequest(req, res);
      if (ctx === false) return;
      scopeId = ctx?.scopeId ?? null;
    }

    const rows = (await query(
      `SELECT sf.id, sf.target_type, sf.target_stable_key, sf.reason,
              sf.changed_files, sf.created_at, sf.section_id, sf.package_id,
              ps.type AS section_type, ps.role AS section_role
       FROM stale_flags sf
       JOIN analysis_snapshots s ON s.id = sf.snapshot_id
       LEFT JOIN package_sections ps ON ps.id = sf.section_id
       WHERE s.project_id = $1 AND sf.resolved_at IS NULL
         AND sf.target_type IN ('package', 'package_section', 'tutorial')
         AND ($2::uuid IS NULL OR s.scope_id = $2)
       ORDER BY sf.created_at DESC
       LIMIT 100`,
      [projectId, scopeId],
    )).rows;
    res.json({ staleFlags: rows });
  } catch (err) {
    console.error("Staleness error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * "How this was made" (audit P2 §13): the full production record of one
 * package — which models ran, how many calls, what it cost, what retrieval
 * saw, what validation flagged, and what the voice lint let through. All of
 * it is already stored (ai_generation_runs + generation_context); this
 * endpoint only aggregates. Any member can read it — provenance is the
 * product's trust story, not an admin secret.
 */
onboardingRouter.get("/provenance", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    let packageId: string | null = null;
    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    if (ctx?.source === "explicit" || ctx?.source === "member_default") {
      packageId = ctx.packageId;
    }
    if (!packageId) {
      packageId = ((await query(
        `SELECT id FROM onboarding_packages
         WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [projectId],
      )).rows[0] as { id: string } | undefined)?.id ?? null;
    }
    if (!packageId) {
      res.status(404).json({ error: "No onboarding package found" });
      return;
    }

    const pkg = (await query(
      `SELECT op.id, op.role, op.analyzed_commit, op.branch, op.created_at,
              s.semantic_depth, s.privacy_mode,
              s.budget_usage AS snapshot_budget_usage,
              pst.budget_overrides
       FROM onboarding_packages op
       JOIN analysis_snapshots s ON s.id = op.snapshot_id
       LEFT JOIN project_settings pst ON pst.project_id = op.project_id
       WHERE op.id = $1 AND op.project_id = $2`,
      [packageId, projectId],
    )).rows[0] as
      | { id: string; role: string; analyzed_commit: string; branch: string;
          created_at: string; semantic_depth: string; privacy_mode: string;
          snapshot_budget_usage: unknown; budget_overrides: unknown }
      | undefined;
    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    // Budget block for the run that BUILT this package: the generation job is
    // the one whose ai_generation_runs rows carry this package_id. Its
    // checkpoint holds the baseline the enforcer metered from — packages
    // built before per-run metering have none and report usedThisRun: null.
    const genJob = (await query(
      `SELECT aj.id, aj.checkpoint -> 'budgetBaseline' AS budget_baseline,
              (SELECT COUNT(*) FROM ai_generation_runs r2
                WHERE r2.job_id = aj.id AND r2.status = 'complete')::int AS llm_calls
       FROM analysis_jobs aj
       WHERE aj.id = (
         SELECT r.job_id FROM ai_generation_runs r
          WHERE r.package_id = $1 AND r.job_id IS NOT NULL
          ORDER BY r.created_at DESC LIMIT 1
       )`,
      [packageId],
    )).rows[0] as { id: string; budget_baseline: unknown; llm_calls: number } | undefined;

    const budget = summarizeRunBudget({
      depth: pkg.semantic_depth,
      budgetOverrides: pkg.budget_overrides,
      baseline: genJob?.budget_baseline ?? null,
      jobLlmCalls: genJob?.llm_calls ?? 0,
      snapshotUsage: pkg.snapshot_budget_usage,
    });

    const models = (await query(
      `SELECT provider, model, model_tier,
              COUNT(*) FILTER (WHERE status = 'complete')::int AS calls,
              COUNT(*) FILTER (WHERE status = 'skipped_cached')::int AS cached_calls,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_calls,
              COALESCE(SUM((token_usage->>'inputTokens')::bigint) FILTER (WHERE status = 'complete'), 0)::bigint AS input_tokens,
              COALESCE(SUM((token_usage->>'outputTokens')::bigint) FILTER (WHERE status = 'complete'), 0)::bigint AS output_tokens,
              COALESCE(SUM(estimated_cost_usd), 0)::numeric AS cost_usd
       FROM ai_generation_runs
       WHERE package_id = $1
       GROUP BY provider, model, model_tier
       ORDER BY cost_usd DESC`,
      [packageId],
    )).rows as Array<Record<string, unknown>>;

    const sections = (await query(
      `SELECT ps.id, ps.type, ps.title, ps.confidence, ps.review_status,
              ps.generation_context, ps.unknowns,
              (SELECT count(*)::int FROM source_receipts sr WHERE sr.section_id = ps.id) AS receipt_count
       FROM package_sections ps
       WHERE ps.package_id = $1
       ORDER BY ps.created_at ASC`,
      [packageId],
    )).rows as Array<{
      id: string; type: string; title: string; confidence: string; review_status: string;
      generation_context: Record<string, unknown> | null;
      unknowns: Array<unknown> | null;
      receipt_count: number;
    }>;

    // "How this was made" must answer for the PACKAGE. The snapshot's
    // privacy_mode answers for the analysis and is frozen at analysis time, so
    // a package regenerated after switching to ai_disabled was still labelled
    // "privacy: full ai" — the one panel a user checks to see whether their
    // setting took effect was reporting the setting it replaced.
    const generation = packageGenerationMode(sections.map((sec) => sec.generation_context));
    res.json({
      package: {
        id: pkg.id,
        role: pkg.role,
        analyzedCommit: pkg.analyzed_commit,
        branch: pkg.branch,
        generatedAt: pkg.created_at,
        semanticDepth: pkg.semantic_depth,
        privacyMode: generation.privacyMode ?? pkg.privacy_mode,
        // The mode the ANALYSIS ran under — kept, but no longer conflated with
        // the package's: it may predate the current setting by many runs.
        analysisPrivacyMode: pkg.privacy_mode,
        generation,
      },
      budget: { ...budget, jobId: genJob?.id ?? null },
      models: models.map((m) => ({
        provider: m.provider,
        model: m.model,
        tier: m.model_tier,
        calls: Number(m.calls ?? 0),
        cachedCalls: Number(m.cached_calls ?? 0),
        failedCalls: Number(m.failed_calls ?? 0),
        inputTokens: Number(m.input_tokens ?? 0),
        outputTokens: Number(m.output_tokens ?? 0),
        costUsd: Number(m.cost_usd ?? 0),
      })),
      sections: sections.map((sec) => {
        const ctx2 = (sec.generation_context ?? {}) as {
          prompt_version?: unknown;
          retrieval?: unknown;
          validation?: { issues?: unknown[]; retried?: unknown; hardFailure?: unknown };
          inline_citations?: unknown;
          voice_lint?: { remaining_hits?: unknown[] };
        };
        return {
          sectionId: sec.id,
          type: sec.type,
          title: sec.title,
          confidence: sec.confidence,
          confidenceReason: confidenceReasonFor(sec.generation_context, sec.receipt_count),
          reviewStatus: sec.review_status,
          receiptCount: sec.receipt_count,
          promptVersion: (ctx2.prompt_version as string | undefined) ?? null,
          retrieval: ctx2.retrieval ?? null,
          validation: {
            issues: Array.isArray(ctx2.validation?.issues) ? ctx2.validation!.issues : [],
            retried: ctx2.validation?.retried === true,
            hardFailure: ctx2.validation?.hardFailure === true,
          },
          voiceLintHits: Array.isArray(ctx2.voice_lint?.remaining_hits) ? ctx2.voice_lint!.remaining_hits : [],
          inlineCitations: ctx2.inline_citations ?? null,
          // Same tally the reader's confidence dial draws, from the same
          // helper — the panel and the dial disagreeing about how many claims
          // cite receipts would undo the point of showing either. Zeros rather
          // than null here: the panel prints "cited/total" unconditionally.
          claims: claimCounts(sec.generation_context) ?? { total: 0, cited: 0, low: 0 },
          unknownsCount: Array.isArray(sec.unknowns) ? sec.unknowns.length : 0,
        };
      }),
    });
  } catch (err) {
    console.error("Provenance error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

onboardingRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const role = (req.query.role as string) ?? req.projectMember?.developer_role ?? "general";

    type PkgRow = {
      id: string;
      snapshot_id: string;
      scope_id: string;
      role: string;
      status: string;
      analyzed_commit: string;
      branch: string;
      created_at: string;
      updated_at: string;
    };
    const PKG_SELECT = `SELECT op.id, op.snapshot_id, op.scope_id, op.role, op.status,
              op.analyzed_commit, op.branch, op.created_at, op.updated_at
       FROM onboarding_packages op`;

    // Explicit ?package_id= pins one exact package (the sidebar selection);
    // otherwise the legacy behavior stands: latest package for the role.
    let pkg: PkgRow | undefined;
    try {
      const packageId = readPackageParam(req.query.package_id);
      if (packageId) {
        pkg = (await query(
          `${PKG_SELECT} WHERE op.id = $1 AND op.project_id = $2`,
          [packageId, projectId],
        )).rows[0] as PkgRow | undefined;
        if (!pkg) {
          res.status(404).json({ error: "Package not found" });
          return;
        }
      }
    } catch (err) {
      if (err instanceof BadPackageParamError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    if (!pkg) {
      pkg = (await query(
        `${PKG_SELECT}
         WHERE op.project_id = $1 AND op.role = $2
         ORDER BY op.created_at DESC LIMIT 1`,
        [projectId, role],
      )).rows[0] as PkgRow | undefined;
    }

    if (!pkg) {
      res.json({ package: { status: "missing", role, sections: [] } });
      return;
    }

    const sectionsResult = await query(
      `SELECT ps.id, ps.type, ps.title, ps.content, ps.confidence,
              ps.review_status, ps.analyzed_commit, ps.reviewed_at, ps.reviewed_by,
              u.email AS reviewed_by_email,
              ps.generation_context, ps.diagrams, ps.unknowns
       FROM package_sections ps
       LEFT JOIN users u ON u.id = ps.reviewed_by
       WHERE ps.package_id = $1
       ORDER BY ps.created_at ASC`,
      [pkg.id],
    );

    type SectionRow = {
      id: string;
      type: string;
      title: string;
      content: string;
      confidence: string;
      review_status: string;
      analyzed_commit: string;
      reviewed_at: string | null;
      reviewed_by: string | null;
      reviewed_by_email: string | null;
      generation_context: Record<string, unknown>;
      diagrams: Array<{ kind: string; mermaid: string }>;
      unknowns: Array<{ kind: string; detail?: string | null }>;
    };

    // Staleness baseline: receipts are re-verified against the newest
    // complete analysis of the same scope by comparing symbol content
    // hashes — never asserted. No baseline -> compare against the receipt's
    // own snapshot (trivially fresh).
    const latestSnap = (await query(
      `SELECT id, commit_hash FROM analysis_snapshots s
       WHERE scope_id = $1 AND status = 'complete'
       ORDER BY ${latestSnapshotOrderSql('s', '$2::varchar')} LIMIT 1`,
      [pkg.scope_id, pkg.branch ?? null],
    )).rows[0] as { id: string; commit_hash: string } | undefined;

    // Coverage strip (audit §4.2): the "critical 25%" claim gets real
    // denominators — what was analyzed, what this package actually cites,
    // and which signals ranked it. Every number is a count over stored
    // rows; nothing here passes through a model.
    const snapMeta = (await query(
      `SELECT created_at, file_count, parsed_file_count, symbol_count, workflow_count,
              language_inventory, unknowns
       FROM analysis_snapshots WHERE id = $1`,
      [pkg.snapshot_id],
    )).rows[0] as {
      created_at: string;
      file_count: number;
      parsed_file_count: number | null;
      symbol_count: number;
      workflow_count: number;
      language_inventory: Record<string, unknown>;
      unknowns: Array<Record<string, unknown>>;
    } | undefined;

    const citedAgg = (await query(
      `SELECT
         (SELECT count(*)::int FROM tutorials t WHERE t.package_id = $1) AS tutorial_count,
         (SELECT count(*)::int FROM (
            SELECT sr.workflow_id FROM source_receipts sr
              JOIN package_sections ps ON ps.id = sr.section_id
             WHERE ps.package_id = $1 AND sr.workflow_id IS NOT NULL
            UNION
            SELECT t.workflow_id FROM tutorials t
             WHERE t.package_id = $1 AND t.workflow_id IS NOT NULL) wf) AS workflows_covered,
         (SELECT count(*)::int FROM (
            SELECT DISTINCT sr.node_stable_key AS key FROM source_receipts sr
              JOIN package_sections ps ON ps.id = sr.section_id
             WHERE ps.package_id = $1 AND sr.node_stable_key IS NOT NULL
               AND sr.node_stable_key NOT LIKE '%:%'
            UNION
            SELECT DISTINCT sr.node_stable_key FROM source_receipts sr
              JOIN tutorial_steps ts ON ts.id = sr.tutorial_step_id
              JOIN tutorials tt ON tt.id = ts.tutorial_id
             WHERE tt.package_id = $1 AND sr.node_stable_key IS NOT NULL
               AND sr.node_stable_key NOT LIKE '%:%') sym) AS symbols_cited,
         (SELECT count(*)::int FROM (
            SELECT DISTINCT sr.file_path AS f FROM source_receipts sr
              JOIN package_sections ps ON ps.id = sr.section_id
             WHERE ps.package_id = $1 AND sr.file_path IS NOT NULL
            UNION
            SELECT DISTINCT sr.file_path FROM source_receipts sr
              JOIN tutorial_steps ts ON ts.id = sr.tutorial_step_id
              JOIN tutorials tt ON tt.id = ts.tutorial_id
             WHERE tt.package_id = $1 AND sr.file_path IS NOT NULL) fl) AS files_cited`,
      [pkg.id],
    )).rows[0] as {
      tutorial_count: number;
      workflows_covered: number;
      symbols_cited: number;
      files_cited: number;
    } | undefined;

    const sections = await Promise.all(
      (sectionsResult.rows as SectionRow[]).map(async (sec) => {
        // symbol_summary: the semantic record's rendered summary for the
        // cited symbol (falls back to its JSDoc) — a receipt should say what
        // the code DOES, not just show the snippet.
        const receiptsResult = await query(
          `SELECT sr.id, sr.file_path, sr.symbol_name, sr.line_start, sr.line_end,
                  sr.snippet, sr.confidence, sr.commit_hash, sr.node_stable_key,
                  sr.trust_level, sr.claim,
                  sr.metadata->>'copiedFromReceiptId' AS bundle_receipt_id,
                  (sr.metadata->>'truncatedFromLineEnd')::int AS truncated_from_line_end,
                  snap.created_at AS analyzed_at,
                  own_node.hash AS own_node_hash,
                  own_node.line_start AS own_node_line_start,
                  latest_node.hash AS latest_node_hash,
                  latest_node.line_start AS latest_node_line_start,
                  latest_node.line_end AS latest_node_line_end,
                  COALESCE(
                    (SELECT rec.summary FROM snapshot_semantic_records ssr
                       JOIN semantic_records rec ON rec.id = ssr.record_id
                     WHERE ssr.snapshot_id = sr.snapshot_id
                       AND ssr.stable_key = sr.node_stable_key
                       AND rec.status = 'usable'
                     ORDER BY rec.created_at DESC LIMIT 1),
                    (SELECT gn.metadata->>'jsdoc' FROM graph_nodes gn
                     WHERE gn.snapshot_id = sr.snapshot_id
                       AND gn.stable_key = sr.node_stable_key LIMIT 1)
                  ) AS symbol_summary
           FROM source_receipts sr
           LEFT JOIN analysis_snapshots snap ON snap.id = sr.snapshot_id
           LEFT JOIN graph_nodes own_node
             ON own_node.snapshot_id = sr.snapshot_id
            AND own_node.stable_key = sr.node_stable_key
           LEFT JOIN graph_nodes latest_node
             ON latest_node.snapshot_id = COALESCE($2, sr.snapshot_id)
            AND latest_node.stable_key = sr.node_stable_key
           WHERE sr.section_id = $1`,
          [sec.id, latestSnap?.id ?? null],
        );
        return {
          ...sec,
          receipts: receiptsResult.rows,
        };
      }),
    );

    res.json({
      package: {
        id: pkg.id,
        projectId,
        snapshotId: pkg.snapshot_id,
        scopeId: pkg.scope_id,
        role: pkg.role,
        status: pkg.status,
        analyzedCommit: pkg.analyzed_commit,
        branch: pkg.branch,
        generatedAt: pkg.created_at,
        updatedAt: pkg.updated_at,
        // Honesty rule: a package built with AI off reads very differently
        // (tables and facts, no narration) and the reader must be told why
        // rather than left to conclude the product got worse. Derived from the
        // sections, so it states what was really produced.
        generation: packageGenerationMode(sections.map((sec) => sec.generation_context)),
        coverage: snapMeta
          ? {
              snapshotCreatedAt: snapMeta.created_at,
              // Three different denominators, all of them true, none of them
              // interchangeable. `analyzed` used to be `file_count` — every
              // file in scope, images and markdown included — which overstated
              // real coverage by up to 9x on audited projects. `parsed` is
              // null only for snapshots taken before the column existed; the
              // UI must render that as unknown rather than fall back to
              // `inScope`, since that fallback IS the bug.
              files: {
                parsed: snapMeta.parsed_file_count,
                supported:
                  (snapMeta.language_inventory?.supportedFileCount as number | undefined) ?? null,
                inScope: snapMeta.file_count,
                unsupported:
                  (snapMeta.language_inventory?.unsupportedFileCount as number | undefined) ?? null,
                cited: citedAgg?.files_cited ?? 0,
              },
              symbols: { total: snapMeta.symbol_count, cited: citedAgg?.symbols_cited ?? 0 },
              workflows: { total: snapMeta.workflow_count, covered: citedAgg?.workflows_covered ?? 0 },
              tutorialCount: citedAgg?.tutorial_count ?? 0,
              languages: snapMeta.language_inventory ?? null,
              // Honesty rule (DETECTION_COVERAGE.md): snapshot-level unknowns
              // (trace dead-ends, unmodeled packages, journey gaps) are shown,
              // never silently dropped.
              detectionUnknowns: Array.isArray(snapMeta.unknowns) ? snapMeta.unknowns : [],
              // A10: the strip used to print ONLY the detection unknowns while
              // the sections printed their own, under the same word — "6 known
              // unknowns" above a page holding 89 gap entries. One population
              // now, counted once, with both provenances broken out so the
              // strip's number is the sum of what the reader can scroll to.
              gaps: summarizeGaps(
                sections.map((sec) =>
                  Array.isArray(sec.unknowns) ? (sec.unknowns as unknown[] as RawGap[]) : [],
                ),
                (Array.isArray(snapMeta.unknowns) ? snapMeta.unknowns : []) as unknown[] as RawGap[],
              ),
              // The weight table with its formula attached. The strip used to
              // ship bare signal/weight pairs and the frontend supplied its own
              // labels and its own sentence about what they meant — two copies
              // of the same claim, only one of which was checked against the
              // ranker.
              rankingProvenance: buildWeightTableProvenance(),
            }
          : null,
        sections: sections.map((sec) => {
          const SECTION_ID_MAP: Record<string, string> = {
            workflow_guide: "workflows",
          };
          return {
            id: SECTION_ID_MAP[sec.type] ?? sec.type.replace(/_/g, "-"),
            sectionId: sec.id,
            reviewStatus: sec.review_status,
            label: sec.title,
            type: sec.type,
            status: sec.review_status === "stale" ? "stale" : "complete",
            confidence: sec.confidence,
            // Who wrote THIS section, from the same stored field the package
            // banner is derived from. The reader used to guess it from a
            // hardcoded list of section ids plus "has no receipts", which
            // mislabelled every deterministic section outside that list — and
            // a whole AI-off package as AI prose whenever a section id was
            // absent from the list. `ai_disabled` is the only mode with no
            // model in it; `facts_only_ai` still narrates.
            generationMode:
              sectionPrivacyMode(sec.generation_context) === "ai_disabled" ? "deterministic" : "ai",
            // Human-readable reviewer (email) — raw UUIDs are meaningless in the UI.
            reviewedBy: sec.reviewed_by_email ?? sec.reviewed_by,
            reviewedAt: sec.reviewed_at,
            diagrams: sec.diagrams ?? [],
            unknowns: sec.unknowns ?? [],
            // A10 / UX §19.4: one section shipped 34 gap lines that differed
            // only by an env-var name. Same entries, collapsed onto their
            // template deterministically, so the reader sees `kind × N` with
            // the names behind an expander instead of 34 near-identical rows.
            unknownGroups: groupGaps(
              Array.isArray(sec.unknowns) ? (sec.unknowns as unknown[] as RawGap[]) : [],
            ),
            analyzedCommit: sec.analyzed_commit,
            confidenceReason: confidenceReasonFor(sec.generation_context, sec.receipts.length),
            // The counts behind `confidenceReason`, so the reader can draw the
            // cited fraction instead of parsing the sentence for it. Null (not
            // zeros) on generations that stored no claim array — a section that
            // predates per-claim tracking has no fraction to draw, and 0/0 in
            // its place would read as "nothing here is cited".
            claims: claimCounts(sec.generation_context),
            blocks: [
              {
                title: sec.title,
                body: sec.content,
                receipts: sec.receipts.map((r: Record<string, unknown>) => {
                  const staleness = receiptStaleness({
                    nodeStableKey: (r.node_stable_key as string | null) ?? null,
                    ownNodeHash: (r.own_node_hash as string | null) ?? null,
                    latestNodeHash: (r.latest_node_hash as string | null) ?? null,
                  });
                  return {
                    id: r.id as string,
                    bundleReceiptId: (r.bundle_receipt_id as string | null) ?? null,
                    filePath: r.file_path as string,
                    symbolName: r.symbol_name as string | null,
                    lineStart: r.line_start as number | null,
                    lineEnd: r.line_end as number | null,
                    truncatedFromLineEnd: (r.truncated_from_line_end as number | null) ?? null,
                    snippet: r.snippet as string | null,
                    summary: (r.symbol_summary as string | null) ?? null,
                    confidence: (r.confidence as string) ?? "medium",
                    trustLevel: (r.trust_level as string | null) ?? null,
                    commitHash: (r.commit_hash as string | null) ?? null,
                    nodeStableKey: (r.node_stable_key as string | null) ?? null,
                    claim:
                      (r.claim as string | null) ??
                      claimForReceipt(
                        (r.bundle_receipt_id as string | null) ?? null,
                        sec.generation_context,
                      ),
                    staleness,
                    verification: receiptVerification({
                      staleness,
                      latestNodeHash: (r.latest_node_hash as string | null) ?? null,
                      latestCommitHash: latestSnap?.commit_hash ?? (r.commit_hash as string | null) ?? null,
                      receiptLineStart: (r.line_start as number | null) ?? null,
                      receiptLineEnd: (r.line_end as number | null) ?? null,
                      ownNodeLineStart: (r.own_node_line_start as number | null) ?? null,
                      latestNodeLineStart: (r.latest_node_line_start as number | null) ?? null,
                      latestNodeLineEnd: (r.latest_node_line_end as number | null) ?? null,
                    }),
                    ageLabel: ageLabelFrom((r.analyzed_at as string | null) ?? null),
                  };
                }),
              },
            ],
          };
        }),
      },
    });
  } catch (err) {
    console.error("Onboarding GET error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

onboardingRouter.get("/sections/:sectionId/receipts", requireProjectAccess(), requireUuidParam("sectionId"), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const projectId = String(req.params.id);

    // Scope the child to the project in the path before reading anything.
    // `requireProjectAccess` proves the caller manages THIS project; it cannot
    // prove this section belongs to it, and receipts carry source snippets —
    // so an unscoped lookup here served another tenant's private code (#65).
    // Same join the regenerate route above uses.
    const ownership = await query(
      `SELECT 1
       FROM package_sections ps
       JOIN onboarding_packages op ON op.id = ps.package_id
       WHERE ps.id = $1 AND op.project_id = $2`,
      [sectionId, projectId],
    );
    if (ownership.rows.length === 0) {
      res.status(404).json({ error: "Section not found" });
      return;
    }

    const receiptsResult = await query(
      `SELECT sr.id, sr.file_path, sr.symbol_name, sr.line_start, sr.line_end,
              sr.snippet, sr.confidence, sr.commit_hash, sr.node_stable_key,
              sr.node_hash, sr.claim,
              gn.metadata AS node_metadata,
              COALESCE(
                (SELECT rec.summary FROM snapshot_semantic_records ssr
                   JOIN semantic_records rec ON rec.id = ssr.record_id
                 WHERE ssr.snapshot_id = sr.snapshot_id
                   AND ssr.stable_key = sr.node_stable_key
                   AND rec.status = 'usable'
                 ORDER BY rec.created_at DESC LIMIT 1),
                gn.metadata->>'jsdoc'
              ) AS symbol_summary
       FROM source_receipts sr
       LEFT JOIN graph_nodes gn ON gn.id = sr.node_id
       WHERE sr.section_id = $1
       ORDER BY sr.file_path, sr.line_start`,
      [sectionId],
    );

    res.json({ receipts: receiptsResult.rows });
  } catch (err) {
    console.error("Receipts GET error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

onboardingRouter.get("/validate", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;

    // ?package_id= validates that exact package; default = latest package.
    let packageId: string | null = null;
    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    if (ctx?.source === "explicit" || ctx?.source === "member_default") {
      packageId = ctx.packageId;
    }
    if (!packageId) {
      packageId = ((await query(
        `SELECT id FROM onboarding_packages
         WHERE project_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [projectId],
      )).rows[0] as { id: string } | undefined)?.id ?? null;
    }

    if (!packageId) {
      res.status(404).json({ error: "No onboarding package found" });
      return;
    }

    const { validateSectionCitations } = await import('../../worker/engine/sectionValidator.js');
    const results = await validateSectionCitations(packageId);

    res.json({ validations: results });
  } catch (err) {
    console.error("Validation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

onboardingRouter.get("/export", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const role = (req.query.role as string) ?? req.projectMember?.developer_role ?? "general";

    // ?package_id= exports that exact package; default = latest for the role.
    let pkg: { id: string; role: string } | undefined;
    try {
      const packageId = readPackageParam(req.query.package_id);
      if (packageId) {
        pkg = (await query(
          `SELECT id, role FROM onboarding_packages WHERE id = $1 AND project_id = $2`,
          [packageId, projectId],
        )).rows[0] as { id: string; role: string } | undefined;
        if (!pkg) {
          res.status(404).json({ error: "Package not found" });
          return;
        }
      }
    } catch (err) {
      if (err instanceof BadPackageParamError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    if (!pkg) {
      pkg = (await query(
        `SELECT id, role
         FROM onboarding_packages
         WHERE project_id = $1 AND role = $2
         ORDER BY created_at DESC LIMIT 1`,
        [projectId, role],
      )).rows[0] as { id: string; role: string } | undefined;
    }

    if (!pkg) {
      res.status(404).json({ error: "No onboarding package found for this role" });
      return;
    }

    // Chapter (shelf) order, not insertion order — the export mirrors the
    // reader's nav. Legacy types sort after the current layout.
    const sectionsResult = await query(
      `SELECT id, title, content, type
       FROM package_sections
       WHERE package_id = $1
       ORDER BY COALESCE(array_position($2::text[], type::text), 999), created_at ASC`,
      [pkg.id, [...SECTION_TYPES]],
    );

    const sections = sectionsResult.rows as { id: string; title: string; content: string; type: string }[];

    // Inline citation markers become plain "(path:line)" citations in the
    // exported file — marker syntax is a reader-UI affordance.
    const receiptRows = sections.length
      ? ((await query(
          `SELECT sr.section_id, sr.file_path, sr.line_start,
                  sr.metadata->>'copiedFromReceiptId' AS bundle_receipt_id
           FROM source_receipts sr
           WHERE sr.section_id = ANY($1)`,
          [sections.map((s) => s.id)],
        )).rows as Array<{ section_id: string; file_path: string | null; line_start: number | null; bundle_receipt_id: string | null }>)
      : [];
    const receiptsBySection = new Map<string, Map<string, { filePath: string | null; lineStart: number | null }>>();
    for (const r of receiptRows) {
      if (!r.bundle_receipt_id) continue;
      if (!receiptsBySection.has(r.section_id)) receiptsBySection.set(r.section_id, new Map());
      receiptsBySection.get(r.section_id)!.set(r.bundle_receipt_id, { filePath: r.file_path, lineStart: r.line_start });
    }

    const lines: string[] = [`# OnboardBuddy - Onboarding Package (${roleTitle(pkg.role)})\n`];
    let lastChapter: string | null = null;
    for (const sec of sections) {
      const chapter = SECTION_SPECS[sec.type as SectionType]?.chapter ?? null;
      if (chapter && chapter !== lastChapter) {
        lastChapter = chapter;
        lines.push(`# ${CHAPTERS[chapter].title}\n\n${CHAPTERS[chapter].blurb}\n`);
      }
      const body = inlineMarkersToText(sec.content, receiptsBySection.get(sec.id) ?? new Map());
      lines.push(`## ${sec.title}\n\n${body}\n`);
    }
    lines.push(`---\n\nGenerated by OnboardBuddy on ${new Date().toISOString().split("T")[0]}`);

    const markdown = lines.join("\n");

    res.setHeader("Content-Type", "text/markdown");
    res.setHeader("Content-Disposition", `attachment; filename="onboarding-${pkg.role}.md"`);
    res.send(markdown);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

onboardingRouter.patch("/sections/:sectionId/review", requireProjectAccess("owner", "admin"), requireUuidParam("sectionId"), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const projectId = String(req.params.id);
    const { review_status } = req.body as { review_status: string };

    if (!["approved", "draft"].includes(review_status)) {
      res.status(400).json({ error: "review_status must be 'approved' or 'draft'" });
      return;
    }

    const userId = req.user?.id;

    // The project filter lives in the UPDATE itself rather than in a check
    // before it, so there is no window in which the row could be written
    // outside the tenant the caller was authorized for. Without the
    // `onboarding_packages` join this approved (or un-approved) another
    // team's sections and flipped their package status — the one cross-tenant
    // WRITE of #65.
    const updateResult = await query(
      `UPDATE package_sections ps
       SET review_status = $1, reviewed_at = NOW(), reviewed_by = $2
       FROM onboarding_packages op
       WHERE op.id = ps.package_id
         AND ps.id = $3
         AND op.project_id = $4
       RETURNING ps.*`,
      [review_status, userId, sectionId, projectId],
    );

    if (updateResult.rows.length === 0) {
      res.status(404).json({ error: "Section not found" });
      return;
    }

    const updatedSection = updateResult.rows[0] as { package_id: string };

    const pendingResult = await query(
      `SELECT COUNT(*) AS count
       FROM package_sections
       WHERE package_id = $1 AND review_status <> 'approved'`,
      [updatedSection.package_id],
    );

    const allApproved = Number((pendingResult.rows[0] as { count: string }).count) === 0;

    await query(
      `UPDATE onboarding_packages SET status = $1 WHERE id = $2`,
      [allApproved ? "approved" : "draft", updatedSection.package_id],
    );

    res.json({ section: updateResult.rows[0] });
  } catch (err) {
    console.error("Review PATCH error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
