import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * Bug #74/F6 + F12 — the dead ends of the password-reset landing page.
 *
 * Supabase reports a spent or expired recovery link by redirecting back with
 * `#error=access_denied&error_code=otp_expired` and NO session. This page read
 * neither the hash nor the query, so both failure modes rendered the same
 * "Waiting for your reset link…" spinner line forever: the user had no way to
 * learn the link was dead and no route to a fresh one.
 *
 * Labels are queried by exact string on purpose — the truncated "Confirm new"
 * label existed only to keep a `/password/i` query unambiguous, which is a test
 * concern leaking into the UI. Exact queries are how it stays fixed.
 */

const authState: { session: unknown } = { session: null };
const updateUser = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: authState.session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      updateUser: (args: unknown) => updateUser(args),
    },
  },
}));

const { ResetPasswordPage } = await import("./ResetPasswordPage");

/**
 * The page reads `window.location` directly (Supabase owns the URL it redirects
 * to, so there is no router state to read instead). `history.replaceState` is
 * the one way to move jsdom's location without replacing the object.
 */
function atUrl(url: string) {
  window.history.replaceState({}, "", url);
}

async function renderPage() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <ResetPasswordPage />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  authState.session = null;
  updateUser.mockClear();
});

afterEach(() => {
  atUrl("/");
  vi.useRealTimers();
});

describe("ResetPasswordPage — dead reset links (#74/F6)", () => {
  it("renders the expired-link state, not the waiting spinner, for #error_code=otp_expired", async () => {
    atUrl(
      "/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(/this reset link has expired/i);
    expect(screen.queryByText(/Waiting for your reset link/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a reset email/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("stops waiting after 10s when the link produced neither a session nor an error", async () => {
    vi.useFakeTimers();
    atUrl("/reset-password");
    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    // Before the guard fires the page is legitimately still waiting.
    expect(screen.getByText(/Waiting for your reset link/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/didn't sign you in/i);
    expect(screen.queryByText(/Waiting for your reset link/i)).not.toBeInTheDocument();
  });
});

describe("ResetPasswordPage — the form (#74/F12)", () => {
  beforeEach(() => {
    authState.session = { user: { id: "u1" } };
  });

  it("names both fields in full and rejects a mismatch in the user's words", async () => {
    const user = userEvent.setup();
    await renderPage();

    const password = await screen.findByLabelText("New password");
    await user.type(password, "correct-horse");
    await user.type(screen.getByLabelText("Confirm new password"), "correct-hoarse");
    await user.click(screen.getByRole("button", { name: /set new password/i }));

    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("submits the new password when both entries agree", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.type(await screen.findByLabelText("New password"), "correct-horse");
    await user.type(screen.getByLabelText("Confirm new password"), "correct-horse");
    await user.click(screen.getByRole("button", { name: /set new password/i }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "correct-horse" }));
  });
});
