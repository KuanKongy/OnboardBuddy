/**
 * ai_generation_runs auditing (doc/Pipeline.md "Auditing"): every LLM and
 * embedding call gets a row with provider, model, tier, key source, prompt
 * version, input/output hashes, token usage, estimated cost, latency, and
 * status. input_hash makes batches skippable on retry — a request whose
 * hash already has a 'complete' row is recorded as 'skipped_cached'.
 */

import crypto from 'node:crypto';
import { query } from '../../lib/db.js';
import type { ModelTier, TokenUsage } from './provider.js';
import type { KeySource } from './keyResolver.js';

/** Stable stringify: objects get sorted keys recursively so hashing is order-independent. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function computeInputHash(payload: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export function computeOutputHash(output: string): string {
  return crypto.createHash('sha256').update(output).digest('hex');
}

export interface RunIdentity {
  snapshotId: string;
  packageId?: string | null;
  /** analysis_jobs row this call ran under — per-job cost rollups. Null for /ask. */
  jobId?: string | null;
  targetType: string; // symbol_record | section | tutorial | embedding_batch | ...
  targetId?: string | null;
  sectionType?: string | null;
  provider: string;
  model: string;
  modelTier: ModelTier;
  keySource: KeySource;
  promptVersion: string;
  inputHash: string;
}

export async function hasCompleteRun(snapshotId: string, inputHash: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM ai_generation_runs WHERE snapshot_id = $1 AND input_hash = $2 AND status = 'complete' LIMIT 1`,
    [snapshotId, inputHash],
  );
  return result.rows.length > 0;
}

export async function startRun(identity: RunIdentity): Promise<string> {
  const result = await query(
    `INSERT INTO ai_generation_runs
       (snapshot_id, package_id, job_id, target_type, target_id, section_type, provider, model,
        model_tier, key_source, prompt_version, input_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'running')
     RETURNING id`,
    [identity.snapshotId, identity.packageId ?? null, identity.jobId ?? null, identity.targetType,
     identity.targetId ?? null, identity.sectionType ?? null, identity.provider, identity.model,
     identity.modelTier, identity.keySource, identity.promptVersion, identity.inputHash],
  );
  return (result.rows[0] as { id: string }).id;
}

export async function finishRun(runId: string, outcome: {
  status: 'complete' | 'failed';
  outputHash?: string;
  tokenUsage?: TokenUsage;
  estimatedCostUsd?: number;
  latencyMs?: number;
  errorMessage?: string;
}): Promise<void> {
  await query(
    `UPDATE ai_generation_runs
     SET status = $2, output_hash = $3, token_usage = $4, estimated_cost_usd = $5,
         latency_ms = $6, error_message = $7, finished_at = NOW()
     WHERE id = $1`,
    [runId, outcome.status, outcome.outputHash ?? null,
     JSON.stringify(outcome.tokenUsage ?? {}), outcome.estimatedCostUsd ?? null,
     outcome.latencyMs ?? null, outcome.errorMessage ?? null],
  );
}

/** Records a batch that was skipped because an identical complete run exists. */
export async function recordSkippedCached(identity: RunIdentity): Promise<string> {
  const result = await query(
    `INSERT INTO ai_generation_runs
       (snapshot_id, package_id, job_id, target_type, target_id, section_type, provider, model,
        model_tier, key_source, prompt_version, input_hash, status, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'skipped_cached', NOW())
     RETURNING id`,
    [identity.snapshotId, identity.packageId ?? null, identity.jobId ?? null, identity.targetType,
     identity.targetId ?? null, identity.sectionType ?? null, identity.provider, identity.model,
     identity.modelTier, identity.keySource, identity.promptVersion, identity.inputHash],
  );
  return (result.rows[0] as { id: string }).id;
}
