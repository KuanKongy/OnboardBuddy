import { Unlink } from "lucide-react";
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
 * Open button in the details panel beside the canvas opens (owner I1: "You may
 * add the button, to allow drilling down, it shouldn't by default"). The button
 * used to be on the card too, which put the same action in two places and cost
 * the card a row of its 240px width; the panel is where the reader already is
 * once they have chosen a component.
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
        {/* Clamped, not truncated: sibling labels share long prefixes, so one line
            clips them all to the same string. */}
        <span className="min-w-0 flex-1 line-clamp-2 break-words text-[0.8125rem] font-semibold leading-tight text-foreground">
          {data.label}
        </span>
        {/* The tint carries the category, not the 10px text: the node hue on its own
            14% tint measures below AA at this size. */}
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-foreground"
          style={{ background: `color-mix(in oklab, ${color} 14%, transparent)` }}
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
          <span className="inline-flex items-center gap-1 text-[0.625rem] text-muted-foreground">
            <Unlink className="h-2.5 w-2.5" />
            no links traced
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {/* The empty part of the bar is the reading: without a boundary, a 12%
              score is a stub floating in the card and there is nothing to read it
              against. --input is the token engineered to clear 3.0:1 as a control
              boundary in both themes, which is exactly what this track needs. */}
          <span className="h-1.5 w-10 overflow-hidden rounded-full border border-input bg-muted">
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
  /**
   * What this file does, from its stored file record. Null where the analyzer
   * wrote none, and then nothing takes its place: the drilled canvas used to
   * be a grid of paths and numbers, and a made-up sentence would be worse than
   * the path on its own.
   */
  summary?: string | null;
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

      <p className="line-clamp-2 break-words text-[0.8125rem] font-medium leading-tight text-foreground">{data.label}</p>
      <p className="truncate font-mono text-[0.65625rem] text-muted-foreground">
        {data.filePath ?? " "}
      </p>
      {data.summary && (
        <p className="mt-1 line-clamp-2 text-[0.6875rem] leading-snug text-foreground/80">{data.summary}</p>
      )}

      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[0.65625rem] tabular-nums text-muted-foreground">
          {data.importCount} in · {data.dependentCount} out
        </span>
        {data.criticalScore === null ? (
          <span className="ml-auto text-[0.65625rem] text-muted-foreground">not ranked</span>
        ) : (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="h-1.5 w-8 overflow-hidden rounded-full border border-input bg-muted">
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
