import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";

/**
 * Bug #68 — the expensive instance.
 *
 * `fetchOnboardingPackage` used to `catch { return null }`, and the reader
 * renders "no package" from a null. So a 500, a dropped connection or an
 * expired session all painted:
 *
 *     No package for Backend
 *     [ Generate for Backend ]
 *
 * — telling the user the package they already own does not exist, and offering
 * a **billed** generation to rebuild it. Absence is not an error on this
 * endpoint: a role with no package answers 200 with `status: "missing"`. This
 * spec pins the distinction, because the regression is silent — the failing
 * screen looks like a perfectly good empty state.
 */

const fetchOnboardingPackage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/onboardingData", async () => {
  const actual = await vi.importActual<typeof import("@/lib/onboardingData")>("@/lib/onboardingData");
  return { ...actual, fetchOnboardingPackage };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn().mockResolvedValue({}) };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" } }),
}));

vi.mock("@/contexts/ProjectContext", () => ({
  useProject: () => ({
    project: {
      id: "p1",
      repo_owner: "acme",
      repo_name: "app",
      permission_tier: "developer",
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
    packagesError: false,
    refreshPackages: vi.fn(),
    selectPackage: vi.fn(),
    selectedPackageId: null,
    registerSessionJob: vi.fn(),
  }),
}));

vi.mock("@/lib/useProgress", () => ({
  useProgress: () => ({ items: [], loaded: true, save: vi.fn() }),
}));

// jsdom has no `Element.scrollTo`; the reader calls it to reset scroll on
// section change. Unrelated to what this file asserts.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

const { OnboardingPage } = await import("./OnboardingPage");

function renderReader() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/p1/onboarding?view=reader&role=backend"]}>
        <Routes>
          <Route path="/projects/:id/onboarding" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/** The button that starts a paid generation from the reader's empty state. */
const generateButton = () => screen.queryByRole("button", { name: /generate for/i });

describe("fetchOnboardingPackage (#68 root cause)", () => {
  it("rejects on a failed request instead of resolving to null", async () => {
    // The original defect was one `catch { return null }` here. Everything the
    // reader does above is downstream of this promise being allowed to reject:
    // restore the swallow and the page cannot tell failure from absence no
    // matter how its render branches are written.
    const api = await import("@/lib/api");
    const real = await vi.importActual<typeof import("@/lib/onboardingData")>("@/lib/onboardingData");
    vi.mocked(api.apiFetch).mockRejectedValueOnce(new ApiError("API error 503", 503, {}));

    await expect(real.fetchOnboardingPackage("p1", { role: "backend" })).rejects.toThrow("API error 503");
  });
});

describe("onboarding reader: a failed package fetch is an error, not an empty result (#68)", () => {
  beforeEach(() => {
    fetchOnboardingPackage.mockReset();
  });

  it("shows an error with a retry — and never the billed Generate button — when the fetch rejects", async () => {
    fetchOnboardingPackage.mockRejectedValue(new ApiError("API error 500", 500, {}));
    renderReader();

    await waitFor(() => {
      expect(screen.getByText(/couldn't load this package/i)).toBeInTheDocument();
    });

    // The whole point: a failure must not be dressed as absence.
    expect(screen.queryByText(/no package for/i)).toBeNull();
    expect(generateButton()).toBeNull();

    // And it must be recoverable without paying for a new package.
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/API error 500/);
  });

  it("still shows the empty state, with Generate, when the package is genuinely missing", async () => {
    // The API's real "nothing here" answer: 200 with status "missing".
    fetchOnboardingPackage.mockResolvedValue({
      id: "",
      role: "backend",
      status: "missing",
      sections: [],
    });
    renderReader();

    await waitFor(() => {
      expect(screen.getByText(/no package for/i)).toBeInTheDocument();
    });
    expect(generateButton()).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load this package/i)).toBeNull();
  });

  it("shows neither state while the first fetch is still in flight", async () => {
    let resolve!: (v: unknown) => void;
    fetchOnboardingPackage.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderReader();

    // Before the fix `pkg` started null, so the "No package — Generate" pane
    // painted on every load and every package switch before any answer.
    expect(screen.queryByText(/no package for/i)).toBeNull();
    expect(generateButton()).toBeNull();
    expect(screen.getByText(/loading this package/i)).toBeInTheDocument();

    resolve({ id: "", role: "backend", status: "missing", sections: [] });
    await waitFor(() => expect(screen.getByText(/no package for/i)).toBeInTheDocument());
  });
});
