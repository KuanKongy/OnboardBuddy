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
import { assertAiAllowed } from '../worker/ai/privacy.js';
import { defaultTierModels } from '../worker/ai/modelTiers.js';
import { embedText } from '../worker/engine/embeddingService.js';
import { capReceiptSpan } from '../worker/engine/receiptSpan.js';
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
    /** Original lineEnd when the span was capped for spot-checkability. */
    truncatedFromLineEnd?: number;
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
  /**
   * Injectable for tests; defaults to the embeddings endpoint. Receives the
   * model this snapshot's vectors were written with, so an injected impl
   * cannot accidentally answer in a different vector space than the seeds
   * SQL filters for.
   */
  embedQuery?: (text: string, model: string) => Promise<number[]>;
}

// Evidence budgets sized for the 1M-context tier (latency overhaul Track
// B): sections were evidence-starved at 15 receipts/40 records when the
// window was small; input at $0.09/M makes richer bundles nearly free.

const DEFAULTS = { kPerView: 12, maxRecords: 64, maxReceipts: 40, maxHops: 2 as const };
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
  // The query embedding below goes STRAIGHT to the embeddings provider
  // (engine/embeddingService), bypassing AiClient and therefore its
  // privacy/budget/kill-switch gate. That makes this the one place in the
  // pipeline where an ai_disabled project could still have text leave the
  // process, so the assertion is repeated here rather than trusted to the
  // caller — the type says ai_disabled cannot reach this function, and a
  // caller that casts (or a new one) must not be able to make the type lie.
  assertAiAllowed(input.privacyMode);
  const views = input.views ?? ['purpose', 'domain'];
  const kPerView = input.kPerView ?? DEFAULTS.kPerView;
  const maxRecords = input.maxRecords ?? DEFAULTS.maxRecords;
  const maxReceipts = input.maxReceipts ?? DEFAULTS.maxReceipts;
  const unknowns: EvidenceBundleV2['unknowns'] = [];

  // Which model wrote THIS snapshot's vectors decides both how the query is
  // embedded and which rows it may be compared against (see
  // resolveSnapshotEmbeddingModel). Detection is cached, so this is a real
  // query only once per snapshot per 5 minutes.
  const [meta, detectedModel] = await Promise.all([
    loadSnapshotMeta(input.snapshotId),
    resolveSnapshotEmbeddingModel(input.snapshotId),
  ]);
  const embeddingModel = detectedModel ?? defaultTierModels().embedding[0]!;
  const queryVector = await (input.embedQuery ?? embedText)(input.task, embeddingModel);
  const vectorLiteral = `[${queryVector.join(',')}]`;

  // 2. vector seed per view (one SQL pass over the requested views)
  //
  // The `e.model = $5` predicate is not an optimization: two models' vectors
  // coexist in this table for the whole of M5 (M4 keeps writing
  // text-embedding-3-small rows against the same database), and cosine
  // distance between vectors from different models is noise that outranks
  // genuine matches. It is always present — never conditional on detection
  // finding rows — because "no filter" is precisely the corrupt case.
  const seeds = (await query(
    `SELECT ssr.stable_key, ssr.node_id, sr.id AS record_id, sr.summary, sr.record_level,
            sr.confidence, sr.record, sr.receipt_ids, e.view_type,
            1 - (e.embedding <=> $1::vector) AS similarity
     FROM embeddings e
     JOIN semantic_records sr ON sr.id = e.record_id
     JOIN snapshot_semantic_records ssr ON ssr.record_id = sr.id AND ssr.snapshot_id = $2
     WHERE e.view_type = ANY($3) AND sr.status = 'usable' AND e.model = $5
     ORDER BY e.embedding <=> $1::vector
     LIMIT $4`,
    [vectorLiteral, input.snapshotId, views, kPerView * views.length, embeddingModel],
  )).rows as SeedRow[];
  if (seeds.length === 0) {
    unknowns.push({
      kind: 'no_semantic_matches',
      detail: `no ${embeddingModel} embeddings matched views [${views.join(', ')}]`,
    });
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
                line_start, line_end, snippet, detection_expression, referenced_record_id,
                (metadata->>'truncatedFromLineEnd')::int AS truncated_from_line_end
         FROM source_receipts
         WHERE id = ANY($1)
         ORDER BY array_position(ARRAY['code','config','tests','docs','llm_inference'], trust_level),
                  (snippet IS NULL) -- within a trust level, receipts with real snippets first
         LIMIT $2`,
        [receiptIds, maxReceipts],
      )).rows as Array<{
        id: string; receipt_kind: ReceiptKind; trust_level: TrustLevel;
        node_stable_key: string | null; file_path: string | null; symbol_name: string | null;
        line_start: number | null; line_end: number | null; snippet: string | null;
        detection_expression: string | null; referenced_record_id: string | null;
        truncated_from_line_end: number | null;
      }>
    : [];

  // doc_health claims are ABOUT documentation, but record receipts are
  // code-first — without doc evidence in the bundle, claims naming README.md
  // could never cite anything and the section was downgraded across the
  // board. Attach the snapshot's doc nodes as citable doc-trust receipts.
  const docReceipts: typeof receiptRows = [];
  if (input.sectionType === 'doc_health') {
    const docRows = (await query(
      `SELECT stable_key, file_path, snippet, line_start, line_end FROM graph_nodes
       WHERE snapshot_id = $1 AND type = 'doc'
       ORDER BY (file_path ILIKE '%readme%') DESC, file_path
       LIMIT 12`,
      [input.snapshotId],
    )).rows as Array<{ stable_key: string; file_path: string | null; snippet: string | null; line_start: number | null; line_end: number | null }>;
    for (const d of docRows) {
      docReceipts.push({
        id: `docnode:${d.stable_key}`,
        receipt_kind: 'doc_snippet',
        trust_level: 'docs',
        node_stable_key: d.stable_key,
        file_path: d.file_path,
        symbol_name: null,
        line_start: d.line_start,
        line_end: d.line_end,
        snippet: d.snippet,
        detection_expression: null,
        referenced_record_id: null,
        truncated_from_line_end: null,
      });
    }
  }

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
    receipts: [...receiptRows, ...docReceipts].map((r) =>
      // Spans stay spot-checkable: legacy full-symbol receipts are capped
      // here (audit §3.7) with the original extent kept as truncatedFromLineEnd.
      capReceiptSpan({
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
        truncatedFromLineEnd: r.truncated_from_line_end ?? undefined,
      }),
    ),
    unknowns,
    outputRules: {
      useOnlyProvidedEvidence: true,
      citeEverySubstantiveClaim: true,
      codeReceiptsWinOverDocs: true,
      stateUnknownsExplicitly: true,
    },
  };
}

/** Detection is per snapshot and snapshots are immutable once analyzed. */
const EMBEDDING_MODEL_CACHE_TTL_MS = 5 * 60_000;
/**
 * Long-lived API processes serve many snapshots; the entries are tiny but the
 * map is unbounded without this, so it is dropped wholesale past a size that
 * no realistic working set reaches (re-detection costs one indexed query).
 */
const EMBEDDING_MODEL_CACHE_MAX = 512;
const embeddingModelCache = new Map<string, { model: string | null; atMs: number }>();

/** Test seam + cache reset. */
export function __resetEmbeddingModelCacheForTests(): void {
  embeddingModelCache.clear();
}

/**
 * Which embedding model this snapshot's vectors were actually written with,
 * or null when it has none yet.
 *
 * M5 flips EMBEDDINGS_MODEL to an OpenRouter model while the M4 build keeps
 * writing text-embedding-3-small rows into the same (frozen) schema, so the
 * configured model is NOT a reliable answer for a snapshot analyzed earlier:
 * asking a 3-small snapshot with a pplx query vector returns confident
 * nonsense rather than an error. The stored rows are the ground truth.
 *
 * Ties (a snapshot re-embedded mid-flip, both models present) resolve toward
 * the configured model — that is the space the fresh rows are in and the one
 * a re-analysis will complete — then toward the larger row count, then by
 * name so the choice is deterministic across processes.
 *
 * A cached null (snapshot with no vectors yet) is harmless: the caller then
 * falls back to the configured model, which is exactly what an analysis in
 * flight is writing.
 *
 * Known gap: "configured" here is the env default (defaultTierModels()); a
 * project-level model_tier_overrides.embedding is not visible from retrieval.
 * It only matters for a snapshot holding BOTH models' rows, where the
 * majority-count rule then decides.
 */
export async function resolveSnapshotEmbeddingModel(snapshotId: string): Promise<string | null> {
  const now = Date.now();
  const hit = embeddingModelCache.get(snapshotId);
  if (hit && now - hit.atMs < EMBEDDING_MODEL_CACHE_TTL_MS) return hit.model;

  const rows = (await query(
    `SELECT e.model, COUNT(*) AS n
     FROM embeddings e
     JOIN snapshot_semantic_records ssr ON ssr.record_id = e.record_id
     WHERE ssr.snapshot_id = $1
     GROUP BY e.model`,
    [snapshotId],
  )).rows as Array<{ model: string; n: string | number }>;

  const configured = defaultTierModels().embedding[0]!;
  let model: string | null = null;
  if (rows.length > 0) {
    model = rows.some((r) => r.model === configured)
      ? configured
      : [...rows].sort((a, b) => Number(b.n) - Number(a.n) || a.model.localeCompare(b.model))[0]!.model;
  }

  if (embeddingModelCache.size >= EMBEDDING_MODEL_CACHE_MAX) embeddingModelCache.clear();
  embeddingModelCache.set(snapshotId, { model, atMs: now });
  return model;
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
