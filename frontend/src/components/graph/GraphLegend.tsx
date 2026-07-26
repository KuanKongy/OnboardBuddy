import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NODE_KIND_INFO } from "@/lib/graphNodeType";

// Only kinds actually present on the canvas are rendered (presentKinds).
// Colors/labels come from graphNodeType.ts's NODE_KIND_INFO — the single
// source of truth shared with the on-node badge — so a new kind can't be
// added there and silently miss the legend.

/**
 * The graph legend, as a strip UNDER the canvas rather than a card floating on
 * top of it.
 *
 * VISUAL QA M4 #9 measured the floating version on all three projects: a
 * `w-64` card in a React Flow `<Panel>` sits inside the same rectangle
 * `fitView` fits the nodes into, so at default zoom it covered graph content
 * on every one of them — two class cards on MasterPokedex, `FlowGraph` on
 * FloowForge, a group node on OnboardBuddy. Moving it corner to corner only
 * moves which nodes it hides (that is what `legendPosition` was, and why it is
 * gone). A legend outside the node area cannot occlude the node area at any
 * zoom, so this is laid out as a one-line horizontal bar and the canvas takes
 * the height that is left.
 */
export function GraphLegend({
  presentKinds,
  hiddenKinds,
  onToggleKind,
}: {
  presentKinds?: string[];
  hiddenKinds?: Set<string>;
  onToggleKind?: (kind: string) => void;
}) {
  // The swatches and the entry-point marker are the part a reader looks
  // something up in, so they are always on the bar; the two explanatory
  // sentences are what made the old card tall, and they open on request.
  const [expanded, setExpanded] = useState(false);

  const kinds = presentKinds
    ? Object.values(NODE_KIND_INFO).filter((k) => presentKinds.includes(k.type))
    : Object.values(NODE_KIND_INFO);

  return (
    <div className="shrink-0 border-t border-border bg-card/60 px-2.5 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-foreground">Legend</span>

        <span className="flex items-center gap-1.5">
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary text-[0.5rem] font-bold text-primary-foreground">
            ▶
          </span>
          <span className="text-muted-foreground">Entry point</span>
        </span>

        {kinds.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {kinds.map((kind) => {
              const isHidden = hiddenKinds?.has(kind.type) ?? false;
              const hint = isHidden ? `Show ${kind.label} nodes` : `Hide ${kind.label} nodes`;
              return (
                <Tooltip key={kind.type}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-pressed={!isHidden}
                      onClick={() => onToggleKind?.(kind.type)}
                      className={`flex items-center gap-1 rounded px-0.5 transition-opacity hover:opacity-100 ${isHidden ? "opacity-40" : "opacity-100"}`}
                    >
                      <span className={`h-2.5 w-2.5 shrink-0 rounded border ${kind.swatchClasses}`} />
                      <span className="text-muted-foreground">{kind.label}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="pointer-events-none">
                    {hint}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </span>
        )}

        {hiddenKinds && hiddenKinds.size > 0 && (
          <button
            type="button"
            onClick={() => hiddenKinds.forEach((k) => onToggleKind?.(k))}
            className="text-[0.65625rem] font-medium text-primary hover:underline"
          >
            Show all
          </button>
        )}

        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded text-[0.65625rem] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {expanded ? "Less" : "What the arrows mean"}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {expanded && (
        <p className="mt-1 max-w-[100ch] text-[0.6875rem] leading-snug text-muted-foreground">
          Each node is a file or module. An edge means the source file imports (depends on) the
          target file. Click a node to select it — its direct neighbors stay lit while everything
          else dims.
        </p>
      )}
    </div>
  );
}
