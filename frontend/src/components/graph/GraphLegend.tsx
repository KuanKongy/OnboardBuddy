import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isGraphHintDismissed } from "@/components/graph/GraphFirstVisitHint";

// Mirrors the color mapping in lib/graphNodeType.ts (inferNodeType) — the
// `kind` values are that function's `type` outputs. Only kinds actually
// present on the canvas are rendered (presentKinds).
const NODE_KINDS: { kind: string; label: string; swatchClass: string }[] = [
  { kind: "TEST", label: "Test", swatchClass: "bg-purple-500/20 border-purple-500/40" },
  { kind: "UTIL", label: "Util", swatchClass: "bg-cyan-500/20 border-cyan-500/40" },
  { kind: "API", label: "API", swatchClass: "bg-green-500/20 border-green-500/40" },
  { kind: "SERVICE", label: "Service", swatchClass: "bg-blue-500/20 border-blue-500/40" },
  { kind: "MIDDLEWARE", label: "Middleware", swatchClass: "bg-amber-500/20 border-amber-500/40" },
  { kind: "DATA", label: "Data", swatchClass: "bg-orange-500/20 border-orange-500/40" },
  { kind: "ENV", label: "Env/config", swatchClass: "bg-yellow-500/20 border-yellow-500/40" },
  { kind: "ENTRY", label: "Index/main", swatchClass: "bg-primary/20 border-primary/40" },
  { kind: "MODULE", label: "Module", swatchClass: "bg-slate-500/20 border-slate-500/40" },
];

export function GraphLegend({ presentKinds }: { presentKinds?: string[] }) {
  // Start collapsed on a user's first visit so the legend doesn't fight the
  // first-visit hint (and the Controls/MiniMap) for canvas space.
  const [expanded, setExpanded] = useState(() => isGraphHintDismissed());

  const kinds = presentKinds
    ? NODE_KINDS.filter((k) => presentKinds.includes(k.kind))
    : NODE_KINDS;

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
                  <div key={kind.kind} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded border ${kind.swatchClass}`} />
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
