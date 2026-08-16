import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import { ProviderError, StructuredOutputError } from '../provider.js';
import { OpenRouterProvider, coerceNullArrays, humanizeProviderErrorBody, parseRetryAfterMs } from '../openRouterProvider.js';
import { validateAgainstSchema, extractJson } from '../jsonSchemaValidator.js';
import { resolveTierConfig, defaultTierModels, estimateCostUsd, DEFAULT_FAILURE_BEHAVIOR } from '../modelTiers.js';
import { canonicalJson, computeInputHash } from '../generationRuns.js';
import {
  BudgetEnforcer,
  BudgetExceededError,
  KillSwitchError,
  normalizeBudgetOverrides,
  summarizeRunBudget,
} from '../budgetEnforcer.js';
import { AiPausedError, AiFailedError } from '../aiClient.js';
import { stripSnippetsDeep, applyPrivacyMode, AiDisabledError } from '../privacy.js';
// Shared fakes (test/helpers/aiHarness.ts) — the privacy-mode suites assert
// against the same provider stub, so a call site cannot drift out from under
// one suite while still satisfying the other.
import { FakeProvider, installFakeDb, makeBudget, makeClient } from '../../../../test/helpers/aiHarness.js';

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

describe('phase 4 — provider error body humanizing', () => {
  it('passes non-JSON bodies through untouched', () => {
    expect(humanizeProviderErrorBody('Bad Gateway')).to.equal('Bad Gateway');
  });

  it('extracts error.message from a flat JSON body', () => {
    expect(humanizeProviderErrorBody('{"error":{"message":"Invalid model id","code":400}}')).to.equal('Invalid model id');
  });

  it('keeps the JSON itself when there is no message field', () => {
    expect(humanizeProviderErrorBody('{"code":500}')).to.equal('{"code":500}');
  });

  it('names an empty body instead of ending the message with a colon', () => {
    expect(humanizeProviderErrorBody('')).to.equal('(empty response body)');
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

  function providerWith(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>): { provider: OpenRouterProvider; requests: Array<{ url: string; body: Record<string, unknown> }> } {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const next = responses.shift() ?? { status: 500, body: 'exhausted' };
      return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status, headers: next.headers });
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

  it('unwraps the nested OpenRouter 429 body into a readable message', async () => {
    // Observed live (Aug 2026): OpenRouter pastes the upstream's raw 429 body
    // inside its own error.message, so the pause banner showed escaped JSON.
    const upstream = { error: { message: 'Rate limit exceeded, please try again later.', type: 'request_rate_limit_exceeded', code: 429 } };
    const body = { error: { message: `HTTP 429: ${JSON.stringify(upstream)}`, code: 429 } };
    const { provider } = providerWith([{ status: 429, body }]);
    try {
      await provider.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, opts);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as ProviderError).message).to.equal(
        'provider HTTP 429 (rate limited): Rate limit exceeded, please try again later.',
      );
    }
  });

  /** The ProviderError one scripted response produces. */
  async function errorFrom(response: { status: number; body: unknown; headers?: Record<string, string> }): Promise<ProviderError> {
    const { provider } = providerWith([response]);
    const err = await provider
      .complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, opts)
      .then(() => null, (e: unknown) => e);
    expect(err, 'should have thrown').to.be.instanceOf(ProviderError);
    return err as ProviderError;
  }

  it('captures Retry-After delta-seconds off a 429', async () => {
    const err = await errorFrom({ status: 429, body: 'slow down', headers: { 'retry-after': '30' } });
    expect(err.retryAfterMs).to.equal(30_000);
  });

  it('captures the HTTP-date form, capped at 5 minutes, and ignores a past date', async () => {
    const far = await errorFrom({
      status: 429, body: 'slow down',
      headers: { 'retry-after': new Date(Date.now() + 20 * 60_000).toUTCString() },
    });
    // An upstream asking for 20 minutes gets the cap: the pause is resumable,
    // so holding the job that long buys nothing.
    expect(far.retryAfterMs).to.equal(300_000);

    const stale = await errorFrom({
      status: 429, body: 'slow down',
      headers: { 'retry-after': new Date(Date.now() - 60_000).toUTCString() },
    });
    expect(stale.retryAfterMs).to.equal(undefined);
  });

  it('leaves retryAfterMs undefined when the header is missing or unparseable', async () => {
    expect((await errorFrom({ status: 429, body: 'slow down' })).retryAfterMs).to.equal(undefined);
    expect((await errorFrom({ status: 429, body: 'slow down', headers: { 'retry-after': 'soon' } })).retryAfterMs)
      .to.equal(undefined);
    // Floor: a "0" would spend the retry against a window that has not reopened.
    expect(parseRetryAfterMs('0')).to.equal(1_000);
    expect(parseRetryAfterMs('45')).to.equal(45_000);
    expect(parseRetryAfterMs(null)).to.equal(undefined);
    expect(parseRetryAfterMs(new Date(1_000_000).toUTCString(), 1_060_000)).to.equal(undefined);
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

  // ── embeddings ─────────────────────────────────────────────────────────
  //
  // The request body is model-shaped (ai/embeddingProfiles.ts) and both
  // shapes have to keep working for all of M5: the M4 build writes
  // text-embedding-3-small rows against the same database this build reads.

  /** Env knobs the profile reads — pinned so a dev shell cannot skew asserts. */
  const embedEnv = ['OPENROUTER_BASE_URL', 'OPENROUTER_PROVIDER_SORT', 'OPENROUTER_ZDR', 'OPENROUTER_DATA_COLLECTION'] as const;
  const savedEnv = new Map<string, string | undefined>();
  before(() => {
    for (const k of embedEnv) { savedEnv.set(k, process.env[k]); delete process.env[k]; }
  });
  after(() => {
    for (const [k, v] of savedEnv) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  /** One-hot vector of `dims` dims: normalization must leave it one-hot. */
  const oneHot = (hot: number, dims: number): number[] =>
    Array.from({ length: dims }, (_, i) => (i === hot ? 7 : 0));

  function embedderWith(data: Array<{ index: number; embedding: unknown }>) {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ data, usage: { prompt_tokens: 4 } }), { status: 200 });
    }) as typeof fetch;
    // embeddingsBaseUrl is the OpenAI-path injection seam only — the
    // OpenRouter path must ignore it and use its own base URL.
    return { provider: new OpenRouterProvider({ embeddingsBaseUrl: 'https://emb.local/v1', fetchImpl }), requests };
  }

  it('embed (OpenAI model): legacy body, index-ordered vectors, injected base URL', async () => {
    const { provider, requests } = embedderWith([
      { index: 1, embedding: oneHot(1, 1536) },
      { index: 0, embedding: oneHot(0, 1536) },
    ]);
    const result = await provider.embed(['a', 'b'], 'text-embedding-3-small', opts);

    expect(requests[0]!.url).to.equal('https://emb.local/v1/embeddings');
    expect(requests[0]!.body.dimensions).to.equal(1536);
    expect(requests[0]!.body.provider).to.equal(undefined);
    expect(requests[0]!.body.encoding_format).to.equal(undefined);
    // Sorted back into input order, not response order.
    expect(result.vectors[0]![0]).to.equal(1);
    expect(result.vectors[1]![1]).to.equal(1);
  });

  it('embed (OpenRouter model): ZDR prefs + float encoding, no dimensions, truncated and normalized', async () => {
    // 2560 dims, unnormalized — pplx's real output shape.
    const raw = Array.from({ length: 2560 }, (_, i) => Math.sin(i + 1) * 7);
    const { provider, requests } = embedderWith([{ index: 0, embedding: raw }]);
    const result = await provider.embed(['a'], 'perplexity/pplx-embed-v1-4b', opts);

    expect(requests[0]!.url).to.equal('https://openrouter.ai/api/v1/embeddings');
    expect(requests[0]!.body.dimensions).to.equal(undefined);
    expect(requests[0]!.body.encoding_format).to.equal('float');
    expect(requests[0]!.body.provider).to.deep.equal({ sort: 'throughput', zdr: true, data_collection: 'deny' });

    const vector = result.vectors[0]!;
    expect(vector).to.have.length(1536);
    expect(Math.sqrt(vector.reduce((s, v) => s + v * v, 0))).to.be.closeTo(1, 1e-6);
  });

  it('embed: a non-float vector fails non-retryably naming encoding_format', async () => {
    const { provider } = embedderWith([{ index: 0, embedding: 'YmFzZTY0' }]);
    try {
      await provider.embed(['a'], 'perplexity/pplx-embed-v1-4b', opts);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(ProviderError);
      expect((err as ProviderError).retryable).to.equal(false);
      expect((err as ProviderError).message).to.include('encoding_format');
    }
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

  it('load() keeps the lifetime counters but baselines this run at zero', async () => {
    installFakeDb({ budgetUsageRow: { llm_calls: 7, input_tokens: 999, output_tokens: 1, estimated_cost_usd: 0.5 } });
    const budget = await makeBudget().load();
    // Cumulative totals are still loaded and still written — they are the
    // lifetime cost record.
    expect(budget.usage.llm_calls).to.equal(7);
    expect(budget.usage.budget_events).to.deep.equal([]);
    // CONTRACT CHANGE (per-run budgets): caps are measured from where this
    // run started, so nothing is "already spent" before its first call.
    expect(budget.baseline.llm_calls).to.equal(7);
    expect(budget.usedThisRun.llm_calls).to.equal(0);
    expect(budget.remainingLlmCalls).to.equal(300); // full standard-depth cap
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
      // The stop message has to say what was spent against what.
      expect((err as Error).message).to.equal(
        'budget exceeded (max_llm_calls), used 1 of 1 calls this run (lifetime across runs: 1); stop behavior: degrade',
      );
    }
    expect(budget.usage.budget_events[0]).to.include({ kind: 'budget_tripped', limit: 'max_llm_calls', scope: 'per_run' });
    expect(budget.usage.budget_events[0]).to.have.nested.property('usedThisRun.llm_calls', 1);
  });

  /**
   * The bug this contract change fixes. analysis_snapshots rows are reused
   * across reruns of the same (scope, commit), so budget_usage accumulates on
   * one row forever; enforcing the cap against that total paused a cheap
   * rerun before it made a single call (observed live on Skribbl:
   * "budget exceeded (max_llm_calls); stop behavior: pause" at 0 own calls).
   */
  it('lets a second run on a spent snapshot proceed, capping only its own delta', async () => {
    installFakeDb({ budgetUsageRow: { llm_calls: 300, input_tokens: 5_000_000, output_tokens: 400_000, estimated_cost_usd: 4.2 } });
    const budget = await makeBudget({ stopBehavior: 'pause', overrides: { max_llm_calls: 3 } }).load();

    // Previously: 300 >= 3 → immediate pause with zero work done.
    await budget.checkBeforeBatch(1);
    await budget.recordUsage({ inputTokens: 10, outputTokens: 5, costUsd: 0.001 });
    await budget.checkBeforeBatch(1);
    await budget.recordUsage({ inputTokens: 10, outputTokens: 5, costUsd: 0.001 });
    await budget.checkBeforeBatch(1);
    await budget.recordUsage({ inputTokens: 10, outputTokens: 5, costUsd: 0.001 });

    // Its own delta is still capped — stop behavior fires on the 4th call.
    expect(budget.usedThisRun.llm_calls).to.equal(3);
    expect(budget.remainingLlmCalls).to.equal(0);
    try {
      await budget.checkBeforeBatch(1);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).behavior).to.equal('pause');
      expect((err as BudgetExceededError).limit).to.equal('max_llm_calls');
      expect((err as Error).message).to.contain('used 3 of 3 calls this run (lifetime across runs: 303)');
    }
    // The lifetime record still accumulates — cost transparency is unchanged.
    expect(budget.usage.llm_calls).to.equal(303);
    expect(budget.usage.estimated_cost_usd).to.equal(4.203);
  });

  it('caps input tokens per run too, not against the snapshot lifetime', async () => {
    installFakeDb({ budgetUsageRow: { llm_calls: 0, input_tokens: 5_900_000, output_tokens: 0, estimated_cost_usd: 0 } });
    const budget = await makeBudget({ overrides: { max_input_tokens: 1_000 } }).load();
    await budget.checkBeforeBatch(1); // lifetime 5.9M >> 1k cap, but this run spent 0
    await budget.recordUsage({ inputTokens: 1_000, outputTokens: 1, costUsd: 0 });
    try {
      await budget.checkBeforeBatch(1);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as BudgetExceededError).limit).to.equal('max_input_tokens');
      expect((err as Error).message).to.contain('used 1,000 of 1,000 input tokens this run');
    }
  });

  it('persists the run baseline on the job row and reuses it on a retry', async () => {
    // Fresh run: the conditional UPDATE claims the baseline.
    const log = installFakeDb({ budgetUsageRow: { llm_calls: 50, input_tokens: 1, output_tokens: 1, estimated_cost_usd: 0.1 } });
    const first = await makeBudget({ jobId: 'job-1' }).load();
    expect(first.baseline.llm_calls).to.equal(50);
    expect(first.baselineIsDurable).to.equal(true);
    const claim = log.find((q) => q.text.includes("'{budgetBaseline}'"));
    expect(claim, 'baseline claim UPDATE was issued').to.not.equal(undefined);
    expect(JSON.parse(String(claim!.params?.[1]))).to.include({ llm_calls: 50 });

    // Retry of the SAME job after it already burned 120 calls: it must
    // inherit its original zero point, not re-baseline at 170 and hand
    // itself a second full allowance.
    installFakeDb({
      budgetUsageRow: { llm_calls: 170, input_tokens: 1, output_tokens: 1, estimated_cost_usd: 0.4 },
      jobBaseline: { llm_calls: 50, input_tokens: 1, output_tokens: 1, estimated_cost_usd: 0.1 },
    });
    const retry = await makeBudget({ jobId: 'job-1' }).load();
    expect(retry.baseline.llm_calls).to.equal(50);
    expect(retry.usedThisRun.llm_calls).to.equal(120);
    expect(retry.remainingLlmCalls).to.equal(180); // 300 - 120, not 300
  });

  it('summarizeRunBudget reports per-run usage, and null (never a guess) for legacy runs', () => {
    const lifetime = { llm_calls: 812, input_tokens: 9, output_tokens: 9, estimated_cost_usd: 6.251 };
    expect(summarizeRunBudget({
      depth: 'standard',
      budgetOverrides: { max_llm_calls: 120 },
      baseline: { llm_calls: 772, input_tokens: 9, output_tokens: 9, estimated_cost_usd: 6 },
      jobLlmCalls: 40,
      snapshotUsage: lifetime,
    })).to.deep.equal({
      capLlmCalls: 120, usedThisRun: 40, remaining: 80,
      lifetimeLlmCalls: 812, lifetimeCostUsd: 6.251,
    });

    // No baseline on the job row = the run predates per-run metering. The
    // number is unknown, so it is reported as unknown.
    expect(summarizeRunBudget({
      depth: 'cheap', budgetOverrides: null, baseline: null,
      jobLlmCalls: 40, snapshotUsage: lifetime,
    })).to.deep.equal({
      capLlmCalls: 100, usedThisRun: null, remaining: null,
      lifetimeLlmCalls: 812, lifetimeCostUsd: 6.251,
      note: 'recorded before per-run metering',
    });
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

  it('never dispatches an already-aborted request', async () => {
    // The hedged straggler retries in symbolPass abort the loser as soon as
    // the winner lands. An abort reads as a RETRYABLE provider error, so
    // without the bail in withRetries the cancelled copy would keep re-issuing
    // itself — the one case where "retry" is exactly the wrong response.
    const log = installFakeDb();
    const provider = new FakeProvider();
    const controller = new AbortController();
    controller.abort();
    const client = makeClient(provider);
    try {
      await client.call({ ...baseRequest, signal: controller.signal });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AiFailedError);
    }
    expect(provider.completeCalls).to.have.length(0);
    expect(client.stats.calls).to.equal(0);
    // The attempt is still audited, and closed — not left hanging in 'running'.
    expect(log.filter((q) => q.text.includes('UPDATE ai_generation_runs')).map((q) => q.params?.[1]))
      .to.deep.equal(['failed']);
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
