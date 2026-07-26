import { useEffect, useRef } from "react";
import { useNodesInitialized, useReactFlow, useStore } from "reactflow";

/** How the camera reacts to a selection changing. */
export type FocusMode =
  /**
   * Selecting is not navigating. The camera holds still unless the node is
   * actually off-screen, and even then it only pans — the zoom level the user
   * set is theirs.
   */
  | "pan-into-view"
  /**
   * Frame the node: centre it and set a specific zoom. Reserved for arriving
   * from somewhere else (a `?focus=` deep link), where there is no viewport
   * the user chose and the target must be found for them.
   */
  | "frame";

/** Margin (px) inside the canvas edge before a node counts as off-screen. */
const EDGE_INSET = 32;
const PAN_MS = 350;

/**
 * Camera controller for selection. Must render INSIDE <ReactFlow> (needs the
 * provider). No-ops defensively in jsdom (zero-size canvas).
 *
 * It used to `setCenter(..., { zoom: 1.15 })` on every selection, so clicking
 * any node yanked the camera and changed the zoom. That made selecting feel
 * like navigating — while real navigation (drilling into a node) had no motion
 * at all, so the two were indistinguishable. Zoom now belongs to drill-down
 * (see `DrillCamera`); selection is at most a nudge.
 *
 * Waits on React Flow's `useNodesInitialized()`: writing the viewport before
 * every node has been measured can silently no-op, or compute a fit against
 * unsettled bounds. Invisible on a manual click (the graph had long settled)
 * but exactly why arriving via a redirect used to frame inconsistently.
 */
export function ViewportFocus({
  selectedNodeId,
  mode = "pan-into-view",
  zoom = 1.15,
  fitPadding = 0.2,
  fitMinZoom,
  ownsInitialFit = false,
  suspended = false,
}: {
  selectedNodeId: string | null;
  mode?: FocusMode;
  /** Only read in `frame` mode. */
  zoom?: number;
  fitPadding?: number;
  /** Floors how far the deselect fit-out may zoom out, so a long graph does
   * not shrink to an unreadable speck. Unset = unclamped. */
  fitMinZoom?: number;
  /** True when the caller suppressed React Flow's declarative initial
   * `fitView` because a selection is expected shortly — this component must
   * then do the first fit itself, or a `?focus=` target that turns out not to
   * exist leaves the graph unfitted. */
  ownsInitialFit?: boolean;
  /** True while a drill transition owns the viewport. Two writers animating
   * the same camera fight, and whichever lands last wins. */
  suspended?: boolean;
}) {
  const { setCenter, fitView, getNode, getViewport } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const mountedOnce = useRef(false);

  useEffect(() => {
    if (!nodesInitialized || suspended) return;

    const skipEmptyFirstMount = !mountedOnce.current && !selectedNodeId && !ownsInitialFit;
    mountedOnce.current = true;
    if (skipEmptyFirstMount) return;

    try {
      if (!selectedNodeId) {
        // Clicking empty space in pan-into-view mode is a deselect, not a
        // request to move the camera.
        if (mode === "frame") fitView({ duration: 500, padding: fitPadding, minZoom: fitMinZoom });
        return;
      }

      const node = getNode(selectedNodeId);
      if (!node) return;
      const w = node.width ?? 240;
      const h = node.height ?? 56;
      const cx = node.position.x + w / 2;
      const cy = node.position.y + h / 2;

      if (mode === "frame") {
        setCenter(cx, cy, { zoom, duration: 500 });
        return;
      }

      // pan-into-view: hold the camera unless the node is genuinely outside
      // the visible canvas, and pan at the CURRENT zoom when it is.
      const vp = getViewport();
      if (width > 0 && height > 0) {
        const left = node.position.x * vp.zoom + vp.x;
        const top = node.position.y * vp.zoom + vp.y;
        const right = left + w * vp.zoom;
        const bottom = top + h * vp.zoom;
        const visible =
          right > EDGE_INSET && left < width - EDGE_INSET &&
          bottom > EDGE_INSET && top < height - EDGE_INSET;
        if (visible) return;
      }
      setCenter(cx, cy, { zoom: vp.zoom, duration: PAN_MS });
    } catch {
      /* jsdom / zero-size container — camera motion is cosmetic only */
    }
  }, [selectedNodeId, nodesInitialized, suspended]);

  return null;
}
