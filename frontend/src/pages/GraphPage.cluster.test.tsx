import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GraphPage } from "./GraphPage";
import { fetchClassGraph, fetchDependencyGraph } from "@/lib/graphData";

/**
 * Drill-down navigation.
 *
 * The breadcrumb used to be built by splitting the current cluster path, and
 * "up one level" was `segments.slice(0, -1)` — a guess at a parent rather than
 * a record of where the user had been. Arriving on a deep link that
 * auto-drilled therefore offered crumbs for levels nobody had visited, and
 * Back went to a synthesized prefix instead of the previous view.
 *
 * The contract now: the breadcrumb lists levels actually visited, Back returns
 * to the previous one, and the ladder is exactly TWO rungs deep — groups then
 * files, with nothing under a file (owner E1).
 */

vi.mock("@/lib/graphData", () => {
  const clusterNode = (dir: string, files: number) => ({
    id: `cluster:${dir}`,
    label: `${dir}/ (${files} files)`,
    kind: "cluster",
    metadata: { exportedSymbols: [], importCount: 2, dependentCount: 1, internalImportCount: files, fileCount: files, directory: dir },
  });
  const fileNode = (path: string, label: string, symbolCount = 0) => ({
    id: path,
    label,
    kind: "module",
    metadata: { exportedSymbols: [label], importCount: 1, dependentCount: 0, symbolCount },
  });

  const root = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: true, totalNodes: 187, totalEdges: 120,
    level: { kind: "root", id: null, unit: "groups" },
    truncation: null,
    counts: {
      nodesShown: 3, groupsShown: 3, filesShown: 0, edgesShown: 1,
      filesTotal: 187, linksTotal: 120, linksInsideGroups: 110,
    },
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

  // A level the node cap actually bites into: 107 files, 60 drawn, and only 4
  // of its 91 file-to-file links survive with both ends on the canvas.
  const big = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: false, totalNodes: 107, totalEdges: 91,
    level: { kind: "cluster", id: "src/big", unit: "files" },
    truncation: {
      shown: 60, total: 107, hidden: 47, limit: 60, unit: "files",
      keptBy: "the files that import the most other project files",
      seeRest: null,
    },
    counts: {
      nodesShown: 60, groupsShown: 0, filesShown: 60, edgesShown: 4,
      filesTotal: 107, linksTotal: 91, linksInsideGroups: 0,
    },
    describedFiles: 12,
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

  // The Classes ladder: above the node cap the server groups classes by
  // directory using the same `cluster:` ids as the Files ladder.
  const classRoot = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: true, totalNodes: 267, totalEdges: 5,
    level: { kind: "root", id: null, unit: "groups" }, truncation: null,
    graph: {
      nodes: [
        { id: "cluster:backend/src", label: "backend/src/ (184 classes)", kind: "cluster", filePath: "backend/src",
          metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0, internalImportCount: 5, fileCount: 184, groupNoun: "classes" } },
      ],
      edges: [], entryPoints: [],
    },
    fileAnalyses: [],
  };
  const classChild = {
    projectId: "proj-1", snapshotId: "snap-1", clustered: false, totalNodes: 1, totalEdges: 0,
    level: { kind: "cluster", id: "backend/src", unit: "classes" }, truncation: null, describedNodes: 1,
    graph: {
      nodes: [
        { id: "backend/src/writer.ts#SnapshotWriter", label: "SnapshotWriter", kind: "class", filePath: "backend/src/writer.ts",
          metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0, summary: "Writes a snapshot" } },
      ],
      edges: [], entryPoints: [],
    },
    fileAnalyses: [],
  };

  return {
    fetchDependencyGraph: vi.fn().mockImplementation((_p: string, cluster?: string) =>
      Promise.resolve(
        !cluster ? root : cluster === "src/lib" ? lib : cluster === "src/big" ? big : leaf(cluster),
      ),
    ),
    fetchClassGraph: vi.fn().mockImplementation((_p: string, _pkg?: unknown, dir?: string | null) =>
      Promise.resolve(dir ? classChild : classRoot),
    ),
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

/** The query string as the router currently holds it. */
function LocationProbe() {
  return <span data-testid="search">{useLocation().search}</span>;
}

const currentSearch = () => screen.getByTestId("search").textContent ?? "";

function renderGraphPage(entry = "/projects/proj-1/dependencies") {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path="/projects/:id/dependencies" element={<GraphPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/**
 * Opens a group the way a reader does by default: its card's Open button.
 * Clicking the card itself only selects now (see the selection test below), so
 * the ladder is exercised through the control that navigates.
 *
 * Matched by prefix rather than by full name, because the label is baked into
 * the aria-label ("Open src/lib/ (40 files) and list its 40 files") and the
 * panel's own Open button is plain text ("Open 40 files") — a looser matcher
 * would hit both.
 *
 * Queried by label rather than by role+name: React Flow renders a node with
 * `visibility: hidden` until it has been measured (@reactflow/core NodeWrapper)
 * and jsdom measures nothing, so every control on the canvas computes an EMPTY
 * accessible name here — `getByRole(…, { name })` cannot reach one even with
 * `hidden: true`. In a browser the cards are visible and their buttons are
 * named; this is a jsdom fact, not a claim about the product.
 */
const drillInto = async (label: string) => {
  const matches = (name: string) => name.startsWith(`Open ${label} and list its`);
  const button = () => screen.getByLabelText(matches, { selector: "button" });
  await waitFor(() => expect(button()).toBeInTheDocument());
  fireEvent.click(button());
};

describe("GraphPage drill-down", () => {
  beforeEach(() => vi.mocked(fetchDependencyGraph).mockClear());
  // The auto-drill preference is read per click, so a test that sets it would
  // otherwise leak the old gesture into every test after it.
  afterEach(() => localStorage.clear());

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

  /**
   * The group box is a door that does not open itself (owner I1, the model the
   * Architecture card already follows): a click selects it and the panel says
   * what it stands for, the Open button navigates. Auto-drill on a click made
   * the group's own numbers unreadable — the canvas changed before anyone
   * could look at them.
   */
  it("clicking a group selects and explains it instead of drilling", async () => {
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("src/lib/ (40 files)")).toBeInTheDocument());
    const callsBefore = vi.mocked(fetchDependencyGraph).mock.calls.length;

    fireEvent.click(screen.getByText("src/lib/ (40 files)"));

    // No level fetched, no crumb, siblings still drawn: this was a selection.
    expect(vi.mocked(fetchDependencyGraph).mock.calls.length).toBe(callsBefore);
    expect(screen.getByText("src/api/ (40 files)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dependencies" })).not.toBeInTheDocument();
    // What the click DID produce: the panel, explaining the box and offering
    // the way in. Its plain-text name is what tells it apart from the card's
    // button, whose aria-label carries the group label.
    expect(screen.getByText("Directory group")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open 40 files" })).toBeInTheDocument();
  });

  it("restores click-to-open when the account preference is on", async () => {
    localStorage.setItem("onboardbuddy:graph-auto-drill:dependencies", "on");
    renderGraphPage();
    await waitFor(() => expect(screen.getByText("src/lib/ (40 files)")).toBeInTheDocument());

    fireEvent.click(screen.getByText("src/lib/ (40 files)"));

    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src/lib", null));
  });

  /**
   * ASSERTION 1 — the ladder is two rungs, and a link into the removed third
   * rung degrades instead of erroring.
   *
   * Owner E1: "have only two level, the current third level drill down is not
   * useful and annoying." `api` declares 3 symbols, which used to be exactly
   * the condition that turned a file into a door.
   */
  it("stops at the file level, and a stale symbols link degrades to it", async () => {
    renderGraphPage();
    await drillInto("src/lib/ (40 files)");
    await waitFor(() => expect(screen.getByText("api")).toBeInTheDocument());
    const callsBefore = vi.mocked(fetchDependencyGraph).mock.calls.length;

    fireEvent.click(screen.getByText("api"));

    // No level opened: no fetch, the canvas still shows the group's contents,
    // and `lib` is still the LAST crumb rather than an intermediate one.
    expect(vi.mocked(fetchDependencyGraph).mock.calls.length).toBe(callsBefore);
    expect(screen.getByText("src/lib/deep/ (8 files)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dependencies" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "lib" })).not.toBeInTheDocument();

    // A URL written before the rung was removed lands on the file's GROUP,
    // and the dead frame is dropped from the breadcrumb rather than erroring.
    vi.mocked(fetchDependencyGraph).mockClear();
    renderGraphPage(
      "/projects/proj-1/dependencies?drill=cluster,src%2Flib,lib|file,src%2Flib%2Fapi.ts,api.ts",
    );
    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src/lib", null));
    expect(vi.mocked(fetchDependencyGraph).mock.calls.every(([, c]) => c !== "src/lib/api.ts")).toBe(true);
  });

  /**
   * ASSERTION 2 — the header describes the canvas, not a bigger population.
   *
   * Owner F1: "It shows a bigger number of available imports, steps, but when
   * you click to see details, there are less." Measured before this change:
   * the root badge read "227 files · 929 edges" over 8 boxes and 2 arrows, and
   * a drilled group read "107 files · 481 edges" over 5 boxes and 10 arrows.
   */
  it("reports what the canvas draws, and names the larger population", async () => {
    renderGraphPage();
    // Root: 3 group boxes standing for 187 files, 1 arrow standing for 120
    // file-to-file links, 110 of which are inside a single group.
    await waitFor(() =>
      expect(screen.getByText("3 groups · 187 files inside · 1 arrow")).toBeInTheDocument(),
    );

    await drillInto("src/big/ (107 files)");
    // Capped file level: drawn count first, level total named beside it.
    await waitFor(() =>
      expect(screen.getByText("60 of 107 files · 4 arrows")).toBeInTheDocument(),
    );
    // And the level says how many of the drawn files it can actually explain.
    expect(screen.getByText(/12 of 60 carry a generated description/)).toBeInTheDocument();
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

  /**
   * ASSERTION 3 — the Classes folder ladder is not a dead end.
   *
   * VISUAL QA M4 #8: on the only repo big enough to need the ladder,
   * OnboardBuddy's 267 classes collapsed to two folder boxes that were
   * "completely inert" — no drill, no selection, no interactive control — so
   * the class-detail path was unreachable exactly where grouping was
   * introduced to make it reachable. One click on the toggle reaches the
   * Classes view, and opening a folder must produce its classes.
   */
  it("opens a class folder and shows the classes inside it", async () => {
    renderGraphPage();
    await screen.findByText("src/lib/ (40 files)");
    // One click reaches the Classes view (VISUAL QA M4 #5 needed two).
    fireEvent.click(screen.getByRole("button", { name: "Classes & interfaces" }));
    await screen.findByText("backend/src/ (184 classes)");

    // The explicit control, not only the canvas gesture: a React Flow node is
    // a plain div with a click handler, so the ladder cannot depend on it.
    fireEvent.click(await screen.findByRole("button", { name: /Open backend\/src and list its 184 classes/ }));

    expect(await screen.findByText("SnapshotWriter", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(fetchClassGraph).toHaveBeenCalledWith("proj-1", null, "backend/src");
  });

  // A `?focus=` that outlives its resolution is re-resolved by every later load, so
  // the reader cannot leave the cluster.
  it("drops a resolved ?focus= so the breadcrumb root can escape the cluster", async () => {
    renderGraphPage("/projects/proj-1/dependencies?focus=src%2Flib%2Findex.ts");

    // Root cannot show the file, so one auto-drill resolves it. Two matches for the
    // label: the canvas node and the panel the focus opened.
    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src/lib", null));
    await screen.findAllByText("index");
    // Consumed, but the drill it performed stays shareable.
    await waitFor(() => expect(currentSearch()).not.toContain("focus"));
    expect(currentSearch()).toContain("drill=");

    fireEvent.click(screen.getByRole("button", { name: "Dependencies" }));

    // Empty query: no drill frame, and nothing left to re-arm one.
    await waitFor(() => expect(currentSearch()).toBe(""));
    await waitFor(() => expect(screen.getByText("src/api/ (40 files)")).toBeInTheDocument());
    expect(screen.queryByText("lib")).not.toBeInTheDocument();
    // One src/lib fetch for the whole visit: the arrival hop, not a re-drill.
    expect(vi.mocked(fetchDependencyGraph).mock.calls.filter(([, c]) => c === "src/lib")).toHaveLength(1);
  });

  it("still understands a legacy ?cluster= link", async () => {
    renderGraphPage("/projects/proj-1/dependencies?cluster=src%2Fapi");
    await waitFor(() => expect(fetchDependencyGraph).toHaveBeenCalledWith("proj-1", "src/api", null));
    await waitFor(() => expect(screen.getByText("api")).toBeInTheDocument());
  });
});
