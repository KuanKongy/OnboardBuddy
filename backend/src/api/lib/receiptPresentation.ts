/**
 * Receipt presentation helpers for the onboarding reader.
 *
 * The reader used to hardcode `staleness: "current"` / `ageLabel: "recent"`
 * on every receipt — a fake freshness badge on the product's core trust
 * surface. These helpers compute the real thing from evidence the pipeline
 * already stores (graph_nodes hashes per snapshot, snapshot timestamps,
 * per-claim citations in generation_context).
 */

export type ReceiptStaleness = "fresh" | "stale" | "unknown";

/**
 * A receipt is re-verified by comparing the cited symbol's content hash in
 * the receipt's own snapshot against the latest complete snapshot:
 *  - same hash            -> "fresh"  (code unchanged since this was written)
 *  - different / missing  -> "stale"  (source changed or symbol removed)
 *  - not node-addressable -> "unknown" (docs/synthesis keys have no hash to
 *    compare — shown neutrally, never as a green "Current")
 */
export function receiptStaleness(input: {
  nodeStableKey: string | null;
  ownNodeHash: string | null;
  latestNodeHash: string | null;
}): ReceiptStaleness {
  const { nodeStableKey, ownNodeHash, latestNodeHash } = input;
  // Synthesis keys (cluster:…, wf:…) and doc keys (docnode:…) are not graph
  // nodes; there is nothing to diff against. Same when the receipt predates
  // node hashing.
  if (!nodeStableKey || nodeStableKey.includes(":") || !ownNodeHash) return "unknown";
  if (!latestNodeHash) return "stale"; // symbol gone from the latest analysis
  return ownNodeHash === latestNodeHash ? "fresh" : "stale";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "analyzed today" / "analyzed 6 days ago" / "analyzed on 16 Jun 2026". */
export function ageLabelFrom(analyzedAt: string | Date | null, now: Date = new Date()): string {
  if (!analyzedAt) return "";
  const at = analyzedAt instanceof Date ? analyzedAt : new Date(analyzedAt);
  if (Number.isNaN(at.getTime())) return "";
  const days = Math.floor((now.getTime() - at.getTime()) / DAY_MS);
  if (days <= 0) return "analyzed today";
  if (days === 1) return "analyzed yesterday";
  if (days <= 30) return `analyzed ${days} days ago`;
  return `analyzed on ${at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

/**
 * Inline [[receipt:<bundle-id>]] markers are a reader-UI affordance; in
 * exported Markdown they become plain "(path:line)" citations. Unresolvable
 * markers are dropped — never leak raw marker syntax into an export.
 */
export function inlineMarkersToText(
  content: string,
  receiptByBundleId: Map<string, { filePath: string | null; lineStart: number | null }>,
): string {
  return content
    .replace(/\[\[receipt:(.+?)\]\]/g, (_m, id: string) => {
      const r = receiptByBundleId.get(id);
      if (!r?.filePath) return "";
      return ` (${r.filePath}${r.lineStart ? `:${r.lineStart}` : ""})`;
    })
    .replace(/[ \t]+([.,;:)])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

interface GenerationContextClaim {
  claim?: unknown;
  receiptIds?: unknown;
}

/**
 * Legacy packages persisted receipts without a `claim` column; the claim
 * text lives in generation_context.claims keyed by the ORIGINAL bundle
 * receipt id (stored on the copy as metadata.copiedFromReceiptId). New
 * generations write source_receipts.claim directly; this is the fallback.
 */
export function claimForReceipt(
  bundleReceiptId: string | null,
  generationContext: unknown,
): string | null {
  if (!bundleReceiptId) return null;
  const claims = (generationContext as { claims?: GenerationContextClaim[] } | null)?.claims;
  if (!Array.isArray(claims)) return null;
  const texts = claims
    .filter(
      (c) =>
        Array.isArray(c.receiptIds) &&
        (c.receiptIds as unknown[]).includes(bundleReceiptId) &&
        typeof c.claim === "string" &&
        (c.claim as string).length > 0,
    )
    .map((c) => c.claim as string);
  if (texts.length === 0) return null;
  // One receipt often backs several claims; two are plenty for the viewer.
  return texts.slice(0, 2).join(" · ");
}
