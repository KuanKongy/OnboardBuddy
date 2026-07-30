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
      // Never settles: the real one navigates away instead of returning, which
      // is exactly the window the in-flight state has to cover.
      signInWithOAuth: vi.fn().mockReturnValue(new Promise(() => {})),
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

  /**
   * Bug #74/F11 — the GitHub button had no in-flight state at all, so during
   * the redirect the page still invited a second click and a form submit.
   * LoginPage has spun and mutually disabled since M2; this is the same shape.
   */
  it("shows the GitHub sign-up as in flight and locks the form while it redirects", async () => {
    const user = userEvent.setup();
    await renderSignup();

    const github = screen.getByRole("button", { name: /github/i });
    await user.click(github);

    expect(github).toBeDisabled();
    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
  });
});
