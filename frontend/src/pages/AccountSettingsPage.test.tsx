import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Account settings: the two keyboard/consent gaps from #74.
 *
 * F10 — "Add email sign-in" was a div of inputs, so the sign-up-shaped form
 * could only be submitted with the mouse.
 * F9 — unlinking a sign-in identity fired on the first click. Unlinking the
 * wrong one is how you lock yourself out of an account, and it was the only
 * destructive action on this page without a confirm (the GitHub App disconnect
 * beside it has had one since M3).
 */

type Identity = { provider: string; identity_data?: Record<string, string> };

const authUser: { identities: Identity[]; providers: string[] } = {
  identities: [],
  providers: [],
};

const updateUser = vi.fn().mockResolvedValue({ error: null });
const unlinkIdentity = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      updateUser: (args: unknown) => updateUser(args),
      unlinkIdentity: (args: unknown) => unlinkIdentity(args),
      refreshSession: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({ user: { github_connected: false, github_username: null } })),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "u1",
      email: "dev@example.com",
      created_at: "2026-01-02T00:00:00Z",
      user_metadata: { full_name: "Dev Eloper" },
      app_metadata: { providers: authUser.providers },
      identities: authUser.identities,
    },
    signOut: vi.fn(),
    connectGithub: vi.fn(),
    disconnectGithub: vi.fn(),
  }),
}));

const { AccountSettingsPage } = await import("./AccountSettingsPage");

async function renderPage() {
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/settings"]}>
        <AccountSettingsPage />
      </MemoryRouter>
    </TooltipProvider>,
  );
  // The GitHub App card fetches /auth/me on mount.
  await waitFor(() => expect(screen.getByText(/Not connected/i)).toBeInTheDocument());
}

beforeEach(() => {
  updateUser.mockClear();
  unlinkIdentity.mockClear();
});

describe("AccountSettingsPage — add email sign-in (#74/F10)", () => {
  beforeEach(() => {
    // GitHub-only account: the "add email sign-in" path is the one offered.
    authUser.identities = [{ provider: "github", identity_data: { user_name: "octo" } }];
    authUser.providers = ["github"];
  });

  it("submits on Enter from inside the dialog", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: /add email sign-in/i }));
    await user.type(await screen.findByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    // Enter from the last field, with no button click anywhere in this test.
    await user.type(screen.getByLabelText("Confirm password"), "hunter2hunter2{Enter}");

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "hunter2hunter2" }));
  });
});

describe("AccountSettingsPage — unlinking a sign-in identity (#74/F9)", () => {
  beforeEach(() => {
    // Both methods present, so both Unlink buttons are enabled.
    authUser.identities = [
      { provider: "github", identity_data: { user_name: "octo" } },
      { provider: "email", identity_data: { email: "dev@example.com" } },
    ];
    authUser.providers = ["github", "email"];
  });

  it("asks before unlinking GitHub, and does nothing if the confirm is cancelled", async () => {
    const user = userEvent.setup();
    await renderPage();

    const [githubUnlink] = screen.getAllByRole("button", { name: /^unlink$/i });
    await user.click(githubUnlink!);

    // The click alone must not have unlinked anything.
    expect(unlinkIdentity).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Unlink GitHub sign-in/i);

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(unlinkIdentity).not.toHaveBeenCalled();

    // Confirming is what does it — with the GitHub identity, not the email one.
    await user.click(screen.getAllByRole("button", { name: /^unlink$/i })[0]!);
    await user.click(await screen.findByRole("button", { name: /unlink github/i }));
    await waitFor(() =>
      expect(unlinkIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "github" }),
      ),
    );
  });

  it("asks before unlinking email sign-in", async () => {
    const user = userEvent.setup();
    await renderPage();

    const unlinkButtons = screen.getAllByRole("button", { name: /^unlink$/i });
    await user.click(unlinkButtons[1]!);

    expect(unlinkIdentity).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toHaveTextContent(/Unlink email sign-in/i);

    await user.click(screen.getByRole("button", { name: /unlink email sign-in/i }));
    await waitFor(() =>
      expect(unlinkIdentity).toHaveBeenCalledWith(expect.objectContaining({ provider: "email" })),
    );
  });
});
