/**
 * The embedding pass's bounded-writer insert queue, and the pgvector literal it
 * writes.
 *
 * Snapshot 252239a3 (2026-07-27) spent 673s in this phase for 82s of embedding
 * API work: the 8 batch slots each issued their own INSERTs, and those inserts
 * fought each other for the HNSW index on `embeddings.embedding` until
 * effective throughput was ~8 rows/s. The fix is scheduling, not SQL — a small
 * fixed set of writers drains what the producers embed — and the properties
 * below are the ones a future edit could break silently:
 *
 *   1. at most EMBED_WRITE_CONCURRENCY insert statements are ever outstanding
 *      (the whole point), and every row is written exactly once;
 *   2. producers stop embedding when the writers fall behind (without the
 *      bound, a fast API leg holds every vector of the run in memory);
 *   3. a writer failure fails the phase instead of deadlocking the producers
 *      parked on a queue nobody is draining any more, or leaving a sibling
 *      writer draining chunks into a run that is going to throw;
 *   4. `ctx.onProgress` is throttled but never dropped — it is the kill-switch
 *      conduit, so a writer that stops awaiting it stops noticing pauses;
 *   5. the vector literal stays parseable, unit-norm to well within cosine
 *      resolution, and free of exponent notation (pgvector's parser rejects it).
 *
 * Everything sized off the knobs rather than hardcoded: the counts move when
 * EMBED_INSERT_CHUNK or EMBED_WRITE_CONCURRENCY is retuned, the invariants
 * don't.
 */

import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import { runEmbeddingPass, formatVectorLiteral } from '../embeddingPass.js';
import type { SemanticContext } from '../context.js';
import type { SemanticRecordBody } from '../recordTypes.js';

/** All four views render non-empty from this body, so every record = 4 rows. */
const BODY: SemanticRecordBody = {
  purpose: 'Authenticates users.',
  behavior: 'Validates credentials then signs a token.',
  responsibilities: ['authentication'],
  business_concepts: ['user login'],
  side_effects: [{ kind: 'database_write', description: 'stores sessions', mergedWithDeterministic: true }],
  inputs_outputs: null,
  dependencies_narrative: 'Delegates persistence to the session store.',
  design_patterns: ['service'],
  risks_invariants: ['Never log credentials.'],
  confidence: 'high',
  claims: [],
  failure_modes: ['invalid credentials rejected'],
};

const VIEWS_PER_RECORD = 4;
/** Knob values this file pins via env; the pass reads both at call scope. */
const BATCH_SIZE = 128;
const CHUNK = 64;
/** Not env-driven in the pass — mirrored here so the bounds below stay derived. */
const QUEUE_MAX_CHUNKS = 16;
const PRODUCER_SLOTS = 8;
const PROGRESS_EVERY_CHUNKS = 4;
const CHUNKS_PER_BATCH = Math.ceil(BATCH_SIZE / CHUNK);

const COLUMNS_PER_ROW = 6; // record_id, view_type, content, embedding, provider, model

interface Probe {
  /** Insert statements that have STARTED, in order. */
  statements: number;
  inFlight: number;
  maxInFlight: number;
  /** `record_id:view_type` of every row of every insert, in write order. */
  rowKeys: string[];
  /** Params per VALUES tuple, distinct. Must stay {6} — dropping `content` makes it 5. */
  paramsPerRow: Set<number>;
  /** Distinct `embedding` params, i.e. what the write path actually serializes. */
  vectorLiterals: Set<string>;
  /** Input counts of every ctx.ai.embed call. */
  embedCalls: number[];
  progress: Array<{ done: number; total: number }>;
}

interface Harness {
  ctx: SemanticContext;
  probe: Probe;
  pendingRows: number;
  chunks: number;
  batches: number;
}

/**
 * @param onInsert runs before each insert "commits" — the seam the stall and
 *   failure cases use.
 */
function harness(records: number, onInsert?: (probe: Probe) => Promise<void>): Harness {
  const probe: Probe = {
    statements: 0, inFlight: 0, maxInFlight: 0,
    rowKeys: [], paramsPerRow: new Set(), vectorLiterals: new Set(),
    embedCalls: [], progress: [],
  };
  const rows = Array.from({ length: records }, (_, i) => ({
    record_id: `rec-${i}`, stable_key: `src/a${i}.ts#fn`, record_level: 'symbol',
    facts_only: false, record: BODY,
    node_type: 'function', node_name: `fn${i}`, file_path: `src/a${i}.ts`,
  }));

  __setQueryForTests(async (text, params) => {
    if (text.includes('SELECT e.record_id, e.view_type FROM embeddings e')) return { rows: [] } as never;
    if (text.includes('JOIN semantic_records sr ON sr.id = ssr.record_id')) return { rows } as never;
    if (text.includes('FROM capability_members cm')) return { rows: [] } as never;
    if (text.includes('INSERT INTO embeddings')) {
      probe.statements += 1;
      probe.inFlight += 1;
      probe.maxInFlight = Math.max(probe.maxInFlight, probe.inFlight);
      try {
        // Yield a macrotask so a second concurrent insert would be observable.
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        await onInsert?.(probe);
        // One VALUES tuple per row; each starts `($n,`.
        const tuples = (text.match(/\(\$\d+,/g) ?? []).length;
        const perRow = (params?.length ?? 0) / tuples;
        probe.paramsPerRow.add(perRow);
        for (let i = 0; i < tuples; i++) {
          const base = i * perRow;
          probe.rowKeys.push(`${String(params?.[base])}:${String(params?.[base + 1])}`);
          probe.vectorLiterals.add(String(params?.[base + 3]));
        }
      } finally {
        probe.inFlight -= 1;
      }
      return { rows: [] } as never;
    }
    return { rows: [] } as never;
  });

  const ai = {
    embeddingModel: 'text-embedding-3-small',
    embed: async (inputs: string[]) => {
      probe.embedCalls.push(inputs.length);
      return { vectors: inputs.map(() => [0.1, 0.2]) };
    },
  } as unknown as SemanticContext['ai'];

  const pendingRows = records * VIEWS_PER_RECORD;
  const batches = Math.ceil(pendingRows / BATCH_SIZE);
  return {
    probe,
    pendingRows,
    batches,
    // Chunking happens per batch, so the last chunk of each batch is a remainder.
    chunks: batches * CHUNKS_PER_BATCH,
    ctx: {
      ai,
      snapshotId: 'snap-1',
      graph: { nodes: [], edges: [] },
      onProgress: async (info: { done: number; total: number }) => {
        probe.progress.push({ done: info.done, total: info.total });
      },
    } as unknown as SemanticContext,
  };
}

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 20); });

describe('embedding pass — bounded-writer insert queue', () => {
  const previous = {
    batchSize: process.env.EMBED_BATCH_SIZE,
    chunk: process.env.EMBED_INSERT_CHUNK,
    writers: process.env.EMBED_WRITE_CONCURRENCY,
  };
  before(() => {
    process.env.EMBED_BATCH_SIZE = String(BATCH_SIZE);
    process.env.EMBED_INSERT_CHUNK = String(CHUNK);
  });
  after(() => {
    restore('EMBED_BATCH_SIZE', previous.batchSize);
    restore('EMBED_INSERT_CHUNK', previous.chunk);
    restore('EMBED_WRITE_CONCURRENCY', previous.writers);
  });
  afterEach(() => __setQueryForTests(null));

  for (const writers of [1, 2]) {
    describe(`EMBED_WRITE_CONCURRENCY=${writers}`, () => {
      before(() => { process.env.EMBED_WRITE_CONCURRENCY = String(writers); });

      it(`writes every row exactly once with at most ${writers} insert(s) outstanding`, async () => {
        const { ctx, probe, pendingRows, batches } = harness(384);

        const result = await runEmbeddingPass(ctx);

        // If the env read had been hoisted to module scope this would still see
        // the default (2 writers / 64-row chunks) and both counts would be off.
        expect(probe.maxInFlight, 'concurrent insert statements').to.equal(writers);
        expect(probe.statements, 'insert statements').to.equal(pendingRows / CHUNK);
        expect(probe.rowKeys, 'rows written').to.have.length(pendingRows);
        expect(new Set(probe.rowKeys).size, 'rows written exactly once').to.equal(pendingRows);
        expect(result.embedded).to.equal(pendingRows);
        expect(probe.embedCalls).to.have.length(batches);
        // `content` is stored on purpose (product decision, 2026-07-28) — a
        // dropped column would show up here as 5 params per row.
        expect([...probe.paramsPerRow], 'params per VALUES tuple').to.deep.equal([COLUMNS_PER_ROW]);
        // And the write path serializes through formatVectorLiteral, not join().
        expect([...probe.vectorLiterals], 'embedding literal').to.deep.equal(['[0.1,0.2]']);
      });

      it('producers stop embedding once the writers are a bounded backlog behind', async () => {
        // 1,024 records = 32 batches: far more than the queue can absorb.
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const { ctx, probe, pendingRows, batches } = harness(1_024, async (p) => {
          if (p.statements <= writers) await held;
        });

        const done = runEmbeddingPass(ctx);
        await settle();

        // With every writer stuck on its first insert, the chunks that exist
        // are the ≤16 parked in the queue plus the one each writer took. Any
        // batch beyond those is a slot that embedded and then parked before it
        // could hand its remaining chunks over.
        const maxEmbedCalls = PRODUCER_SLOTS
          + Math.floor((QUEUE_MAX_CHUNKS + writers) / CHUNKS_PER_BATCH);
        expect(probe.statements, 'writers are stalled on their first insert').to.equal(writers);
        expect(probe.embedCalls.length, 'embed calls while the writers are stalled')
          .to.be.at.most(maxEmbedCalls);
        expect(maxEmbedCalls, 'the bound is worth asserting').to.be.below(batches);

        release();
        const result = await done;
        expect(probe.embedCalls, 'every batch embeds once the writers catch up').to.have.length(batches);
        expect(probe.rowKeys).to.have.length(pendingRows);
        expect(result.embedded).to.equal(pendingRows);
      });

      it('a writer failure fails the phase, stranding neither producers nor a sibling writer', async () => {
        const boom = new Error('insert exploded');
        let statementsAtFailure = 0;
        const { ctx, probe, batches } = harness(1_024, async (p) => {
          if (p.statements === 3) {
            statementsAtFailure = p.statements;
            throw boom;
          }
        });

        let thrown: unknown = null;
        try {
          await runEmbeddingPass(ctx);
        } catch (err) {
          thrown = err;
        }

        // A producer parked on a queue nobody drains, or a sibling writer parked
        // on work that never arrives, shows up here as a mocha timeout.
        expect(thrown, 'the phase surfaces the writer error').to.equal(boom);
        expect(probe.inFlight, 'no insert still running').to.equal(0);
        // And it stops paying for vectors nothing will store.
        expect(probe.embedCalls.length, 'embed calls after the writer died').to.be.below(batches);
        // A sibling already inside query() when the failure lands finishes that
        // statement and may start one more before `writerStopped` is visible to
        // it; what it must not do is keep draining all 64 chunks.
        expect(probe.statements, 'statements after the failure')
          .to.be.at.most(statementsAtFailure + writers);
      });

      it('reports progress every 4th chunk and once at the end, not per chunk', async () => {
        // 352 records = 1,408 rows = 11 batches = 22 chunks (not a multiple of 4,
        // so the trailing report is the one that carries the final count).
        const { ctx, probe, pendingRows, chunks } = harness(352);

        await runEmbeddingPass(ctx);

        expect(probe.statements, 'chunks written').to.equal(chunks);
        expect(probe.progress.length, 'progress reports')
          .to.equal(Math.ceil(chunks / PROGRESS_EVERY_CHUNKS));
        expect(probe.progress.at(-1), 'the final report carries the full count')
          .to.deep.equal({ done: pendingRows, total: pendingRows });
      });
    });
  }
});

describe('embedding pass — pgvector literal', () => {
  it('renders zeros, negatives and sub-precision magnitudes without exponents', () => {
    // pgvector's parser takes plain decimals only, and the column is float4:
    // 1e-9 is below what it can hold, so it must land as a plain 0 (not "-0",
    // and never "1e-9").
    expect(formatVectorLiteral([0, -0, 1, -1])).to.equal('[0,0,1,-1]');
    expect(formatVectorLiteral([0.1, -0.5, 0.12345678])).to.equal('[0.1,-0.5,0.1234568]');
    expect(formatVectorLiteral([1e-7, -1e-7])).to.equal('[0.0000001,-0.0000001]');
    expect(formatVectorLiteral([1e-9, -1e-9])).to.equal('[0,0]');
  });

  it('round-trips a 1536-dim unit vector at half the length and 1e-6 of the norm', () => {
    // Deterministic pseudo-random unit vector — the shape of a real embedding
    // without pinning a fixture. Live check for reference (25 rows, 2026-07-29):
    // 19,215 → 15,948 bytes, max relative norm drift 4.3e-8.
    let seed = 12_345;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return (seed / 2_147_483_648) * 2 - 1;
    };
    const raw = Array.from({ length: 1536 }, next);
    const norm = Math.hypot(...raw);
    const vector = raw.map((x) => x / norm);

    const literal = formatVectorLiteral(vector);

    expect(literal, 'exponent notation would be rejected by pgvector').to.not.match(/[eE]/);
    const parsed = JSON.parse(literal) as number[];
    expect(parsed).to.have.length(vector.length);
    expect(Math.abs(Math.hypot(...parsed) - 1), 'norm drift').to.be.below(1e-6);
    expect(literal.length, 'shorter than full float precision')
      .to.be.below(`[${vector.join(',')}]`.length * 0.6);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
