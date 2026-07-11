/**
 * Content-addressed semantic record store (doc/Pipeline.md "Cache policy").
 * Records are project-scoped (shared across scopes/snapshots of the same
 * repo); snapshot_semantic_records maps which record is active for which
 * target in a snapshot. Cache key:
 *   project_id + stable_key + evidence_hash + prompt_version + semantic_depth + model_family
 * Depths coexist: a higher-depth record satisfies lower-depth needs, never
 * the reverse.
 */

import { query } from '../../lib/db.js';
import { canonicalJson, computeInputHash } from '../ai/generationRuns.js';
import type { SemanticDepth } from '../engine/budgets.js';
import type { EvidenceGraph, EvidenceNode } from '../types/analysis.js';
import type { DetectedSideEffect } from '../engine/sideEffectDetector.js';
import type { RecordLevel, RecordConfidence, SemanticRecordBody, RecordClaim } from './recordTypes.js';

// ── Evidence hashing ─────────────────────────────────────────────────────────

/**
 * Symbol evidence = its own hashes + callers/callees identity + detected
 * side effects + behavior signals. Unchanged evidence -> cache hit.
 */
export function evidenceHashForSymbol(
  node: EvidenceNode,
  graph: EvidenceGraph,
  sideEffects: DetectedSideEffect[],
): string {
  const callers: Array<{ key: string; hash: string | null }> = [];
  const callees: Array<{ key: string; hash: string | null }> = [];
  const nodeHash = new Map(graph.nodes.map((n) => [n.stableKey, n.hash ?? null]));
  for (const e of graph.edges) {
    if (e.type !== 'calls') continue;
    if (e.targetKey === node.stableKey) callers.push({ key: e.sourceKey, hash: nodeHash.get(e.sourceKey) ?? null });
    if (e.sourceKey === node.stableKey) callees.push({ key: e.targetKey, hash: nodeHash.get(e.targetKey) ?? null });
  }
  const effects = sideEffects
    .filter((s) => s.symbolStableKey === node.stableKey || s.nodeStableKey === node.stableKey)
    .map((s) => ({ kind: s.kind, target: s.target ?? null }));
  const sortByKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
  return computeInputHash({
    stableKey: node.stableKey,
    signatureHash: node.signatureHash ?? null,
    bodyHash: node.bodyHash ?? node.hash ?? null,
    callers: callers.sort(sortByKey),
    callees: callees.sort(sortByKey),
    sideEffects: effects.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    behaviorSignals: node.metadata.behaviorSignals ?? null,
  });
}

/** Synthesis-level evidence = child record identities + level-local facts. */
export function evidenceHashForChildren(
  children: Array<{ id: string; evidenceHash: string }>,
  localFacts: unknown = null,
): string {
  return computeInputHash({
    children: children
      .map((c) => ({ id: c.id, evidenceHash: c.evidenceHash }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    localFacts,
  });
}

// ── Records ──────────────────────────────────────────────────────────────────

export interface StoredRecord {
  id: string;
  stableKey: string;
  recordLevel: RecordLevel;
  semanticDepth: SemanticDepth;
  evidenceHash: string;
  promptVersion: string;
  record: SemanticRecordBody;
  summary: string;
  confidence: RecordConfidence;
  factsOnly: boolean;
  status: 'pending' | 'usable' | 'rejected' | 'superseded';
  receiptIds: string[];
}

/**
 * Depth-layered lookup order (spec): standard needs try full then standard;
 * cheap needs try full, standard, then cheap; full needs accept full only.
 */
export function depthLookupOrder(depth: SemanticDepth): SemanticDepth[] {
  if (depth === 'full') return ['full'];
  if (depth === 'standard') return ['full', 'standard'];
  return ['full', 'standard', 'cheap'];
}

export interface RecordCacheKey {
  projectId: string;
  stableKey: string;
  level: RecordLevel;
  evidenceHash: string;
  promptVersion: string;
  depth: SemanticDepth;
  modelFamily: string;
}

/**
 * Cache lookup honoring depth layering. 'superseded' records are never
 * reused; 'rejected' ones are returned so a failed record stays an honest
 * unknown instead of being re-paid every snapshot.
 */
export async function lookupRecord(key: RecordCacheKey): Promise<StoredRecord | null> {
  const result = await query(
    `SELECT id, stable_key, record_level, semantic_depth, evidence_hash, prompt_version,
            record, summary, confidence, facts_only, status, receipt_ids
     FROM semantic_records
     WHERE project_id = $1 AND stable_key = $2 AND record_level = $3
       AND evidence_hash = $4 AND prompt_version = $5 AND model_family = $6
       AND semantic_depth = ANY($7)
       AND status <> 'superseded'
     ORDER BY array_position($7, semantic_depth), created_at DESC
     LIMIT 1`,
    [key.projectId, key.stableKey, key.level, key.evidenceHash, key.promptVersion,
     key.modelFamily, depthLookupOrder(key.depth)],
  );
  const row = result.rows[0] as {
    id: string; stable_key: string; record_level: RecordLevel; semantic_depth: SemanticDepth;
    evidence_hash: string; prompt_version: string; record: SemanticRecordBody; summary: string;
    confidence: RecordConfidence; facts_only: boolean; status: StoredRecord['status']; receipt_ids: string[];
  } | undefined;
  if (!row) return null;
  return {
    id: row.id, stableKey: row.stable_key, recordLevel: row.record_level,
    semanticDepth: row.semantic_depth, evidenceHash: row.evidence_hash,
    promptVersion: row.prompt_version, record: row.record, summary: row.summary,
    confidence: row.confidence, factsOnly: row.facts_only, status: row.status,
    receiptIds: row.receipt_ids ?? [],
  };
}

export interface InsertRecordInput {
  key: RecordCacheKey;
  record: SemanticRecordBody;
  summary: string;
  confidence: RecordConfidence;
  factsOnly: boolean;
  status: 'pending' | 'usable';
  flags?: Array<Record<string, unknown>>;
  childRecordIds?: string[];
  model?: string | null;
  tokenUsage?: Record<string, number>;
}

export async function insertRecord(input: InsertRecordInput): Promise<StoredRecord> {
  const k = input.key;
  // A new version of the SAME prompt (stale evidence or different model
  // family) supersedes the old one for audit. Different prompt versions
  // coexist — refinement-v1 records layer on top of symbol-record-v1
  // records without invalidating them — as do different depths.
  await query(
    `UPDATE semantic_records SET status = 'superseded'
     WHERE project_id = $1 AND stable_key = $2 AND record_level = $3 AND semantic_depth = $4
       AND prompt_version = $6 AND status <> 'superseded'
       AND (evidence_hash <> $5 OR model_family <> $7)`,
    [k.projectId, k.stableKey, k.level, k.depth, k.evidenceHash, k.promptVersion, k.modelFamily],
  );
  const result = await query(
    `INSERT INTO semantic_records
       (project_id, stable_key, record_level, semantic_depth, evidence_hash, prompt_version,
        model_family, record, summary, confidence, facts_only, status, flags,
        child_record_ids, model, token_usage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (project_id, stable_key, evidence_hash, prompt_version, semantic_depth, model_family)
       DO UPDATE SET record = EXCLUDED.record, summary = EXCLUDED.summary,
                     confidence = EXCLUDED.confidence, status = EXCLUDED.status,
                     flags = EXCLUDED.flags
     RETURNING id`,
    [k.projectId, k.stableKey, k.level, k.depth, k.evidenceHash, k.promptVersion, k.modelFamily,
     JSON.stringify(input.record), input.summary, input.confidence, input.factsOnly, input.status,
     JSON.stringify(input.flags ?? []), input.childRecordIds ?? [], input.model ?? null,
     JSON.stringify(input.tokenUsage ?? {})],
  );
  return {
    id: (result.rows[0] as { id: string }).id,
    stableKey: k.stableKey, recordLevel: k.level, semanticDepth: k.depth,
    evidenceHash: k.evidenceHash, promptVersion: k.promptVersion,
    record: input.record, summary: input.summary, confidence: input.confidence,
    factsOnly: input.factsOnly, status: input.status, receiptIds: [],
  };
}

/** Marks a record as the active one for its target in this snapshot. */
export async function mapToSnapshot(
  snapshotId: string,
  record: StoredRecord,
  nodeId: string | null,
): Promise<void> {
  // One active record per (snapshot, stable_key, level): replace any previous mapping.
  await query(
    `DELETE FROM snapshot_semantic_records
     WHERE snapshot_id = $1 AND stable_key = $2 AND record_level = $3`,
    [snapshotId, record.stableKey, record.recordLevel],
  );
  await query(
    `INSERT INTO snapshot_semantic_records (snapshot_id, record_id, node_id, stable_key, record_level)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (snapshot_id, record_id) DO NOTHING`,
    [snapshotId, record.id, nodeId, record.stableKey, record.recordLevel],
  );
}

export async function setRecordStatus(
  recordId: string,
  status: 'usable' | 'rejected',
  flags?: Array<Record<string, unknown>>,
): Promise<void> {
  await query(
    `UPDATE semantic_records SET status = $2, flags = flags || $3::jsonb WHERE id = $1`,
    [recordId, status, JSON.stringify(flags ?? [])],
  );
}

// ── Receipts ─────────────────────────────────────────────────────────────────

export interface ReceiptDraft {
  /** Prompt alias, e.g. 'r1' — claims cite these before persistence. */
  alias: string;
  kind: 'code_snippet' | 'config_snippet' | 'doc_snippet' | 'graph_edge' | 'workflow_step' | 'record_reference';
  trustLevel: 'code' | 'config' | 'tests' | 'docs' | 'llm_inference';
  nodeId?: string | null;
  nodeStableKey?: string;
  nodeHash?: string | null;
  filePath?: string | null;
  symbolName?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  snippet?: string | null;
  detectionExpression?: string | null;
  referencedRecordId?: string | null;
}

/**
 * Persists a record's receipts, resolves prompt aliases in claims to real
 * receipt UUIDs, and stamps receipt_ids + rewritten claims onto the record.
 */
export async function attachReceipts(params: {
  projectId: string;
  snapshotId: string;
  commitHash: string;
  record: StoredRecord;
  drafts: ReceiptDraft[];
}): Promise<Map<string, string>> {
  const aliasToId = new Map<string, string>();
  for (const d of params.drafts) {
    const result = await query(
      `INSERT INTO source_receipts
         (project_id, snapshot_id, receipt_kind, trust_level, record_id, node_id,
          referenced_record_id, node_stable_key, node_hash, file_path, symbol_name,
          line_start, line_end, snippet, detection_expression, commit_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [params.projectId, params.snapshotId, d.kind, d.trustLevel, params.record.id,
       d.nodeId ?? null, d.referencedRecordId ?? null, d.nodeStableKey ?? null, d.nodeHash ?? null,
       d.filePath ?? null, d.symbolName ?? null, d.lineStart ?? null, d.lineEnd ?? null,
       d.snippet ?? null, d.detectionExpression ?? null, params.commitHash],
    );
    aliasToId.set(d.alias, (result.rows[0] as { id: string }).id);
  }

  // Unknown aliases (hallucinated receipt ids) are dropped, not kept as junk.
  const rewrittenClaims: RecordClaim[] = (params.record.record.claims ?? []).map((c) => ({
    ...c,
    receiptIds: c.receiptIds.map((alias) => aliasToId.get(alias) ?? alias).filter(isUuid),
  }));
  const receiptIds = [...aliasToId.values()];
  params.record.record.claims = rewrittenClaims;
  params.record.receiptIds = receiptIds;
  await query(
    `UPDATE semantic_records
     SET receipt_ids = $2, record = jsonb_set(record, '{claims}', $3::jsonb)
     WHERE id = $1`,
    [params.record.id, receiptIds, JSON.stringify(rewrittenClaims)],
  );
  return aliasToId;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
