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
    fetchWorkflowsList: vi.fn().mockResolvedValue({ workflows: [] }),
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

  /**
   * Bug #70(2): "search updates the count but not the camera."
   *
   * Confirmed live — a query reading "2 / 60 files" left the canvas completely
   * blank, because filtering re-runs the layout and the survivors land outside
   * the viewport the user was on. The count claimed matches the screen did not
   * show, so search read as broken.
   *
   * `refitSignal` is the camera: GraphCanvas keys React Flow on it, so a change
   * remounts the flow and reruns its declarative `fitView` over the filtered
   * node set. jsdom gives the canvas no size, so `fitView` itself is a no-op
   * there — the assertion is on the signal, which is the thing search was not
   * driving. (Before this fix the signal was `${direction}:${fullscreen}` and
   * a search could never change it.)
   */
  it("refits the camera onto the search result, once per settled query", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("index")).toBeInTheDocument());

    const canvas = () => document.querySelector("[data-refit-signal]") as HTMLElement;
    const before = canvas().getAttribute("data-refit-signal");

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/search files, classes or methods/i), "logger");

    await waitFor(() => {
      expect(canvas().getAttribute("data-refit-signal")).not.toBe(before);
    });
    // The camera is aimed at the settled query, not at a prefix of it — six
    // keystrokes must not leave the graph framed on "logge".
    expect(canvas().getAttribute("data-refit-signal")).toContain("logger");
    expect(screen.getByText("logger")).toBeInTheDocument();

    // Clearing snaps straight back to the whole level rather than waiting out
    // the debounce on an empty box.
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => {
      expect(canvas().getAttribute("data-refit-signal")).toBe(before);
    });
    expect(screen.getByText("4 / 4 files")).toBeInTheDocument();
  });

  /**
   * The other half of #70(2): "the search input is not debounced, so each
   * keystroke re-runs a full graph re-layout". The input must still echo every
   * character — a laggy search box is its own bug — while the expensive
   * pipeline behind it sees one settled value.
   */
  it("echoes every keystroke but only re-lays-out once typing settles", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("index")).toBeInTheDocument());

    const canvas = document.querySelector("[data-refit-signal]") as HTMLElement;
    // Every distinct camera signal the graph passes through while typing. Each
    // one is a full re-filter + re-layout, so the undebounced version of this
    // page produced one per character.
    const seen: string[] = [canvas.getAttribute("data-refit-signal") ?? ""];
    const observer = new MutationObserver(() => {
      const now = document.querySelector("[data-refit-signal]")?.getAttribute("data-refit-signal") ?? "";
      if (now !== seen[seen.length - 1]) seen.push(now);
    });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-refit-signal"] });

    try {
      const user = userEvent.setup();
      const box = screen.getByPlaceholderText(/search files, classes or methods/i) as HTMLInputElement;
      await user.type(box, "logger");

      expect(box.value, "the box must echo every keystroke immediately").toBe("logger");
      await waitFor(() => {
        expect(seen[seen.length - 1]).toContain("logger");
      });
    } finally {
      observer.disconnect();
    }

    // The whole point: no signal for "l", "lo", "log"… Only the settled query
    // reaches the layout.
    const prefixes = ["logge", "logg", "log", "lo"];
    for (const prefix of prefixes) {
      expect(
        seen.some((s) => s.endsWith(`:${prefix}`)),
        `re-laid out mid-word on "${prefix}" — the input is not debounced`,
      ).toBe(false);
    }
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

  /**
   * The a11y sweep measured ~38% of this tab's controls outside the tab order:
   * the icon-only fullscreen toggle, the edge-cap toggle, the LR/TB pair and
   * the level-count badge were all labelled by a native `title` on an element
   * that could not be focused, so the whole toolbar was mouse-only.
   */
  it("puts every toolbar control in the tab order", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("index")).toBeInTheDocument());

    const controls: HTMLElement[] = [
      screen.getByRole("button", { name: "Fullscreen" }),
      screen.getByRole("button", { name: "Show all edges" }),
      screen.getByRole("button", { name: "LR" }),
      screen.getByRole("button", { name: "TB" }),
      screen.getByRole("button", { name: "Files" }),
      screen.getByRole("button", { name: "Classes & interfaces" }),
      screen.getByPlaceholderText(/search files, classes or methods/i),
      // The truncation badge: not a button, but the only place the node cap is
      // explained, so it has to be focusable to be readable without a mouse.
      screen.getByText(/4 files · 3 edges/),
    ];

    for (const el of controls) {
      expect(el.tabIndex, `${el.tagName}: ${el.textContent}`).toBeGreaterThanOrEqual(0);
    }
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
