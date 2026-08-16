/**
 * AiClient — the one entry point for LLM work (doc/Pipeline.md "LLM
 * Infrastructure"). Every call goes through: privacy-mode assertion,
 * budget check + kill switch at the batch boundary, input-hash cache
 * (skipped_cached), per-project key resolution, the tier's model list
 * with configured failure behavior (retry with backoff -> degrade to the
 * next model -> pause/fail), a concurrency semaphore, and
 * ai_generation_runs auditing of every attempt.
 */

import {
  type AiProvider,
  type ChatMessage,
  type JsonSchema,
  type ModelTier,
  type TokenUsage,
  ProviderError,
  StructuredOutputError,
} from './provider.js';
import { OpenRouterProvider } from './openRouterProvider.js';
import { rateLimitGate } from './rateLimitGate.js';
import { resolveTierConfig, estimateCostUsd, type TierConfig, type FailureBehavior } from './modelTiers.js';
import { resolveApiKey, resolveEmbeddingsKey, type ResolvedKey } from './keyResolver.js';
import {
  computeInputHash,
  computeOutputHash,
  hasCompleteRun,
  startRun,
  finishRun,
  recordSkippedCached,
  type RunIdentity,
} from './generationRuns.js';
import { BudgetEnforcer } from './budgetEnforcer.js';
import { assertAiAllowed, type PrivacyMode } from './privacy.js';

// ── Control-flow errors (mapped to job/snapshot status by callers) ───────────

/** The tier's failure behavior asked for a resumable pause. */
export class AiPausedError extends Error {
  /**
   * True when the pause was provider rate limiting rather than a broken call.
   * A rate-limited pause is the one kind that resolves purely by waiting, so
   * it is the one a resume can be scheduled for instead of asking the user.
   */
  readonly rateLimited: boolean;

  constructor(public readonly reason: string, opts: { rateLimited?: boolean } = {}) {
    super(`LLM work paused: ${reason}`);
    this.name = 'AiPausedError';
    this.rateLimited = opts.rateLimited ?? false;
  }
}

/** The tier's failure behavior asked to fail the snapshot. */
export class AiFailedError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'AiFailedError';
  }
}

// ── Requests/responses ───────────────────────────────────────────────────────

export interface AiRequest {
  tier: 'cheap' | 'strong';
  /** ai_generation_runs.target_type, e.g. 'section', 'workflow_record'. */
  targetType: string;
  targetId?: string;
  packageId?: string;
  sectionType?: string;
  promptVersion: string;
  system?: string;
  user: string;
  /** Present = structured output (json_schema strict with fallback). */
  schemaName?: string;
  schema?: JsonSchema;
  maxOutputTokens?: number;
  temperature?: number;
  /** Skip when an identical complete run exists for this snapshot (resume path). */
  skipIfCached?: boolean;
  /**
   * Cancels the provider call. The provider merges it with its own
   * per-attempt timeout (openRouterProvider.post), and withRetries treats an
   * aborted request as final — symbolPass aborts the losing copy of a hedged
   * straggler batch the moment the winner lands.
   */
  signal?: AbortSignal;
}

export interface AiResponse<T = unknown> {
  cached: boolean;
  /** Plain-text content (null for cached skips). */
  content: string | null;
  /** Parsed structured value when a schema was given. */
  value: T | null;
  model: string | null;
  usage: TokenUsage;
  /** True when a fallback model (not the tier's primary) served the request. */
  degraded: boolean;
  /** ai_generation_runs.id of the serving run (null for cached skips). */
  runId: string | null;
}

export interface AiClientStats {
  calls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  degradedCalls: number;
  schemaFallbacks: number;
}

export interface AiClientOptions {
  projectId: string;
  snapshotId: string;
  /** analysis_jobs row these calls run under — per-job cost audit. Omit for /ask. */
  jobId?: string;
  privacyMode: PrivacyMode;
  budget: BudgetEnforcer;
  tierConfig?: TierConfig;
  provider?: AiProvider;
  maxConcurrency?: number;
  maxRetries?: number;
  /** 429 waits allowed per call, separate from maxRetries. */
  maxRateLimitWaits?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
/**
 * 429 waits allowed per call. Six waits on the schedule below is ~285s of
 * patience before the tier's failure behavior takes over — long enough to
 * outlast the per-minute windows that pause runs today, short enough that a
 * key which is genuinely out of quota still surfaces a (resumable) pause in
 * under five minutes instead of holding a worker slot indefinitely.
 */
const DEFAULT_MAX_RATE_LIMIT_WAITS = 6;
/**
 * Cooldowns per successive 429, indexed by waits already taken and clamped to
 * the last entry: 15s, 30s, 60s, 60s, 60s, 60s. The old generic backoff
 * (500ms · 2^attempt, ~3.5s over three attempts) is shorter than any
 * rate-limit window an upstream enforces, so 429s deterministically exhausted
 * it and paused the run — the numbers here are sized against per-minute
 * windows, not against transient 5xx. Only used when the response carried no
 * Retry-After of its own.
 */
const RATE_LIMIT_BACKOFF_MS = [15_000, 30_000, 60_000];

export class AiClient {
  readonly stats: AiClientStats = {
    calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0,
    estimatedCostUsd: 0, degradedCalls: 0, schemaFallbacks: 0,
  };

  private readonly provider: AiProvider;
  private readonly tierConfig: TierConfig;
  private readonly semaphore: Semaphore;
  private readonly maxRetries: number;
  private readonly maxRateLimitWaits: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private keyPromise: Promise<ResolvedKey> | null = null;

  constructor(private readonly options: AiClientOptions) {
    this.provider = options.provider ?? new OpenRouterProvider();
    this.tierConfig = options.tierConfig ?? resolveTierConfig();
    // Flash-tier decode makes parallelism the throughput lever (latency
    // overhaul Track D); env LLM_MAX_CONCURRENCY still wins.
    this.semaphore = new Semaphore(options.maxConcurrency ?? Number(process.env.LLM_MAX_CONCURRENCY ?? 12));
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRateLimitWaits = options.maxRateLimitWaits ?? DEFAULT_MAX_RATE_LIMIT_WAITS;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** The embedding-tier model this client would use (embeddings table key). */
  get embeddingModel(): string {
    return this.tierConfig.models.embedding[0]!;
  }

  /** Budget enforcer behind this client — phase boundaries flush() it. */
  get budget(): BudgetEnforcer {
    return this.options.budget;
  }

  /** Text or structured completion, depending on whether `schema` is set. */
  async call<T = unknown>(req: AiRequest): Promise<AiResponse<T>> {
    assertAiAllowed(this.options.privacyMode);
    await this.options.budget.checkBeforeBatch(1);

    const models = this.tierConfig.models[req.tier];
    const behaviors = this.tierConfig.failureBehavior[req.tier];
    const inputHash = computeInputHash({
      promptVersion: req.promptVersion,
      tier: req.tier,
      system: req.system ?? null,
      user: req.user,
      schemaName: req.schemaName ?? null,
      schema: req.schema ?? null,
      privacyMode: this.options.privacyMode,
    });

    const identity = (model: string): RunIdentity => ({
      snapshotId: this.options.snapshotId,
      packageId: req.packageId ?? null,
      jobId: this.options.jobId ?? null,
      targetType: req.targetType,
      targetId: req.targetId ?? null,
      sectionType: req.sectionType ?? null,
      provider: this.provider.id,
      model,
      modelTier: req.tier,
      keySource: 'server',
      promptVersion: req.promptVersion,
      inputHash,
    });

    if (req.skipIfCached && await hasCompleteRun(this.options.snapshotId, inputHash)) {
      await recordSkippedCached(identity(models[0]!));
      this.stats.cacheHits += 1;
      return { cached: true, content: null, value: null, model: null, usage: { inputTokens: 0, outputTokens: 0 }, degraded: false, runId: null };
    }

    const key = await this.resolveKey();
    const messages: ChatMessage[] = [
      ...(req.system ? [{ role: 'system', content: req.system } satisfies ChatMessage] : []),
      { role: 'user', content: req.user },
    ];

    let lastError: unknown = null;
    for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
      const model = models[modelIdx]!;
      const attemptResult = await this.attemptModel<T>(req, model, messages, key, { ...identity(model), keySource: key.keySource });
      if (attemptResult.ok) {
        const degraded = modelIdx > 0;
        if (degraded) this.stats.degradedCalls += 1;
        return { ...attemptResult.response, degraded };
      }
      lastError = attemptResult.error;
      if (!behaviors.includes('degrade')) break;
      // 'degrade': fall through to the next model in the tier list.
    }

    return this.applyTerminalBehavior(behaviors, req, lastError);
  }

  /** Embedding batch, budgeted and audited like any other call. */
  async embed(inputs: string[], opts: { targetType?: string; promptVersion?: string; skipIfCached?: boolean } = {}): Promise<{ vectors: number[][]; cached: boolean }> {
    assertAiAllowed(this.options.privacyMode);
    if (inputs.length === 0) return { vectors: [], cached: false };
    await this.options.budget.checkBeforeBatch(1);

    const model = this.tierConfig.models.embedding[0]!;
    const promptVersion = opts.promptVersion ?? 'embedding-v1';
    const inputHash = computeInputHash({ promptVersion, model, inputs });
    const identity: RunIdentity = {
      snapshotId: this.options.snapshotId,
      jobId: this.options.jobId ?? null,
      targetType: opts.targetType ?? 'embedding_batch',
      provider: this.provider.id,
      model,
      modelTier: 'embedding',
      keySource: 'server',
      promptVersion,
      inputHash,
    };

    if (opts.skipIfCached && await hasCompleteRun(this.options.snapshotId, inputHash)) {
      await recordSkippedCached(identity);
      this.stats.cacheHits += 1;
      return { vectors: [], cached: true };
    }

    const key = resolveEmbeddingsKey(model);
    const runId = await startRun(identity);
    const startedAt = Date.now();
    try {
      const result = await this.withRetries('embedding', () =>
        this.semaphore.run(() => this.provider.embed(inputs, model, { apiKey: key.apiKey })),
      );
      const costUsd = estimateCostUsd('embedding', result.usage.inputTokens, result.usage.outputTokens, model);
      await finishRun(runId, {
        status: 'complete',
        outputHash: computeOutputHash(JSON.stringify(result.vectors.map((v) => v.length))),
        tokenUsage: result.usage,
        estimatedCostUsd: costUsd,
        latencyMs: Date.now() - startedAt,
      });
      await this.recordSuccess(result.usage, costUsd);
      return { vectors: result.vectors, cached: false };
    } catch (err) {
      await finishRun(runId, { status: 'failed', latencyMs: Date.now() - startedAt, errorMessage: errMessage(err) });
      return this.applyTerminalBehavior(this.tierConfig.failureBehavior.embedding, { targetType: identity.targetType } as AiRequest, err);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private resolveKey(): Promise<ResolvedKey> {
    return (this.keyPromise ??= resolveApiKey(this.options.projectId, this.provider.id));
  }

  private async attemptModel<T>(
    req: AiRequest,
    model: string,
    messages: ChatMessage[],
    key: ResolvedKey,
    identity: RunIdentity,
  ): Promise<{ ok: true; response: Omit<AiResponse<T>, 'degraded'> } | { ok: false; error: unknown }> {
    const runId = await startRun(identity);
    const startedAt = Date.now();
    try {
      const base = { model, messages, maxOutputTokens: req.maxOutputTokens, temperature: req.temperature };
      let content: string;
      let value: T | null = null;
      let usage: TokenUsage;

      if (req.schema) {
        const result = await this.withRetries(req.tier, () =>
          this.semaphore.run(() =>
            this.provider.completeStructured<T>({ ...base, schemaName: req.schemaName ?? 'response', schema: req.schema! }, { apiKey: key.apiKey, signal: req.signal }),
          ), req.signal,
        );
        if (result.usedSchemaFallback) this.stats.schemaFallbacks += 1;
        value = result.value;
        content = JSON.stringify(result.value);
        usage = result.usage;
      } else {
        const result = await this.withRetries(req.tier, () =>
          this.semaphore.run(() => this.provider.complete(base, { apiKey: key.apiKey, signal: req.signal })),
          req.signal,
        );
        content = result.content;
        usage = result.usage;
      }

      const costUsd = estimateCostUsd(req.tier, usage.inputTokens, usage.outputTokens, model);
      await finishRun(runId, {
        status: 'complete',
        outputHash: computeOutputHash(content),
        tokenUsage: usage,
        estimatedCostUsd: costUsd,
        latencyMs: Date.now() - startedAt,
      });
      await this.recordSuccess(usage, costUsd);
      return { ok: true, response: { cached: false, content, value, model, usage, runId } };
    } catch (err) {
      await finishRun(runId, { status: 'failed', latencyMs: Date.now() - startedAt, errorMessage: errMessage(err) });
      return { ok: false, error: err };
    }
  }

  /**
   * Exponential backoff on retryable provider errors when the tier allows
   * 'retry', plus a separate, much longer budget for 429s.
   *
   * The two counters are deliberately independent. A 429 says nothing about
   * this call's health — it is the shared key's window being shut — so
   * spending the generic budget on it (and vice versa) meant a run could be
   * paused by a rate limit having made no failing call at all.
   */
  private async withRetries<T>(tier: ModelTier, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const canRetry = this.tierConfig.failureBehavior[tier]?.includes('retry') ?? true;
    const gate = rateLimitGate(this.provider.id);
    // An aborted request was cancelled deliberately — the losing copy of a
    // hedged straggler batch, whose twin has already answered. The provider
    // reports an abort as a RETRYABLE ProviderError, so without this bail the
    // loser would spend its whole retry budget (and a semaphore slot) redoing
    // work that is already persisted.
    if (signal?.aborted) throw abortError(signal);
    let attempt = 0;
    let rateLimitWaits = 0;
    for (;;) {
      // Outside the semaphore (fn() is what takes a slot): a call parked on a
      // shut window must not hold concurrency the whole time, and a call that
      // arrives mid-window waits here rather than spending a request on a door
      // it already knows is closed.
      await gate.wait(signal);
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ProviderError && err.status === 429) {
          const base = err.retryAfterMs
            ?? RATE_LIMIT_BACKOFF_MS[Math.min(rateLimitWaits, RATE_LIMIT_BACKOFF_MS.length - 1)]!;
          // Trip before deciding whether to give up: a call that is about to
          // pause the run still has to cool the window for the sibling jobs
          // sharing this key, or they walk straight into the same 429.
          gate.trip(this.jitter(base), `HTTP 429 (${tier})`);
          if (!canRetry || signal?.aborted || rateLimitWaits >= this.maxRateLimitWaits) throw err;
          rateLimitWaits += 1;
          continue; // the gate does all the 429 sleeping, at the top of the loop
        }
        // StructuredOutputError is retryable too: malformed JSON is largely
        // stochastic (observed on BOTH deepseek and scout for the same
        // capability payload) — a fresh sample usually lands where the
        // in-conversation repair retry did not.
        const retryable =
          (err instanceof ProviderError && err.retryable) || err instanceof StructuredOutputError;
        if (!canRetry || signal?.aborted || !retryable || attempt >= this.maxRetries) throw err;
        await this.sleep(BACKOFF_BASE_MS * 2 ** attempt);
        attempt += 1;
      }
    }
  }

  /**
   * Up to +25%. Without it the whole fan-out that 429'd together would come
   * back on the same tick and re-close the window on the first caller through.
   */
  private jitter(ms: number): number {
    return ms + Math.floor(Math.random() * 0.25 * ms);
  }

  private async recordSuccess(usage: TokenUsage, costUsd: number): Promise<void> {
    this.stats.calls += 1;
    this.stats.inputTokens += usage.inputTokens;
    this.stats.outputTokens += usage.outputTokens;
    this.stats.estimatedCostUsd += costUsd;
    await this.options.budget.recordUsage({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd });
  }

  /**
   * All models/retries exhausted: apply the rest of the tier's behavior
   * list. 'pause' anywhere wins (resumable beats terminal); otherwise fail.
   * StructuredOutputError and non-retryable request errors land here too.
   */
  private applyTerminalBehavior(behaviors: FailureBehavior[], req: Pick<AiRequest, 'targetType'>, cause: unknown): never {
    const message = `${req.targetType}: ${errMessage(cause)}`;
    if (behaviors.includes('pause')) {
      throw new AiPausedError(message, { rateLimited: cause instanceof ProviderError && cause.status === 429 });
    }
    throw new AiFailedError(`LLM work failed (${message})`, cause);
  }
}

/** Abort reasons are usually a DOMException; keep the audit row's message readable. */
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new ProviderError('request aborted before dispatch', null, false);
}

function errMessage(err: unknown): string {
  if (err instanceof StructuredOutputError) return `structured output invalid: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** Plain counting semaphore for provider-call concurrency. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}
