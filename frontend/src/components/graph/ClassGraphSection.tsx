import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DependencyGraphView } from "@/components/graph/DependencyGraphView";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { NodeInfoPanel } from "@/components/graph/NodeInfoPanel";
import { Button } from "@/components/ui/button";
import { fetchClassGraph, type GraphResponse } from "@/lib/graphData";
import { capEdgesPerNode, layoutDependencyGraph } from "@/lib/graphLayout";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import type { GraphEdge, GraphNode } from "@/types/graph";

interface ClassGraphSectionProps {
  projectId: string;
  /**
   * Stable key of a class/interface to open focused, handed over from the
   * Files view's "See inheritance". This graph is project-wide, so the
   * hand-off is a view switch, not a drill — but the reader still has to land
   * on the symbol they clicked rather than on the whole graph.
   */
  focusNodeId?: string | null;
}

export function ClassGraphSection({ projectId, focusNodeId = null }: ClassGraphSectionProps) {
  const selectedPackageId = useOptionalPackages()?.selectedPackageId ?? null;
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  /** True when the handed-over symbol is not in this graph — say so rather
   * than silently showing the unfocused graph as if nothing was asked. */
  const [focusMissing, setFocusMissing] = useState(false);

  function loadClasses() {
    setLoading(true);
    setError("");
    setSelectedNodeId(null);
    setFocusMissing(false);
    fetchClassGraph(projectId, selectedPackageId)
      .then((d) => {
        setData(d);
        if (!focusNodeId) return;
        const found = d.graph.nodes.some((n) => n.id === focusNodeId);
        setSelectedNodeId(found ? focusNodeId : null);
        setFocusMissing(!found);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadClasses(); }, [projectId, selectedPackageId, focusNodeId]);

  // ← / → cycle class/interface nodes, Esc deselects (mirrors the files view).
  const cycleIds = useMemo(() => (data?.graph.nodes ?? []).map((n) => n.id), [data]);
  useHotkeys(
    {
      ArrowRight: () => cycleIds.length > 0 && setSelectedNodeId((prev) => cycleIds[(cycleIds.indexOf(prev ?? "") + 1 + cycleIds.length) % cycleIds.length] ?? null),
      ArrowLeft: () => cycleIds.length > 0 && setSelectedNodeId((prev) => cycleIds[(cycleIds.indexOf(prev ?? "") - 1 + cycleIds.length) % cycleIds.length] ?? null),
      Escape: () => setSelectedNodeId(null),
    },
    !!data && !loading,
  );

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
    () => capEdgesPerNode(edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target))),
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
      {focusNodeId && !focusMissing && (
        <p className="mb-2 text-xs text-muted-foreground">
          Focused on <code className="font-mono">{focusNodeId.split("#").pop()}</code>. This graph is
          project-wide: extends/implements relationships cross files, so it is a separate view rather than a
          level inside the file you came from.
        </p>
      )}
      {focusMissing && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="flex-1 text-foreground">
            <code className="font-mono">{focusNodeId}</code> is not in the class graph for this snapshot —
            showing the whole graph instead.
          </span>
        </div>
      )}

      <GraphToolbar
        search={search}
        onSearchChange={setSearch}
        matchCount={visibleNodes.length}
        totalCount={nodes.length}
        noun="classes"
        extra={`${edges.length} relationships`}
      />

      <div className={selectedNode ? "grid gap-3 lg:grid-cols-[1fr_340px]" : ""}>
        <div className="graph-canvas">
          <DependencyGraphView
            nodes={positionedNodes}
            edges={visibleEdges}
            entryPoints={[]}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            // Arriving from "See inheritance" is like a deep link: the reader
            // chose no viewport here, so the handed-over symbol is framed.
            suppressInitialFit={!!focusNodeId}
            focusMode={focusNodeId ? "frame" : "pan-into-view"}
          />
        </div>

        {selectedNode && (
          <aside className="graph-canvas overflow-y-auto !bg-card">
            <NodeInfoPanel node={selectedNode} onClose={() => setSelectedNodeId(null)} />
          </aside>
        )}
      </div>
    </>
  );
}
