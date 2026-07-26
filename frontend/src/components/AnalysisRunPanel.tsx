import { CheckCircle2, CircleDashed, Loader2, MinusCircle, PauseCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The one panel for an analysis run: every pipeline step in order with its
 * status, start/finish times and key numbers, the live current step under
 * the running phase, and the spend line — replaces the separate live
 * activity block, "Pipeline phases & spend" accordion and step history.
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

/** Pipeline order + labels; phases the backend hasn't reached yet render as upcoming. */
const PHASE_ORDER: Array<{ key: string; label: string; desc: string }> = [
  { key: "ingest", label: "Download & inventory", desc: "Clones the repo and inventories files — nothing is sent to any AI" },
  { key: "parse", label: "Parse code (AST)", desc: "Builds a syntax tree per file to extract symbols deterministically" },
  { key: "graph", label: "Build evidence graph", desc: "Links imports, calls and dependencies into an evidence graph" },
  { key: "workflows", label: "Trace workflows", desc: "Traces end-to-end flows through the graph (routes, jobs, handlers)" },
  { key: "candidate_ranking", label: "Rank critical code", desc: "Scores files/symbols on the seven criticality signals" },
  { key: "clustering", label: "Cluster architecture", desc: "Groups modules into architecture components" },
  { key: "incremental_diff", label: "Diff vs previous commit", desc: "Compares against the previous analyzed commit to find what changed" },
  { key: "semantic_symbols", label: "AI: explain symbols", desc: "AI reads extracted facts (and code under Full AI) to explain symbols" },
  { key: "synthesis", label: "AI: file → system synthesis", desc: "AI composes file-level explanations into a system narrative" },
  { key: "capabilities", label: "AI: extract capabilities", desc: "AI names the product capabilities the code implements" },
  { key: "refinement", label: "AI: refine top items", desc: "AI rewrites the highest-ranked explanations for clarity" },
  { key: "critique", label: "AI: verify claims", desc: "AI cross-checks claims against the evidence graph" },
  { key: "semantic_ranking", label: "AI: blend rankings", desc: "Blends AI judgment into the deterministic ranking" },
  { key: "embeddings", label: "Index for retrieval", desc: "Indexes content for retrieval (OpenAI-compatible embeddings endpoint)" },
  { key: "generation", label: "Generate onboarding", desc: "Assembles the onboarding package sections" },
  { key: "validation", label: "Validate citations", desc: "Verifies every citation still points at real code" },
];

function StatusIcon({ status }: { status: string }) {
  if (status === "complete") return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-danger" />;
  if (status === "paused") return <PauseCircle className="h-3.5 w-3.5 text-warning" />;
  if (status === "skipped") return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/50" />;
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/40" />;
}

function timeOf(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}

function durationOf(p: PhaseRow): string {
  if (!p.started_at || !p.finished_at) return "";
  const secs = Math.round((new Date(p.finished_at).getTime() - new Date(p.started_at).getTime()) / 1000);
  if (secs < 1) return "<1s";
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** Ticking elapsed for the phase still running. */
function liveElapsed(startedAt: string, nowTs: number): string {
  const secs = Math.max(0, Math.round((nowTs - new Date(startedAt).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** Pick the metrics worth a glance per phase; the full JSON stays a tooltip. */
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
  return parts.slice(0, 3).join(" · ");
}

export function AnalysisRunPanel({
  projectId,
  snapshotId,
  isActive,
  currentStep,
  stepLog,
}: {
  projectId: string;
  snapshotId: string | null;
  isActive: boolean;
  currentStep: string | null;
  stepLog: StepLogEntry[];
}) {
  const [data, setData] = useState<MetricsResponse | null>(null);

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
      return;
    }
    let cancelled = false;
    const load = () => {
      apiFetch(`/projects/${projectId}/snapshots/${snapshotId}/metrics`)
        .then((d: MetricsResponse) => { if (!cancelled) setData(d); })
        .catch(() => {});
    };
    load();
    if (!isActive) return () => { cancelled = true; };
    const timer = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, snapshotId, isActive]);

  const phaseByKey = new Map((data?.phases ?? []).map((p) => [p.phase, p]));
  const havePhases = (data?.phases ?? []).length > 0;
  const budget = (data?.snapshot?.budget_usage ?? {}) as Record<string, unknown>;

  return (
    <div className="rounded-md border border-border bg-muted/25">
      <div className="px-3 py-2">
        <p className="mb-1.5 text-[0.65625rem] text-muted-foreground/70">
          Deterministic phases run first; AI phases are skipped entirely when this project's privacy mode disables them.
        </p>
        {havePhases ? (
          <ol className="space-y-0.5">
            {PHASE_ORDER.map(({ key, label, desc }) => {
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
                <li key={key} className="flex items-center gap-2.5 py-0.5" title={!errorText && p ? JSON.stringify(p.metrics) : undefined}>
                  <StatusIcon status={status} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className={`w-44 shrink-0 cursor-help text-[0.75rem] ${running ? "font-medium text-foreground" : status === "pending" || status === "not_run" ? "text-muted-foreground/60" : "text-foreground"}`}
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
                  <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground/60">
                    {p?.started_at ? `${timeOf(p.started_at)}${p.finished_at ? ` → ${timeOf(p.finished_at)}` : "…"}` : ""}
                    {p && durationOf(p) ? ` (${durationOf(p)})` : ""}
                    {running && p?.started_at && !p.finished_at ? ` (${liveElapsed(p.started_at, nowTs)})` : ""}
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
                  <span className="shrink-0 tabular-nums text-muted-foreground/60">{timeOf(entry.ts)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-1 text-[0.71875rem] text-muted-foreground">No run recorded yet for this snapshot.</p>
        )}
      </div>

      {/* These counters are the SNAPSHOT's, accumulated across every run on
          this (scope, commit) — not this run's. Budgets cap one run; the
          per-run figure lives on the run-history row. Labelling it honestly
          is the difference between "we're over budget" and "this commit has
          cost this much so far". */}
      {(typeof budget.llm_calls === "number" || typeof budget.estimated_cost_usd === "number") && (
        <p
          className="border-t border-border/60 px-3 py-1.5 text-[0.6875rem] tabular-nums text-muted-foreground"
          title="Total across every run on this snapshot. Budget caps apply per run — see the run history for this run's usage."
        >
          Lifetime spend on this snapshot: {typeof budget.llm_calls === "number" ? `${budget.llm_calls} AI calls` : ""}
          {typeof budget.input_tokens === "number" ? ` · ${Number(budget.input_tokens).toLocaleString()} input tokens` : ""}
          {typeof budget.output_tokens === "number" ? ` · ${Number(budget.output_tokens).toLocaleString()} output tokens` : ""}
          {typeof budget.estimated_cost_usd === "number" ? ` · ~$${Number(budget.estimated_cost_usd).toFixed(4)}` : ""}
        </p>
      )}

      {stepLog.length > 0 && havePhases && (
        <details className="border-t border-border/60 px-3 py-1.5">
          <summary className="cursor-pointer text-[0.6875rem] text-muted-foreground hover:text-foreground">
            Raw step log ({stepLog.length} entries)
          </summary>
          <div className="mt-1 border-l border-border pl-3">
            {stepLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5">
                <span className="flex-1 text-[0.6875rem] text-muted-foreground">{entry.step}</span>
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground/60">{timeOf(entry.ts)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
