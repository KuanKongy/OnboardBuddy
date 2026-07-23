import { cn } from "@/lib/utils";

/**
 * Dependency-free code block with a line-number gutter, per-line hover
 * highlight, and optional externally-driven highlight ranges (absolute file
 * line numbers — e.g. a hovered receipt's lineStart..lineEnd). Snippets are
 * extracted as node.getText() starting exactly at the symbol's first line,
 * so rendered line i = startLine + i.
 */

export interface HighlightRange {
  start: number;
  end: number;
}

export function CodeSnippet({
  code,
  startLine = 1,
  highlightRanges,
  maxHeightClass = "max-h-80",
  className,
}: {
  code: string;
  /** Absolute file line number of the snippet's first line. */
  startLine?: number;
  /** Absolute line ranges to emphasize (inclusive). */
  highlightRanges?: HighlightRange[];
  maxHeightClass?: string;
  className?: string;
}) {
  const lines = code.replace(/\n$/, "").split("\n");
  const isHighlighted = (absLine: number) =>
    (highlightRanges ?? []).some((r) => absLine >= r.start && absLine <= r.end);

  return (
    <div
      className={cn(
        "overflow-auto rounded-md border border-border bg-muted/30 font-mono text-[0.75rem] leading-relaxed",
        maxHeightClass,
        className,
      )}
    >
      <div className="min-w-max py-2">
        {lines.map((line, i) => {
          const absLine = startLine + i;
          const highlighted = isHighlighted(absLine);
          return (
            <div
              key={i}
              data-line={absLine}
              className={cn(
                "flex transition-colors hover:bg-accent/60",
                highlighted && "bg-primary/15 hover:bg-primary/20",
              )}
            >
              <span
                className={cn(
                  "w-12 shrink-0 select-none border-r border-border/50 pr-2 text-right tabular-nums",
                  highlighted ? "border-r-primary/40 text-primary" : "text-muted-foreground/50",
                )}
              >
                {absLine}
              </span>
              <span className="whitespace-pre pl-3 pr-4 text-foreground">{line || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
