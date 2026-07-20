import { useEffect, useRef } from "react";
import { useReactFlow } from "reactflow";

/**
 * Animated viewport focus: selecting a node glides the camera onto it,
 * deselecting glides back out to the full graph — the "you clicked in, this
 * is how you get out" affordance. Must render INSIDE <ReactFlow> (needs the
 * provider). Skips the initial mount so it never fights the declarative
 * fitView, and no-ops defensively in jsdom (zero-size canvas).
 */
export function ViewportFocus({
  selectedNodeId,
  zoom = 1.15,
  fitPadding = 0.2,
}: {
  selectedNodeId: string | null;
  zoom?: number;
  fitPadding?: number;
}) {
  const { setCenter, fitView, getNode } = useReactFlow();
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (!selectedNodeId) return;
      // First mount with a pre-selected node (e.g. a ?focus=/?cluster= deep
      // link): defer to the next frame so the declarative `fitView` prop
      // finishes its own initial positioning/measurement first, then glide
      // to the target — running synchronously here would race node
      // measurement (dimensions aren't known yet on the very first tick).
      const raf = requestAnimationFrame(() => {
        try {
          const node = getNode(selectedNodeId);
          if (!node) return;
          const w = node.width ?? 208; // ModuleNode is w-52
          const h = node.height ?? 56;
          setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom, duration: 500 });
        } catch {
          /* jsdom / zero-size container — animation is cosmetic only */
        }
      });
      return () => cancelAnimationFrame(raf);
    }
    try {
      if (selectedNodeId) {
        const node = getNode(selectedNodeId);
        if (!node) return;
        const w = node.width ?? 208; // ModuleNode is w-52
        const h = node.height ?? 56;
        setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom, duration: 500 });
      } else {
        fitView({ duration: 500, padding: fitPadding });
      }
    } catch {
      /* jsdom / zero-size container — animation is cosmetic only */
    }
  }, [selectedNodeId]);

  return null;
}
