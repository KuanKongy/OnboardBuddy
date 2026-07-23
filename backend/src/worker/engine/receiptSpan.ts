/**
 * Receipt span capping (audit §3.7): a 550-line "receipt" is a receipt in
 * name only — nobody re-reads ProjectSettingsPage.tsx L69-627 to check one
 * claim. Spans are capped at extraction and at retrieval so every receipt
 * stays spot-checkable; the original extent is kept as an honest
 * "first N of M lines" marker instead of being silently discarded.
 */

export const MAX_RECEIPT_SPAN_LINES = 40;

export interface ReceiptSpanLike {
  lineStart?: number | null;
  lineEnd?: number | null;
  snippet?: string | null;
  /** Original lineEnd when a previous cap already truncated this receipt. */
  truncatedFromLineEnd?: number | null;
}

/**
 * Caps a receipt span to MAX_RECEIPT_SPAN_LINES, slicing the snippet to
 * match (snippets start at lineStart, so the first N lines correspond to
 * the capped range). Already-capped or short spans pass through untouched.
 */
export function capReceiptSpan<T extends ReceiptSpanLike>(receipt: T): T {
  const { lineStart, lineEnd } = receipt;
  if (lineStart == null || lineEnd == null) return receipt;
  const span = lineEnd - lineStart + 1;
  if (span <= MAX_RECEIPT_SPAN_LINES) return receipt;
  const snippet =
    typeof receipt.snippet === "string"
      ? receipt.snippet.split("\n").slice(0, MAX_RECEIPT_SPAN_LINES).join("\n")
      : receipt.snippet;
  return {
    ...receipt,
    lineEnd: lineStart + MAX_RECEIPT_SPAN_LINES - 1,
    snippet,
    truncatedFromLineEnd: receipt.truncatedFromLineEnd ?? lineEnd,
  };
}
