import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ArchitecturePage } from "./ArchitecturePage";
import { fetchArchitecture } from "@/lib/architectureData";

/**
 * Two behaviours that fail silently — the graph still renders, it is just
 * wrong, so neither shows up as an error anywhere.
 *
 * 1. A component was a dead end. Clicking it opened an aside of links to
 *    another tab, so the map had exactly one level and the boxes on it could
 *    not be opened.
 * 2. `clusters: []` fell through the `error || (!data && !loading)` guard and
 *    rendered "0 components · 0 connections" over a blank canvas — a page that
 *    looks like it loaded fine and explains nothing.
 */

const cluster = (id: string, label: string, members: string[]) => ({
  id,
  label,
  kind: "api_layer",
  criticalScore: 0.5,
  narrative: {
    responsibility: "Requests from outside this process enter the system here.",
    boundary: "It reads and writes Database Schema.",
    separation: "Keeping it separate is what stops express from spreading.",
    unknowns: [],
    summary: "…",
  },
  summary: "…",
  summarySource: "deterministic" as const,
  confidence: null,
  members: members.map((m) => ({ key: m, name: m.split("/").pop()!, filePath: m })),
  metadata: { fileCount: members.length, memberCount: members.length, primaryMemberNoun: "file" as const },
});

const ROOT = {
  projectId: "proj-1",
  snapshotId: "snap-1",
  clusters: [
    cluster("cluster:api", "API Routes", ["src/api/a.ts", "src/api/b.ts"]),
    cluster("cluster:db", "Database", ["src/db/c.ts"]),
  ],
  edges: [{ id: "e1", source: "cluster:api", target: "cluster:db", kind: "reads_writes_data", weight: 4 }],
  level: null,
};

const API_LEVEL = {
  ...ROOT,
  level: {
    clusterId: "cluster:api",
    label: "API Routes",
    kind: "api_layer",
    nodes: [
      { id: "src/api/a.ts", label: "a.ts", kind: "module", filePath: "src/api/a.ts", criticalScore: 0.9, exportedSymbols: [], importCount: 1, dependentCount: 0 },
      { id: "src/api/b.ts", label: "b.ts", kind: "module", filePath: "src/api/b.ts", criticalScore: 0.2, exportedSymbols: [], importCount: 0, dependentCount: 1 },
    ],
    edges: [{ id: "fe1", source: "src/api/a.ts", target: "src/api/b.ts", kind: "imports", weight: 1 }],
    totalNodes: 2,
    truncated: 0,
  },
};

vi.mock("@/lib/architectureData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/architectureData")>()),
  fetchArchitecture: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

function renderPage() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/proj-1/architecture"]}>
        <Routes>
          <Route path="/projects/:id/architecture" element={<ArchitecturePage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("ArchitecturePage", () => {
  beforeEach(() => vi.mocked(fetchArchitecture).mockReset());

  it("opens a component only when asked, and then shows its files", async () => {
    // Owner I1: "The architecture, doesn't drill down, it doesn't show files.
    // You may add the button, to allow drilling down, it shouldn't by
    // default." A click used to drill immediately — the same gesture that
    // means "select" everywhere else — so the component's own narrative was
    // only ever visible on the way past, and readers reported the tab as
    // having no files level at all.
    vi.mocked(fetchArchitecture).mockImplementation((_p, _pkg, key) =>
      Promise.resolve((key ? API_LEVEL : ROOT) as never),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("API Routes")).toBeInTheDocument());
    fireEvent.click(screen.getByText("API Routes"));

    // Selecting does NOT navigate: no level fetch, siblings still on canvas,
    // and the aside now explains what the component is for.
    expect(fetchArchitecture).not.toHaveBeenCalledWith("proj-1", null, "cluster:api");
    expect(screen.getByText("Database")).toBeInTheDocument();
    // The aside is open beside the card, so the responsibility line appears
    // twice — on the node, and under "Responsible for" in the aside.
    expect(screen.getByText("Responsible for")).toBeInTheDocument();
    expect(screen.getByText("Why it is separate")).toBeInTheDocument();

    // Opening is one labelled control, in the aside. The card carried a second
    // copy of it until the action moved to a single place, which is why this is
    // `getByRole` — a card button coming back would fail here rather than be
    // absorbed by a "one or more" assertion.
    fireEvent.click(screen.getByRole("button", { name: /Open 2 files/ }));

    // The level is fetched from the server, not synthesized from the members
    // already in hand — that is what gives it real edges and per-file scores.
    await waitFor(() =>
      expect(fetchArchitecture).toHaveBeenCalledWith("proj-1", null, "cluster:api"),
    );
    // The component's own files are now the graph, and the sibling component is
    // gone: this is a level, not a filter.
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());
    expect(screen.queryByText("Database")).not.toBeInTheDocument();

    // Back returns to the components.
    fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    await waitFor(() => expect(screen.getByText("Database")).toBeInTheDocument());
  });

  it("explains an analysis that produced no components instead of drawing an empty canvas", async () => {
    vi.mocked(fetchArchitecture).mockResolvedValue({ ...ROOT, clusters: [], edges: [] } as never);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("This analysis produced no components")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
