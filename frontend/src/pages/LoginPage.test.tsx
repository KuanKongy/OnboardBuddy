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

// ProtectedRoute parks the wanted location in `location.state.from`. Driven through
// the real AuthProvider so page → context → redirectTo is the whole chain pinned.
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
