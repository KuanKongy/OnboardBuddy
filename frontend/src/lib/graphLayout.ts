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

/** Gap between packed components. */
const COMPONENT_GAP = 56;
/** Target canvas aspect ratio (width / height) for component packing. */
const TARGET_ASPECT = 16 / 9;

/**
 * Layered graph layout via dagre (Sugiyama-style), applied per connected
 * component. Plain dagre puts every edgeless node in rank 0, which renders
 * as one tall column of overlapping nodes — so components are laid out
 * independently and shelf-packed into rows approximating a 16:9 canvas,
 * with isolated nodes gathered into a compact grid block at the end.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {},
): PositionedNode[] {
  const {
    direction = "LR",
    nodeWidth = 248,
    nodeHeight = 92,
    ranksep = 90,
    nodesep = 28,
  } = options;
  if (nodes.length === 0) return [];

  const ids = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target,
  );

  // ── 1. Connected components (union-find) ─────────────────────────────────
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of validEdges) {
    const a = find(e.source);
    const b = find(e.target);
    if (a !== b) parent.set(a, b);
  }

  const componentNodes = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const root = find(n.id);
    componentNodes.set(root, [...(componentNodes.get(root) ?? []), n]);
  }
  const componentEdges = new Map<string, GraphEdge[]>();
  for (const e of validEdges) {
    const root = find(e.source);
    componentEdges.set(root, [...(componentEdges.get(root) ?? []), e]);
  }

  // ── 2. Lay out each multi-node component with dagre ──────────────────────
  interface ComponentBox {
    width: number;
    height: number;
    /** Node positions relative to the component's top-left corner. */
    positions: Map<string, { x: number; y: number }>;
  }

  const boxes: ComponentBox[] = [];
  const isolated: GraphNode[] = [];

  for (const [root, members] of componentNodes) {
    if (members.length === 1 && (componentEdges.get(root)?.length ?? 0) === 0) {
      isolated.push(members[0]!);
      continue;
    }

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, ranksep, nodesep, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const node of members) g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    for (const edge of componentEdges.get(root) ?? []) g.setEdge(edge.source, edge.target);
    dagre.layout(g);

    const positions = new Map<string, { x: number; y: number }>();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of members) {
      const pos = g.node(node.id);
      // dagre positions are node centers; ReactFlow wants top-left corners.
      const x = (pos?.x ?? 0) - nodeWidth / 2;
      const y = (pos?.y ?? 0) - nodeHeight / 2;
      positions.set(node.id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + nodeWidth);
      maxY = Math.max(maxY, y + nodeHeight);
    }
    for (const [id, pos] of positions) {
      positions.set(id, { x: pos.x - minX, y: pos.y - minY });
    }
    boxes.push({ width: maxX - minX, height: maxY - minY, positions });
  }

  // Isolated nodes become one grid-block "component" appended last.
  if (isolated.length > 0) {
    const cols = Math.max(1, Math.ceil(Math.sqrt((isolated.length * (nodeHeight + nodesep) * TARGET_ASPECT) / (nodeWidth + nodesep))));
    const positions = new Map<string, { x: number; y: number }>();
    isolated.forEach((node, i) => {
      positions.set(node.id, {
        x: (i % cols) * (nodeWidth + nodesep),
        y: Math.floor(i / cols) * (nodeHeight + nodesep),
      });
    });
    const rows = Math.ceil(isolated.length / cols);
    boxes.push({
      width: Math.min(isolated.length, cols) * (nodeWidth + nodesep) - nodesep,
      height: rows * (nodeHeight + nodesep) - nodesep,
      positions,
    });
  }

  // ── 3. Shelf-pack component boxes into rows near the target aspect ───────
  const totalArea = boxes.reduce((a, b) => a + (b.width + COMPONENT_GAP) * (b.height + COMPONENT_GAP), 0);
  const targetWidth = Math.max(
    Math.sqrt(totalArea * TARGET_ASPECT),
    ...boxes.map((b) => b.width),
  );

  // Biggest components first so small ones fill row remainders; the isolated
  // grid stays last so strays never lead the canvas.
  const order = boxes
    .map((box, i) => ({ box, i }))
    .sort((a, b) => {
      const lastIdx = isolated.length > 0 ? boxes.length - 1 : -1;
      if (a.i === lastIdx) return 1;
      if (b.i === lastIdx) return -1;
      return b.box.height * b.box.width - a.box.height * a.box.width;
    })
    .map((entry) => entry.box);

  const offsets = new Map<ComponentBox, { x: number; y: number }>();
  let shelfX = 16, shelfY = 16, shelfHeight = 0;
  for (const box of order) {
    if (shelfX > 16 && shelfX + box.width > targetWidth) {
      shelfX = 16;
      shelfY += shelfHeight + COMPONENT_GAP;
      shelfHeight = 0;
    }
    offsets.set(box, { x: shelfX, y: shelfY });
    shelfX += box.width + COMPONENT_GAP;
    shelfHeight = Math.max(shelfHeight, box.height);
  }

  // ── 4. Emit absolute positions ────────────────────────────────────────────
  const absolute = new Map<string, { x: number; y: number }>();
  for (const box of boxes) {
    const offset = offsets.get(box)!;
    for (const [id, pos] of box.positions) {
      absolute.set(id, { x: pos.x + offset.x, y: pos.y + offset.y });
    }
  }

  return nodes.map((node) => {
    const pos = absolute.get(node.id);
    return { ...node, x: pos?.x ?? 0, y: pos?.y ?? 0 };
  });
}

/** Back-compat signature used by the dependency views. */
export function layoutDependencyGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  _entryPoints: string[],
  direction: "LR" | "TB" = "LR",
): PositionedNode[] {
  return layoutGraph(nodes, edges, { direction });
}

/**
 * Caps each node's edges to its `maxPerDirection` strongest connections in
 * each direction (by weight, then insertion order) — dense graphs stay
 * readable without collapsing into a hairball. Assumes `edges` is already
 * filtered to the visible node set. Shared by the files and classes graph
 * views so both get the same readability guarantee.
 */
export function capEdgesPerNode(edges: GraphEdge[], maxPerDirection = 3): GraphEdge[] {
  const sorted = [...edges].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
  const perNode = new Map<string, number>();
  const keptIds = new Set<string>();
  for (const edge of sorted) {
    const out = perNode.get(`out:${edge.source}`) ?? 0;
    const inn = perNode.get(`in:${edge.target}`) ?? 0;
    if (out >= maxPerDirection && inn >= maxPerDirection) continue;
    perNode.set(`out:${edge.source}`, out + 1);
    perNode.set(`in:${edge.target}`, inn + 1);
    keptIds.add(edge.id);
  }
  return edges.filter((edge) => keptIds.has(edge.id));
}
