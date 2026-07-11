import { Router } from "express";
import { query } from "../../lib/db.js";
import { getSummaryQueue, type SummaryJobData } from "../../lib/queue.js";
import { requireProjectAccess } from "../middleware/project-access.js";

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
      `SELECT ps.type, ps.snapshot_id, ps.role, ps.review_status, ps.package_id, op.scope_id
       FROM package_sections ps
       JOIN onboarding_packages op ON op.id = ps.package_id
       WHERE ps.id = $1 AND op.project_id = $2`,
      [sectionId, projectId],
    );
    const section = sectionResult.rows[0] as
      | { type: string; snapshot_id: string; role: string | null; review_status: string;
          package_id: string; scope_id: string }
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

    const settingsResult = await query(
      `SELECT privacy_mode FROM project_settings WHERE project_id = $1`,
      [projectId],
    );
    if (settingsResult.rows[0]?.privacy_mode === "ai_disabled") {
      res.status(403).json({ error: "AI features are disabled for this project" });
      return;
    }

    await query(
      `UPDATE package_sections SET review_status = 'regenerate_requested' WHERE id = $1`,
      [sectionId],
    );
    const jobId = ((await query(
      `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, role, status, current_step)
       VALUES ($1, $2, $3, 'regenerate_section', $4, 'queued', 'Waiting for worker')
       RETURNING id`,
      [projectId, targetSnapshotId, userId, section.role ?? "general"],
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

onboardingRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const role = (req.query.role as string) ?? req.projectMember?.developer_role ?? "general";

    const pkgResult = await query(
      `SELECT op.id, op.snapshot_id, op.role, op.status, op.analyzed_commit,
              op.created_at, op.updated_at
       FROM onboarding_packages op
       WHERE op.project_id = $1 AND op.role = $2
       ORDER BY op.created_at DESC LIMIT 1`,
      [projectId, role],
    );

    if (pkgResult.rows.length === 0) {
      res.json({ package: { status: "missing", role, sections: [] } });
      return;
    }

    const pkg = pkgResult.rows[0] as {
      id: string;
      snapshot_id: string;
      role: string;
      status: string;
      analyzed_commit: string;
      created_at: string;
      updated_at: string;
    };

    const sectionsResult = await query(
      `SELECT ps.id, ps.type, ps.title, ps.content, ps.confidence,
              ps.review_status, ps.analyzed_commit, ps.reviewed_at, ps.reviewed_by,
              ps.generation_context
       FROM package_sections ps
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
      generation_context: Record<string, unknown>;
    };

    const sections = await Promise.all(
      (sectionsResult.rows as SectionRow[]).map(async (sec) => {
        const receiptsResult = await query(
          `SELECT sr.id, sr.file_path, sr.symbol_name, sr.line_start, sr.line_end,
                  sr.snippet, sr.confidence, sr.commit_hash, sr.node_stable_key
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
        role: pkg.role,
        status: pkg.status,
        analyzedCommit: pkg.analyzed_commit,
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
            reviewedBy: sec.reviewed_by,
            reviewedAt: sec.reviewed_at,
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
              gn.metadata AS node_metadata
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

    const pkgResult = await query(
      `SELECT id FROM onboarding_packages
       WHERE project_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    );

    if (pkgResult.rows.length === 0) {
      res.status(404).json({ error: "No onboarding package found" });
      return;
    }

    const { validateSectionCitations } = await import('../../worker/engine/sectionValidator.js');
    const results = await validateSectionCitations(pkgResult.rows[0].id as string);

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

    const pkgResult = await query(
      `SELECT id, role
       FROM onboarding_packages
       WHERE project_id = $1 AND role = $2
       ORDER BY created_at DESC LIMIT 1`,
      [projectId, role],
    );

    if (pkgResult.rows.length === 0) {
      res.status(404).json({ error: "No onboarding package found for this role" });
      return;
    }

    const pkg = pkgResult.rows[0] as { id: string; role: string };

    const sectionsResult = await query(
      `SELECT title, content
       FROM package_sections
       WHERE package_id = $1
       ORDER BY created_at ASC`,
      [pkg.id],
    );

    const sections = sectionsResult.rows as { title: string; content: string }[];

    const lines: string[] = [`# OnboardBuddy - Onboarding Package (${role})\n`];
    for (const sec of sections) {
      lines.push(`## ${sec.title}\n\n${sec.content}\n`);
    }
    lines.push(`---\n\nGenerated by OnboardBuddy on ${new Date().toISOString().split("T")[0]}`);

    const markdown = lines.join("\n");

    res.setHeader("Content-Type", "text/markdown");
    res.setHeader("Content-Disposition", `attachment; filename="onboarding-${role}.md"`);
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
