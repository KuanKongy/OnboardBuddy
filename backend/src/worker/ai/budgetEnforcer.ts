/**
 * Budget enforcement (doc/Pipeline.md "Budget enforcement"): wraps every
 * provider call. Counters live in analysis_snapshots.budget_usage and are
 * cumulative for the snapshot (they survive pause/resume). Limits are
 * checked BEFORE each batch dispatch; runtime is checked between batches;
 * the kill switch (job set to paused/failed from the API) is honored at
 * the same boundary.
 */

import { query } from '../../lib/db.js';
import { budgetForDepth, type DepthBudget, type SemanticDepth } from '../engine/budgets.js';

export type BudgetStopBehavior = 'fail' | 'pause' | 'degrade';

export interface BudgetUsage {
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  budget_events: Array<Record<string, unknown>>;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly behavior: BudgetStopBehavior,
    public readonly limit: string,
    public readonly report: { usage: BudgetUsage; budget: DepthBudget },
  ) {
    super(`budget exceeded (${limit}); stop behavior: ${behavior}`);
    this.name = 'BudgetExceededError';
  }
}

/** Job status was set to paused/failed from the API while we were working. */
export class KillSwitchError extends Error {
  constructor(public readonly jobStatus: 'paused' | 'failed') {
    super(`job was set to '${jobStatus}' — stopping at batch boundary`);
    this.name = 'KillSwitchError';
  }
}

/**
 * project_settings.budget_overrides uses snake_case keys (see migration
 * comment); budgets.ts uses camelCase. Accept both.
 */
const OVERRIDE_KEY_MAP: Record<string, keyof DepthBudget> = {
  max_files: 'maxFiles', maxFiles: 'maxFiles',
  max_symbols_to_llm: 'maxSymbolsToLlm', maxSymbolsToLlm: 'maxSymbolsToLlm',
  max_llm_calls: 'maxLlmCalls', maxLlmCalls: 'maxLlmCalls',
  max_input_tokens: 'maxInputTokens', maxInputTokens: 'maxInputTokens',
  max_runtime_ms: 'maxRuntimeMs', maxRuntimeMs: 'maxRuntimeMs',
};

export function normalizeBudgetOverrides(raw: unknown): Partial<Record<keyof DepthBudget, number>> {
  const overrides: Partial<Record<keyof DepthBudget, number>> = {};
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const mapped = OVERRIDE_KEY_MAP[key];
      if (mapped && typeof value === 'number' && Number.isFinite(value) && value > 0) {
        overrides[mapped] = value;
      }
    }
  }
  return overrides;
}

function emptyUsage(): BudgetUsage {
  return { llm_calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, budget_events: [] };
}

export interface BudgetEnforcerOptions {
  snapshotId: string;
  /** analysis_jobs.id watched for the kill switch; omit to disable the check. */
  jobId?: string;
  depth: SemanticDepth;
  budgetOverrides?: unknown;
  stopBehavior?: BudgetStopBehavior;
  /** Injectable clock for tests. */
  now?: () => number;
}

export class BudgetEnforcer {
  readonly budget: DepthBudget;
  readonly stopBehavior: BudgetStopBehavior;
  private readonly snapshotId: string;
  private readonly jobId?: string;
  private readonly now: () => number;
  private readonly startedAtMs: number;
  private currentUsage: BudgetUsage = emptyUsage();

  constructor(options: BudgetEnforcerOptions) {
    this.snapshotId = options.snapshotId;
    this.jobId = options.jobId;
    this.budget = budgetForDepth(options.depth, normalizeBudgetOverrides(options.budgetOverrides));
    this.stopBehavior = options.stopBehavior ?? 'pause';
    this.now = options.now ?? Date.now;
    // Runtime is measured per worker run: a resume after pause gets a fresh
    // clock (the user raised the budget or retried deliberately), while
    // call/token counters stay cumulative for the snapshot.
    this.startedAtMs = this.now();
  }

  /** Loads persisted counters so a resumed run keeps counting from where it stopped. */
  async load(): Promise<this> {
    const result = await query(`SELECT budget_usage FROM analysis_snapshots WHERE id = $1`, [this.snapshotId]);
    const raw = (result.rows[0] as { budget_usage?: Partial<BudgetUsage> } | undefined)?.budget_usage;
    if (raw && typeof raw === 'object') {
      this.currentUsage = { ...emptyUsage(), ...raw, budget_events: Array.isArray(raw.budget_events) ? raw.budget_events : [] };
    }
    return this;
  }

  get usage(): BudgetUsage {
    return this.currentUsage;
  }

  get elapsedMs(): number {
    return this.now() - this.startedAtMs;
  }

  /**
   * Batch-boundary gate: throws KillSwitchError if the job was paused/failed
   * externally, or BudgetExceededError (with the configured stop behavior)
   * when dispatching `estimatedCalls` more calls would break a limit.
   */
  async checkBeforeBatch(estimatedCalls = 1): Promise<void> {
    if (this.jobId) {
      const result = await query(`SELECT status FROM analysis_jobs WHERE id = $1`, [this.jobId]);
      const status = (result.rows[0] as { status?: string } | undefined)?.status;
      if (status === 'paused' || status === 'failed') throw new KillSwitchError(status);
    }

    const tripped = this.trippedLimit(estimatedCalls);
    if (tripped) {
      await this.recordEvent({ kind: 'budget_tripped', limit: tripped, behavior: this.stopBehavior, at: new Date().toISOString() });
      throw new BudgetExceededError(this.stopBehavior, tripped, { usage: this.currentUsage, budget: this.budget });
    }
  }

  private trippedLimit(estimatedCalls: number): string | null {
    if (this.currentUsage.llm_calls + estimatedCalls > this.budget.maxLlmCalls) return 'max_llm_calls';
    if (this.currentUsage.input_tokens >= this.budget.maxInputTokens) return 'max_input_tokens';
    if (this.elapsedMs >= this.budget.maxRuntimeMs) return 'max_runtime_ms';
    return null;
  }

  async recordUsage(delta: { calls?: number; inputTokens: number; outputTokens: number; costUsd: number }): Promise<void> {
    this.currentUsage.llm_calls += delta.calls ?? 1;
    this.currentUsage.input_tokens += delta.inputTokens;
    this.currentUsage.output_tokens += delta.outputTokens;
    this.currentUsage.estimated_cost_usd = round6(this.currentUsage.estimated_cost_usd + delta.costUsd);
    await this.persist();
  }

  async recordEvent(event: Record<string, unknown>): Promise<void> {
    this.currentUsage.budget_events.push(event);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await query(`UPDATE analysis_snapshots SET budget_usage = $2 WHERE id = $1`, [
      this.snapshotId,
      JSON.stringify(this.currentUsage),
    ]);
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
