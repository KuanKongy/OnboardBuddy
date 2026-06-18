import type { GraphEdge, GraphNode } from "@/types/graph";

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

const COLUMN_WIDTH = 300;
const ROW_HEIGHT = 140;

/**
 * Assigns each node a column via longest-path-from-root leveling, then
 * stacks nodes within a column into rows. Roots are the declared entry
 * points, falling back to nodes with no incoming edges, falling back to
 * any node not reached by either (e.g. an isolated cycle).
 */
export function layoutDependencyGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  entryPoints: string[],
): PositionedNode[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incomingCount.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const level = new Map<string, number>();
  const roots = entryPoints.filter((id) => nodeIds.has(id));
  const rootSet = new Set(roots.length > 0 ? roots : []);
  if (rootSet.size === 0) {
    for (const [id, count] of incomingCount) {
      if (count === 0) rootSet.add(id);
    }
  }
  if (rootSet.size === 0 && nodes.length > 0) {
    rootSet.add(nodes[0]!.id);
  }

  const queue: string[] = [];
  for (const id of rootSet) {
    level.set(id, 0);
    queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = level.get(current) ?? 0;
    for (const next of outgoing.get(current) ?? []) {
      const candidate = currentLevel + 1;
      if (level.get(next) === undefined || candidate > level.get(next)!) {
        level.set(next, candidate);
        queue.push(next);
      }
    }
  }

  // Any node unreached (isolated cycle, disconnected component) gets
  // appended after the deepest known level.
  let maxLevel = 0;
  for (const value of level.values()) maxLevel = Math.max(maxLevel, value);
  for (const node of nodes) {
    if (!level.has(node.id)) {
      level.set(node.id, maxLevel + 1);
    }
  }

  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const col = level.get(node.id) ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  const positioned: PositionedNode[] = [];
  for (const [col, colNodes] of columns) {
    colNodes.forEach((node, row) => {
      positioned.push({
        ...node,
        x: col * COLUMN_WIDTH,
        y: row * ROW_HEIGHT,
      });
    });
  }

  return positioned;
}
