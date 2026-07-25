import { useEffect, useRef } from "react";
import { useNodesInitialized, useReactFlow } from "reactflow";
import { DRILL_TIMING, type DrillPhase } from "@/hooks/useGraphDrill";

/**
 * The camera half of drill-down. Must render INSIDE <ReactFlow>.
 *
 * `useGraphDrill` owns *when* each phase happens; this owns *what the camera
 * does* during it, because only a component inside the provider can touch the
 * viewport. Splitting them this way keeps the machine testable without React
 * Flow, and mirrors how `ViewportFocus` already works.
 *
 * The motion is deliberately a single continuous gesture:
 *
 *   zoom-in   dive toward the clicked node, past the point of legibility
 *   (swap)    child data mounts while the camera is buried in the node
 *   settle    pull back out to frame the child level
 *
 * Going up runs the same shapes in reverse, so the two directions read as
 * opposites instead of as two unrelated jumps.
 */
export function DrillCamera({
  phase,
  anchorNodeId,
  restoreViewport,
}: {
  phase: DrillPhase;
  anchorNodeId: string | null;
  /** Viewport saved when this level was left, if any. */
  restoreViewport?: { x: number; y: number; zoom: number } | null;
}) {
  const { getNode, setCenter, fitView, getViewport, setViewport } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const lastPhase = useRef<DrillPhase>("idle");

  useEffect(() => {
    const prev = lastPhase.current;
    lastPhase.current = phase;
    if (prev === phase) return;

    try {
      if (phase === "zoom-in" || phase === "zoom-out") {
        const node = anchorNodeId ? getNode(anchorNodeId) : null;
        const vp = getViewport();
        if (!node) return;
        const cx = node.position.x + (node.width ?? 240) / 2;
        const cy = node.position.y + (node.height ?? 56) / 2;
        // Dive past legibility on the way down; on the way up this is the
        // "emerging from inside the node" start position.
        setCenter(cx, cy, { zoom: vp.zoom * DRILL_TIMING.punchIn, duration: phase === "zoom-in" ? DRILL_TIMING.zoomIn : 0 });
        return;
      }

      if (phase === "settle") {
        // The child level has just mounted. Start it slightly zoomed in from
        // where the dive ended so the pull-back is continuous, then frame it.
        if (!nodesInitialized) {
          fitView({ duration: DRILL_TIMING.settle, padding: 0.2 });
          return;
        }
        if (restoreViewport) {
          // Returning to a level the user had positioned themselves — put the
          // camera back rather than refitting and discarding their framing.
          setViewport(restoreViewport, { duration: DRILL_TIMING.settle });
          return;
        }
        const vp = getViewport();
        setViewport({ ...vp, zoom: vp.zoom * DRILL_TIMING.punchOut }, { duration: 0 });
        fitView({ duration: DRILL_TIMING.settle, padding: 0.2 });
      }
    } catch {
      /* jsdom / zero-size container — camera motion is cosmetic only */
    }
  }, [phase, anchorNodeId, nodesInitialized]);

  return null;
}
