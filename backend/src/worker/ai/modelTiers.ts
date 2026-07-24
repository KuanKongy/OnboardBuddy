/**
 * Model tiers and per-tier failure behavior (doc/Pipeline.md "Model tiers
 * and failure behavior"). Each tier is a model list — the first entry is
 * the primary model, later entries are 'degrade' fallbacks. Defaults come
 * from env; projects override via project_settings.model_tier_overrides
 * and .model_failure_behavior.
 */

import type { ModelTier } from './provider.js';

export type FailureBehavior = 'retry' | 'degrade' | 'pause' | 'fail';

export interface TierConfig {
  models: Record<ModelTier, string[]>;
  failureBehavior: Record<ModelTier, FailureBehavior[]>;
}

/**
 * WHERE TO CHANGE MODELS (see doc/DEVOPS.md "LLM models & cost"):
 *  1. Env (server-wide defaults): OPENROUTER_MODEL_CHEAP, OPENROUTER_MODEL_STRONG,
 *     EMBEDDINGS_MODEL in backend/.env — any OpenRouter model id works.
 *  2. Per project: project_settings.model_tier_overrides, e.g.
 *     {"strong": ["anthropic/claude-sonnet-4.5"]} (PUT /projects/:id/settings).
 * Both tiers default to DeepSeek V4 Flash (1M context, 65,536 max output,
 * $0.09/M in, $0.18/M out): a full analysis costs cents, and the batch sizes
 * in engine/budgets.ts are tuned to its context/output caps. Point the
 * strong tier at a premium model only when quality is worth the price.
 */
export function defaultTierModels(): Record<ModelTier, string[]> {
  return {
    // Legacy OPENROUTER_MODEL keeps working as the cheap-tier default.
    cheap: [process.env.OPENROUTER_MODEL_CHEAP ?? process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash-lite'],
    strong: [process.env.OPENROUTER_MODEL_STRONG ?? 'google/gemini-2.5-flash-lite'],
    embedding: [process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small'],
  };
}

/**
 * Models a project may select in settings (model_tier_overrides UI). Kept
 * deliberately short — every entry must have been validated against the
 * structured-output pipeline (strict JSON, omission handling, price row).
 */
export const SELECTABLE_MODELS: Array<{ id: string; label: string }> = [
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (default — fast, 1M context)' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash (1M context)' },
];

export const DEFAULT_FAILURE_BEHAVIOR: Record<ModelTier, FailureBehavior[]> = {
  cheap: ['retry', 'degrade'],
  strong: ['retry', 'pause'], // quality-critical work must not silently degrade
  embedding: ['retry', 'pause'],
};

const TIERS: ModelTier[] = ['cheap', 'strong', 'embedding'];
const BEHAVIORS = new Set<string>(['retry', 'degrade', 'pause', 'fail']);

/**
 * Merges project overrides onto the defaults. Malformed overrides (wrong
 * types, unknown tiers/behaviors) are ignored per entry — a bad settings
 * row must never take the pipeline down.
 */
export function resolveTierConfig(overrides?: {
  modelTierOverrides?: unknown;
  modelFailureBehavior?: unknown;
}): TierConfig {
  const models = defaultTierModels();
  const failureBehavior: Record<ModelTier, FailureBehavior[]> = { ...DEFAULT_FAILURE_BEHAVIOR };

  const tierModels = overrides?.modelTierOverrides;
  if (tierModels && typeof tierModels === 'object') {
    for (const tier of TIERS) {
      const list = (tierModels as Record<string, unknown>)[tier];
      if (Array.isArray(list) && list.length > 0 && list.every((m) => typeof m === 'string' && m.length > 0)) {
        models[tier] = list as string[];
      }
    }
  }

  const behavior = overrides?.modelFailureBehavior;
  if (behavior && typeof behavior === 'object') {
    for (const tier of TIERS) {
      const list = (behavior as Record<string, unknown>)[tier];
      if (Array.isArray(list) && list.length > 0 && list.every((b) => typeof b === 'string' && BEHAVIORS.has(b))) {
        failureBehavior[tier] = list as FailureBehavior[];
      }
    }
  }

  return { models, failureBehavior };
}

// Prices used for ai_generation_runs.estimated_cost_usd — estimates for the
// cost UI and budget trend lines, not billing. USD per million tokens.
// Known models get exact rows; unknown models fall back to their tier row
// (keep tier rows in sync with the defaultTierModels() defaults).
const MODEL_PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'google/gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'deepseek/deepseek-v4-flash': { input: 0.09, output: 0.18 },
};

const TIER_PRICES_PER_MTOK: Record<ModelTier, { input: number; output: number }> = {
  cheap: { input: 0.1, output: 0.4 },
  strong: { input: 0.1, output: 0.4 },
  embedding: { input: 0.02, output: 0 },
};

export function estimateCostUsd(tier: ModelTier, inputTokens: number, outputTokens: number, model?: string): number {
  const price = (model !== undefined ? MODEL_PRICES_PER_MTOK[model] : undefined) ?? TIER_PRICES_PER_MTOK[tier];
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
