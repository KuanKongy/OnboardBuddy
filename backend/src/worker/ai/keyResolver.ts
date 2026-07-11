/**
 * Per-call API key resolution (doc/Pipeline.md "BYO LLM keys"): the
 * project's own key (project_llm_keys, decrypted) wins over the server
 * key; ai_generation_runs.key_source records which one served the call.
 */

import { query } from '../../lib/db.js';
import { decrypt } from '../../lib/encryption.js';

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

/** Embeddings go to the embeddings endpoint with its own (server) key. */
export function resolveEmbeddingsKey(): ResolvedKey {
  const key = process.env.EMBEDDINGS_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('No embeddings API key: set EMBEDDINGS_API_KEY or OPENROUTER_API_KEY');
  return { apiKey: key, keySource: 'server' };
}
