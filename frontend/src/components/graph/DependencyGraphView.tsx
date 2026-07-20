import { useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { GraphFirstVisitHint } from "@/components/graph/GraphFirstVisitHint";
import { GraphLegend } from "@/components/graph/GraphLegend";
import { ViewportFocus } from "@/components/graph/ViewportFocus";
import { ModuleNode, type ModuleNodeData } from "@/components/graph/ModuleNode";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import type { PositionedNode } from "@/lib/graphLayout";
import { inferNodeType } from "@/lib/graphNodeType";
import type { GraphEdge } from "@/types/graph";

// Wraps ModuleNode with an entry-point marker rather than editing
// ModuleNode.tsx directly (that file is owned by a parallel change).
function EntryAwareModuleNode(props: NodeProps<ModuleNodeData>) {
  return (
    <div className="relative">
      {props.data.isEntryPoint && (
        <span
          title="Entry point"
          className="absolute -left-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground shadow"
        >
          ▶
        </span>
      )}
      <ModuleNode {...props} />
    </div>
  );
}

const nodeTypes = { module: EntryAwareModuleNode };

interface DependencyGraphViewProps {
  nodes: PositionedNode[];
  edges: GraphEdge[];
  entryPoints: string[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  /** True when the caller already knows a node should be focused on this
   * mount (e.g. a `?focus=` deep link) — suppresses React Flow's own
   * declarative initial `fitView` so `ViewportFocus` is the sole viewport
   * writer on arrival. Without this, both fire around the same
   * measurement-ready moment and whichever lands last wins, which is
   * exactly why a redirect into this graph used to center/zoom
   * inconsistently while a manual node click (on an already-settled
   * graph, nothing else writing the viewport) always worked. */
  suppressInitialFit?: boolean;
}

export function DependencyGraphView({
  nodes,
  edges,
  entryPoints,
  selectedNodeId,
  onSelectNode,
  suppressInitialFit = false,
}: DependencyGraphViewProps) {
  const isDark = useIsDarkMode();
  const entryPointSet = useMemo(() => new Set(entryPoints), [entryPoints]);

  // Legend shows only kinds that actually occur on this canvas.
  const presentKinds = useMemo(
    () => [...new Set(nodes.map((n) => inferNodeType(n.id, n.metadata.exportedSymbols).type))],
    [nodes],
  );

  const neighborIds = useMemo(() => {
    if (!selectedNodeId) return null;
    const neighbors = new Set<string>([selectedNodeId]);
    for (const edge of edges) {
      if (edge.source === selectedNodeId) neighbors.add(edge.target);
      if (edge.target === selectedNodeId) neighbors.add(edge.source);
    }
    return neighbors;
  }, [edges, selectedNodeId]);

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
          externalImportCount: node.metadata.externalImportCount ?? 0,
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
      edges.map((edge) => {
        const isActive =
          neighborIds !== null &&
          (edge.source === selectedNodeId || edge.target === selectedNodeId);

        let label: string | undefined;
        if (selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId)) {
          if (edge.kind === "imports" || edge.kind === "dependency") {
            label = edge.source === selectedNodeId ? "IMPORTS" : "IMPORTED BY";
          } else {
            label = edge.kind.toUpperCase();
          }
        }

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: isActive,
          label,
          labelStyle: { fill: "var(--muted-foreground)", fontSize: 9, fontWeight: 700 },
          labelBgStyle: { fill: "var(--popover)", fillOpacity: 0.95 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 3,
          style: {
            opacity: neighborIds === null || isActive ? 1 : 0.1,
            strokeWidth: isActive ? 2 : 1,
            stroke: isActive ? "var(--primary)" : "var(--border)",
          },
        };
      }),
    [edges, neighborIds, selectedNodeId, isDark],
  );

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onSelectionChange={({ nodes: selectedNodes }) => {
          // Keyboard selection (Tab focuses a node, Enter/Space selects it)
          // never fires onNodeClick, only this — so it's the path that
          // covers Tab/Enter. It also fires for mouse clicks (alongside
          // onNodeClick above), which is harmless: the setter is idempotent
          // for a given id. Deselection stays on onPaneClick below; an
          // empty selection here can also mean "nothing has been clicked
          // in the canvas yet" (e.g. right after a deep-link selection), so
          // it's ignored rather than clobbering the current selection.
          if (selectedNodes.length > 0) onSelectNode(selectedNodes[0]!.id);
        }}
        onPaneClick={() => onSelectNode(null)}
        fitView={!suppressInitialFit}
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <ViewportFocus selectedNodeId={selectedNodeId} ownsInitialFit={suppressInitialFit} />

        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={isDark ? "oklch(0.28 0.02 264)" : "oklch(0.85 0.008 265)"}
        />
        <Controls className="!bg-card !border-border [&_button]:!bg-card [&_button]:!border-border [&_button]:!text-muted-foreground [&_button:hover]:!bg-accent [&_button_svg]:!fill-current" />

        <MiniMap
          pannable
          zoomable
          className="!bg-card !border-border"
          nodeColor={isDark ? "oklch(0.3 0.02 264)" : "oklch(0.85 0.008 265)"}
          maskColor={isDark ? "oklch(0.17 0.015 264 / 0.7)" : "oklch(0.95 0.005 265 / 0.7)"}
        />
        <Panel position="top-left">
          <GraphLegend presentKinds={presentKinds} />
        </Panel>
        <Panel position="bottom-center">
          <GraphFirstVisitHint hasEntryPoints={entryPoints.length > 0} />
        </Panel>
      </ReactFlow>
    </ReactFlowProvider>
  );
}
