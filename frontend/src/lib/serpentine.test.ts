import { describe, expect, it } from "vitest";
import { buildStepChain, choosePerRow, findSpine, layoutSerpentine, shouldSerpentine } from "./serpentine";
import type { GraphEdge, GraphNode } from "@/types/graph";

const node = (id: string): GraphNode => ({
  id,
  label: id,
  kind: "module",
  metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 },
});
const edge = (source: string, target: string): GraphEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  kind: "calls",
});

/** A straight chain of n steps, as a traced workflow produces. */
function chain(n: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = Array.from({ length: n }, (_, i) => node(`s${i}`));
  const edges = Array.from({ length: n - 1 }, (_, i) => edge(`s${i}`, `s${i + 1}`));
  return { nodes, edges };
}

describe("spine detection", () => {
  it("follows the longest chain from an entry point", () => {
    const { nodes, edges } = chain(5);
    expect(findSpine(nodes, edges)).to.deep.equal(["s0", "s1", "s2", "s3", "s4"]);
  });

  it("prefers the longer branch when a step forks", () => {
    const nodes = [node("a"), node("b"), node("short"), node("c"), node("d")];
    const edges = [edge("a", "b"), edge("b", "short"), edge("b", "c"), edge("c", "d")];
    expect(findSpine(nodes, edges)).to.deep.equal(["a", "b", "c", "d"]);
  });

  it("terminates on a cycle instead of recursing forever", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    const spine = findSpine(nodes, edges);
    expect(spine.length).to.be.greaterThan(0);
    expect(new Set(spine).size).to.equal(spine.length); // no repeats
  });

  it("returns something for a graph with no entry point", () => {
    const nodes = [node("a"), node("b")];
    expect(findSpine(nodes, [edge("a", "b"), edge("b", "a")]).length).to.be.greaterThan(0);
  });
});

describe("row width", () => {
  it("never strands a single node on the last row", () => {
    // This is the lopsided case the whole rule exists to avoid.
    for (let len = 6; len <= 40; len++) {
      const perRow = choosePerRow(len, 272, 160);
      expect(len % perRow, `${len} steps at ${perRow} per row leaves one stranded`).to.not.equal(1);
    }
  });

  it("stays within readable bounds", () => {
    for (let len = 6; len <= 60; len++) {
      const perRow = choosePerRow(len, 272, 160);
      expect(perRow).to.be.at.least(3);
      expect(perRow).to.be.at.most(8);
    }
  });
});

describe("serpentine placement", () => {
  it("alternates direction row by row", () => {
    const { nodes, edges } = chain(12);
    const out = layoutSerpentine(nodes, edges, { perRow: 4 });
    const byId = new Map(out.nodes.map((n) => [n.id, n]));

    // Row 0 runs left to right.
    expect(byId.get("s0")!.x).to.be.lessThan(byId.get("s3")!.x);
    // Row 1 runs right to left.
    expect(byId.get("s4")!.x).to.be.greaterThan(byId.get("s7")!.x);
    // Row 2 turns back again.
    expect(byId.get("s8")!.x).to.be.lessThan(byId.get("s11")!.x);
  });

  it("keeps the chain continuous across the turn", () => {
    const { nodes, edges } = chain(8);
    const out = layoutSerpentine(nodes, edges, { perRow: 4 });
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    // The last node of row 0 and the first of row 1 sit in the same column,
    // so the wrap is a clean vertical drop rather than a long diagonal.
    expect(byId.get("s4")!.x).to.equal(byId.get("s3")!.x);
    expect(byId.get("s4")!.y).to.be.greaterThan(byId.get("s3")!.y);
  });

  it("centres a short final row", () => {
    // 10 steps at 4 per row leaves 2 on the last row.
    const { nodes, edges } = chain(10);
    const out = layoutSerpentine(nodes, edges, { perRow: 4, nodeWidth: 100, colGap: 20 });
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    const rowWidth = 4 * 100 + 3 * 20; // 460
    const last = [byId.get("s8")!, byId.get("s9")!];
    const left = Math.min(...last.map((n) => n.x));
    const right = Math.max(...last.map((n) => n.x)) + 100;
    // Equal margins either side — the block reads as symmetric.
    expect(left).to.be.closeTo(rowWidth - right, 0.01);
  });

  it("gives every node a position", () => {
    const { nodes, edges } = chain(17);
    const out = layoutSerpentine(nodes, edges);
    expect(out.nodes).to.have.length(17);
    for (const n of out.nodes) {
      expect(Number.isFinite(n.x), `${n.id} x`).to.equal(true);
      expect(Number.isFinite(n.y), `${n.id} y`).to.equal(true);
    }
  });

  it("hangs branches below their anchor without overlapping the next row", () => {
    const { nodes, edges } = chain(8);
    const withBranch = {
      nodes: [...nodes, node("side")],
      edges: [...edges, edge("s1", "side")],
    };
    const out = layoutSerpentine(withBranch.nodes, withBranch.edges, { perRow: 4 });
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    const side = byId.get("side")!;
    const anchor = byId.get("s1")!;

    expect(side.onSpine).to.equal(false);
    expect(side.x).to.equal(anchor.x);
    expect(side.y).to.be.greaterThan(anchor.y);
    // The branch must not collide with row 1.
    expect(side.y).to.be.lessThan(byId.get("s4")!.y);
  });
});

describe("edge routing", () => {
  it("routes within a row horizontally and the turn vertically", () => {
    const { nodes, edges } = chain(8);
    const out = layoutSerpentine(nodes, edges, { perRow: 4 });

    expect(out.edgeRouting.get("s0->s1")).to.deep.equal({ sourceHandle: "r", targetHandle: "l", kind: "row" });
    // The turn at the end of row 0.
    expect(out.edgeRouting.get("s3->s4")).to.deep.equal({ sourceHandle: "b", targetHandle: "t", kind: "wrap" });
    // Row 1 runs right to left, so its handles are mirrored.
    expect(out.edgeRouting.get("s4->s5")).to.deep.equal({ sourceHandle: "l", targetHandle: "r", kind: "row" });
  });

  it("routes a branch as a branch", () => {
    const { nodes, edges } = chain(8);
    const out = layoutSerpentine([...nodes, node("side")], [...edges, edge("s1", "side")], { perRow: 4 });
    expect(out.edgeRouting.get("s1->side")?.kind).to.equal("branch");
  });

  it("still routes the turn vertically when the final row is centred", () => {
    // A centred short row can sit further sideways than it does below, which
    // a pure dx/dy rule would misread as a horizontal hop.
    const { nodes, edges } = chain(9);
    const out = layoutSerpentine(nodes, edges, { perRow: 4 });
    expect(out.edgeRouting.get("s7->s8")?.kind).to.equal("wrap");
  });
});

describe("when to serpentine", () => {
  it("leaves a short flow as a plain column", () => {
    const { nodes, edges } = chain(3);
    expect(shouldSerpentine(nodes, edges)).to.equal(false);
  });

  it("snakes a long chain", () => {
    const { nodes, edges } = chain(12);
    expect(shouldSerpentine(nodes, edges)).to.equal(true);
  });

  it("declines a graph that is mostly branches", () => {
    // A hub with many leaves is not a chain; dagre handles that shape better.
    const nodes = [node("hub"), ...Array.from({ length: 10 }, (_, i) => node(`leaf${i}`))];
    const edges = Array.from({ length: 10 }, (_, i) => edge("hub", `leaf${i}`));
    expect(shouldSerpentine(nodes, edges)).to.equal(false);
  });

  it("declines a graph too large to read as a snake", () => {
    const { nodes, edges } = chain(80);
    expect(shouldSerpentine(nodes, edges)).to.equal(false);
  });
});

/**
 * The two regressions the owner reported on live data, pinned.
 *
 * The rail advertised `COUNT(*) workflow_steps` while the canvas drew the
 * folded per-symbol graph, so OnboardBuddy's top-ranked flow said "8 steps"
 * over four nodes — and, because the same folded count fed `shouldSerpentine`,
 * ten of its first fourteen flows fell under the six-node threshold and were
 * laid out as vertical columns while claiming 7 to 14 steps.
 */
describe("a traced flow, as the rail describes it", () => {
  /** Two steps re-entering one symbol — the shape the fold used to collapse. */
  const steps = Array.from({ length: 14 }, (_, i) => ({
    stepOrder: i + 1,
    filePath: i % 2 === 0 ? "backend/src/api/routes/projects.ts" : "backend/src/worker/index.ts",
  }));

  it("draws one node per step, so the canvas count matches the rail's", () => {
    const chainOf = buildStepChain(steps, () => ({ label: "step", kind: "transform" }));
    expect(chainOf.nodes).to.have.length(steps.length);
    expect(new Set(chainOf.nodes.map((n) => n.id)).size).to.equal(steps.length);
    expect(chainOf.edges).to.have.length(steps.length - 1);
  });

  it("snakes that chain into rows wider than the block is tall", () => {
    const chainOf = buildStepChain(steps, () => ({ label: "step", kind: "transform" }));
    expect(shouldSerpentine(chainOf.nodes, chainOf.edges)).to.equal(true);

    const out = layoutSerpentine(chainOf.nodes, chainOf.edges, { nodeWidth: 256, nodeHeight: 88, rowGap: 84 });
    const rows = new Map<number, typeof out.nodes>();
    for (const n of out.nodes) rows.set(n.row, [...(rows.get(n.row) ?? []), n]);

    // More than one row, and every row runs across rather than down.
    expect(rows.size).to.be.greaterThan(1);
    expect(Math.max(...out.nodes.map((n) => n.col))).to.be.greaterThan(0);

    // Row 0 left to right, row 1 back right to left — the snake itself.
    const inOrder = (row: number) => (rows.get(row) ?? []).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const first = inOrder(0);
    const second = inOrder(1);
    expect(first[0]!.x).to.be.lessThan(first[first.length - 1]!.x);
    expect(second[0]!.x).to.be.greaterThan(second[second.length - 1]!.x);
    expect(second[0]!.y).to.be.greaterThan(first[0]!.y);

    // And the block is landscape, which is the whole point of snaking it.
    const width = Math.max(...out.nodes.map((n) => n.x)) + 256;
    const height = Math.max(...out.nodes.map((n) => n.y)) + 88;
    expect(width).to.be.greaterThan(height);
  });
});
