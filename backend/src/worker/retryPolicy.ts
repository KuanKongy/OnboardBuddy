/**
 * Bug #69(2) — "the retry policy is a no-op".
 *
 * Every producer enqueues with `attempts: 2`, so BullMQ redelivers a throwing
 * job once. That redelivery was dead on arrival. Both workers wrote
 * `status = 'failed'` on the FIRST failure, and both guard their progress
 * writes with `status NOT IN ('paused','failed')` — so the retry's very first
 * step update matched no row and threw `KillSwitchError('failed')` before any
 * work was attempted. Every transient error (an upstream 502, a GitHub blip, a
 * dropped socket) surfaced as a hard failure needing a manual resume, while the
 * configured retry burned a redelivery doing nothing.
 *
 * The rule here: a job row is written `'failed'` only on its LAST attempt. On
 * any earlier one it goes back to `'queued'`, which is both truthful (it really
 * is waiting to run again) and the one status the step guards let a retry write
 * over.
 *
 * This is a DIFFERENT mechanism from `jobRecovery.ts`, and the two do not
 * overlap. Recovery answers "this row says running but its worker is gone" —
 * a liveness question, decided by a dead heartbeat, bounded by its own durable
 * counter. This answers "the processor threw and BullMQ is about to redeliver"
 * — a delivery question, decided inside the failing process, bounded by
 * `opts.attempts`. A job can be subject to both, in that order, and neither
 * counter feeds the other.
 */

import { UnrecoverableError, type Job } from 'bullmq';
import { query } from '../lib/db.js';

/**
 * Errors where a second attempt cannot possibly do better, so retrying only
 * delays an honest message by one backoff. Matched on the messages the worker
 * itself throws — deliberately anchored, so a provider error that happens to
 * quote one of these strings is still retried.
 *
 * Everything NOT listed here is treated as transient and worth the retry,
 * which is the direction bug #69 asks for.
 */
const PERMANENT_ERROR_PATTERNS: RegExp[] = [
  /^Project not found/,
  /^Scope not found/,
  /^Snapshot not found/,
  /^No GitHub App installation linked/,
  /^No supported source files in scope/,
  /already being analyzed by another run/,
];

export function isPermanentFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return PERMANENT_ERROR_PATTERNS.some((re) => re.test(message));
}

/**
 * Will BullMQ redeliver this job after the processor throws? Mirrors
 * `Job.shouldRetryJob` exactly: `attemptsMade + 1 < opts.attempts`, and never
 * for an error the caller declared unrecoverable.
 */
export function willBullmqRetry(job: Pick<Job, 'attemptsMade' | 'opts'>, err: unknown): boolean {
  if (err instanceof UnrecoverableError || (err instanceof Error && err.name === 'UnrecoverableError')) return false;
  return job.attemptsMade + 1 < (job.opts.attempts ?? 1);
}

/** The whole policy, in one predicate so it is assertable without a queue. */
export function shouldRetry(job: Pick<Job, 'attemptsMade' | 'opts'>, err: unknown): boolean {
  return !isPermanentFailure(err) && willBullmqRetry(job, err);
}

/** Step text for a row that is going back on the queue. */
export function retryStepLabel(job: Pick<Job, 'attemptsMade' | 'opts'>, message: string): string {
  return `Retrying after error (attempt ${job.attemptsMade + 1} of ${job.opts.attempts ?? 1}): ${message.slice(0, 120)}`;
}

/**
 * Terminal-vs-retrying write for a failed job row. Returns whether the row was
 * left retryable, so the caller can skip the terminal side effects (marking a
 * package failed, telling the user it is over) for a run that is going to
 * happen again in a few seconds.
 *
 * The retrying write is guarded on `status NOT IN ('paused','complete')`: a
 * pause clicked while this attempt was dying is the user's decision and outranks
 * a retry, and a row that somehow already completed is never walked backwards.
 */
export async function recordJobFailure(
  job: Pick<Job, 'attemptsMade' | 'opts'>,
  jobId: string,
  err: unknown,
  message: string,
): Promise<{ retrying: boolean }> {
  if (shouldRetry(job, err)) {
    const step = retryStepLabel(job, message);
    await query(
      `UPDATE analysis_jobs
       SET status = 'queued', current_step = $2, error_message = $3, finished_at = NULL,
           last_heartbeat_at = NOW(),
           step_log = step_log || $4::jsonb
       WHERE id = $1 AND status NOT IN ('paused', 'complete')`,
      [jobId, step, message.slice(0, 500),
       JSON.stringify([{ step, pct: 0, ts: new Date().toISOString() }])],
    );
    return { retrying: true };
  }
  await query(
    `UPDATE analysis_jobs
     SET status = 'failed', current_step = 'Failed', error_message = $1, finished_at = NOW(),
         step_log = step_log || $3::jsonb
     WHERE id = $2`,
    [message, jobId, JSON.stringify([{ step: `Failed: ${message.slice(0, 100)}`, pct: 0, ts: new Date().toISOString() }])],
  );
  return { retrying: false };
}
