import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AnalysisStatus, RunHistoryEntry } from "@/types/analysis";

// Asserted through the rendered row rather than the helpers: the chip variant and the
// merged-duration format are both things the row has to get right together.

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

/** A chained pair: history merges these into one row and sums the durations. */
const ANALYZE_RUN: RunHistoryEntry = {
  id: "run-analyze",
  job_type: "analyze_scope",
  status: "complete",
  progress_pct: 100,
  current_step: null,
  error_message: null,
  snapshot_id: "snap-1",
  section_type: null,
  chained_from: null,
  config: { branch: "main", commit: "abc1234", scope_path: null, scope_name: null, depth: "standard", role: null },
  requested_by_email: "dev@example.com",
  created_at: "2026-07-20T10:00:00Z",
  started_at: "2026-07-20T10:00:00Z",
  finished_at: "2026-07-20T15:00:00Z",
  duration_ms: 18_000_000, // 5h
  attempt: 1,
  step_log: [],
  package: null,
  cost: { estimated_cost_usd: 0, llm_calls: 0, cached_calls: 0, input_tokens: 0, output_tokens: 0 },
  budget: { capLlmCalls: 100, usedThisRun: 0, remaining: 100, lifetimeLlmCalls: 0, lifetimeCostUsd: 0 },
  sections: { generated: [], cached: [] },
};

const PACKAGE_RUN: RunHistoryEntry = {
  ...ANALYZE_RUN,
  id: "run-package",
  job_type: "generate_package",
  chained_from: "run-analyze",
  duration_ms: 15_607_000, // +4h20m07s → 9h 20m combined
  package: { id: "pkg-1", role: "backend", branch: "main", status: "ready" },
};

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.includes("/runs")) return { runs: [PACKAGE_RUN, ANALYZE_RUN] };
    // The idle status block mounts the pipeline panel open, which fetches the
    // snapshot's phases; an empty list is the panel's "nothing recorded" path.
    if (path.includes("/metrics")) return { snapshot: {}, phases: [] };
    return {};
  }),
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
    packages: [],
    refreshPackages: vi.fn(),
    selectPackage: vi.fn(),
    selectedPackageId: null,
    selectedPackage: null,
    status: ANALYZED_STATUS,
    refreshStatus: vi.fn().mockResolvedValue(undefined),
    activeJobs: [],
    registerSessionJob: vi.fn(),
    packagesError: false,
    statusError: false,
  }),
}));

vi.mock("@/lib/useProgress", () => ({
  useProgress: () => ({ items: [], loaded: true, save: vi.fn() }),
}));

const { ProjectOverviewPage } = await import("./ProjectOverviewPage");

describe("run history row (#74/V12, V10)", () => {
  it("badges a complete run green and prints a merged duration in hours", async () => {
    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={["/projects/p1"]}>
          <Routes>
            <Route path="/projects/:id" element={<ProjectOverviewPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );

    // Twice on purpose: the idle "Analysis status" block is the current state,
    // the run history below is the ledger, and this pair is the newest of both.
    const badges = await screen.findAllByText("complete");
    expect(badges).toHaveLength(2);
    for (const badge of badges) {
      expect(badge).toHaveAttribute("data-variant", "success");
      // Not the primary/blue chip, which is this app's info/selected tone.
      expect(badge).not.toHaveAttribute("data-variant", "default");
    }

    // Both halves summed by sumDuration, in hours rather than "560m 7s".
    expect(await screen.findAllByText("9h 20m")).toHaveLength(2);
  });
});
