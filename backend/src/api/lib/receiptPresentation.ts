/**
 * Receipt presentation helpers for the onboarding reader.
 *
 * The reader used to hardcode `staleness: "current"` / `ageLabel: "recent"`
 * on every receipt — a fake freshness badge on the product's core trust
 * surface. These helpers compute the real thing from evidence the pipeline
 * already stores (graph_nodes hashes per snapshot, snapshot timestamps,
 * per-claim citations in generation_context).
 */

import { hasKindPrefix } from "../../worker/engine/stableKeys.js";

export type ReceiptStaleness = "fresh" | "stale" | "unknown";

/**
 * A receipt is re-verified by comparing the cited symbol's content hash in
 * the receipt's own snapshot against the latest complete snapshot:
 *  - same hash            -> "fresh"  (code unchanged since this was written)
 *  - different / missing  -> "stale"  (source changed or symbol removed)
 *  - not node-addressable -> "unknown" (kind-prefixed keys — docs, config,
 *    schema, synthesis — stay neutral, never a green "Current")
 */
export function receiptStaleness(input: {
  nodeStableKey: string | null;
  ownNodeHash: string | null;
  latestNodeHash: string | null;
}): ReceiptStaleness {
  const { nodeStableKey, ownNodeHash, latestNodeHash } = input;
  // Kind-prefixed keys (doc:…, cluster:…, wf:…) are excluded by PREFIX, not
  // by containing a colon — route symbols like `x.ts#POST /:id/analyze` are
  // ordinary graph nodes and must re-verify. Missing hash = predates node
  // hashing.
  if (!nodeStableKey || hasKindPrefix(nodeStableKey) || !ownNodeHash) return "unknown";
  if (!latestNodeHash) return "stale"; // symbol gone from the latest analysis
  return ownNodeHash === latestNodeHash ? "fresh" : "stale";
}

export interface ReceiptVerification {
  status: "verified" | "re_anchored" | "changed" | "missing" | "unverifiable";
  /** Commit of the latest complete analysis the receipt was checked against. */
  checkedAgainstCommit: string | null;
  /**
   * Where this evidence lives in the latest analysis. For "re_anchored" the
   * receipt span shifted by the symbol's own movement; for "changed" it is
   * the symbol's current span (the receipt's snippet no longer matches it).
   */
  lineStart: number | null;
  lineEnd: number | null;
}

/**
 * Receipt re-anchoring (Swimm-style lifecycle): a receipt is verified at its
 * own commit and re-checked against the newest analysis. Unchanged symbols
 * that moved within their file re-anchor the receipt span by the symbol's
 * line delta — hash equality means identical content, so every sub-range
 * shifts by the same amount. Changed or missing symbols are never silently
 * presented at their old coordinates as if still valid.
 */
export function receiptVerification(input: {
  staleness: ReceiptStaleness;
  latestNodeHash: string | null;
  latestCommitHash: string | null;
  receiptLineStart: number | null;
  receiptLineEnd: number | null;
  ownNodeLineStart: number | null;
  latestNodeLineStart: number | null;
  latestNodeLineEnd: number | null;
}): ReceiptVerification {
  if (input.staleness === "unknown") {
    return { status: "unverifiable", checkedAgainstCommit: null, lineStart: null, lineEnd: null };
  }
  if (input.staleness === "stale") {
    const exists = input.latestNodeHash !== null;
    return {
      status: exists ? "changed" : "missing",
      checkedAgainstCommit: input.latestCommitHash,
      lineStart: exists ? input.latestNodeLineStart : null,
      lineEnd: exists ? input.latestNodeLineEnd : null,
    };
  }
  const canShift =
    input.ownNodeLineStart !== null && input.latestNodeLineStart !== null && input.receiptLineStart !== null;
  const delta = canShift ? input.latestNodeLineStart! - input.ownNodeLineStart! : 0;
  if (delta !== 0) {
    return {
      status: "re_anchored",
      checkedAgainstCommit: input.latestCommitHash,
      lineStart: input.receiptLineStart! + delta,
      lineEnd: input.receiptLineEnd !== null ? input.receiptLineEnd + delta : null,
    };
  }
  return {
    status: "verified",
    checkedAgainstCommit: input.latestCommitHash,
    lineStart: input.receiptLineStart,
    lineEnd: input.receiptLineEnd,
  };
}

/**
 * A confidence label without its reason is theater (audit §3.6): "high" on a
 * one-receipt section and "high" on a fifteen-receipt section must read
 * differently. The reason is computed from the same per-claim validation the
 * grade came from — mechanical counts, no adjectives. Works for legacy
 * sections too (generation_context.claims has been stored since v1).
 */
export function confidenceReasonFor(generationContext: unknown, receiptCount: number): string {
  const ctx = generationContext as { claims?: Array<{ receiptIds?: unknown; confidence?: unknown }> } | null;
  const claims = Array.isArray(ctx?.claims) ? ctx!.claims! : null;
  const receipts = `${receiptCount} receipt${receiptCount === 1 ? "" : "s"}`;
  if (!claims || claims.length === 0) {
    return receiptCount > 0
      ? `${receipts} · per-claim tracking not available for this generation`
      : "no receipts — content is not independently verifiable";
  }
  const cited = claims.filter((c) => Array.isArray(c.receiptIds) && (c.receiptIds as unknown[]).length > 0).length;
  const low = claims.filter((c) => c.confidence === "low").length;
  const parts = [`${cited}/${claims.length} tracked claims cite receipts`];
  if (low > 0) parts.push(`${low} downgraded to low`);
  parts.push(receipts);
  return parts.join(" · ");
}

export type PackageGenerationKind = "deterministic" | "ai_assisted" | "mixed" | "unknown";

export interface PackageGenerationMode {
  /** What actually produced this package's sections. */
  kind: PackageGenerationKind;
  /** The privacy mode the sections were generated under (null = not unanimous / not recorded). */
  privacyMode: "full_ai" | "facts_only_ai" | "ai_disabled" | null;
  /** How many sections came from the deterministic backbone (no LLM). */
  deterministicSections: number;
  totalSections: number;
  /** One honest sentence for the reader; null when there is nothing to disclose. */
  label: string | null;
}

/**
 * How a package was ACTUALLY made, read back from the sections themselves.
 *
 * This exists because `analysis_snapshots.privacy_mode` — what the provenance
 * panel used to display — records the mode the ANALYSIS ran under and is never
 * refreshed. Generation follows the live setting (summaryWorker.loadSnapshot),
 * so a package regenerated after switching to ai_disabled is deterministic
 * while its snapshot still says `full_ai`. Reporting the snapshot's copy told
 * the user their no-AI setting had been ignored when it had in fact been
 * honored — the setting looked broken because the label was wrong.
 *
 * Sections written before privacy_mode was recorded still resolve: the
 * deterministic path has always stamped `mode: 'deterministic'`.
 */
export function packageGenerationMode(generationContexts: unknown[]): PackageGenerationMode {
  const modes = generationContexts.map((raw) => {
    const ctx = raw as { privacy_mode?: unknown; mode?: unknown } | null;
    const recorded = ctx?.privacy_mode;
    if (recorded === "full_ai" || recorded === "facts_only_ai" || recorded === "ai_disabled") return recorded;
    return ctx?.mode === "deterministic" ? ("ai_disabled" as const) : null;
  });
  const total = modes.length;
  const deterministic = modes.filter((m) => m === "ai_disabled").length;
  if (total === 0) {
    return { kind: "unknown", privacyMode: null, deterministicSections: 0, totalSections: 0, label: null };
  }
  const unanimous = modes.every((m) => m !== null && m === modes[0]) ? modes[0]! : null;

  if (deterministic === total) {
    return {
      kind: "deterministic",
      privacyMode: "ai_disabled",
      deterministicSections: deterministic,
      totalSections: total,
      label:
        "Structural only — built without AI (privacy mode: AI disabled). Every item below was extracted directly from the code by static analysis, so it reads as facts and tables rather than explanation.",
    };
  }
  if (deterministic > 0) {
    return {
      kind: "mixed",
      privacyMode: null,
      deterministicSections: deterministic,
      totalSections: total,
      label: `Mixed package — ${deterministic} of ${total} sections were built without AI (structural only); the rest carry AI narration from an earlier run.`,
    };
  }
  return {
    kind: "ai_assisted",
    privacyMode: unanimous,
    deterministicSections: 0,
    totalSections: total,
    label:
      unanimous === "facts_only_ai"
        ? "Facts-only AI — no code left the system: explanations were written from extracted facts, signatures and graph metadata, with every code snippet withheld from the model."
        : null,
  };
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
 * [[unverified]] spans keep their text with an explicit "[unverified]" tag —
 * the export must stay as honest as the reader.
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
    .replace(/\[\[unverified\]\]/g, "")
    .replace(/\[\[\/unverified\]\]/g, " *[unverified]*")
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
