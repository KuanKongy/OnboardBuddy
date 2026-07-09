import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { DependencyGraphView } from "@/components/graph/DependencyGraphView";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { NodeInfoPanel } from "@/components/graph/NodeInfoPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOptionalProject } from "@/contexts/ProjectContext";
import { fetchDependencyGraph, type GraphResponse } from "@/lib/graphData";
import { layoutDependencyGraph } from "@/lib/graphLayout";
import type { GraphNode, GraphEdge } from "@/types/graph";

type EdgeFilter = "imports" | "exports";

export function GraphPage() {
  const { id } = useParams<{ id: string }>();
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
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>("imports");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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

  const nodes: GraphNode[] = useMemo(() => {
    if (!data) return [];
    return data.graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      metadata: {
        exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
        importCount: (n.metadata?.importCount as number) ?? 0,
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

  const visibleEdges = useMemo(
    () => edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)),
    [edges, filteredNodeIds],
  );

  const positionedNodes = useMemo(
    () => layoutDependencyGraph(visibleNodes, visibleEdges, data?.graph.entryPoints ?? []),
    [visibleNodes, visibleEdges, data],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div>
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {activeCluster && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => { setActiveCluster(null); loadGraph(); }}
            >
              <ArrowLeft className="mr-1 h-3 w-3" />
              All clusters
            </Button>
          )}
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              Dependency map
              {activeCluster && <span className="ml-2 text-sm font-normal text-muted-foreground">/ {activeCluster}</span>}
            </h1>
            <p className="text-xs text-muted-foreground">
              Which files and modules depend on which — a map for orienting yourself.
            </p>
          </div>
        </div>
        {data && (
          <Badge variant="outline" className="text-[11px]">
            {data.totalNodes} files · {data.totalEdges} edges
            {data.clustered && " (clustered)"}
          </Badge>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {(error || (!data && !loading)) && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
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

      {data && !loading && (
        <>
          {data.clustered && (
            <p className="mb-3 text-xs text-muted-foreground">
              Large codebase ({data.totalNodes} files) — showing directory clusters. Click a cluster to drill in.
            </p>
          )}

          <GraphToolbar
            search={search}
            onSearchChange={setSearch}
            edgeFilter={edgeFilter}
            onEdgeFilterChange={setEdgeFilter}
            matchCount={visibleNodes.length}
            totalCount={nodes.length}
          />

          <div className="h-[300px] w-full rounded-xl border border-border sm:h-[400px] md:h-[480px]">
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
              edgeFilter={edgeFilter}
            />
          </div>

          {selectedNode && !data.clustered && (
            <NodeInfoPanel node={selectedNode} fileAnalysis={undefined} githubRepo={githubRepo} />
          )}
        </>
      )}
    </div>
  );
}
