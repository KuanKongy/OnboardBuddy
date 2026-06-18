import { useMemo } from "react";
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
import { ModuleNode, type ModuleNodeData } from "@/components/graph/ModuleNode";
import type { PositionedNode } from "@/lib/graphLayout";
import type { GraphEdge } from "@/types/graph";

const nodeTypes = { module: ModuleNode };

interface DependencyGraphViewProps {
  nodes: PositionedNode[];
  edges: GraphEdge[];
  entryPoints: string[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  edgeFilter: "imports" | "exports";
}

export function DependencyGraphView({
  nodes,
  edges,
  entryPoints,
  selectedNodeId,
  onSelectNode,
  edgeFilter,
}: DependencyGraphViewProps) {
  const entryPointSet = useMemo(() => new Set(entryPoints), [entryPoints]);

  const neighborIds = useMemo(() => {
    if (!selectedNodeId) return null;
    const neighbors = new Set<string>([selectedNodeId]);
    for (const edge of edges) {
      if (edge.source === selectedNodeId) neighbors.add(edge.target);
      if (edge.target === selectedNodeId) neighbors.add(edge.source);
    }
    return neighbors;
  }, [edges, selectedNodeId]);

  const visibleEdges = useMemo(() => {
    if (edgeFilter === "exports") {
      return edges.filter((e) => e.target === selectedNodeId || e.source === selectedNodeId || !selectedNodeId);
    }
    return edges;
  }, [edges, edgeFilter, selectedNodeId]);

  const flowNodes: Node<ModuleNodeData>[] = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "module",
        position: { x: node.x, y: node.y },
        data: {
          label: node.label,
          kind: node.kind,
          filePath: node.id,
          exportedSymbols: node.metadata.exportedSymbols,
          importCount: node.metadata.importCount,
          dependentCount: node.metadata.dependentCount,
          symbolCount: node.metadata.exportedSymbols.length,
          isEntryPoint: entryPointSet.has(node.id),
          selected: node.id === selectedNodeId,
          dimmed: neighborIds !== null && !neighborIds.has(node.id),
        },
      })),
    [nodes, entryPointSet, selectedNodeId, neighborIds],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      visibleEdges.map((edge) => {
        const isActive =
          neighborIds !== null &&
          (edge.source === selectedNodeId || edge.target === selectedNodeId);

        let label: string | undefined;
        if (selectedNodeId) {
          if (edge.source === selectedNodeId) label = "IMPORTS";
          else if (edge.target === selectedNodeId) label = "USED BY";
        }

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: isActive,
          label,
          labelStyle: { fill: "#6b7280", fontSize: 9, fontWeight: 700 },
          labelBgStyle: { fill: "oklch(0.17 0 0)", fillOpacity: 0.95 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 3,
          style: {
            opacity: neighborIds === null || isActive ? 1 : 0.1,
            strokeWidth: isActive ? 2 : 1,
            stroke: isActive ? "oklch(0.623 0.214 259)" : "oklch(0.4 0 0)",
          },
        };
      }),
    [visibleEdges, neighborIds, selectedNodeId],
  );

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="oklch(0.3 0 0)" />
        <Controls className="!bg-card !border-border [&_button]:!bg-card [&_button]:!border-border [&_button]:!text-muted-foreground [&_button:hover]:!bg-accent" />
        <MiniMap
          pannable
          zoomable
          className="!bg-card !border-border"
          nodeColor="oklch(0.28 0 0)"
          maskColor="oklch(0.17 0 0 / 0.7)"
        />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
