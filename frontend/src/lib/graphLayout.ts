import dagre from "@dagrejs/dagre";
import type { GraphEdge, GraphNode } from "@/types/graph";

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

export interface LayoutOptions {
  /** Flow direction: LR for dependency maps, TB for step/flow graphs. */
  direction?: "LR" | "TB";
  nodeWidth?: number;
  nodeHeight?: number;
  /** Gap between ranks (columns in LR). */
  ranksep?: number;
  /** Gap between nodes in the same rank. */
  nodesep?: number;
}

/**
 * Layered graph layout via dagre (Sugiyama-style): ranks follow edge
 * direction, nodes within a rank are ordered to minimize crossings, and
 * disconnected components are packed side by side — no more single-file
 * "line of nodes" or stacks of overlapping disconnected nodes.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {},
): PositionedNode[] {
  const {
    direction = "LR",
    nodeWidth = 216,
    nodeHeight = 92,
    ranksep = 90,
    nodesep = 28,
  } = options;
  if (nodes.length === 0) return [];

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, ranksep, nodesep, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      // dagre positions are node centers; ReactFlow wants top-left corners.
      x: (pos?.x ?? 0) - nodeWidth / 2,
      y: (pos?.y ?? 0) - nodeHeight / 2,
    };
  });
}

/** Back-compat signature used by the dependency views. */
export function layoutDependencyGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  _entryPoints: string[],
): PositionedNode[] {
  return layoutGraph(nodes, edges, { direction: "LR" });
}
