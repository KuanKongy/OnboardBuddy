import { describe, expect, it } from "vitest";
import { layoutGraph } from "./graphLayout";
import type { GraphEdge, GraphNode } from "@/types/graph";

const NODE_WIDTH = 216;
const NODE_HEIGHT = 92;

function node(id: string): GraphNode {
  return { id, label: id, kind: "module", metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } };
}

function edge(source: string, target: string): GraphEdge {
  return { id: `${source}->${target}`, source, target, kind: "imports" };
}

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return (
    a.x < b.x + NODE_WIDTH &&
    b.x < a.x + NODE_WIDTH &&
    a.y < b.y + NODE_HEIGHT &&
    b.y < a.y + NODE_HEIGHT
  );
}

describe("layoutGraph component packing", () => {
  it("never stacks disconnected nodes on top of each other", () => {
    // 8 isolated nodes: plain dagre put them all in rank 0 — one overlapping
    // vertical column. The packed layout must keep every pair disjoint.
    const nodes = Array.from({ length: 8 }, (_, i) => node(`iso-${i}`));
    const positioned = layoutGraph(nodes, []);

    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        expect(
          overlaps(positioned[i]!, positioned[j]!),
          `${positioned[i]!.id} overlaps ${positioned[j]!.id}`,
        ).toBe(false);
      }
    }
  });

  it("spreads isolated nodes horizontally, not into one column", () => {
    const nodes = Array.from({ length: 9 }, (_, i) => node(`iso-${i}`));
    const positioned = layoutGraph(nodes, []);
    const distinctX = new Set(positioned.map((p) => p.x));
    expect(distinctX.size).toBeGreaterThan(1);
  });

  it("packs disconnected components side by side without overlap", () => {
    // Two chains + one isolated node = three components.
    const nodes = [node("a1"), node("a2"), node("b1"), node("b2"), node("stray")];
    const edges = [edge("a1", "a2"), edge("b1", "b2")];
    const positioned = layoutGraph(nodes, edges);

    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        expect(overlaps(positioned[i]!, positioned[j]!)).toBe(false);
      }
    }

    // Edges still flow left→right inside each component.
    const byId = new Map(positioned.map((p) => [p.id, p]));
    expect(byId.get("a2")!.x).toBeGreaterThan(byId.get("a1")!.x);
    expect(byId.get("b2")!.x).toBeGreaterThan(byId.get("b1")!.x);
  });

  it("keeps a single connected graph layered as before", () => {
    const nodes = [node("root"), node("mid"), node("leaf")];
    const edges = [edge("root", "mid"), edge("mid", "leaf")];
    const positioned = layoutGraph(nodes, edges);
    const byId = new Map(positioned.map((p) => [p.id, p]));
    expect(byId.get("mid")!.x).toBeGreaterThan(byId.get("root")!.x);
    expect(byId.get("leaf")!.x).toBeGreaterThan(byId.get("mid")!.x);
  });
});
