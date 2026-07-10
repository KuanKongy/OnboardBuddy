import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

// Must come after supabase mock
const { default: App } = await import("../App");

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
