/**
 * Critique pass — the rejected-record path.
 *
 * A rejected symbol record costs two more LLM round trips (regenerate, then
 * re-critique), and they used to be paid one after another inside the batch
 * loop, so a batch with several rejects took as long as their latencies summed.
 * They now fan out. The refactor moved the per-record bookkeeping out of the
 * loop it was written in, so what is pinned here is that nothing was dropped or
 * cross-wired on the way: every reject still gets its own regeneration attempt,
 * and each still lands with ITS OWN verdict notes.
 */

import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import { installFakeDb, makeClient } from '../../../../test/helpers/aiHarness.js';
import type {
  AiProvider, CompletionRequest, CompletionResult,
  ProviderCallOptions, StructuredRequest, StructuredResult,
} from '../../ai/provider.js';
import { runCritiquePass } from '../critiquePass.js';
import type { SemanticContext } from '../context.js';

/** Rejected symbol records; the 4th is file-level, so it never regenerates. */
const REJECTED_SYMBOLS = ['src/a.ts#one', 'src/b.ts#two', 'src/c.ts#three'];

interface StatusWrite { id: string; status: string; notes: string | null }

/**
 * Returns critique verdicts for the critique schema and empty record sets for
 * regeneration — an empty set is a regeneration that produced nothing, which
 * is the branch that keeps the ORIGINAL verdict's notes.
 */
class ScriptedProvider implements AiProvider {
  readonly id = 'openrouter';
  /** schemaName of every structured call, in arrival order. */
  calls: string[] = [];
  inFlightRegens = 0;
  maxConcurrentRegens = 0;
  private regensArrived = 0;
  private readonly barrier: Promise<void>;
  private releaseBarrier!: () => void;

  constructor(private readonly expectRegens: number) {
    this.barrier = new Promise<void>((resolve) => { this.releaseBarrier = resolve; });
  }

  async complete(_req: CompletionRequest, _opts: ProviderCallOptions): Promise<CompletionResult> {
    throw new Error('unexpected unstructured call');
  }

  async completeStructured<T>(req: StructuredRequest, _opts: ProviderCallOptions): Promise<StructuredResult<T>> {
    this.calls.push(req.schemaName);
    const usage = { inputTokens: 100, outputTokens: 20 };
    if (req.schemaName === 'symbol_records') {
      this.inFlightRegens += 1;
      this.maxConcurrentRegens = Math.max(this.maxConcurrentRegens, this.inFlightRegens);
      this.regensArrived += 1;
      if (this.regensArrived >= this.expectRegens) this.releaseBarrier();
      // Serial regeneration parks here until the timeout instead of the
      // barrier, which is exactly what makes maxConcurrentRegens stay at 1.
      await Promise.race([this.barrier, new Promise((r) => { setTimeout(r, 250); })]);
      this.inFlightRegens -= 1;
      return { value: { records: [] } as T, usage, usedSchemaFallback: false };
    }
    // critique_verdicts — reject every symbol record, with per-record notes.
    const asked = REJECTED_SYMBOLS.filter((key) => req.messages.some((m) => m.content.includes(key)));
    return {
      value: {
        verdicts: [
          ...asked.map((key) => ({
            stable_key: key, verdict: 'rejected',
            failed_claims: [`claim of ${key}`], notes: `notes for ${key}`,
          })),
          { stable_key: 'src/d.ts', verdict: 'rejected', failed_claims: [], notes: 'notes for the file record' },
        ],
      } as T,
      usage,
      usedSchemaFallback: false,
    };
  }
}

function pendingRow(stableKey: string, level: 'symbol' | 'file') {
  return {
    id: `rec-${stableKey}`, stable_key: stableKey, record_level: level, facts_only: false,
    record: { claims: [{ claim: `claim of ${stableKey}`, receiptIds: [] }] },
    summary: `summary of ${stableKey}`, receipt_ids: [],
  };
}

const envKey = process.env.OPENROUTER_API_KEY;

describe('critique pass — rejected records regenerate in parallel', () => {
  before(() => { process.env.OPENROUTER_API_KEY = 'server-key'; });
  after(() => {
    if (envKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = envKey;
    __setQueryForTests(null);
  });
  afterEach(() => __setQueryForTests(null));

  it('runs every reject through its own regeneration, side by side, keeping its own notes', async () => {
    const statusWrites: StatusWrite[] = [];
    installFakeDb({
      extra: (text, params) => {
        if (text.includes('FROM semantic_records sr') && text.includes("sr.status = 'pending'")) {
          return [...REJECTED_SYMBOLS.map((k) => pendingRow(k, 'symbol')), pendingRow('src/d.ts', 'file')];
        }
        if (text.includes('FROM source_receipts WHERE id = ANY')) return [];
        if (text.includes('UPDATE semantic_records sr') && text.includes('jsonb_to_recordset')) {
          const updates = JSON.parse(String(params?.[0] ?? '[]')) as Array<{ id: string; status: string; flags: Array<{ notes?: string }> }>;
          for (const u of updates) statusWrites.push({ id: u.id, status: u.status, notes: u.flags[0]?.notes ?? null });
          return [];
        }
        return null;
      },
    });

    const provider = new ScriptedProvider(REJECTED_SYMBOLS.length);
    const ctx = {
      ai: makeClient(provider, { privacyMode: 'full_ai' }),
      projectId: 'proj-1', snapshotId: 'snap-1', commitHash: 'abc123',
      depth: 'standard', privacyMode: 'full_ai',
      modelFamily: { cheap: 'cheap-model', strong: 'strong-model' },
      graph: {
        nodes: REJECTED_SYMBOLS.map((key) => ({
          stableKey: key, type: 'function', name: key.split('#')[1]!, filePath: key.split('#')[0]!,
          trustLevel: 'code', snippet: 'export function x() {}', metadata: {},
        })),
        edges: [],
      },
      nodeIdMap: new Map(), sideEffects: [],
    } as unknown as SemanticContext;

    const result = await runCritiquePass(ctx);

    // One regeneration per rejected SYMBOL record, all three in flight at once.
    expect(provider.calls.filter((c) => c === 'symbol_records')).to.have.length(3);
    expect(provider.maxConcurrentRegens, 'concurrent regenerations').to.equal(3);
    // The regenerations produced nothing, so nothing is re-critiqued and every
    // record keeps the verdict it was rejected on.
    expect(result).to.deep.equal({ reviewed: 4, usable: 0, rejected: 4, regenerated: 0 });
    expect(statusWrites.map((w) => `${w.id}|${w.status}|${w.notes}`).sort()).to.deep.equal([
      'rec-src/a.ts#one|rejected|notes for src/a.ts#one',
      'rec-src/b.ts#two|rejected|notes for src/b.ts#two',
      'rec-src/c.ts#three|rejected|notes for src/c.ts#three',
      'rec-src/d.ts|rejected|notes for the file record',
    ]);
  });
});
