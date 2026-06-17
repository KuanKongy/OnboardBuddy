import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { DependencyGraphView } from "@/components/graph/DependencyGraphView";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { NodeInfoPanel } from "@/components/graph/NodeInfoPanel";
import { fetchDependencyGraph } from "@/lib/graphData";
import { layoutDependencyGraph } from "@/lib/graphLayout";
import type { AnalysisSnapshot } from "@/types/graph";

type EdgeFilter = "imports" | "exports";

export function GraphPage() {
  const { id } = useParams<{ id: string }>();
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>("imports");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError("");
    fetchDependencyGraph(id)
      .then(setSnapshot)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const filteredNodeIds = useMemo(() => {
    if (!snapshot) return new Set<string>();
    const query = search.trim().toLowerCase();
    return new Set(
      snapshot.graph.nodes
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
  }, [snapshot, search]);

  const visibleNodes = useMemo(
    () => snapshot?.graph.nodes.filter((node) => filteredNodeIds.has(node.id)) ?? [],
    [snapshot, filteredNodeIds],
  );

  const visibleEdges = useMemo(
    () =>
      snapshot?.graph.edges.filter(
        (edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target),
      ) ?? [],
    [snapshot, filteredNodeIds],
  );

  const positionedNodes = useMemo(
    () =>
      snapshot
        ? layoutDependencyGraph(visibleNodes, visibleEdges, snapshot.graph.entryPoints)
        : [],
    [snapshot, visibleNodes, visibleEdges],
  );

  const selectedNode = snapshot?.graph.nodes.find((n) => n.id === selectedNodeId);
  const selectedFileAnalysis = snapshot?.fileAnalyses.find(
    (f) => f.relativePath === selectedNodeId,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="py-20 text-center text-sm text-destructive">
        {error || "No graph data available"}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-lg font-semibold text-foreground">Dependency map</h1>
      </div>

      <GraphToolbar
        search={search}
        onSearchChange={setSearch}
        edgeFilter={edgeFilter}
        onEdgeFilterChange={setEdgeFilter}
        matchCount={visibleNodes.length}
        totalCount={snapshot.graph.nodes.length}
      />

      <div className="h-[480px] w-full rounded-xl border border-border">
        <DependencyGraphView
          nodes={positionedNodes}
          edges={visibleEdges}
          entryPoints={snapshot.graph.entryPoints}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          edgeFilter={edgeFilter}
        />
      </div>

      {selectedNode && (
        <NodeInfoPanel node={selectedNode} fileAnalysis={selectedFileAnalysis} />
      )}
    </div>
  );
}
