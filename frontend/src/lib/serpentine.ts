import type { GraphEdge, GraphNode } from "@/types/graph";
import type { PositionedNode } from "@/lib/graphLayout";

/**
 * Serpentine (boustrophedon) layout for step chains.
 *
 * A workflow is a mostly-linear sequence, and dagre laid it out as one tall
 * top-to-bottom column: a 20-step flow became a strip roughly 20 nodes high
 * and 1 wide, so at any readable zoom you could see about three steps and had
 * to scroll a canvas to follow a single trace. Nothing about that shape uses
 * the width of the screen.
 *
 * Here the chain runs left to right, drops a row, runs back right to left, and
 * so on — the reading order stays continuous, and a long flow fills a
 * landscape canvas instead of overflowing a portrait one.
 *
 *     1 → 2 → 3 → 4
 *                 ↓
 *     8 ← 7 ← 6 ← 5
 *     ↓
 *     9 → 10
 *
 * Symmetry is treated as a requirement, not a nicety: a row count that leaves
 * a single node stranded on the last row reads as a mistake, so the row width
 * is chosen to avoid it and a short final row is centred under the block.
 */

export type HandleId = "t" | "r" | "b" | "l";

/** How an edge crosses the layout, which decides the handles it connects. */
export type EdgeRouteKind =
  /** Within a row: horizontal. */
  | "row"
  /** The turn at the end of a row: vertical. */
  | "wrap"
  /** Off the main chain: vertical, drawn differently so a fork reads as one. */
  | "branch";

export interface SerpentineOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  /** Horizontal gap between nodes in a row. */
  colGap?: number;
  /** Vertical gap between rows. */
  rowGap?: number;
  /** Vertical gap between a spine node and a branch hanging off it. */
  branchGap?: number;
  /** Force a row width instead of deriving one. */
  perRow?: number;
}

export interface SerpentineNode extends PositionedNode {
  row: number;
  col: number;
  onSpine: boolean;
}

export interface EdgeRoute {
  sourceHandle: HandleId;
  targetHandle: HandleId;
  kind: EdgeRouteKind;
}

export interface SerpentineLayout {
  nodes: SerpentineNode[];
  /** Keyed by edge id. */
  edgeRouting: Map<string, EdgeRoute>;
  perRow: number;
  /** Node ids of the detected main chain, in order. */
  spine: string[];
}

const DEFAULTS = {
  nodeWidth: 224,
  nodeHeight: 64,
  colGap: 48,
  rowGap: 96,
  branchGap: 24,
} as const;

/** Same landscape target the component packer already aims at. */
const TARGET_ASPECT = 16 / 9;

const MIN_PER_ROW = 3;
const MAX_PER_ROW = 8;

/**
 * The longest chain through the graph, which is the trace a reader follows.
 *
 * Steps arrive in DFS visit order from the backend, so insertion index is a
 * meaningful tie-break: when two continuations are the same length, the one
 * the tracer reached first is the one that reads as the main line.
 */
export function findSpine(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  if (nodes.length === 0) return [];
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const out = new Map<string, string[]>();
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));

  for (const e of edges) {
    if (!index.has(e.source) || !index.has(e.target) || e.source === e.target) continue;
    const list = out.get(e.source);
    if (list) list.push(e.target);
    else out.set(e.source, [e.target]);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const memo = new Map<string, string[]>();
  const visiting = new Set<string>();
  const longestFrom = (id: string): string[] => {
    const hit = memo.get(id);
    if (hit) return hit;
    // A back edge would otherwise recurse forever. It contributes NOTHING to
    // the path — returning `[id]` here instead would append a node already on
    // the chain, and the duplicate then gets positioned twice and corrupts the
    // spine index. A cycle simply has no longest path to report.
    if (visiting.has(id)) return [];
    visiting.add(id);
    let best: string[] = [];
    for (const child of out.get(id) ?? []) {
      const path = longestFrom(child);
      const better =
        path.length > best.length ||
        (path.length === best.length &&
          path.length > 0 &&
          (index.get(path[0]!) ?? 0) < (index.get(best[0]!) ?? 0));
      if (better) best = path;
    }
    visiting.delete(id);
    const result = [id, ...best];
    memo.set(id, result);
    return result;
  };

  // Entry points first; a graph that is all cycle still gets a start.
  const roots = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const starts = roots.length > 0 ? roots : [nodes[0]!];

  let spine: string[] = [];
  for (const start of starts) {
    const path = longestFrom(start.id);
    if (path.length > spine.length) spine = path;
  }
  return spine;
}

/**
 * How many nodes per row.
 *
 * Derived from the target aspect, then nudged to avoid a remainder of 1 —
 * a final row holding a single node is exactly the lopsided shape this layout
 * is supposed to prevent, and shifting the row width by one usually fixes it
 * at no cost to the overall proportions.
 */
export function choosePerRow(spineLength: number, cellWidth: number, cellHeight: number): number {
  if (spineLength <= MIN_PER_ROW) return Math.max(1, spineLength);
  const ideal = Math.round(Math.sqrt((spineLength * TARGET_ASPECT * cellHeight) / cellWidth));
  const clamp = (n: number) => Math.min(MAX_PER_ROW, Math.max(MIN_PER_ROW, n));

  const score = (p: number): number => {
    const remainder = spineLength % p;
    if (remainder === 0) return 100; // every row full
    if (remainder === 1) return 0; // one node alone on the last row
    return remainder; // a fuller last row reads better
  };

  const candidates = [...new Set([clamp(ideal - 1), clamp(ideal), clamp(ideal + 1)])];
  return candidates.reduce((best, p) => (score(p) > score(best) ? p : best));
}

/**
 * Whether a graph should snake rather than run as a plain column.
 *
 * A three-step flow is already readable as a column, and snaking it would add
 * turns for no gain. A graph that is mostly branches is not a chain at all and
 * belongs in dagre, whose whole job is layered layout.
 */
export function shouldSerpentine(nodes: GraphNode[], edges: GraphEdge[]): boolean {
  if (nodes.length < 6 || nodes.length > 60) return false;
  const spine = findSpine(nodes, edges);
  if (spine.length < 6) return false;
  const branchRatio = (nodes.length - spine.length) / nodes.length;
  return branchRatio < 0.5;
}

export function layoutSerpentine(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: SerpentineOptions = {},
): SerpentineLayout {
  const { nodeWidth, nodeHeight, colGap, rowGap, branchGap } = { ...DEFAULTS, ...options };
  const edgeRouting = new Map<string, EdgeRoute>();
  if (nodes.length === 0) return { nodes: [], edgeRouting, perRow: 0, spine: [] };

  const spine = findSpine(nodes, edges);
  const spineIndex = new Map(spine.map((id, i) => [id, i]));
  const cellWidth = nodeWidth + colGap;
  const perRow = options.perRow ?? choosePerRow(spine.length, cellWidth, nodeHeight + rowGap);
  const rowWidth = perRow * nodeWidth + (perRow - 1) * colGap;

  // ── Attach off-spine nodes to the nearest spine node ─────────────────────
  const neighbours = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = neighbours.get(a);
    if (list) list.push(b);
    else neighbours.set(a, [b]);
  };
  for (const e of edges) {
    if (e.source === e.target) continue;
    link(e.source, e.target);
    link(e.target, e.source);
  }

  const anchorOf = new Map<string, string>();
  for (const node of nodes) {
    if (spineIndex.has(node.id)) continue;
    // BFS outward until a spine node is reached; undirected, because a branch
    // can hang either side of the step that owns it.
    const seen = new Set([node.id]);
    let frontier = [node.id];
    let found: string | null = null;
    for (let depth = 0; depth < 6 && !found && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of neighbours.get(id) ?? []) {
          if (seen.has(nb)) continue;
          seen.add(nb);
          if (spineIndex.has(nb)) { found = nb; break; }
          next.push(nb);
        }
        if (found) break;
      }
      frontier = next;
    }
    // Orphans dock at the start rather than piling up at the origin.
    anchorOf.set(node.id, found ?? spine[0] ?? node.id);
  }

  const branchesByAnchor = new Map<string, string[]>();
  for (const [child, anchor] of anchorOf) {
    const list = branchesByAnchor.get(anchor);
    if (list) list.push(child);
    else branchesByAnchor.set(anchor, [child]);
  }

  // ── Row geometry ─────────────────────────────────────────────────────────
  const rowCount = Math.max(1, Math.ceil(spine.length / perRow));
  const rowOf = (i: number) => Math.floor(i / perRow);

  /** Deepest branch stack in each row, so rows never collide. */
  const rowExtra = new Array<number>(rowCount).fill(0);
  for (const [anchor, children] of branchesByAnchor) {
    const i = spineIndex.get(anchor);
    if (i === undefined) continue;
    const r = rowOf(i);
    rowExtra[r] = Math.max(rowExtra[r] ?? 0, children.length);
  }

  const rowY: number[] = [];
  let y = 0;
  for (let r = 0; r < rowCount; r++) {
    rowY.push(y);
    y += nodeHeight + (rowExtra[r] ?? 0) * (nodeHeight + branchGap) + rowGap;
  }

  const positioned = new Map<string, SerpentineNode>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  for (let i = 0; i < spine.length; i++) {
    const id = spine[i]!;
    const source = nodeById.get(id)!;
    const row = rowOf(i);
    const inRow = i % perRow;
    // Nodes actually on this row — the last one may be short.
    const rowSize = Math.min(perRow, spine.length - row * perRow);
    // Centre a short final row so the block stays symmetric instead of
    // trailing off to one side.
    const offset = (rowWidth - (rowSize * nodeWidth + (rowSize - 1) * colGap)) / 2;
    // Odd rows run right to left, which is what makes the chain continuous.
    const col = row % 2 === 0 ? inRow : rowSize - 1 - inRow;
    positioned.set(id, {
      ...source,
      x: offset + col * cellWidth,
      y: rowY[row] ?? 0,
      row,
      col,
      onSpine: true,
    });
  }

  for (const [anchor, children] of branchesByAnchor) {
    const base = positioned.get(anchor);
    children.forEach((child, k) => {
      const source = nodeById.get(child);
      if (!source) return;
      positioned.set(child, {
        ...source,
        x: base?.x ?? 0,
        y: (base?.y ?? 0) + (k + 1) * (nodeHeight + branchGap),
        row: base?.row ?? 0,
        col: base?.col ?? 0,
        onSpine: false,
      });
    });
  }

  // ── Edge routing ─────────────────────────────────────────────────────────
  for (const e of edges) {
    const a = positioned.get(e.source);
    const b = positioned.get(e.target);
    if (!a || !b) continue;

    // Consecutive spine steps are known from the chain itself, so the turn at
    // the end of a row is routed as a turn even when the centred final row
    // makes its horizontal offset larger than its vertical one.
    const ia = spineIndex.get(e.source);
    const ib = spineIndex.get(e.target);
    if (ia !== undefined && ib !== undefined && ib === ia + 1) {
      if (a.row === b.row) {
        edgeRouting.set(
          e.id,
          b.x > a.x ? { sourceHandle: "r", targetHandle: "l", kind: "row" } : { sourceHandle: "l", targetHandle: "r", kind: "row" },
        );
      } else {
        edgeRouting.set(e.id, { sourceHandle: "b", targetHandle: "t", kind: "wrap" });
      }
      continue;
    }

    if (!a.onSpine || !b.onSpine) {
      edgeRouting.set(e.id, { sourceHandle: "b", targetHandle: "t", kind: "branch" });
      continue;
    }

    // Any other spine-to-spine edge (a skip or a back edge): pick by geometry.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      edgeRouting.set(
        e.id,
        dx > 0 ? { sourceHandle: "r", targetHandle: "l", kind: "row" } : { sourceHandle: "l", targetHandle: "r", kind: "row" },
      );
    } else {
      edgeRouting.set(
        e.id,
        dy > 0 ? { sourceHandle: "b", targetHandle: "t", kind: "wrap" } : { sourceHandle: "t", targetHandle: "b", kind: "wrap" },
      );
    }
  }

  return {
    nodes: nodes.map((n) => positioned.get(n.id) ?? { ...n, x: 0, y: 0, row: 0, col: 0, onSpine: false }),
    edgeRouting,
    perRow,
    spine,
  };
}
