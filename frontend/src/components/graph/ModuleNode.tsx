import { Star } from "lucide-react";
import { Handle, Position, type NodeProps } from "reactflow";
import { /* inferComplexity, */ inferNodeType } from "@/lib/graphNodeType";
import { cn } from "@/lib/utils";

export interface ModuleNodeData {
  label: string;
  kind: string;
  filePath: string;
  exportedSymbols: string[];
  importCount: number;
  dependentCount: number;
  symbolCount: number;
  isEntryPoint: boolean;
  dimmed: boolean;
  selected: boolean;
}

export function ModuleNode({ data }: NodeProps<ModuleNodeData>) {
  const typeInfo = inferNodeType(data.filePath, data.exportedSymbols);

  // const complexity = inferComplexity(data.importCount, data.dependentCount, data.symbolCount);


  return (
    <div
      className={cn(
        "w-52 rounded-lg border bg-card px-3 py-2.5 shadow-md transition-opacity",
        data.selected
          ? "border-primary shadow-[0_0_0_1px_hsl(var(--ring))]"
          : "border-border hover:border-muted-foreground/40",
        data.dimmed && "opacity-20",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />

      <div className="mb-1 flex items-center gap-1.5">
        <span className="flex-1 truncate text-[13px] font-semibold text-foreground" title={data.label}>
          {data.label}
        </span>
        {data.selected && <Star className="h-3 w-3 flex-shrink-0 fill-primary text-primary" />}
        <span
          className={cn(
            "shrink-0 rounded border px-1 py-0.5 text-[11px] font-bold uppercase tracking-wide",
            typeInfo.colorClasses,
          )}
        >
          {typeInfo.type}
        </span>
      </div>

      <p className="mb-2 truncate text-xs text-muted-foreground" title={typeInfo.description}>{typeInfo.description}</p>

      {/* {data.selected && complexity && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-500/20 text-orange-400">
          <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-orange-500/20 text-orange-700 dark:text-orange-400">
            {complexity}
          </span>
        </div>
      )} */}

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{data.exportedSymbols.length} exports</span>
        <span className="text-border">·</span>
        <span>{data.importCount} imports</span>
        <span className="text-border">·</span>
        <span>{data.dependentCount} used by</span>
      </div>
    </div>
  );
}
