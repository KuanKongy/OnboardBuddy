import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { layoutDependencyGraph } from "@/lib/graphLayout";
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
  const [activeCluster, setActiveCluster] = useState<string | null>(null);

  function loadGraph(cluster?: string) {
    if (!id) return;
    setLoading(true);
    setError("");
    setSelectedNodeId(null);
    fetchDependencyGraph(id, cluster)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadGraph(); }, [id]);

  // Deep link from other tabs (?focus=<file path>): select the node so the
  // symbol doc panel opens on arrival.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus) setSelectedNodeId(focus);
  }, [searchParams]);

  // Enrich the selected node with the symbol doc, critical-path score and
  // connected workflows; best-effort, so a failure just leaves the panel basic.
  useEffect(() => {
    setSelectedNodeDetail(null);
    if (!id || !selectedNodeId || selectedNodeId.startsWith("cluster:")) return;
    let cancelled = false;
    fetchNodeDetail(id, selectedNodeId).then((detail) => {
      if (!cancelled) setSelectedNodeDetail(detail);
    });
    return () => { cancelled = true; };
  }, [id, selectedNodeId]);

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
    if (allEdges) return inFilter;
    // Dense repos mangle: default to each node's strongest 3 edges in each
    // direction (by weight, then insertion order) — the layout stays readable
    // and "Show all edges" is one click.
    const sorted = [...inFilter].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
    const perNode = new Map<string, number>();
    const keptIds = new Set<string>();
    for (const edge of sorted) {
      const out = perNode.get(`out:${edge.source}`) ?? 0;
      const inn = perNode.get(`in:${edge.target}`) ?? 0;
      if (out >= 3 && inn >= 3) continue;
      perNode.set(`out:${edge.source}`, out + 1);
      perNode.set(`in:${edge.target}`, inn + 1);
      keptIds.add(edge.id);
    }
    return inFilter.filter((edge) => keptIds.has(edge.id));
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
          // cluster appends a suffix, and clicking the root text goes back.
          activeCluster ? (
            <span className="flex items-baseline gap-1.5">
              <button
                className="transition-colors hover:text-primary"
                onClick={() => { setActiveCluster(null); loadGraph(); }}
                title="Back to all clusters"
              >
                Dependencies
              </button>
              <span className="text-sm font-normal text-muted-foreground">/ {activeCluster}</span>
            </span>
          ) : (
            "Dependencies"
          )
        }
        subtitle="Which files depend on which — follow the arrows to see how changes ripple."
        actions={
          <>
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
                    const dir = nodeId.replace("cluster:", "");
                    setActiveCluster(dir);
                    loadGraph(dir);
                  } else {
                    setSelectedNodeId(nodeId);
                  }
                }}
              />
            </div>

            {showPanel && (
              <aside className="graph-canvas overflow-y-auto !bg-card">
                <NodeInfoPanel node={selectedNode} detail={selectedNodeDetail} githubRepo={githubRepo} />
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
