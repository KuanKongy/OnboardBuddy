import { useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { ArchitectureNode, type ArchitectureNodeData } from "@/components/graph/ArchitectureNode";
import { layoutDependencyGraph } from "@/lib/graphLayout";
import type { ArchitectureComponent, ArchitectureEdge, GraphNode } from "@/types/graph";

const nodeTypes = { component: ArchitectureNode };

interface ArchitectureMapViewProps {
  components: ArchitectureComponent[];
  edges: ArchitectureEdge[];
  entryComponentIds: string[];
  selectedComponentId: string | null;
  onSelectComponent: (componentId: string | null) => void;
}

export function ArchitectureMapView({
  components,
  edges,
  entryComponentIds,
  selectedComponentId,
  onSelectComponent,
}: ArchitectureMapViewProps) {
  // layoutDependencyGraph works on GraphNode; adapt components to that shape
  // so both graphs share the same layered layout.
  const positioned = useMemo(() => {
    const layoutNodes: GraphNode[] = components.map((c) => ({
      id: c.id,
      label: c.label,
      kind: c.type,
      metadata: {
        exportedSymbols: c.exportedSymbols,
        importCount: c.importCount,
        dependentCount: c.dependentCount,
      },
    }));
    return layoutDependencyGraph(layoutNodes, edges, entryComponentIds);
  }, [components, edges, entryComponentIds]);

  const componentsById = useMemo(
    () => new Map(components.map((c) => [c.id, c])),
    [components],
  );

  const neighborIds = useMemo(() => {
    if (!selectedComponentId) return null;
    const neighbors = new Set<string>([selectedComponentId]);
    for (const edge of edges) {
      if (edge.source === selectedComponentId) neighbors.add(edge.target);
      if (edge.target === selectedComponentId) neighbors.add(edge.source);
    }
    return neighbors;
  }, [edges, selectedComponentId]);

  const flowNodes: Node<ArchitectureNodeData>[] = useMemo(
    () =>
      positioned.map((node) => {
        const component = componentsById.get(node.id)!;
        return {
          id: node.id,
          type: "component",
          position: { x: node.x, y: node.y },
          data: {
            label: component.label,
            directory: component.directory,
            componentType: component.type,
            fileCount: component.files.length,
            exportedSymbols: component.exportedSymbols,
            selected: node.id === selectedComponentId,
            dimmed: neighborIds !== null && !neighborIds.has(node.id),
          },
        };
      }),
    [positioned, componentsById, selectedComponentId, neighborIds],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((edge) => {
        const isActive =
          neighborIds !== null &&
          (edge.source === selectedComponentId || edge.target === selectedComponentId);

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: isActive,
          label: edge.weight > 1 ? `imports ×${edge.weight}` : "imports",
          labelStyle: { fill: "#6b7280", fontSize: 9, fontWeight: 700 },
          labelBgStyle: { fill: "oklch(0.17 0 0)", fillOpacity: 0.95 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 3,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: isActive ? "oklch(0.623 0.214 259)" : "oklch(0.4 0 0)",
          },
          style: {
            opacity: neighborIds === null || isActive ? 1 : 0.1,
            strokeWidth: isActive ? 2 : Math.min(1 + edge.weight * 0.25, 3),
            stroke: isActive ? "oklch(0.623 0.214 259)" : "oklch(0.4 0 0)",
          },
        };
      }),
    [edges, neighborIds, selectedComponentId],
  );

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectComponent(node.id)}
        onPaneClick={() => onSelectComponent(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="oklch(0.3 0 0)" />
        <Controls className="!bg-card !border-border [&_button]:!bg-card [&_button]:!border-border [&_button]:!text-foreground [&_button_svg]:!fill-foreground [&_button:hover]:!bg-accent" />
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
