import { Router } from "express";
import type { PoolClient } from "pg";
import { pool, query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { getAnalysisQueue, getSummaryQueue } from "../../lib/queue.js";
import type { AnalysisJobData, SummaryJobData } from "../../lib/queue.js";
import { getInstallationTokenForUser, userCanAccessInstallation } from "../../lib/github-connection.js";
import { getRepo, isValidGitRef } from "../../lib/github.js";
import { recomputeProjectStatus } from "../../lib/projectStatus.js";
import { latestSnapshotOrderSql } from "../../lib/snapshotOrdering.js";
import { enqueueAnalysisRun, prepareAnalysisRun } from "../services/analysisStarter.js";
import { summarizeRunBudget } from "../../worker/ai/budgetEnforcer.js";

const VALID_DEPTHS = ["cheap", "standard", "full"] as const;
const VALID_ROLES = ["backend", "frontend", "devops", "qa", "general"] as const;

/** "backend/", "/backend" → "backend"; "" stays "" (whole repo). */
function normalizeScopePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

export const projectsRouter = Router();

projectsRouter.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT p.id, p.repo_owner, p.repo_name, p.branch, p.status,
              p.created_at, p.last_analyzed_at,
              p.repo_description, p.primary_language, p.repo_pushed_at,
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
           ORDER BY ${latestSnapshotOrderSql('s', 'p.branch')} LIMIT 1
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

/**
 * Cross-project activity feed for the dashboard: every analysis run and every
 * onboarding package across the caller's projects, newest first. Generation
 * runs are represented by their package row (a generate_package job always
 * creates one), so the jobs query keeps only repo-analysis work — no event
 * shows up twice. Registered before /:id so "activity" never parses as an id.
 */
projectsRouter.get("/activity", async (req, res) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50);

    const [runs, packages] = await Promise.all([
      query(
        `SELECT aj.id, aj.project_id, p.repo_owner, p.repo_name,
                aj.status, aj.job_type, aj.branch, aj.role,
                COALESCE(s.display_name, NULLIF(s.path_prefix, ''), 'Whole repository') AS scope,
                COALESCE(aj.finished_at, aj.started_at, aj.created_at) AS at
         FROM analysis_jobs aj
         JOIN projects p ON p.id = aj.project_id
         JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
         LEFT JOIN analysis_scopes s ON s.id = aj.scope_id
         WHERE aj.job_type IN ('analyze_scope', 'incremental_update')
         ORDER BY COALESCE(aj.finished_at, aj.started_at, aj.created_at) DESC
         LIMIT $2`,
        [userId, limit],
      ),
      query(
        `SELECT op.id, op.project_id, p.repo_owner, p.repo_name,
                op.status, op.role, op.branch,
                COALESCE(s.display_name, NULLIF(s.path_prefix, ''), 'Whole repository') AS scope,
                op.updated_at AS at
         FROM onboarding_packages op
         JOIN projects p ON p.id = op.project_id
         JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
         LEFT JOIN analysis_scopes s ON s.id = op.scope_id
         ORDER BY op.updated_at DESC
         LIMIT $2`,
        [userId, limit],
      ),
    ]);

    const eventTime = (row: Record<string, unknown>) => new Date(row.at as string | Date).getTime();
    const activity = [
      ...(runs.rows as Array<Record<string, unknown>>).map((row) => ({ kind: "analysis", ...row })),
      ...(packages.rows as Array<Record<string, unknown>>).map((row) => ({ kind: "package", ...row })),
    ]
      .sort((a, b) => eventTime(b) - eventTime(a))
      .slice(0, limit);

    res.json({ activity });
  } catch (err) {
    console.error("Activity feed error:", err);
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
      /** Optional: default branch for new runs. Omitted = the repo's default branch. */
      branch?: string;
      github_installation_id?: string;
      default_developer_role?: string;
    };

    if (!repo_owner || !repo_name || !github_installation_id) {
      res.status(400).json({ error: "repo_owner, repo_name, and github_installation_id are required" });
      return;
    }

    // Stored as the project's default branch and reused by every later run —
    // so an invalid ref here would be replayed into GitHub API paths forever
    // (doc/SECURITY_XSS_PROMPT_INJECTION.md finding P4).
    if (branch !== undefined && branch !== null && branch !== "" && !isValidGitRef(branch)) {
      res.status(400).json({ error: "branch must be a valid git ref" });
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

    // Branch is only the default for new analysis runs (project identity is the
    // repo). When omitted, use the repo's default branch from GitHub. The same
    // fetch supplies the card metadata (description/language/pushed_at) — that
    // part is best-effort: only a missing branch makes the fetch load-bearing.
    let defaultBranch = branch;
    let repoDefaultBranch: string | null = null;
    let repoDescription: string | null = null;
    let primaryLanguage: string | null = null;
    let repoPushedAt: string | null = null;
    try {
      const installationToken = await getInstallationTokenForUser(userId, installationId);
      const repoInfo = await getRepo(installationToken, repo_owner, repo_name);
      repoDefaultBranch = repoInfo.default_branch;
      defaultBranch ??= repoInfo.default_branch;
      repoDescription = repoInfo.description?.slice(0, 350) ?? null;
      primaryLanguage = repoInfo.language ?? null;
      repoPushedAt = repoInfo.pushed_at ?? null;
    } catch (err) {
      if (!defaultBranch) throw err;
      console.warn("Repo metadata fetch failed (project created without it):", err instanceof Error ? err.message : err);
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
      `INSERT INTO projects (user_id, repo_owner, repo_name, branch, default_branch, github_installation_id,
                             repo_description, primary_language, repo_pushed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, repo_owner, repo_name, defaultBranch, repoDefaultBranch, github_installation_id,
       repoDescription, primaryLanguage, repoPushedAt],
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
      res.status(409).json({ error: "Project already exists for this repo" });
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
        // Per-member: the caller's own default package (sidebar selection).
        default_package_id: member.default_package_id,
      },
    });
  } catch (err) {
    console.error("Get project error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Set the CALLER's default package — the one their sidebar selection starts
 * on. Per member, not per project: each developer pins their own context.
 * null clears it back to "latest analysis".
 */
projectsRouter.put("/:id/default-package", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const userId = req.user!.id;
    const { package_id } = (req.body ?? {}) as { package_id?: string | null };

    if (package_id !== null && package_id !== undefined) {
      if (typeof package_id !== "string" || !/^[0-9a-f-]{36}$/i.test(package_id)) {
        res.status(400).json({ error: "package_id must be a UUID or null" });
        return;
      }
      const pkg = await query(
        `SELECT id FROM onboarding_packages WHERE id = $1 AND project_id = $2`,
        [package_id, projectId],
      );
      if (pkg.rows.length === 0) {
        res.status(404).json({ error: "Package not found" });
        return;
      }
    }

    await query(
      `UPDATE project_members SET default_package_id = $3 WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId, package_id ?? null],
    );
    res.json({ default_package_id: package_id ?? null });
  } catch (err) {
    console.error("Set default package error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.put("/:id/settings", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const {
      ignored_paths, privacy_mode, analysis_depth, default_developer_role, file_limit, loc_limit,
      budget_overrides, budget_stop_behavior, model_failure_behavior, model_tier_overrides,
      auto_reanalyze_on_push,
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
        auto_reanalyze_on_push?: boolean;
      };

    if (privacy_mode !== undefined && !['full_ai', 'facts_only_ai', 'ai_disabled'].includes(privacy_mode)) {
      res.status(400).json({ error: "Invalid privacy_mode" });
      return;
    }
    if (auto_reanalyze_on_push !== undefined && typeof auto_reanalyze_on_push !== 'boolean') {
      res.status(400).json({ error: "auto_reanalyze_on_push must be a boolean" });
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
    if (auto_reanalyze_on_push !== undefined) {
      setClauses.push(`auto_reanalyze_on_push = $${paramIndex++}`);
      values.push(auto_reanalyze_on_push);
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

    // ai_disabled does not block generation: the worker reads the project's
    // current privacy mode and builds a deterministic (LLM-free) package.
    const snapResult = await query(
      `SELECT id, commit_hash, branch, scope_id FROM analysis_snapshots s
       WHERE project_id = $1 AND status = 'complete'
       ORDER BY ${latestSnapshotOrderSql('s', '$2::varchar')} LIMIT 1`,
      [projectId, typeof req.body?.branch === "string" && req.body.branch !== "" ? req.body.branch : null],
    );
    if (snapResult.rows.length === 0) {
      res.status(409).json({ error: "No completed analysis snapshot found — run analysis first" });
      return;
    }
    const snap = snapResult.rows[0] as { id: string; commit_hash: string; branch: string | null; scope_id: string | null };

    // Same-package guard: only an identical (snapshot, default-role, branch)
    // generation conflicts; anything else runs in parallel.
    const active = await query(
      `SELECT id FROM analysis_jobs
       WHERE project_id = $1 AND job_type = 'generate_package' AND snapshot_id = $2
         AND role IS NULL AND COALESCE(branch, '') = COALESCE($3, '')
         AND status IN ('queued', 'running')
       LIMIT 1`,
      [projectId, snap.id, snap.branch],
    );
    if (active.rows.length > 0) {
      res.status(409).json({ error: "This package is already being generated", active_job_id: active.rows[0].id });
      return;
    }

    const jobResult = await query(
      `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, status, current_step, branch, commit_hash, scope_id)
       VALUES ($1, $2, $3, 'generate_package', 'queued', 'Waiting for worker', $4, $5, $6)
       RETURNING id`,
      [projectId, snap.id, userId, snap.branch, snap.commit_hash, snap.scope_id],
    );
    const dbJobId: string = jobResult.rows[0].id;

    await getSummaryQueue().add('generate_summary', {
      jobId: dbJobId,
      snapshotId: snap.id,
      projectId,
      triggeredBy: userId,
      branch: snap.branch ?? undefined,
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
      `SELECT aj.id, aj.job_type, aj.status, aj.progress_pct, aj.current_step, aj.snapshot_id,
              aj.checkpoint, aj.step_log, aj.error_message, aj.created_at, aj.started_at, aj.finished_at,
              aj.last_heartbeat_at, aj.attempt,
              (aj.status = 'running'
                AND COALESCE(aj.last_heartbeat_at, aj.started_at, aj.created_at) < NOW() - INTERVAL '2 minutes'
              ) AS stalled,
              aj.branch AS requested_branch, aj.commit_hash AS requested_commit,
              aj.semantic_depth AS requested_depth, aj.role AS requested_role,
              s.file_count, s.symbol_count, s.workflow_count, s.commit_hash, s.branch,
              sc.path_prefix AS scope_path
       FROM analysis_jobs aj
       LEFT JOIN analysis_snapshots s ON s.id = aj.snapshot_id
       LEFT JOIN analysis_scopes sc ON sc.id = aj.scope_id
       WHERE aj.project_id = $1
       ORDER BY (aj.status IN ('queued', 'running')) DESC, aj.created_at DESC
       LIMIT 5`,
      [projectId],
    );

    const latestSnapshot = await query(
      `SELECT id, file_count, symbol_count, workflow_count, commit_hash, branch, semantic_depth, created_at
       FROM analysis_snapshots s
       WHERE project_id = $1 AND status = 'complete'
       ORDER BY ${latestSnapshotOrderSql('s')} LIMIT 1`,
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

/**
 * Run history: every job (newest first) with its resolved config, duration,
 * per-job LLM cost (SUM over ai_generation_runs.job_id), which sections were
 * generated vs served from cache, and the package it produced. Kept separate
 * from /analysis-status, which is a hot 5s poll — cost aggregation does not
 * belong on that path. Cursor pagination via ?before=<ISO timestamp>.
 */
projectsRouter.get("/:id/runs", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 50);
    const beforeRaw = req.query.before as string | undefined;
    const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw).toISOString() : null;

    const rows = (await query(
      `SELECT aj.id, aj.job_type, aj.status, aj.progress_pct, aj.current_step, aj.error_message,
              aj.snapshot_id, aj.role, aj.branch AS requested_branch, aj.commit_hash AS requested_commit,
              aj.semantic_depth AS requested_depth, aj.created_at, aj.started_at, aj.finished_at,
              aj.attempt, aj.step_log, aj.checkpoint->>'sectionType' AS section_type,
              CASE WHEN aj.finished_at IS NOT NULL AND aj.started_at IS NOT NULL
                   THEN (EXTRACT(EPOCH FROM (aj.finished_at - aj.started_at)) * 1000)::bigint
                   ELSE NULL END AS duration_ms,
              u.email AS requested_by_email,
              s.branch AS snapshot_branch, s.commit_hash AS snapshot_commit,
              sc.path_prefix AS scope_path, sc.display_name AS scope_name,
              cost.llm_calls, cost.cached_calls, cost.input_tokens, cost.output_tokens, cost.estimated_cost_usd,
              pkg.id AS package_id, pkg.role AS package_role, pkg.branch AS package_branch, pkg.status AS package_status,
              sections.generated_sections, sections.cached_sections,
              -- Per-run budget transparency: the zero point this run was
              -- metered from (null on runs that predate per-run metering),
              -- the snapshot's lifetime counters, and the cap that applied.
              aj.checkpoint -> 'budgetBaseline' AS budget_baseline,
              s.budget_usage AS snapshot_budget_usage,
              COALESCE(s.semantic_depth, aj.semantic_depth, pst.analysis_depth) AS effective_depth,
              pst.budget_overrides
       FROM analysis_jobs aj
       LEFT JOIN users u ON u.id = aj.requested_by
       LEFT JOIN analysis_snapshots s ON s.id = aj.snapshot_id
       LEFT JOIN project_settings pst ON pst.project_id = aj.project_id
       LEFT JOIN analysis_scopes sc ON sc.id = COALESCE(aj.scope_id, s.scope_id)
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE r.status = 'complete')::int AS llm_calls,
                COUNT(*) FILTER (WHERE r.status = 'skipped_cached')::int AS cached_calls,
                COALESCE(SUM((r.token_usage->>'inputTokens')::bigint) FILTER (WHERE r.status = 'complete'), 0)::bigint AS input_tokens,
                COALESCE(SUM((r.token_usage->>'outputTokens')::bigint) FILTER (WHERE r.status = 'complete'), 0)::bigint AS output_tokens,
                COALESCE(SUM(r.estimated_cost_usd), 0)::numeric AS estimated_cost_usd
         FROM ai_generation_runs r WHERE r.job_id = aj.id
       ) cost ON true
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT r.section_type) FILTER (WHERE r.status = 'complete' AND r.target_type = 'section') AS generated_sections,
                array_agg(DISTINCT r.section_type) FILTER (WHERE r.status = 'skipped_cached' AND r.target_type = 'section') AS cached_sections
         FROM ai_generation_runs r WHERE r.job_id = aj.id
       ) sections ON true
       LEFT JOIN LATERAL (
         SELECT op.id, op.role, op.branch, op.status FROM onboarding_packages op
         WHERE aj.job_type IN ('generate_package', 'regenerate_section')
           AND op.snapshot_id = aj.snapshot_id
           AND (aj.role IS NULL OR op.role = aj.role)
           AND (aj.branch IS NULL OR op.branch = aj.branch)
         ORDER BY op.created_at DESC LIMIT 1
       ) pkg ON true
       WHERE aj.project_id = $1 AND ($2::timestamptz IS NULL OR aj.created_at < $2)
       ORDER BY aj.created_at DESC
       LIMIT $3`,
      [projectId, before, limit],
    )).rows as Array<Record<string, unknown>>;

    const runs = rows.map((r) => ({
      id: r.id,
      job_type: r.job_type,
      status: r.status,
      progress_pct: r.progress_pct,
      current_step: r.current_step,
      error_message: r.error_message,
      snapshot_id: r.snapshot_id,
      section_type: r.section_type ?? null,
      config: {
        branch: (r.snapshot_branch as string | null) ?? (r.requested_branch as string | null),
        commit: (r.snapshot_commit as string | null) ?? (r.requested_commit as string | null),
        scope_path: r.scope_path,
        scope_name: r.scope_name,
        depth: r.requested_depth,
        role: r.role,
      },
      requested_by_email: r.requested_by_email,
      created_at: r.created_at,
      started_at: r.started_at,
      finished_at: r.finished_at,
      duration_ms: r.duration_ms === null ? null : Number(r.duration_ms),
      attempt: r.attempt,
      step_log: r.step_log ?? [],
      package: r.package_id
        ? { id: r.package_id, role: r.package_role, branch: r.package_branch, status: r.package_status }
        : null,
      cost: {
        estimated_cost_usd: Number(r.estimated_cost_usd ?? 0),
        llm_calls: Number(r.llm_calls ?? 0),
        cached_calls: Number(r.cached_calls ?? 0),
        input_tokens: Number(r.input_tokens ?? 0),
        output_tokens: Number(r.output_tokens ?? 0),
      },
      // Caps apply per run; the snapshot's counters are the lifetime record.
      // Both are shown so "$0.42 · 40 calls" reads against something.
      budget: summarizeRunBudget({
        depth: r.effective_depth as string | null,
        budgetOverrides: r.budget_overrides,
        baseline: r.budget_baseline,
        jobLlmCalls: Number(r.llm_calls ?? 0),
        snapshotUsage: r.snapshot_budget_usage,
      }),
      sections: {
        generated: (r.generated_sections as string[] | null) ?? [],
        cached: (r.cached_sections as string[] | null) ?? [],
      },
    }));

    res.json({ runs });
  } catch (err) {
    console.error("Run history error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Run controls: pause / stop / resume ─────────────────────────────────────
// Workers obey at the next step or AI-batch boundary (kill switch): progress
// updates on a paused/stopped job fail their status guard and the worker
// exits without stomping the user's choice. Phase checkpoints and the
// content-addressed record cache make resume cheap — completed work is
// never re-paid.


projectsRouter.post("/:id/analysis-jobs/:jobId/pause", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const jobId = String(req.params.jobId);
    const result = await query(
      `UPDATE analysis_jobs SET status = 'paused', current_step = 'Paused by user'
       WHERE id = $1 AND project_id = $2 AND status IN ('queued', 'running')
       RETURNING id`,
      [jobId, projectId],
    );
    if (result.rows.length === 0) {
      res.status(409).json({ error: "Job is not queued or running" });
      return;
    }
    await recomputeProjectStatus(projectId);
    res.json({ job: { id: jobId, status: "paused" } });
  } catch (err) {
    console.error("Pause job error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

projectsRouter.post("/:id/analysis-jobs/:jobId/stop", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const jobId = String(req.params.jobId);
    const result = await query(
      `UPDATE analysis_jobs
       SET status = 'failed', current_step = 'Stopped by user',
           error_message = 'Stopped by user — completed phases stay checkpointed; Resume or a new Analyze… picks up from cache.',
           finished_at = NOW()
       WHERE id = $1 AND project_id = $2 AND status IN ('queued', 'running', 'paused')
       RETURNING id`,
      [jobId, projectId],
    );
    if (result.rows.length === 0) {
      res.status(409).json({ error: "Job is not active" });
      return;
    }
    await recomputeProjectStatus(projectId);
    res.json({ job: { id: jobId, status: "failed" } });
  } catch (err) {
    console.error("Stop job error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Resume a paused run — or retry a failed/stalled one — on the SAME job row:
// checkpoints live there, so the worker skips everything already persisted.
projectsRouter.post("/:id/analysis-jobs/:jobId/resume", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const jobId = String(req.params.jobId);
    const row = (await query(
      `SELECT aj.status, aj.job_type, aj.scope_id, aj.branch, aj.commit_hash, aj.semantic_depth,
              aj.role, aj.snapshot_id, s.commit_hash AS snapshot_commit
       FROM analysis_jobs aj
       LEFT JOIN analysis_snapshots s ON s.id = aj.snapshot_id
       WHERE aj.id = $1 AND aj.project_id = $2`,
      [jobId, projectId],
    )).rows[0] as {
      status: string; job_type: string; scope_id: string | null; branch: string | null;
      commit_hash: string | null; semantic_depth: string | null; role: string | null;
      snapshot_id: string | null; snapshot_commit: string | null;
    } | undefined;
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (!["paused", "failed"].includes(row.status)) {
      res.status(409).json({ error: "Only paused or failed runs can be resumed" });
      return;
    }
    if (row.job_type === "regenerate_section") {
      res.status(409).json({ error: "Regenerations restart from the section — use its Regenerate button" });
      return;
    }
    if (row.job_type === "preflight") {
      res.status(409).json({ error: "Preflight previews are not resumable — run a new preview" });
      return;
    }
    // Per-tuple guard, mirroring POST /analyze: only an identical active run
    // blocks the resume; unrelated runs proceed in parallel.
    const active = row.job_type === "generate_package"
      ? await query(
          `SELECT id FROM analysis_jobs
           WHERE project_id = $1 AND id <> $2 AND status IN ('queued', 'running')
             AND job_type = 'generate_package' AND snapshot_id = $3
             AND COALESCE(role, '') = COALESCE($4, '') AND COALESCE(branch, '') = COALESCE($5, '')
           LIMIT 1`,
          [projectId, jobId, row.snapshot_id, row.role, row.branch],
        )
      : await query(
          `SELECT id FROM analysis_jobs
           WHERE project_id = $1 AND id <> $2 AND status IN ('queued', 'running')
             AND job_type IN ('analyze_scope', 'incremental_update')
             AND COALESCE(scope_id::text, '') = COALESCE($3::text, '')
             AND COALESCE(commit_hash, 'head:' || COALESCE(branch, ''))
                 = COALESCE($4, 'head:' || COALESCE($5, ''))
           LIMIT 1`,
          [projectId, jobId, row.scope_id, row.snapshot_commit ?? row.commit_hash, row.branch],
        );
    if (active.rows.length > 0) {
      res.status(409).json({ error: "An identical run is already active", active_job_id: active.rows[0].id });
      return;
    }

    await query(
      `UPDATE analysis_jobs
       SET status = 'queued', current_step = 'Waiting for worker (resume)',
           error_message = NULL, finished_at = NULL, last_heartbeat_at = NULL
       WHERE id = $1`,
      [jobId],
    );

    if (row.job_type === "generate_package") {
      if (!row.snapshot_id) {
        res.status(409).json({ error: "This generation has no snapshot to resume against" });
        return;
      }
      await getSummaryQueue().add(`generate_summary_${row.role ?? "general"}`, {
        jobId,
        snapshotId: row.snapshot_id,
        projectId,
        triggeredBy: req.user!.id,
        role: row.role ?? undefined,
        branch: row.branch ?? undefined,
      } satisfies SummaryJobData, {
        attempts: 2,
        backoff: { type: "fixed", delay: 3000 },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      });
    } else {
      await query(`UPDATE projects SET status = 'analyzing' WHERE id = $1`, [projectId]);
      await getAnalysisQueue().add("analyze_scope", {
        jobId,
        projectId,
        scopeId: row.scope_id ?? undefined,
        // Resume the exact commit that was being analyzed, not a moved branch head.
        commit: row.snapshot_commit ?? row.commit_hash ?? undefined,
        branch: row.branch ?? undefined,
        depth: (row.semantic_depth ?? undefined) as AnalysisJobData["depth"],
        role: row.role ?? undefined,
        // A resume must actually finish the interrupted pipeline — never
        // short-circuit onto the possibly half-semantic existing snapshot.
        force: true,
      } satisfies AnalysisJobData, {
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
      });
    }

    res.status(202).json({ job: { id: jobId, status: "queued" } });
  } catch (err) {
    console.error("Resume job error:", err);
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
       ORDER BY ${latestSnapshotOrderSql('s')}
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
    const { scope_id, scope_path, branch, commit, depth } = (req.body ?? {}) as {
      scope_id?: string;
      scope_path?: string;
      branch?: string;
      commit?: string;
      depth?: string;
    };
    if (commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(commit)) {
      res.status(400).json({ error: "commit must be a git SHA (7-40 hex characters)" });
      return;
    }
    // A branch is interpolated into GitHub API paths downstream; reject
    // anything that is not a plain ref here so a bad value fails at the edge
    // with a clear 400 instead of deep in the worker
    // (doc/SECURITY_XSS_PROMPT_INJECTION.md finding P4).
    if (branch !== undefined && branch !== null && branch !== "" && !isValidGitRef(branch)) {
      res.status(400).json({ error: "branch must be a valid git ref" });
      return;
    }
    if (depth !== undefined && !VALID_DEPTHS.includes(depth as typeof VALID_DEPTHS[number])) {
      res.status(400).json({ error: "depth must be one of: cheap, standard, full" });
      return;
    }

    let effectiveScopeId = scope_id ?? null;
    if (effectiveScopeId) {
      const scopeCheck = await query(
        `SELECT id FROM analysis_scopes WHERE id = $1 AND project_id = $2`,
        [effectiveScopeId, projectId],
      );
      if (scopeCheck.rows.length === 0) {
        res.status(404).json({ error: "Scope not found" });
        return;
      }
    } else if (scope_path !== undefined && normalizeScopePath(scope_path) !== "") {
      const prefix = normalizeScopePath(scope_path);
      const scopeResult = await query(
        `INSERT INTO analysis_scopes (project_id, path_prefix, display_name, kind, detected_from, created_by)
         VALUES ($1, $2, $2, 'manual', 'user_manual', $3)
         ON CONFLICT (project_id, path_prefix) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [projectId, prefix, userId],
      );
      effectiveScopeId = scopeResult.rows[0].id as string;
    }

    const jobResult = await query(
      `INSERT INTO analysis_jobs (project_id, scope_id, requested_by, job_type, status, current_step,
                                  branch, commit_hash, semantic_depth)
       VALUES ($1, $2, $3, 'preflight', 'queued', 'Waiting for worker', $4, $5, $6)
       RETURNING id, status`,
      [projectId, effectiveScopeId, userId, branch ?? null, commit ?? null, depth ?? null],
    );
    const dbJobId: string = jobResult.rows[0].id;

    await getAnalysisQueue().add('preflight', {
      jobId: dbJobId,
      projectId,
      task: 'preflight',
      scopeId: effectiveScopeId ?? undefined,
      branch,
      commit,
      depth: depth as AnalysisJobData['depth'],
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
    const { scope_id, scope_path, branch, commit, depth, role, force } = (req.body ?? {}) as {
      scope_id?: string;
      scope_path?: string;
      branch?: string;
      commit?: string;
      depth?: string;
      role?: string;
      /** Re-analyze even if this (scope, commit) already has a complete snapshot. */
      force?: boolean;
    };
    if (commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(commit)) {
      res.status(400).json({ error: "commit must be a git SHA (7-40 hex characters)" });
      return;
    }
    // A branch is interpolated into GitHub API paths downstream; reject
    // anything that is not a plain ref here so a bad value fails at the edge
    // with a clear 400 instead of deep in the worker
    // (doc/SECURITY_XSS_PROMPT_INJECTION.md finding P4).
    if (branch !== undefined && branch !== null && branch !== "" && !isValidGitRef(branch)) {
      res.status(400).json({ error: "branch must be a valid git ref" });
      return;
    }
    if (depth !== undefined && !VALID_DEPTHS.includes(depth as typeof VALID_DEPTHS[number])) {
      res.status(400).json({ error: "depth must be one of: cheap, standard, full" });
      return;
    }
    if (role !== undefined && !VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
      res.status(400).json({ error: "role must be one of: backend, frontend, devops, qa, general" });
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

    const project = projectResult.rows[0] as { id: string; branch: string };

    await client.query(
      `UPDATE projects SET status = 'analyzing' WHERE id = $1`,
      [projectId],
    );

    let effectiveScopeId = scope_id ?? null;
    if (!effectiveScopeId && scope_path !== undefined && normalizeScopePath(scope_path) !== "") {
      const prefix = normalizeScopePath(scope_path);
      const scopeResult = await client.query(
        `INSERT INTO analysis_scopes (project_id, path_prefix, display_name, kind, detected_from, created_by)
         VALUES ($1, $2, $2, 'manual', 'user_manual', $3)
         ON CONFLICT (project_id, path_prefix) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [projectId, prefix, userId],
      );
      effectiveScopeId = scopeResult.rows[0].id as string;
    }

    // Scope validation, incremental-vs-initial probe, per-tuple concurrency
    // guard, and the job INSERT — shared with the GitHub push webhook.
    const prepared = await prepareAnalysisRun(client, {
      projectId,
      requestedBy: userId,
      projectDefaultBranch: project.branch,
      scopeId: effectiveScopeId,
      branch: branch ?? null,
      commit: commit ?? null,
      depth: depth ?? null,
      role: role ?? null,
    });
    if (!prepared.ok) {
      await client.query("ROLLBACK");
      if (prepared.reason === "scope_not_found") {
        res.status(404).json({ error: "Scope not found" });
      } else {
        res.status(409).json({
          error: "This scope and commit are already being analyzed",
          active_job_id: prepared.activeJobId,
        });
      }
      return;
    }

    await client.query("COMMIT");

    await enqueueAnalysisRun(prepared.jobId, {
      jobId: prepared.jobId,
      projectId,
      scopeId: effectiveScopeId ?? undefined,
      commit,
      branch,
      depth: depth as AnalysisJobData['depth'],
      role,
      force: force === true,
    } satisfies AnalysisJobData);

    res.status(202).json({
      analysis: {
        id: prepared.jobId,
        status: prepared.jobStatus,
        mode: prepared.jobType === 'incremental_update' ? "incremental" : "initial",
        branch: branch ?? project.branch,
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
