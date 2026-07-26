import { useEffect, type MutableRefObject, type ReactNode } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type Node,
  type NodeTypes,
  type Viewport,
} from "reactflow";
import "reactflow/dist/style.css";
import { DrillCamera } from "@/components/graph/DrillCamera";
import { ViewportFocus, type FocusMode } from "@/components/graph/ViewportFocus";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import type { GraphDrill } from "@/hooks/useGraphDrill";

export interface GraphCanvasProps {
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  /**
   * Called when the clicked node has a level beneath it. Returning false (or
   * omitting the prop) means the node is a leaf and the click is a plain
   * selection — which is the difference between "show me this" and "go here".
   */
  onDrillInto?: (nodeId: string) => boolean;
  drill?: GraphDrill;
  focusMode?: FocusMode;
  fitPadding?: number;
  fitMinZoom?: number;
  minZoom?: number;
  suppressInitialFit?: boolean;
  refitSignal?: string | number;
  restoreViewport?: { x: number; y: number; zoom: number } | null;
  /**
   * Filled with a viewport reader. Only a component inside
   * <ReactFlowProvider> can call `useReactFlow`, so a page that wants to save
   * the camera before navigating away has to be handed the accessor.
   */
  viewportRef?: MutableRefObject<(() => Viewport) | null>;
  showMiniMap?: boolean;
  /** React Flow <Panel> children (legend, hints, toolbars). */
  children?: ReactNode;
}

/** Publishes `getViewport` to the parent; renders nothing. */
function ViewportProbe({ target }: { target: MutableRefObject<(() => Viewport) | null> }) {
  const { getViewport } = useReactFlow();
  useEffect(() => {
    target.current = getViewport;
    return () => { target.current = null; };
  }, [getViewport, target]);
  return null;
}

/**
 * The one `<ReactFlow>` wrapper.
 *
 * Dependencies, Architecture and Workflows each carried their own copy of the
 * same `onNodeClick` / `onSelectionChange` / `onPaneClick` triple — comments
 * included — so every fix to click behaviour had to be made three times and
 * drifted between them. They also each decided independently what selection
 * did to the camera, which is how "clicking a node zooms" ended up being true
 * everywhere at once.
 *
 * Selection and navigation are now distinct: `onSelectNode` opens the detail
 * panel and never moves the camera beyond a nudge; `onDrillInto` is a
 * navigation event that plays the zoom transition.
 */
export function GraphCanvas({
  nodes,
  edges,
  nodeTypes,
  selectedNodeId,
  onSelectNode,
  onDrillInto,
  drill,
  focusMode = "pan-into-view",
  fitPadding = 0.2,
  fitMinZoom,
  minZoom = 0.05,
  suppressInitialFit = false,
  refitSignal,
  restoreViewport,
  viewportRef,
  showMiniMap = true,
  children,
}: GraphCanvasProps) {
  const isDark = useIsDarkMode();
  const busy = drill?.busy ?? false;

  /** One decision point for both mouse and keyboard activation. */
  const activate = (nodeId: string) => {
    // A click landing mid-transition would push a second history entry and
    // leave the camera fighting itself.
    if (busy) return;
    if (onDrillInto?.(nodeId)) return;
    onSelectNode(nodeId);
  };

  return (
    <ReactFlowProvider>
      <div
        className="h-full w-full"
        data-drill-phase={drill?.phase ?? "idle"}
        data-drill-busy={busy ? "true" : "false"}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          // Frozen during a transition so a stray click cannot start a second
          // one; the phase attribute above tells tests when it is safe again.
          elementsSelectable={!busy}
          nodesFocusable={!busy}
          onNodeClick={(_, node) => activate(node.id)}
          onSelectionChange={({ nodes: selected }) => {
            // Keyboard activation (Tab to a node, Enter/Space) never fires
            // onNodeClick — only this. It also fires alongside a mouse click,
            // which is harmless because both paths are idempotent. An empty
            // selection is ignored rather than treated as a deselect: it also
            // means "nothing clicked yet", e.g. right after a deep link.
            if (selected.length > 0) activate(selected[0]!.id);
          }}
          onPaneClick={() => !busy && onSelectNode(null)}
          fitView={!suppressInitialFit}
          fitViewOptions={{ padding: fitPadding } satisfies FitViewOptions}
          minZoom={minZoom}
          proOptions={{ hideAttribution: true }}
          key={refitSignal}
        >
          <ViewportFocus
            selectedNodeId={selectedNodeId}
            mode={focusMode}
            fitPadding={fitPadding}
            fitMinZoom={fitMinZoom}
            ownsInitialFit={suppressInitialFit}
            // Two writers animating one camera fight; the drill wins while running.
            suspended={busy}
          />
          {drill && (
            <DrillCamera phase={drill.phase} anchorNodeId={drill.anchorNodeId} restoreViewport={restoreViewport} />
          )}
          {viewportRef && <ViewportProbe target={viewportRef} />}

          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color={isDark ? "oklch(0.28 0.02 264)" : "oklch(0.8 0.01 265)"}
          />
          <Controls className="!bg-card !border-border [&_button]:!bg-card [&_button]:!border-border [&_button]:!text-muted-foreground [&_button:hover]:!bg-accent [&_button_svg]:!fill-current" />
          {showMiniMap && (
            <MiniMap
              pannable
              zoomable
              className="!bg-card !border-border"
              nodeColor={isDark ? "oklch(0.3 0.02 264)" : "oklch(0.85 0.008 265)"}
              maskColor={isDark ? "oklch(0.17 0.015 264 / 0.7)" : "oklch(0.95 0.005 265 / 0.7)"}
            />
          )}
          {children}
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
