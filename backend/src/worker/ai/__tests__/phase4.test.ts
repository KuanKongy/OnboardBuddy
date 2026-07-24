import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import {
  ProviderError,
  StructuredOutputError,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
  type ProviderCallOptions,
  type StructuredRequest,
  type StructuredResult,
} from '../provider.js';
import { OpenRouterProvider, coerceNullArrays } from '../openRouterProvider.js';
import { validateAgainstSchema, extractJson } from '../jsonSchemaValidator.js';
import { resolveTierConfig, defaultTierModels, estimateCostUsd, DEFAULT_FAILURE_BEHAVIOR } from '../modelTiers.js';
import { canonicalJson, computeInputHash } from '../generationRuns.js';
import { BudgetEnforcer, BudgetExceededError, KillSwitchError, normalizeBudgetOverrides } from '../budgetEnforcer.js';
import { AiClient, AiPausedError, AiFailedError } from '../aiClient.js';
import { stripSnippetsDeep, applyPrivacyMode, AiDisabledError } from '../privacy.js';

// ── Shared fakes ─────────────────────────────────────────────────────────────

interface QueryLogEntry { text: string; params?: unknown[] }

/** Routes the db-layer queries the ai modules issue; records everything. */
function installFakeDb(overrides: {
  llmKeyRows?: unknown[];
  jobStatus?: string;
  hasCachedRun?: boolean;
  budgetUsageRow?: Record<string, unknown> | null;
} = {}): QueryLogEntry[] {
  const log: QueryLogEntry[] = [];
  let runCounter = 0;
  __setQueryForTests(async (text, params) => {
    log.push({ text, params });
    if (text.includes('FROM project_llm_keys')) return { rows: overrides.llmKeyRows ?? [] } as never;
    if (text.includes('FROM analysis_jobs')) return { rows: [{ status: overrides.jobStatus ?? 'running' }] } as never;
    if (text.includes('FROM ai_generation_runs')) {
      return { rows: overrides.hasCachedRun ? [{ '?column?': 1 }] : [] } as never;
    }
    if (text.includes('INSERT INTO ai_generation_runs')) {
      runCounter += 1;
      return { rows: [{ id: `run-${runCounter}` }] } as never;
    }
    if (text.includes('SELECT budget_usage')) {
      return { rows: overrides.budgetUsageRow === null ? [] : [{ budget_usage: overrides.budgetUsageRow ?? {} }] } as never;
    }
    return { rows: [] } as never;
  });
  return log;
}

class FakeProvider implements AiProvider {
  readonly id = 'openrouter';
  completeCalls: Array<{ model: string }> = [];
  /** Errors to throw before succeeding, consumed in order. */
  errors: unknown[] = [];
  /** Models that always fail, regardless of the error queue. */
  brokenModels = new Set<string>();
  structuredValue: unknown = { ok: true };

  async complete(req: CompletionRequest, _opts: ProviderCallOptions): Promise<CompletionResult> {
    this.completeCalls.push({ model: req.model });
    this.maybeThrow(req.model);
    return { content: `reply from ${req.model}`, usage: { inputTokens: 100, outputTokens: 20 } };
  }

  async completeStructured<T>(req: StructuredRequest, _opts: ProviderCallOptions): Promise<StructuredResult<T>> {
    this.completeCalls.push({ model: req.model });
    this.maybeThrow(req.model);
    return { value: this.structuredValue as T, usage: { inputTokens: 150, outputTokens: 30 }, usedSchemaFallback: false };
  }

  async embed(inputs: string[], _model: string, _opts: ProviderCallOptions): Promise<{ vectors: number[][]; usage: { inputTokens: number; outputTokens: number } }> {
    return { vectors: inputs.map(() => [0.1, 0.2]), usage: { inputTokens: 10, outputTokens: 0 } };
  }

  private maybeThrow(model: string): void {
    if (this.brokenModels.has(model)) throw new ProviderError('model permanently down', 500, true);
    const err = this.errors.shift();
    if (err) throw err;
  }
}

function makeBudget(opts: { depth?: 'cheap' | 'standard' | 'full'; stopBehavior?: 'fail' | 'pause' | 'degrade'; overrides?: unknown; now?: () => number } = {}): BudgetEnforcer {
  return new BudgetEnforcer({
    snapshotId: 'snap-1',
    depth: opts.depth ?? 'standard',
    stopBehavior: opts.stopBehavior,
    budgetOverrides: opts.overrides,
    now: opts.now,
  });
}

function makeClient(provider: FakeProvider, opts: {
  privacyMode?: 'full_ai' | 'facts_only_ai' | 'ai_disabled';
  budget?: BudgetEnforcer;
  models?: Partial<Record<'cheap' | 'strong', string[]>>;
  behaviors?: Partial<Record<'cheap' | 'strong', Array<'retry' | 'degrade' | 'pause' | 'fail'>>>;
} = {}): AiClient {
  const tierConfig = resolveTierConfig();
  if (opts.models?.cheap) tierConfig.models.cheap = opts.models.cheap;
  if (opts.models?.strong) tierConfig.models.strong = opts.models.strong;
  if (opts.behaviors?.cheap) tierConfig.failureBehavior.cheap = opts.behaviors.cheap;
  if (opts.behaviors?.strong) tierConfig.failureBehavior.strong = opts.behaviors.strong;
  return new AiClient({
    projectId: 'proj-1',
    snapshotId: 'snap-1',
    privacyMode: opts.privacyMode ?? 'full_ai',
    budget: opts.budget ?? makeBudget(),
    provider,
    tierConfig,
    maxRetries: 2,
    sleep: async () => {},
  });
}

const baseRequest = {
  tier: 'cheap' as const,
  targetType: 'symbol_record',
  promptVersion: 'test-v1',
  user: 'describe this symbol',
};

describe('phase 4 — model tiers', () => {
  it('default tiers have one model each and spec failure behaviors', () => {
    const models = defaultTierModels();
    expect(models.cheap).to.have.length(1);
    expect(models.strong).to.have.length(1);
    expect(DEFAULT_FAILURE_BEHAVIOR.cheap).to.deep.equal(['retry', 'degrade']);
    expect(DEFAULT_FAILURE_BEHAVIOR.strong).to.deep.equal(['retry', 'pause']);
  });

  it('project overrides replace tier model lists and behaviors', () => {
    const config = resolveTierConfig({
      modelTierOverrides: { cheap: ['a/one', 'a/two'], strong: ['b/big'] },
      modelFailureBehavior: { cheap: ['retry', 'fail'] },
    });
    expect(config.models.cheap).to.deep.equal(['a/one', 'a/two']);
    expect(config.models.strong).to.deep.equal(['b/big']);
    expect(config.failureBehavior.cheap).to.deep.equal(['retry', 'fail']);
    expect(config.failureBehavior.strong).to.deep.equal(['retry', 'pause']);
  });

  it('malformed overrides are ignored per entry', () => {
    const config = resolveTierConfig({
      modelTierOverrides: { cheap: [], strong: 'not-a-list', bogusTier: ['x'] },
      modelFailureBehavior: { cheap: ['explode'], strong: null },
    });
    expect(config.models.cheap).to.deep.equal(defaultTierModels().cheap);
    expect(config.failureBehavior.cheap).to.deep.equal(['retry', 'degrade']);
  });

  it('cost estimates scale with tokens and tier', () => {
    // Tier fallback rows track gemini-2.5-flash-lite ($0.10 in / $0.40 out
    // per Mtok); known models get exact rows via the model param.
    expect(estimateCostUsd('cheap', 1_000_000, 0)).to.be.closeTo(0.1, 1e-9);
    expect(estimateCostUsd('strong', 1_000_000, 1_000_000)).to.be.closeTo(0.5, 1e-9);
    expect(estimateCostUsd('strong', 1_000_000, 1_000_000, 'deepseek/deepseek-v4-flash')).to.be.closeTo(0.27, 1e-9);
    expect(estimateCostUsd('cheap', 1_000_000, 0, 'some/unknown-model')).to.be.closeTo(0.1, 1e-9);
  });
});

describe('phase 4 — null-array coercion (small-model quirk)', () => {
  const schema = {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            inputs_outputs: {
              type: 'object',
              properties: {
                inputs: { type: 'array', items: { type: 'string' } },
                outputs: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  };

  it('replaces null with [] wherever the schema declares an array, at any depth', () => {
    const value = { records: [{ name: 'a', inputs_outputs: { inputs: ['x'], outputs: null } }] };
    const fixed = coerceNullArrays(value, schema) as { records: Array<{ inputs_outputs: { inputs: string[]; outputs: string[] } }> };
    expect(fixed.records[0]!.inputs_outputs.outputs).to.deep.equal([]);
    expect(fixed.records[0]!.inputs_outputs.inputs).to.deep.equal(['x']); // untouched
    expect(validateAgainstSchema(fixed, schema)).to.deep.equal([]);
  });

  it('coerces a null top-level array and leaves non-array nulls alone', () => {
    expect(coerceNullArrays(null, { type: 'array' })).to.deep.equal([]);
    const value = { records: [{ name: null, inputs_outputs: { inputs: null, outputs: [] } }] };
    const fixed = coerceNullArrays(value, schema) as { records: Array<{ name: unknown; inputs_outputs: { inputs: string[] } }> };
    expect(fixed.records[0]!.name).to.equal(null); // string stays null — validator must still flag it
    expect(fixed.records[0]!.inputs_outputs.inputs).to.deep.equal([]);
  });

  it('respects schemas that explicitly allow null arrays', () => {
    expect(coerceNullArrays(null, { type: ['array', 'null'] })).to.equal(null);
  });
});

describe('phase 4 — input hashing', () => {
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3] } })).to.equal(canonicalJson({ a: { c: [3], d: 2 }, b: 1 }));
  });

  it('hash changes when the payload changes', () => {
    const base = { promptVersion: 'v1', user: 'hello' };
    expect(computeInputHash(base)).to.equal(computeInputHash({ ...base }));
    expect(computeInputHash(base)).to.not.equal(computeInputHash({ ...base, user: 'hello!' }));
  });
});

describe('phase 4 — json schema validator', () => {
  const schema = {
    type: 'object',
    required: ['title', 'confidence', 'sources'],
    properties: {
      title: { type: 'string' },
      confidence: { enum: ['high', 'medium', 'low'] },
      sources: { type: 'array', items: { type: 'object', required: ['stable_key'], properties: { stable_key: { type: 'string' } } } },
    },
  };

  it('accepts a conforming value', () => {
    const violations = validateAgainstSchema(
      { title: 't', confidence: 'high', sources: [{ stable_key: 'a.ts' }] },
      schema,
    );
    expect(violations).to.deep.equal([]);
  });

  it('reports missing required properties and enum/type mismatches', () => {
    const violations = validateAgainstSchema(
      { title: 42, confidence: 'certain', sources: [{}] },
      schema,
    );
    const paths = violations.map((v) => v.path);
    expect(paths).to.include('$.title');
    expect(paths).to.include('$.confidence');
    expect(paths).to.include('$.sources[0].stable_key');
  });

  it('extractJson strips fences and surrounding prose', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).to.deep.equal({ a: 1 });
    expect(extractJson('Sure! Here it is: {"a": [1, 2]} Hope that helps.')).to.deep.equal({ a: [1, 2] });
  });
});

describe('phase 4 — OpenRouter provider', () => {
  const opts = { apiKey: 'k' };

  function providerWith(responses: Array<{ status: number; body: unknown }>): { provider: OpenRouterProvider; requests: Array<{ url: string; body: Record<string, unknown> }> } {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const next = responses.shift() ?? { status: 500, body: 'exhausted' };
      return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status });
    }) as typeof fetch;
    return { provider: new OpenRouterProvider({ baseUrl: 'https://test.local/v1', fetchImpl }), requests };
  }

  const chatOk = (content: string) => ({
    status: 200,
    body: { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  });

  it('complete returns content and token usage', async () => {
    const { provider } = providerWith([chatOk('hello')]);
    const result = await provider.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, opts);
    expect(result.content).to.equal('hello');
    expect(result.usage).to.deep.equal({ inputTokens: 10, outputTokens: 5 });
  });

  it('classifies 429 as retryable and 400 as not', async () => {
    for (const [status, retryable] of [[429, true], [400, false]] as const) {
      const { provider } = providerWith([{ status, body: 'nope' }]);
      try {
        await provider.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, opts);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(ProviderError);
        expect((err as ProviderError).retryable).to.equal(retryable);
      }
    }
  });

  it('structured: strict json_schema request parses the response', async () => {
    const { provider, requests } = providerWith([chatOk('{"answer": "yes"}')]);
    const result = await provider.completeStructured({
      model: 'm', messages: [{ role: 'user', content: 'q' }],
      schemaName: 'test', schema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
    }, opts);
    expect(result.value).to.deep.equal({ answer: 'yes' });
    expect(result.usedSchemaFallback).to.equal(false);
    expect(requests[0]!.body.response_format).to.deep.include({ type: 'json_schema' });
  });

  it('structured: schema rejection falls back to JSON prompting', async () => {
    const { provider, requests } = providerWith([
      { status: 400, body: 'response_format json_schema is not supported by this model' },
      chatOk('{"answer": "fallback"}'),
    ]);
    const result = await provider.completeStructured({
      model: 'm', messages: [{ role: 'user', content: 'q' }],
      schemaName: 'test', schema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
    }, opts);
    expect(result.value).to.deep.equal({ answer: 'fallback' });
    expect(result.usedSchemaFallback).to.equal(true);
    expect(requests[1]!.body.response_format).to.equal(undefined);
    expect(String((requests[1]!.body.messages as Array<{ content: string }>).at(-1)!.content)).to.include('JSON schema');
  });

  it('structured: invalid output gets one validation retry, then StructuredOutputError', async () => {
    const schema = { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } };
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'q' }], schemaName: 'test', schema };

    const good = providerWith([chatOk('{"wrong": 1}'), chatOk('{"answer": "fixed"}')]);
    const fixed = await good.provider.completeStructured(req, opts);
    expect(fixed.value).to.deep.equal({ answer: 'fixed' });
    expect(fixed.usedSchemaFallback).to.equal(true);
    // Usage accumulates across the retry.
    expect(fixed.usage.inputTokens).to.equal(20);

    const bad = providerWith([chatOk('{"wrong": 1}'), chatOk('still wrong')]);
    try {
      await bad.provider.completeStructured(req, opts);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(StructuredOutputError);
    }
  });

  it('embed returns index-ordered vectors', async () => {
    const requests: unknown[] = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }],
        usage: { prompt_tokens: 4 },
      }), { status: 200 });
    }) as typeof fetch;
    const provider = new OpenRouterProvider({ embeddingsBaseUrl: 'https://emb.local/v1', fetchImpl });
    const result = await provider.embed(['a', 'b'], 'text-embedding-3-small', opts);
    expect(result.vectors).to.deep.equal([[1], [2]]);
  });
});

describe('phase 4 — budget enforcer', () => {
  afterEach(() => __setQueryForTests(null));

  it('normalizes snake_case and camelCase override keys, dropping junk', () => {
    expect(normalizeBudgetOverrides({ max_llm_calls: 50, maxInputTokens: 100, max_files: -1, nonsense: 9 }))
      .to.deep.equal({ maxLlmCalls: 50, maxInputTokens: 100 });
  });

  it('records usage cumulatively in memory; flush persists to budget_usage', async () => {
    const log = installFakeDb();
    const budget = makeBudget();
    await budget.recordUsage({ inputTokens: 100, outputTokens: 10, costUsd: 0.01 });
    await budget.recordUsage({ inputTokens: 50, outputTokens: 5, costUsd: 0.005 });
    expect(budget.usage.llm_calls).to.equal(2);
    expect(budget.usage.input_tokens).to.equal(150);
    expect(budget.usage.estimated_cost_usd).to.equal(0.015);
    // Persistence is amortized (Track C): two calls stay in memory until a
    // flush threshold or an explicit phase-boundary flush.
    expect(log.filter((q) => q.text.includes('SET budget_usage'))).to.have.length(0);
    await budget.flush();
    const persist = log.filter((q) => q.text.includes('SET budget_usage'));
    expect(persist).to.have.length(1);
  });

  it('load() resumes from persisted counters', async () => {
    installFakeDb({ budgetUsageRow: { llm_calls: 7, input_tokens: 999, output_tokens: 1, estimated_cost_usd: 0.5 } });
    const budget = await makeBudget().load();
    expect(budget.usage.llm_calls).to.equal(7);
    expect(budget.usage.budget_events).to.deep.equal([]);
  });

  it('trips max_llm_calls with the configured stop behavior and records the event', async () => {
    installFakeDb();
    const budget = makeBudget({ stopBehavior: 'degrade', overrides: { max_llm_calls: 1 } });
    await budget.recordUsage({ inputTokens: 1, outputTokens: 1, costUsd: 0 });
    try {
      await budget.checkBeforeBatch(1);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).behavior).to.equal('degrade');
      expect((err as BudgetExceededError).limit).to.equal('max_llm_calls');
    }
    expect(budget.usage.budget_events[0]).to.include({ kind: 'budget_tripped', limit: 'max_llm_calls' });
  });

  it('trips max_runtime_ms via the injected clock', async () => {
    installFakeDb();
    let nowMs = 0;
    const budget = makeBudget({ now: () => nowMs, overrides: { max_runtime_ms: 1000 } });
    await budget.checkBeforeBatch(); // fine at t=0
    nowMs = 1500;
    try {
      await budget.checkBeforeBatch();
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as BudgetExceededError).limit).to.equal('max_runtime_ms');
    }
  });

  it('honors the kill switch at the batch boundary', async () => {
    installFakeDb({ jobStatus: 'paused' });
    const budget = new BudgetEnforcer({ snapshotId: 'snap-1', jobId: 'job-1', depth: 'standard' });
    try {
      await budget.checkBeforeBatch();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(KillSwitchError);
      expect((err as KillSwitchError).jobStatus).to.equal('paused');
    }
  });

  it('caches the kill-switch check for its TTL, then re-checks', async () => {
    let nowMs = 1_000_000;
    const log = installFakeDb({ jobStatus: 'running' });
    const budget = new BudgetEnforcer({ snapshotId: 'snap-1', jobId: 'job-1', depth: 'standard', now: () => nowMs });
    const killChecks = () => log.filter((q) => q.text.includes('FROM analysis_jobs')).length;
    await budget.checkBeforeBatch();
    expect(killChecks()).to.equal(1);
    nowMs += 500; // inside TTL — no new SELECT
    await budget.checkBeforeBatch();
    expect(killChecks()).to.equal(1);
    nowMs += 2_100; // past TTL — re-check
    await budget.checkBeforeBatch();
    expect(killChecks()).to.equal(2);
  });

  it('amortizes usage persistence: flushes at 10 calls, 5s, or explicitly', async () => {
    let nowMs = 1_000_000;
    const log = installFakeDb();
    const budget = new BudgetEnforcer({ snapshotId: 'snap-1', depth: 'standard', now: () => nowMs });
    const writes = () => log.filter((q) => q.text.includes('SET budget_usage')).length;
    const delta = { inputTokens: 10, outputTokens: 5, costUsd: 0.001 };

    for (let i = 0; i < 9; i++) await budget.recordUsage(delta);
    expect(writes()).to.equal(0); // 9 calls, within 5s — nothing persisted
    await budget.recordUsage(delta); // 10th call flushes
    expect(writes()).to.equal(1);

    nowMs += 6_000; // time-based flush on the next usage
    await budget.recordUsage(delta);
    expect(writes()).to.equal(2);

    await budget.flush(); // explicit flush always writes
    expect(writes()).to.equal(3);
    // Limits are enforced from in-memory counters regardless of flushes.
    expect(budget.usage.llm_calls).to.equal(11);
  });
});

describe('phase 4 — AiClient', () => {
  const envKey = process.env.OPENROUTER_API_KEY;
  before(() => { process.env.OPENROUTER_API_KEY = 'server-key'; });
  after(() => { process.env.OPENROUTER_API_KEY = envKey; });
  afterEach(() => __setQueryForTests(null));

  it('completes, audits the run, and records budget usage', async () => {
    const log = installFakeDb();
    const provider = new FakeProvider();
    const client = makeClient(provider);
    const response = await client.call(baseRequest);
    expect(response.content).to.match(/^reply from /);
    expect(response.degraded).to.equal(false);
    expect(response.runId).to.equal('run-1');
    expect(client.stats.calls).to.equal(1);
    const inserts = log.filter((q) => q.text.includes('INSERT INTO ai_generation_runs'));
    const finishes = log.filter((q) => q.text.includes('UPDATE ai_generation_runs'));
    expect(inserts).to.have.length(1);
    expect(finishes).to.have.length(1);
    expect(finishes[0]!.params?.[1]).to.equal('complete');
    // Budget persistence is amortized (Track C): one call doesn't write the
    // counters row; an explicit flush (phase boundary) does.
    expect(log.some((q) => q.text.includes('SET budget_usage'))).to.equal(false);
    await client.budget.flush();
    expect(log.some((q) => q.text.includes('SET budget_usage'))).to.equal(true);
  });

  it('retries retryable errors with backoff, then succeeds on the same model', async () => {
    installFakeDb();
    const provider = new FakeProvider();
    provider.errors = [new ProviderError('429', 429, true), new ProviderError('503', 503, true)];
    const client = makeClient(provider);
    const response = await client.call(baseRequest);
    expect(response.degraded).to.equal(false);
    expect(provider.completeCalls).to.have.length(3);
  });

  it('re-rolls a fresh attempt when structured output fails validation', async () => {
    // Malformed JSON is stochastic (seen live on two different models for the
    // same payload): a brand-new sample must be tried, not just the provider's
    // internal in-conversation repair.
    installFakeDb();
    const provider = new FakeProvider();
    provider.errors = [new StructuredOutputError('bad json after retry', '{"broken"')];
    const client = makeClient(provider);
    const response = await client.call({ ...baseRequest, schema: { type: 'object' }, schemaName: 'x' });
    expect(response.degraded).to.equal(false);
    expect(provider.completeCalls).to.have.length(2);
  });

  it("degrades to the tier's next model when the primary keeps failing", async () => {
    const log = installFakeDb();
    const provider = new FakeProvider();
    provider.brokenModels.add('primary/model');
    const client = makeClient(provider, { models: { cheap: ['primary/model', 'fallback/model'] } });
    const response = await client.call(baseRequest);
    expect(response.model).to.equal('fallback/model');
    expect(response.degraded).to.equal(true);
    expect(client.stats.degradedCalls).to.equal(1);
    // Audit trail: one failed run for the primary, one complete for the fallback.
    const finishes = log.filter((q) => q.text.includes('UPDATE ai_generation_runs')).map((q) => q.params?.[1]);
    expect(finishes).to.deep.equal(['failed', 'complete']);
  });

  it('pauses (resumable) when a pause-tier model is exhausted', async () => {
    installFakeDb();
    const provider = new FakeProvider();
    provider.brokenModels.add(resolveTierConfig().models.strong[0]!);
    const client = makeClient(provider);
    try {
      await client.call({ ...baseRequest, tier: 'strong' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AiPausedError);
    }
  });

  it('fails hard when the tier is configured to fail', async () => {
    installFakeDb();
    const provider = new FakeProvider();
    provider.errors = [new ProviderError('bad request', 400, false)];
    const client = makeClient(provider, { behaviors: { cheap: ['fail'] } });
    try {
      await client.call(baseRequest);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AiFailedError);
    }
  });

  it('skips work whose input hash already has a complete run (skipped_cached)', async () => {
    const log = installFakeDb({ hasCachedRun: true });
    const provider = new FakeProvider();
    const client = makeClient(provider);
    const response = await client.call({ ...baseRequest, skipIfCached: true });
    expect(response.cached).to.equal(true);
    expect(provider.completeCalls).to.have.length(0);
    expect(client.stats.cacheHits).to.equal(1);
    const skipInsert = log.find((q) => q.text.includes('INSERT INTO ai_generation_runs') && q.text.includes('skipped_cached'));
    expect(skipInsert).to.not.equal(undefined);
  });

  it('uses the decrypted project key when one exists', async () => {
    const { encrypt } = await import('../../../lib/encryption.js');
    const log = installFakeDb({ llmKeyRows: [{ api_key_encrypted: encrypt('project-secret-key') }] });
    const provider = new FakeProvider();
    let seenKey: string | null = null;
    const original = provider.complete.bind(provider);
    provider.complete = async (req, opts) => { seenKey = opts.apiKey; return original(req, opts); };
    const client = makeClient(provider);
    await client.call(baseRequest);
    expect(seenKey).to.equal('project-secret-key');
    // key_source is recorded on the audit row
    const insert = log.find((q) => q.text.includes('INSERT INTO ai_generation_runs'));
    expect(insert!.params).to.include('project');
  });

  it('refuses to call any model when privacy is ai_disabled', async () => {
    installFakeDb();
    const client = makeClient(new FakeProvider(), { privacyMode: 'ai_disabled' });
    try {
      await client.call(baseRequest);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AiDisabledError);
    }
  });

  it('propagates budget trips from the batch boundary', async () => {
    installFakeDb();
    const budget = makeBudget({ stopBehavior: 'pause', overrides: { max_llm_calls: 1 } });
    await budget.recordUsage({ inputTokens: 1, outputTokens: 1, costUsd: 0 });
    const client = makeClient(new FakeProvider(), { budget });
    try {
      await client.call(baseRequest);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).behavior).to.equal('pause');
    }
  });

  it('budgets and audits embedding batches', async () => {
    const log = installFakeDb();
    process.env.EMBEDDINGS_API_KEY = 'emb-key';
    const client = makeClient(new FakeProvider());
    const result = await client.embed(['one', 'two']);
    expect(result.vectors).to.have.length(2);
    const insert = log.find((q) => q.text.includes('INSERT INTO ai_generation_runs'));
    expect(insert!.params).to.include('embedding_batch');
    delete process.env.EMBEDDINGS_API_KEY;
  });
});

describe('phase 4 — privacy modes', () => {
  it('strips snippet-bearing fields deeply in facts-only mode', () => {
    const bundle = {
      nodes: [{ name: 'a', snippet: 'const secret = 1;', nested: { code: 'x', keep: true } }],
      snippet: 'top',
    };
    const stripped = applyPrivacyMode(bundle, 'facts_only_ai');
    expect(stripped).to.deep.equal({ nodes: [{ name: 'a', nested: { keep: true } }] });
    // full_ai passes evidence through untouched
    expect(applyPrivacyMode(bundle, 'full_ai')).to.equal(bundle);
  });

  it('stripSnippetsDeep leaves arrays and scalars intact', () => {
    expect(stripSnippetsDeep([1, 'two', null])).to.deep.equal([1, 'two', null]);
  });

  it('ai_disabled throws before anything is assembled', () => {
    expect(() => applyPrivacyMode({}, 'ai_disabled')).to.throw(AiDisabledError);
  });
});
