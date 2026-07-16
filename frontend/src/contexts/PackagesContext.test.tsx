import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PackagesProvider, usePackages } from "./PackagesContext";
import { apiFetch } from "@/lib/api";

/**
 * Completion watcher: a generation the session started becomes the selection
 * and navigates back to the overview; section regenerations don't navigate.
 */

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

// Stateful ProjectContext stand-in: `refetch` simulates the server having set
// the member default when the watched generation completed.
vi.mock("@/contexts/ProjectContext", async () => {
  const React = await import("react");
  const Ctx = React.createContext<unknown>(null);
  function MockProjectProvider({ children }: { children: React.ReactNode }) {
    const [project, setProject] = React.useState({ id: "p1", default_package_id: null as string | null });
    const value = React.useMemo(
      () => ({
        project,
        loading: false,
        error: "",
        refetch: () => setProject({ id: "p1", default_package_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
      }),
      [project],
    );
    return React.createElement(Ctx.Provider, { value }, children);
  }
  return {
    useProject: () => React.useContext(Ctx),
    MockProjectProvider,
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { MockProjectProvider } = (await import("@/contexts/ProjectContext")) as any;

const NEW_PKG = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  snapshot_id: "snap-1",
  role: "backend",
  status: "draft",
  analyzed_commit: "abc1234def",
  branch: "dev",
  created_at: "2026-07-15T10:00:00Z",
  updated_at: "2026-07-15T10:00:00Z",
  scope_name: "backend",
  path_prefix: "backend",
  scope_kind: "manual",
  semantic_depth: "standard",
  privacy_mode: "full_ai",
  section_count: 11,
  stale_sections: 0,
  approved_sections: 0,
  low_confidence_sections: 0,
  tutorial_count: 3,
  is_latest_commit: true,
};

function makeStatusScript(jobType: string) {
  // Call #1 (mount): running. Later calls: complete.
  let statusCalls = 0;
  return (path: string) => {
    if (path.includes("/analysis-status")) {
      statusCalls += 1;
      return Promise.resolve({
        jobs: [{
          id: "job-1",
          job_type: jobType,
          status: statusCalls < 3 ? "running" : "complete",
          progress_pct: statusCalls < 3 ? 50 : 100,
          current_step: null,
          snapshot_id: "snap-1",
          checkpoint: {},
          step_log: [],
          error_message: null,
          created_at: "",
          started_at: "",
          finished_at: null,
          last_heartbeat_at: null,
          attempt: 1,
          stalled: false,
          requested_branch: null,
          requested_commit: null,
          requested_depth: null,
          requested_role: null,
          scope_path: null,
          file_count: null,
          symbol_count: null,
          workflow_count: null,
          commit_hash: null,
          branch: null,
        }],
        latestSnapshot: null,
      });
    }
    if (path.includes("/onboarding/packages")) {
      return Promise.resolve({ packages: [NEW_PKG] });
    }
    return Promise.resolve({});
  };
}

function Probe() {
  const { registerSessionJob, selectedPackageId } = usePackages();
  return (
    <div>
      <button onClick={() => registerSessionJob("job-1", { navigateOnDone: true })}>watch</button>
      <button onClick={() => registerSessionJob("job-1", { navigateOnDone: true })}>poke</button>
      <span data-testid="selected">{selectedPackageId ?? "latest"}</span>
    </div>
  );
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="path">{pathname}</span>;
}

function renderProvider(startPath = "/projects/p1/walkthrough") {
  return render(
    <MemoryRouter initialEntries={[startPath]}>
      <MockProjectProvider>
        <Routes>
          <Route
            path="*"
            element={
              <PackagesProvider projectId="p1">
                <Probe />
                <LocationProbe />
              </PackagesProvider>
            }
          />
        </Routes>
      </MockProjectProvider>
    </MemoryRouter>,
  );
}

describe("PackagesContext completion watcher", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(apiFetch).mockReset();
  });

  it("selects the finished package and navigates to the overview", async () => {
    vi.mocked(apiFetch).mockImplementation(makeStatusScript("generate_package") as never);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("latest"));

    fireEvent.click(screen.getByText("watch")); // status call #2: still running
    fireEvent.click(screen.getByText("poke"));  // status call #3: complete → watcher fires

    await waitFor(() => {
      expect(screen.getByTestId("path")).toHaveTextContent("/projects/p1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("selected")).toHaveTextContent(NEW_PKG.id);
    });
    expect(localStorage.getItem("obb.selectedPackage.p1")).toBe(NEW_PKG.id);
  });

  it("does not navigate for a section regeneration", async () => {
    vi.mocked(apiFetch).mockImplementation(makeStatusScript("regenerate_section") as never);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("latest"));

    fireEvent.click(screen.getByText("watch"));
    fireEvent.click(screen.getByText("poke"));

    // The packages list refreshes, but the user stays put and the selection
    // doesn't change.
    await waitFor(() => {
      const packageCalls = vi.mocked(apiFetch).mock.calls.filter(([p]) => String(p).includes("/onboarding/packages"));
      expect(packageCalls.length).toBeGreaterThan(1);
    });
    expect(screen.getByTestId("path")).toHaveTextContent("/projects/p1/walkthrough");
    expect(screen.getByTestId("selected")).toHaveTextContent("latest");
  });
});
