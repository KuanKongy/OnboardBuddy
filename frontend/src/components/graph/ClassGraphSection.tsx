import { AlertTriangle, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DependencyGraphView } from "@/components/graph/DependencyGraphView";
import { NodeInfoPanel } from "@/components/graph/NodeInfoPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchClassGraph, type GraphResponse } from "@/lib/graphData";
import { layoutDependencyGraph } from "@/lib/graphLayout";
import type { GraphEdge, GraphNode } from "@/types/graph";

interface ClassGraphSectionProps {
  projectId: string;
}

export function ClassGraphSection({ projectId }: ClassGraphSectionProps) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  function loadClasses() {
    setLoading(true);
    setError("");
    setSelectedNodeId(null);
    fetchClassGraph(projectId)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadClasses(); }, [projectId]);

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
    return data.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, kind: e.kind }));
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
    () => layoutDependencyGraph(visibleNodes, visibleEdges, []),
    [visibleNodes, visibleEdges],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data || nodes.length === 0) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            {error || "No class or interface data available"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The class graph is built from classes and interfaces found during analysis. Run a
            (re-)analysis first — snapshots from before this feature have no class data.
          </p>
        </div>
        <Button variant="outline" size="xs" onClick={loadClasses}>
          <RefreshCw className="mr-1 h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search classes, interfaces or members..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Badge variant="outline" className="text-[10px]">
          {visibleNodes.length} / {nodes.length} classes · {edges.length} relationships
        </Badge>
      </div>

      <div className={selectedNode ? "grid gap-3 lg:grid-cols-[1fr_340px]" : ""}>
        <div className="graph-canvas">
          <DependencyGraphView
            nodes={positionedNodes}
            edges={visibleEdges}
            entryPoints={[]}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        </div>

        {selectedNode && (
          <aside className="graph-canvas overflow-y-auto !bg-card">
            <NodeInfoPanel node={selectedNode} />
          </aside>
        )}
      </div>
    </>
  );
}
