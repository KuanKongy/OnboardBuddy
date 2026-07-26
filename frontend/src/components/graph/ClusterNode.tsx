import { ChevronRight, Unlink } from "lucide-react";
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
  /** Architecture edges touching this component; 0 means it is drawn alone. */
  degree: number;
  /**
   * What this component is responsible for. NOT the old `summary`, which read
   * "Auth services: 9 files, 40 symbols" — an inventory rendered directly under
   * a heading that already said "Auth services" and beside a chip that already
   * said "9 files".
   */
  responsibility: string;
  selected: boolean;
  dimmed: boolean;
  /** Opens the component. Explicit, never on a plain card click — owner I1. */
  onOpen: () => void;
}

/**
 * Architecture component: kind-colored stripe + chip, what it is for, its size,
 * and a LABELLED criticality figure.
 *
 * NO TOOLTIPS on this card. Owner D3/E2/H1 — a tooltip must add information the
 * screen does not already show, and every popup here restated the title, the
 * responsibility line under it, or the count chip beside it. The one tooltip
 * that did carry something (the criticality percentage, and the derivation of
 * the count) is replaced by printing the percentage: UX §17.4 already recorded
 * that an unlabelled 30×3px bar next to a file count reads as a proportion OF
 * that count, so the label is the fix that finding asked for, not a loss.
 *
 * The card is a door, but it does not open itself: clicking selects, and the
 * "Open" button opens (owner I1: "You may add the button, to allow drilling
 * down, it shouldn't by default").
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
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-foreground">
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
        <p className="mt-1 line-clamp-3 px-3 text-[0.71875rem] leading-snug text-muted-foreground">
          {data.responsibility}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 border-t border-border/60 px-3 py-1.5">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-muted-foreground">
          {data.count} {data.noun}{data.count === 1 ? "" : "s"}
        </span>
        {/* AUDIT C7 / SC F11: 17 of 76 components are drawn with no edge at
            all, and an unexplained island reads as a rendering fault. */}
        {data.degree === 0 && (
          <span className="inline-flex items-center gap-1 text-[0.625rem] text-muted-foreground/70">
            <Unlink className="h-2.5 w-2.5" />
            no links traced
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.min(100, Math.round(data.criticalScore * 100))}%`, background: color }}
            />
          </span>
          <span className="text-[0.625rem] tabular-nums text-muted-foreground">
            crit {(data.criticalScore * 100).toFixed(0)}
          </span>
        </span>
      </div>

      <div className="border-t border-border/60 px-3 py-1.5">
        <button
          type="button"
          className="nodrag inline-flex w-full items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-[0.6875rem] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={`Open ${data.label} and list its ${data.count} ${data.noun}${data.count === 1 ? "" : "s"}`}
          onClick={(e) => {
            // The canvas would otherwise treat this as a plain node click and
            // select the card instead of opening it.
            e.stopPropagation();
            data.onOpen();
          }}
        >
          Open {data.count} {data.noun}{data.count === 1 ? "" : "s"}
          <ChevronRight className="h-3 w-3" />
        </button>
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
 *
 * No tooltips (owner D3/E2/H1) — the two that carried real information (the
 * criticality number, and why a member is unranked) are printed instead.
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

      <p className="truncate text-[0.8125rem] font-medium text-foreground">{data.label}</p>
      <p className="truncate font-mono text-[0.65625rem] text-muted-foreground/70">
        {data.filePath ?? " "}
      </p>

      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[0.65625rem] tabular-nums text-muted-foreground">
          {data.importCount} in · {data.dependentCount} out
        </span>
        {data.criticalScore === null ? (
          <span className="ml-auto text-[0.65625rem] text-muted-foreground/60">not ranked</span>
        ) : (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="h-1 w-8 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.min(100, Math.round(data.criticalScore * 100))}%`, background: color }}
              />
            </span>
            <span className="text-[0.625rem] tabular-nums text-muted-foreground">
              crit {(data.criticalScore * 100).toFixed(0)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
