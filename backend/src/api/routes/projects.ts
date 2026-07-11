import { Router } from "express";
import type { PoolClient } from "pg";
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
  let client: PoolClient | undefined;
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

    client = await pool.connect();

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
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
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
    client?.release();
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
    const {
      ignored_paths, privacy_mode, analysis_depth, default_developer_role, file_limit, loc_limit,
      budget_overrides, budget_stop_behavior, model_failure_behavior, model_tier_overrides,
    } = req.body as {
        ignored_paths?: string[];
        privacy_mode?: string;
        analysis_depth?: string;
        default_developer_role?: string;
        file_limit?: number;
        loc_limit?: number;
        budget_overrides?: Record<string, unknown>;
        budget_stop_behavior?: string;
        model_failure_behavior?: Record<string, unknown>;
        model_tier_overrides?: Record<string, unknown>;
      };

    if (privacy_mode !== undefined && !['full_ai', 'facts_only_ai', 'ai_disabled'].includes(privacy_mode)) {
      res.status(400).json({ error: "Invalid privacy_mode" });
      return;
    }
    if (analysis_depth !== undefined && !['cheap', 'standard', 'full'].includes(analysis_depth)) {
      res.status(400).json({ error: "Invalid analysis_depth" });
      return;
    }
    if (budget_stop_behavior !== undefined && !['fail', 'pause', 'degrade'].includes(budget_stop_behavior)) {
      res.status(400).json({ error: "Invalid budget_stop_behavior" });
      return;
    }
    const BUDGET_KEYS = ['max_files', 'max_symbols_to_llm', 'max_llm_calls', 'max_input_tokens', 'max_runtime_ms'];
    if (budget_overrides !== undefined) {
      const invalid = budget_overrides === null || typeof budget_overrides !== 'object' || Array.isArray(budget_overrides) ||
        Object.entries(budget_overrides).some(
          ([k, v]) => !BUDGET_KEYS.includes(k) || typeof v !== 'number' || !Number.isFinite(v) || v <= 0,
        );
      if (invalid) {
        res.status(400).json({ error: `budget_overrides must map ${BUDGET_KEYS.join('/')} to positive numbers` });
        return;
      }
    }
    const TIERS = ['cheap', 'strong', 'embedding'];
    if (model_failure_behavior !== undefined) {
      const BEHAVIORS = ['retry', 'degrade', 'pause', 'fail'];
      const invalid = model_failure_behavior === null || typeof model_failure_behavior !== 'object' || Array.isArray(model_failure_behavior) ||
        Object.entries(model_failure_behavior).some(
          ([tier, list]) => !TIERS.includes(tier) || !Array.isArray(list) || list.length === 0 ||
            list.some((b) => typeof b !== 'string' || !BEHAVIORS.includes(b)),
        );
      if (invalid) {
        res.status(400).json({ error: "model_failure_behavior must map tiers to lists of retry/degrade/pause/fail" });
        return;
      }
    }
    if (model_tier_overrides !== undefined) {
      const invalid = model_tier_overrides === null || typeof model_tier_overrides !== 'object' || Array.isArray(model_tier_overrides) ||
        Object.entries(model_tier_overrides).some(
          ([tier, list]) => !TIERS.includes(tier) || !Array.isArray(list) || list.length === 0 ||
            list.some((m) => typeof m !== 'string' || m.length === 0),
        );
      if (invalid) {
        res.status(400).json({ error: "model_tier_overrides must map tiers to non-empty model-name lists" });
        return;
      }
    }

    const setClauses: string[] = [];
    const values: unknown[] = [projectId];
    let paramIndex = 2;

    if (ignored_paths !== undefined) {
      setClauses.push(`ignored_paths = $${paramIndex++}`);
      values.push(ignored_paths);
    }
    if (privacy_mode !== undefined) {
      setClauses.push(`privacy_mode = $${paramIndex++}`);
      values.push(privacy_mode);
    }
    if (analysis_depth !== undefined) {
      setClauses.push(`analysis_depth = $${paramIndex++}`);
      values.push(analysis_depth);
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
    if (budget_overrides !== undefined) {
      setClauses.push(`budget_overrides = $${paramIndex++}`);
      values.push(JSON.stringify(budget_overrides));
    }
    if (budget_stop_behavior !== undefined) {
      setClauses.push(`budget_stop_behavior = $${paramIndex++}`);
      values.push(budget_stop_behavior);
    }
    if (model_failure_behavior !== undefined) {
      setClauses.push(`model_failure_behavior = $${paramIndex++}`);
      values.push(JSON.stringify(model_failure_behavior));
    }
    if (model_tier_overrides !== undefined) {
      setClauses.push(`model_tier_overrides = $${paramIndex++}`);
      values.push(JSON.stringify(model_tier_overrides));
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

/**
 * Internal observability endpoint (doc/Pipeline.md "Observability"):
 * per-phase metrics + checkpoints, live budget counters, and per-model
 * LLM call/token/cost aggregates from ai_generation_runs.
 */
projectsRouter.get("/:id/snapshots/:snapshotId/metrics", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const snapshotId = req.params.snapshotId;

    const snapResult = await query(
      `SELECT id, status, semantic_depth, privacy_mode, budget_usage, unknowns,
              file_count, symbol_count, workflow_count, commit_hash, branch, created_at
       FROM analysis_snapshots WHERE id = $1 AND project_id = $2`,
      [snapshotId, projectId],
    );
    if (snapResult.rows.length === 0) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }

    const [phasesResult, llmResult] = await Promise.all([
      query(
        `SELECT phase, status, started_at, finished_at, error_message, metrics, checkpoint
         FROM snapshot_phases WHERE snapshot_id = $1 ORDER BY started_at NULLS LAST`,
        [snapshotId],
      ),
      query(
        `SELECT model, model_tier, status,
                COUNT(*)::int AS calls,
                COALESCE(SUM((token_usage->>'inputTokens')::bigint), 0)::bigint AS input_tokens,
                COALESCE(SUM((token_usage->>'outputTokens')::bigint), 0)::bigint AS output_tokens,
                COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd,
                COALESCE(AVG(latency_ms), 0)::int AS avg_latency_ms
         FROM ai_generation_runs WHERE snapshot_id = $1
         GROUP BY model, model_tier, status
         ORDER BY model_tier, model, status`,
        [snapshotId],
      ),
    ]);

    res.json({
      snapshot: snapResult.rows[0],
      phases: phasesResult.rows,
      llm: llmResult.rows,
    });
  } catch (err) {
    console.error("Snapshot metrics error:", err);
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
      `SELECT privacy_mode FROM project_settings WHERE project_id = $1`,
      [projectId],
    );
    if (settingsResult.rows.length > 0 && settingsResult.rows[0].privacy_mode === 'ai_disabled') {
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
       VALUES ($1, $2, $3, 'generate_package', 'queued', 'Waiting for worker')
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

// Snapshot list for scope/commit selection: which (scope, commit) pairs have
// been analyzed, newest first.
projectsRouter.get("/:id/snapshots", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const result = await query(
      `SELECT s.id, s.commit_hash, s.branch, s.status, s.trigger_type, s.semantic_depth,
              s.privacy_mode, s.file_count, s.symbol_count, s.workflow_count, s.created_at,
              sc.id AS scope_id, sc.display_name AS scope_name, sc.path_prefix
       FROM analysis_snapshots s
       JOIN analysis_scopes sc ON sc.id = s.scope_id
       WHERE s.project_id = $1
       ORDER BY s.created_at DESC
       LIMIT 30`,
      [projectId],
    );
    res.json({ snapshots: result.rows });
  } catch (err) {
    console.error("List snapshots error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Per-role ranking weights (doc/PLAN.md "Configurable weights"): effective
// weights per role (project override or default), editable with a
// revert-to-default. Re-weighting is a projection — no re-analysis needed.
projectsRouter.get("/:id/ranking-weights", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { DEFAULT_ROLE_WEIGHTS, SEMANTIC_VIEWS } = await import('../../worker/semantic/projections.js');
    const overrides = (await query(
      `SELECT role, weights FROM ranking_weight_configs WHERE project_id = $1`,
      [projectId],
    )).rows as Array<{ role: string; weights: Record<string, number> }>;
    const overrideByRole = new Map(overrides.map((o) => [o.role, o.weights]));
    const roles = Object.entries(DEFAULT_ROLE_WEIGHTS).map(([role, defaults]) => ({
      role,
      defaults,
      weights: { ...defaults, ...(overrideByRole.get(role) ?? {}) },
      customized: overrideByRole.has(role),
    }));
    res.json({ views: SEMANTIC_VIEWS, roles });
  } catch (err) {
    console.error("Ranking weights GET error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.put("/:id/ranking-weights/:role", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const role = req.params.role as string;
    const { DEFAULT_ROLE_WEIGHTS, SEMANTIC_VIEWS } = await import('../../worker/semantic/projections.js');
    if (!(role in DEFAULT_ROLE_WEIGHTS)) {
      res.status(400).json({ error: "Unknown role" });
      return;
    }
    const { weights } = (req.body ?? {}) as { weights?: Record<string, number> };
    const valid = weights && typeof weights === 'object' && !Array.isArray(weights) &&
      Object.entries(weights).every(([k, v]) =>
        (SEMANTIC_VIEWS as string[]).includes(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);
    if (!valid) {
      res.status(400).json({ error: `weights must map ${SEMANTIC_VIEWS.join('/')} to numbers in [0, 1]` });
      return;
    }
    const result = await query(
      `INSERT INTO ranking_weight_configs (project_id, role, weights, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, role) DO UPDATE
         SET weights = EXCLUDED.weights, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING role, weights`,
      [projectId, role, JSON.stringify(weights), req.user!.id],
    );
    res.json({ config: result.rows[0] });
  } catch (err) {
    console.error("Ranking weights PUT error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.delete("/:id/ranking-weights/:role", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    await query(
      `DELETE FROM ranking_weight_configs WHERE project_id = $1 AND role = $2`,
      [req.params.id, req.params.role],
    );
    res.json({ reverted: true });
  } catch (err) {
    console.error("Ranking weights DELETE error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.get("/:id/scopes", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const result = await query(
      `SELECT id, path_prefix, display_name, kind, detected_from, created_at
       FROM analysis_scopes WHERE project_id = $1
       ORDER BY (path_prefix = '') DESC, path_prefix`,
      [projectId],
    );
    res.json({ scopes: result.rows });
  } catch (err) {
    console.error("List scopes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Preflight: builds the analysis preview (inventory, estimates, cost tier,
// privacy summary) without mutating any snapshot. The preview lands on the
// job's checkpoint, returned by /analysis-status.
projectsRouter.post("/:id/preflight", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const userId = req.user!.id;
    const { scope_id } = (req.body ?? {}) as { scope_id?: string };

    if (scope_id) {
      const scopeCheck = await query(
        `SELECT id FROM analysis_scopes WHERE id = $1 AND project_id = $2`,
        [scope_id, projectId],
      );
      if (scopeCheck.rows.length === 0) {
        res.status(404).json({ error: "Scope not found" });
        return;
      }
    }

    const jobResult = await query(
      `INSERT INTO analysis_jobs (project_id, scope_id, requested_by, job_type, status, current_step)
       VALUES ($1, $2, $3, 'preflight', 'queued', 'Waiting for worker')
       RETURNING id, status`,
      [projectId, scope_id ?? null, userId],
    );
    const dbJobId: string = jobResult.rows[0].id;

    await getAnalysisQueue().add('preflight', {
      jobId: dbJobId,
      projectId,
      task: 'preflight',
      scopeId: scope_id,
    } satisfies AnalysisJobData, {
      jobId: dbJobId,
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
    });

    res.status(202).json({ preflight: { id: dbJobId, status: jobResult.rows[0].status } });
  } catch (err) {
    console.error("Preflight error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.post("/:id/analyze", requireProjectAccess("owner", "admin"), async (req, res) => {
  const client = await pool.connect();
  try {
    const projectId = req.params.id as string;
    const userId = req.user!.id;
    const { scope_id, commit } = (req.body ?? {}) as { scope_id?: string; commit?: string };
    if (commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(commit)) {
      res.status(400).json({ error: "commit must be a git SHA (7-40 hex characters)" });
      return;
    }

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

    if (scope_id) {
      const scopeCheck = await client.query(
        `SELECT id FROM analysis_scopes WHERE id = $1 AND project_id = $2`,
        [scope_id, projectId],
      );
      if (scopeCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Scope not found" });
        return;
      }
    }

    // Re-analyzing an already-analyzed scope is an incremental update (spec
    // job type): the worker diffs against the previous snapshot and flags
    // stale artifacts instead of regenerating everything.
    const previousSnapshot = await client.query(
      scope_id
        ? `SELECT 1 FROM analysis_snapshots WHERE project_id = $1 AND scope_id = $2 AND status = 'complete' LIMIT 1`
        : `SELECT 1 FROM analysis_snapshots s
           JOIN analysis_scopes sc ON sc.id = s.scope_id
           WHERE s.project_id = $1 AND sc.path_prefix = '' AND s.status = 'complete' LIMIT 1`,
      scope_id ? [projectId, scope_id] : [projectId],
    );
    const jobType = previousSnapshot.rows.length > 0 ? 'incremental_update' : 'analyze_scope';

    const jobResult = await client.query(
      `INSERT INTO analysis_jobs (project_id, scope_id, requested_by, job_type, status, current_step)
       VALUES ($1, $2, $3, $4, 'queued', 'Waiting for worker')
       RETURNING id, status`,
      [projectId, scope_id ?? null, userId, jobType],
    );

    await client.query("COMMIT");

    const dbJobId: string = jobResult.rows[0].id;

    await getAnalysisQueue().add('analyze_scope', {
      jobId: dbJobId,
      projectId,
      scopeId: scope_id,
      commit,
    } satisfies AnalysisJobData, {
      jobId: dbJobId,
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
    });

    res.status(202).json({
      analysis: {
        id: dbJobId,
        status: jobResult.rows[0].status,
        mode: jobType === 'incremental_update' ? "incremental" : "initial",
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
