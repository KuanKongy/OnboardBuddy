import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PackageSelector } from "./PackageSelector";
import { usePackages } from "@/contexts/PackagesContext";
import { useProject } from "@/contexts/ProjectContext";

vi.mock("@/contexts/PackagesContext", () => ({
  usePackages: vi.fn(),
}));

// The closed button names the repo now, so the selector reads the project too.
vi.mock("@/contexts/ProjectContext", () => ({
  useProject: vi.fn(),
}));

const PKG_A = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  snapshot_id: "snap-1",
  role: "backend",
  status: "approved",
  analyzed_commit: "abc1234def5678",
  commit_message: "Add refresh-token rotation" as string | null,
  branch: "main",
  created_at: "2026-07-01T10:00:00Z",
  updated_at: "2026-07-01T10:00:00Z",
  scope_name: "backend",
  path_prefix: "backend",
  scope_kind: "manual",
  semantic_depth: "standard",
  privacy_mode: "full_ai",
  section_count: 11,
  stale_sections: 0,
  approved_sections: 11,
  low_confidence_sections: 0,
  tutorial_count: 3, stale_tutorials: 0,
  is_latest_commit: true,
};
const PKG_B = {
  ...PKG_A,
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  branch: "dev",
  role: "frontend",
  commit_message: "Split the session store out of the auth middleware",
  is_latest_commit: false,
};
/** Analyzed before the run recorded its commit subject. */
const PKG_LEGACY = { ...PKG_B, commit_message: null };

function mockCtx(overrides: Partial<ReturnType<typeof baseCtx>> = {}) {
  const ctx = { ...baseCtx(), ...overrides };
  vi.mocked(usePackages).mockReturnValue(ctx as never);
  vi.mocked(useProject).mockReturnValue({
    // branch: the no-package pill names the project from the repo and branch,
    // with no package to take them from.
    project: { repo_owner: "acme", repo_name: "auth-demo", branch: "main" },
    loading: false,
    error: "",
    refetch: vi.fn(),
  } as never);
  return ctx;
}

function baseCtx() {
  return {
    packages: [PKG_A, PKG_B] as typeof PKG_A[],
    refreshPackages: vi.fn(),
    selectedPackageId: PKG_A.id as string | null,
    selectedPackage: PKG_A as typeof PKG_A | null,
    selectPackage: vi.fn(),
    resolvedPackage: null as typeof PKG_A | null,
    pinnedPackageId: null as string | null,
    pinPackage: vi.fn(),
    defaultPackageId: null as string | null,
    status: null,
    refreshStatus: vi.fn(),
    activeJobs: [],
    registerSessionJob: vi.fn(),
    packageQuery: `?package_id=${PKG_A.id}`,
    packagesError: false,
    statusError: false,
  };
}

function renderSelector() {
  return render(
    <TooltipProvider>
      <PackageSelector />
    </TooltipProvider>,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle(/which package every tab shows/i));
  await waitFor(() => expect(screen.getByText("Latest analysis (auto)")).toBeInTheDocument());
}

describe("PackageSelector", () => {
  it("shows the repo and branch on one line, scope and role on the next", () => {
    mockCtx();
    renderSelector();
    // The separator lives inside the repo span so the two truncate together.
    expect(screen.getByText("auth-demo /")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText(/backend\/ · Backend/)).toBeInTheDocument();
    // The commit moved into the dropdown rows: the closed button is one line
    // of chrome the sidebar's height contract depends on.
    expect(screen.queryByText(/main@abc1234/)).not.toBeInTheDocument();
  });

  it("still names the project when it has no packages", () => {
    mockCtx({ packages: [], selectedPackage: null, selectedPackageId: null });
    renderSelector();

    // This pill is the only place any project page names the project, so an
    // unanalyzed project used to sit under no name at all.
    expect(screen.getByText(/auth-demo \/ main/)).toBeInTheDocument();
    expect(screen.getByText("No package yet")).toBeInTheDocument();
    // Nothing to choose between: the label is not a menu.
    expect(screen.queryByTitle(/which package every tab shows/i)).not.toBeInTheDocument();
  });

  it("lists every package plus 'Latest analysis' and selects on click", async () => {
    const ctx = mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await openMenu(user);
    // owner/repo, not a bare repo name: two imports can share the name.
    expect(screen.getByText("acme/auth-demo")).toBeInTheDocument();
    expect(screen.getByText("dev@abc1234")).toBeInTheDocument();
    expect(screen.getByText(/backend\/ · Frontend/)).toBeInTheDocument();
    expect(screen.getByText(/behind latest on dev/)).toBeInTheDocument();

    await user.click(screen.getByText("dev@abc1234"));
    expect(ctx.selectPackage).toHaveBeenCalledWith(PKG_B.id);
  });

  it("says each package's status as well as colouring it", async () => {
    mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await openMenu(user);

    expect(screen.getAllByText("status: approved").length).toBe(2);
  });

  it("names the commit and the run's settings on row hover", async () => {
    mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await openMenu(user);
    await user.hover(screen.getByText("dev@abc1234"));

    // Radix renders tooltip content twice (visible + a visually-hidden copy
    // for aria-describedby), hence getAllByText.
    await waitFor(() =>
      expect(screen.getAllByText("Split the session store out of the auth middleware").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("standard depth · Full AI").length).toBeGreaterThan(0);
    // The analyzed date was the old second line and told nobody anything.
    expect(screen.queryByText(/analyzed /)).not.toBeInTheDocument();
  });

  it("falls back to the short sha when the package predates commit subjects", async () => {
    mockCtx({ packages: [PKG_LEGACY], selectedPackage: null, selectedPackageId: null });
    renderSelector();
    const user = userEvent.setup();

    await openMenu(user);
    await user.hover(screen.getByText("dev@abc1234"));

    await waitFor(() => expect(screen.getAllByText("abc1234").length).toBeGreaterThan(0));
  });

  it("names the package the server resolves to when this tab has no selection", () => {
    mockCtx({ selectedPackage: null, selectedPackageId: null, resolvedPackage: PKG_B });
    renderSelector();

    // No "(auto)" suffix: the tabs really are showing this package, and the
    // menu is where the auto state is marked.
    expect(screen.getByText("dev")).toBeInTheDocument();
    expect(screen.queryByText("Latest analysis")).not.toBeInTheDocument();
  });

  it("marks the selected row with aria-current, not a check", async () => {
    mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await openMenu(user);

    const selected = screen.getByText("main@abc1234").closest('[role="menuitem"]')!;
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(selected.className).toContain("bg-primary/5");

    const other = screen.getByText("dev@abc1234").closest('[role="menuitem"]')!;
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("pins from the star without selecting the row or closing the menu", async () => {
    const ctx = mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Pin dev as this project's default" }));

    expect(ctx.pinPackage).toHaveBeenCalledWith(PKG_B.id);
    expect(ctx.selectPackage).not.toHaveBeenCalled();
    expect(screen.getByText("Latest analysis (auto)")).toBeInTheDocument();
  });

  it("unpins back to follow-the-newest from the 'Latest analysis' star", async () => {
    const ctx = mockCtx({ pinnedPackageId: PKG_B.id });
    renderSelector();
    const user = userEvent.setup();

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: /follow the newest analysis/i }));

    expect(ctx.pinPackage).toHaveBeenCalledWith(null);
    expect(ctx.selectPackage).not.toHaveBeenCalled();
  });
});
