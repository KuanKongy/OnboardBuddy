import { AlertTriangle, Loader2, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { ViewportFocus } from "@/components/graph/ViewportFocus";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import { ClusterNode, type ClusterNodeData } from "@/components/graph/ClusterNode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CLUSTER_KIND_LABELS,
  CLUSTER_KIND_PALETTE,
  fetchArchitecture,
  type ArchitectureResponse,
} from "@/lib/architectureData";
import { layoutGraph } from "@/lib/graphLayout";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";

const nodeTypes = { cluster: ClusterNode };

export function ArchitecturePage() {
  const { id } = useParams<{ id: string }>();
  const isDark = useIsDarkMode();
  const selectedPackageId = useOptionalPackages()?.selectedPackageId ?? null;
  const [data, setData] = useState<ArchitectureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    setError("");
    setSelectedId(null);
    fetchArchitecture(id, selectedPackageId)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id, selectedPackageId]);

  // Esc closes the component details panel (pairs with the animated fit-out).
  useHotkeys({ Escape: () => setSelectedId(null) }, selectedId !== null);

  // Deep link from the capabilities hub: ?cluster=<stable_key> preselects
  // that component (cluster ids are stable keys).
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const cluster = searchParams.get("cluster");
    if (cluster && data?.clusters.some((c) => c.id === cluster)) setSelectedId(cluster);
  }, [searchParams, data]);

  const visibleClusters = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.clusters;
    return data.clusters.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.members.some((m) => m.name.toLowerCase().includes(q) || (m.filePath ?? "").toLowerCase().includes(q)),
    );
  }, [data, search]);

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleClusters.map((c) => c.id));
    return (data?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [data, visibleClusters]);

  const neighborIds = useMemo(() => {
    if (!selectedId) return null;
    const n = new Set([selectedId]);
    for (const e of visibleEdges) {
      if (e.source === selectedId) n.add(e.target);
      if (e.target === selectedId) n.add(e.source);
    }
    return n;
  }, [visibleEdges, selectedId]);

  const positioned = useMemo(
    () =>
      layoutGraph(
        visibleClusters.map((c) => ({ id: c.id, label: c.label, kind: c.kind, metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } })),
        visibleEdges,
        { direction: "LR", nodeWidth: 240, nodeHeight: 118, ranksep: 110, nodesep: 36 },
      ),
    [visibleClusters, visibleEdges],
  );

  const flowNodes: Node<ClusterNodeData>[] = useMemo(() => {
    const byId = new Map(visibleClusters.map((c) => [c.id, c]));
    return positioned.map((p) => {
      const c = byId.get(p.id)!;
      return {
        id: p.id,
        type: "cluster",
        position: { x: p.x, y: p.y },
        data: {
          label: c.label,
          kind: c.kind,
          memberCount: c.members.length,
          criticalScore: c.criticalScore,
          summary: c.summary,
          selected: p.id === selectedId,
          dimmed: neighborIds !== null && !neighborIds.has(p.id),
        },
      };
    });
  }, [positioned, visibleClusters, selectedId, neighborIds]);

  const flowEdges: Edge[] = useMemo(
    () =>
      visibleEdges.map((e) => {
        const active = selectedId !== null && (e.source === selectedId || e.target === selectedId);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          animated: active,
          label: active ? e.kind.replace(/_/g, " ") : undefined,
          labelStyle: { fill: "var(--muted-foreground)", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "var(--popover)", fillOpacity: 0.95 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 3,
          style: {
            opacity: neighborIds === null || active ? 0.9 : 0.12,
            strokeWidth: Math.min(4, 1 + e.weight / 4),
            stroke: active ? "var(--primary)" : "var(--border)",
          },
        };
      }),
    [visibleEdges, selectedId, neighborIds],
  );

  const presentKinds = useMemo(
    () => [...new Set((data?.clusters ?? []).map((c) => c.kind))],
    [data],
  );
  const selected = data?.clusters.find((c) => c.id === selectedId) ?? null;

  return (
    <div style={{ "--graph-chrome": "190px" } as React.CSSProperties}>
      <div data-tour="architecture-header">
        <PageHeader
          title="Architecture"
          subtitle="How the codebase is organized into layers — click a component to see what it does and what it talks to."
          actions={
            data ? (
              <Badge variant="outline" className="text-[11px] tabular-nums">
                {data.clusters.length} components · {data.edges.length} connections
              </Badge>
            ) : undefined
          }
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {(error || (!data && !loading)) && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{error || "No architecture data available yet"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The architecture map comes from analysis. Run an analysis first, or retry if one just finished.
            </p>
          </div>
          <Button variant="outline" size="xs" onClick={load}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {data && !loading && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search components or files…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {presentKinds.map((kind) => {
                const palette = CLUSTER_KIND_PALETTE[kind] ?? "shared";
                return (
                  <span key={kind} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: `var(--node-${palette})` }} />
                    {CLUSTER_KIND_LABELS[kind] ?? kind}
                  </span>
                );
              })}
            </div>
            {search && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {visibleClusters.length} / {data.clusters.length}
              </span>
            )}
          </div>

          <div className={selected ? "grid gap-3 lg:grid-cols-[1fr_320px]" : ""}>
            <div className="graph-canvas">
              <ReactFlowProvider>
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  onNodeClick={(_, node) => setSelectedId(node.id)}
                  onPaneClick={() => setSelectedId(null)}
                  fitView
                  fitViewOptions={{ padding: 0.15 }}
                  minZoom={0.2}
                  proOptions={{ hideAttribution: true }}
                >
                  <ViewportFocus selectedNodeId={selectedId} fitPadding={0.15} />
                  <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={isDark ? "oklch(0.28 0.02 264)" : "oklch(0.85 0.008 265)"} />
                  <Controls className="!border-border !bg-card [&_button]:!border-border [&_button]:!bg-card [&_button]:!text-muted-foreground [&_button:hover]:!bg-accent [&_button_svg]:!fill-current" />
                  <MiniMap
                    pannable
                    zoomable
                    className="!border-border !bg-card"
                    nodeColor={isDark ? "oklch(0.3 0.02 264)" : "oklch(0.85 0.008 265)"}
                    maskColor={isDark ? "oklch(0.17 0.015 264 / 0.7)" : "oklch(0.95 0.005 265 / 0.7)"}
                  />
                </ReactFlow>
              </ReactFlowProvider>
            </div>

            {selected && (
              <aside className="graph-canvas overflow-y-auto !bg-card p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-foreground">{selected.label}</h2>
                    <span
                      className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        color: `var(--node-${CLUSTER_KIND_PALETTE[selected.kind] ?? "shared"})`,
                        background: `color-mix(in oklab, var(--node-${CLUSTER_KIND_PALETTE[selected.kind] ?? "shared"}) 14%, transparent)`,
                      }}
                    >
                      {CLUSTER_KIND_LABELS[selected.kind] ?? selected.kind}
                    </span>
                  </div>
                  <Button variant="ghost" size="xs" onClick={() => setSelectedId(null)} aria-label="Close details">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {selected.summary && (
                  <div className="mb-3">
                    <p className="text-[13px] leading-relaxed text-muted-foreground">{selected.summary}</p>
                    <p className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-muted-foreground/70">
                      {selected.summarySource === "semantic" ? (
                        <>
                          <Sparkles className="h-2.5 w-2.5" /> AI summary ({selected.confidence} confidence)
                        </>
                      ) : (
                        "Derived from code structure — no AI involved"
                      )}
                    </p>
                  </div>
                )}

                <p className="section-label mb-1.5">Criticality</p>
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(selected.criticalScore * 100))}%` }} />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {(selected.criticalScore * 100).toFixed(0)}%
                  </span>
                </div>

                <p className="section-label mb-1.5">Files ({selected.members.length})</p>
                <ul className="space-y-0.5">
                  {selected.members.slice(0, 30).map((m) => (
                    <li key={m.key} className="truncate font-mono text-[11.5px]" title={m.filePath ?? m.key}>
                      <Link
                        to={`/projects/${id}/dependencies?focus=${encodeURIComponent(m.filePath ?? m.key)}`}
                        className="text-muted-foreground hover:text-primary hover:underline"
                      >
                        {m.filePath ?? m.key}
                      </Link>
                    </li>
                  ))}
                  {selected.members.length > 30 && (
                    <li className="text-[11px] text-muted-foreground/70">+ {selected.members.length - 30} more</li>
                  )}
                </ul>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
