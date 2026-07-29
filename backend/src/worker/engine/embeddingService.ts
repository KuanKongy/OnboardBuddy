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

/**
 * `model` is explicit because a query vector is only comparable to vectors
 * produced by the SAME model: retrieval detects which model a snapshot was
 * embedded with (retrievalService.resolveSnapshotEmbeddingModel) and passes
 * it here, so an M4-era snapshot keeps being queried with the OpenAI model
 * that wrote it. Omitting it means "the configured default".
 */
export async function embedTexts(contents: string[], model?: string): Promise<number[][]> {
  if (contents.length === 0) return [];
  const embeddingModel = model ?? defaultTierModels().embedding[0]!;
  const { apiKey } = resolveEmbeddingsKey(embeddingModel);
  const { vectors } = await provider.embed(contents, embeddingModel, { apiKey });
  return vectors;
}

export async function embedText(content: string, model?: string): Promise<number[]> {
  const [embedding] = await embedTexts([content], model);
  return embedding!;
}
