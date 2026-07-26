/**
 * Shared AI-layer test harness: a fake db router for the queries the ai
 * modules issue, a fake provider that records every request, and AiClient /
 * BudgetEnforcer factories.
 *
 * Extracted from `src/worker/ai/__tests__/phase4.test.ts` so the privacy-mode
 * suites assert against the SAME stub the AiClient suite is written against —
 * a second, differently-shaped provider fake would let a call site drift out
 * from under one of them without either failing.
 */

import { __setQueryForTests } from '../../src/lib/db.js';
import { ProviderError } from '../../src/worker/ai/provider.js';
import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
  ProviderCallOptions,
  StructuredRequest,
  StructuredResult,
} from '../../src/worker/ai/provider.js';
import { resolveTierConfig } from '../../src/worker/ai/modelTiers.js';
import { BudgetEnforcer } from '../../src/worker/ai/budgetEnforcer.js';
import { AiClient } from '../../src/worker/ai/aiClient.js';
import type { PrivacyMode } from '../../src/worker/ai/privacy.js';

export interface QueryLogEntry { text: string; params?: unknown[] }

/** Routes the db-layer queries the ai modules issue; records everything. */
export function installFakeDb(overrides: {
  llmKeyRows?: unknown[];
  jobStatus?: string;
  hasCachedRun?: boolean;
  budgetUsageRow?: Record<string, unknown> | null;
  /**
   * analysis_jobs.checkpoint->'budgetBaseline' as already stored. Set it to
   * simulate a retry/resume of a job that already claimed its per-run
   * baseline; leave it undefined and the claim UPDATE wins (fresh run).
   */
  jobBaseline?: Record<string, unknown> | null;
  /** Caller-owned routes, consulted first; return null to fall through. */
  extra?: (text: string, params?: unknown[]) => unknown[] | null;
} = {}): QueryLogEntry[] {
  const log: QueryLogEntry[] = [];
  let runCounter = 0;
  __setQueryForTests(async (text, params) => {
    log.push({ text, params });
    const extra = overrides.extra?.(text, params);
    if (extra !== null && extra !== undefined) return { rows: extra } as never;
    if (text.includes('FROM project_llm_keys')) return { rows: overrides.llmKeyRows ?? [] } as never;
    // Per-run baseline claim/read. Must precede the kill-switch route: the
    // read also selects FROM analysis_jobs.
    if (text.includes("'{budgetBaseline}'")) {
      // Conditional UPDATE: no rows when a baseline already exists.
      if (overrides.jobBaseline) return { rows: [] } as never;
      return { rows: [{ baseline: JSON.parse(String(params?.[1] ?? '{}')) }] } as never;
    }
    if (text.includes("checkpoint -> 'budgetBaseline'")) {
      return { rows: [{ baseline: overrides.jobBaseline ?? null }] } as never;
    }
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

/** One recorded provider request — the prompt is kept so privacy tests can read it. */
export interface RecordedCall {
  model: string;
  system: string | null;
  user: string;
}

export class FakeProvider implements AiProvider {
  readonly id = 'openrouter';
  /** Every chat request that reached the provider, in order. */
  completeCalls: RecordedCall[] = [];
  /** Every embedding batch that reached the provider. */
  embedCalls: string[][] = [];
  /** Errors to throw before succeeding, consumed in order. */
  errors: unknown[] = [];
  /** Models that always fail, regardless of the error queue. */
  brokenModels = new Set<string>();
  structuredValue: unknown = { ok: true };

  /** Everything (prompts + embedding inputs) that left the process. */
  get sentText(): string {
    return [...this.completeCalls.map((c) => `${c.system ?? ''}\n${c.user}`), ...this.embedCalls.flat()].join('\n');
  }

  async complete(req: CompletionRequest, _opts: ProviderCallOptions): Promise<CompletionResult> {
    this.record(req);
    this.maybeThrow(req.model);
    return { content: `reply from ${req.model}`, usage: { inputTokens: 100, outputTokens: 20 } };
  }

  async completeStructured<T>(req: StructuredRequest, _opts: ProviderCallOptions): Promise<StructuredResult<T>> {
    this.record(req);
    this.maybeThrow(req.model);
    return { value: this.structuredValue as T, usage: { inputTokens: 150, outputTokens: 30 }, usedSchemaFallback: false };
  }

  async embed(inputs: string[], _model: string, _opts: ProviderCallOptions): Promise<{ vectors: number[][]; usage: { inputTokens: number; outputTokens: number } }> {
    this.embedCalls.push(inputs);
    return { vectors: inputs.map(() => [0.1, 0.2]), usage: { inputTokens: 10, outputTokens: 0 } };
  }

  private record(req: CompletionRequest | StructuredRequest): void {
    this.completeCalls.push({
      model: req.model,
      system: req.messages.find((m) => m.role === 'system')?.content ?? null,
      user: req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n'),
    });
  }

  private maybeThrow(model: string): void {
    if (this.brokenModels.has(model)) throw new ProviderError('model permanently down', 500, true);
    const err = this.errors.shift();
    if (err) throw err;
  }
}

export function makeBudget(opts: {
  depth?: 'cheap' | 'standard' | 'full';
  stopBehavior?: 'fail' | 'pause' | 'degrade';
  overrides?: unknown;
  now?: () => number;
  /** Set to exercise the per-run baseline claim on the job row. */
  jobId?: string;
} = {}): BudgetEnforcer {
  return new BudgetEnforcer({
    snapshotId: 'snap-1',
    jobId: opts.jobId,
    depth: opts.depth ?? 'standard',
    stopBehavior: opts.stopBehavior,
    budgetOverrides: opts.overrides,
    now: opts.now,
  });
}

export function makeClient(provider: FakeProvider, opts: {
  privacyMode?: PrivacyMode;
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
