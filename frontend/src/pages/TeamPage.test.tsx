import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { TeamPage } from "./TeamPage";

/**
 * Bug #72 + #74/F16 — the three things this page could not do.
 *
 * A member could not leave (removal is somebody else's action and refuses
 * self-removal), ownership could not move (the tier dropdown refuses to assign
 * it), and the one progress number shown was an *editorial* approval count
 * under a label that read like reading progress — so a developer's progress was
 * permanently 0. All three regress silently: the page still renders.
 */

const projectState = vi.hoisted(() => ({ tier: "developer" }));
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

function renderTeam(tier: string) {
  projectState.tier = tier;
  return render(
    <MemoryRouter initialEntries={["/projects/p1/team"]}>
      <Routes>
        <Route path="/projects/:id/team" element={<TeamPage />} />
      </Routes>
    </MemoryRouter>,
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

    // The developer has approved nothing (an owner/admin action) but has read
    // seven sections — the case the single old column reported as 0.
    const row = screen.getByRole("button", { name: "View dev@acme.test" });
    const cells = within(row).getAllByRole("cell");
    expect(cells[cells.length - 2]).toHaveTextContent("0");
    expect(cells[cells.length - 1]).toHaveTextContent("7");
  });

  it("lets a non-owner leave the project", async () => {
    const user = userEvent.setup();
    renderTeam("developer");

    await screen.findByText("dev");
    await user.click(screen.getByRole("button", { name: /Leave project/ }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Leave project/ }));

    expect(mockApi).toHaveBeenCalledWith("/projects/p1/members/me", { method: "DELETE" });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/dashboard"));
  });

  it("offers the owner a transfer instead of a way out", async () => {
    const user = userEvent.setup();
    renderTeam("owner");

    await screen.findByText("dev");
    // The owner cannot leave — the project would be ownerless.
    expect(screen.queryByRole("button", { name: /Leave project/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View dev@acme.test" }));
    await user.click(await screen.findByRole("button", { name: /Transfer ownership/ }));

    // Type-to-confirm, like the project delete: the caller cannot undo this one.
    const typed = await screen.findByLabelText("Type rocket to confirm");
    await user.type(typed, "rocket");
    // The confirm dialog sits over the member dialog, so scope to it.
    const confirmDialog = typed.closest("[role=dialog]") as HTMLElement;
    await user.click(within(confirmDialog).getByRole("button", { name: /Transfer ownership/ }));

    expect(mockApi).toHaveBeenCalledWith(
      "/projects/p1/members/u-dev/transfer-ownership",
      { method: "POST" },
    );
    // The caller's own tier gates every owner-only control on this page and the
    // settings danger zone, so it has to be re-read immediately.
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
