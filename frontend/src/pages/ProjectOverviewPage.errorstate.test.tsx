import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AnalysisStatus } from "@/types/analysis";

/**
 * Bug #74/F3 — the overview's load error had nowhere to render.
 *
 * `loadError = packagesError || statusError` was only consulted inside the
 * `neverAnalyzed` branch. On an ANALYZED project a failed packages fetch
 * therefore produced no message at all: the packages block is gated on
 * `packages.length > 0`, and a failed fetch leaves that empty. The user got a
 * page that quietly omitted the one thing it exists to show, with nothing to
 * retry. This is the silent-failure shape from #68, one page later.
 */

const ANALYZED_STATUS: AnalysisStatus = {
  jobs: [],
  latestSnapshot: {
    id: "snap-1",
    file_count: 120,
    symbol_count: 900,
    workflow_count: 4,
    commit_hash: "abc1234def",
    branch: "main",
    semantic_depth: "standard",
    created_at: "2026-07-20T10:00:00Z",
  },
};

const refreshPackages = vi.hoisted(() => vi.fn());
const refreshStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const packagesState = { packagesError: false, statusError: false };

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => (path.includes("/runs") ? { runs: [] } : {})),
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/contexts/ProjectContext", () => ({
  useProject: () => ({
    project: {
      id: "p1",
      repo_owner: "acme",
      repo_name: "app",
      branch: "main",
      permission_tier: "owner",
      developer_role: "backend",
      status: "complete",
      settings: null,
    },
    loading: false,
    error: "",
    refetch: vi.fn(),
  }),
}));

vi.mock("@/contexts/PackagesContext", () => ({
  usePackages: () => ({
    // The failed fetch is exactly why this is empty — which is what made the
    // failure indistinguishable from "nothing generated yet".
    packages: [],
    refreshPackages,
    selectPackage: vi.fn(),
    selectedPackageId: null,
    selectedPackage: null,
    status: ANALYZED_STATUS,
    refreshStatus,
    activeJobs: [],
    registerSessionJob: vi.fn(),
    packagesError: packagesState.packagesError,
    statusError: packagesState.statusError,
  }),
}));

vi.mock("@/lib/useProgress", () => ({
  useProgress: () => ({ items: [], loaded: true, save: vi.fn() }),
}));

const { ProjectOverviewPage } = await import("./ProjectOverviewPage");

function renderOverview() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/p1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectOverviewPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  refreshPackages.mockClear();
  refreshStatus.mockClear();
  packagesState.packagesError = false;
  packagesState.statusError = false;
});

describe("ProjectOverviewPage — failed packages/status load (#74/F3)", () => {
  it("says the load failed and offers a retry on an analyzed project", async () => {
    packagesState.packagesError = true;
    const user = userEvent.setup();
    renderOverview();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Couldn't load this project's packages and analysis status/);
    // Not the empty state: this project HAS been analyzed, we just can't read it.
    expect(screen.queryByText("Not yet analyzed")).not.toBeInTheDocument();

    refreshPackages.mockClear();
    await user.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(refreshPackages).toHaveBeenCalled();
    expect(refreshStatus).toHaveBeenCalled();
  });

  it("stays quiet when both loads succeeded", async () => {
    renderOverview();
    await waitFor(() => expect(screen.getByText("Run history")).toBeInTheDocument());

    expect(
      screen.queryByText(/Couldn't load this project's packages and analysis status/),
    ).not.toBeInTheDocument();
  });
});
