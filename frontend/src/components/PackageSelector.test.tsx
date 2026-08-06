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
const PKG_B = { ...PKG_A, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", branch: "dev", role: "frontend", is_latest_commit: false };

function mockCtx(overrides: Partial<ReturnType<typeof baseCtx>> = {}) {
  const ctx = { ...baseCtx(), ...overrides };
  vi.mocked(usePackages).mockReturnValue(ctx as never);
  vi.mocked(useProject).mockReturnValue({
    project: { repo_name: "auth-demo" },
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
    expect(screen.getByText(/backend\/ · Backend Developer/)).toBeInTheDocument();
    // The commit moved into the dropdown rows: the closed button is one line
    // of chrome the sidebar's height contract depends on.
    expect(screen.queryByText(/main@abc1234/)).not.toBeInTheDocument();
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

    await openMenu(user);
    expect(screen.getByText("dev@abc1234")).toBeInTheDocument();
    expect(screen.getByText(/backend\/ · Frontend Developer/)).toBeInTheDocument();
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

  it("shows the full commit and the depth on row hover", async () => {
    mockCtx();
    renderSelector();
    const user = userEvent.setup();

    await openMenu(user);
    await user.hover(screen.getByText("dev@abc1234"));

    // Radix renders tooltip content twice (visible + a visually-hidden copy
    // for aria-describedby), hence getAllByText.
    await waitFor(() => expect(screen.getAllByText("abc1234def5678").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/analyzed .+ · standard depth/).length).toBeGreaterThan(0);
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
