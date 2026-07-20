import { AlertTriangle, CornerLeftUp, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ClassGraphSection } from "@/components/graph/ClassGraphSection";
import { DependencyGraphView } from "@/components/graph/DependencyGraphView";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { NodeInfoPanel } from "@/components/graph/NodeInfoPanel";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchDependencyGraph,
  fetchNodeDetail,
  type GraphResponse,
  type NodeDetail,
} from "@/lib/graphData";
import { useOptionalProject } from "@/contexts/ProjectContext";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import { useHotkeys } from "@/hooks/useHotkeys";
import { capEdgesPerNode, layoutDependencyGraph } from "@/lib/graphLayout";
import type { GraphNode, GraphEdge } from "@/types/graph";

type GraphView = "files" | "classes";

const VIEWS: { key: GraphView; label: string }[] = [
  { key: "files", label: "Files" },
  { key: "classes", label: "Classes & interfaces" },
];

export function GraphPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<GraphView>("files");
  // GraphPage renders both inside ProjectLayout (/projects/:id/dependencies,
  // which provides ProjectProvider) and standalone at /dev/graph/:id (no
  // provider) — useOptionalProject returns null in the latter case instead
  // of throwing.
  const projectCtx = useOptionalProject();
  const project = projectCtx?.project ?? null;
  // Same story for the package selection (absent on the standalone route).
  const selectedPackageId = useOptionalPackages()?.selectedPackageId ?? null;
  const githubRepo =
    project?.repo_owner && project?.repo_name && project?.branch
      ? { owner: project.repo_owner, repo: project.repo_name, branch: project.branch }
      : undefined;
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [allEdges, setAllEdges] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeDetail, setSelectedNodeDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [focusNotFoundId, setFocusNotFoundId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCluster = searchParams.get("cluster");

  /** Drills in/out of a directory cluster — the URL is the source of truth
   * (?cluster=<path>) so browser Back/Forward walks the drill path instead
   * of leaving the page; the effect below reacts to the resulting change. */
  function goToCluster(cluster: string | null, opts?: { replace?: boolean }) {
    // A single click fires both onNodeClick and onSelectionChange (item 1);
    // no-op when nothing actually changes so one click doesn't push two
    // history entries (which would need two Back presses to undo).
    if (cluster === searchParams.get("cluster")) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (cluster) next.set("cluster", cluster);
      else next.delete("cluster");
      return next;
    }, opts);
  }

  function loadGraph(cluster?: string) {
    if (!id) return;
    setLoading(true);
    setError("");
    setSelectedNodeId(null);
    fetchDependencyGraph(id, cluster, selectedPackageId)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // The drilled-in cluster is read straight from the URL (?cluster=) so
  // even the very first render already reflects it — including a fresh
  // page load from a deep link. A real project/package switch invalidates
  // any drill path from another snapshot's directory layout, so it resets
  // to the root and drops a stale ?cluster= instead of trying to keep it.
  const prevGraphKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${id ?? ""}::${selectedPackageId ?? ""}`;
    const projectOrPackageChanged = prevGraphKeyRef.current !== null && prevGraphKeyRef.current !== key;
    prevGraphKeyRef.current = key;
    const cluster = activeCluster;
    if (projectOrPackageChanged && cluster) {
      goToCluster(null, { replace: true });
      return;
    }
    loadGraph(cluster ?? undefined);
  }, [id, selectedPackageId, searchParams]);

  /** One level up the cluster path; root (null) when at the first level. */
  function drillUp() {
    const segments = (activeCluster ?? "").split("/").filter(Boolean);
    const parent = segments.slice(0, -1).join("/") || null;
    goToCluster(parent);
  }

  // ← / → cycle the selectable (non-cluster) nodes; Esc deselects — paired
  // with ViewportFocus, cycling glides the camera node to node.
  const cycleIds = useMemo(
    () => (data?.graph.nodes ?? []).map((n) => n.id).filter((nid) => !nid.startsWith("cluster:")),
    [data],
  );
  const cycleNode = (delta: number) => {
    if (cycleIds.length === 0) return;
    const idx = selectedNodeId ? cycleIds.indexOf(selectedNodeId) : -1;
    const next = cycleIds[(idx + delta + cycleIds.length) % cycleIds.length];
    setSelectedNodeId(next ?? null);
  };
  useHotkeys(
    {
      ArrowRight: () => cycleNode(1),
      ArrowLeft: () => cycleNode(-1),
      Escape: () => setSelectedNodeId(null),
    },
    view === "files" && !!data && !loading,
  );

  // Deep link from other tabs (?focus=<file path>): select the node so the
  // symbol doc panel opens on arrival — but only once it's confirmed to
  // exist in the currently rendered (possibly clustered) graph; otherwise
  // surface a visible message instead of silently dimming everything with
  // no explanation.
  useEffect(() => {
    const focus = searchParams.get("focus");
    if (!focus || !data) return;
    if (data.graph.nodes.some((n) => n.id === focus)) {
      setSelectedNodeId(focus);
      setFocusNotFoundId(null);
    } else {
      setFocusNotFoundId(focus);
    }
  }, [searchParams, data]);

  // Enrich the selected node with the symbol doc, critical-path score and
  // connected workflows; best-effort, so a failure just leaves the panel basic.
  useEffect(() => {
    setSelectedNodeDetail(null);
    if (!id || !selectedNodeId || selectedNodeId.startsWith("cluster:")) return;
    setDetailLoading(true);
    let cancelled = false;
    fetchNodeDetail(id, selectedNodeId, selectedPackageId)
      .then((detail) => {
        if (!cancelled) setSelectedNodeDetail(detail);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, selectedNodeId, selectedPackageId]);

  const nodes: GraphNode[] = useMemo(() => {
    if (!data) return [];
    return data.graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      metadata: {
        exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
        importCount: (n.metadata?.importCount as number) ?? 0,
        externalImportCount: (n.metadata?.externalImportCount as number) ?? 0,
        dependentCount: (n.metadata?.dependentCount as number) ?? 0,
      },
    }));
  }, [data]);

  const edges: GraphEdge[] = useMemo(() => {
    if (!data) return [];
    return data.graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      weight: (e as { weight?: number }).weight ?? 1,
    }));
  }, [data]);

  const filteredNodeIds = useMemo(() => {
    const query = search.trim().toLowerCase();
    return new Set(
      nodes
        .filter((node) => {
          if (!query) return true;
          return (
            node.label.toLowerCase().includes(query) ||
            node.id.toLowerCase().includes(query) ||
            node.metadata.exportedSymbols.some((s) => s.toLowerCase().includes(query))
          );
        })
        .map((node) => node.id),
    );
  }, [nodes, search]);

  const visibleNodes = useMemo(
    () => nodes.filter((node) => filteredNodeIds.has(node.id)),
    [nodes, filteredNodeIds],
  );

  const visibleEdges = useMemo(() => {
    const inFilter = edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target));
    // Dense repos mangle: default to each node's strongest 3 edges in each
    // direction — the layout stays readable and "Show all edges" is one click.
    return allEdges ? inFilter : capEdgesPerNode(inFilter);
  }, [edges, filteredNodeIds, allEdges]);

  const positionedNodes = useMemo(
    () => layoutDependencyGraph(visibleNodes, visibleEdges, data?.graph.entryPoints ?? []),
    [visibleNodes, visibleEdges, data],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const showPanel = view === "files" && selectedNode && !data?.clustered;

  return (
    <div style={{ "--graph-chrome": "230px" } as React.CSSProperties}>
      <PageHeader
        title={
          // Stable breadcrumb: "Dependencies" never moves — drilling into a
          // cluster appends its path segments, each clickable to drill back
          // up to that level; the root text goes back to all groups.
          activeCluster ? (
            <span className="flex flex-wrap items-baseline gap-1.5">
              <button
                className="transition-colors hover:text-primary"
                onClick={() => goToCluster(null)}
                title="Back to all groups"
              >
                Dependencies
              </button>
              {activeCluster.split("/").map((segment, i, segments) => {
                const prefix = segments.slice(0, i + 1).join("/");
                const isLast = i === segments.length - 1;
                return (
                  <span key={prefix} className="flex items-baseline gap-1.5 text-sm font-normal text-muted-foreground">
                    <span>/</span>
                    {isLast ? (
                      <span className="text-foreground">{segment}</span>
                    ) : (
                      <button
                        className="transition-colors hover:text-primary"
                        onClick={() => goToCluster(prefix)}
                        title={`Drill up to ${prefix}`}
                      >
                        {segment}
                      </button>
                    )}
                  </span>
                );
              })}
            </span>
          ) : (
            "Dependencies"
          )
        }
        subtitle="Which files depend on which — follow the arrows to see how changes ripple."
        actions={
          <>
            {view === "files" && activeCluster && (
              <Button variant="outline" size="xs" onClick={drillUp} title="Drill up one level">
                <CornerLeftUp className="mr-1 h-3 w-3" />
                Up one level
              </Button>
            )}
            {view === "files" && data && (
              <>
                <Badge variant="outline" className="text-[11px] tabular-nums">
                  {data.totalNodes} files · {data.totalEdges} edges
                  {data.clustered && " (grouped)"}
                </Badge>
                <Button
                  variant={allEdges ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => setAllEdges((v) => !v)}
                  title="By default only each file's 3 strongest edges per direction are drawn to keep the layout readable"
                >
                  {allEdges ? "Strongest edges only" : "Show all edges"}
                </Button>
              </>
            )}
            {/* The view toggle stays rightmost so it never shifts when the
                files-only controls above unmount. */}
            <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  aria-pressed={view === v.key}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    view === v.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </>
        }
      />

      {view === "classes" && id && <ClassGraphSection projectId={id} />}

      {view === "files" && loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {view === "files" && (error || (!data && !loading)) && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {error || "No graph data available yet"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Run an analysis first to generate the dependency graph, or retry if analysis has completed.
            </p>
          </div>
          <Button variant="outline" size="xs" onClick={() => loadGraph(activeCluster ?? undefined)}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {view === "files" && data && !loading && (
        <>
          {data.clustered && (
            <p className="mb-2 text-xs text-muted-foreground">
              Large codebase ({data.totalNodes} files) — showing directory groups. Click a group to drill in.
            </p>
          )}

          {focusNotFoundId && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
              <span className="flex-1 text-foreground">
                Could not find <code className="font-mono">{focusNotFoundId}</code> in the current view.
              </span>
              <Button variant="ghost" size="xs" onClick={() => setFocusNotFoundId(null)}>
                Dismiss
              </Button>
            </div>
          )}

          <GraphToolbar
            search={search}
            onSearchChange={setSearch}
            matchCount={visibleNodes.length}
            totalCount={nodes.length}
            noun={data.clustered ? "groups" : "files"}
          />

          <div className={showPanel ? "grid gap-3 lg:grid-cols-[1fr_340px]" : ""}>
            <div className="graph-canvas">
              <DependencyGraphView
                nodes={positionedNodes}
                edges={visibleEdges}
                entryPoints={data.graph.entryPoints}
                selectedNodeId={selectedNodeId}
                onSelectNode={(nodeId) => {
                  if (data.clustered && nodeId?.startsWith("cluster:")) {
                    goToCluster(nodeId.replace("cluster:", ""));
                  } else {
                    setSelectedNodeId(nodeId);
                  }
                }}
              />
            </div>

            {showPanel && (
              <aside className="graph-canvas overflow-y-auto !bg-card">
                <NodeInfoPanel
                  node={selectedNode}
                  detail={selectedNodeDetail}
                  loading={detailLoading}
                  githubRepo={githubRepo}
                  onClose={() => setSelectedNodeId(null)}
                />
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
