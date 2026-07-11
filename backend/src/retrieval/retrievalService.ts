/**
 * Hybrid retrieval (doc/Pipeline.md "Retrieval (Graph RAG)") — the one
 * service that powers section generation, tutorials, regeneration, and
 * Q&A:
 *   1. embed the query/section objective,
 *   2. pgvector top-k per view (snapshot-scoped, usable records only),
 *   3. map hits to graph nodes,
 *   4. graph_neighborhood() SQL expansion (1-2 hops, capped fan-out),
 *   5. join records, workflows, receipts,
 *   6. dedupe by stable_key, score = similarity + criticality projection
 *      boost, cap bundle size,
 *   7. assemble the evidence bundle (privacy mode enforced mechanically).
 */

import { query } from '../lib/db.js';
import { embedText } from '../worker/engine/embeddingService.js';
import type { ViewType } from '../worker/semantic/embeddingViews.js';
import type { RecordLevel, SemanticRecordBody } from '../worker/semantic/recordTypes.js';
import {
  resolveRoleWeights, projectRoleScore,
  type DeveloperRole, type SemanticView,
} from '../worker/semantic/projections.js';

// ── Bundle type (spec: "The evidence bundle type (extended from v1)") ────────

export type ReceiptKind = 'code_snippet' | 'config_snippet' | 'doc_snippet' | 'graph_edge' | 'workflow_step' | 'record_reference';
export type TrustLevel = 'code' | 'config' | 'tests' | 'docs' | 'llm_inference';

export interface EvidenceBundleV2 {
  bundleVersion: '2.0';
  task: string;
  sectionType?: string;
  role?: DeveloperRole;
  privacyMode: 'full_ai' | 'facts_only_ai';
  repo: { owner: string; name: string; branch: string; commit: string };
  scope: { id: string; pathPrefix: string; displayName: string };
  deterministicContext: Record<string, unknown>;
  semanticContext: Array<{
    recordId: string;
    recordLevel: string;
    stableKey: string;
    summary: string;
    record: unknown;
    confidence: 'high' | 'medium' | 'low';
    receiptIds: string[];
    /** Retrieval bookkeeping: how this record entered the bundle. */
    retrieval: { score: number; seededByView: ViewType | null; hop: number | null };
  }>;
  receipts: Array<{
    receiptId: string;
    receiptKind: ReceiptKind;
    trustLevel: TrustLevel;
    nodeStableKey?: string;
    filePath?: string;
    symbolName?: string;
    lineStart?: number;
    lineEnd?: number;
    snippet?: string; // stripped in facts_only_ai
    detectionExpression?: string;
    referencedRecordId?: string;
  }>;
  unknowns: Array<{ kind: string; detail?: string }>;
  outputRules: {
    useOnlyProvidedEvidence: true;
    citeEverySubstantiveClaim: true;
    codeReceiptsWinOverDocs: true;
    stateUnknownsExplicitly: true;
  };
}

export interface RetrieveInput {
  snapshotId: string;
  projectId: string;
  task: string;
  privacyMode: 'full_ai' | 'facts_only_ai';
  views?: ViewType[];
  role?: DeveloperRole;
  sectionType?: string;
  maxHops?: 1 | 2;
  edgeTypes?: string[] | null;
  kPerView?: number;
  maxRecords?: number;
  maxReceipts?: number;
  /** Callers merge their section-specific deterministic queries here. */
  deterministicContext?: Record<string, unknown>;
  /** Injectable for tests; defaults to the embeddings endpoint. */
  embedQuery?: (text: string) => Promise<number[]>;
}

const DEFAULTS = { kPerView: 8, maxRecords: 40, maxReceipts: 15, maxHops: 2 as const };
/** Criticality projection contributes at most this much next to similarity. */
const CRITICALITY_BOOST_WEIGHT = 0.2;
/** Base score for records that entered via graph expansion, decaying by hop. */
const EXPANSION_BASE_SCORE = 0.3;
const EXPANSION_HOP_DECAY = 0.1;

interface SeedRow {
  stable_key: string;
  node_id: string | null;
  record_id: string;
  summary: string;
  record_level: RecordLevel;
  confidence: 'high' | 'medium' | 'low';
  record: SemanticRecordBody;
  receipt_ids: string[];
  view_type: ViewType;
  similarity: number;
}

interface Candidate {
  recordId: string;
  stableKey: string;
  recordLevel: RecordLevel;
  summary: string;
  record: SemanticRecordBody;
  confidence: 'high' | 'medium' | 'low';
  receiptIds: string[];
  score: number;
  seededByView: ViewType | null;
  hop: number | null;
}

export async function retrieve(input: RetrieveInput): Promise<EvidenceBundleV2> {
  const views = input.views ?? ['purpose', 'domain'];
  const kPerView = input.kPerView ?? DEFAULTS.kPerView;
  const maxRecords = input.maxRecords ?? DEFAULTS.maxRecords;
  const maxReceipts = input.maxReceipts ?? DEFAULTS.maxReceipts;
  const unknowns: EvidenceBundleV2['unknowns'] = [];

  const [meta, queryVector] = await Promise.all([
    loadSnapshotMeta(input.snapshotId),
    (input.embedQuery ?? embedText)(input.task),
  ]);
  const vectorLiteral = `[${queryVector.join(',')}]`;

  // 2. vector seed per view (one SQL pass over the requested views)
  const seeds = (await query(
    `SELECT ssr.stable_key, ssr.node_id, sr.id AS record_id, sr.summary, sr.record_level,
            sr.confidence, sr.record, sr.receipt_ids, e.view_type,
            1 - (e.embedding <=> $1::vector) AS similarity
     FROM embeddings e
     JOIN semantic_records sr ON sr.id = e.record_id
     JOIN snapshot_semantic_records ssr ON ssr.record_id = sr.id AND ssr.snapshot_id = $2
     WHERE e.view_type = ANY($3) AND sr.status = 'usable'
     ORDER BY e.embedding <=> $1::vector
     LIMIT $4`,
    [vectorLiteral, input.snapshotId, views, kPerView * views.length],
  )).rows as SeedRow[];
  if (seeds.length === 0) {
    unknowns.push({ kind: 'no_semantic_matches', detail: `no embeddings matched views [${views.join(', ')}]` });
  }

  // Dedupe seeds by stable_key, best similarity wins.
  const candidates = new Map<string, Candidate>();
  for (const seed of seeds) {
    const existing = candidates.get(seed.stable_key);
    if (existing && existing.score >= seed.similarity) continue;
    candidates.set(seed.stable_key, {
      recordId: seed.record_id, stableKey: seed.stable_key, recordLevel: seed.record_level,
      summary: seed.summary, record: seed.record, confidence: seed.confidence,
      receiptIds: seed.receipt_ids ?? [], score: Number(seed.similarity),
      seededByView: seed.view_type, hop: 0,
    });
  }

  // 3+4. graph expansion from seed nodes
  const seedNodeIds = [...new Set(seeds.map((s) => s.node_id).filter((id): id is string => id !== null))];
  if (seedNodeIds.length > 0) {
    const neighborhood = (await query(
      `SELECT node_id, hop FROM graph_neighborhood($1, $2, $3, $4)`,
      [input.snapshotId, seedNodeIds, input.maxHops ?? DEFAULTS.maxHops, input.edgeTypes ?? null],
    )).rows as Array<{ node_id: string; hop: number }>;
    const hopByNode = new Map(neighborhood.map((n) => [n.node_id, n.hop]));
    const expandedNodeIds = neighborhood.filter((n) => n.hop > 0).map((n) => n.node_id);

    if (expandedNodeIds.length > 0) {
      // 5. records for expanded nodes
      const expanded = (await query(
        `SELECT ssr.stable_key, ssr.node_id, sr.id AS record_id, sr.summary, sr.record_level,
                sr.confidence, sr.record, sr.receipt_ids
         FROM snapshot_semantic_records ssr
         JOIN semantic_records sr ON sr.id = ssr.record_id
         WHERE ssr.snapshot_id = $1 AND ssr.node_id = ANY($2) AND sr.status = 'usable'`,
        [input.snapshotId, expandedNodeIds],
      )).rows as Array<Omit<SeedRow, 'view_type' | 'similarity'>>;
      for (const row of expanded) {
        if (candidates.has(row.stable_key)) continue;
        const hop = hopByNode.get(row.node_id!) ?? 2;
        candidates.set(row.stable_key, {
          recordId: row.record_id, stableKey: row.stable_key, recordLevel: row.record_level,
          summary: row.summary, record: row.record, confidence: row.confidence,
          receiptIds: row.receipt_ids ?? [],
          score: Math.max(0, EXPANSION_BASE_SCORE - EXPANSION_HOP_DECAY * (hop - 1)),
          seededByView: null, hop,
        });
      }
    }
  }

  // 6. criticality projection boost + final ordering
  const role = input.role ?? 'general';
  const weights = await resolveRoleWeights(input.projectId, role);
  const viewScores = await loadSemanticViewScores(input.snapshotId, role, [...candidates.keys()]);
  for (const candidate of candidates.values()) {
    const projection = viewScores.has(candidate.stableKey)
      ? projectRoleScore(viewScores.get(candidate.stableKey)!, weights)
      : 0;
    candidate.score += CRITICALITY_BOOST_WEIGHT * projection;
  }
  const selected = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, maxRecords);

  // 5b. workflows touching the selected records' nodes
  const selectedNodeIds = (await query(
    `SELECT node_id FROM snapshot_semantic_records
     WHERE snapshot_id = $1 AND record_id = ANY($2) AND node_id IS NOT NULL`,
    [input.snapshotId, selected.map((c) => c.recordId)],
  )).rows.map((r) => (r as { node_id: string }).node_id);
  const workflows = selectedNodeIds.length > 0
    ? (await query(
        `SELECT DISTINCT w.stable_key, w.title, w.trigger_type, w.purpose
         FROM workflows w
         JOIN workflow_steps ws ON ws.workflow_id = w.id
         WHERE w.snapshot_id = $1 AND ws.node_id = ANY($2)`,
        [input.snapshotId, selectedNodeIds],
      )).rows
    : [];

  // Receipts for the selected records, code trust first, capped.
  const receiptIds = [...new Set(selected.flatMap((c) => c.receiptIds))];
  const receiptRows = receiptIds.length > 0
    ? (await query(
        `SELECT id, receipt_kind, trust_level, node_stable_key, file_path, symbol_name,
                line_start, line_end, snippet, detection_expression, referenced_record_id
         FROM source_receipts
         WHERE id = ANY($1)
         ORDER BY array_position(ARRAY['code','config','tests','docs','llm_inference'], trust_level)
         LIMIT $2`,
        [receiptIds, maxReceipts],
      )).rows as Array<{
        id: string; receipt_kind: ReceiptKind; trust_level: TrustLevel;
        node_stable_key: string | null; file_path: string | null; symbol_name: string | null;
        line_start: number | null; line_end: number | null; snippet: string | null;
        detection_expression: string | null; referenced_record_id: string | null;
      }>
    : [];

  const factsOnlyMode = input.privacyMode === 'facts_only_ai';
  if (factsOnlyMode) {
    unknowns.push({ kind: 'facts_only_privacy', detail: 'code snippets withheld by project privacy settings' });
  }

  return {
    bundleVersion: '2.0',
    task: input.task,
    sectionType: input.sectionType,
    role: input.role,
    privacyMode: input.privacyMode,
    repo: meta.repo,
    scope: meta.scope,
    deterministicContext: {
      ...(input.deterministicContext ?? {}),
      retrievedWorkflows: workflows,
      retrievalStats: { seeds: seeds.length, candidates: candidates.size, selected: selected.length, views },
    },
    semanticContext: selected.map((c) => ({
      recordId: c.recordId,
      recordLevel: c.recordLevel,
      stableKey: c.stableKey,
      summary: c.summary,
      record: c.record,
      confidence: c.confidence,
      receiptIds: c.receiptIds,
      retrieval: { score: round4(c.score), seededByView: c.seededByView, hop: c.hop },
    })),
    receipts: receiptRows.map((r) => ({
      receiptId: r.id,
      receiptKind: r.receipt_kind,
      trustLevel: r.trust_level,
      nodeStableKey: r.node_stable_key ?? undefined,
      filePath: r.file_path ?? undefined,
      symbolName: r.symbol_name ?? undefined,
      lineStart: r.line_start ?? undefined,
      lineEnd: r.line_end ?? undefined,
      // Mechanical privacy enforcement: snippets never leave in facts-only mode.
      snippet: factsOnlyMode ? undefined : r.snippet ?? undefined,
      detectionExpression: r.detection_expression ?? undefined,
      referencedRecordId: r.referenced_record_id ?? undefined,
    })),
    unknowns,
    outputRules: {
      useOnlyProvidedEvidence: true,
      citeEverySubstantiveClaim: true,
      codeReceiptsWinOverDocs: true,
      stateUnknownsExplicitly: true,
    },
  };
}

async function loadSnapshotMeta(snapshotId: string): Promise<{ repo: EvidenceBundleV2['repo']; scope: EvidenceBundleV2['scope'] }> {
  const row = (await query(
    `SELECT p.repo_owner, p.repo_name, s.branch, s.commit_hash,
            sc.id AS scope_id, sc.path_prefix, sc.display_name
     FROM analysis_snapshots s
     JOIN projects p ON p.id = s.project_id
     JOIN analysis_scopes sc ON sc.id = s.scope_id
     WHERE s.id = $1`,
    [snapshotId],
  )).rows[0] as {
    repo_owner: string; repo_name: string; branch: string; commit_hash: string;
    scope_id: string; path_prefix: string; display_name: string;
  } | undefined;
  if (!row) throw new Error(`Snapshot not found: ${snapshotId}`);
  return {
    repo: { owner: row.repo_owner, name: row.repo_name, branch: row.branch, commit: row.commit_hash },
    scope: { id: row.scope_id, pathPrefix: row.path_prefix, displayName: row.display_name },
  };
}

/** Semantic-phase view scores per stable key (role rows only for `role`). */
async function loadSemanticViewScores(
  snapshotId: string,
  role: DeveloperRole,
  stableKeys: string[],
): Promise<Map<string, Partial<Record<SemanticView, number>>>> {
  if (stableKeys.length === 0) return new Map();
  const rows = (await query(
    `SELECT stable_key, view, score FROM criticality_scores
     WHERE snapshot_id = $1 AND phase = 'semantic' AND stable_key = ANY($2)
       AND (role IS NULL OR role = $3)`,
    [snapshotId, stableKeys, role],
  )).rows as Array<{ stable_key: string; view: SemanticView; score: string }>;
  const byKey = new Map<string, Partial<Record<SemanticView, number>>>();
  for (const row of rows) {
    if (!byKey.has(row.stable_key)) byKey.set(row.stable_key, {});
    byKey.get(row.stable_key)![row.view] = Number(row.score);
  }
  return byKey;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
