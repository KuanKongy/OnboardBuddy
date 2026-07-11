import { CheckCircle2, ChevronDown, CircleDashed, Loader2, PauseCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

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

function StatusIcon({ status }: { status: string }) {
  if (status === "complete") return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-danger" />;
  if (status === "paused") return <PauseCircle className="h-3.5 w-3.5 text-warning" />;
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/50" />;
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
  take("llmCalls", "AI calls");
  take("cacheHits", "cache hits");
  take("records", "records");
  take("sections", "sections");
  take("embedded", "embeddings");
  take("invalidatedRecords", "invalidated");
  if (typeof m.estimatedCostUsd === "number" && m.estimatedCostUsd > 0) {
    parts.push(`$${(m.estimatedCostUsd as number).toFixed(4)}`);
  }
  if (typeof m.reason === "string") parts.push(String(m.reason).replace(/_/g, " "));
  return parts.slice(0, 4).join(" · ");
}

/**
 * Per-phase pipeline metrics + budget spend for a snapshot — the analysis
 * status made transparent instead of a spinner.
 */
export function PhaseMetricsPanel({ projectId, snapshotId }: { projectId: string; snapshotId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MetricsResponse | null>(null);

  useEffect(() => {
    if (!open || data) return;
    apiFetch(`/projects/${projectId}/snapshots/${snapshotId}/metrics`)
      .then(setData)
      .catch(() => setData(null));
  }, [open, projectId, snapshotId, data]);

  const budget = (data?.snapshot?.budget_usage ?? {}) as Record<string, unknown>;

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
        Pipeline phases & spend
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          {!data ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border/60">
                {data.phases.map((p) => (
                  <li key={p.phase} className="flex items-center gap-2.5 py-1.5" title={JSON.stringify(p.metrics)}>
                    <StatusIcon status={p.status} />
                    <span className="w-36 shrink-0 text-[12px] text-foreground">{p.phase.replace(/_/g, " ")}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-muted-foreground">
                      {p.error_message ? p.error_message.slice(0, 80) : keyMetrics(p.metrics)}
                    </span>
                  </li>
                ))}
              </ul>
              {(typeof budget.llm_calls === "number" || typeof budget.estimated_cost_usd === "number") && (
                <p className="mt-2 border-t border-border/60 pt-2 text-[11px] tabular-nums text-muted-foreground">
                  Budget used: {typeof budget.llm_calls === "number" ? `${budget.llm_calls} AI calls` : ""}
                  {typeof budget.input_tokens === "number" ? ` · ${Number(budget.input_tokens).toLocaleString()} input tokens` : ""}
                  {typeof budget.estimated_cost_usd === "number" ? ` · ~$${Number(budget.estimated_cost_usd).toFixed(4)}` : ""}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
