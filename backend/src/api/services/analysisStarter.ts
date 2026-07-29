/**
 * Shared analysis-run preparation: the transactional core of POST
 * /projects/:id/analyze, extracted so the GitHub push webhook can enqueue the
 * exact same runs without HTTP auth. The CALLER owns the transaction — BEGIN,
 * the `SELECT ... FOR UPDATE` project lock (serializes racing starts),
 * `UPDATE projects SET status='analyzing'`, and COMMIT — because the webhook
 * prepares several scopes under one lock. Queue publishing happens after
 * COMMIT via enqueueAnalysisRun.
 */

import { query } from "../../lib/db.js";
import { getAnalysisQueue } from "../../lib/queue.js";
import type { AnalysisJobData } from "../../lib/queue.js";
import { recomputeProjectStatus } from "../../lib/projectStatus.js";

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

/**
 * Bug #69(1): reconcile a job row whose queue submission never landed.
 *
 * Submission happens AFTER the transaction commits, so a Redis outage leaves a
 * committed `queued` row that no worker will ever see: the project is pinned to
 * 'analyzing', the UI polls "waiting for worker" forever, and every retry is
 * rejected by the per-tuple concurrency guard as "already being analyzed" — the
 * guard doing its job on a phantom. The worker's orphan sweep cannot rescue it
 * either; that sweep only claims rows already `running`, because a dead
 * heartbeat is its only liveness signal and a never-started job has none.
 *
 * So the producer owns this one. The row is failed with the reason, which frees
 * the tuple immediately and turns an indefinite hang into a visible, retryable
 * error. Guarded on `status = 'queued'` so a worker that DID pick the job up
 * despite the error (an ack lost on the way back) is never stomped mid-run.
 */
export async function failUnsubmittedJob(jobId: string, projectId: string, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  const message = `Could not submit this run to the job queue (${reason.slice(0, 160)}). Nothing was started — press Analyze again.`;
  try {
    await query(
      `UPDATE analysis_jobs
       SET status = 'failed', current_step = 'Failed', error_message = $2, finished_at = NOW(),
           step_log = step_log || jsonb_build_array(jsonb_build_object(
             'step', 'Failed: queue submission', 'pct', 0, 'ts', NOW()))
       WHERE id = $1 AND status = 'queued'`,
      [jobId, message],
    );
    // The route set projects.status='analyzing' inside the transaction; with
    // nothing queued, the card would claim an analysis that does not exist.
    await recomputeProjectStatus(projectId);
  } catch (cleanupErr) {
    // Losing the database too is not a reason to swallow the original error.
    console.error(
      `[analysisStarter] could not fail unsubmitted job ${jobId}:`,
      cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
    );
  }
}

/**
 * Seam for the reconciliation test. A real `Queue.add` against an unreachable
 * Redis does not reject — ioredis reconnects forever by design (lib/queue.ts
 * `RESILIENCE`) — so the only way to assert the failure path is to substitute
 * the publish. Mirrors `__setQueryForTests` in lib/db.ts.
 */
type QueuePublish = (name: string, data: AnalysisJobData, opts: Record<string, unknown>) => Promise<unknown>;
let publishOverride: QueuePublish | null = null;
export function __setQueuePublishForTests(fn: QueuePublish | null): void {
  publishOverride = fn;
}

async function publish(name: string, data: AnalysisJobData, opts: Record<string, unknown>): Promise<void> {
  if (publishOverride) {
    await publishOverride(name, data, opts);
    return;
  }
  await getAnalysisQueue().add(name, data, opts);
}

/** Publish a prepared job to the analysis queue — call AFTER the transaction commits. */
export async function enqueueAnalysisRun(jobId: string, data: AnalysisJobData): Promise<void> {
  try {
    await publish("analyze_scope", data, {
      jobId,
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
    });
  } catch (err) {
    await failUnsubmittedJob(jobId, data.projectId, err);
    throw err;
  }
}

/**
 * Same reconciliation for a preflight submission. Preflight rows are not
 * covered by the concurrency guard, but a stuck one still leaves the import
 * wizard's "Preview first" spinning until its own 3-minute client timeout.
 */
export async function enqueuePreflightRun(jobId: string, data: AnalysisJobData): Promise<void> {
  try {
    await publish("preflight", data, {
      jobId,
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
    });
  } catch (err) {
    await failUnsubmittedJob(jobId, data.projectId, err);
    throw err;
  }
}
