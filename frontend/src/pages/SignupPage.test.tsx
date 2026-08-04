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
      // Never settles: the real one navigates away instead of returning, which is
      // exactly the window the in-flight state has to cover.
      signInWithOAuth: vi.fn().mockReturnValue(new Promise(() => {})),
      signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
}));

const { default: App } = await import("../App");

async function renderSignup() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <App />
      </MemoryRouter>,
    );
  });
}

describe("SignupPage", () => {
  it("renders email and password fields", async () => {
    await renderSignup();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders create account button", async () => {
    await renderSignup();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("renders GitHub OAuth option", async () => {
    await renderSignup();
    expect(screen.getByRole("button", { name: /github/i })).toBeInTheDocument();
  });

  it("has a link to the login page", async () => {
    await renderSignup();
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  // Same shape LoginPage has had since M2.
  it("shows the GitHub sign-up as in flight and locks the form while it redirects", async () => {
    const user = userEvent.setup();
    await renderSignup();

    const github = screen.getByRole("button", { name: /github/i });
    await user.click(github);

    expect(github).toBeDisabled();
    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
  });

  // Registration lands on the dashboard; the OAuth hop carries no next param
  // (/dashboard is the callback default).
  it("routes the GitHub OAuth hop to the callback with no next override", async () => {
    const user = userEvent.setup();
    await renderSignup();
    await user.click(screen.getByRole("button", { name: /github/i }));

    const { supabase } = await import("@/lib/supabase");
    const oauthArgs = vi.mocked(supabase.auth.signInWithOAuth).mock.calls[0]![0];
    expect(oauthArgs.options?.redirectTo).toContain("/auth/callback");
    expect(oauthArgs.options?.redirectTo).not.toContain("next=");
  });

  it("points the email confirmation link at the callback so it signs in and continues", async () => {
    const user = userEvent.setup();
    await renderSignup();
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "longenough1");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    const { supabase } = await import("@/lib/supabase");
    const signUpArgs = vi.mocked(supabase.auth.signUp).mock.calls[0]![0] as {
      options?: { emailRedirectTo?: string };
    };
    expect(signUpArgs.options?.emailRedirectTo).toMatch(/\/auth\/callback$/);
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });
});
