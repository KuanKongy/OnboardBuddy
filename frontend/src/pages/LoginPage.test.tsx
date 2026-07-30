import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

// Must come after supabase mock
const { default: App } = await import("../App");
const { supabase } = await import("@/lib/supabase");

async function renderLogin() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );
  });
}

describe("LoginPage", () => {
  it("renders email and password fields", async () => {
    await renderLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders sign in button", async () => {
    await renderLogin();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("renders GitHub OAuth option", async () => {
    await renderLogin();
    expect(screen.getByRole("button", { name: /github/i })).toBeInTheDocument();
  });

  it("has a link to the signup page", async () => {
    await renderLogin();
    expect(screen.getByRole("link", { name: /sign up/i })).toBeInTheDocument();
  });
});

/**
 * Bug #74/F7 — "GitHub sign-in drops the deep link".
 *
 * A shared link to a project page bounces through ProtectedRoute, which parks
 * the wanted location in `location.state.from`. The email form honored it; the
 * GitHub button did not, so anyone arriving on a shared link and signing in the
 * way this app pushes hardest landed on /dashboard and had to find the page
 * again. Asserted through the real AuthProvider so the whole chain — page →
 * context → redirectTo — is what's pinned.
 */
describe("LoginPage — deep link through GitHub sign-in (#74/F7)", () => {
  it("carries the bounced-from path into the OAuth redirect", async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockClear();
    const user = userEvent.setup();
    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/projects/p1/dependencies"]}>
          <App />
        </MemoryRouter>,
      );
    });

    // ProtectedRoute sent us here rather than to the graph.
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /github/i }));

    const credentials = vi.mocked(supabase.auth.signInWithOAuth).mock.calls[0]![0];
    const redirect = new URL(credentials.options!.redirectTo!);
    expect(redirect.pathname).toBe("/auth/callback");
    expect(redirect.searchParams.get("next")).toBe("/projects/p1/dependencies");
  });
});
