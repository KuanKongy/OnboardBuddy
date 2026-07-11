/**
 * Privacy-mode enforcement (doc/Pipeline.md "Privacy modes"). Mechanical,
 * not prompt wording: evidence bundles are stripped of snippet fields
 * before anything reaches a provider in facts_only_ai mode, and
 * ai_disabled refuses provider calls outright.
 */

export type PrivacyMode = 'full_ai' | 'facts_only_ai' | 'ai_disabled';

export class AiDisabledError extends Error {
  constructor() {
    super('privacy_mode is ai_disabled — no LLM calls allowed');
    this.name = 'AiDisabledError';
  }
}

export function assertAiAllowed(mode: PrivacyMode): void {
  if (mode === 'ai_disabled') throw new AiDisabledError();
}

/** Property names whose string values are code content and must not leave the system in facts-only mode. */
const SNIPPET_KEYS = new Set(['snippet', 'snippets', 'code', 'body_text', 'source']);

/**
 * Deep-copies `value` with snippet-bearing fields removed. Applied to
 * evidence bundles before prompt assembly when mode is facts_only_ai.
 */
export function applyPrivacyMode<T>(value: T, mode: PrivacyMode): T {
  assertAiAllowed(mode);
  if (mode === 'full_ai') return value;
  return stripSnippetsDeep(value);
}

export function stripSnippetsDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripSnippetsDeep(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SNIPPET_KEYS.has(key)) continue;
      out[key] = stripSnippetsDeep(v);
    }
    return out as T;
  }
  return value;
}

/** One-line label for prompts/outputs so facts-only results are marked as such. */
export function privacyNotice(mode: PrivacyMode): string | null {
  return mode === 'facts_only_ai'
    ? 'NOTE: code snippets are withheld by project privacy settings; only extracted facts and graph metadata are provided.'
    : null;
}
