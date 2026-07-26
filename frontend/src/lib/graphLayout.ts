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

export interface RowBand {
  /** Rendered above the band by the caller; used here only for spacing. */
  label?: string;
  nodes: GraphNode[];
}

export interface RowLayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  colGap?: number;
  rowGap?: number;
  /** Extra space above a band after the first, for its heading. */
  bandGap?: number;
  /** Row width in nodes. Derived from the target aspect when omitted. */
  perRow?: number;
}

/**
 * Plain rows of nodes: left to right, wrapping down. No ranks, no edges
 * consulted, no relationships implied.
 *
 * Capabilities are a *set* — "what can this product do" — and running them
 * through a layered graph layout drew a dependency structure over them that
 * the evidence does not support and that the reader read as one. Dagre also
 * cannot help itself: with no edges every node lands in rank 0 and the packer
 * decides the shape. A grid is the honest picture of a set, and it is the one
 * that was asked for.
 *
 * Bands stack vertically, each starting on a fresh row, so a level can show
 * "the flows" above "the tables and services they reach" without drawing an
 * edge between every pair to say so.
 */
export function layoutRows(bands: RowBand[], options: RowLayoutOptions = {}): PositionedNode[] {
  const {
    nodeWidth = 248,
    nodeHeight = 92,
    colGap = 28,
    rowGap = 32,
    bandGap = 34,
  } = options;

  const total = bands.reduce((n, band) => n + band.nodes.length, 0);
  if (total === 0) return [];

  /**
   * Wide enough to read as a row, capped so a row never runs past the point
   * where a reader loses the way back to the start of the next one.
   *
   * The aspect term alone under-counts here: these cells are two and a half
   * times wider than they are tall, so a six-node set solves to two per row —
   * arithmetically 16:9 and visually a pair of columns, which is the opposite
   * of what a row of nodes is. Three is the floor, and fewer nodes than that
   * is the only thing that beats it.
   */
  const aspectFit = Math.round(Math.sqrt((total * TARGET_ASPECT * (nodeHeight + rowGap)) / (nodeWidth + colGap)));
  const perRow = options.perRow ?? Math.min(6, total, Math.max(3, aspectFit));

  const out: PositionedNode[] = [];
  let y = 0;
  for (const band of bands) {
    if (band.nodes.length === 0) continue;
    band.nodes.forEach((node, i) => {
      out.push({
        ...node,
        x: (i % perRow) * (nodeWidth + colGap),
        y: y + Math.floor(i / perRow) * (nodeHeight + rowGap),
      });
    });
    const rows = Math.ceil(band.nodes.length / perRow);
    y += rows * (nodeHeight + rowGap) + bandGap;
  }
  return out;
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
