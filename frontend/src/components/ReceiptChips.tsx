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
  const lineRange = receipt.lineStart
    ? ` ${receipt.lineStart}${receipt.lineEnd ? `–${receipt.lineEnd}` : ""}`
    : "";
  return (
    <button
      onClick={() => onClick(receipt)}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.71875rem] transition-colors hover:border-primary/50 hover:bg-accent",
        receipt.staleness === "stale" ? "border-warning/40 bg-warning-soft" : "border-border bg-muted/40",
      )}
      title={receipt.snippet ? "Click to view the code snippet" : receipt.filePath}
    >
      {index != null && (
        <span className="shrink-0 rounded bg-muted px-1 text-[0.625rem] font-semibold text-muted-foreground">
          {index}
        </span>
      )}
      <FileCode2 className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-foreground">{receipt.filePath}</span>
      {lineRange && <span className="shrink-0 text-muted-foreground">{lineRange}</span>}
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
      className="mx-0.5 inline-flex -translate-y-[0.2em] items-center rounded border border-border bg-muted/60 px-1 align-baseline text-[0.625rem] font-semibold leading-4 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground"
      title={`${receipt.filePath}${receipt.lineStart ? ` ${receipt.lineStart}–${receipt.lineEnd ?? receipt.lineStart}` : ""}`}
      aria-label={`Source reference ${index}: ${receipt.filePath}`}
    >
      {index}
    </button>
  );
}
