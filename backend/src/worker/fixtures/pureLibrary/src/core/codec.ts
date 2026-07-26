import { normalizeAmount } from '../internal/normalize';
import type { Entry } from '../types';

export function parseEntry(raw: string): Entry {
  const parsed = JSON.parse(raw) as Entry;
  return { ...parsed, postings: parsed.postings.map((p) => ({ ...p, amount: normalizeAmount(p.amount) })) };
}

export function serializeEntry(entry: Entry): string {
  return JSON.stringify(entry);
}

/** Exported, but never re-exported by the barrel — internal to the package. */
export function debugDump(entry: Entry): string {
  return `${entry.id}: ${entry.postings.length} postings`;
}
