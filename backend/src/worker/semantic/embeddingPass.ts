/**
 * Embedding pass — pipeline phase 13 (doc/Pipeline.md "Multi-view
 * Embeddings"): one embeddings row per (usable record, view, model),
 * pgvector 1536. Existing rows are skipped (resume/idempotency); batches
 * go through AiClient.embed so they are budgeted and audited.
 */

import { query } from '../../lib/db.js';
import { envInt } from '../../lib/env.js';
import { mapLimit } from '../../lib/parallel.js';
import { withStatementTimeoutRetry } from '../../lib/pgRetry.js';
import { profileForModel } from '../ai/embeddingProfiles.js';
import type { SemanticContext } from './context.js';
import type { SemanticRecordBody, RecordLevel } from './recordTypes.js';
import { viewsForRecord, renderView, kindForRecord, type ViewType, type ViewRenderContext } from './embeddingViews.js';

// 128 inputs/request (OpenAI allows 2,048; 128×1536-dim rows keeps each
// multi-row INSERT under ~2MB) — Track C/D sizing.
//
// Env-overridable (EMBED_BATCH_SIZE) because the per-request input cap is the
// upstream's to set and it changes with the model: an OpenRouter upstream that
// rejects 128 inputs would fail every batch of the phase, and that must be
// fixable with an env line rather than a rebuild.
const EMBED_BATCH_SIZE_DEFAULT = 128;
/**
 * Rows per INSERT statement, env-overridable (EMBED_INSERT_CHUNK). Decoupled
 * from EMBED_BATCH_SIZE (which is sized for the embeddings API) because the two
 * are limited by different things.
 *
 * 2026-07-26, six-way concurrency: CourseInsights, StudyFlow and
 * kuankongy.github.io all died in this phase on 57014 — and the timing proves
 * it was the ALREADY-RETRIED insert below exhausting both attempts (each run
 * failed ~280-290s after its batch's vectors came back, and one attempt cannot
 * exceed statement_timeout 120s + a 30s pool acquire). The retry was not
 * missing; the statement was simply too big to fit the budget under load.
 *
 * Measured on the live DB: this INSERT costs ~11-14ms/row idle, linear,
 * dominated by HNSW index maintenance on `embeddings.embedding`
 * (idx_embeddings_vector, 230MB over a 522MB / 34.5k-row table).
 *
 * Sub-chunking alone was not enough, and this comment's old claim that "total
 * phase time is the same" is measured FALSE — the sub-chunks were issued from
 * 8 concurrent slots, so they contended with each other. Snapshot 252239a3
 * (2026-07-27) spent 673s in this phase: 41 embedding API calls totalling only
 * 82s (p50 1.6-2.7s, zero failures), while each mapLimit slot took 70+s to
 * free because its 4 sequential inserts fought the other 7 slots for that one
 * index. Effective throughput collapsed to ~8 rows/s — ~40x worse than the
 * ~14ms/row the same statement costs uncontended. The writes are self-
 * contention, so the fix below is to stop competing with ourselves rather than
 * to shrink the statement further: the same 5,241 rows written by a single
 * writer at the idle rate are ~75s of work.
 *
 * Why 64 and not the 32 that shipped alongside that single writer: 32 rows is
 * only ~0.4s of index work, so the phase bought one round trip to a remote DB
 * for every 0.4s of useful work. At 64 a statement is ~0.7-0.9s idle (64 × the
 * 11-14ms/row above), or roughly 0.9-1.8s once EMBED_WRITE_CONCURRENCY writers
 * overlap on the same index — still under 2% of the statement_timeout 120s the
 * 2026-07-26 deaths blew through, and the single 57014 retry
 * (withStatementTimeoutRetry) is unchanged underneath. Raise it only with a
 * measurement: the timeout budget it spends is per statement, not per phase.
 */
const EMBED_INSERT_CHUNK_DEFAULT = 64;
/**
 * Writer loops draining the queue (EMBED_WRITE_CONCURRENCY). The collapse
 * measured above was EIGHT-way self-contention on one HNSW index; 2 is far
 * below that and buys back the round trip a lone writer spends idle between
 * statements — which is most of its wall clock once the statement itself is
 * under a second. Peak memory scales with it:
 * (EMBED_INSERT_QUEUE_MAX_CHUNKS + W) × EMBED_INSERT_CHUNK × ~16KB per
 * serialized vector, i.e. ~18MB at the defaults.
 */
const EMBED_WRITE_CONCURRENCY_DEFAULT = 2;
/**
 * Embedding requests in flight at once (EMBED_REQUEST_CONCURRENCY).
 *
 * The old value was 8, and it bursts 8 × EMBED_BATCH_SIZE inputs at ONE
 * upstream: pplx-embed rides a single ZDR endpoint through OpenRouter, whose
 * rate limits are per key, not per batch. That burst is what draws the 429s
 * that pause runs ("embedding_batch: provider HTTP 429"). 3 concurrent large
 * batches stays under them.
 *
 * Reliability over speed (user decision 2026-08-15): the API leg was never
 * this phase's bottleneck — 41 batches cost 82s of a 673s phase in the
 * measurement above — so trading some of its parallelism for not being rate
 * limited costs very little wall clock and removes a whole pause class.
 */
const EMBED_REQUEST_CONCURRENCY_DEFAULT = 3;
/**
 * How far the writers may fall behind before producers stop embedding. A memory
 * bound, not a throughput knob (see EMBED_WRITE_CONCURRENCY for the arithmetic
 * at the current defaults). Without a bound the fast API leg (82s for the whole
 * run above) would hold every vector of the run — ~5.2k × 16KB ≈ 84MB —
 * resident while the slow writers caught up.
 */
const EMBED_INSERT_QUEUE_MAX_CHUNKS = 16;
/**
 * Chunks between progress reports from a writer. `ctx.onProgress` is a remote
 * UPDATE on the step row, and one per chunk put that round trip directly on the
 * write path this phase is bottlenecked on. It cannot be dropped entirely: it
 * is the kill-switch conduit (updateStep throws KillSwitchError when the run is
 * paused), so a writer that never awaits it never notices a pause. Every 4th
 * chunk plus a report after the drain keeps worst-case pause latency at ~4
 * chunks (a few seconds) instead of one.
 */
const PROGRESS_EVERY_CHUNKS = 4;

/**
 * pgvector literal for one embedding, e.g. `[0.1,-0.0234568]`.
 *
 * Components go out at 7 decimal places rather than JS default precision
 * because the destination is a `vector(1536)` column and pgvector stores
 * float4 — the digits past that are discarded on arrival, so sending them only
 * inflates the statement. Measured 2026-07-29 against the live table: pgvector
 * renders a stored vector back as ~19KB of text (already float4-truncated, so
 * whatever the upstream sent was at least that long) and this formatter emits
 * ~16KB for the same values; against an upstream that sends full doubles it is
 * closer to half. Re-serializing 20 live vectors and asking Postgres to compare
 * them with the stored originals gave a worst-case cosine distance of 3.0e-7
 * (worst L2 1.2e-6, worst relative norm drift 4.3e-8) — four orders of
 * magnitude below any similarity gap that changes a ranking.
 *
 * Embeddings are unit-norm, so |x| <= 1 and toFixed(7) never reaches the 1e21
 * threshold where it would switch to exponential notation — which pgvector's
 * parser would reject. Components below 5e-8 in magnitude collapse to `0`
 * (including the `-0` that toFixed produces for small negatives).
 */
export function formatVectorLiteral(vector: readonly number[]): string {
  let out = '[';
  for (let i = 0; i < vector.length; i++) {
    if (i > 0) out += ',';
    const fixed = vector[i]!.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
    out += fixed === '-0' ? '0' : fixed;
  }
  return `${out}]`;
}

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
  // `embeddings.provider` is descriptive only — nothing filters on it — but it
  // is the fastest way to see which upstream produced a row when two models
  // coexist in the table, so it follows the model instead of being hardcoded.
  const embeddingsProvider = profileForModel(model).id;
  const batchSize = envInt('EMBED_BATCH_SIZE', EMBED_BATCH_SIZE_DEFAULT);
  const insertChunk = envInt('EMBED_INSERT_CHUNK', EMBED_INSERT_CHUNK_DEFAULT);
  const writeConcurrency = envInt('EMBED_WRITE_CONCURRENCY', EMBED_WRITE_CONCURRENCY_DEFAULT);
  const requestConcurrency = envInt('EMBED_REQUEST_CONCURRENCY', EMBED_REQUEST_CONCURRENCY_DEFAULT);

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
  for (let i = 0; i < pending.length; i += batchSize) {
    embedBatches.push(pending.slice(i, i + batchSize));
  }
  // Producer/consumer split (see EMBED_INSERT_CHUNK): the
  // EMBED_REQUEST_CONCURRENCY producers below do ONLY the API call and tuple
  // building, and hand chunks to a fixed set of writers. The number of insert
  // statements this phase has outstanding at any instant is therefore exactly
  // EMBED_WRITE_CONCURRENCY, where it used to be one per producer slot (8)
  // — which is what actually cost the 673s above, and which also removes this
  // phase's share of the 2026-07-26 57014 deaths (its inserts can no longer
  // queue up 8-deep behind each other).
  const queue: unknown[][][] = [];
  let producersDone = false;
  // First error from EITHER side wins and is the one thrown, exactly as
  // mapLimit's own first-error rule did when the insert lived inside it.
  let phaseFailure: unknown = null;
  let writerStopped = false;
  const workWaiters: Array<() => void> = [];
  const spaceWaiters: Array<() => void> = [];
  const wake = (waiters: Array<() => void>): void => { while (waiters.length > 0) waiters.shift()!(); };
  const fail = (err: unknown): void => { if (phaseFailure === null) phaseFailure = err; };

  // Progress is reported by the writers because a writer is the phase's real
  // clock now: a batch whose vectors are back but unwritten is not done.
  let chunksWritten = 0;
  const reportProgress = (): Promise<void> | undefined => ctx.onProgress?.({
    phase: 'embeddings',
    done: embedded,
    total: pending.length,
    detail: `Embedding records (${embedded}/${pending.length} vectors)`,
  });

  const writerLoop = async (): Promise<void> => {
    for (;;) {
      // A sibling that already failed has failed the whole phase, so draining
      // the rest of the queue would only add writes to a run about to throw.
      if (writerStopped) return;
      const chunk = queue.shift();
      if (chunk === undefined) {
        // Nothing to write: finish once no producer can enqueue again,
        // otherwise park until one does.
        if (producersDone) return;
        await new Promise<void>((resolve) => { workWaiters.push(resolve); });
        continue;
      }
      wake(spaceWaiters);
      // Bug #76: this is the write the transaction-mode pooler cancels under
      // load. It goes out in EMBED_INSERT_CHUNK-row statements (see the
      // constant) so no single statement can spend its whole 120s budget queued
      // behind the writers of the OTHER analyses running at the same time —
      // within this job there are now EMBED_WRITE_CONCURRENCY of them, not one
      // per producer slot (8 when this was written).
      // ON CONFLICT DO NOTHING makes the one retry a no-op for anything that
      // did land, and makes each chunk independently resumable: a chunk that
      // committed before a later one failed is skipped by the `loadExisting`
      // read on the next run.
      const values = chunk.flat();
      const rowsSql = chunk.map((_, i) => {
        const base = i * 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5}, $${base + 6})`;
      });
      await withStatementTimeoutRetry('embeddingPass/insert', () => query(
        `INSERT INTO embeddings (record_id, view_type, content, embedding, provider, model)
         VALUES ${rowsSql.join(', ')}
         ON CONFLICT (record_id, view_type, model) DO NOTHING`,
        values,
      ));
      embedded += chunk.length;
      chunksWritten += 1;
      // Throttled, and still awaited — see PROGRESS_EVERY_CHUNKS (kill switch).
      if (chunksWritten % PROGRESS_EVERY_CHUNKS === 0) await reportProgress();
    }
  };

  const writers = Promise.all(Array.from({ length: writeConcurrency }, () => writerLoop().catch((err) => {
    // A failed writer will fail every later chunk too, so unblock the producers
    // AND any sibling writer parked on an empty queue — either would otherwise
    // sit waiting on a hand-off that is never coming.
    fail(err);
    writerStopped = true;
    wake(spaceWaiters);
    wake(workWaiters);
  })));

  const producers = (async () => {
    try {
      await mapLimit(embedBatches, requestConcurrency, async (batch) => {
        if (writerStopped) return; // don't pay for vectors nothing will store
        const { vectors } = await ctx.ai.embed(batch.map((p) => p.content), { targetType: 'embedding_batch' });
        batches += 1;
        // Multi-row inserts — per-vector inserts were hundreds of sequential
        // round trips to the remote DB.
        const tuples: unknown[][] = [];
        for (let j = 0; j < batch.length; j++) {
          const item = batch[j]!;
          const vector = vectors[j];
          if (!vector) continue;
          tuples.push([item.recordId, item.view, item.content, formatVectorLiteral(vector), embeddingsProvider, model]);
        }
        for (let start = 0; start < tuples.length; start += insertChunk) {
          while (queue.length >= EMBED_INSERT_QUEUE_MAX_CHUNKS && !writerStopped) {
            await new Promise<void>((resolve) => { spaceWaiters.push(resolve); });
          }
          if (writerStopped) return;
          queue.push(tuples.slice(start, start + insertChunk));
          wake(workWaiters);
        }
      });
    } finally {
      // Unconditional: a producer that threw must still release the writers,
      // which would otherwise park forever waiting for work that never comes.
      producersDone = true;
      wake(workWaiters);
    }
  })();

  await Promise.all([producers.catch(fail), writers]);
  if (phaseFailure !== null) throw phaseFailure;
  // The last chunk almost never lands on the every-4th boundary, and without
  // this the step row would sit short of the real total for the rest of the run.
  if (chunksWritten % PROGRESS_EVERY_CHUNKS !== 0) await reportProgress();

  return { embedded, skippedExisting, records: rows.length, batches };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(value);
}
