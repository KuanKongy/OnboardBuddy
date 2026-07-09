import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Mirrors the color mapping in lib/graphNodeType.ts (inferNodeType). Kept as
// a static list here rather than importing that module's logic, since these
// are just legend swatches — do not add a category this list doesn't render.
const NODE_KINDS: { label: string; swatchClass: string }[] = [
  { label: "Test", swatchClass: "bg-purple-500/20 border-purple-500/40" },
  { label: "Util", swatchClass: "bg-cyan-500/20 border-cyan-500/40" },
  { label: "API", swatchClass: "bg-green-500/20 border-green-500/40" },
  { label: "Service", swatchClass: "bg-blue-500/20 border-blue-500/40" },
  { label: "Middleware", swatchClass: "bg-amber-500/20 border-amber-500/40" },
  { label: "Data", swatchClass: "bg-orange-500/20 border-orange-500/40" },
  { label: "Env/config", swatchClass: "bg-yellow-500/20 border-yellow-500/40" },
  { label: "Entry", swatchClass: "bg-primary/20 border-primary/40" },
  { label: "Module", swatchClass: "bg-slate-500/20 border-slate-500/40" },
];

export function GraphLegend() {
  const [expanded, setExpanded] = useState(true);

  if (!expanded) {
    return (
      <Button
        variant="outline"
        size="xs"
        className="bg-card/95 shadow-md backdrop-blur"
        onClick={() => setExpanded(true)}
      >
        Legend
        <ChevronUp className="h-3 w-3" />
      </Button>
    );
  }

  return (
    <Card className="w-64 max-w-[75vw] gap-2 border-border bg-card/95 px-3 py-2.5 text-xs shadow-md backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground">Legend</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Collapse legend"
          onClick={() => setExpanded(false)}
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
      </div>

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

      <div>
        <p className="mb-1 font-medium text-foreground">Node kind</p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {NODE_KINDS.map((kind) => (
            <div key={kind.label} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 shrink-0 rounded border ${kind.swatchClass}`} />
              <span className="truncate text-muted-foreground">{kind.label}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-muted-foreground">
        Click a node to select it — its direct neighbors stay lit while
        everything else dims.
      </p>
    </Card>
  );
}
