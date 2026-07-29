/**
 * Straggler hedging in the symbol pass.
 *
 * The phase is a mapLimit over batches, so ONE request the provider parks (96s
 * of a 181s symbol phase in the 2026-07-28 cold benchmark) holds its slot and
 * stretches the whole phase. Hedging sends a duplicate of that batch and keeps
 * whichever answers first. What is pinned here is what cannot be eyeballed
 * from a run: the duplicate appears only past the threshold, the loser is
 * really CANCELLED (rather than left running to be billed, to write a second
 * copy of the records, and to leave a run row stuck in 'running'), the per-run
 * cap holds, and a budget stop still stops the phase instead of being
 * swallowed by the race.
 */

import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import { installFakeDb, makeBudget, makeClient, recordStoreRoutes, type QueryLogEntry } from '../../../../test/helpers/aiHarness.js';
import { BudgetExceededError } from '../../ai/budgetEnforcer.js';
import {
  ProviderError,
  type AiProvider, type CompletionResult, type ProviderCallOptions,
  type StructuredRequest, type StructuredResult,
} from '../../ai/provider.js';
import { runSymbolPass, __setHedgeDelayForTests } from '../symbolPass.js';
import type { SemanticContext } from '../context.js';

/** How a scripted call behaves: answer now, after `ms`, or never (abort only). */
type Behavior = 'now' | 'never' | number;

interface SeenCall {
  /** Batch identity — the stable keys the prompt asked about. */
  batch: string;
  /** 1 = the original call for that batch, 2 = its hedge. */
  attempt: number;
  signal?: AbortSignal;
}

class ScriptedProvider implements AiProvider {
  readonly id = 'openrouter';
  readonly calls: SeenCall[] = [];
  private readonly attemptsByBatch = new Map<string, number>();

  constructor(private readonly behaviorFor: (call: SeenCall) => Behavior) {}

  async complete(): Promise<CompletionResult> {
    throw new Error('symbol batches are structured calls');
  }

  async completeStructured<T>(req: StructuredRequest, opts: ProviderCallOptions): Promise<StructuredResult<T>> {
    const keys = [...req.messages.map((m) => m.content).join('\n').matchAll(/### Symbol (\S+)/g)].map((m) => m[1]!);
    const batch = keys.join(',');
    const attempt = (this.attemptsByBatch.get(batch) ?? 0) + 1;
    this.attemptsByBatch.set(batch, attempt);
    const call: SeenCall = { batch, attempt, signal: opts.signal };
    this.calls.push(call);

    const behavior = this.behaviorFor(call);
    if (behavior !== 'now') await park(opts.signal, behavior === 'never' ? null : behavior);
    return {
      value: { records: keys.map((key) => recordFor(key, attempt)) } as T,
      usage: { inputTokens: 100, outputTokens: 20 },
      usedSchemaFallback: false,
    };
  }

  async embed(): Promise<{ vectors: number[][]; usage: { inputTokens: number; outputTokens: number } }> {
    throw new Error('unexpected embedding call');
  }
}

/**
 * Parks until `ms` (or forever) unless the caller aborts — an abort surfaces
 * as a RETRYABLE ProviderError, exactly as openRouterProvider reports a
 * cancelled fetch. That is what makes the call counts here also prove
 * AiClient.withRetries does not re-issue an aborted request.
 */
function park(signal: AbortSignal | undefined, ms: number | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = ms === null ? undefined : setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new ProviderError('request aborted by caller', null, true));
    });
  });
}

function recordFor(stableKey: string, attempt: number) {
  return {
    stable_key: stableKey,
    purpose: `attempt ${attempt}`,
    behavior: 'does a thing',
    responsibilities: [], business_concepts: [], side_effects: [],
    inputs_outputs: null, dependencies_narrative: 'none', design_patterns: [],
    risks_invariants: [], confidence: 'high', claims: [],
  };
}

function keysFor(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `src/file${Math.floor(i / 10)}.ts#sym${i}`);
}

function makeCtx(ai: SemanticContext['ai'], keys: string[]): SemanticContext {
  return {
    ai,
    projectId: 'proj-1', snapshotId: 'snap-1', commitHash: 'abc123',
    depth: 'standard', privacyMode: 'full_ai',
    modelFamily: { cheap: 'test/cheap', strong: 'test/strong' },
    graph: {
      nodes: keys.map((key) => ({
        stableKey: key, type: 'function', name: key.split('#')[1]!, filePath: key.split('#')[0]!,
        trustLevel: 'code', snippet: 'export function x() { return 1; }', metadata: {}, hash: `h-${key}`,
      })),
      edges: [],
    },
    nodeIdMap: new Map(), sideEffects: [],
    gating: { selected: keys, factsOnly: [] },
  } as unknown as SemanticContext;
}

/** Lets the aborted loser finish rejecting so its audit row can be asserted. */
const settleBackground = () => new Promise((r) => { setTimeout(r, 30); });

function runStatuses(log: QueryLogEntry[]): string[] {
  return log.filter((q) => q.text.includes('UPDATE ai_generation_runs')).map((q) => String(q.params?.[1])).sort();
}

const envKey = process.env.OPENROUTER_API_KEY;
const envHedgeMax = process.env.SYMBOL_HEDGE_MAX;

describe('symbol pass — straggler hedging', () => {
  before(() => { process.env.OPENROUTER_API_KEY = 'server-key'; });
  after(() => {
    if (envKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = envKey;
  });
  afterEach(() => {
    __setQueryForTests(null);
    __setHedgeDelayForTests(null);
    if (envHedgeMax === undefined) delete process.env.SYMBOL_HEDGE_MAX;
    else process.env.SYMBOL_HEDGE_MAX = envHedgeMax;
  });

  it('sends no duplicate when batches answer inside the threshold', async () => {
    installFakeDb({ extra: recordStoreRoutes() });
    __setHedgeDelayForTests(5_000);
    const provider = new ScriptedProvider(() => 'now');
    const keys = keysFor(20); // MAX_SYMBOLS_PER_CALL = 10 -> two batches
    const result = await runSymbolPass(makeCtx(makeClient(provider as never, { models: { cheap: ['test/cheap'] } }), keys));

    expect(provider.calls).to.have.length(2);
    expect(provider.calls.every((c) => c.attempt === 1), 'no hedge fired').to.equal(true);
    expect(result.llmRecords).to.equal(20);
  });

  it('hedges a parked batch, keeps the winner, cancels and un-bills the loser', async () => {
    const log = installFakeDb({ extra: recordStoreRoutes() });
    __setHedgeDelayForTests(10);
    // The original call never answers on its own; only the hedge can finish.
    const provider = new ScriptedProvider((c) => (c.attempt === 1 ? 'never' : 'now'));
    const keys = keysFor(10);
    const ai = makeClient(provider as never, { models: { cheap: ['test/cheap'] } });
    const result = await runSymbolPass(makeCtx(ai, keys));

    expect(provider.calls.map((c) => c.attempt)).to.deep.equal([1, 2]);
    // Records came from the hedge, and every symbol still got one.
    expect(result.llmRecords).to.equal(10);
    expect([...result.records.values()].map((r) => r.record.purpose)).to.deep.equal(Array(10).fill('attempt 2'));
    // The loser was really cancelled — this is the assertion that fails if the
    // signal stops being threaded through AiRequest into the provider call.
    expect(provider.calls[0]!.signal?.aborted, 'loser saw its abort').to.equal(true);
    // One success -> one recordUsage. A loser that kept running (or that
    // withRetries re-issued) would show up as a second charged call.
    expect(ai.stats.calls).to.equal(1);

    await settleBackground();
    expect(runStatuses(log)).to.deep.equal(['complete', 'failed']);
  });

  it('stops hedging at SYMBOL_HEDGE_MAX for the run', async () => {
    installFakeDb({ extra: recordStoreRoutes() });
    __setHedgeDelayForTests(10);
    process.env.SYMBOL_HEDGE_MAX = '2';
    // Every original call is a straggler; the batches past the cap wait it out.
    const provider = new ScriptedProvider((c) => (c.attempt === 1 ? 250 : 'now'));
    const keys = keysFor(50); // five batches
    const result = await runSymbolPass(makeCtx(makeClient(provider as never, { models: { cheap: ['test/cheap'] } }), keys));

    expect(provider.calls.filter((c) => c.attempt === 1)).to.have.length(5);
    expect(provider.calls.filter((c) => c.attempt === 2), 'hedges fired').to.have.length(2);
    expect(result.llmRecords).to.equal(50);
  });

  it('lets a budget stop out of the race instead of swallowing it', async () => {
    installFakeDb({ extra: recordStoreRoutes() });
    __setHedgeDelayForTests(5_000);
    const budget = makeBudget({ stopBehavior: 'fail', overrides: { max_llm_calls: 1 } });
    await budget.recordUsage({ inputTokens: 1, outputTokens: 1, costUsd: 0 });
    const provider = new ScriptedProvider(() => 'now');
    const ctx = makeCtx(makeClient(provider as never, { budget, models: { cheap: ['test/cheap'] } }), keysFor(10));

    try {
      await runSymbolPass(ctx);
      expect.fail('the budget stop should have propagated');
    } catch (err) {
      expect(err).to.be.instanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).behavior).to.equal('fail');
    }
    // Tripped at the batch boundary: no provider call, and no halving retry
    // loop re-trying a batch the budget has already refused.
    expect(provider.calls).to.have.length(0);
  });
});
