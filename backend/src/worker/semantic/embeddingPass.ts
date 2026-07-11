/**
 * Embedding pass — pipeline phase 13 (doc/Pipeline.md "Multi-view
 * Embeddings"): one embeddings row per (usable record, view, model),
 * pgvector 1536. Existing rows are skipped (resume/idempotency); batches
 * go through AiClient.embed so they are budgeted and audited.
 */

import { query } from '../../lib/db.js';
import type { SemanticContext } from './context.js';
import type { SemanticRecordBody, RecordLevel } from './recordTypes.js';
import { viewsForRecord, renderView, kindForRecord, type ViewType, type ViewRenderContext } from './embeddingViews.js';

const EMBED_BATCH_SIZE = 64;
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

  const rows = (await query(
    `SELECT ssr.record_id, ssr.stable_key, ssr.record_level,
            sr.facts_only, sr.record,
            n.type AS node_type, n.name AS node_name, n.file_path
     FROM snapshot_semantic_records ssr
     JOIN semantic_records sr ON sr.id = ssr.record_id
     LEFT JOIN graph_nodes n ON n.id = ssr.node_id
     WHERE ssr.snapshot_id = $1 AND sr.status = 'usable'
     ORDER BY ssr.record_level, ssr.stable_key`,
    [ctx.snapshotId],
  )).rows as MappedRecordRow[];

  const existing = new Set(
    ((await query(
      `SELECT e.record_id, e.view_type FROM embeddings e
       JOIN snapshot_semantic_records ssr ON ssr.record_id = e.record_id
       WHERE ssr.snapshot_id = $1 AND e.model = $2`,
      [ctx.snapshotId, model],
    )).rows as Array<{ record_id: string; view_type: ViewType }>).map((r) => `${r.record_id}:${r.view_type}`),
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
  for (const row of (await query(
    `SELECT cm.stable_key AS member_key, c.name FROM capability_members cm
     JOIN capabilities c ON c.id = cm.capability_id WHERE c.snapshot_id = $1`,
    [ctx.snapshotId],
  )).rows as Array<{ member_key: string; name: string }>) {
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
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    const { vectors } = await ctx.ai.embed(batch.map((p) => p.content), { targetType: 'embedding_batch' });
    batches += 1;
    for (let j = 0; j < batch.length; j++) {
      const item = batch[j]!;
      const vector = vectors[j];
      if (!vector) continue;
      await query(
        `INSERT INTO embeddings (record_id, view_type, content, embedding, provider, model)
         VALUES ($1, $2, $3, $4::vector, $5, $6)
         ON CONFLICT (record_id, view_type, model) DO NOTHING`,
        [item.recordId, item.view, item.content, `[${vector.join(',')}]`, EMBEDDINGS_PROVIDER, model],
      );
      embedded += 1;
    }
  }

  return { embedded, skippedExisting, records: rows.length, batches };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(value);
}
