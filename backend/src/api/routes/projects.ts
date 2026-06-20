import { Router } from "express";
import { pool, query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { getAnalysisQueue, getSummaryQueue } from "../../lib/queue.js";
import type { AnalysisJobData, SummaryJobData } from "../../lib/queue.js";
import { userCanAccessInstallation } from "../../lib/github-connection.js";

export const projectsRouter = Router();

projectsRouter.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT p.id, p.repo_owner, p.repo_name, p.branch, p.status,
              p.created_at, p.last_analyzed_at,
              pm.permission_tier, pm.developer_role,
              COALESCE(stale.stale_count, 0) AS stale_count
       FROM projects p
       INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS stale_count
         FROM stale_flags sf
         WHERE sf.snapshot_id = (
           SELECT s.id FROM analysis_snapshots s
           WHERE s.project_id = p.id
           ORDER BY s.created_at DESC LIMIT 1
         )
       ) stale ON true
       ORDER BY p.created_at DESC`,
      [userId],
    );

    res.json({ projects: result.rows });
  } catch (err) {
    console.error("List projects error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user!.id;
    const { repo_owner, repo_name, branch, github_installation_id, default_developer_role } = req.body as {
      repo_owner: string;
      repo_name: string;
      branch: string;
      github_installation_id?: string;
      default_developer_role?: string;
    };

    if (!repo_owner || !repo_name || !branch || !github_installation_id) {
      res.status(400).json({ error: "repo_owner, repo_name, branch, and github_installation_id are required" });
      return;
    }

    const role = default_developer_role ?? "general";
    const installationId = Number(github_installation_id);
    if (!installationId || Number.isNaN(installationId)) {
      res.status(400).json({ error: "github_installation_id must be a valid installation ID" });
      return;
    }

    const allowedInstallation = await userCanAccessInstallation(userId, installationId);
    if (!allowedInstallation) {
      res.status(403).json({ error: "You do not have access to this GitHub installation" });
      return;
    }

    await client.query("BEGIN");

    // Ensure public.users row exists (handles users created before trigger was set up)
    await client.query(
      `INSERT INTO public.users (id, email)
       VALUES ($1, COALESCE((SELECT email FROM auth.users WHERE id = $1), ''))
       ON CONFLICT (id) DO NOTHING`,
      [userId],
    );

    const projectResult = await client.query(
      `INSERT INTO projects (user_id, repo_owner, repo_name, branch, github_installation_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, repo_owner, repo_name, branch, github_installation_id],
    );
    const project = projectResult.rows[0];

    await client.query(
      `INSERT INTO project_settings (project_id, default_developer_role)
       VALUES ($1, $2)`,
      [project.id, role],
    );

    await client.query(
      `INSERT INTO project_members (project_id, user_id, permission_tier, developer_role)
       VALUES ($1, $2, 'owner', $3)`,
      [project.id, userId, role],
    );

    await client.query("COMMIT");

    res.status(201).json({ project });
  } catch (err) {
    await client.query("ROLLBACK");
    if (
      err instanceof Error &&
      err.message.includes("duplicate key")
    ) {
      res.status(409).json({ error: "Project already exists for this repo/branch" });
      return;
    }
    console.error("Create project error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

projectsRouter.get("/:id", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const member = req.projectMember!;

    const result = await query(
      `SELECT p.*, row_to_json(ps.*) AS settings
       FROM projects p
       LEFT JOIN project_settings ps ON ps.project_id = p.id
       WHERE p.id = $1`,
      [projectId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const project = result.rows[0];
    res.json({
      project: {
        ...project,
        permission_tier: member.permission_tier,
        developer_role: member.developer_role,
      },
    });
  } catch (err) {
    console.error("Get project error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.put("/:id/settings", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { ignored_paths, ai_enabled, default_developer_role, file_limit, loc_limit } =
      req.body as {
        ignored_paths?: string[];
        ai_enabled?: boolean;
        default_developer_role?: string;
        file_limit?: number;
        loc_limit?: number;
      };

    const setClauses: string[] = [];
    const values: unknown[] = [projectId];
    let paramIndex = 2;

    if (ignored_paths !== undefined) {
      setClauses.push(`ignored_paths = $${paramIndex++}`);
      values.push(ignored_paths);
    }
    if (ai_enabled !== undefined) {
      setClauses.push(`ai_enabled = $${paramIndex++}`);
      values.push(ai_enabled);
    }
    if (default_developer_role !== undefined) {
      setClauses.push(`default_developer_role = $${paramIndex++}`);
      values.push(default_developer_role);
    }
    if (file_limit !== undefined) {
      setClauses.push(`file_limit = $${paramIndex++}`);
      values.push(file_limit);
    }
    if (loc_limit !== undefined) {
      setClauses.push(`loc_limit = $${paramIndex++}`);
      values.push(loc_limit);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: "No settings fields provided" });
      return;
    }

    const result = await query(
      `UPDATE project_settings SET ${setClauses.join(", ")} WHERE project_id = $1 RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Project settings not found" });
      return;
    }

    res.json({ settings: result.rows[0] });
  } catch (err) {
    console.error("Update settings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.delete("/:id", requireProjectAccess("owner"), async (req, res) => {
  try {
    const projectId = req.params.id;

    await query("DELETE FROM projects WHERE id = $1", [projectId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete project error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.post("/:id/summarize", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const userId = req.user!.id;

    const settingsResult = await query(
      `SELECT ai_enabled FROM project_settings WHERE project_id = $1`,
      [projectId],
    );
    if (settingsResult.rows.length > 0 && settingsResult.rows[0].ai_enabled === false) {
      res.status(403).json({ error: "AI features are disabled for this project" });
      return;
    }

    const snapResult = await query(
      `SELECT id, commit_hash FROM analysis_snapshots
       WHERE project_id = $1 AND status = 'complete'
       ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    );
    if (snapResult.rows.length === 0) {
      res.status(409).json({ error: "No completed analysis snapshot found — run analysis first" });
      return;
    }
    const snap = snapResult.rows[0] as { id: string; commit_hash: string };

    const jobResult = await query(
      `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, status, current_step)
       VALUES ($1, $2, $3, 'generate_onboarding', 'queued', 'Waiting for worker')
       RETURNING id`,
      [projectId, snap.id, userId],
    );
    const dbJobId: string = jobResult.rows[0].id;

    await getSummaryQueue().add('generate_summary', {
      jobId: dbJobId,
      snapshotId: snap.id,
      projectId,
      triggeredBy: userId,
    } satisfies SummaryJobData, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    });

    res.status(202).json({ jobId: dbJobId, snapshotId: snap.id });
  } catch (err) {
    console.error("Summarize error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.get("/:id/summary", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    const result = await query(
      `SELECT op.id AS package_id, op.role, op.status AS package_status,
              op.analyzed_commit, op.created_at,
              json_agg(
                json_build_object(
                  'id', ps.id,
                  'type', ps.type,
                  'title', ps.title,
                  'content', ps.content,
                  'confidence', ps.confidence,
                  'review_status', ps.review_status
                ) ORDER BY ps.created_at
              ) FILTER (WHERE ps.id IS NOT NULL) AS sections
       FROM onboarding_packages op
       LEFT JOIN package_sections ps ON ps.package_id = op.id
       WHERE op.project_id = $1
       GROUP BY op.id
       ORDER BY op.created_at DESC
       LIMIT 1`,
      [projectId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "No summary available yet" });
      return;
    }

    res.json({ summary: result.rows[0] });
  } catch (err) {
    console.error("Get summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.get("/:id/analysis-status", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    const jobResult = await query(
      `SELECT aj.id, aj.job_type, aj.status, aj.progress_pct, aj.current_step,
              aj.checkpoint, aj.step_log, aj.error_message, aj.created_at, aj.started_at, aj.finished_at,
              s.file_count, s.symbol_count, s.workflow_count, s.commit_hash
       FROM analysis_jobs aj
       LEFT JOIN analysis_snapshots s ON s.id = aj.snapshot_id
       WHERE aj.project_id = $1
       ORDER BY aj.created_at DESC
       LIMIT 5`,
      [projectId],
    );

    const latestSnapshot = await query(
      `SELECT id, file_count, symbol_count, workflow_count, commit_hash, created_at
       FROM analysis_snapshots
       WHERE project_id = $1 AND status = 'complete'
       ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    );

    res.json({
      jobs: jobResult.rows,
      latestSnapshot: latestSnapshot.rows[0] ?? null,
    });
  } catch (err) {
    console.error("Analysis status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.post("/:id/analyze", requireProjectAccess("owner", "admin"), async (req, res) => {
  const client = await pool.connect();
  try {
    const projectId = req.params.id as string;
    const userId = req.user!.id;

    await client.query("BEGIN");

    const projectResult = await client.query(
      `SELECT id, branch FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    if (projectResult.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const activeJob = await client.query(
      `SELECT id FROM analysis_jobs WHERE project_id = $1 AND status IN ('queued', 'running') LIMIT 1`,
      [projectId],
    );
    if (activeJob.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Analysis already in progress for this project" });
      return;
    }

    const project = projectResult.rows[0] as { id: string; branch: string };

    await client.query(
      `UPDATE projects SET status = 'analyzing' WHERE id = $1`,
      [projectId],
    );

    const jobResult = await client.query(
      `INSERT INTO analysis_jobs (project_id, requested_by, job_type, status, current_step)
       VALUES ($1, $2, 'analyze_project', 'queued', 'Waiting for worker')
       RETURNING id, status`,
      [projectId, userId],
    );

    await client.query("COMMIT");

    const dbJobId: string = jobResult.rows[0].id;

    await getAnalysisQueue().add('analyze_project', { jobId: dbJobId, projectId } satisfies AnalysisJobData, {
      jobId: dbJobId,
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
    });

    res.status(202).json({
      analysis: {
        id: dbJobId,
        status: jobResult.rows[0].status,
        mode: "initial",
        branch: project.branch,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Start analysis error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});
