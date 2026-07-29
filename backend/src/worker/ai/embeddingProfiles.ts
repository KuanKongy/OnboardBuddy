/**
 * Per-model embedding wire profiles (doc/Pipeline.md "Multi-view
 * Embeddings"). Two upstreams serve embeddings and they disagree about
 * nearly every part of the request:
 *
 *  - OpenAI-direct (`text-embedding-3-small`, what M4 wrote): takes a
 *    `dimensions` param, returns already-normalized 1536-dim vectors.
 *  - OpenRouter (`perplexity/pplx-embed-v1-4b` and anything else with a
 *    `vendor/model` id): `dimensions` is undocumented on its /embeddings
 *    route so we must not depend on it, provider routing prefs apply the
 *    same way they do for chat, and pplx returns 2560-dim UNNORMALIZED
 *    vectors (Matryoshka-trained, so the first 1536 dims are a valid
 *    embedding on their own).
 *
 * `embeddings.embedding` is `vector(1536)` and the schema is frozen for
 * M5, so the 2560→1536 truncation and the L2 normalization happen here,
 * client-side, on every path that produces a vector. Normalization is not
 * cosmetic: retrieval ranks with pgvector's `<=>` (cosine distance) and
 * both the stored vectors and the query vector must live on the unit
 * sphere for the seed scores (`1 - distance`) to mean what the rest of
 * the pipeline assumes.
 *
 * Model id shape is the routing key — a `/` means "OpenRouter model id" —
 * because that is the same rule the chat tiers already use, and it means
 * flipping EMBEDDINGS_MODEL is the only deployment change needed.
 */

import { ProviderError } from './provider.js';

/** The one dimension `embeddings.embedding` accepts (schema frozen for M5). */
export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProfile {
  /** Upstream identity; also the value written to `embeddings.provider`. */
  id: 'openrouter' | 'openai';
  baseUrl: string;
  /** Which server key serves this model — see resolveEmbeddingsKey(). */
  keyPreference: 'openrouter' | 'embeddings';
  /** Send `dimensions` (OpenAI honours it; OpenRouter does not document it). */
  sendDimensions: boolean;
  /** Send the ZDR/routing `provider` block (OpenRouter only). */
  sendProviderPrefs: boolean;
  /** Send `encoding_format: 'float'` — guards against int8/base64 responses. */
  sendEncodingFormat: boolean;
  /** Vectors longer than this are truncated; shorter ones are an error. */
  truncateTo: number;
}

export function profileForModel(model: string): EmbeddingProfile {
  if (model.includes('/')) {
    return {
      id: 'openrouter',
      baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      keyPreference: 'openrouter',
      sendDimensions: false,
      sendProviderPrefs: true,
      sendEncodingFormat: true,
      truncateTo: EMBEDDING_DIMENSIONS,
    };
  }
  return {
    id: 'openai',
    baseUrl: process.env.EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1',
    keyPreference: 'embeddings',
    sendDimensions: true,
    sendProviderPrefs: false,
    sendEncodingFormat: false,
    truncateTo: EMBEDDING_DIMENSIONS,
  };
}

/**
 * Truncate to the column width, then always L2-normalize.
 *
 * A vector SHORTER than the column width cannot be stored or compared, and
 * no retry will make the upstream return more dimensions — that is a
 * configuration error (wrong model id, a `dimensions` param the upstream
 * silently honoured), so it fails non-retryably instead of burning the
 * tier's retry budget.
 *
 * Normalizing an already-unit vector is a no-op up to float drift, so this
 * runs unconditionally rather than per-profile: one code path, and a future
 * model that returns unnormalized output cannot forget to opt in.
 */
export function postProcessVector(vector: number[], profile: EmbeddingProfile): number[] {
  if (vector.length < profile.truncateTo) {
    throw new ProviderError(
      `embedding API returned a ${vector.length}-dim vector; embeddings.embedding is vector(${profile.truncateTo})`,
      null,
      false,
    );
  }
  const truncated = vector.length > profile.truncateTo ? vector.slice(0, profile.truncateTo) : vector;
  let sumSquares = 0;
  for (const value of truncated) sumSquares += value * value;
  const norm = Math.sqrt(sumSquares);
  // A zero vector would divide into NaNs and poison the row for every future
  // `<=>` comparison against it — refuse it at the boundary instead.
  if (!(norm > 0)) {
    throw new ProviderError('embedding API returned a zero-magnitude vector', null, false);
  }
  return truncated.map((value) => value / norm);
}
