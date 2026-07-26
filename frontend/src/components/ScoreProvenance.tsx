import { AlertTriangle, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * One term of a score — a ranking signal, or a member of an averaged
 * component. Weights and values are served by the API; the numbers below are
 * never computed here, because a second copy of the weight table in the
 * frontend is a copy that will eventually disagree with the ranker.
 */
export interface ScoreProvenanceInput {
  key: string;
  label: string;
  /** Share of the formula, 0–1. Null when terms are equally weighted (a mean). */
  weight: number | null;
  /** This term's own value, 0–1. Null when the payload is the weight table itself. */
  value: number | null;
  /** Points of the final score this term supplied. */
  contribution: number | null;
  /** The real measurement behind the value, in words ("in 3 traced workflows"). */
  measured: string | null;
}

export type ScoreProvenanceData =
  | {
      available: true;
      method: "weighted_signals" | "member_mean" | "weight_table";
      label: string;
      score: number | null;
      formula: string;
      inputs: ScoreProvenanceInput[];
      reasons: string[];
      lever: string;
      scaleNote: string;
      caveat: string | null;
    }
  | {
      available: false;
      label: string;
      score: number | null;
      reason: string;
    };

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** Points out of 100, without a trailing ".0" on the round ones. */
function points(value: number): string {
  const p = Math.round(value * 1000) / 10;
  return p % 1 === 0 ? p.toFixed(0) : p.toFixed(1);
}

/** How many terms a tooltip lists before collapsing the rest to a count. */
const TOOLTIP_INPUTS = 4;

/**
 * Why a score is the number it is: the formula, the inputs with their real
 * values and weights, and the one change that would move it.
 *
 * This exists because every score in the product used to ship as a bare
 * percentage with a single hand-written tooltip attached to all of them — a
 * sentence that named seven signals belonging to a ranking phase that produces
 * none of the numbers it was attached to. A reader could not tell whether 42%
 * meant "this is unimportant" or "this is an average of thirty files".
 *
 * The one rule this component exists to enforce: when the API returns no
 * derivation, it says so. It never fills the gap with a plausible-looking
 * breakdown, because the whole value of the panel is that a reader can decide
 * when to trust the number.
 */
export function ScoreProvenance({
  data,
  variant = "panel",
  showReasons = true,
  className,
}: {
  /** Null/undefined is treated exactly like an unavailable derivation. */
  data: ScoreProvenanceData | null | undefined;
  variant?: "panel" | "tooltip";
  /** Off where the host already prints the same stored reasons beside it. */
  showReasons?: boolean;
  className?: string;
}) {
  const compact = variant === "tooltip";
  const text = compact ? "text-[0.6875rem]" : "text-[0.71875rem]";

  if (!data || !data.available) {
    return (
      <div className={cn("space-y-1", text, className)}>
        <p className="flex items-start gap-1.5 font-medium">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          How this number was derived is unavailable
        </p>
        <p className={compact ? "opacity-80" : "text-muted-foreground"}>
          {data?.reason ??
            "This score arrived without its derivation, so it cannot be broken down here."}
        </p>
      </div>
    );
  }

  const visible = compact ? data.inputs.slice(0, TOOLTIP_INPUTS) : data.inputs;
  const hiddenCount = data.inputs.length - visible.length;
  // Bars are relative to the biggest contributor, not to 100: at real weights
  // the top signal is worth 20 points, so a 0–100 bar renders every row as an
  // identical sliver and shows nothing.
  const maxContribution = Math.max(
    ...data.inputs.map((i) => i.contribution ?? i.weight ?? 0),
    0.0001,
  );
  const zeroCount = data.inputs.filter((i) => (i.contribution ?? 1) === 0).length;

  return (
    <div className={cn("space-y-1.5", text, className)}>
      <p className={cn("font-medium", compact ? "" : "text-foreground")}>{data.formula}</p>

      <ul className="space-y-0.5">
        {visible.map((input) => {
          const share = input.contribution ?? input.weight ?? 0;
          const spent = (input.contribution ?? 0) > 0;
          return (
            <li key={input.key} className={cn("flex items-baseline gap-2", !spent && !compact && "opacity-55")}>
              <span className="min-w-0 flex-1">
                <span className={compact ? "" : "text-foreground"}>{input.label}</span>
                {input.measured && (
                  <span className={cn("ml-1", compact ? "opacity-70" : "text-muted-foreground")}>
                    — {input.measured}
                  </span>
                )}
              </span>
              {!compact && (
                <span className="h-1 w-10 shrink-0 self-center overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((share / maxContribution) * 100)}%` }}
                  />
                </span>
              )}
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  compact ? "opacity-70" : "text-muted-foreground",
                )}
              >
                {input.weight !== null && input.value === null
                  ? `${pct(input.weight)} weight`
                  : input.weight !== null
                    ? `${pct(input.value ?? 0)} × ${pct(input.weight)} → ${points(input.contribution ?? 0)} pts`
                    : `score ${points(input.value ?? 0)} → ${points(input.contribution ?? 0)} pts`}
              </span>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 && (
        <p className={compact ? "opacity-70" : "text-muted-foreground"}>
          + {hiddenCount} more {data.method === "member_mean" ? "member" : "signal"}
          {hiddenCount === 1 ? "" : "s"}
          {zeroCount > 0 && data.method !== "member_mean" ? `, ${zeroCount} of them scoring 0` : ""}
        </p>
      )}
      {!compact && hiddenCount === 0 && zeroCount > 0 && data.method === "weighted_signals" && (
        <p className="text-muted-foreground">
          {zeroCount} of {data.inputs.length} signals contributed nothing.
        </p>
      )}

      {data.caveat && (
        <p className={cn("flex items-start gap-1.5", compact ? "opacity-90" : "text-warning")}>
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{data.caveat}</span>
        </p>
      )}

      {!compact && showReasons && data.reasons.length > 0 && (
        <ul className="space-y-0.5">
          {data.reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-success" />
              <span className="text-muted-foreground">{reason}</span>
            </li>
          ))}
        </ul>
      )}

      <p className={compact ? "" : "text-foreground"}>{data.lever}</p>
      <p className={compact ? "opacity-70" : "text-muted-foreground/80"}>{data.scaleNote}</p>
    </div>
  );
}

/**
 * The compact form, on the Info affordance every score already had. Replaces
 * the one static string those tooltips all shared, so the explanation beside a
 * number is now the explanation OF that number.
 */
export function ScoreProvenanceInfo({
  data,
  side = "top",
  label = "How this score was derived",
}: {
  data: ScoreProvenanceData | null | undefined;
  side?: "top" | "bottom" | "left" | "right";
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={label}
          className="inline-flex cursor-help text-muted-foreground/60 hover:text-muted-foreground"
        >
          <Info className="h-3 w-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-sm text-left">
        <ScoreProvenance data={data} variant="tooltip" />
      </TooltipContent>
    </Tooltip>
  );
}
