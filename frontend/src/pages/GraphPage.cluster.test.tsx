import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GraphPage } from "./GraphPage";
import { fetchDependencyGraph } from "@/lib/graphData";

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
  const fileNode = (path: string, label: string) => ({
    id: path,
    label,
    kind: "module",
    metadata: { exportedSymbols: [label], importCount: 1, dependentCount: 0 },
  });

  const root = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: true, totalNodes: 80, totalEdges: 120,
    graph: {
      nodes: [clusterNode("src/lib", 40), clusterNode("src/api", 40)],
      edges: [{ id: "e0", source: "cluster:src/lib", target: "cluster:src/api", kind: "dependency" }],
      entryPoints: [],
    },
    fileAnalyses: [],
  };

  // `src/lib` still has a group inside it, so a two-level drill is reachable —
  // that is what makes an intermediate breadcrumb meaningful.
  const lib = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: true, totalNodes: 40, totalEdges: 10,
    graph: {
      nodes: [clusterNode("src/lib/deep", 8), fileNode("src/lib/index.ts", "index")],
      edges: [],
      entryPoints: [],
    },
    fileAnalyses: [],
  };

  const leaf = (cluster: string) => ({
    projectId: "proj-1", snapshotId: "snap-1", clustered: false, totalNodes: 2, totalEdges: 1,
    graph: {
      nodes: [fileNode(`${cluster}/a.ts`, "a"), fileNode(`${cluster}/b.ts`, "b")],
      edges: [{ id: "e1", source: `${cluster}/a.ts`, target: `${cluster}/b.ts`, kind: "imports", weight: 1 }],
      entryPoints: [],
    },
    fileAnalyses: [],
  });

  return {
    fetchDependencyGraph: vi.fn().mockImplementation((_p: string, cluster?: string) =>
      Promise.resolve(!cluster ? root : cluster === "src/lib" ? lib : leaf(cluster)),
    ),
    fetchClassGraph: vi.fn().mockResolvedValue(null),
    fetchWorkflowsList: vi.fn().mockResolvedValue([]),
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
