import { Router } from "express";
import { query } from "../../lib/db.js";
import { getSummaryQueue, type SummaryJobData } from "../../lib/queue.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { BadPackageParamError, readPackageParam, resolveForRequest } from "../services/packageResolver.js";

export const onboardingRouter = Router({ mergeParams: true });

/**
 * Regenerate one section (doc/Pipeline.md "Regeneration"): rebuilds the
 * section's bundle against the same snapshot — or the latest complete
 * snapshot of the scope when regenerating a stale section — regenerates,
 * revalidates, and replaces the content in the same package; old
 * generation runs stay for audit.
 */
onboardingRouter.post("/sections/:sectionId/regenerate", requireProjectAccess("owner", "admin"), async (req, res) => {
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
        `SELECT id FROM analysis_snapshots
         WHERE scope_id = $1 AND status = 'complete'
         ORDER BY created_at DESC LIMIT 1`,
        [section.scope_id],
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

    await getSummaryQueue().add("regenerate_section", {
      jobId,
      snapshotId: targetSnapshotId,
      projectId,
      triggeredBy: userId,
      role: section.role ?? "general",
      sectionType: section.type,
      packageId: section.package_id,
    } satisfies SummaryJobData, {
      attempts: 2,
      backoff: { type: "fixed", delay: 3000 },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
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
 */
onboardingRouter.post("/generate", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = String(req.params.id);
    const userId = req.user!.id;
    const body = (req.body ?? {}) as { role?: string; package_id?: string; snapshot_id?: string; branch?: string };
    const role = body.role;
    if (!role || !["backend", "frontend", "devops", "qa", "general"].includes(role)) {
      res.status(400).json({ error: "role must be one of backend/frontend/devops/qa/general" });
      return;
    }

    // Target context: an explicit package (generate another role for the
    // same scope/commit/branch) > an explicit snapshot > the latest complete
    // snapshot. Branch defaults to the context's branch.
    let snapshot: { id: string; scope_id: string | null; commit_hash: string | null; branch: string | null } | undefined;
    let branch = typeof body.branch === "string" && body.branch !== "" ? body.branch : null;
    try {
      const packageId = readPackageParam(body.package_id);
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

    if (!snapshot) {
      snapshot = (await query(
        `SELECT id, scope_id, commit_hash, branch FROM analysis_snapshots
         WHERE project_id = $1 AND status = 'complete'
         ORDER BY created_at DESC LIMIT 1`,
        [projectId],
      )).rows[0] as typeof snapshot;
    }
    if (!snapshot) {
      res.status(404).json({ error: "No completed analysis — run an analysis first" });
      return;
    }
    branch = branch ?? snapshot.branch;
    // The worker reads the project's CURRENT privacy mode: ai_disabled
    // yields a deterministic package, the other modes an AI-narrated one.

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

    const jobId = ((await query(
      `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, role, status, current_step, branch, commit_hash, scope_id)
       VALUES ($1, $2, $3, 'generate_package', $4, 'queued', 'Waiting for worker', $5, $6, $7)
       RETURNING id`,
      [projectId, snapshot.id, userId, role, branch, snapshot.commit_hash, snapshot.scope_id],
    )).rows[0] as { id: string }).id;

    await getSummaryQueue().add(`generate_summary_${role}`, {
      jobId,
      snapshotId: snapshot.id,
      projectId,
      triggeredBy: userId,
      role,
      branch: branch ?? undefined,
    } satisfies SummaryJobData, {
      attempts: 2,
      backoff: { type: "fixed", delay: 3000 },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    });

    res.status(202).json({ job: { id: jobId, status: "queued", role } });
  } catch (err) {
    console.error("On-demand generate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
              (SELECT count(*)::int FROM package_sections ps WHERE ps.package_id = op.id) AS section_count,
              (SELECT count(*)::int FROM package_sections ps
                WHERE ps.package_id = op.id AND ps.review_status = 'stale') AS stale_sections,
              (SELECT count(*)::int FROM package_sections ps
                WHERE ps.package_id = op.id AND ps.review_status = 'approved') AS approved_sections,
              (SELECT count(*)::int FROM package_sections ps
                WHERE ps.package_id = op.id AND ps.confidence = 'low') AS low_confidence_sections,
              (SELECT count(*)::int FROM tutorials t WHERE t.package_id = op.id) AS tutorial_count,
              (op.analyzed_commit = COALESCE(
                (SELECT aj.commit_hash FROM analysis_jobs aj
                 WHERE aj.project_id = op.project_id AND aj.scope_id = op.scope_id
                   AND aj.branch = op.branch AND aj.commit_hash IS NOT NULL
                   AND aj.status = 'complete'
                   AND aj.job_type IN ('analyze_scope', 'incremental_update')
                 ORDER BY aj.created_at DESC LIMIT 1),
                (SELECT s2.commit_hash FROM analysis_snapshots s2
                 WHERE s2.scope_id = op.scope_id AND s2.status = 'complete'
                 ORDER BY s2.created_at DESC LIMIT 1)
              )) AS is_latest_commit
       FROM onboarding_packages op
       JOIN analysis_scopes sc ON sc.id = op.scope_id
       JOIN analysis_snapshots s ON s.id = op.snapshot_id
       WHERE op.project_id = $1
       ORDER BY op.updated_at DESC`,
      [projectId],
    )).rows;
    res.json({ packages: rows });
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

    const sections = await Promise.all(
      (sectionsResult.rows as SectionRow[]).map(async (sec) => {
        // symbol_summary: the semantic record's rendered summary for the
        // cited symbol (falls back to its JSDoc) — a receipt should say what
        // the code DOES, not just show the snippet.
        const receiptsResult = await query(
          `SELECT sr.id, sr.file_path, sr.symbol_name, sr.line_start, sr.line_end,
                  sr.snippet, sr.confidence, sr.commit_hash, sr.node_stable_key,
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
           FROM source_receipts sr WHERE sr.section_id = $1`,
          [sec.id],
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
            // Human-readable reviewer (email) — raw UUIDs are meaningless in the UI.
            reviewedBy: sec.reviewed_by_email ?? sec.reviewed_by,
            reviewedAt: sec.reviewed_at,
            diagrams: sec.diagrams ?? [],
            unknowns: sec.unknowns ?? [],
            analyzedCommit: sec.analyzed_commit,
            blocks: [
              {
                title: sec.title,
                body: sec.content,
                receipts: sec.receipts.map((r: Record<string, unknown>) => ({
                  filePath: r.file_path as string,
                  symbolName: r.symbol_name as string | null,
                  lineStart: r.line_start as number | null,
                  lineEnd: r.line_end as number | null,
                  snippet: r.snippet as string | null,
                  summary: (r.symbol_summary as string | null) ?? null,
                  confidence: (r.confidence as string) ?? "medium",
                  staleness: "current",
                  ageLabel: "recent",
                })),
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

onboardingRouter.get("/sections/:sectionId/receipts", requireProjectAccess(), async (req, res) => {
  try {
    const { sectionId } = req.params;

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

    const sectionsResult = await query(
      `SELECT title, content
       FROM package_sections
       WHERE package_id = $1
       ORDER BY created_at ASC`,
      [pkg.id],
    );

    const sections = sectionsResult.rows as { title: string; content: string }[];

    const lines: string[] = [`# OnboardBuddy - Onboarding Package (${pkg.role})\n`];
    for (const sec of sections) {
      lines.push(`## ${sec.title}\n\n${sec.content}\n`);
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

onboardingRouter.patch("/sections/:sectionId/review", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { review_status } = req.body as { review_status: string };

    if (!["approved", "draft"].includes(review_status)) {
      res.status(400).json({ error: "review_status must be 'approved' or 'draft'" });
      return;
    }

    const userId = req.user?.id;

    const updateResult = await query(
      `UPDATE package_sections
       SET review_status = $1, reviewed_at = NOW(), reviewed_by = $2
       WHERE id = $3
       RETURNING *`,
      [review_status, userId, sectionId],
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
