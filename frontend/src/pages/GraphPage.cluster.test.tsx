import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GraphPage } from "./GraphPage";
import { fetchDependencyGraph } from "@/lib/graphData";

/** Clustered-mode drill-down: breadcrumb segments + the up-one-level button. */

vi.mock("@/lib/graphData", () => {
  const clusteredResponse = {
    projectId: "proj-1",
    snapshotId: "snap-1",
    clustered: true,
    totalNodes: 80,
    totalEdges: 120,
    graph: {
      nodes: [
        {
          id: "cluster:src/lib",
          label: "src/lib/ (40 files)",
          kind: "cluster",
          metadata: { exportedSymbols: [], importCount: 40, dependentCount: 0, fileCount: 40, directory: "src/lib" },
        },
        {
          id: "cluster:src/api",
          label: "src/api/ (40 files)",
          kind: "cluster",
          metadata: { exportedSymbols: [], importCount: 12, dependentCount: 0, fileCount: 40, directory: "src/api" },
        },
      ],
      edges: [
        { id: "src/lib->src/api", source: "cluster:src/lib", target: "cluster:src/api", kind: "dependency" },
      ],
      entryPoints: [],
    },
    fileAnalyses: [],
  };
  const drilledResponse = (cluster: string) => ({
    projectId: "proj-1",
    snapshotId: "snap-1",
    clustered: false,
    totalNodes: 2,
    totalEdges: 1,
    graph: {
      nodes: [
        { id: `${cluster}/a.ts`, label: "a", kind: "module", metadata: { exportedSymbols: ["a"], importCount: 1, dependentCount: 0 } },
        { id: `${cluster}/b.ts`, label: "b", kind: "module", metadata: { exportedSymbols: ["b"], importCount: 0, dependentCount: 1 } },
      ],
      edges: [{ id: "e1", source: `${cluster}/a.ts`, target: `${cluster}/b.ts`, kind: "imports", weight: 1 }],
      entryPoints: [],
    },
    fileAnalyses: [],
  });
  return {
    fetchDependencyGraph: vi.fn().mockImplementation((_projectId: string, cluster?: string) =>
      Promise.resolve(cluster ? drilledResponse(cluster) : clusteredResponse),
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
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

function renderGraphPage() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/proj-1/dependencies"]}>
        <Routes>
          <Route path="/projects/:id/dependencies" element={<GraphPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("GraphPage clustered drill-down", () => {
  beforeEach(() => {
    vi.mocked(fetchDependencyGraph).mockClear();
  });

  it("drills into a cluster and renders the breadcrumb path segments", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("src/lib/ (40 files)")).toBeInTheDocument());

    fireEvent.click(screen.getByText("src/lib/ (40 files)"));

    await waitFor(() => {
      expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src/lib", null);
    });
    // Breadcrumb: Dependencies / src / lib — root and intermediate are buttons.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dependencies" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "src" })).toBeInTheDocument();
    expect(screen.getByText("lib")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /up one level/i })).toBeInTheDocument();
  });

  it("the up-one-level button re-fetches the parent prefix", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("src/lib/ (40 files)")).toBeInTheDocument());
    fireEvent.click(screen.getByText("src/lib/ (40 files)"));
    await waitFor(() => expect(screen.getByRole("button", { name: /up one level/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /up one level/i }));

    await waitFor(() => {
      expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src", null);
    });
  });

  it("an intermediate breadcrumb segment drills up to that prefix", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("src/lib/ (40 files)")).toBeInTheDocument());
    fireEvent.click(screen.getByText("src/lib/ (40 files)"));
    await waitFor(() => expect(screen.getByRole("button", { name: "src" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "src" }));

    await waitFor(() => {
      expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src", null);
    });
  });

  it("the breadcrumb root returns to all groups", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("src/lib/ (40 files)")).toBeInTheDocument());
    fireEvent.click(screen.getByText("src/lib/ (40 files)"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dependencies" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Dependencies" }));

    await waitFor(() => {
      expect(fetchDependencyGraph).toHaveBeenLastCalledWith("proj-1", undefined, null);
    });
    await waitFor(() => expect(screen.getByText("src/api/ (40 files)")).toBeInTheDocument());
  });
});
