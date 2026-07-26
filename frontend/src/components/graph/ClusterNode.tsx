import { Handle, Position, type NodeProps } from "reactflow";
import { CLUSTER_KIND_LABELS, CLUSTER_KIND_PALETTE } from "@/lib/architectureData";
import { cn } from "@/lib/utils";

export interface ClusterNodeData {
  label: string;
  kind: string;
  /** Members of the cluster's primary kind — see `clusterSize`. */
  count: number;
  /** "file", "table" or "config file": a schema cluster holds no files. */
  noun: string;
  criticalScore: number;
  summary: string;
  selected: boolean;
  dimmed: boolean;
}

/**
 * Architecture cluster node: kind-colored edge stripe + chip, member count,
 * and a criticality bar so importance reads at a glance.
 */
export function ClusterNode({ data }: NodeProps<ClusterNodeData>) {
  const palette = CLUSTER_KIND_PALETTE[data.kind] ?? "shared";
  const color = `var(--node-${palette})`;

  return (
    <div
      className={cn(
        "w-[240px] rounded-lg border bg-card shadow-sm transition-all",
        data.selected ? "ring-2 ring-ring" : "hover:shadow-md",
        data.dimmed && "opacity-25",
      )}
      style={{ borderColor: data.selected ? color : "var(--border)" }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-muted-foreground/60" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-muted-foreground/60" />

      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-foreground" title={data.label}>
          {data.label}
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide"
          style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
        >
          {CLUSTER_KIND_LABELS[data.kind] ?? data.kind}
        </span>
      </div>

      {data.summary && (
        <p className="mt-1 line-clamp-2 px-3 text-[0.71875rem] leading-snug text-muted-foreground">
          {data.summary}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 border-t border-border/60 px-3 py-1.5">
        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
          {data.count} {data.noun}{data.count === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex items-center gap-1.5" title={`Criticality ${(data.criticalScore * 100).toFixed(0)}%`}>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, Math.round(data.criticalScore * 100))}%`, background: color }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
