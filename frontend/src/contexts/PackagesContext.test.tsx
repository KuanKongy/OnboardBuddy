import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PackagesProvider, usePackages } from "./PackagesContext";
import { apiFetch } from "@/lib/api";

/**
 * Two behaviours live here:
 *   - the completion watcher (a generation this tab started becomes the
 *     selection and navigates back to the overview; section regenerations
 *     don't navigate), and
 *   - the storage split: sessionStorage holds THIS tab's selection,
 *     localStorage holds the pin, and the pin outranks the member default
 *     while a tab value outranks both.
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
  commit_message: "Extract the session store",
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
  tutorial_count: 3, stale_tutorials: 0,
  is_latest_commit: true,
};
// A second package so precedence can be told apart by id rather than by the
// "latest" sentinel alone.
const OTHER_PKG = { ...NEW_PKG, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", branch: "main", role: "frontend" };

const TAB_KEY = "obb.tabPackage.p1";
const PIN_KEY = "obb.pinnedPackage.p1";
const LEGACY_KEY = "obb.selectedPackage.p1";

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
      // resolved_package_id is what a request with no package_id gets served;
      // the server picks it, so it is deliberately NOT the first row here.
      return Promise.resolve({ packages: [NEW_PKG, OTHER_PKG], resolved_package_id: OTHER_PKG.id });
    }
    return Promise.resolve({});
  };
}

function Probe() {
  const { registerSessionJob, selectedPackageId, selectPackage, pinnedPackageId, resolvedPackage } = usePackages();
  return (
    <div>
      <button onClick={() => registerSessionJob("job-1", { navigateOnDone: true })}>watch</button>
      <button onClick={() => registerSessionJob("job-1", { navigateOnDone: true })}>poke</button>
      <button onClick={() => selectPackage(OTHER_PKG.id)}>pick other</button>
      <span data-testid="selected">{selectedPackageId ?? "latest"}</span>
      <span data-testid="pinned">{pinnedPackageId ?? "none"}</span>
      <span data-testid="resolved">{resolvedPackage ? `${resolvedPackage.id}:${resolvedPackage.branch}` : "none"}</span>
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
    sessionStorage.clear();
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
    // Adopting is a selection, not a pin: this tab moves, other tabs and the
    // next new tab are untouched.
    expect(sessionStorage.getItem(TAB_KEY)).toBe(NEW_PKG.id);
    expect(localStorage.getItem(PIN_KEY)).toBeNull();
  });

  it("surfaces the package the server serves when nothing is selected", async () => {
    vi.mocked(apiFetch).mockImplementation(makeStatusScript("generate_package") as never);
    renderProvider();

    // The whole row, not just the id: the sidebar renders branch, scope and
    // role off it, so a resolved id the list does not contain is useless.
    await waitFor(() =>
      expect(screen.getByTestId("resolved")).toHaveTextContent(`${OTHER_PKG.id}:main`),
    );
    expect(screen.getByTestId("selected")).toHaveTextContent("latest");
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

  it("opens a fresh tab on the pinned package", async () => {
    localStorage.setItem(PIN_KEY, OTHER_PKG.id);
    vi.mocked(apiFetch).mockImplementation(makeStatusScript("generate_package") as never);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent(OTHER_PKG.id));
    expect(screen.getByTestId("pinned")).toHaveTextContent(OTHER_PKG.id);
  });

  it("lets this tab's own selection outrank the pin", async () => {
    localStorage.setItem(PIN_KEY, OTHER_PKG.id);
    sessionStorage.setItem(TAB_KEY, NEW_PKG.id);
    vi.mocked(apiFetch).mockImplementation(makeStatusScript("generate_package") as never);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent(NEW_PKG.id));
    // The pin is untouched — it is what the NEXT tab opens on, not a lock.
    expect(localStorage.getItem(PIN_KEY)).toBe(OTHER_PKG.id);
  });

  it("drops the pre-pinning key instead of honouring it", async () => {
    localStorage.setItem(LEGACY_KEY, NEW_PKG.id);
    vi.mocked(apiFetch).mockImplementation(makeStatusScript("generate_package") as never);
    renderProvider();

    // Waiting on the removal, not on the selection: "latest" is also the
    // pre-init state, so asserting it first would pass before init even ran.
    await waitFor(() => expect(localStorage.getItem(LEGACY_KEY)).toBeNull());
    expect(screen.getByTestId("selected")).toHaveTextContent("latest");
  });

  it("writes a selection to this tab only, never to the pin", async () => {
    vi.mocked(apiFetch).mockImplementation(makeStatusScript("generate_package") as never);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("latest"));
    fireEvent.click(screen.getByText("pick other"));

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent(OTHER_PKG.id));
    expect(sessionStorage.getItem(TAB_KEY)).toBe(OTHER_PKG.id);
    expect(localStorage.getItem(PIN_KEY)).toBeNull();
  });

  it("keeps a pinned selection when a generation lands, but still navigates", async () => {
    localStorage.setItem(PIN_KEY, OTHER_PKG.id);
    vi.mocked(apiFetch).mockImplementation(makeStatusScript("generate_package") as never);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent(OTHER_PKG.id));

    fireEvent.click(screen.getByText("watch"));
    fireEvent.click(screen.getByText("poke")); // completes → server default is NEW_PKG

    // The navigation courtesy is independent of the pin: this tab asked for
    // the run, so it is taken to the overview to see it land.
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/projects/p1"));
    expect(screen.getByTestId("selected")).toHaveTextContent(OTHER_PKG.id);
    expect(localStorage.getItem(PIN_KEY)).toBe(OTHER_PKG.id);
    expect(sessionStorage.getItem(TAB_KEY)).toBeNull();
  });
});
