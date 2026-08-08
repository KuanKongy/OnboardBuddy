import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OnboardingPage, SectionView } from "./OnboardingPage";
import type { OnboardingPackage, OnboardingSection } from "@/types/onboarding";

/**
 * Owner feedback K1: known gaps and citations stay in the package but "should
 * only show up on demand". The regression this guards is the one the audit
 * measured — a gaps block at 63% of its section (§19.4) and a 43-chip citation
 * footer rendered all at once (§19.3) — so the affordance must both hide the
 * detail by default and state how much is behind it.
 */
const receipt = (filePath: string) => ({ filePath, staleness: "fresh" as const });

// Full-page mounts (bottom of this file) need the reader's whole context
// graph. `tier` is a box rather than a constant because permission tier is the
// variable under test and vi.mock factories are hoisted above any per-test let.
const tier = vi.hoisted(() => ({ current: "developer" as string }));
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
      permission_tier: tier.current,
      developer_role: "backend",
      status: "complete",
      settings: null,
    },
    loading: false,
    error: "",
    refetch: vi.fn(),
  }),
}));

// Stateful like the real context: the reader's M3 sync adopts the URL's
// package as the project-wide selection on entry, and AFTER that the chooser
// drives the URL — with a frozen `selectedPackageId: null` that second branch
// rewrote `?package=` back to null and no test could ever switch packages.
const packagesCtx = vi.hoisted(() => ({ selectedPackageId: null as string | null }));
vi.mock("@/contexts/PackagesContext", () => ({
  usePackages: () => ({
    packages: [],
    packagesError: false,
    refreshPackages: vi.fn(),
    selectPackage: (pkgId: string | null) => { packagesCtx.selectedPackageId = pkgId; },
    selectedPackageId: packagesCtx.selectedPackageId,
    registerSessionJob: vi.fn(),
  }),
}));

// One frozen object, not a fresh literal per call: `items` is a dependency of
// the effect that seeds `readSections`, and the real hook holds it in state.
// A new array per render makes that effect re-run forever once a package with
// sections is loaded ("Maximum update depth"), which is a harness artifact.
const progress = vi.hoisted(() => ({ items: [], loaded: true, loadError: false, save: vi.fn() }));
vi.mock("@/lib/useProgress", () => ({ useProgress: () => progress }));

// jsdom has no `Element.scrollTo`; the reader calls it on section change.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

const SECTION: OnboardingSection = {
  id: "guardrails-ops",
  sectionId: "sec-1",
  label: "Guardrails & Operations",
  status: "complete",
  confidence: "medium",
  claims: { total: 9, cited: 7, low: 1 },
  blocks: [
    {
      title: "Guardrails & Operations",
      body: "Budgets cap one run.",
      receipts: [receipt("lib/queue.ts"), receipt("lib/budget.ts"), receipt("lib/db.ts")],
    },
  ],
  diagrams: [],
  unknowns: [
    { kind: "budget_degraded" },
    { kind: "noReceipt", detail: "no evidence for the webhook path" },
  ],
};

function renderSection(section: OnboardingSection = SECTION) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SectionView section={section} projectId="p1" onReceiptClick={() => {}} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("reader gaps & citations (K1)", () => {
  it("keeps both lists collapsed behind an affordance that names their size", async () => {
    renderSection();

    expect(
      ["3 citations", "2 known gaps"].map((label) => ({
        label,
        expanded: screen.getByRole("button", { name: new RegExp(label) }).getAttribute("aria-expanded"),
        detailShown: screen.queryByText(/lib\/budget\.ts|analysis budget ran out/i) !== null,
      })),
    ).toEqual([
      { label: "3 citations", expanded: "false", detailShown: false },
      { label: "2 known gaps", expanded: "false", detailShown: false },
    ]);

    await userEvent.click(screen.getByRole("button", { name: /2 known gaps/ }));
    expect(screen.getByText(/analysis budget ran out/i)).toBeInTheDocument();
  });

  it("draws the grade as a pie labelled with the arithmetic behind it", () => {
    const { unmount } = renderSection();
    expect(
      screen.getByRole("img", { name: "Medium confidence: 7 of 9 claims cite receipts" }),
    ).toBeInTheDocument();
    unmount();

    // `claims: null` is a real answer (generations that predate the claim
    // ledger), not a missing field: the pie still has to draw and still has to
    // name the grade, rather than render a NaN arc with no label.
    renderSection({ ...SECTION, claims: null });
    expect(screen.getByRole("img", { name: "Medium confidence" })).toBeInTheDocument();
  });

  it("renders GFM tables as real tables, not literal pipe characters", () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <SectionView
            section={{
              ...SECTION,
              unknowns: [],
              blocks: [
                {
                  title: "Guardrails & Operations",
                  body: "| Variable | Purpose |\n| --- | --- |\n| REDIS_URL | queue backend |",
                  receipts: [],
                },
              ],
            }}
            projectId="p1"
            onReceiptClick={() => {}}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    // The audit's "pipe soup" (READER_REDESIGN.md N1): without remark-gfm this
    // body renders as one paragraph containing literal `|` characters.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Variable" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "queue backend" })).toBeInTheDocument();
    expect(screen.queryByText(/\|\s*---\s*\|/)).toBeNull();
  });
});

const PACKAGE: OnboardingPackage = {
  id: "pkg-1",
  projectId: "p1",
  role: "backend",
  status: "approved",
  generatedAt: "2026-07-01T00:00:00Z",
  sections: [
    {
      id: "big-picture",
      sectionId: "sec-1",
      label: "Big picture",
      status: "complete",
      confidence: "high",
      blocks: [{ title: "Big picture", body: "One queue, one worker.", receipts: [] }],
    },
  ],
};

function renderReader() {
  return render(
    <TooltipProvider>
      {/* ?package= pins the reader to one package, the way a card link opens
          it; ?role= alone is the legacy "latest for role" entry. */}
      <MemoryRouter initialEntries={["/projects/p1/onboarding?view=reader&package=pkg-1&role=backend"]}>
        <Routes>
          <Route path="/projects/:id/onboarding" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/**
 * The read mark was gated `!canManage`, so an owner or admin had no control
 * that recorded personal progress at all — their rail sat at "0/12 read" for
 * the life of the package, while the tour promised a tracker. The write path
 * was already tier-independent, so only the top bar was ever wrong.
 */
describe("reader read mark (every tier)", () => {
  beforeEach(() => {
    fetchOnboardingPackage.mockReset();
    fetchOnboardingPackage.mockResolvedValue(PACKAGE);
    // The progress mock is one shared mutable object (see its definition), so
    // the fields have to be put back rather than the object rebuilt.
    progress.loaded = true;
    progress.loadError = false;
    progress.save.mockReset();
  });

  function openTooltip() {
    return waitFor(() => {
      const el = document.querySelector('[data-slot="tooltip-content"]');
      if (!el) throw new Error("tooltip did not open");
      return el as HTMLElement;
    });
  }

  it("gives owners both the editorial mark and their own read mark, with one tour target", async () => {
    tier.current = "owner";
    const { container } = renderReader();

    expect(await screen.findByRole("button", { name: /Mark reviewed|Reviewed/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mark as read|Read/ })).toBeInTheDocument();
    // Both buttons used to carry data-tour="reader-review", which points the
    // "track what you've read" step at whichever one the DOM yields first.
    expect(container.querySelectorAll('[data-tour="reader-review"]')).toHaveLength(1);
  });

  it("leaves developers with the read mark and no editorial mark", async () => {
    tier.current = "developer";
    renderReader();

    expect(await screen.findByRole("button", { name: /Mark as read|Read/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Mark reviewed|Reviewed/ })).toBeNull());
  });

  /**
   * What an owner actually reported ("you can only mark as read if you mark as
   * reviewed") was this: the button is disabled until GET /progress lands, and
   * until this change the only state that explained itself was the failure.
   * During the round trip, and forever after a failed GET, clicking did
   * nothing and said nothing — which reads as a control gated on something
   * else. Nothing about the disabled state is visible to a passing eye, so it
   * is pinned here.
   */
  it("says it is loading while progress is in flight, instead of going quietly dead", async () => {
    tier.current = "developer";
    progress.loaded = false;
    const user = userEvent.setup();
    renderReader();

    const button = await screen.findByRole("button", { name: "Mark as read" });
    expect(button).toBeDisabled();
    // The wrapper is focusable precisely BECAUSE the button is disabled: a
    // disabled button takes no pointer or keyboard events, so without it the
    // explanation below is unreachable by either.
    expect(button.parentElement).toHaveAttribute("tabindex", "0");

    await user.hover(button.parentElement!);
    // Radix mirrors the copy into a hidden twin inside the same node, so the
    // text arrives doubled: match it, do not compare it.
    expect((await openTooltip()).textContent).toMatch(/Loading your reading progress\./);
  });

  it("keeps the Bug #68 copy when the progress fetch failed", async () => {
    tier.current = "developer";
    progress.loaded = false;
    progress.loadError = true;
    const user = userEvent.setup();
    renderReader();

    const button = await screen.findByRole("button", { name: "Mark as read" });
    expect(button).toBeDisabled();

    await user.hover(button.parentElement!);
    expect((await openTooltip()).textContent).toMatch(/marks are paused for this\s+visit/);
  });

  it("flips the mark on click and saves the section against the package", async () => {
    tier.current = "developer";
    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Mark as read" }));
    expect(await screen.findByRole("button", { name: "Read" })).toBeInTheDocument();

    // The auto-save effect fires once on init with an empty list, so it is the
    // LAST call — not any call — that has to carry the section.
    await waitFor(() =>
      expect(progress.save).toHaveBeenLastCalledWith(
        "onboarding",
        "pkg-1",
        expect.objectContaining({ readSections: expect.arrayContaining(["big-picture"]) }),
      ),
    );
  });
});

/**
 * `?section=` was read on load and never written, so every sidebar click and
 * every ←/→ moved the reader without moving the address bar: refreshing or
 * sharing the link reopened at the package's first section. A URL that has
 * stopped tracking looks identical to one that is tracking, which is why this
 * is pinned rather than left to the eye.
 */
const TWO_SECTIONS: OnboardingPackage = {
  ...PACKAGE,
  sections: [
    PACKAGE.sections[0]!,
    {
      id: "concepts",
      sectionId: "sec-2",
      label: "Concepts",
      status: "complete",
      confidence: "high",
      blocks: [{ title: "Concepts", body: "A job is one unit of work.", receipts: [] }],
    },
  ],
};

/** The query string as the router currently holds it. */
function LocationProbe() {
  return <span data-testid="search">{useLocation().search}</span>;
}

describe("reader place in the URL", () => {
  beforeEach(() => {
    fetchOnboardingPackage.mockReset();
    fetchOnboardingPackage.mockResolvedValue(TWO_SECTIONS);
    progress.loaded = true;
    progress.loadError = false;
    progress.save.mockReset();
    tier.current = "developer";
  });

  it("writes the section it is showing, and follows the arrow keys", async () => {
    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={["/projects/p1/onboarding?view=reader&package=pkg-1&role=backend"]}>
          <LocationProbe />
          <Routes>
            <Route path="/projects/:id/onboarding" element={<OnboardingPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );

    // Arrived without one: the reader still has to say where it is.
    await waitFor(() => expect(screen.getByTestId("search").textContent).toContain("section=big-picture"));

    fireEvent.keyDown(document.body, { key: "ArrowRight" });

    await waitFor(() => expect(screen.getByTestId("search").textContent).toContain("section=concepts"));
  });
});

/**
 * ui-ux-audit-round3 salvage: switching packages while the reader stayed
 * mounted merged the previous package's read marks into the next one, and the
 * save effect then persisted that union under the NEW package's id — display
 * corruption that wrote itself into user_progress. Marks must swap wholesale
 * with the package, and nothing of package A may ever be saved under B's id.
 */
const PACKAGE_B: OnboardingPackage = {
  ...PACKAGE,
  id: "pkg-2",
  sections: [
    {
      id: "big-picture",
      sectionId: "sec-1b",
      label: "Big picture",
      status: "complete",
      confidence: "high",
      blocks: [{ title: "Big picture", body: "Two queues, two workers.", receipts: [] }],
    },
  ],
};

function SwitchToB() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => {
        // The chooser and the URL move together in the real flow (the M3 sync
        // effect would revert a URL that disagrees with the selection).
        packagesCtx.selectedPackageId = "pkg-2";
        navigate("/projects/p1/onboarding?view=reader&package=pkg-2&role=backend");
      }}
    >
      __switch-package__
    </button>
  );
}

describe("read marks across a package switch", () => {
  beforeEach(() => {
    fetchOnboardingPackage.mockReset();
    fetchOnboardingPackage.mockImplementation(
      (_projectId: string, opts?: { packageId?: string | null }) =>
        Promise.resolve(opts?.packageId === "pkg-2" ? PACKAGE_B : PACKAGE),
    );
    progress.items = [
      { kind: "onboarding", ref_id: "pkg-1", still_exists: true, position: { readSections: ["big-picture"] } },
    ] as never;
    progress.loaded = true;
    progress.loadError = false;
    progress.save.mockReset();
    tier.current = "developer";
    packagesCtx.selectedPackageId = null;
  });

  afterEach(() => {
    progress.items = [] as never;
  });

  it("swaps marks with the package instead of merging and re-saving them", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={["/projects/p1/onboarding?view=reader&package=pkg-1&role=backend"]}>
          <SwitchToB />
          <Routes>
            <Route path="/projects/:id/onboarding" element={<OnboardingPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );

    // pkg-1: its stored mark is on screen (the only section reads as Read).
    expect(await screen.findByRole("button", { name: "Read" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "__switch-package__" }));

    // pkg-2 rendered, and its identically-named section is NOT marked read.
    await screen.findByText(/Two queues, two workers\./);
    expect(await screen.findByRole("button", { name: "Mark as read" })).toBeInTheDocument();

    // Nothing of pkg-1 was ever written under pkg-2's id.
    const savesForB = progress.save.mock.calls.filter((c) => c[1] === "pkg-2");
    for (const call of savesForB) {
      expect((call[2] as { readSections: string[] }).readSections).not.toContain("big-picture");
    }
  });
});
