import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GraphPage } from "./GraphPage";

vi.mock("@/lib/graphData", () => {
  const graphPayload = {
    nodes: [
      { id: "index", label: "index", kind: "module", filePath: "index.ts", metadata: { exportedSymbols: ["main"], importCount: 2, dependentCount: 0 } },
      { id: "strings", label: "strings", kind: "module", filePath: "strings.ts", metadata: { exportedSymbols: ["trim"], importCount: 0, dependentCount: 1 } },
      { id: "logger", label: "logger", kind: "module", filePath: "logger.ts", metadata: { exportedSymbols: ["log"], importCount: 0, dependentCount: 1 } },
      { id: "userService", label: "userService", kind: "module", filePath: "userService.ts", metadata: { exportedSymbols: ["UserService", "listActiveUsers"], importCount: 1, dependentCount: 1 } },
    ],
    edges: [
      { id: "e1", source: "index", target: "strings", kind: "imports", weight: 1 },
      { id: "e2", source: "index", target: "logger", kind: "imports", weight: 1 },
      { id: "e3", source: "index", target: "userService", kind: "imports", weight: 1 },
    ],
    entryPoints: ["index"],
  };
  const mockResponse = {
    projectId: "proj-1",
    snapshotId: "snap-1",
    clustered: false,
    totalNodes: 4,
    totalEdges: 3,
    graph: graphPayload,
    fileAnalyses: [],
  };
  const classGraphPayload = {
    nodes: [
      { id: "userService.ts#UserService", label: "UserService", kind: "class", metadata: { exportedSymbols: ["list"], importCount: 1, dependentCount: 0 } },
      { id: "types.ts#IUserService", label: "IUserService", kind: "interface", metadata: { exportedSymbols: ["list"], importCount: 0, dependentCount: 1 } },
    ],
    edges: [
      { id: "c1", source: "userService.ts#UserService", target: "types.ts#IUserService", kind: "implements" },
    ],
    entryPoints: [],
  };
  const classResponse = {
    projectId: "proj-1",
    snapshotId: "snap-1",
    clustered: false,
    totalNodes: 2,
    totalEdges: 1,
    graph: classGraphPayload,
    fileAnalyses: [],
  };
  return {
    fetchDependencyGraph: vi.fn().mockResolvedValue(mockResponse),
    fetchClassGraph: vi.fn().mockResolvedValue(classResponse),
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

describe("GraphPage", () => {
  it("renders all module nodes from the dependency graph", async () => {
    renderGraphPage();

    await waitFor(() => {
      expect(screen.getByText("index")).toBeInTheDocument();
    });
    expect(screen.getByText("strings")).toBeInTheDocument();
    expect(screen.getByText("logger")).toBeInTheDocument();
    expect(screen.getByText("userService")).toBeInTheDocument();
    expect(screen.getByText("4 / 4 files")).toBeInTheDocument();
  });

  it("filters nodes by search and updates the count", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("index")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/search files, classes or methods/i),
      "logger",
    );

    await waitFor(() => {
      expect(screen.getByText("1 / 4 files")).toBeInTheDocument();
    });
    expect(screen.getByText("logger")).toBeInTheDocument();
    expect(screen.queryByText("strings")).not.toBeInTheDocument();
  });

  it("opens the symbol-doc info panel when a node is clicked", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("userService")).toBeInTheDocument());

    fireEvent.click(screen.getByText("userService"));

    // The panel header carries copy/open actions; detail resolves to null
    // (mocked), so the doc body settles into its terminal "no details"
    // state rather than spinning forever.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy path" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/no additional details/i)).toBeInTheDocument();
    });
  });

  it("switches to the Classes view and renders class/interface nodes", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("index")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Classes & interfaces" }));

    await waitFor(() => {
      expect(screen.getByText("UserService")).toBeInTheDocument();
    });
    expect(screen.getByText("IUserService")).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 2 classes/)).toBeInTheDocument();
  });
});
