import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  FileCode2,
  Loader2,
  Map,
  RefreshCw,
  Route,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import { CLUSTER_KIND_PALETTE } from "@/lib/architectureData";

interface StartHereRef {
  stable_key: string;
  reason?: string;
}

interface Capability {
  id: string;
  stableKey: string;
  name: string;
  description: string;
  confidence: string;
  summary: string | null;
  userValue: string | null;
  whereToStart: StartHereRef[];
  workflows: Array<{
    id: string;
    title: string;
    triggerType: string | null;
    purpose: string | null;
    score: number;
    reason: string | null;
    tutorials: Array<{ id: string; title: string }>;
  }>;
  modules: Array<{ id: string; label: string; stableKey: string | null; kind: string | null; reason: string | null }>;
}

/** Symbol keys look like "path/file.ts#Symbol" — the dependencies graph
 * focuses file nodes, so link to the file part. */
function fileOf(stableKey: string): string {
  return stableKey.split("#")[0] ?? stableKey;
}

/**
 * Feature-map hub: one card per business capability answering "what does
 * this do, why would I touch it, and where do I start reading" — with
 * direct links into the workflows, tutorials, architecture clusters, and
 * entry files that deliver it.
 */
export function CapabilitiesPage() {
  const { id } = useParams<{ id: string }>();
  const packagesCtx = useOptionalPackages();
  const selectedPackageId = packagesCtx?.selectedPackageId ?? null;
  const packageQuery = packagesCtx?.packageQuery ?? "";
  const [capabilities, setCapabilities] = useState<Capability[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    if (!id) return;
    setLoading(true);
    setError("");
    apiFetch(`/projects/${id}/capabilities${packageQuery}`)
      .then((data: { capabilities: Capability[] }) =>
        // Snapshots analyzed before the hub fields existed lack them —
        // normalize so the cards degrade gracefully instead of crashing.
        setCapabilities(
          (data.capabilities ?? []).map((c) => ({
            ...c,
            userValue: c.userValue ?? null,
            whereToStart: c.whereToStart ?? [],
            workflows: (c.workflows ?? []).map((w) => ({ ...w, tutorials: w.tutorials ?? [] })),
            modules: c.modules ?? [],
          })),
        ))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id, selectedPackageId]);

  return (
    <div>
      <PageHeader
        title="Capabilities"
        subtitle="What this product does in plain terms — and for each part, where the code lives and where to start reading."
        actions={
          capabilities && capabilities.length > 0 ? (
            <Badge variant="outline" className="text-[11px] tabular-nums">
              {capabilities.length} capabilit{capabilities.length === 1 ? "y" : "ies"}
            </Badge>
          ) : undefined
        }
      />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {!loading && (error || !capabilities || capabilities.length === 0) && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{error || "No capabilities extracted yet"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Capabilities are extracted by the AI analysis pass. They appear after a full analysis —
              and never for projects with AI disabled.
            </p>
          </div>
          <Button variant="outline" size="xs" onClick={load}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {!loading && capabilities && capabilities.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {capabilities.map((cap) => (
            <Card key={cap.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Boxes className="h-4 w-4 shrink-0 text-primary" />
                    <h2 className="truncate text-sm font-semibold text-foreground" title={cap.name}>
                      {cap.name}
                    </h2>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px] uppercase">
                    {cap.confidence} confidence
                  </Badge>
                </div>

                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {cap.description || cap.summary}
                </p>
                {cap.userValue && (
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">When you'll touch it:</span> {cap.userValue}
                  </p>
                )}

                {cap.whereToStart.length > 0 && (
                  <div className="mt-3 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-2">
                    <p className="section-label mb-1">Start here</p>
                    <ul className="space-y-1">
                      {cap.whereToStart.map((s) => {
                        const file = fileOf(s.stable_key);
                        const symbolIndex = s.stable_key.indexOf("#");
                        const symbol = symbolIndex >= 0 ? s.stable_key.slice(symbolIndex + 1) : null;
                        return (
                          <li key={s.stable_key} className="text-[12px]">
                            <Link
                              to={`/projects/${id}/dependencies?focus=${encodeURIComponent(file)}`}
                              className="flex min-w-0 items-center gap-1.5 font-mono text-primary hover:underline"
                              title={s.stable_key}
                            >
                              <FileCode2 className="h-3 w-3 shrink-0" />
                              <span className="min-w-0 truncate">
                                {file}
                                {symbol && <span className="text-muted-foreground"> #{symbol}</span>}
                              </span>
                            </Link>
                            {s.reason && <p className="text-muted-foreground">{s.reason}</p>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {cap.workflows.length > 0 && (
                  <div className="mt-3">
                    <p className="section-label mb-1">Flows that deliver it</p>
                    <ul className="space-y-1.5">
                      {cap.workflows.slice(0, 4).map((wf) => (
                        <li key={wf.id} className="text-[12px]">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <Link
                              to={`/projects/${id}/workflows?workflow=${wf.id}`}
                              className="inline-flex items-center gap-1.5 text-primary hover:underline"
                            >
                              <Zap className="h-3 w-3 shrink-0" /> {wf.title}
                            </Link>
                            {wf.tutorials.map((t) => (
                              <Link
                                key={t.id}
                                to={`/projects/${id}/walkthrough?tutorial=${t.id}`}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary hover:underline"
                                title={`Tutorial: ${t.title}`}
                              >
                                <Route className="h-3 w-3" /> tutorial
                              </Link>
                            ))}
                          </div>
                          {wf.reason && <p className="text-muted-foreground">{wf.reason}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {cap.modules.length > 0 && (
                  <div className="mt-3">
                    <p className="section-label mb-1">Where the code lives</p>
                    <div className="flex flex-wrap gap-1.5">
                      {cap.modules.map((mod) => (
                        <Link
                          key={mod.id}
                          to={`/projects/${id}/architecture?cluster=${encodeURIComponent(mod.stableKey ?? "")}`}
                          title={mod.reason ?? undefined}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary/50"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: `var(--node-${CLUSTER_KIND_PALETTE[mod.kind ?? ""] ?? "shared"})` }}
                          />
                          {mod.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 border-t border-border pt-2">
                  <Link
                    to={`/projects/${id}/architecture`}
                    className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-primary"
                  >
                    <Map className="h-3 w-3" /> See it on the architecture map <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
