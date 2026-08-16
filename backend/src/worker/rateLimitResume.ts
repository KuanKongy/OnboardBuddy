/**
 * Bounded auto-resume for runs paused by provider rate limiting.
 *
 * The in-process rate-limit gate (`ai/rateLimitGate.ts`) already absorbs a
 * burst: whoever draws the 429 closes the window and every sibling call in the
 * process stops dispatching until it reopens. That budget is finite — six
 * waits at 15s/30s/60s caps out around 285s — and SUSTAINED pressure on the
 * key (someone else's soak on the same OPENROUTER_API_KEY, an upstream in a
 * bad hour) outlasts it. The run then pauses with a message that reads like a
 * product failure, and the only cure is a human noticing and pressing Resume
 * on a run that would have finished by itself five minutes later.
 *
 * This is the safety net for exactly that case, and nothing else. A 429 is the
 * one failure that resolves purely by waiting, so it is the one a resume can
 * be SCHEDULED for rather than asked for. Everything else that pauses a run
 * (budget trips, tier `pause` behavior, a broken call) still stops and waits
 * for a person, because re-running it would just re-fail.
 *
 * ── Why this is not a retry loop ──────────────────────────────────────────
 * Same three bounds as `jobRecovery.ts`, for the same reason — a rate limit
 * that never lifts would otherwise re-queue forever:
 *
 *   1. The count is DURABLE, in `analysis_jobs.checkpoint->>'rateLimitResumes'`
 *      (jsonb, no schema change — M5 froze the schema). BullMQ's own
 *      `attemptsMade` resets on a fresh enqueue and cannot bound this.
 *   2. It is incremented BY THE CLAIM, before the job goes back on the queue.
 *   3. `MAX_RATE_LIMIT_RESUMES` caps it. Past the cap the claim returns null
 *      and the caller falls through to the ordinary pause, so the run ends up
 *      exactly where it would have without this module.
 *
 * Deliberately dependency-light (`lib/db` + the env helper): both workers
 * construct BullMQ consumers at module load, so anything importing
 * `worker/index.ts` or `summaryWorker.ts` opens a Redis connection. Keeping
 * the policy and the claim here is what makes them assertable — same rule as
 * `runStatus.ts`.
 */

import { query } from '../lib/db.js';
import { envInt } from '../lib/env.js';

/**
 * How many times one job row may auto-resume itself out of a rate-limit
 * pause. 3 covers ~15 minutes of sustained pressure on the key; past that the
 * provider is not having a bad minute, and a human should see the pause.
 */
export const MAX_RATE_LIMIT_RESUMES = envInt('RATE_LIMIT_RESUME_MAX', 3);

/**
 * How long to wait before the re-queued job runs. Long enough that the next
 * attempt is not just another 429 (the in-process gate already spent ~285s
 * failing to wait it out), short enough that a watching user sees the run move
 * again rather than concluding it died.
 */
export const RATE_LIMIT_RESUME_DELAY_MS = envInt('RATE_LIMIT_RESUME_DELAY_MS', 300_000);

/** The analysis_jobs fields needed to rebuild the enqueue payload. */
export interface RateLimitResumeClaim {
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
  /** The resume count AFTER this claim incremented it. 1 = first auto-resume. */
  attempt: number;
}

/**
 * True only for a pause the provider's rate limiter caused. Matched by NAME
 * rather than by class so this module stays free of the AI layer's imports
 * (see the header); same rule as `runStatus.isRunControlError`.
 *
 * The `rateLimited === true` half is not optional: an `AiPausedError` from a
 * budget trip or a broken call carries `false`, and auto-resuming those would
 * burn the cap on runs that are going to re-fail identically.
 */
export function isRateLimitPause(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== 'AiPausedError') return false;
  return (err as Error & { rateLimited?: unknown }).rateLimited === true;
}

/** "5 min" / "45s" — so the banner stays truthful when the env knob moves. */
function delayLabel(ms: number): string {
  // Threshold on the raw ms, not on the rounded minutes: rounding first turns a
  // 45s delay into "~1 min" in a banner a user is watching a clock against.
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.max(1, Math.round(ms / 1_000))}s`;
}

/**
 * Claims one auto-resume for `jobId` and hands back what the caller needs to
 * re-enqueue it, or null when the cap is spent or the row is no longer this
 * worker's to move.
 *
 * ONE statement, predicate and write together, for the same reason
 * `jobRecovery.claimOrphans` is: the claim is what makes double-enqueue
 * impossible. Two catch sites firing on the same row (a chained generation, a
 * retried delivery) or a kill switch landing mid-catch both resolve here —
 * whoever loses re-evaluates `status = 'running'` against the committed row,
 * finds it 'queued' or 'failed', and gets null. A user pressing Stop is
 * likewise final: the row leaves 'running' and no resume can be claimed for it.
 */
export async function claimRateLimitResume(
  jobId: string,
  max = MAX_RATE_LIMIT_RESUMES,
  delayMs = RATE_LIMIT_RESUME_DELAY_MS,
): Promise<RateLimitResumeClaim | null> {
  const result = await query(
    `UPDATE analysis_jobs
     SET status = 'queued',
         current_step = 'Rate limited by the LLM provider — retrying automatically in ~'
           || $3::text || ' (attempt '
           || (COALESCE((checkpoint->>'rateLimitResumes')::int, 0) + 1)::text
           || '/' || $2::text || ')',
         error_message = NULL,
         finished_at = NULL,
         -- NOW(), not NULL as POST /resume writes: this row is about to sit in
         -- 'queued' for the whole delay window, and the stranded-queued sweep
         -- judges age by COALESCE(last_heartbeat_at, started_at, created_at) —
         -- a NULL here would hand it started_at, minutes old by the time a
         -- semantic phase gets rate limited, making a live delayed job a
         -- candidate for being failed. Same choice, same reason, as
         -- jobRecovery.claimOrphans.
         last_heartbeat_at = NOW(),
         checkpoint = jsonb_set(
           COALESCE(checkpoint, '{}'::jsonb), '{rateLimitResumes}',
           to_jsonb(COALESCE((checkpoint->>'rateLimitResumes')::int, 0) + 1), true),
         step_log = step_log || jsonb_build_array(jsonb_build_object(
           'step', 'Rate limited by the provider, auto-resume scheduled',
           'pct', progress_pct, 'ts', NOW()))
     WHERE id = $1 AND status = 'running'
       AND COALESCE((checkpoint->>'rateLimitResumes')::int, 0) < $2
     RETURNING id, project_id, snapshot_id, job_type, scope_id, branch, commit_hash,
               semantic_depth, role, requested_by,
               COALESCE((checkpoint->>'rateLimitResumes')::int, 1) AS attempt`,
    [jobId, max, delayLabel(delayMs)],
  );
  return (result.rows[0] as RateLimitResumeClaim | undefined) ?? null;
}
