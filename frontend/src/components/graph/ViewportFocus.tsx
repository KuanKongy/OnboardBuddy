import { useEffect, useRef } from "react";
import { useNodesInitialized, useReactFlow } from "reactflow";

/**
 * Animated viewport focus: selecting a node glides the camera onto it,
 * deselecting glides back out to the full graph — the "you clicked in, this
 * is how you get out" affordance. Must render INSIDE <ReactFlow> (needs the
 * provider). Skips the initial mount when nothing is selected so it never
 * fights the declarative `fitView`, and no-ops defensively in jsdom
 * (zero-size canvas).
 *
 * Waits on React Flow's own `useNodesInitialized()` before doing anything —
 * calling `setCenter`/`fitView` before React Flow's internal store has
 * measured every node can silently no-op (or, for `fitView`, compute a
 * zoom against not-yet-settled bounds). That race was invisible on a
 * manual click (the graph had already settled long before you could click)
 * but is exactly why a redirect into this graph — nothing measured yet on
 * arrival — used to fail to center/zoom, or do so inconsistently.
 */
export function ViewportFocus({
  selectedNodeId,
  zoom = 1.15,
  fitPadding = 0.2,
  fitMinZoom,
  ownsInitialFit = false,
}: {
  selectedNodeId: string | null;
  zoom?: number;
  fitPadding?: number;
  /** Floors how far the deselect-to-full-view glide is allowed to zoom out —
   * without it, a long/tall graph fits by shrinking to whatever tiny zoom
   * makes everything visible, which reads as "extremely zoomed out" rather
   * than readable. Unset preserves the old unclamped fitView behavior. */
  fitMinZoom?: number;
  /** True when the caller suppressed React Flow's own declarative initial
   * `fitView` (e.g. `DependencyGraphView`'s `suppressInitialFit`) because a
   * selection is expected shortly — this component must then do the very
   * first fit itself instead of skipping it, or nothing ever fits the
   * view (e.g. a `?focus=` target that turns out not to exist). */
  ownsInitialFit?: boolean;
}) {
  const { setCenter, fitView, getNode } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const mountedOnce = useRef(false);

  useEffect(() => {
    if (!nodesInitialized) return;

    const skipEmptyFirstMount = !mountedOnce.current && !selectedNodeId && !ownsInitialFit;
    mountedOnce.current = true;
    if (skipEmptyFirstMount) return;

    try {
      if (selectedNodeId) {
        const node = getNode(selectedNodeId);
        if (!node) return;
        const w = node.width ?? 240; // ModuleNode is w-60
        const h = node.height ?? 56;
        setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom, duration: 500 });
      } else {
        fitView({ duration: 500, padding: fitPadding, minZoom: fitMinZoom });
      }
    } catch {
      /* jsdom / zero-size container — animation is cosmetic only */
    }
  }, [selectedNodeId, nodesInitialized]);

  return null;
}
