import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PackageSelector } from "./PackageSelector";
import { usePackages } from "@/contexts/PackagesContext";

vi.mock("@/contexts/PackagesContext", () => ({
  usePackages: vi.fn(),
}));

const PKG_A = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  snapshot_id: "snap-1",
  role: "backend",
  status: "approved",
  analyzed_commit: "abc1234def5678",
  branch: "main",
  created_at: "",
  updated_at: "",
  scope_name: "backend",
  path_prefix: "backend",
  scope_kind: "manual",
  semantic_depth: "standard",
  privacy_mode: "full_ai",
  section_count: 11,
  stale_sections: 0,
  approved_sections: 11,
  low_confidence_sections: 0,
  tutorial_count: 3,
  is_latest_commit: true,
};
const PKG_B = { ...PKG_A, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", branch: "dev", role: "frontend", is_latest_commit: false };

function mockCtx(overrides: Partial<ReturnType<typeof baseCtx>> = {}) {
  const ctx = { ...baseCtx(), ...overrides };
  vi.mocked(usePackages).mockReturnValue(ctx as never);
  return ctx;
}

function baseCtx() {
  return {
    packages: [PKG_A, PKG_B] as typeof PKG_A[],
    refreshPackages: vi.fn(),
    selectedPackageId: PKG_A.id as string | null,
    selectedPackage: PKG_A as typeof PKG_A | null,
    selectPackage: vi.fn(),
    defaultPackageId: null as string | null,
    setDefaultPackage: vi.fn().mockResolvedValue(undefined),
    status: null,
    refreshStatus: vi.fn(),
    activeJobs: [],
    registerSessionJob: vi.fn(),
    packageQuery: `?package_id=${PKG_A.id}`,
    packagesError: false,
    statusError: false,
    defaultPackageError: false,
  };
}

function renderSelector() {
  return render(
    <TooltipProvider>
      <PackageSelector />
    </TooltipProvider>,
  );
}

describe("PackageSelector", () => {
  it("shows the selected package's branch@commit, scope, and role", () => {
    mockCtx();
    renderSelector();
    expect(screen.getByText(/main@abc1234/)).toBeInTheDocument();
    expect(screen.getByText(/backend\/ · Backend Developer/)).toBeInTheDocument();
  });

  it("renders nothing when the project has no packages", () => {
    mockCtx({ packages: [], selectedPackage: null, selectedPackageId: null });
    const { container } = renderSelector();
    expect(container.firstChild).toBeNull();
  });

  it("lists every package plus 'Latest analysis' and selects on click", async () => {
    const ctx = mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await user.click(screen.getByTitle(/which package every tab shows/i));
    await waitFor(() => expect(screen.getByText("Latest analysis (auto)")).toBeInTheDocument());
    expect(screen.getByText(/dev@abc1234 · backend\/ · Frontend Developer/)).toBeInTheDocument();
    expect(screen.getByText(/behind latest on dev/)).toBeInTheDocument();

    await user.click(screen.getByText(/dev@abc1234/));
    expect(ctx.selectPackage).toHaveBeenCalledWith(PKG_B.id);
  });

  it("the star sets the member default without selecting", async () => {
    const ctx = mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await user.click(screen.getByTitle(/which package every tab shows/i));
    await waitFor(() => expect(screen.getByText("Latest analysis (auto)")).toBeInTheDocument());

    const stars = screen.getAllByTitle("Make this your default package");
    await user.click(stars[0]!);

    expect(ctx.setDefaultPackage).toHaveBeenCalledWith(PKG_A.id);
    expect(ctx.selectPackage).not.toHaveBeenCalled();
  });

  /**
   * #74/#71 item 4. Probed before fixing: with the menu open, Tab leaves focus
   * on the highlighted menuitem and never reaches the nested star button, so
   * there was no keyboard route to your own default package. The item now takes
   * the keypress — and it must not also select, or "make this my default" would
   * silently change what every tab is showing.
   */
  it("sets the default from the keyboard without changing the selection", async () => {
    const ctx = mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await user.click(screen.getByTitle(/which package every tab shows/i));
    await waitFor(() => expect(screen.getByText("Latest analysis (auto)")).toBeInTheDocument());

    // Down twice: past "Latest analysis (auto)" onto the first real package.
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard("*");

    expect(ctx.setDefaultPackage).toHaveBeenCalledWith(PKG_A.id);
    expect(ctx.selectPackage).not.toHaveBeenCalled();
    // The key is announced rather than printed, so the attribute is the contract.
    expect(screen.getAllByRole("menuitem")[0]).toHaveAttribute("aria-keyshortcuts", "*");
  });

  // #74/H7: the PUT rejected into a `void` call, so the star stayed put and the
  // only trace was an unhandled rejection in the console.
  it("shows a failed default without losing the menu", async () => {
    mockCtx({ defaultPackageError: true });
    renderSelector();
    const user = userEvent.setup();

    await user.click(screen.getByTitle(/which package every tab shows/i));
    await waitFor(() => expect(screen.getByText("Latest analysis (auto)")).toBeInTheDocument());

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save your default/i);
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(1);
  });

  // #74/G7: the coloured dot was the only carrier of the package's state.
  it("says each package's status as well as colouring it", async () => {
    mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await user.click(screen.getByTitle(/which package every tab shows/i));
    await waitFor(() => expect(screen.getByText("Latest analysis (auto)")).toBeInTheDocument());

    expect(screen.getAllByText("status: approved").length).toBe(2);
  });
});
