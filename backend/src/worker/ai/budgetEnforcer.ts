/**
 * Budget enforcement (doc/Pipeline.md "Budget enforcement"): wraps every
 * provider call. Counters live in analysis_snapshots.budget_usage and are
 * cumulative for the snapshot — that row is the LIFETIME cost record and is
 * still written exactly as before. Limits are checked BEFORE each batch
 * dispatch; runtime is checked between batches; the kill switch (job set to
 * paused/failed from the API) is honored at the same boundary.
 *
 * ── Per-run enforcement (bug: "the count should be per analysis run") ──────
 * analysis_snapshots rows are REUSED across reruns of the same (scope,
 * commit) via ON CONFLICT, so the cumulative counters grow forever. Enforcing
 * a cap against them meant a cheap rerun on an expensive snapshot paused
 * before doing any work (observed live: Skribbl paused on max_llm_calls with
 * zero calls of its own). Every limit is now enforced on the DELTA this run
 * added — `current - baseline` — where the baseline is the cumulative total
 * as it stood when this run started. Writes are unchanged; only the
 * comparison moved.
 *
 * The baseline is persisted on the JOB row (analysis_jobs.checkpoint ->
 * 'budgetBaseline'), claimed once with a conditional UPDATE:
 *   - per-job storage means concurrent jobs on one shared snapshot
 *     (WORKER_CONCURRENCY=4) each carry their own baseline with zero
 *     contention — a snapshot-level slot would need locking;
 *   - it is committed before the first provider call, so a crash/retry/resume
 *     of the SAME job row re-reads the ORIGINAL baseline instead of
 *     re-baselining mid-run and silently granting a second full allowance;
 *   - the job row already carries a `checkpoint` jsonb that the resume path
 *     reads, and /projects/:id/runs already selects from analysis_jobs, so
 *     the API gets `usedThisRun` with no extra join.
 * Jobless callers (/ask Q&A) baseline in memory for the duration of the
 * request — there is no job row to resume and no second attempt.
 *
 * Persistence is amortized (latency overhaul Track C): limits are ALWAYS
 * enforced from the in-memory counters, but the budget_usage row is written
 * only every FLUSH_EVERY_CALLS calls / FLUSH_INTERVAL_MS, at phase
 * boundaries, and on budget events. A crash therefore loses at most a few
 * calls' worth of cumulative counters — ai_generation_runs remains the
 * exact per-call ground truth. The kill-switch SELECT is cached for
 * KILL_SWITCH_TTL_MS: a pause takes effect within ~2s plus the in-flight
 * batch, which is the documented "batch boundary" contract.
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

/** Cumulative totals as they stood when this run started (the zero point). */
export interface BudgetBaseline {
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

/** Counters minus the baseline: what THIS run spent, which is what is capped. */
export type BudgetRunUsage = BudgetBaseline;

export interface BudgetTripReport {
  /** Cumulative snapshot totals (lifetime across every run on this snapshot). */
  usage: BudgetUsage;
  budget: DepthBudget;
  /** Totals when this run started; usage - baseline is what tripped. */
  baseline: BudgetBaseline;
  /** The metered delta this run added. */
  usedThisRun: BudgetRunUsage;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly behavior: BudgetStopBehavior,
    public readonly limit: string,
    public readonly report: BudgetTripReport,
    /** "used 300 of 300 this run (lifetime across runs: 812)" — never empty. */
    public readonly detail = '',
  ) {
    super(
      detail
        ? `budget exceeded (${limit}), ${detail}; stop behavior: ${behavior}`
        : `budget exceeded (${limit}); stop behavior: ${behavior}`,
    );
    this.name = 'BudgetExceededError';
  }
}

/** Job status was set to paused/failed from the API while we were working. */
export class KillSwitchError extends Error {
  constructor(public readonly jobStatus: 'paused' | 'failed') {
    super(`job was set to '${jobStatus}', stopping at batch boundary`);
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

/** What the API reports for one run: the cap it ran under, plus both counts. */
export interface RunBudgetSummary {
  /** max_llm_calls this run was measured against. */
  capLlmCalls: number;
  /** Calls this run itself made. null = no baseline recorded (legacy run). */
  usedThisRun: number | null;
  /** capLlmCalls - usedThisRun, floored at 0. null when usedThisRun is. */
  remaining: number | null;
  /** Cumulative calls on the snapshot across every run that touched it. */
  lifetimeLlmCalls: number;
  /** Cumulative estimated spend on the snapshot across every run. */
  lifetimeCostUsd: number;
  /** Set only when usedThisRun is null — says why, never guesses a number. */
  note?: string;
}

const VALID_DEPTHS: readonly SemanticDepth[] = ['cheap', 'standard', 'full'];

/**
 * Builds the per-run budget block the API exposes. `baseline` is the raw
 * analysis_jobs.checkpoint->'budgetBaseline' blob; jobs that ran before
 * per-run metering have none, and those report `usedThisRun: null` rather
 * than a number the system never actually measured.
 */
export function summarizeRunBudget(input: {
  depth: string | null | undefined;
  budgetOverrides: unknown;
  baseline: unknown;
  /** Completed LLM calls attributed to this job (ai_generation_runs.job_id). */
  jobLlmCalls: number;
  /** analysis_snapshots.budget_usage for the snapshot this run wrote to. */
  snapshotUsage: unknown;
}): RunBudgetSummary {
  const depth = (VALID_DEPTHS as readonly string[]).includes(input.depth ?? '')
    ? (input.depth as SemanticDepth)
    : 'standard';
  const capLlmCalls = budgetForDepth(depth, normalizeBudgetOverrides(input.budgetOverrides)).maxLlmCalls;
  // budget_usage carries the same numeric field names as a baseline blob.
  const lifetime = parseBaseline(input.snapshotUsage) ?? zeroBaseline();
  // The baseline is a PRESENCE GATE, not the arithmetic: `lifetime -
  // baseline` would pick up sibling jobs sharing the snapshot, whereas
  // ai_generation_runs.job_id counts exactly the calls this run made —
  // the same quantity the enforcer capped.
  const baseline = parseBaseline(input.baseline);
  if (!baseline) {
    return {
      capLlmCalls,
      usedThisRun: null,
      remaining: null,
      lifetimeLlmCalls: lifetime.llm_calls,
      lifetimeCostUsd: round6(lifetime.estimated_cost_usd),
      note: 'recorded before per-run metering',
    };
  }
  const usedThisRun = Math.max(0, Math.round(input.jobLlmCalls));
  return {
    capLlmCalls,
    usedThisRun,
    remaining: Math.max(0, capLlmCalls - usedThisRun),
    lifetimeLlmCalls: lifetime.llm_calls,
    lifetimeCostUsd: round6(lifetime.estimated_cost_usd),
  };
}

function zeroBaseline(): BudgetBaseline {
  return { llm_calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
}

function baselineFrom(usage: BudgetUsage): BudgetBaseline {
  return {
    llm_calls: usage.llm_calls,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    estimated_cost_usd: usage.estimated_cost_usd,
  };
}

/** Coerces a persisted baseline blob; a missing/garbage field reads as 0. */
export function parseBaseline(raw: unknown): BudgetBaseline | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const num = (k: string): number => {
    const v = rec[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  return {
    llm_calls: num('llm_calls'),
    input_tokens: num('input_tokens'),
    output_tokens: num('output_tokens'),
    estimated_cost_usd: num('estimated_cost_usd'),
  };
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

const FLUSH_EVERY_CALLS = 10;
const FLUSH_INTERVAL_MS = 5_000;
const KILL_SWITCH_TTL_MS = 2_000;

export class BudgetEnforcer {
  readonly budget: DepthBudget;
  readonly stopBehavior: BudgetStopBehavior;
  private readonly snapshotId: string;
  private readonly jobId?: string;
  private readonly now: () => number;
  private readonly startedAtMs: number;
  private currentUsage: BudgetUsage = emptyUsage();
  /**
   * Zero point for enforcement. Starts at all-zeros so an enforcer used
   * without load() (tests, deterministic paths) behaves exactly as before:
   * usage - 0 === usage.
   */
  private runBaseline: BudgetBaseline = zeroBaseline();
  /** True once a baseline was read back from (or written to) the job row. */
  private baselinePersisted = false;
  private unflushedCalls = 0;
  private lastFlushMs = 0;
  private lastKillCheckMs = 0;

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
    // First recordUsage shouldn't force an immediate write; first
    // checkBeforeBatch SHOULD check the kill switch (lastKillCheckMs = 0).
    this.lastFlushMs = this.startedAtMs;
  }

  /**
   * Loads the cumulative counters (so the lifetime record keeps growing) and
   * establishes this run's baseline (so the CAP is measured from here).
   */
  async load(): Promise<this> {
    const result = await query(`SELECT budget_usage FROM analysis_snapshots WHERE id = $1`, [this.snapshotId]);
    const raw = (result.rows[0] as { budget_usage?: Partial<BudgetUsage> } | undefined)?.budget_usage;
    if (raw && typeof raw === 'object') {
      this.currentUsage = { ...emptyUsage(), ...raw, budget_events: Array.isArray(raw.budget_events) ? raw.budget_events : [] };
    }
    this.runBaseline = await this.claimBaseline(baselineFrom(this.currentUsage));
    return this;
  }

  /**
   * Writes `fresh` into analysis_jobs.checkpoint->'budgetBaseline' unless one
   * is already there, and returns whichever value is now stored. The
   * conditional UPDATE is the crash-safety mechanism: a retried or resumed
   * job (same row id — POST /jobs/:id/resume re-queues the SAME row) loses
   * the race with itself and inherits its original zero point, so its
   * allowance can never be doubled by restarting it.
   */
  private async claimBaseline(fresh: BudgetBaseline): Promise<BudgetBaseline> {
    if (!this.jobId) return fresh; // /ask and other jobless callers: in-memory only
    const payload = JSON.stringify(fresh);
    try {
      const claimed = await query(
        `UPDATE analysis_jobs
            SET checkpoint = jsonb_set(COALESCE(checkpoint, '{}'::jsonb), '{budgetBaseline}', $2::jsonb, true)
          WHERE id = $1
            AND NOT (COALESCE(checkpoint, '{}'::jsonb) ? 'budgetBaseline')
        RETURNING checkpoint -> 'budgetBaseline' AS baseline`,
        [this.jobId, payload],
      );
      const won = parseBaseline((claimed.rows[0] as { baseline?: unknown } | undefined)?.baseline);
      if (won) {
        this.baselinePersisted = true;
        return won;
      }
      // Already claimed by an earlier attempt of this same job — reuse it.
      const existing = await query(
        `SELECT checkpoint -> 'budgetBaseline' AS baseline FROM analysis_jobs WHERE id = $1`,
        [this.jobId],
      );
      const prior = parseBaseline((existing.rows[0] as { baseline?: unknown } | undefined)?.baseline);
      if (prior) {
        this.baselinePersisted = true;
        return prior;
      }
    } catch (err) {
      // Never let bookkeeping kill a run: an unwritable baseline degrades to
      // in-memory (correct for this attempt, re-baselines on retry) rather
      // than falling back to the cumulative enforcement this fix removes.
      console.warn('[budget] could not persist run baseline:', err instanceof Error ? err.message : err);
    }
    return fresh;
  }

  /** Cumulative snapshot totals — the lifetime cost-transparency record. */
  get usage(): BudgetUsage {
    return this.currentUsage;
  }

  /** Totals when this run started. Enforcement measures from here. */
  get baseline(): BudgetBaseline {
    return this.runBaseline;
  }

  /**
   * False when the baseline lives only in memory (jobless caller, or the
   * write failed) — a retry would then re-baseline. Callers that report
   * budget numbers use this to avoid claiming more precision than exists.
   */
  get baselineIsDurable(): boolean {
    return this.baselinePersisted;
  }

  /** What THIS run has spent so far — the quantity every cap applies to. */
  get usedThisRun(): BudgetRunUsage {
    return {
      llm_calls: Math.max(0, this.currentUsage.llm_calls - this.runBaseline.llm_calls),
      input_tokens: Math.max(0, this.currentUsage.input_tokens - this.runBaseline.input_tokens),
      output_tokens: Math.max(0, this.currentUsage.output_tokens - this.runBaseline.output_tokens),
      estimated_cost_usd: round6(Math.max(0, this.currentUsage.estimated_cost_usd - this.runBaseline.estimated_cost_usd)),
    };
  }

  /** Calls left before this run trips max_llm_calls (never negative). */
  get remainingLlmCalls(): number {
    return Math.max(0, this.budget.maxLlmCalls - this.usedThisRun.llm_calls);
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
    // The kill-switch SELECT used to run once per LLM call — a full extra
    // round-trip per call. A short TTL keeps pause latency ~2s while
    // removing it from the hot path.
    if (this.jobId && this.now() - this.lastKillCheckMs >= KILL_SWITCH_TTL_MS) {
      const result = await query(`SELECT status FROM analysis_jobs WHERE id = $1`, [this.jobId]);
      this.lastKillCheckMs = this.now();
      const status = (result.rows[0] as { status?: string } | undefined)?.status;
      if (status === 'paused' || status === 'failed') throw new KillSwitchError(status);
    }

    const tripped = this.trippedLimit(estimatedCalls);
    if (tripped) {
      const used = this.usedThisRun;
      const detail = this.describeTrip(tripped);
      await this.recordEvent({
        kind: 'budget_tripped',
        limit: tripped,
        behavior: this.stopBehavior,
        // Numbers are part of the durable record, not just the message: the
        // paused banner and run history read them back.
        scope: 'per_run',
        jobId: this.jobId ?? null,
        usedThisRun: used,
        baseline: this.runBaseline,
        cap: {
          maxLlmCalls: this.budget.maxLlmCalls,
          maxInputTokens: this.budget.maxInputTokens,
          maxRuntimeMs: this.budget.maxRuntimeMs,
        },
        lifetime: baselineFrom(this.currentUsage),
        detail,
        at: new Date().toISOString(),
      });
      throw new BudgetExceededError(
        this.stopBehavior,
        tripped,
        { usage: this.currentUsage, budget: this.budget, baseline: this.runBaseline, usedThisRun: used },
        detail,
      );
    }
  }

  /**
   * Every limit is measured against THIS run's delta. The cumulative totals
   * on the snapshot are a record, not a gate — before this, a rerun of an
   * already-analyzed commit tripped max_llm_calls before its first call.
   */
  private trippedLimit(estimatedCalls: number): string | null {
    const used = this.usedThisRun;
    if (used.llm_calls + estimatedCalls > this.budget.maxLlmCalls) return 'max_llm_calls';
    if (used.input_tokens >= this.budget.maxInputTokens) return 'max_input_tokens';
    if (this.elapsedMs >= this.budget.maxRuntimeMs) return 'max_runtime_ms';
    return null;
  }

  /** "used 300 of 300 this run (lifetime across runs: 812)". */
  private describeTrip(limit: string): string {
    const used = this.usedThisRun;
    if (limit === 'max_input_tokens') {
      return `used ${fmt(used.input_tokens)} of ${fmt(this.budget.maxInputTokens)} input tokens this run `
        + `(lifetime across runs: ${fmt(this.currentUsage.input_tokens)})`;
    }
    if (limit === 'max_runtime_ms') {
      // Runtime is already per-run (fresh clock each worker run) — there is
      // no lifetime figure to quote.
      return `ran ${fmtMinutes(this.elapsedMs)} of ${fmtMinutes(this.budget.maxRuntimeMs)} allowed this run`;
    }
    return `used ${fmt(used.llm_calls)} of ${fmt(this.budget.maxLlmCalls)} calls this run `
      + `(lifetime across runs: ${fmt(this.currentUsage.llm_calls)})`;
  }

  async recordUsage(delta: { calls?: number; inputTokens: number; outputTokens: number; costUsd: number }): Promise<void> {
    this.currentUsage.llm_calls += delta.calls ?? 1;
    this.currentUsage.input_tokens += delta.inputTokens;
    this.currentUsage.output_tokens += delta.outputTokens;
    this.currentUsage.estimated_cost_usd = round6(this.currentUsage.estimated_cost_usd + delta.costUsd);
    this.unflushedCalls += delta.calls ?? 1;
    if (this.unflushedCalls >= FLUSH_EVERY_CALLS || this.now() - this.lastFlushMs >= FLUSH_INTERVAL_MS) {
      await this.flush();
    }
  }

  /** Budget events are never amortized — a trip must be durably visible. */
  async recordEvent(event: Record<string, unknown>): Promise<void> {
    this.currentUsage.budget_events.push(event);
    await this.flush();
  }

  /**
   * Persists the in-memory counters. Callers flush at phase boundaries and
   * in terminal/finally paths so the stored counters never trail by more
   * than one batch window.
   */
  async flush(): Promise<void> {
    this.unflushedCalls = 0;
    this.lastFlushMs = this.now();
    await query(`UPDATE analysis_snapshots SET budget_usage = $2 WHERE id = $1`, [
      this.snapshotId,
      JSON.stringify(this.currentUsage),
    ]);
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function fmtMinutes(ms: number): string {
  return `${Math.round(ms / 60_000)}m`;
}
