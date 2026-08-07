import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { InvitationsPage } from "./InvitationsPage";

/**
 * Bug #14: the error banner is written by one operation and cleared by none,
 * so a failed accept stayed on screen while the user moved to a different
 * invitation — describing an invitation that was no longer selected. Silent
 * regression: the banner looks like a normal banner, just about the wrong row.
 */

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

const mockApi = vi.mocked(apiFetch);

// `live` is the server's accept predicate (pending AND unexpired): it decides
// whether the pane offers buttons at all, so every fixture has to carry it.
const INVITATIONS = [
  {
    id: "inv-1", project_id: "p1", repo_owner: "acme", repo_name: "alpha",
    permission_tier: "developer", developer_role: "backend",
    invited_by_email: "lead@acme.test", status: "pending", live: true,
    created_at: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "inv-2", project_id: "p2", repo_owner: "acme", repo_name: "beta",
    permission_tier: "developer", developer_role: "frontend",
    invited_by_email: "lead@acme.test", status: "pending", live: true,
    created_at: "2026-07-02T00:00:00.000Z",
  },
];

const REVOKED = {
  id: "inv-0", project_id: "p0", repo_owner: "acme", repo_name: "gamma",
  permission_tier: "developer", developer_role: "backend",
  invited_by_email: "lead@acme.test", status: "revoked", live: false,
  created_at: "2026-06-01T00:00:00.000Z",
};

describe("InvitationsPage error lifecycle (#14)", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockImplementation((path: string) =>
      path === "/invitations"
        ? Promise.resolve({ invitations: INVITATIONS })
        : Promise.reject(new Error("You are already a member of this project")),
    );
  });

  it("clears a failed-accept banner when a different invitation is selected", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <InvitationsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await screen.findByText("alpha");
    await user.click(screen.getByRole("button", { name: /accept invitation/i }));
    await waitFor(() =>
      expect(screen.getByText(/already a member of this project/i)).toBeInTheDocument(),
    );

    // Moving to another invitation must not leave the first one's failure up.
    await user.click(screen.getByText("beta"));
    expect(screen.queryByText(/already a member of this project/i)).toBeNull();
  });

  it("clears the banner again when a new accept starts", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <InvitationsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await screen.findByText("alpha");
    await user.click(screen.getByRole("button", { name: /accept invitation/i }));
    await waitFor(() =>
      expect(screen.getByText(/already a member of this project/i)).toBeInTheDocument(),
    );

    // This accept succeeds; the stale failure must not outlive it.
    mockApi.mockImplementation((path: string) =>
      path === "/invitations"
        ? Promise.resolve({ invitations: INVITATIONS })
        : Promise.resolve({}),
    );
    await user.click(screen.getByRole("button", { name: /accept invitation/i }));
    await waitFor(() =>
      expect(screen.queryByText(/already a member of this project/i)).toBeNull(),
    );
  });
});

describe("InvitationsPage invitation lifecycle (#72)", () => {
  function renderPage() {
    return render(
      <MemoryRouter>
        <TooltipProvider>
          <InvitationsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );
  }

  // Block body on purpose: `mockReset()` returns the mock, and a returned function is
  // run as teardown — here `apiFetch()` with no arguments, unhandled.
  beforeEach(() => { mockApi.mockReset(); });

  // The list is history now: a declined invitation stays on it, stays selected,
  // and loses its buttons. Dropping the row left a user who declined by mistake
  // with nothing on screen to explain where the invitation went.
  it("keeps the declined invitation listed and turns the pane read-only", async () => {
    const user = userEvent.setup();
    mockApi.mockImplementation((path: string) =>
      path === "/invitations"
        ? Promise.resolve({ invitations: INVITATIONS })
        : Promise.resolve({ invitation: { id: "inv-1", status: "declined" } }),
    );
    renderPage();

    await screen.findByRole("heading", { name: "Join alpha" });
    await user.click(screen.getByRole("button", { name: /^Decline$/ }));

    expect(mockApi).toHaveBeenCalledWith("/invitations/inv-1/decline", { method: "POST" });
    expect(await screen.findByText("declined")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Join alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Decline$/ })).toBeNull();
    expect(screen.getByText(/You declined this invitation/i)).toBeInTheDocument();
  });

  // The role is the inviter's choice; the invitee is shown it, not asked for it.
  // A body that sent anything else would join them under a role they never saw.
  it("accepts with the role the invitation carries", async () => {
    const user = userEvent.setup();
    mockApi.mockImplementation((path: string) =>
      path === "/invitations"
        ? Promise.resolve({ invitations: INVITATIONS })
        : Promise.resolve({}),
    );
    renderPage();

    await screen.findByRole("heading", { name: "Join alpha" });
    await user.click(screen.getByRole("button", { name: /accept invitation/i }));

    expect(mockApi).toHaveBeenCalledWith("/invitations/inv-1/accept", {
      method: "POST",
      body: JSON.stringify({ developer_role: "backend" }),
    });
  });

  it("opens on the live invitation and shows a closed one read-only", async () => {
    const user = userEvent.setup();
    mockApi.mockImplementation((path: string) =>
      path === "/invitations"
        ? Promise.resolve({ invitations: [REVOKED, INVITATIONS[1]] })
        : Promise.resolve({}),
    );
    renderPage();

    // Newest-first ordering puts a dead row at the top often enough; the pane
    // has to open on the one there is still a decision to make about.
    expect(await screen.findByRole("heading", { name: "Join beta" })).toBeInTheDocument();

    // Closed rows are still inspectable: that is where "what happened to that
    // invitation?" is answered.
    await user.click(screen.getByText("gamma"));
    expect(await screen.findByRole("heading", { name: "Join gamma" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept invitation/i })).toBeNull();
    expect(screen.getByText(/This invitation was revoked/i)).toBeInTheDocument();
  });

  it("reports a failed decline and clears it when another invitation is selected", async () => {
    const user = userEvent.setup();
    mockApi.mockImplementation((path: string) =>
      path === "/invitations"
        ? Promise.resolve({ invitations: INVITATIONS })
        : Promise.reject(new Error("Invitation has already been accepted")),
    );
    renderPage();

    await screen.findByRole("heading", { name: "Join alpha" });
    await user.click(screen.getByRole("button", { name: /^Decline$/ }));

    await waitFor(() =>
      expect(screen.getByText(/already been accepted/i)).toBeInTheDocument(),
    );
    // The invitation stays — nothing was removed on a failure.
    expect(screen.getByRole("heading", { name: "Join alpha" })).toBeInTheDocument();

    // #14's rule applies to this operation too.
    await user.click(screen.getByText("beta"));
    expect(screen.queryByText(/already been accepted/i)).toBeNull();
  });
});
