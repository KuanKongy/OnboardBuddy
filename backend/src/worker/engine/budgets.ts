/**
 * Analysis budget constants (see doc/Pipeline.md "Cost budgets and kill
 * switches"). Everything here is a tunable default: projects override via
 * project_settings.budget_overrides.
 */

export type SemanticDepth = 'cheap' | 'standard' | 'full';
export type CostTier = 'low' | 'medium' | 'high';

export interface DepthBudget {
  maxFiles: number;
  maxSymbolsToLlm: number;
  maxLlmCalls: number;
  maxInputTokens: number;
  maxRuntimeMs: number;
}

export const DEPTH_BUDGETS: Record<SemanticDepth, DepthBudget> = {
  cheap: {
    maxFiles: 1_000,
    maxSymbolsToLlm: 600,
    maxLlmCalls: 100,
    maxInputTokens: 2_000_000,
    maxRuntimeMs: 25 * 60 * 1000,
  },
  standard: {
    maxFiles: 2_500,
    maxSymbolsToLlm: 2_000,
    maxLlmCalls: 300,
    // Batched 1M-context calls carry far more input per call (~50-90k);
    // a fresh standard run spends ~3-3.5M — 6M leaves retry headroom.
    maxInputTokens: 6_000_000,
    maxRuntimeMs: 60 * 60 * 1000,
  },
  full: {
    maxFiles: 5_000,
    maxSymbolsToLlm: 10_000,
    maxLlmCalls: 1_500,
    maxInputTokens: 20_000_000,
    maxRuntimeMs: 4 * 60 * 60 * 1000,
  },
};

export function budgetForDepth(
  depth: SemanticDepth,
  overrides?: Partial<Record<keyof DepthBudget, number>> | null,
): DepthBudget {
  return { ...DEPTH_BUDGETS[depth], ...(overrides ?? {}) };
}

/** Fraction of extracted symbols the depth gate selects for the LLM pass. */
export const DEPTH_SELECTION_RATIO: Record<SemanticDepth, number> = {
  cheap: 0.25,
  standard: 0.5,
  full: 1.0,
};

// Batching hard limits for the symbol semantic pass, sized for the
// deepseek-v4-flash tier (1M input context / 65,536 output cap). Batches
// are OUTPUT-bound, not input-bound: records are ~300-500 output tokens
// each and MEASURED decode through OpenRouter is only ~30-120 tok/s, so a
// 32-symbol batch (~15k output) ran 4-9 minutes and long outputs started
// emitting malformed JSON. Small batches × high concurrency keep aggregate
// throughput while bounding the slow-upstream tail and retry blast radius.
export const MAX_SYMBOLS_PER_CALL = 10;
export const MAX_SNIPPET_TOKENS = 3_000;
export const MAX_REQUEST_INPUT_TOKENS = 90_000;
/** Rough chars-per-token used for all estimates. */
export const CHARS_PER_TOKEN = 4;
/** Snippet cap in characters (~MAX_SNIPPET_TOKENS tokens). */
export const MAX_SNIPPET_CHARS = MAX_SNIPPET_TOKENS * CHARS_PER_TOKEN;
/** Explicit max_tokens per batched symbol call: overhead + per-record room. */
export const SYMBOL_BATCH_OUTPUT_TOKENS_PER_SYMBOL = 700;

// Preflight estimate constants. Averages sized for the batched call profile
// (10-symbol record batches, 6-file synthesis batches, 40-receipt sections).
export const AVG_TOKENS_PER_CHEAP_CALL = 12_000;
export const AVG_TOKENS_PER_STRONG_CALL = 14_000;
export const SECTION_COUNT_ESTIMATE = 11;
export const TUTORIAL_COUNT_ESTIMATE = 4;

// Coarse per-million-token input prices used ONLY for the preflight cost
// tier; real cost accounting happens per call in ai_generation_runs.
// Both chat tiers ride deepseek/deepseek-v4-flash ($0.09/M in, $0.18/M out).
export const EST_PRICE_PER_MTOK_CHEAP_USD = 0.11;
export const EST_PRICE_PER_MTOK_STRONG_USD = 0.18;

export const COST_TIER_THRESHOLDS_USD = { medium: 2, high: 15 };

export function costTierForUsd(estimatedUsd: number): CostTier {
  if (estimatedUsd > COST_TIER_THRESHOLDS_USD.high) return 'high';
  if (estimatedUsd > COST_TIER_THRESHOLDS_USD.medium) return 'medium';
  return 'low';
}

// Full-depth size caps (doc/Pipeline.md "Full-depth size caps").
export type ScopeSizeClass = 'small' | 'medium' | 'large' | 'very_large';

export function classifyScopeSize(fileCount: number, estSymbols: number): ScopeSizeClass {
  if (fileCount > 2_500 || estSymbols > 10_000) return 'very_large';
  if (fileCount > 1_000 || estSymbols > 5_000) return 'large';
  if (fileCount > 300 || estSymbols > 1_500) return 'medium';
  return 'small';
}

// Preflight confirmation thresholds — exceeding any requires explicit
// user confirmation before the run starts.
export const CONFIRMATION_THRESHOLDS = {
  maxFiles: 2_500,
  maxSymbolsToLlm: 2_000,
  maxLlmCalls: 300,
};
