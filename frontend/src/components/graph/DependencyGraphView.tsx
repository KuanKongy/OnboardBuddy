import { useMemo, type MutableRefObject } from "react";
import { MarkerType, Panel, type Edge, type Node, type NodeProps, type Viewport } from "reactflow";
import "reactflow/dist/style.css";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { GraphFirstVisitHint } from "@/components/graph/GraphFirstVisitHint";
import { GraphLegend } from "@/components/graph/GraphLegend";
import type { FocusMode } from "@/components/graph/ViewportFocus";
import { ModuleNode, type ModuleNodeData } from "@/components/graph/ModuleNode";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import type { GraphDrill } from "@/hooks/useGraphDrill";
import type { PositionedNode } from "@/lib/graphLayout";
import { inferNodeType } from "@/lib/graphNodeType";
import type { GraphEdge } from "@/types/graph";

/**
 * Wraps ModuleNode with an entry-point marker.
 *
 * The marker used to carry a tooltip reading "Entry point". Owner E2/H1: a
 * hover popup that only names what the badge already means is noise on a graph
 * node, so the badge now carries an `aria-label` (announced, no popup) and the
 * legend below the canvas is where entry points are explained.
 */
function EntryAwareModuleNode(props: NodeProps<ModuleNodeData>) {
  return (
    <div className="relative">
      {props.data.isEntryPoint && (
        <span
          aria-label="Entry point"
          className="absolute -left-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[0.5rem] font-bold text-primary-foreground shadow"
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
  /** Kinds toggled off in the legend — their nodes dim and stop intercepting
   * clicks instead of being removed (removal would relayout and jump the
   * viewport). */
  hiddenKinds?: Set<string>;
  onToggleKind?: (kind: string) => void;
  /** True when the caller already knows a node should be focused on this
   * mount (e.g. a `?focus=` deep link) — suppresses React Flow's own
   * declarative `fitView` so `ViewportFocus` is the sole viewport
   * writer on arrival. Without this, both fire around the same
   * measurement-ready moment and whichever lands last wins, which is
   * exactly why a redirect into this graph used to center/zoom
   * inconsistently while a manual node click (on an already-settled
   * graph, nothing else writing the viewport) always worked. */
  suppressInitialFit?: boolean;
  /** Bumped by the caller when node positions or the canvas container
   * change without the selection changing (a layout direction toggle, a
   * fullscreen toggle) — remounts the ReactFlow instance so its own
   * declarative `fitView` (already correct on first mount) reruns, instead
   * of racing an imperative `fitView()` call against React Flow's own
   * internal position-store sync. */
  refitSignal?: string | number;
  /** Returns true when this node opens a level below — see GraphCanvas. */
  onDrillInto?: (nodeId: string) => boolean;
  drill?: GraphDrill;
  /** `frame` only while resolving a `?focus=` deep link. */
  focusMode?: FocusMode;
  restoreViewport?: { x: number; y: number; zoom: number } | null;
  viewportRef?: MutableRefObject<(() => Viewport) | null>;
}

export function DependencyGraphView({
  nodes,
  edges,
  entryPoints,
  selectedNodeId,
  onSelectNode,
  hiddenKinds,
  onToggleKind,
  suppressInitialFit = false,
  refitSignal,
  onDrillInto,
  drill,
  focusMode,
  restoreViewport,
  viewportRef,
}: DependencyGraphViewProps) {
  const isDark = useIsDarkMode();
  const entryPointSet = useMemo(() => new Set(entryPoints), [entryPoints]);

  // Legend shows only kinds that actually occur on this canvas.
  const nodeKindById = useMemo(
    () => new Map(nodes.map((n) => [n.id, inferNodeType(n.id, n.metadata.exportedSymbols).type])),
    [nodes],
  );
  const presentKinds = useMemo(() => [...new Set(nodeKindById.values())], [nodeKindById]);

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
      nodes.map((node) => {
        const kind = nodeKindById.get(node.id);
        const kindHidden = kind !== undefined && (hiddenKinds?.has(kind) ?? false);
        return {
          id: node.id,
          type: "module",
          position: { x: node.x, y: node.y },
          ...(kindHidden ? { style: { opacity: 0.15, pointerEvents: "none" as const } } : {}),
          data: {
            label: node.label,
            kind: node.kind,
            filePath: node.id,
            exportedSymbols: node.metadata.exportedSymbols,
            importCount: node.metadata.importCount,
            externalImportCount: node.metadata.externalImportCount ?? 0,
            dependentCount: node.metadata.dependentCount,
            // The exported-name list double-counts re-exports and misses
            // file-local declarations; the server's count is the real one.
            symbolCount: node.metadata.symbolCount ?? node.metadata.exportedSymbols.length,
            summary: node.metadata.summary ?? null,
            role: node.metadata.role ?? null,
            fileCount: node.metadata.fileCount,
            internalImportCount: node.metadata.internalImportCount,
            isEntryPoint: entryPointSet.has(node.id),
            selected: node.id === selectedNodeId,
            dimmed: neighborIds !== null && !neighborIds.has(node.id),
          },
        };
      }),
    [nodes, entryPointSet, selectedNodeId, neighborIds, nodeKindById, hiddenKinds],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((edge) => {
        const isActive =
          neighborIds !== null &&
          (edge.source === selectedNodeId || edge.target === selectedNodeId);
        const endpointHidden =
          (hiddenKinds?.has(nodeKindById.get(edge.source) ?? "") ?? false) ||
          (hiddenKinds?.has(nodeKindById.get(edge.target) ?? "") ?? false);

        let label: string | undefined;
        if (selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId)) {
          if (edge.kind === "imports" || edge.kind === "dependency") {
            label = edge.source === selectedNodeId ? "IMPORTS" : "IMPORTED BY";
          } else {
            label = edge.kind.toUpperCase();
          }
        }

        const stroke = isActive ? "var(--primary)" : "var(--border)";
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
          // AUDIT C2 / UX §9.1: "the legend says an edge means the source
          // imports the target — direction is the whole semantic and is not
          // encoded at all". Both ends were identical dots.
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
          style: {
            opacity: endpointHidden ? 0.03 : neighborIds === null || isActive ? 1 : 0.1,
            strokeWidth: isActive ? 2 : 1,
            stroke,
          },
        };
      }),
    [edges, neighborIds, selectedNodeId, isDark, nodeKindById, hiddenKinds],
  );

  return (
    <GraphCanvas
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
      onDrillInto={onDrillInto}
      drill={drill}
      focusMode={focusMode}
      suppressInitialFit={suppressInitialFit}
      refitSignal={refitSignal}
      restoreViewport={restoreViewport}
      viewportRef={viewportRef}
    >
      <Panel position="top-left">
        <GraphLegend presentKinds={presentKinds} hiddenKinds={hiddenKinds} onToggleKind={onToggleKind} />
      </Panel>
      <Panel position="bottom-center">
        <GraphFirstVisitHint hasEntryPoints={entryPoints.length > 0} />
      </Panel>
    </GraphCanvas>
  );
}
