/**
 * Embedding pass — pipeline phase 13 (doc/Pipeline.md "Multi-view
 * Embeddings"): one embeddings row per (usable record, view, model),
 * pgvector 1536. Existing rows are skipped (resume/idempotency); batches
 * go through AiClient.embed so they are budgeted and audited.
 */

import { query } from '../../lib/db.js';
import { mapLimit } from '../../lib/parallel.js';
import { withStatementTimeoutRetry } from '../../lib/pgRetry.js';
import type { SemanticContext } from './context.js';
import type { SemanticRecordBody, RecordLevel } from './recordTypes.js';
import { viewsForRecord, renderView, kindForRecord, type ViewType, type ViewRenderContext } from './embeddingViews.js';

// 128 inputs/request (OpenAI allows 2,048; 128×1536-dim rows keeps each
// multi-row INSERT under ~2MB) — Track C/D sizing.
const EMBED_BATCH_SIZE = 128;
/**
 * Rows per INSERT statement. Decoupled from EMBED_BATCH_SIZE (which is sized
 * for the embeddings API) because the two are limited by different things.
 *
 * 2026-07-26, six-way concurrency: CourseInsights, StudyFlow and
 * kuankongy.github.io all died in this phase on 57014 — and the timing proves
 * it was the ALREADY-RETRIED insert below exhausting both attempts (each run
 * failed ~280-290s after its batch's vectors came back, and one attempt cannot
 * exceed statement_timeout 120s + a 30s pool acquire). The retry was not
 * missing; the statement was simply too big to fit the budget under load.
 *
 * Measured on the live DB: this INSERT costs ~11-14ms/row, linear, dominated
 * by the HNSW index maintenance on `embeddings.embedding` — 128 rows is ~1.3-1.9s
 * idle but >120s when up to 48 of them (8 in-flight × 6 analyses) contend for
 * the same index. Sub-chunking cuts per-statement latency proportionally
 * WITHOUT cutting throughput: the sub-chunks are issued sequentially, so the
 * number of concurrently outstanding statements is unchanged while each one is
 * a quarter of the work. Total phase time is the same; no single statement
 * spends its whole budget queued behind the others.
 */
const EMBED_INSERT_CHUNK = 32;
/** Embeddings currently go to the OpenAI-compatible embeddings endpoint. */
const EMBEDDINGS_PROVIDER = 'openai';

export interface EmbeddingPassResult {
  embedded: number;
  skippedExisting: number;
  records: number;
  batches: number;
}

interface MappedRecordRow {
  record_id: string;
  stable_key: string;
  record_level: RecordLevel;
  facts_only: boolean;
  record: SemanticRecordBody;
  node_type: string | null;
  node_name: string | null;
  file_path: string | null;
}

export async function runEmbeddingPass(ctx: SemanticContext): Promise<EmbeddingPassResult> {
  const model = ctx.ai.embeddingModel;

  // The three reads below are wrapped too, not just the writes: on 2026-07-26
  // StudyFlow spent 43s in this preamble before its first vector left for the
  // API. A read is trivially safe to repeat — it takes no locks anyone waits on
  // and mutates nothing — so a cancelled one costs a retry, not the run.
  const rows = (await withStatementTimeoutRetry('embeddingPass/loadRecords', () => query(
    `SELECT ssr.record_id, ssr.stable_key, ssr.record_level,
            sr.facts_only, sr.record,
            n.type AS node_type, n.name AS node_name, n.file_path
     FROM snapshot_semantic_records ssr
     JOIN semantic_records sr ON sr.id = ssr.record_id
     LEFT JOIN graph_nodes n ON n.id = ssr.node_id
     WHERE ssr.snapshot_id = $1 AND sr.status = 'usable'
     ORDER BY ssr.record_level, ssr.stable_key`,
    [ctx.snapshotId],
  ))).rows as MappedRecordRow[];

  const existing = new Set(
    ((await withStatementTimeoutRetry('embeddingPass/loadExisting', () => query(
      `SELECT e.record_id, e.view_type FROM embeddings e
       JOIN snapshot_semantic_records ssr ON ssr.record_id = e.record_id
       WHERE ssr.snapshot_id = $1 AND e.model = $2`,
      [ctx.snapshotId, model],
    ))).rows as Array<{ record_id: string; view_type: ViewType }>).map((r) => `${r.record_id}:${r.view_type}`),
  );

  // Caller/callee names once for the whole graph (symbol-level context).
  const callersByKey = new Map<string, string[]>();
  const calleesByKey = new Map<string, string[]>();
  for (const edge of ctx.graph.edges) {
    if (edge.type !== 'calls') continue;
    push(calleesByKey, edge.sourceKey, edge.targetKey);
    push(callersByKey, edge.targetKey, edge.sourceKey);
  }
  const capabilityNamesByKey = new Map<string, string[]>();
  for (const row of (await withStatementTimeoutRetry('embeddingPass/loadCapabilities', () => query(
    `SELECT cm.stable_key AS member_key, c.name FROM capability_members cm
     JOIN capabilities c ON c.id = cm.capability_id WHERE c.snapshot_id = $1`,
    [ctx.snapshotId],
  ))).rows as Array<{ member_key: string; name: string }>) {
    push(capabilityNamesByKey, row.member_key, row.name);
  }

  const pending: Array<{ recordId: string; view: ViewType; content: string }> = [];
  let skippedExisting = 0;
  for (const row of rows) {
    const renderCtx: ViewRenderContext = {
      name: row.node_name ?? row.stable_key,
      kind: kindForRecord(row.record_level, row.node_type),
      filePath: row.file_path,
      callerNames: callersByKey.get(row.stable_key) ?? [],
      calleeNames: calleesByKey.get(row.stable_key) ?? [],
      capabilityNames: capabilityNamesByKey.get(row.stable_key) ?? [],
    };
    for (const view of viewsForRecord({ factsOnly: row.facts_only })) {
      if (existing.has(`${row.record_id}:${view}`)) {
        skippedExisting += 1;
        continue;
      }
      const content = renderView(view, row.record, renderCtx);
      if (content.trim().length === 0) continue;
      pending.push({ recordId: row.record_id, view, content });
    }
  }

  let embedded = 0;
  let batches = 0;
  const embedBatches: Array<typeof pending> = [];
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    embedBatches.push(pending.slice(i, i + EMBED_BATCH_SIZE));
  }
  await mapLimit(embedBatches, 8, async (batch) => {
    const { vectors } = await ctx.ai.embed(batch.map((p) => p.content), { targetType: 'embedding_batch' });
    batches += 1;
    // Multi-row inserts — per-vector inserts were hundreds of sequential round
    // trips to the remote DB.
    const tuples: unknown[][] = [];
    for (let j = 0; j < batch.length; j++) {
      const item = batch[j]!;
      const vector = vectors[j];
      if (!vector) continue;
      tuples.push([item.recordId, item.view, item.content, `[${vector.join(',')}]`, EMBEDDINGS_PROVIDER, model]);
      embedded += 1;
    }
    // Bug #76: this is the write the transaction-mode pooler cancels under
    // load. It goes out in EMBED_INSERT_CHUNK-row statements (see the constant)
    // so no single statement can spend its whole 120s budget queued behind its
    // siblings. ON CONFLICT DO NOTHING makes the one retry a no-op for anything
    // that did land, and makes each sub-chunk independently resumable: a chunk
    // that committed before a later one failed is skipped by the
    // `loadExisting` read on the next run.
    for (let start = 0; start < tuples.length; start += EMBED_INSERT_CHUNK) {
      const part = tuples.slice(start, start + EMBED_INSERT_CHUNK);
      const values = part.flat();
      const rowsSql = part.map((_, i) => {
        const base = i * 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5}, $${base + 6})`;
      });
      await withStatementTimeoutRetry('embeddingPass/insert', () => query(
        `INSERT INTO embeddings (record_id, view_type, content, embedding, provider, model)
         VALUES ${rowsSql.join(', ')}
         ON CONFLICT (record_id, view_type, model) DO NOTHING`,
        values,
      ));
    }
    await ctx.onProgress?.({ phase: 'embeddings', done: batches, total: embedBatches.length, detail: `Embedding records (${batches}/${embedBatches.length} batches)` });
  });

  return { embedded, skippedExisting, records: rows.length, batches };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(value);
}
