import { ChevronRight } from "lucide-react";
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
  /** Where the count came from and what it excludes — the number contract. */
  countDerivation: string;
  criticalScore: number;
  /**
   * What this component is responsible for. NOT the old `summary`, which read
   * "Auth services: 9 files, 40 symbols" — an inventory rendered directly under
   * a heading that already said "Auth services" and beside a chip that already
   * said "9 files".
   */
  responsibility: string;
  selected: boolean;
  dimmed: boolean;
}

/**
 * Architecture cluster node: kind-colored edge stripe + chip, what the
 * component is for, its size as a muted chip, and a criticality bar.
 *
 * The card is a door, not a leaf — clicking it drills into the component's
 * members — so it carries an affordance saying so.
 */
export function ClusterNode({ data }: NodeProps<ClusterNodeData>) {
  const palette = CLUSTER_KIND_PALETTE[data.kind] ?? "shared";
  const color = `var(--node-${palette})`;

  return (
    <div
      className={cn(
        "group w-[240px] rounded-lg border bg-card shadow-sm transition-all",
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

      {data.responsibility && (
        <p
          className="mt-1 line-clamp-3 px-3 text-[0.71875rem] leading-snug text-muted-foreground"
          title={data.responsibility}
        >
          {data.responsibility}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 border-t border-border/60 px-3 py-1.5">
        {/* The count, as a chip beside the component rather than as a sentence
            about it — and it says where it came from on hover, because "0 files"
            over a component holding 48 tables is the failure this replaces. */}
        <span
          className="rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-muted-foreground"
          title={data.countDerivation}
        >
          {data.count} {data.noun}{data.count === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex items-center gap-1.5" title={`Criticality ${(data.criticalScore * 100).toFixed(0)}% — open the component for the full derivation`}>
          <div className="h-1 w-14 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, Math.round(data.criticalScore * 100))}%`, background: color }}
            />
          </div>
        </div>
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
      </div>
    </div>
  );
}

export interface ClusterMemberNodeData {
  label: string;
  filePath: string | null;
  /** Null when this member carries no stored criticality score. */
  criticalScore: number | null;
  importCount: number;
  dependentCount: number;
  /** Kind of the component this member belongs to — keeps the level colored. */
  clusterKind: string;
  selected: boolean;
  dimmed: boolean;
}

/**
 * A member of a component, one level down.
 *
 * Ranked by criticality, so the point of opening a component is visible without
 * reading: the files that carry the component's score sit at the top of the
 * bar. A member with no stored score shows no bar at all rather than a 0% one,
 * which would read as "unimportant" instead of "not ranked".
 */
export function ClusterMemberNode({ data }: NodeProps<ClusterMemberNodeData>) {
  const palette = CLUSTER_KIND_PALETTE[data.clusterKind] ?? "shared";
  const color = `var(--node-${palette})`;

  return (
    <div
      className={cn(
        "w-[220px] rounded-lg border border-l-4 bg-card px-3 py-2 shadow-sm transition-all",
        data.selected ? "ring-2 ring-ring" : "hover:shadow-md",
        data.dimmed && "opacity-25",
      )}
      style={{ borderLeftColor: color, borderTopColor: "var(--border)", borderRightColor: "var(--border)", borderBottomColor: "var(--border)" }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-muted-foreground/60" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-muted-foreground/60" />

      <p className="truncate text-[0.8125rem] font-medium text-foreground" title={data.filePath ?? data.label}>
        {data.label}
      </p>
      <p className="truncate font-mono text-[0.65625rem] text-muted-foreground/70" title={data.filePath ?? undefined}>
        {data.filePath ?? ""}
      </p>

      <div className="mt-1.5 flex items-center gap-2">
        <span
          className="text-[0.65625rem] tabular-nums text-muted-foreground"
          title={`Imports ${data.importCount} file${data.importCount === 1 ? "" : "s"} in this analysis; imported by ${data.dependentCount}`}
        >
          {data.importCount} in · {data.dependentCount} out
        </span>
        {data.criticalScore === null ? (
          <span className="ml-auto text-[0.65625rem] text-muted-foreground/60" title="Tests and fixtures are excluded from ranking, and only the top 500 scores per snapshot are kept">
            not ranked
          </span>
        ) : (
          <div className="ml-auto flex items-center gap-1.5" title={`Criticality ${(data.criticalScore * 100).toFixed(0)}%`}>
            <div className="h-1 w-12 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, Math.round(data.criticalScore * 100))}%`, background: color }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
