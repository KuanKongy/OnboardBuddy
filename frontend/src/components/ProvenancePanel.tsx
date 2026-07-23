import { AlertTriangle, FlaskConical, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import type { PackageProvenance } from "@/types/onboarding";
import { cn } from "@/lib/utils";

function confidenceStyle(c: string) {
  return c === "high"
    ? "border-success/40 bg-success-soft text-success"
    : c === "medium"
      ? "border-warning/40 bg-warning-soft text-warning"
      : "border-danger/40 bg-danger-soft text-danger";
}

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * "How this was made" (audit P2 §13): the package's full production record —
 * models, calls, cost, retrieval stats, validation flags, voice-lint
 * residuals. Everything shown is the stored audit trail; nothing is
 * recomputed or summarized by a model.
 */
export function ProvenancePanel({
  projectId,
  packageId,
  open,
  onClose,
}: {
  projectId: string;
  packageId?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<PackageProvenance | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError("");
    const qs = packageId ? `?package_id=${encodeURIComponent(packageId)}` : "";
    apiFetch(`/projects/${projectId}/onboarding/provenance${qs}`)
      .then((d: PackageProvenance) => setData(d))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load provenance"));
  }, [open, projectId, packageId]);

  const totals = data?.models.reduce(
    (acc, m) => ({
      calls: acc.calls + m.calls,
      cached: acc.cached + m.cachedCalls,
      cost: acc.cost + m.costUsd,
    }),
    { calls: 0, cached: 0, cost: 0 },
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4 pr-10 text-left">
          <DialogTitle className="flex items-center gap-2 text-[0.875rem] font-semibold">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            How this package was made
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            The stored audit trail for this exact package — models, calls, validation. Nothing here is generated.
          </p>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          {!data && !error && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          )}

          {data && (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="font-mono">{data.package.branch}@{data.package.analyzedCommit.slice(0, 7)}</span>
                <span className="capitalize">{data.package.role} role</span>
                <span>depth: {data.package.semanticDepth}</span>
                <span>privacy: {data.package.privacyMode.replace(/_/g, " ")}</span>
                <span>{new Date(data.package.generatedAt).toLocaleString()}</span>
              </div>

              <div className="rounded-lg border">
                <div className="flex items-baseline justify-between border-b px-3 py-2">
                  <p className="text-xs font-medium text-foreground">Models & spend</p>
                  {totals && (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {totals.calls} calls{totals.cached > 0 ? ` (+${totals.cached} cached)` : ""} · ${totals.cost.toFixed(4)}
                    </p>
                  )}
                </div>
                <div className="divide-y">
                  {data.models.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      No LLM calls recorded — this package was built deterministically.
                    </p>
                  )}
                  {data.models.map((m, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs">
                      <span className="font-mono text-foreground">{m.model}</span>
                      {m.tier && <Badge variant="outline" className="text-[0.625rem]">{m.tier}</Badge>}
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        {m.calls} calls{m.cachedCalls > 0 ? ` (+${m.cachedCalls} cached)` : ""}
                        {m.failedCalls > 0 ? ` · ${m.failedCalls} failed` : ""} · {fmtTokens(m.inputTokens)} in / {fmtTokens(m.outputTokens)} out · ${m.costUsd.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border">
                <div className="border-b px-3 py-2">
                  <p className="text-xs font-medium text-foreground">Per-section generation record</p>
                </div>
                <div className="divide-y">
                  {data.sections.map((s) => (
                    <div key={s.sectionId} className="space-y-1 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{s.title}</span>
                        <Badge variant="outline" className={cn("text-[0.625rem] capitalize", confidenceStyle(s.confidence))}>
                          {s.confidence}
                        </Badge>
                        {s.promptVersion && (
                          <span className="font-mono text-[0.625rem] text-muted-foreground/70">{s.promptVersion}</span>
                        )}
                        <span className="ml-auto text-[0.6875rem] tabular-nums text-muted-foreground">
                          {s.receiptCount} receipts · {s.claims.cited}/{s.claims.total} claims cited
                          {s.claims.low > 0 ? ` · ${s.claims.low} low` : ""}
                        </span>
                      </div>
                      <p className="text-[0.6875rem] text-muted-foreground">{s.confidenceReason}</p>
                      {s.retrieval && (
                        <p className="text-[0.6875rem] text-muted-foreground/70">
                          retrieval: {s.retrieval.seeds ?? "?"} seeds → {s.retrieval.candidates ?? "?"} candidates → {s.retrieval.selected ?? "?"} selected
                          {s.retrieval.views?.length ? ` (${s.retrieval.views.join(", ")})` : ""}
                          {s.validation.retried ? " · retried once with a stricter prompt" : ""}
                        </p>
                      )}
                      {s.validation.issues.length > 0 && (
                        <div className="rounded border border-warning/30 bg-warning-soft/50 px-2 py-1">
                          <p className="flex items-center gap-1 text-[0.6875rem] font-medium text-warning">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {s.validation.issues.length} validation issue{s.validation.issues.length === 1 ? "" : "s"}
                          </p>
                          <ul className="mt-0.5 list-inside list-disc">
                            {s.validation.issues.map((iss, i) => (
                              <li key={i} className="text-[0.65rem] leading-relaxed text-muted-foreground">{iss}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {s.voiceLintHits.length > 0 && (
                        <p className="text-[0.6875rem] text-muted-foreground/70">
                          voice lint residuals: {s.voiceLintHits.join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
