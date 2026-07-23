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
 * Both tiers default to gpt-4o-mini: a full analysis costs cents. Point the
 * strong tier at a premium model only when quality is worth ~20x the price.
 */
export function defaultTierModels(): Record<ModelTier, string[]> {
  return {
    // Legacy OPENROUTER_MODEL keeps working as the cheap-tier default.
    cheap: [process.env.OPENROUTER_MODEL_CHEAP ?? process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini'],
    strong: [process.env.OPENROUTER_MODEL_STRONG ?? 'openai/gpt-4o-mini'],
    embedding: [process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small'],
  };
}

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

// Coarse per-tier prices used for ai_generation_runs.estimated_cost_usd.
// Deliberately not a per-model price table: these estimates feed the cost
// UI and budget trend lines, not billing. USD per million tokens.
// Cheap matches the gpt-4o-mini default; strong matches the gpt-4o this
// deployment points OPENROUTER_MODEL_STRONG at (backend/.env) — keep the
// row in sync with that env var per the note above.
const TIER_PRICES_PER_MTOK: Record<ModelTier, { input: number; output: number }> = {
  cheap: { input: 0.15, output: 0.6 },
  strong: { input: 2.5, output: 10 },
  embedding: { input: 0.02, output: 0 },
};

export function estimateCostUsd(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const price = TIER_PRICES_PER_MTOK[tier];
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
