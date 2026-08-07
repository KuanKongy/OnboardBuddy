/**
 * Restart resilience — "a deploy must not read as a product failure".
 *
 * Any container recreate (a Railway deploy, a `docker compose build`, an
 * unrelated test run) kills in-flight analyses. Until now the reconciler
 * marked every one of them `failed` with "run Analyze… again to resume from
 * cache": true, cheap, and useless on a public URL where nobody is watching
 * the queue. This module re-queues them instead, on the SAME `analysis_jobs`
 * row — checkpoints, the budget baseline and the content-addressed record
 * cache all hang off that row id, so a recovered run skips everything already
 * paid for. It is the automatic form of `POST /analysis-jobs/:id/resume`.
 *
 * ── Why this is not a retry loop ──────────────────────────────────────────
 * A dead heartbeat cannot distinguish "SIGKILLed by a deploy" from "crashed
 * because THIS repository makes us crash". A poison job that kills the worker
 * would be re-queued forever, burning LLM budget on every pass. Three things
 * bound it:
 *
 *   1. The attempt count is DURABLE and lives outside the queue, in
 *      `analysis_jobs.checkpoint->'recovery'->>'attempts'` (jsonb, already in
 *      use for `budgetBaseline` — no schema change). BullMQ's own
 *      `attemptsMade` resets to 0 on a fresh enqueue, so it cannot bound this.
 *   2. The count is incremented BY THE CLAIM ITSELF, before the job is handed
 *      back to the queue. A job that kills the process before it can write
 *      anything has still been counted.
 *   3. `MAX_RECOVERY_ATTEMPTS` (default 2) caps it. Attempt max+1 is failed
 *      permanently, with a message that says how many times it was lost — and
 *      it stays failed, because the sweep only ever claims `status='running'`.
 *
 * ── Resumable interruption vs genuine failure ─────────────────────────────
 * Only job types that resume cheaply and idempotently are recovered:
 * `analyze_scope` / `incremental_update` (phase checkpoints + content-
 * addressed semantic records) and `generate_package` (checkpoint
 * `completedSections`). `preflight` and `regenerate_section` are failed
 * honestly — exactly the two types `POST /resume` refuses, for the same
 * reason: both are cheap, foreground, one-click actions whose user is
 * watching, so a silent automatic retry buys nothing.
 *
 * ── Where this runs ───────────────────────────────────────────────────────
 * In the periodic reconciler (boot + every 120s in EVERY worker replica), not
 * in the queue watchdog. The watchdog answers "is this consumer deaf?" by
 * sampling Redis queue depth; orphan recovery is a database liveness question
 * with no Redis signal at all. Running it on a timer in every replica means a
 * job orphaned mid-milestone by one replica's crash is recovered by a LIVE
 * sibling within ~one sweep, without waiting for a worker boot — and the boot
 * sweep still covers the single-replica deploy.
 *
 * Multi-worker safety comes from the claim being one atomic statement: two
 * replicas sweeping at once both run `UPDATE … WHERE status = 'running'`, the
 * second blocks on the row lock and then re-evaluates the predicate against
 * the committed row, which is no longer 'running'. Exactly one claimant, so
 * exactly one re-enqueue.
 */

import { query } from '../lib/db.js';
import { envInt } from '../lib/env.js';
import { recomputeProjectStatus } from '../lib/projectStatus.js';
import { markSnapshotFailed } from './runStatus.js';

/** Heartbeats stamp every ~15s, so 3 minutes of silence means the run is dead. */
export const STALE_AFTER_SECONDS = 180;

/**
 * How long a row may sit on 'queued' before the sweep considers it stranded. Not
 * the whole test — a backlogged job is also old, so `liveQueuedJobIds` has to
 * confirm Redis never heard of the row too (see `failStrandedQueued`).
 */
export const STRANDED_QUEUED_AFTER_SECONDS = 300;

const STRANDED_MESSAGE =
  'This run never reached the job queue, so no worker could pick it up. Nothing was '
  + 'started. Press Analyze… again.';

/**
 * How many times one job row may be handed back to the queue. 2 = a job runs
 * at most three times (the original delivery plus two recoveries) before it is
 * declared genuinely broken rather than merely interrupted.
 */
export const MAX_RECOVERY_ATTEMPTS = envInt('JOB_RECOVERY_MAX_ATTEMPTS', 2);

/** Job types whose checkpoints make a re-run cheap and idempotent. */
export const RECOVERABLE_JOB_TYPES: ReadonlySet<string> = new Set([
  'analyze_scope',
  'incremental_update',
  'generate_package',
]);

/** Job types that own their snapshot's status (generation jobs never do). */
const ANALYSIS_JOB_TYPES: ReadonlySet<string> = new Set(['analyze_scope', 'incremental_update']);

const LOST_MESSAGE =
  'Worker lost this run (restart or crash). Completed phases are checkpointed: '
  + 'run Analyze… again to resume from cache.';

export interface OrphanedJob {
  id: string;
  project_id: string;
  snapshot_id: string | null;
  job_type: string;
  scope_id: string | null;
  branch: string | null;
  commit_hash: string | null;
  semantic_depth: string | null;
  role: string | null;
  requested_by: string;
  /** Durable count AFTER this claim incremented it. 1 = lost once. */
  recovery_attempts: number;
}

export interface JobRecoveryDeps {
  /** Put an analyze_scope / incremental_update job back on the analysis queue. */
  requeueAnalysis(job: OrphanedJob): Promise<void>;
  /** Put a generate_package job back on the summary queue. */
  requeueGeneration(job: OrphanedJob): Promise<void>;
  log?: (msg: string) => void;
  /**
   * DB job ids Redis still knows about (waiting / delayed / active). Absent
   * disables the stranded-'queued' sweep entirely: without proof the queue never
   * heard of a row, a backlogged job would be failed before it was due to run.
   */
  liveQueuedJobIds?: () => Promise<Set<string>>;
  /** Overridable for tests. */
  staleAfterSeconds?: number;
  strandedAfterSeconds?: number;
  maxAttempts?: number;
}

/**
 * The whole policy, in one pure function so it is assertable without a
 * database. `attempts` is the count AFTER the claim incremented it, so the
 * first orphaning of a recoverable job arrives here as 1.
 */
export function isRecoverable(jobType: string, attempts: number, maxAttempts = MAX_RECOVERY_ATTEMPTS): boolean {
  return RECOVERABLE_JOB_TYPES.has(jobType) && attempts <= maxAttempts;
}

/** The honest terminal message for an orphan we are giving up on. */
export function terminalMessage(job: Pick<OrphanedJob, 'job_type' | 'recovery_attempts'>, requeueError?: string): string {
  if (requeueError) {
    return `Worker lost this run and it could not be re-queued (${requeueError.slice(0, 120)}). `
      + 'Completed phases are checkpointed: run Analyze… again to resume from cache.';
  }
  if (!RECOVERABLE_JOB_TYPES.has(job.job_type)) return LOST_MESSAGE;
  return `Worker lost this run ${job.recovery_attempts} times (restart or crash); automatic recovery gave up. `
    + 'Completed phases are checkpointed: run Analyze… again to resume from cache.';
}

/**
 * Claims every dead 'running' job in one atomic statement and moves it to
 * 'queued' with its recovery counter incremented. Claiming BEFORE deciding is
 * deliberate: the exclusive claim is what stops two replicas double-enqueuing,
 * and the JS caller then owns the (testable) recover-or-fail decision. A row
 * that ends up failing sits on 'queued' for the milliseconds in between.
 */
async function claimOrphans(staleAfterSeconds: number): Promise<OrphanedJob[]> {
  const result = await query(
    `UPDATE analysis_jobs
     SET status = 'queued',
         current_step = 'Re-queued after worker restart',
         error_message = NULL,
         finished_at = NULL,
         last_heartbeat_at = NOW(),
         attempt = attempt + 1,
         checkpoint = jsonb_set(
           COALESCE(checkpoint, '{}'::jsonb), '{recovery}',
           jsonb_build_object(
             'attempts', COALESCE((checkpoint #>> '{recovery,attempts}')::int, 0) + 1,
             'lastAt', to_jsonb(NOW())
           ), true),
         step_log = step_log || jsonb_build_array(jsonb_build_object(
           'step', 'Worker restart detected, re-queued', 'pct', progress_pct, 'ts', NOW()))
     WHERE status = 'running'
       AND COALESCE(last_heartbeat_at, started_at, created_at) < NOW() - make_interval(secs => $1::int)
     RETURNING id, project_id, snapshot_id, job_type, scope_id, branch, commit_hash,
               semantic_depth, role, requested_by,
               COALESCE((checkpoint #>> '{recovery,attempts}')::int, 1) AS recovery_attempts`,
    [staleAfterSeconds],
  );
  return result.rows as OrphanedJob[];
}

/**
 * A submission that never landed leaves a committed 'queued' row with no heartbeat to
 * go dead, so `claimOrphans` cannot see it. A fail rather than a re-enqueue: the job
 * data lived in the request, and inventing it risks running an analysis nobody asked
 * for twice. Two conditions, both required — aged past `strandedAfterSeconds` AND
 * absent from the live queue.
 */
async function failStrandedQueued(
  liveQueuedJobIds: () => Promise<Set<string>>,
  strandedAfterSeconds: number,
  log: (msg: string) => void,
): Promise<string[]> {
  const candidates = await query(
    `SELECT id, project_id FROM analysis_jobs
     WHERE status = 'queued'
       AND COALESCE(last_heartbeat_at, started_at, created_at) < NOW() - make_interval(secs => $1::int)`,
    [strandedAfterSeconds],
  );
  if (candidates.rows.length === 0) return [];

  // Asked for only when there is something to judge.
  const live = await liveQueuedJobIds();
  const failed: string[] = [];
  for (const row of candidates.rows as Array<{ id: string; project_id: string }>) {
    if (live.has(row.id)) continue;
    const result = await query(
      `UPDATE analysis_jobs
       SET status = 'failed', current_step = 'Failed', error_message = $2, finished_at = NOW(),
           step_log = step_log || jsonb_build_array(jsonb_build_object(
             'step', 'Failed: never reached the queue', 'pct', 0, 'ts', NOW()))
       WHERE id = $1 AND status = 'queued'`,
      [row.id, STRANDED_MESSAGE],
    );
    // Guarded on 'queued': a worker that picked the job up since the SELECT is
    // never stomped mid-run.
    if ((result.rowCount ?? 0) === 0) continue;
    failed.push(row.id);
    // The route set projects.status='analyzing', so the card would keep claiming
    // an analysis that does not exist.
    await recomputeProjectStatus(row.project_id).catch(() => {});
    log(`[worker] job ${row.id} sat 'queued' with no queue entry — marked failed`);
  }
  return failed;
}

/**
 * Terminal write for an orphan that will not be retried. Mirrors what the old
 * reconciler did: fail the job, correct the snapshot's optimistic 'complete'
 * (bug #75's crash variant — the persistence step writes it at 46% and six
 * phases still follow), and recompute the project scalar.
 */
async function failOrphan(job: OrphanedJob, requeueError?: string): Promise<void> {
  const message = terminalMessage(job, requeueError);
  await query(
    `UPDATE analysis_jobs
     SET status = 'failed', current_step = 'Failed', error_message = $2, finished_at = NOW(),
         step_log = step_log || jsonb_build_array(jsonb_build_object(
           'step', 'Failed: ' || left($2::text, 100), 'pct', 0, 'ts', NOW()))
     WHERE id = $1 AND status = 'queued'`,
    [job.id, message],
  );
  // Restricted to analysis job types on purpose: an orphaned generate_package
  // points at a snapshot whose analysis genuinely finished, and failing that
  // would be the same lie in the other direction. 'paused' is left alone.
  if (job.snapshot_id && ANALYSIS_JOB_TYPES.has(job.job_type)) {
    await markSnapshotFailed(job.snapshot_id, message).catch(() => {});
  }
}

/**
 * One sweep: claim the dead runs, re-queue the resumable ones, fail the rest.
 * Never throws — a reconciliation error must not take down a healthy worker.
 */
export async function reconcileOrphanedJobs(
  deps: JobRecoveryDeps,
): Promise<{ requeued: string[]; failed: string[] }> {
  const log = deps.log ?? ((m: string) => console.warn(m));
  const maxAttempts = deps.maxAttempts ?? MAX_RECOVERY_ATTEMPTS;
  const requeued: string[] = [];
  const failed: string[] = [];

  let orphans: OrphanedJob[];
  try {
    orphans = await claimOrphans(deps.staleAfterSeconds ?? STALE_AFTER_SECONDS);
  } catch (err) {
    log(`[worker] orphan reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    return { requeued, failed };
  }

  for (const job of orphans) {
    try {
      if (isRecoverable(job.job_type, job.recovery_attempts, maxAttempts)) {
        try {
          if (job.job_type === 'generate_package') {
            await deps.requeueGeneration(job);
          } else {
            await deps.requeueAnalysis(job);
          }
        } catch (err) {
          // The queue is unreachable. Failing the row is the safe direction:
          // if the add actually landed despite the error, the worker that
          // picks it up finds a non-runnable status and exits quietly instead
          // of double-running.
          const reason = err instanceof Error ? err.message : String(err);
          await failOrphan(job, reason);
          failed.push(job.id);
          log(`[worker] orphan ${job.id} could not be re-queued (${reason}) — marked failed`);
          continue;
        }
        requeued.push(job.id);
        log(`[worker] re-queued orphaned ${job.job_type} ${job.id} `
          + `(recovery ${job.recovery_attempts}/${maxAttempts}, resumes from checkpoints)`);
      } else {
        await failOrphan(job);
        failed.push(job.id);
        log(`[worker] orphaned ${job.job_type} ${job.id} not recovered `
          + `(attempts ${job.recovery_attempts}, max ${maxAttempts}) — marked failed`);
      }
      await recomputeProjectStatus(job.project_id).catch(() => {});
    } catch (err) {
      log(`[worker] orphan handling failed for ${job.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // After the claim, so a row this sweep just re-queued carries a fresh heartbeat
  // and cannot be mistaken for one that never left the producer.
  if (deps.liveQueuedJobIds) {
    try {
      failed.push(...await failStrandedQueued(
        deps.liveQueuedJobIds,
        deps.strandedAfterSeconds ?? STRANDED_QUEUED_AFTER_SECONDS,
        log,
      ));
    } catch (err) {
      // Including "could not reach Redis to check" — not knowing which rows are
      // live means the sweep does nothing rather than guess.
      log(`[worker] stranded-queued sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { requeued, failed };
}

// ── In-flight registry (graceful-shutdown handoff) ──────────────────────────

const inFlight = new Set<string>();

/** Registers a DB job id as running in THIS process; call the returned fn when done. */
export function trackInFlightJob(jobId: string): () => void {
  inFlight.add(jobId);
  return () => inFlight.delete(jobId);
}

export function inFlightJobIds(): string[] {
  return [...inFlight];
}

/**
 * Forced-shutdown handoff. When the drain grace period expires we KNOW these
 * runs are being abandoned, so there is no reason to make the next sweep wait
 * out three minutes of heartbeat silence to discover it. Ageing the heartbeat
 * past the staleness threshold hands them to the recovery sweep immediately —
 * in the replacement container's boot sweep, or in a live sibling replica.
 *
 * Deliberately NOT a direct re-enqueue: this process is milliseconds from
 * exiting and its abandoned async work may still be writing. Letting the
 * atomic claim in `reconcileOrphanedJobs` make the decision keeps the
 * exactly-one-claimant guarantee, and the bounded counter still applies.
 */
export async function markInFlightJobsAbandoned(staleAfterSeconds = STALE_AFTER_SECONDS): Promise<number> {
  const ids = inFlightJobIds();
  if (ids.length === 0) return 0;
  const result = await query(
    `UPDATE analysis_jobs
     SET last_heartbeat_at = NOW() - make_interval(secs => $2::int),
         current_step = 'Interrupted by worker shutdown'
     WHERE id = ANY($1::uuid[]) AND status = 'running'`,
    [ids, staleAfterSeconds + 1],
  );
  return result.rowCount ?? 0;
}
