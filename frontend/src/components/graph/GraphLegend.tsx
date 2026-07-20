import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isGraphHintDismissed } from "@/components/graph/GraphFirstVisitHint";
import { NODE_KIND_INFO } from "@/lib/graphNodeType";

// Only kinds actually present on the canvas are rendered (presentKinds).
// Colors/labels come from graphNodeType.ts's NODE_KIND_INFO — the single
// source of truth shared with the on-node badge — so a new kind can't be
// added there and silently miss the legend.

export function GraphLegend({ presentKinds }: { presentKinds?: string[] }) {
  // Start collapsed on a user's first visit so the legend doesn't fight the
  // first-visit hint (and the Controls/MiniMap) for canvas space.
  const [expanded, setExpanded] = useState(() => isGraphHintDismissed());

  const kinds = presentKinds
    ? Object.values(NODE_KIND_INFO).filter((k) => presentKinds.includes(k.type))
    : Object.values(NODE_KIND_INFO);

  // The card keeps the same width and header row in both states — collapsing
  // only removes the body, so the control never jumps or changes shape.
  return (
    <Card className="w-64 max-w-[75vw] gap-2 border-border bg-card/95 px-3 py-2.5 text-xs shadow-md backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground">Legend</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={expanded ? "Collapse legend" : "Expand legend"}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </Button>
      </div>

      {expanded && (
        <>
          <p className="text-muted-foreground">
            Each node is a file or module. An edge means the source file imports
            (depends on) the target file.
          </p>

          <div className="flex items-center gap-1.5">
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
              ▶
            </span>
            <span className="text-muted-foreground">Entry point — where app flow starts</span>
          </div>

          {kinds.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-foreground">Node kind</p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {kinds.map((kind) => (
                  <div key={kind.type} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded border ${kind.swatchClasses}`} />
                    <span className="truncate text-muted-foreground">{kind.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-muted-foreground">
            Click a node to select it — its direct neighbors stay lit while
            everything else dims.
          </p>
        </>
      )}
    </Card>
  );
}
