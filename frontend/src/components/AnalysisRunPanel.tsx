import { CheckCircle2, CircleDashed, Loader2, MinusCircle, PauseCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PHASE_ORDER } from "@/lib/pipelinePhases";

/**
 * The one panel for an analysis run: every pipeline step in order with its
 * status, start/finish times and key numbers, and the live current step under
 * the running phase — replaces the separate live activity block, "Pipeline
 * phases & spend" accordion and step history.
 *
 * Spend is deliberately absent: this panel is scoped to a SNAPSHOT, so any
 * total it showed was every run's, sitting inside one run's row. Per-run cost
 * belongs to the run-history row, the project total to Project Settings.
 */

interface PhaseRow {
  phase: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  metrics: Record<string, unknown>;
}

interface MetricsResponse {
  snapshot: { budget_usage?: Record<string, unknown> } & Record<string, unknown>;
  phases: PhaseRow[];
}

interface StepLogEntry {
  step: string;
  pct: number;
  ts: string;
}

/** The canonical phase list lives in lib/pipelinePhases (public pages import
 *  it too, plus per-phase AI flags); re-exported so a partial run's own step
 *  list and existing importers keep naming steps identically. */
export { PHASE_ORDER };

function statusGlyph(status: string) {
  if (status === "complete") return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-info" aria-hidden="true" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden="true" />;
  if (status === "paused") return <PauseCircle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />;
  if (status === "skipped") return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />;
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/40" aria-hidden="true" />;
}

const STATUS_WORDS: Record<string, string> = {
  complete: "complete",
  running: "running",
  failed: "failed",
  paused: "paused",
  skipped: "skipped",
};

/**
 * A phase's status, said as well as drawn. The word rides along sr-only so the row
 * stays pixel-identical, and the glyph is aria-hidden so it is announced once.
 */
export function StatusIcon({ status }: { status: string }) {
  return (
    <>
      {statusGlyph(status)}
      <span className="sr-only">{STATUS_WORDS[status] ?? "not started"}</span>
    </>
  );
}

function timeOf(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}

function durationOf(p: PhaseRow): string {
  if (!p.started_at || !p.finished_at) return "";
  return formatDuration(new Date(p.finished_at).getTime() - new Date(p.started_at).getTime());
}

/**
 * Pick the metrics worth a glance per phase. This list is the whole contract:
 * anything not named here stays in the DB only — a raw-JSON tooltip is not a
 * UI, and hovering a phase row used to dump the entire metrics object
 * (internal ids, nested objects, `[object Object]`) at the reader.
 */
function keyMetrics(m: Record<string, unknown>): string {
  const parts: string[] = [];
  const take = (key: string, label: string) => {
    if (typeof m[key] === "number") parts.push(`${m[key]} ${label}`);
  };
  take("files", "files");
  take("symbols", "symbols");
  // Incremental diff outcome: without these the diff row was blank and a
  // "nothing went stale" run looked like nothing happened at all.
  take("filesChanged", "files changed");
  take("symbolsChanged", "symbols changed");
  take("staleSections", "sections stale");
  take("staleTutorials", "tutorials stale");
  take("stalePackages", "packages stale");
  take("nodes", "nodes");
  take("edges", "edges");
  take("workflows", "workflows");
  take("clusters", "clusters");
  take("llmRecords", "AI records");
  take("llmCalls", "AI calls");
  take("cacheHits", "cache hits");
  take("fileRecords", "file records");
  take("sections", "sections");
  take("embedded", "embeddings");
  take("invalidatedRecords", "invalidated");
  if (typeof m.estimatedCostUsd === "number" && m.estimatedCostUsd > 0) {
    parts.push(`$${(m.estimatedCostUsd as number).toFixed(4)}`);
  }
  if (typeof m.reason === "string") parts.push(String(m.reason).replace(/_/g, " "));
  // Five, not three: the incremental diff row alone can carry files changed,
  // symbols changed and three staleness counts, and a cap of three dropped the
  // staleness numbers — the one thing that row exists to report.
  return parts.slice(0, 5).join(" · ");
}

export function AnalysisRunPanel({
  projectId,
  snapshotId,
  isActive,
  currentStep,
  stepLog,
  phaseKeys,
}: {
  projectId: string;
  snapshotId: string | null;
  isActive: boolean;
  currentStep: string | null;
  stepLog: StepLogEntry[];
  /**
   * The phases this run is actually accountable for; omit for all of them. The
   * phase rows belong to the SNAPSHOT, so a standalone package generation shown
   * the full list was being credited with the analysis that built its snapshot
   * — someone else's work, in its row.
   */
  phaseKeys?: string[];
}) {
  const [data, setData] = useState<MetricsResponse | null>(null);
  // A failed metrics fetch must not fall through to the "no phases recorded"
  // copy below: that line is a claim about the run, not about the request.
  const [metricsError, setMetricsError] = useState(false);

  // Ticking clock for the running phase's live elapsed time — a frozen
  // "22:48:59…" gave no clue whether anything was still happening.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!isActive) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isActive]);

  useEffect(() => {
    if (!snapshotId) {
      setData(null);
      setMetricsError(false);
      return;
    }
    let cancelled = false;
    const load = () => {
      apiFetch(`/projects/${projectId}/snapshots/${snapshotId}/metrics`)
        .then((d: MetricsResponse) => { if (!cancelled) { setData(d); setMetricsError(false); } })
        .catch(() => { if (!cancelled) setMetricsError(true); });
    };
    load();
    if (!isActive) return () => { cancelled = true; };
    const timer = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, snapshotId, isActive]);

  const phaseByKey = new Map((data?.phases ?? []).map((p) => [p.phase, p]));
  const shownPhases = phaseKeys ? PHASE_ORDER.filter((p) => phaseKeys.includes(p.key)) : PHASE_ORDER;
  // Counted over the SHOWN phases: a filtered panel whose own phases never ran
  // would otherwise render an empty list instead of saying so.
  const havePhases = shownPhases.some((p) => phaseByKey.has(p.key));

  return (
    <div className="rounded-md border border-border bg-muted/25">
      <div className="px-3 py-2">
        <p className="mb-1.5 text-[0.65625rem] text-muted-foreground">
          Deterministic phases run first; AI phases are skipped entirely when this project's privacy mode disables them.
        </p>
        {havePhases ? (
          <ol className="space-y-0.5">
            {shownPhases.map(({ key, label, desc }) => {
              const p = phaseByKey.get(key);
              const status = p?.status ?? (isActive ? "pending" : "not_run");
              // Hide phases that never applied to finished runs (e.g. no
              // incremental_diff row on a first analysis).
              if (!p && !isActive) return null;
              const running = status === "running";
              const errorText = !running ? (p?.error_message ?? null) : null;
              const summaryText = running
                ? currentStep ?? "working…"
                : errorText
                  ? errorText
                  : p ? keyMetrics(p.metrics) : "";
              return (
                <li key={key} className="flex items-center gap-2.5 py-0.5">
                  <StatusIcon status={status} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className={`w-44 shrink-0 cursor-help text-[0.75rem] ${running ? "font-medium text-foreground" : status === "pending" || status === "not_run" ? "text-muted-foreground" : "text-foreground"}`}
                      >
                        {label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-left">{desc}</TooltipContent>
                  </Tooltip>
                  {errorText ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} className="min-w-0 flex-1 cursor-help truncate text-[0.6875rem] text-muted-foreground">
                          {summaryText}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-sm text-left whitespace-pre-wrap">
                        {errorText}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground">
                      {summaryText}
                    </span>
                  )}
                  <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">
                    {p?.started_at ? `${timeOf(p.started_at)}${p.finished_at ? ` → ${timeOf(p.finished_at)}` : "…"}` : ""}
                    {p && durationOf(p) ? ` (${durationOf(p)})` : ""}
                    {running && p?.started_at && !p.finished_at ? ` (${formatDuration(nowTs - new Date(p.started_at).getTime())})` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : isActive && stepLog.length > 0 ? (
          // The snapshot row doesn't exist yet this early in the run — show
          // the job's own step trail so the bar is never a mystery.
          <ol className="space-y-1">
            {stepLog.slice(-5).map((entry, i, shown) => {
              const isCurrent = i === shown.length - 1;
              return (
                <li key={`${entry.ts}-${i}`} className="flex items-center gap-2 text-[0.71875rem]">
                  {isCurrent
                    ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                    : <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />}
                  <span className={isCurrent ? "flex-1 font-medium text-foreground" : "flex-1 text-muted-foreground"}>{entry.step}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(entry.ts)}</span>
                </li>
              );
            })}
          </ol>
        ) : metricsError ? (
          <p className="py-1 text-[0.71875rem] text-muted-foreground">
            Couldn't fetch this run's pipeline phases. This is a failed request, not a run without phases.
          </p>
        ) : (
          <p className="py-1 text-[0.71875rem] text-muted-foreground">No pipeline phases recorded for this run yet.</p>
        )}
      </div>

      {stepLog.length > 0 && havePhases && (
        <details className="border-t border-border/60 px-3 py-1.5">
          <summary className="cursor-pointer text-[0.6875rem] text-muted-foreground hover:text-foreground">
            Raw step log ({stepLog.length} entries)
          </summary>
          <div className="mt-1 border-l border-border pl-3">
            {stepLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5">
                <span className="flex-1 text-[0.6875rem] text-muted-foreground">{entry.step}</span>
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">{timeOf(entry.ts)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
