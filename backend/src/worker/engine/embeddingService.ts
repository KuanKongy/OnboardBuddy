/**
 * Embedding service, retargeted through the AI provider abstraction
 * (doc/Pipeline.md "Provider abstraction"). The multi-view embedding
 * pass (pipeline Phase 6) goes through AiClient.embed for budgeting and
 * ai_generation_runs auditing; these helpers remain for direct use where
 * no snapshot context exists (e.g. embedding an ad-hoc query string).
 */

import { OpenRouterProvider } from '../ai/openRouterProvider.js';
import { resolveEmbeddingsKey } from '../ai/keyResolver.js';
import { defaultTierModels } from '../ai/modelTiers.js';

const provider = new OpenRouterProvider();

export async function embedTexts(contents: string[]): Promise<number[][]> {
  if (contents.length === 0) return [];
  const model = defaultTierModels().embedding[0]!;
  const { apiKey } = resolveEmbeddingsKey();
  const { vectors } = await provider.embed(contents, model, { apiKey });
  return vectors;
}

export async function embedText(content: string): Promise<number[]> {
  const [embedding] = await embedTexts([content]);
  return embedding!;
}
