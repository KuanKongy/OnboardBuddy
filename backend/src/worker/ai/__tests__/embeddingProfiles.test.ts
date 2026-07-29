/**
 * Embedding wire profiles: which upstream a model id routes to, and the
 * truncate + normalize contract every stored vector goes through.
 *
 * This is the module that keeps M4's text-embedding-3-small rows and M5's
 * pplx rows in the same vector(1536) column, so the shape assertions here
 * are the guard against a silently mis-encoded (and therefore permanently
 * unsearchable) embeddings table.
 */

import { expect } from 'chai';
import { ProviderError } from '../provider.js';
import { profileForModel, postProcessVector, EMBEDDING_DIMENSIONS } from '../embeddingProfiles.js';
import { resolveEmbeddingsKey } from '../keyResolver.js';

const OPENROUTER_MODEL = 'perplexity/pplx-embed-v1-4b';
const OPENAI_MODEL = 'text-embedding-3-small';

/** Save/restore: base URLs and keys are real env knobs on a dev machine. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
}

describe('embedding profiles — model-shaped routing', () => {
  it('routes vendor/model ids to OpenRouter with prefs, float encoding and no dimensions', () => {
    withEnv({ OPENROUTER_BASE_URL: undefined }, () => {
      const profile = profileForModel(OPENROUTER_MODEL);
      expect(profile.id).to.equal('openrouter');
      expect(profile.baseUrl).to.equal('https://openrouter.ai/api/v1');
      expect(profile.keyPreference).to.equal('openrouter');
      expect(profile.sendDimensions).to.equal(false);
      expect(profile.sendProviderPrefs).to.equal(true);
      expect(profile.sendEncodingFormat).to.equal(true);
      expect(profile.truncateTo).to.equal(EMBEDDING_DIMENSIONS);
    });
  });

  it('keeps bare model ids on the OpenAI-direct profile M4 wrote with', () => {
    withEnv({ EMBEDDINGS_BASE_URL: undefined }, () => {
      const profile = profileForModel(OPENAI_MODEL);
      expect(profile.id).to.equal('openai');
      expect(profile.baseUrl).to.equal('https://api.openai.com/v1');
      expect(profile.keyPreference).to.equal('embeddings');
      expect(profile.sendDimensions).to.equal(true);
      expect(profile.sendProviderPrefs).to.equal(false);
      expect(profile.sendEncodingFormat).to.equal(false);
    });
  });
});

describe('embedding profiles — postProcessVector', () => {
  const profile = profileForModel(OPENROUTER_MODEL);

  it('truncates 2560 dims to the column width, keeping the leading dims, and normalizes', () => {
    // Unnormalized, like pplx's raw output (‖v‖ ≫ 1).
    const raw = Array.from({ length: 2560 }, (_, i) => Math.sin(i + 1) * 7);
    const out = postProcessVector(raw, profile);

    expect(out).to.have.length(EMBEDDING_DIMENSIONS);
    expect(norm(out)).to.be.closeTo(1, 1e-6);
    // Matryoshka truncation keeps the FIRST 1536 dims — a tail slice would
    // also be unit-norm and would silently be a different embedding.
    const expectedNorm = norm(raw.slice(0, EMBEDDING_DIMENSIONS));
    expect(out[0]).to.be.closeTo(raw[0]! / expectedNorm, 1e-12);
    expect(out[1535]).to.be.closeTo(raw[1535]! / expectedNorm, 1e-12);
  });

  it('leaves an already-unit vector where it is (OpenAI path is a no-op)', () => {
    const value = 1 / Math.sqrt(EMBEDDING_DIMENSIONS);
    const unit = Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
    const out = postProcessVector(unit, profileForModel(OPENAI_MODEL));
    expect(out).to.have.length(EMBEDDING_DIMENSIONS);
    expect(norm(out)).to.be.closeTo(1, 1e-6);
    expect(out[0]).to.be.closeTo(value, 1e-12);
  });

  it('refuses a short vector non-retryably — no retry adds dimensions', () => {
    try {
      postProcessVector([0.1, 0.2, 0.3], profile);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(ProviderError);
      expect((err as ProviderError).retryable).to.equal(false);
      expect((err as ProviderError).message).to.include('3-dim');
    }
  });

  it('refuses a zero vector rather than storing NaNs', () => {
    const zeros = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    expect(() => postProcessVector(zeros, profile)).to.throw(ProviderError, /zero-magnitude/);
  });
});

describe('embedding profiles — key resolution', () => {
  it('prefers OPENROUTER_API_KEY for OpenRouter models, EMBEDDINGS_API_KEY otherwise', () => {
    // Both set is the normal deployment state after the flip: EMBEDDINGS_API_KEY
    // still holds the OpenAI key, which openrouter.ai would 401 on.
    withEnv({ OPENROUTER_API_KEY: 'or-key', EMBEDDINGS_API_KEY: 'openai-key' }, () => {
      expect(resolveEmbeddingsKey(OPENROUTER_MODEL).apiKey).to.equal('or-key');
      expect(resolveEmbeddingsKey(OPENAI_MODEL).apiKey).to.equal('openai-key');
      // No model given: the historical order, unchanged.
      expect(resolveEmbeddingsKey().apiKey).to.equal('openai-key');
    });
  });

  it('falls back to the other key when the preferred one is unset', () => {
    withEnv({ OPENROUTER_API_KEY: undefined, EMBEDDINGS_API_KEY: 'only-key' }, () => {
      expect(resolveEmbeddingsKey(OPENROUTER_MODEL).apiKey).to.equal('only-key');
    });
  });
});
