/**
 * Shared analysis-run preparation: the transactional core of POST
 * /projects/:id/analyze, extracted so the GitHub push webhook can enqueue the
 * exact same runs without HTTP auth. The CALLER owns the transaction — BEGIN,
 * the `SELECT ... FOR UPDATE` project lock (serializes racing starts),
 * `UPDATE projects SET status='analyzing'`, and COMMIT — because the webhook
 * prepares several scopes under one lock. Queue publishing happens after
 * COMMIT via enqueueAnalysisRun.
 */

import { getAnalysisQueue } from "../../lib/queue.js";
import type { AnalysisJobData } from "../../lib/queue.js";

/** Minimal transactional client surface (pg PoolClient or a test fake). */
export interface TxClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export interface PrepareRunOpts {
  projectId: string;
  /** analysis_jobs.requested_by is NOT NULL — webhook runs use the project owner. */
  requestedBy: string;
  /** The project's default branch (from the locked project row) for head-run comparison. */
  projectDefaultBranch: string;
  scopeId?: string | null;
  branch?: string | null;
  commit?: string | null;
  depth?: string | null;
  role?: string | null;
}

export type PrepareRunResult =
  | { ok: true; jobId: string; jobStatus: string; jobType: "analyze_scope" | "incremental_update" }
  | { ok: false; reason: "scope_not_found" }
  | { ok: false; reason: "active_twin"; activeJobId: string };

export async function prepareAnalysisRun(client: TxClient, opts: PrepareRunOpts): Promise<PrepareRunResult> {
  const { projectId, requestedBy, projectDefaultBranch } = opts;
  const effectiveScopeId = opts.scopeId ?? null;
  const branch = opts.branch ?? null;
  const commit = opts.commit ?? null;

  if (effectiveScopeId) {
    const scopeCheck = await client.query(
      `SELECT id FROM analysis_scopes WHERE id = $1 AND project_id = $2`,
      [effectiveScopeId, projectId],
    );
    if (scopeCheck.rows.length === 0) {
      return { ok: false, reason: "scope_not_found" };
    }
  }

  // Re-analyzing an already-analyzed scope is an incremental update (spec
  // job type): the worker diffs against the previous snapshot and flags
  // stale artifacts instead of regenerating everything.
  const previousSnapshot = await client.query(
    effectiveScopeId
      ? `SELECT 1 FROM analysis_snapshots WHERE project_id = $1 AND scope_id = $2 AND status = 'complete' LIMIT 1`
      : `SELECT 1 FROM analysis_snapshots s
         JOIN analysis_scopes sc ON sc.id = s.scope_id
         WHERE s.project_id = $1 AND sc.path_prefix = '' AND s.status = 'complete' LIMIT 1`,
    effectiveScopeId ? [projectId, effectiveScopeId] : [projectId],
  );
  const jobType = previousSnapshot.rows.length > 0 ? "incremental_update" : "analyze_scope";

  // Concurrency is per (scope, commit) tuple, not per project: only an
  // identical run conflicts. Head runs compare as 'head:<branch>' until the
  // worker resolves the SHA; the worker's duplicate guard catches the rest.
  // The caller's FOR UPDATE project lock serializes racing requests.
  const activeTwin = await client.query(
    `SELECT id FROM analysis_jobs
     WHERE project_id = $1 AND status IN ('queued', 'running')
       AND job_type IN ('analyze_scope', 'incremental_update')
       AND COALESCE(scope_id::text, '') = COALESCE($2::text, '')
       AND COALESCE(commit_hash, 'head:' || COALESCE(branch, $3))
           = COALESCE($4, 'head:' || COALESCE($5, $3))
     LIMIT 1`,
    [projectId, effectiveScopeId, projectDefaultBranch, commit, branch],
  );
  if (activeTwin.rows.length > 0) {
    return { ok: false, reason: "active_twin", activeJobId: (activeTwin.rows[0] as { id: string }).id };
  }

  const jobResult = await client.query(
    `INSERT INTO analysis_jobs (project_id, scope_id, requested_by, job_type, status, current_step,
                                role, branch, commit_hash, semantic_depth)
     VALUES ($1, $2, $3, $4, 'queued', 'Waiting for worker', $5, $6, $7, $8)
     RETURNING id, status`,
    [projectId, effectiveScopeId, requestedBy, jobType,
     opts.role ?? null, branch ?? projectDefaultBranch, commit, opts.depth ?? null],
  );
  const row = jobResult.rows[0] as { id: string; status: string };
  return { ok: true, jobId: row.id, jobStatus: row.status, jobType };
}

/** Publish a prepared job to the analysis queue — call AFTER the transaction commits. */
export async function enqueueAnalysisRun(jobId: string, data: AnalysisJobData): Promise<void> {
  await getAnalysisQueue().add("analyze_scope", data, {
    jobId,
    attempts: 2,
    backoff: { type: "fixed", delay: 5000 },
  });
}
