import { AlertTriangle, FileCode2 } from "lucide-react";
import type { SourceReceipt } from "@/types/onboarding";
import { cn } from "@/lib/utils";

/**
 * Numbered receipt chip listed under generated text; the number matches the
 * inline [N] citation markers. Shared by the section reader and the Q&A
 * panel so citations look identical everywhere.
 */
export function ReceiptChip({
  receipt,
  onClick,
  index,
}: {
  receipt: SourceReceipt;
  onClick: (r: SourceReceipt) => void;
  /** 1-based number matching inline [N] citation markers in the text. */
  index?: number;
}) {
  // A11 / §19.3: the chip used to be a number plus a bare path
  // ("28packages/shared/src/index.ts"). The receipt already carries the symbol
  // and the line range that §17.1 verified as accurate, so show them:
  // `index.ts:120–134 · persistWorkflows`. The full path stays in the tooltip.
  const lineRange = receipt.lineStart
    ? `:${receipt.lineStart}${receipt.lineEnd && receipt.lineEnd !== receipt.lineStart ? `–${receipt.lineEnd}` : ""}`
    : "";
  const fileLabel = receipt.filePath?.split("/").pop() || receipt.filePath;
  return (
    <button
      onClick={() => onClick(receipt)}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.71875rem] transition-colors hover:border-primary/50 hover:bg-accent",
        receipt.staleness === "stale" ? "border-warning/40 bg-warning-soft" : "border-border bg-muted/40",
      )}
      title={`${receipt.filePath}${lineRange}${receipt.symbolName ? ` · ${receipt.symbolName}` : ""}${
        receipt.snippet ? " — click to view the code snippet" : ""
      }`}
    >
      {index != null && (
        <span className="shrink-0 rounded bg-muted px-1 text-[0.625rem] font-semibold text-muted-foreground">
          {index}
        </span>
      )}
      <FileCode2 className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-foreground">
        {fileLabel}
        {lineRange}
      </span>
      {receipt.symbolName && (
        <span className="shrink-0 truncate text-muted-foreground">· {receipt.symbolName}</span>
      )}
      {receipt.staleness === "stale" && <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-warning" />}
    </button>
  );
}

/**
 * Inline citation chip rendered where the generated text cited a receipt —
 * the [N] numbering matches the receipt chips listed under the text.
 */
export function InlineReceiptRef({
  receipt,
  index,
  onClick,
}: {
  receipt: SourceReceipt;
  index: number;
  onClick: (r: SourceReceipt) => void;
}) {
  return (
    <button
      onClick={() => onClick(receipt)}
      // Primary tone, not muted: muted is the inert `prose-code` chips around it.
      className="mx-0.5 inline-flex -translate-y-[0.2em] items-center rounded border border-primary/40 bg-muted/60 px-1 align-baseline text-[0.625rem] font-semibold leading-4 text-primary transition-colors hover:border-primary hover:bg-accent"
      title={`${receipt.filePath}${receipt.lineStart ? `:${receipt.lineStart}–${receipt.lineEnd ?? receipt.lineStart}` : ""}${
        receipt.symbolName ? ` · ${receipt.symbolName}` : ""
      }`}
      aria-label={`Source reference ${index}: ${receipt.filePath}${receipt.symbolName ? `, ${receipt.symbolName}` : ""}`}
    >
      {index}
    </button>
  );
}
