import { Handle, Position, type NodeProps } from "reactflow";
import { COMPONENT_TYPE_LABELS } from "@/lib/architectureGraph";
import type { ArchitectureComponentType } from "@/types/graph";
import { cn } from "@/lib/utils";

export const COMPONENT_TYPE_COLORS: Record<ArchitectureComponentType, string> = {
  entry: "bg-primary/20 text-primary border-primary/40",
  gateway: "bg-green-500/20 text-green-400 border-green-500/40",
  service: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  database: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  worker: "bg-rose-500/20 text-rose-400 border-rose-500/40",
  frontend: "bg-violet-500/20 text-violet-400 border-violet-500/40",
  utility: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
  config: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  tests: "bg-purple-500/20 text-purple-400 border-purple-500/40",
  module: "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

export interface ArchitectureNodeData {
  label: string;
  directory: string;
  componentType: ArchitectureComponentType;
  fileCount: number;
  exportedSymbols: string[];
  selected: boolean;
  dimmed: boolean;
}

export function ArchitectureNode({ data }: NodeProps<ArchitectureNodeData>) {
  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card px-3 py-2.5 shadow-md transition-opacity",
        data.selected
          ? "border-primary shadow-[0_0_0_1px_hsl(var(--ring))]"
          : "border-border hover:border-muted-foreground/40",
        data.dimmed && "opacity-20",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />

      <div className="mb-1 flex items-center gap-1.5">
        <span className="flex-1 truncate text-[13px] font-semibold text-foreground">
          {data.label}
        </span>
        <span
          className={cn(
            "shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide",
            COMPONENT_TYPE_COLORS[data.componentType],
          )}
        >
          {COMPONENT_TYPE_LABELS[data.componentType]}
        </span>
      </div>

      <p className="mb-2 truncate font-mono text-[10px] text-muted-foreground">{data.directory}/</p>

      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>{data.fileCount} {data.fileCount === 1 ? "file" : "files"}</span>
        {data.exportedSymbols.length > 0 && (
          <>
            <span className="text-border">·</span>
            <span className="truncate">{data.exportedSymbols.slice(0, 3).join(", ")}</span>
          </>
        )}
      </div>
    </div>
  );
}
