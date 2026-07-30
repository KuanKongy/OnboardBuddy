import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Supabase reports a spent or expired recovery link with
// `#error=access_denied&error_code=otp_expired` and NO session. Labels are queried by
// exact string on purpose: a `/password/i` query is what pushed the UI into truncating
// "Confirm new password" to keep it unambiguous.

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

// The page reads `window.location` directly (Supabase owns the URL), and
// `history.replaceState` is the one way to move jsdom's location in place.
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
