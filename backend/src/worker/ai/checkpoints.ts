/**
 * Phase checkpointing (doc/Pipeline.md "Checkpointing and resume"): every
 * phase writes a snapshot_phases row with status, metrics, and a resume
 * checkpoint. LLM phases iterate deterministic target lists and store
 * their cursor here; on resume the target list is recomputed and
 * already-persisted work is skipped.
 */

import { query } from '../../lib/db.js';

export type PhaseStatus = 'pending' | 'running' | 'complete' | 'failed' | 'paused' | 'skipped';

export interface PhaseRow {
  phase: string;
  status: PhaseStatus;
  metrics: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  error_message: string | null;
}

/** Upserts a snapshot phase-status row. Metrics merge; checkpoint replaces when provided. */
export async function markPhase(
  snapshotId: string,
  phase: string,
  status: 'running' | 'complete' | 'failed' | 'skipped' | 'paused',
  metrics: Record<string, unknown> = {},
  opts: { checkpoint?: Record<string, unknown>; errorMessage?: string } = {},
): Promise<void> {
  await query(
    `INSERT INTO snapshot_phases (snapshot_id, phase, status, started_at, finished_at, metrics, checkpoint, error_message)
     VALUES ($1, $2, $3::varchar, NOW(),
             CASE WHEN $3::varchar IN ('complete', 'failed', 'skipped') THEN NOW() ELSE NULL END,
             $4, COALESCE($5::jsonb, '{}'::jsonb), $6)
     ON CONFLICT (snapshot_id, phase) DO UPDATE
       SET status = EXCLUDED.status,
           -- Re-analyzing the same commit upserts the same snapshot row, so a
           -- phase marked 'running' again — or marked anything after a
           -- terminal state — is a NEW run of that phase: restart its clock.
           -- Keeping the original started_at timed phases from the first run
           -- ever to the latest finish (hours-long phantom durations).
           started_at = CASE
             WHEN EXCLUDED.status = 'running'
               OR snapshot_phases.status IN ('complete', 'failed', 'skipped')
             THEN NOW()
             ELSE snapshot_phases.started_at
           END,
           finished_at = EXCLUDED.finished_at,
           metrics = snapshot_phases.metrics || EXCLUDED.metrics,
           checkpoint = CASE WHEN $5::jsonb IS NULL THEN snapshot_phases.checkpoint ELSE EXCLUDED.checkpoint END,
           error_message = EXCLUDED.error_message`,
    [snapshotId, phase, status, JSON.stringify(metrics),
     opts.checkpoint === undefined ? null : JSON.stringify(opts.checkpoint),
     opts.errorMessage ?? null],
  );
}

export async function getPhase(snapshotId: string, phase: string): Promise<PhaseRow | null> {
  const result = await query(
    `SELECT phase, status, metrics, checkpoint, error_message FROM snapshot_phases WHERE snapshot_id = $1 AND phase = $2`,
    [snapshotId, phase],
  );
  return (result.rows[0] as PhaseRow | undefined) ?? null;
}

/** True when the phase already finished for this snapshot — resume skips it. */
export async function isPhaseComplete(snapshotId: string, phase: string): Promise<boolean> {
  const row = await getPhase(snapshotId, phase);
  return row?.status === 'complete' || row?.status === 'skipped';
}
