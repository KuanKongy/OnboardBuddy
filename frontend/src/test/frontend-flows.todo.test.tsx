import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GraphPage } from "@/pages/GraphPage";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-token", user: { id: "u1", email: "a@b.com" } } },
      }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("@/lib/graphData", () => {
  const graphPayload = {
    nodes: [
      { id: "index", label: "index", kind: "module", filePath: "index.ts", metadata: { exportedSymbols: ["main"], importCount: 2, dependentCount: 0 } },
      { id: "auth", label: "auth", kind: "module", filePath: "routes/auth.ts", metadata: { exportedSymbols: ["authRouter"], importCount: 1, dependentCount: 1 } },
    ],
    edges: [{ id: "e1", source: "index", target: "auth", kind: "imports", weight: 1 }],
    entryPoints: ["index"],
  };
  return {
    fetchDependencyGraph: vi.fn().mockResolvedValue({
      projectId: "proj-1",
      snapshotId: "snap-1",
      clustered: false,
      totalNodes: 2,
      totalEdges: 1,
      graph: graphPayload,
      fileAnalyses: [],
    }),
  };
});

const { apiFetch } = await import("@/lib/api");

describe("frontend feature flows", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("Repository Import populates repos and branches after GitHub connection", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ installations: [{ id: 1, account_login: "acme" }] })
      .mockResolvedValueOnce({ repos: [{ full_name: "acme/app", default_branch: "main" }] })
      .mockResolvedValueOnce({ branches: [{ name: "main" }, { name: "develop" }] });

    const repos = await apiFetch("/github/installations");
    expect(repos).toHaveProperty("installations");

    const repoList = await apiFetch("/github/repos?installation_id=1");
    expect(repoList).toHaveProperty("repos");

    const branches = await apiFetch("/github/repos/acme/app/branches?installation_id=1");
    expect(branches).toHaveProperty("branches");
    expect((branches as { branches: { name: string }[] }).branches).toHaveLength(2);
  });

  it("Package Overview switches role-specific package content", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({
        role: "backend",
        sections: [{ id: "start-here", label: "Start Here", status: "complete", confidence: "high", blocks: [] }],
      })
      .mockResolvedValueOnce({
        role: "frontend",
        sections: [{ id: "start-here", label: "Start Here", status: "complete", confidence: "medium", blocks: [] }],
      });

    const backendPkg = await apiFetch("/projects/p1/onboarding?role=backend");
    const frontendPkg = await apiFetch("/projects/p1/onboarding?role=frontend");

    expect((backendPkg as { role: string }).role).toBe("backend");
    expect((frontendPkg as { role: string }).role).toBe("frontend");
  });

  it("Walkthrough Viewer advances through ordered code stops", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      workflow: { id: "wf-1", title: "Login flow" },
      steps: [
        { stepOrder: 1, filePath: "routes/auth.ts", explanation: "Entry" },
        { stepOrder: 2, filePath: "services/authService.ts", explanation: "Service" },
      ],
    });

    const data = await apiFetch("/projects/p1/workflows/wf-1/walkthrough");
    const steps = (data as { steps: { stepOrder: number }[] }).steps;
    expect(steps[0]!.stepOrder).toBe(1);
    expect(steps[1]!.stepOrder).toBe(2);
  });

  it("Graph Viewer switches between architecture, dependency, and workflow tabs", async () => {
    render(
      // GraphPage contains Radix tooltips (toolbar/legend), which need a
      // provider when rendered outside App.tsx — same as GraphPage.test.tsx.
      <TooltipProvider>
        <MemoryRouter initialEntries={["/projects/proj-1/dependencies"]}>
          <Routes>
            <Route path="/projects/:id/dependencies" element={<GraphPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("index")).toBeInTheDocument();
    });
    expect(screen.getByText("auth")).toBeInTheDocument();
    expect(screen.getByText("2 / 2 files")).toBeInTheDocument();
  });

  it("Documentation Health clears stale sections after review", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({
        sections: [{ sectionId: "sec-1", id: "documentation-health", reviewStatus: "stale", status: "stale" }],
      })
      .mockResolvedValueOnce({ section: { id: "sec-1", review_status: "approved" } });

    const before = await apiFetch("/projects/p1/onboarding?role=general");
    expect((before as { sections: { reviewStatus: string }[] }).sections[0]!.reviewStatus).toBe("stale");

    await apiFetch("/projects/p1/onboarding/sections/sec-1/review", {
      method: "PATCH",
      body: JSON.stringify({ review_status: "approved" }),
    });

    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(2);
  });
});
