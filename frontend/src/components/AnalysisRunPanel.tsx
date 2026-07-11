import { CheckCircle2, CircleDashed, Loader2, MinusCircle, PauseCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

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
const PHASE_ORDER: Array<{ key: string; label: string }> = [
  { key: "ingest", label: "Download & inventory" },
  { key: "parse", label: "Parse code (AST)" },
  { key: "graph", label: "Build evidence graph" },
  { key: "workflows", label: "Trace workflows" },
  { key: "candidate_ranking", label: "Rank critical code" },
  { key: "clustering", label: "Cluster architecture" },
  { key: "incremental_diff", label: "Diff vs previous commit" },
  { key: "semantic_symbols", label: "AI: explain symbols" },
  { key: "synthesis", label: "AI: file → system synthesis" },
  { key: "capabilities", label: "AI: extract capabilities" },
  { key: "refinement", label: "AI: refine top items" },
  { key: "critique", label: "AI: verify claims" },
  { key: "semantic_ranking", label: "AI: blend rankings" },
  { key: "embeddings", label: "Index for retrieval" },
  { key: "generation", label: "Generate onboarding" },
  { key: "validation", label: "Validate citations" },
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

/** Pick the metrics worth a glance per phase; the full JSON stays a tooltip. */
function keyMetrics(m: Record<string, unknown>): string {
  const parts: string[] = [];
  const take = (key: string, label: string) => {
    if (typeof m[key] === "number") parts.push(`${m[key]} ${label}`);
  };
  take("files", "files");
  take("symbols", "symbols");
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
        {havePhases ? (
          <ol className="space-y-0.5">
            {PHASE_ORDER.map(({ key, label }) => {
              const p = phaseByKey.get(key);
              const status = p?.status ?? (isActive ? "pending" : "not_run");
              // Hide phases that never applied to finished runs (e.g. no
              // incremental_diff row on a first analysis).
              if (!p && !isActive) return null;
              const running = status === "running";
              return (
                <li key={key} className="flex items-center gap-2.5 py-0.5" title={p ? JSON.stringify(p.metrics) : undefined}>
                  <StatusIcon status={status} />
                  <span className={`w-44 shrink-0 text-[12px] ${running ? "font-medium text-foreground" : status === "pending" || status === "not_run" ? "text-muted-foreground/60" : "text-foreground"}`}>
                    {label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {running
                      ? currentStep ?? "working…"
                      : p?.error_message
                        ? p.error_message.slice(0, 80)
                        : p ? keyMetrics(p.metrics) : ""}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
                    {p?.started_at ? `${timeOf(p.started_at)}${p.finished_at ? ` → ${timeOf(p.finished_at)}` : "…"}` : ""}
                    {p && durationOf(p) ? ` (${durationOf(p)})` : ""}
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
                <li key={`${entry.ts}-${i}`} className="flex items-center gap-2 text-[11.5px]">
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
          <p className="py-1 text-[11.5px] text-muted-foreground">No run recorded yet for this snapshot.</p>
        )}
      </div>

      {(typeof budget.llm_calls === "number" || typeof budget.estimated_cost_usd === "number") && (
        <p className="border-t border-border/60 px-3 py-1.5 text-[11px] tabular-nums text-muted-foreground">
          Spend: {typeof budget.llm_calls === "number" ? `${budget.llm_calls} AI calls` : ""}
          {typeof budget.input_tokens === "number" ? ` · ${Number(budget.input_tokens).toLocaleString()} input tokens` : ""}
          {typeof budget.output_tokens === "number" ? ` · ${Number(budget.output_tokens).toLocaleString()} output tokens` : ""}
          {typeof budget.estimated_cost_usd === "number" ? ` · ~$${Number(budget.estimated_cost_usd).toFixed(4)}` : ""}
        </p>
      )}

      {stepLog.length > 0 && havePhases && (
        <details className="border-t border-border/60 px-3 py-1.5">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            Raw step log ({stepLog.length} entries)
          </summary>
          <div className="mt-1 border-l border-border pl-3">
            {stepLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5">
                <span className="flex-1 text-[11px] text-muted-foreground">{entry.step}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">{timeOf(entry.ts)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
