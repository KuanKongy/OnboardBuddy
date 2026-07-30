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

const INVITATIONS = [
  {
    id: "inv-1", project_id: "p1", repo_owner: "acme", repo_name: "alpha",
    permission_tier: "developer", developer_role: "backend",
    invited_by_email: "lead@acme.test", status: "pending",
  },
  {
    id: "inv-2", project_id: "p2", repo_owner: "acme", repo_name: "beta",
    permission_tier: "developer", developer_role: "frontend",
    invited_by_email: "lead@acme.test", status: "pending",
  },
];

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

/**
 * Bug #72: Decline was a permanently disabled button whose tooltip asked the
 * invitee to go and ask the inviter to cancel it. An unwanted invitation stayed
 * pending forever — in their inbox, and blocking a re-invitation of the address.
 */
describe("InvitationsPage decline (#72)", () => {
  function renderPage() {
    return render(
      <MemoryRouter>
        <TooltipProvider>
          <InvitationsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );
  }

  // Block body on purpose: `mockReset()` returns the mock, and a hook that
  // returns a function has that function called as the test's teardown — which
  // here means `apiFetch()` with no arguments and an unhandled rejection.
  beforeEach(() => { mockApi.mockReset(); });

  it("drops the declined invitation and selects the next one", async () => {
    const user = userEvent.setup();
    mockApi.mockImplementation((path: string) =>
      path === "/invitations"
        ? Promise.resolve({ invitations: INVITATIONS })
        : Promise.resolve({ invitation: { id: "inv-1", status: "revoked" } }),
    );
    renderPage();

    await screen.findByRole("heading", { name: "Join alpha" });
    await user.click(screen.getByRole("button", { name: /^Decline$/ }));

    expect(mockApi).toHaveBeenCalledWith("/invitations/inv-1/decline", { method: "POST" });
    // The declined one is gone from the list and the pane follows to the next.
    expect(await screen.findByRole("heading", { name: "Join beta" })).toBeInTheDocument();
    expect(screen.queryByText("alpha")).toBeNull();
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
