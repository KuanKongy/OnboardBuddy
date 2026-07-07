import { ArrowDownLeft, ArrowUpRight, FileCode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { COMPONENT_TYPE_COLORS } from "@/components/graph/ArchitectureNode";
import { COMPONENT_TYPE_DESCRIPTIONS, COMPONENT_TYPE_LABELS } from "@/lib/architectureGraph";
import type { ArchitectureComponent, ArchitectureEdge } from "@/types/graph";
import { cn } from "@/lib/utils";

interface ComponentInfoPanelProps {
  component: ArchitectureComponent;
  components: ArchitectureComponent[];
  edges: ArchitectureEdge[];
}

export function ComponentInfoPanel({ component, components, edges }: ComponentInfoPanelProps) {
  const labelById = new Map(components.map((c) => [c.id, c.label]));
  const dependsOn = edges.filter((e) => e.source === component.id);
  const usedBy = edges.filter((e) => e.target === component.id);

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{component.label}</h2>
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
            COMPONENT_TYPE_COLORS[component.type],
          )}
        >
          {COMPONENT_TYPE_LABELS[component.type]}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {COMPONENT_TYPE_DESCRIPTIONS[component.type]}
        </span>
      </div>

      <div className="flex flex-col divide-y divide-border md:flex-row md:divide-x md:divide-y-0">
        {/* Column 1: Source receipts */}
        <div className="flex-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
              Files
            </h3>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {component.files.length}
            </span>
          </div>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto">
            {component.files.map((file) => (
              <li key={file} className="flex items-start gap-1.5">
                <FileCode className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="break-all font-mono text-[11px] text-foreground">{file}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Column 2: Exports */}
        <div className="flex-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
              Key exports
            </h3>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {component.exportedSymbols.length}
            </span>
          </div>
          {component.exportedSymbols.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No exported symbols</p>
          ) : (
            <ul className="space-y-1.5">
              {component.exportedSymbols.map((symbol) => (
                <li key={symbol} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="font-mono text-[12px] text-foreground">{symbol}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Column 3: Connections */}
        <div className="flex-1 p-4">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-foreground">
            Connections
          </h3>

          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <ArrowUpRight className="h-3 w-3" />
            Depends on
          </div>
          {dependsOn.length === 0 ? (
            <p className="mb-3 text-[11px] text-muted-foreground">Nothing</p>
          ) : (
            <div className="mb-3 flex flex-wrap gap-1">
              {dependsOn.map((e) => (
                <Badge key={e.id} variant="outline" className="text-[10px]">
                  {labelById.get(e.target) ?? e.target}
                  {e.weight > 1 && <span className="ml-1 text-muted-foreground">×{e.weight}</span>}
                </Badge>
              ))}
            </div>
          )}

          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <ArrowDownLeft className="h-3 w-3" />
            Used by
          </div>
          {usedBy.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nothing</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {usedBy.map((e) => (
                <Badge key={e.id} variant="outline" className="text-[10px]">
                  {labelById.get(e.source) ?? e.source}
                  {e.weight > 1 && <span className="ml-1 text-muted-foreground">×{e.weight}</span>}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
