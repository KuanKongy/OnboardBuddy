import { Router } from "express";
import { pool, query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";

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
    const { repo_owner, repo_name, branch, default_developer_role } = req.body as {
      repo_owner: string;
      repo_name: string;
      branch: string;
      default_developer_role?: string;
    };

    if (!repo_owner || !repo_name || !branch) {
      res.status(400).json({ error: "repo_owner, repo_name, and branch are required" });
      return;
    }

    const role = default_developer_role ?? "general";

    await client.query("BEGIN");

    const projectResult = await client.query(
      `INSERT INTO projects (user_id, repo_owner, repo_name, branch)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, repo_owner, repo_name, branch],
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

projectsRouter.post("/:id/analyze", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user!.id;

    const projectResult = await query(
      `SELECT id, branch FROM projects WHERE id = $1`,
      [projectId],
    );
    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const project = projectResult.rows[0] as { id: string; branch: string };

    await query(
      `UPDATE projects SET status = 'analyzing' WHERE id = $1`,
      [projectId],
    );

    const jobResult = await query(
      `INSERT INTO analysis_jobs (project_id, requested_by, job_type, status, current_step)
       VALUES ($1, $2, 'analyze_project', 'queued', 'Waiting for worker')
       RETURNING id, status, job_type`,
      [projectId, userId],
    );

    res.status(202).json({
      analysis: {
        id: jobResult.rows[0].id,
        status: jobResult.rows[0].status,
        mode: "initial",
        branch: project.branch,
      },
    });
  } catch (err) {
    console.error("Start analysis error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
