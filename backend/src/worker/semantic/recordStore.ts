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

/** Vectorized setRecordStatus — one statement per critique batch (Track C). */
export async function setRecordStatusBulk(
  updates: Array<{ id: string; status: 'usable' | 'rejected'; flags?: Array<Record<string, unknown>> }>,
): Promise<void> {
  if (updates.length === 0) return;
  await query(
    `UPDATE semantic_records sr
     SET status = u.status, flags = sr.flags || u.flags
     FROM jsonb_to_recordset($1::jsonb) AS u(id uuid, status text, flags jsonb)
     WHERE sr.id = u.id`,
    [JSON.stringify(updates.map((u) => ({ id: u.id, status: u.status, flags: u.flags ?? [] })))],
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
  /** Original lineEnd when the span was capped (receiptSpan.capReceiptSpan). */
  truncatedFromLineEnd?: number | null;
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
          line_start, line_end, snippet, detection_expression, commit_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id`,
      [params.projectId, params.snapshotId, d.kind, d.trustLevel, params.record.id,
       d.nodeId ?? null, d.referencedRecordId ?? null, d.nodeStableKey ?? null, d.nodeHash ?? null,
       d.filePath ?? null, d.symbolName ?? null, d.lineStart ?? null, d.lineEnd ?? null,
       d.snippet ?? null, d.detectionExpression ?? null, params.commitHash,
       JSON.stringify(d.truncatedFromLineEnd != null ? { truncatedFromLineEnd: d.truncatedFromLineEnd } : {})],
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

// ── Bulk variants (latency overhaul Track C) ────────────────────────────────
// The single-row functions above stay for low-volume callers (regeneration,
// refinement, capabilities) and existing tests; the passes that touch
// hundreds of records use these to collapse per-record round-trips to the
// cloud pooler into a handful of vectorized statements per batch.

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Per-pass shared key fields; only stableKey/evidenceHash vary per entry. */
export interface BulkKeyBase {
  projectId: string;
  level: RecordLevel;
  promptVersion: string;
  depth: SemanticDepth;
  modelFamily: string;
}

/**
 * Bulk cache lookup: one round trip per 2,000 keys instead of one per key.
 * Same semantics as lookupRecord (depth layering via array_position,
 * superseded excluded, newest first) — DISTINCT ON picks the best row per
 * stable key. Returns a map keyed by stableKey.
 */
export async function lookupRecords(
  base: BulkKeyBase,
  entries: Array<{ stableKey: string; evidenceHash: string }>,
): Promise<Map<string, StoredRecord>> {
  const found = new Map<string, StoredRecord>();
  const depths = depthLookupOrder(base.depth);
  for (const part of chunk(entries, 2_000)) {
    const result = await query(
      `SELECT DISTINCT ON (sr.stable_key)
              sr.id, sr.stable_key, sr.record_level, sr.semantic_depth, sr.evidence_hash,
              sr.prompt_version, sr.record, sr.summary, sr.confidence, sr.facts_only,
              sr.status, sr.receipt_ids
       FROM semantic_records sr
       JOIN unnest($2::text[], $3::text[]) AS k(stable_key, evidence_hash)
         ON sr.stable_key = k.stable_key AND sr.evidence_hash = k.evidence_hash
       WHERE sr.project_id = $1 AND sr.record_level = $4 AND sr.prompt_version = $5
         AND sr.model_family = $6 AND sr.semantic_depth = ANY($7)
         AND sr.status <> 'superseded'
       ORDER BY sr.stable_key, array_position($7, sr.semantic_depth), sr.created_at DESC`,
      [base.projectId, part.map((e) => e.stableKey), part.map((e) => e.evidenceHash),
       base.level, base.promptVersion, base.modelFamily, depths],
    );
    for (const row of result.rows as Array<{
      id: string; stable_key: string; record_level: RecordLevel; semantic_depth: SemanticDepth;
      evidence_hash: string; prompt_version: string; record: SemanticRecordBody; summary: string;
      confidence: RecordConfidence; facts_only: boolean; status: StoredRecord['status']; receipt_ids: string[];
    }>) {
      found.set(row.stable_key, {
        id: row.id, stableKey: row.stable_key, recordLevel: row.record_level,
        semanticDepth: row.semantic_depth, evidenceHash: row.evidence_hash,
        promptVersion: row.prompt_version, record: row.record, summary: row.summary,
        confidence: row.confidence, factsOnly: row.facts_only, status: row.status,
        receiptIds: row.receipt_ids ?? [],
      });
    }
  }
  return found;
}

/**
 * Bulk insert: one vectorized supersede + one multi-VALUES upsert per 500
 * records (identical SQL effects to insertRecord). All inputs must share
 * the same base key fields — passes call this per level. Returns stored
 * records keyed by stableKey.
 */
export async function insertRecordsBulk(inputs: InsertRecordInput[]): Promise<Map<string, StoredRecord>> {
  const out = new Map<string, StoredRecord>();
  if (inputs.length === 0) return out;
  const k0 = inputs[0]!.key;
  for (const input of inputs) {
    const k = input.key;
    if (k.projectId !== k0.projectId || k.level !== k0.level || k.depth !== k0.depth
      || k.promptVersion !== k0.promptVersion || k.modelFamily !== k0.modelFamily) {
      throw new Error('insertRecordsBulk requires a shared base key (projectId/level/depth/promptVersion/modelFamily)');
    }
  }

  for (const part of chunk(inputs, 500)) {
    await query(
      `UPDATE semantic_records sr SET status = 'superseded'
       FROM unnest($4::text[], $5::text[]) AS k(stable_key, evidence_hash)
       WHERE sr.project_id = $1 AND sr.stable_key = k.stable_key AND sr.record_level = $2
         AND sr.semantic_depth = $3 AND sr.prompt_version = $6 AND sr.status <> 'superseded'
         AND (sr.evidence_hash <> k.evidence_hash OR sr.model_family <> $7)`,
      [k0.projectId, k0.level, k0.depth,
       part.map((i) => i.key.stableKey), part.map((i) => i.key.evidenceHash),
       k0.promptVersion, k0.modelFamily],
    );

    const cols = 16;
    const values: unknown[] = [];
    const tuples = part.map((input, i) => {
      const k = input.key;
      values.push(
        k.projectId, k.stableKey, k.level, k.depth, k.evidenceHash, k.promptVersion, k.modelFamily,
        JSON.stringify(input.record), input.summary, input.confidence, input.factsOnly, input.status,
        JSON.stringify(input.flags ?? []), input.childRecordIds ?? [], input.model ?? null,
        JSON.stringify(input.tokenUsage ?? {}),
      );
      const base = i * cols;
      return `(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(', ')})`;
    });
    const result = await query(
      `INSERT INTO semantic_records
         (project_id, stable_key, record_level, semantic_depth, evidence_hash, prompt_version,
          model_family, record, summary, confidence, facts_only, status, flags,
          child_record_ids, model, token_usage)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (project_id, stable_key, evidence_hash, prompt_version, semantic_depth, model_family)
         DO UPDATE SET record = EXCLUDED.record, summary = EXCLUDED.summary,
                       confidence = EXCLUDED.confidence, status = EXCLUDED.status,
                       flags = EXCLUDED.flags
       RETURNING id, stable_key`,
      values,
    );
    const idByKey = new Map(
      (result.rows as Array<{ id: string; stable_key: string }>).map((r) => [r.stable_key, r.id]),
    );
    for (const input of part) {
      const id = idByKey.get(input.key.stableKey);
      if (!id) throw new Error(`insertRecordsBulk: no id returned for ${input.key.stableKey}`);
      out.set(input.key.stableKey, {
        id, stableKey: input.key.stableKey, recordLevel: input.key.level,
        semanticDepth: input.key.depth, evidenceHash: input.key.evidenceHash,
        promptVersion: input.key.promptVersion, record: input.record, summary: input.summary,
        confidence: input.confidence, factsOnly: input.factsOnly, status: input.status,
        receiptIds: [],
      });
    }
  }
  return out;
}

/**
 * Bulk receipt attach: one multi-VALUES INSERT for every draft in the batch
 * plus one jsonb_to_recordset UPDATE stamping receipt_ids + rewritten
 * claims — instead of (drafts + 1) statements per record. Alias→UUID
 * rewriting and the hallucinated-alias drop rule match attachReceipts.
 */
export async function attachReceiptsBulk(params: {
  projectId: string;
  snapshotId: string;
  commitHash: string;
  items: Array<{ record: StoredRecord; drafts: ReceiptDraft[] }>;
}): Promise<void> {
  const withDrafts = params.items.filter((i) => i.drafts.length > 0);
  if (withDrafts.length === 0) return;

  const flat = withDrafts.flatMap((item) =>
    item.drafts.map((draft) => ({ recordId: item.record.id, draft })),
  );

  const aliasByRecord = new Map<string, Map<string, string>>();
  for (const part of chunk(flat, 500)) {
    const cols = 17;
    const values: unknown[] = [];
    const tuples = part.map(({ recordId, draft: d }, i) => {
      values.push(
        params.projectId, params.snapshotId, d.kind, d.trustLevel, recordId,
        d.nodeId ?? null, d.referencedRecordId ?? null, d.nodeStableKey ?? null, d.nodeHash ?? null,
        d.filePath ?? null, d.symbolName ?? null, d.lineStart ?? null, d.lineEnd ?? null,
        d.snippet ?? null, d.detectionExpression ?? null, params.commitHash,
        JSON.stringify(d.truncatedFromLineEnd != null ? { truncatedFromLineEnd: d.truncatedFromLineEnd } : {}),
      );
      const base = i * cols;
      return `(${Array.from({ length: cols }, (_, j) => `$${base + j + 1}`).join(', ')})`;
    });
    const result = await query(
      `INSERT INTO source_receipts
         (project_id, snapshot_id, receipt_kind, trust_level, record_id, node_id,
          referenced_record_id, node_stable_key, node_hash, file_path, symbol_name,
          line_start, line_end, snippet, detection_expression, commit_hash, metadata)
       VALUES ${tuples.join(', ')}
       RETURNING id, record_id`,
      values,
    );
    const rows = result.rows as Array<{ id: string; record_id: string }>;
    if (rows.length !== part.length) {
      throw new Error(`attachReceiptsBulk: inserted ${rows.length} receipts for ${part.length} drafts`);
    }
    rows.forEach((row, i) => {
      const { recordId, draft } = part[i]!;
      // Multi-VALUES RETURNING preserves insertion order; the record_id
      // check guards the assumption instead of trusting it silently.
      if (row.record_id !== recordId) {
        throw new Error('attachReceiptsBulk: RETURNING order diverged from VALUES order');
      }
      if (!aliasByRecord.has(recordId)) aliasByRecord.set(recordId, new Map());
      aliasByRecord.get(recordId)!.set(draft.alias, row.id);
    });
  }

  const updates = withDrafts.map(({ record }) => {
    const aliasToId = aliasByRecord.get(record.id) ?? new Map<string, string>();
    const rewrittenClaims: RecordClaim[] = (record.record.claims ?? []).map((c) => ({
      ...c,
      receiptIds: c.receiptIds.map((alias) => aliasToId.get(alias) ?? alias).filter(isUuid),
    }));
    const receiptIds = [...aliasToId.values()];
    record.record.claims = rewrittenClaims;
    record.receiptIds = receiptIds;
    return { id: record.id, rids: receiptIds, claims: rewrittenClaims };
  });
  await query(
    `UPDATE semantic_records sr
     SET receipt_ids = ARRAY(SELECT jsonb_array_elements_text(u.rids))::uuid[],
         record = jsonb_set(sr.record, '{claims}', u.claims)
     FROM jsonb_to_recordset($1::jsonb) AS u(id uuid, rids jsonb, claims jsonb)
     WHERE sr.id = u.id`,
    [JSON.stringify(updates)],
  );
}

/** Prior mapping identity for the carry-forward gate (Track E). */
export interface PriorSymbolRecord extends StoredRecord {
  modelFamily: string;
}

/**
 * Captures the symbol-level record identity mapped by a snapshot BEFORE the
 * mappings are deleted for a re-scan (Track E carry-forward): unchanged
 * symbols re-map in bulk without cache lookups or LLM calls. Prefers the
 * snapshot's own rows (same-commit rescan); falls back to the previous
 * complete snapshot's (new commit).
 */
export async function capturePriorSymbolRecords(
  snapshotId: string,
  prevSnapshotId: string | null,
): Promise<Map<string, PriorSymbolRecord>> {
  const load = async (fromSnapshot: string): Promise<Map<string, PriorSymbolRecord>> => {
    const rows = (await query(
      `SELECT ssr.stable_key, sr.id, sr.record_level, sr.semantic_depth, sr.evidence_hash,
              sr.prompt_version, sr.model_family, sr.record, sr.summary, sr.confidence,
              sr.facts_only, sr.status, sr.receipt_ids
       FROM snapshot_semantic_records ssr
       JOIN semantic_records sr ON sr.id = ssr.record_id
       WHERE ssr.snapshot_id = $1 AND ssr.record_level = 'symbol'
         AND sr.status <> 'superseded'`,
      [fromSnapshot],
    )).rows as Array<{
      stable_key: string; id: string; record_level: RecordLevel; semantic_depth: SemanticDepth;
      evidence_hash: string; prompt_version: string; model_family: string;
      record: SemanticRecordBody; summary: string; confidence: RecordConfidence;
      facts_only: boolean; status: StoredRecord['status']; receipt_ids: string[];
    }>;
    return new Map(rows.map((r) => [r.stable_key, {
      id: r.id, stableKey: r.stable_key, recordLevel: r.record_level,
      semanticDepth: r.semantic_depth, evidenceHash: r.evidence_hash,
      promptVersion: r.prompt_version, record: r.record, summary: r.summary,
      confidence: r.confidence, factsOnly: r.facts_only, status: r.status,
      receiptIds: r.receipt_ids ?? [], modelFamily: r.model_family,
    }]));
  };
  const own = await load(snapshotId);
  if (own.size > 0 || !prevSnapshotId) return own;
  return load(prevSnapshotId);
}

/**
 * Bulk snapshot mapping: vectorized DELETE + one multi-VALUES INSERT per
 * 1,000 entries (same replace-previous-mapping semantics as mapToSnapshot).
 */
export async function mapToSnapshotBulk(
  snapshotId: string,
  entries: Array<{ record: StoredRecord; nodeId: string | null }>,
): Promise<void> {
  for (const part of chunk(entries, 1_000)) {
    await query(
      `DELETE FROM snapshot_semantic_records ssr
       USING unnest($2::text[], $3::text[]) AS k(stable_key, record_level)
       WHERE ssr.snapshot_id = $1 AND ssr.stable_key = k.stable_key
         AND ssr.record_level = k.record_level`,
      [snapshotId, part.map((e) => e.record.stableKey), part.map((e) => e.record.recordLevel)],
    );
    const values: unknown[] = [];
    const tuples = part.map((e, i) => {
      values.push(snapshotId, e.record.id, e.nodeId, e.record.stableKey, e.record.recordLevel);
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    await query(
      `INSERT INTO snapshot_semantic_records (snapshot_id, record_id, node_id, stable_key, record_level)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (snapshot_id, record_id) DO NOTHING`,
      values,
    );
  }
}
