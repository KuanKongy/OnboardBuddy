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
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  },
}));

const { default: App } = await import("../App");

async function renderForgotPassword() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <App />
      </MemoryRouter>,
    );
  });
}

async function submit(email = "someone@example.com") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), email);
  await user.click(screen.getByRole("button", { name: /send reset link/i }));
}

describe("ForgotPasswordPage", () => {
  it("shows the sent panel after a successful request", async () => {
    await renderForgotPassword();
    await submit();
    expect(await screen.findByText(/a reset link is on its way/i)).toBeInTheDocument();
  });

  // Supabase reports most failures as a returned { error }, not a throw. A
  // 500 or mailer fault means no email is going out, so the sent panel would
  // be a lie; this page must say so instead. (Supabase does not return
  // "user not found" from resetPasswordForEmail, so surfacing every error
  // still can't probe which emails exist.)
  it("shows the failure instead of the sent panel when the provider returns an error", async () => {
    await renderForgotPassword();
    const { supabase } = await import("@/lib/supabase");
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error("Error sending recovery email"), { status: 500 }),
    } as never);

    await submit();

    expect(await screen.findByText(/error sending recovery email/i)).toBeInTheDocument();
    expect(screen.queryByText(/a reset link is on its way/i)).not.toBeInTheDocument();
  });

  it("shows a network failure instead of the sent panel", async () => {
    await renderForgotPassword();
    const { supabase } = await import("@/lib/supabase");
    vi.mocked(supabase.auth.resetPasswordForEmail).mockRejectedValueOnce(
      new Error("Failed to fetch"),
    );

    await submit();

    expect(await screen.findByText(/failed to fetch/i)).toBeInTheDocument();
    expect(screen.queryByText(/a reset link is on its way/i)).not.toBeInTheDocument();
  });
});
