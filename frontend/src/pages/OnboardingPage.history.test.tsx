import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PackageCard } from "@/types/onboarding";

// Only view boundaries push a history entry; everything else replaces.

const CARD: PackageCard = {
  id: "pkg-1",
  snapshot_id: "snap-1",
  role: "backend",
  status: "approved",
  analyzed_commit: "abcdef1234567",
  commit_message: null,
  branch: "main",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  scope_name: "Whole repository",
  path_prefix: "",
  scope_kind: "repo",
  semantic_depth: "standard",
  privacy_mode: "metadata",
  section_count: 12,
  stale_sections: 0,
  approved_sections: 0,
  low_confidence_sections: 0,
  tutorial_count: 0, stale_tutorials: 0,
  is_latest_commit: true,
};

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
    packages: [CARD],
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

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

const { OnboardingPage } = await import("./OnboardingPage");

/** Query string plus a real Back, which MemoryRouter serves from its stack. */
function HistoryProbe() {
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="search">{useLocation().search}</span>
      <button onClick={() => navigate(-1)}>probe-back</button>
    </>
  );
}

const currentSearch = () => screen.getByTestId("search").textContent ?? "";

function renderPage() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/p1/onboarding"]}>
        <HistoryProbe />
        <Routes>
          <Route path="/projects/:id/onboarding" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("onboarding reader history (J3)", () => {
  it("pushes the reader so Back returns to the package grid", async () => {
    fetchOnboardingPackage.mockResolvedValue({ status: "missing", role: "backend" });
    renderPage();

    // The scope name is a real <Link> now (middle-click, Cmd-click, new tab),
    // so this is the same journey the old div-with-role served, taken through
    // the anchor the browser also honours.
    fireEvent.click(await screen.findByRole("link", { name: /Whole repository/ }));
    await waitFor(() => expect(currentSearch()).toContain("view=reader"));

    fireEvent.click(screen.getByRole("button", { name: "probe-back" }));

    // With `replace: true` the grid entry is overwritten, so Back has nowhere to go.
    await waitFor(() => expect(currentSearch()).not.toContain("view=reader"));
    expect(await screen.findByRole("link", { name: /Whole repository/ })).toBeInTheDocument();
  });
});

/**
 * The regenerate dialog lives on the card grid, which this file already mounts
 * with one card and a `developer` tier — the two states that must stay visible
 * rather than disappear. Hiding an option was the old behaviour: the dialog
 * changed shape per card, so nobody learned the cheap "only the stale
 * sections" option existed until a package happened to be stale, and a
 * developer never saw that re-analysis was a thing owners do.
 */
describe("regenerate dialog options", () => {
  it("keeps all three options on screen and states why the unusable ones are off", async () => {
    fetchOnboardingPackage.mockResolvedValue({ status: "missing", role: "backend" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Regenerate…/ }));

    expect(
      await screen.findByRole("button", { name: /Regenerate all sections \(same commit\)/ }),
    ).toBeEnabled();

    // CARD has no stale sections and no stale tutorials.
    const stale = screen.getByRole("button", { name: /Regenerate only the stale sections/ });
    expect(stale).toBeDisabled();
    expect(stale).toHaveTextContent(/Nothing is stale right now/);

    // Tier is `developer`: re-analysis is a billed owner/admin run.
    const newCommit = screen.getByRole("button", { name: /Regenerate all sections \(new commit\)/ });
    expect(newCommit).toBeDisabled();
    expect(newCommit).toHaveTextContent(/Owners and admins only/);
  });
});
