import { AlertTriangle, ChevronDown, HelpCircle } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { SourceMark } from "@/components/reader/SourceMark";
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

/**
 * How many MEMBERS a tooltip lists before collapsing the rest to a count.
 *
 * Signal methods (`weighted_signals`, `weight_table`) are deliberately not
 * capped: the ranker has 9 signals, 9 rows fit inside `max-w-sm`, and capping
 * them printed "+ 5 more signals, 2 of them scoring 0" under a list a reader
 * could not expand — a tooltip cannot hold a control, because tooltip content
 * and its Radix popper wrapper are `pointer-events: none` app-wide (see
 * `components/ui/tooltip.interactive.test.tsx`). So the count named signals and
 * then hid them. A member list has no such bound — a component can average
 * hundreds of files — so members keep the cap, and "+ N more" now only ever
 * appears where there is a panel behind it to open.
 */
const TOOLTIP_MEMBERS = 4;

/**
 * How many terms the first, unasked-for level of detail lists.
 *
 * Owner J1: "too much info, structure it and show only if user asks." Even
 * behind a button, a fifteen-row weight table is a wall. The first thing a
 * reader sees is now the formula, the one signal that actually moved the
 * number, and the top three terms — everything else is one more click.
 */
const HEADLINE_INPUTS = 3;

/** The one signal that moved the score most, as a sentence. */
function leadReason(data: Extract<ScoreProvenanceData, { available: true }>): string | null {
  const spent = data.inputs.filter((i) => (i.contribution ?? 0) > 0);
  if (spent.length === 0) return null;
  const top = spent.reduce((a, b) => ((b.contribution ?? 0) > (a.contribution ?? 0) ? b : a));
  const share = data.score && data.score > 0 ? (top.contribution ?? 0) / data.score : 0;
  const lead = data.method === "member_mean" ? "Pulled up most by" : "Mostly from";
  return [
    `${lead} ${top.label}`,
    top.measured ? ` (${top.measured})` : "",
    `: ${points(top.contribution ?? 0)} of ${points(data.score ?? 0)} points`,
    share > 0 ? `, ${Math.round(share * 100)}% of the score` : "",
    ".",
  ].join("");
}

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
  showCaveat = true,
  detail = "full",
  className,
}: {
  /** Null/undefined is treated exactly like an unavailable derivation. */
  data: ScoreProvenanceData | null | undefined;
  variant?: "panel" | "tooltip";
  /** Off where the host already prints the same stored reasons beside it. */
  showReasons?: boolean;
  /**
   * Off where the caveat is an internal reconciliation note rather than
   * something a reader of THIS surface needs.
   *
   * Two of them are: "Averaging the 4 member scores stored here gives 29.1,
   * not 15.2 — the stored number was averaged over all 61 members…" and "2 of
   * the 9 signals describe a file's position in the import graph…". Both are
   * true, both were written for whoever is auditing the ranker, and both
   * appeared in amber on a reading surface, above the diagram, on every flow.
   * The payload still carries them — this only decides whether a given host
   * prints one.
   */
  showCaveat?: boolean;
  /**
   * `headline` is the first thing a reader gets after asking: the formula, the
   * signal that moved the number, and the top three terms. `full` adds the
   * remaining terms, the stored reasons, the lever and the scale note.
   */
  detail?: "headline" | "full";
  className?: string;
}) {
  const compact = variant === "tooltip";
  const brief = detail === "headline";
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

  // Headline order is "what mattered most", not the stored signal order — a
  // reader asking "why this number" is asking which term carried it.
  const ranked = brief
    ? [...data.inputs].sort((a, b) => (b.contribution ?? b.weight ?? 0) - (a.contribution ?? a.weight ?? 0))
    : data.inputs;
  const visible = brief
    ? ranked.slice(0, HEADLINE_INPUTS)
    : compact && data.method === "member_mean"
      ? ranked.slice(0, TOOLTIP_MEMBERS)
      : ranked;
  const hiddenCount = data.inputs.length - visible.length;
  const lead = brief ? leadReason(data) : null;
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
      {lead && <p className={compact ? "opacity-80" : "text-muted-foreground"}>{lead}</p>}

      <ul className="space-y-0.5">
        {visible.map((input) => {
          const share = input.contribution ?? input.weight ?? 0;
          const spent = (input.contribution ?? 0) > 0;
          return (
            <li key={input.key} className={cn("flex items-center gap-2", !spent && !compact && "opacity-55")}>
              {/* One line, clipped: a `member_mean` row's `measured` is a full
                  repo path, and untruncated it painted straight over the bar
                  and the points on the right. The label comes first, so what
                  ellipsis eats is the path — `title` keeps it readable. */}
              <span
                className="min-w-0 flex-1 truncate"
                title={input.measured ? `${input.label} (${input.measured})` : input.label}
              >
                <span className={compact ? "" : "text-foreground"}>{input.label}</span>
                {input.measured && (
                  <span className={cn("ml-1", compact ? "opacity-70" : "text-muted-foreground")}>
                    ({input.measured})
                  </span>
                )}
              </span>
              {!compact && (
                <span className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full border border-input bg-muted">
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
      {!compact && !brief && hiddenCount === 0 && zeroCount > 0 && data.method === "weighted_signals" && (
        <p className="text-muted-foreground">
          {zeroCount} of {data.inputs.length} signals contributed nothing.
        </p>
      )}

      {data.caveat && showCaveat && (
        <p className={cn("flex items-start gap-1.5", compact ? "opacity-90" : "text-warning")}>
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{data.caveat}</span>
        </p>
      )}

      {!compact && !brief && showReasons && data.reasons.length > 0 && (
        <ul className="space-y-0.5">
          {data.reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-success" />
              <span className="text-muted-foreground">{reason}</span>
            </li>
          ))}
        </ul>
      )}

      {!brief && (
        <>
          <p className={compact ? "" : "text-foreground"}>{data.lever}</p>
          <p className={compact ? "opacity-70" : "text-muted-foreground/80"}>{data.scaleNote}</p>
        </>
      )}
    </div>
  );
}

/**
 * A score, with its derivation behind an explicit control.
 *
 * Owner B1: "maybe you should have a button next to criticality that would
 * explain how it got its result, rather than always showing it always" — the
 * derivation used to be an always-open block under every score, plus a hover
 * `ⓘ` saying the same thing twice. Owner J1 then asked for the CONTENT to be
 * staged too, so the first press gives the formula, the signal that carried
 * the number and the top three terms; the rest is one more press.
 *
 * The control is a real `<button>` with `aria-expanded`/`aria-controls`, so it
 * is reachable and announced — the `ⓘ` it replaces was a `tabIndex={0}` span
 * whose only content lived in a hover tooltip.
 */
export function ScoreProvenanceDisclosure({
  data,
  sectionLabel,
  buttonLabel,
  headline,
  extra,
  showCaveat = true,
  className,
}: {
  data: ScoreProvenanceData | null | undefined;
  /** Section heading beside the button ("Criticality", "Importance"). */
  sectionLabel: string;
  /** Accessible name for the button — must name the score it explains. */
  buttonLabel: string;
  /** The number itself, rendered by the host under the heading row. */
  headline?: ReactNode;
  /** Optional trailing control on the heading row. */
  extra?: ReactNode;
  /**
   * Forwarded to `ScoreProvenance` — see its `showCaveat`. A disclosure is one
   * press away from any reader, so "behind a control" is not the same as "not
   * shown to readers": VISUAL QA M4 #7 found the top-500 reconciliation note
   * ("Averaging the 16 member scores stored here gives 35.9, not 29.6 … only
   * scores inside the snapshot's top 500 are kept") rendered in amber under
   * Architecture → Explain on the flagship repo, and it fires wherever the cap
   * truncates members — i.e. on exactly the big repos. Reader surfaces pass
   * `false`; the API payload is untouched and still carries `caveat`.
   */
  showCaveat?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const panelId = useId();

  return (
    <div className={className}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <p className="section-label">{sectionLabel}</p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={buttonLabel}
          onClick={() => {
            setOpen((v) => !v);
            if (open) setShowAll(false);
          }}
          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <HelpCircle className="h-3 w-3" />
          Explain
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </button>
        {extra}
      </div>
      {headline}
      {open && (
        <div id={panelId} className="mt-2 rounded-md border border-border bg-muted/30 px-2.5 py-2">
          {/* Outside `ScoreProvenance` on purpose: the panel is the only place
              this needs saying, and the component is also rendered inside
              tooltips where a hover target cannot be reached. Sits above the
              formula rather than beside it so it never lands mid-equation. */}
          <div className="mb-1.5">
            <SourceMark source="code" tip="Arithmetic over traced signals. No model involved." />
          </div>
          <ScoreProvenance
            data={data}
            detail={showAll ? "full" : "headline"}
            showReasons={false}
            showCaveat={showCaveat}
          />
          {data?.available && (data.inputs.length > HEADLINE_INPUTS || !showAll) && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-1.5 text-[0.6875rem] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {showAll
                ? "Show less"
                : `Show the full breakdown (${data.inputs.length} ${data.method === "member_mean" ? "member" : "signal"}${data.inputs.length === 1 ? "" : "s"})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
