/**
 * Per-call API key resolution (doc/Pipeline.md "BYO LLM keys"): the
 * project's own key (project_llm_keys, decrypted) wins over the server
 * key; ai_generation_runs.key_source records which one served the call.
 */

import { query } from '../../lib/db.js';
import { decrypt } from '../../lib/encryption.js';
import { profileForModel } from './embeddingProfiles.js';

export type KeySource = 'server' | 'project';

export interface ResolvedKey {
  apiKey: string;
  keySource: KeySource;
}

export async function resolveApiKey(projectId: string, provider = 'openrouter'): Promise<ResolvedKey> {
  const result = await query(
    `SELECT api_key_encrypted FROM project_llm_keys WHERE project_id = $1 AND provider = $2`,
    [projectId, provider],
  );
  const row = result.rows[0] as { api_key_encrypted: string } | undefined;
  if (row) {
    try {
      return { apiKey: decrypt(row.api_key_encrypted), keySource: 'project' };
    } catch (err) {
      // A corrupt project key must not brick analysis — fall through to the
      // server key and let the audit trail show key_source='server'.
      console.warn(`[keyResolver] failed to decrypt project key for ${projectId}:`, err instanceof Error ? err.message : err);
    }
  }
  const serverKey = process.env.OPENROUTER_API_KEY;
  if (!serverKey) {
    throw new Error('No LLM API key available: project has no key and OPENROUTER_API_KEY is not set');
  }
  return { apiKey: serverKey, keySource: 'server' };
}

/**
 * Embeddings go to the embeddings endpoint with its own (server) key.
 *
 * The preference order flips with the model's profile because both keys are
 * usually set at once: EMBEDDINGS_API_KEY holds an OpenAI key on every
 * deployment that predates the OpenRouter switch, and sending an OpenAI key
 * to openrouter.ai is a guaranteed 401 for the whole embedding phase. Callers
 * that omit `model` keep the historical order.
 */
export function resolveEmbeddingsKey(model?: string): ResolvedKey {
  const preferOpenRouter = model !== undefined && profileForModel(model).keyPreference === 'openrouter';
  const key = preferOpenRouter
    ? process.env.OPENROUTER_API_KEY ?? process.env.EMBEDDINGS_API_KEY
    : process.env.EMBEDDINGS_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('No embeddings API key: set EMBEDDINGS_API_KEY or OPENROUTER_API_KEY');
  return { apiKey: key, keySource: 'server' };
}
