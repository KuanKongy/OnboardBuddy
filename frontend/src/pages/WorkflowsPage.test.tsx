import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkflowsPage } from "./WorkflowsPage";
import { fetchWorkflowsList } from "@/lib/graphData";
import { ApiError, apiFetch } from "@/lib/api";

// The rail lets a reader click several flows in a row, each firing its own request.

const WORKFLOWS = [
  { id: "wf-slow", title: "Analyze a repository", trigger_type: "http_post", confidence: "high", step_count: 1, tier: "core" },
  { id: "wf-fast", title: "Sign in with GitHub", trigger_type: "http_get", confidence: "high", step_count: 1, tier: "core" },
];

const walkthrough = (id: string, symbol: string) => ({
  workflow: { id, title: id, trigger_type: "http_post", purpose: null, confidence: "high" },
  steps: [
    {
      step_order: 1,
      file_path: `src/${symbol}.ts`,
      symbol_name: symbol,
      step_kind: "trigger",
      deterministic_description: "Entry point.",
    },
  ],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

vi.mock("@/lib/graphData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graphData")>()),
  fetchWorkflowsList: vi.fn(),
  fetchNodeDetail: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe("WorkflowsPage", () => {
  it("keeps the selected flow's steps when an abandoned request answers last", async () => {
    const slow = deferred<unknown>();
    const fast = deferred<unknown>();
    vi.mocked(fetchWorkflowsList).mockResolvedValue({ workflows: WORKFLOWS, ordering: null } as never);
    vi.mocked(apiFetch).mockImplementation((path: string) =>
      (path.includes("wf-slow") ? slow.promise : fast.promise) as Promise<unknown>,
    );

    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={["/projects/proj-1/workflows"]}>
          <Routes>
            <Route path="/projects/:id/workflows" element={<WorkflowsPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );

    // The list preselects the first flow, whose walkthrough is still in flight.
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("wf-slow")));

    fireEvent.click(screen.getByRole("button", { name: /Sign in with GitHub/ }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("wf-fast")));

    // Selected flow answers first; the abandoned one lands after it.
    fast.resolve(walkthrough("wf-fast", "handleCallback"));
    expect(await screen.findByText("handleCallback")).toBeInTheDocument();

    slow.resolve(walkthrough("wf-slow", "startAnalysis"));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(screen.getByText("handleCallback")).toBeInTheDocument();
    expect(screen.queryByText("startAnalysis")).not.toBeInTheDocument();
  });

  // ui-ux-audit-round3 salvage: a ?workflow= id the fetched list does not
  // contain used to stay selected, leaving a dead detail fetch whose Retry
  // could never succeed and no rail row highlighted.
  it("falls back to the first flow when the ?workflow= deep link is unknown", async () => {
    vi.mocked(fetchWorkflowsList).mockResolvedValue({ workflows: WORKFLOWS, ordering: null } as never);
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path.includes("wf-slow")) return Promise.resolve(walkthrough("wf-slow", "startAnalysis") as unknown);
      if (path.includes("wf-fast")) return Promise.resolve(walkthrough("wf-fast", "handleCallback") as unknown);
      return Promise.reject(new ApiError("Workflow not found", 404, {}));
    });

    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={["/projects/proj-1/workflows?workflow=wf-deleted"]}>
          <Routes>
            <Route path="/projects/:id/workflows" element={<WorkflowsPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );

    // The unknown id gives way to the first real flow, whose steps render.
    expect(await screen.findByText("startAnalysis")).toBeInTheDocument();
  });
});
