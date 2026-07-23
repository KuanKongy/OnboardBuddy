import type { SourceReceipt } from "@/types/onboarding";

/**
 * Inline citation markers.
 *
 * Generated section markdown carries `[[receipt:<bundle-receipt-uuid>]]`
 * markers where the model cited evidence. We turn each into a plain
 * markdown link `[N](#receipt:<uuid>)` (N = the receipt's 1-based position
 * in the section's receipt list, matching the numbered chips below the
 * text). SectionView overrides the `a` renderer for `#receipt:` hrefs to
 * render a clickable chip that opens the ReceiptViewer.
 *
 * Markers that don't resolve to a served receipt are removed — an inline
 * citation the reader can't open is exactly the noise this replaces.
 */
// Lazy match: bundle receipt ids are usually UUIDs but doc receipts use
// synthetic ids like `docnode:doc:README.md#section` — anything up to `]]`.
const MARKER = /\[\[receipt:(.+?)\]\]/g;

export const RECEIPT_HREF_PREFIX = "#receipt:";

export function receiptNumberById(receipts: SourceReceipt[]): Map<string, number> {
  const map = new Map<string, number>();
  receipts.forEach((r, i) => {
    if (r.bundleReceiptId && !map.has(r.bundleReceiptId)) map.set(r.bundleReceiptId, i + 1);
  });
  return map;
}

export function renderReceiptMarkers(body: string, receipts: SourceReceipt[]): string {
  const numbers = receiptNumberById(receipts);
  return body
    .replace(MARKER, (_m, id: string) => {
      const n = numbers.get(id);
      return n ? `[${n}](${RECEIPT_HREF_PREFIX}${id})` : "";
    })
    .replace(/[ \t]+([.,;:)])/g, "$1");
}

export function receiptForHref(
  href: string | undefined,
  receipts: SourceReceipt[],
): SourceReceipt | null {
  if (!href || !href.startsWith(RECEIPT_HREF_PREFIX)) return null;
  const id = href.slice(RECEIPT_HREF_PREFIX.length);
  return receipts.find((r) => r.bundleReceiptId === id) ?? null;
}
