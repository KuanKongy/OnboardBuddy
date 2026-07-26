import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GraphPage } from "./GraphPage";
import { fetchDependencyGraph, fetchFileSymbolGraph } from "@/lib/graphData";

/**
 * Drill-down navigation.
 *
 * The breadcrumb used to be built by splitting the current cluster path, and
 * "up one level" was `segments.slice(0, -1)` — a guess at a parent rather than
 * a record of where the user had been. Arriving on a deep link that
 * auto-drilled therefore offered crumbs for levels nobody had visited, and
 * Back went to a synthesized prefix instead of the previous view.
 *
 * The contract now: the breadcrumb lists levels actually visited, and Back
 * returns to the previous one.
 */

vi.mock("@/lib/graphData", () => {
  const clusterNode = (dir: string, files: number) => ({
    id: `cluster:${dir}`,
    label: `${dir}/ (${files} files)`,
    kind: "cluster",
    metadata: { exportedSymbols: [], importCount: files, dependentCount: 0, fileCount: files, directory: dir },
  });
  const fileNode = (path: string, label: string, symbolCount = 0) => ({
    id: path,
    label,
    kind: "module",
    metadata: { exportedSymbols: [label], importCount: 1, dependentCount: 0, symbolCount },
  });
  const symbolNode = (path: string, label: string, kind: string) => ({
    id: path,
    label,
    kind,
    metadata: { exportedSymbols: [], importCount: 1, dependentCount: 1, exported: true },
  });

  const root = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: true, totalNodes: 187, totalEdges: 120,
    level: { kind: "root", id: null, unit: "groups" },
    truncation: null,
    graph: {
      nodes: [clusterNode("src/lib", 40), clusterNode("src/api", 40), clusterNode("src/big", 107)],
      edges: [{ id: "e0", source: "cluster:src/lib", target: "cluster:src/api", kind: "dependency" }],
      entryPoints: [],
    },
    fileAnalyses: [],
  };

  // `src/lib` still has a group inside it, so a two-level drill is reachable —
  // that is what makes an intermediate breadcrumb meaningful. `api.ts` is the
  // file that has symbols under it.
  const lib = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: true, totalNodes: 40, totalEdges: 10,
    level: { kind: "cluster", id: "src/lib", unit: "groups and files" },
    truncation: null,
    graph: {
      nodes: [
        clusterNode("src/lib/deep", 8),
        fileNode("src/lib/index.ts", "index"),
        fileNode("src/lib/api.ts", "api", 3),
      ],
      edges: [],
      entryPoints: [],
    },
    fileAnalyses: [],
  };

  // A level the node cap actually bites into: 107 files, 60 drawn.
  const big = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: false, totalNodes: 107, totalEdges: 4,
    level: { kind: "cluster", id: "src/big", unit: "files" },
    truncation: {
      shown: 60, total: 107, hidden: 47, limit: 60, unit: "files",
      keptBy: "the files that import the most other project files",
      seeRest: null,
    },
    graph: {
      nodes: Array.from({ length: 60 }, (_, i) => fileNode(`src/big/f${i}.ts`, `f${i}`)),
      edges: [],
      entryPoints: [],
    },
    fileAnalyses: [],
  };

  const leaf = (cluster: string) => ({
    projectId: "proj-1", snapshotId: "snap-1", clustered: false, totalNodes: 2, totalEdges: 1,
    level: { kind: "cluster", id: cluster, unit: "files" },
    truncation: null,
    graph: {
      nodes: [fileNode(`${cluster}/a.ts`, "a"), fileNode(`${cluster}/b.ts`, "b")],
      edges: [{ id: "e1", source: `${cluster}/a.ts`, target: `${cluster}/b.ts`, kind: "imports", weight: 1 }],
      entryPoints: [],
    },
    fileAnalyses: [],
  });

  const symbols = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: false, totalNodes: 3, totalEdges: 1,
    level: { kind: "file", id: "src/lib/api.ts", unit: "symbols" },
    truncation: null,
    graph: {
      nodes: [
        symbolNode("src/lib/api.ts#createClient", "createClient", "function"),
        symbolNode("src/lib/api.ts#request", "request", "function"),
        symbolNode("src/lib/api.ts#ApiError", "ApiError", "class"),
      ],
      edges: [{
        id: "s1", source: "src/lib/api.ts#createClient", target: "src/lib/api.ts#request",
        kind: "calls", weight: 1,
      }],
      entryPoints: [],
    },
    fileAnalyses: [],
  };

  return {
    fetchDependencyGraph: vi.fn().mockImplementation((_p: string, cluster?: string) =>
      Promise.resolve(
        !cluster ? root : cluster === "src/lib" ? lib : cluster === "src/big" ? big : leaf(cluster),
      ),
    ),
    fetchFileSymbolGraph: vi.fn().mockResolvedValue(symbols),
    fetchClassGraph: vi.fn().mockResolvedValue(null),
    fetchWorkflowsList: vi.fn().mockResolvedValue({ workflows: [] }),
    fetchWorkflowGraph: vi.fn().mockResolvedValue(null),
    fetchNodeDetail: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

function renderGraphPage(entry = "/projects/proj-1/dependencies") {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/projects/:id/dependencies" element={<GraphPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

const drillInto = async (label: string) => {
  await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
  fireEvent.click(screen.getByText(label));
};

describe("GraphPage drill-down", () => {
  beforeEach(() => vi.mocked(fetchDependencyGraph).mockClear());

  it("drills into a group and shows one crumb for the level entered", async () => {
    renderGraphPage();
    await drillInto("src/lib/ (40 files)");

    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src/lib", null));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dependencies" })).toBeInTheDocument());
    // One crumb, for the level actually entered — not a crumb per path segment.
    expect(screen.getByText("lib")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "src" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("Back returns to the level you came from, not a parent path prefix", async () => {
    renderGraphPage();
    await drillInto("src/lib/ (40 files)");
    await waitFor(() => expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    // The old behaviour fetched "src" here — a level that was never on screen.
    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenLastCalledWith("proj-1", undefined, null));
    expect(fetchDependencyGraph).not.toHaveBeenCalledWith("proj-1", "src", null);
    await waitFor(() => expect(screen.getByText("src/api/ (40 files)")).toBeInTheDocument());
  });

  it("an intermediate crumb jumps back to that visited level", async () => {
    renderGraphPage();
    await drillInto("src/lib/ (40 files)");
    await drillInto("src/lib/deep/ (8 files)");

    // Two levels deep: the first is now an intermediate, clickable crumb.
    await waitFor(() => expect(screen.getByRole("button", { name: "lib" })).toBeInTheDocument());
    expect(screen.getByText("deep")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "lib" }));
    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenLastCalledWith("proj-1", "src/lib", null));
  });

  it("the breadcrumb root returns to all groups", async () => {
    renderGraphPage();
    await drillInto("src/lib/ (40 files)");
    await waitFor(() => expect(screen.getByRole("button", { name: "Dependencies" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Dependencies" }));

    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenLastCalledWith("proj-1", undefined, null));
    await waitFor(() => expect(screen.getByText("src/api/ (40 files)")).toBeInTheDocument());
  });

  it("clicking a leaf file selects it without navigating", async () => {
    renderGraphPage();
    await drillInto("src/lib/ (40 files)");
    await waitFor(() => expect(screen.getByText("index")).toBeInTheDocument());
    const callsBefore = vi.mocked(fetchDependencyGraph).mock.calls.length;

    fireEvent.click(screen.getByText("index"));

    // A file has no level beneath it: no fetch, no new crumb. This is the
    // selection/navigation split.
    expect(vi.mocked(fetchDependencyGraph).mock.calls.length).toBe(callsBefore);
    expect(screen.getByText("lib")).toBeInTheDocument();
    expect(screen.queryByText("index.ts")).not.toBeInTheDocument();
  });

  it("drills a file into the symbols it declares, and a symbol is the leaf", async () => {
    // The rung the ladder was missing: cluster → nested cluster → file →
    // symbols. `index` (no symbols) stays a leaf; `api` (3) opens a level.
    renderGraphPage();
    await drillInto("src/lib/ (40 files)");
    await drillInto("api");

    await waitFor(() =>
      expect(fetchFileSymbolGraph).toHaveBeenCalledWith("proj-1", "src/lib/api.ts", null),
    );
    // The file becomes a level of its own, so the group it came from turns
    // into an intermediate crumb.
    await waitFor(() => expect(screen.getByRole("button", { name: "lib" })).toBeInTheDocument());
    expect(screen.getByText("createClient")).toBeInTheDocument();
    expect(screen.getByText("ApiError")).toBeInTheDocument();
    expect(screen.getByText(/Symbols declared in/)).toBeInTheDocument();

    const symbolCalls = vi.mocked(fetchFileSymbolGraph).mock.calls.length;
    fireEvent.click(screen.getByText("createClient"));

    // A symbol has nothing below it: selection, not navigation.
    expect(vi.mocked(fetchFileSymbolGraph).mock.calls.length).toBe(symbolCalls);
    expect(screen.getByText("request")).toBeInTheDocument();
  });

  it("says how much of a capped level it is not drawing", async () => {
    // The cap was silent below the root: 60 of 107 files with the toolbar
    // reporting "60 / 60 files".
    renderGraphPage();
    await drillInto("src/big/ (107 files)");

    await waitFor(() => expect(screen.getByText(/Showing 60 of 107 files in big/)).toBeInTheDocument());
    expect(screen.getByText(/47 not drawn/)).toBeInTheDocument();
    expect(screen.getByText(/capped at 60 nodes/)).toBeInTheDocument();
    expect(screen.getByText(/47 more not drawn/)).toBeInTheDocument();
  });

  it("restores the drill level from the URL on a cold load", async () => {
    // A shared link must land on the same level, which is why the stack lives
    // in the URL rather than in component state.
    renderGraphPage("/projects/proj-1/dependencies?drill=cluster,src%2Flib,lib");
    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src/lib", null));
    await waitFor(() => expect(screen.getByText("lib")).toBeInTheDocument());
  });

  it("still understands a legacy ?cluster= link", async () => {
    renderGraphPage("/projects/proj-1/dependencies?cluster=src%2Fapi");
    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src/api", null));
    await waitFor(() => expect(screen.getByText("api")).toBeInTheDocument());
  });
});
