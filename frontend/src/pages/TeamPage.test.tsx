import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { TeamPage } from "./TeamPage";

// Leave, transfer, the tier/role save, the "You" marker and the two progress
// columns. All of them regress silently — the page still renders either way.

const projectState = vi.hoisted(() => ({ tier: "developer" }));
const authState = vi.hoisted(() => ({ id: "u-dev" }));
const refetch = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/contexts/ProjectContext", () => ({
  useProject: () => ({
    project: {
      id: "p1",
      repo_owner: "acme",
      repo_name: "rocket",
      permission_tier: projectState.tier,
      developer_role: "backend",
      status: "complete",
      settings: null,
    },
    loading: false,
    error: "",
    refetch,
  }),
}));

// Not optional: `useAuth` throws outside an AuthProvider, and the page needs the
// caller's id to know which row is theirs.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: authState.id }, session: null, loading: false }),
}));

const MEMBERS = [
  {
    user_id: "u-owner", email: "lead@acme.test", permission_tier: "owner",
    developer_role: "backend", joined_at: "2026-06-01T00:00:00.000Z",
    github_username: null, sections_reviewed: 4, sections_read: 1,
  },
  {
    user_id: "u-dev", email: "dev@acme.test", permission_tier: "developer",
    developer_role: "frontend", joined_at: "2026-06-02T00:00:00.000Z",
    github_username: null, sections_reviewed: 0, sections_read: 7,
  },
];

const mockApi = vi.mocked(apiFetch);

/**
 * Radix's Select uses Pointer Events capture and `scrollIntoView`, neither of
 * which jsdom implements — without these the trigger never opens and the manage
 * test fails on a missing `option`. Scoped to this file (as in ImportPage.test)
 * rather than the shared setup so no other suite inherits a fake pointer API.
 */
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

/** The caller is whoever holds `tier`: owner → u-owner, anything else → u-dev. */
function renderTeam(tier: string) {
  projectState.tier = tier;
  authState.id = tier === "owner" ? "u-owner" : "u-dev";
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/p1/team"]}>
        <Routes>
          <Route path="/projects/:id/team" element={<TeamPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("TeamPage", () => {
  beforeEach(() => {
    navigate.mockReset();
    refetch.mockReset();
    mockApi.mockReset();
    mockApi.mockImplementation((path: string) => {
      if (path === "/projects/p1/members") return Promise.resolve({ members: MEMBERS });
      if (path === "/projects/p1/members/invitations") return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });
  });

  it("reports approvals and read marks as two separate numbers", async () => {
    renderTeam("developer");

    await screen.findByText("dev");
    expect(screen.getByRole("columnheader", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Read" })).toBeInTheDocument();

    // Approved nothing (an owner/admin action) but has read seven sections — the case
    // a single column collapses to 0. Indexed from the end, past the actions cell.
    const row = screen.getByRole("button", { name: "View dev@acme.test" }).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[cells.length - 3]).toHaveTextContent("0");
    expect(cells[cells.length - 2]).toHaveTextContent("7");
  });

  it("lets a non-owner leave the project from their own row", async () => {
    const user = userEvent.setup();
    renderTeam("developer");

    await screen.findByText("dev");
    await user.click(screen.getByRole("button", { name: /Leave team/ }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Leave project/ }));

    expect(mockApi).toHaveBeenCalledWith("/projects/p1/members/me", { method: "DELETE" });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/dashboard"));
  });

  it("offers the owner a transfer instead of a way out", async () => {
    const user = userEvent.setup();
    renderTeam("owner");

    await screen.findByText("dev");
    // The owner's own Leave stays visible but inert — the project would be ownerless.
    expect(screen.getByRole("button", { name: /Leave team/ })).toBeDisabled();

    // Viewing a member is read-only: no control reaches the profile dialog.
    await user.click(screen.getByRole("button", { name: "View dev@acme.test" }));
    const profile = await screen.findByRole("dialog");
    expect(within(profile).queryByLabelText("Permission tier")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(await screen.findByRole("button", { name: "Member actions for dev@acme.test" }));
    await user.click(await screen.findByRole("menuitem", { name: /Transfer ownership/ }));

    // Type-to-confirm: the caller cannot undo this one.
    const typed = await screen.findByLabelText("Type rocket to confirm");
    await user.type(typed, "rocket");
    // The confirm dialog sits over the member dialog, so scope to it.
    const confirmDialog = typed.closest("[role=dialog]") as HTMLElement;
    await user.click(within(confirmDialog).getByRole("button", { name: /Transfer ownership/ }));

    expect(mockApi).toHaveBeenCalledWith(
      "/projects/p1/members/u-dev/transfer-ownership",
      { method: "POST" },
    );
    // The caller's own tier gates every owner-only control here and on settings, so
    // it has to be re-read immediately.
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("saves tier and role together from the manage modal", async () => {
    const user = userEvent.setup();
    renderTeam("owner");

    await screen.findByText("dev");
    await user.click(screen.getByRole("button", { name: "Manage dev@acme.test" }));

    await user.click(await screen.findByLabelText("Permission tier"));
    await user.click(await screen.findByRole("option", { name: "Admin" }));

    await user.click(screen.getByRole("button", { name: /Save/ }));

    // PATCH carries both fields whether or not both changed — the endpoint treats
    // a missing one as "leave alone", so a partial body would silently drop the role.
    expect(mockApi).toHaveBeenCalledWith("/projects/p1/members/u-dev", {
      method: "PATCH",
      body: JSON.stringify({ permission_tier: "admin", developer_role: "frontend" }),
    });
  });

  // The whole row is the click target, not just the name. A guard that catches
  // too much (or a cell that stops propagation) breaks this invisibly: the row
  // still hovers and still looks clickable.
  it("opens the profile from a plain cell in the row body", async () => {
    const user = userEvent.setup();
    renderTeam("developer");

    await screen.findByText("dev");
    const row = screen.getByRole("button", { name: "View dev@acme.test" }).closest("tr")!;
    // Short tier label, decided with the product owner — "developer" never appears.
    expect(within(row).getByText("Dev")).toBeInTheDocument();

    await user.click(within(row).getByText("7"));

    const profile = await screen.findByRole("dialog");
    expect(within(profile).getByText("dev@acme.test")).toBeInTheDocument();
  });

  it("marks only the caller's own row with You", async () => {
    renderTeam("developer");

    await screen.findByText("dev");
    const own = screen.getByRole("button", { name: "View dev@acme.test" });
    const other = screen.getByRole("button", { name: "View lead@acme.test" });

    expect(within(own).getByText("You")).toBeInTheDocument();
    expect(within(other).queryByText("You")).not.toBeInTheDocument();
  });
});
