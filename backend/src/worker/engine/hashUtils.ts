import * as crypto from 'node:crypto';

/** sha256 hex digest of a string. */
export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Short (16-char) sha256 prefix — for display and node identity hashes. */
export function shortHash(content: string): string {
  return sha256(content).slice(0, 16);
}

/**
 * Renders a value as canonical JSON: object keys sorted recursively so the
 * same logical value always hashes identically regardless of insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

/** sha256 of the canonical JSON rendering — used for evidence hashes. */
export function canonicalJsonHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Normalizes source text before hashing so whitespace-only edits do not
 * invalidate body hashes: strips comments-insensitive trailing spaces,
 * collapses runs of blank lines, normalizes line endings.
 */
export function normalizeSource(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Body hash: sha256 over normalized source text. */
export function hashBody(text: string): string {
  return sha256(normalizeSource(text));
}
