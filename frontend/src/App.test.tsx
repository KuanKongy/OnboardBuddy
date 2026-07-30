import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

// Mock Supabase to avoid real API calls during tests
vi.mock("./lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

async function renderApp(route: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    );
  });
}

describe("App", () => {
  it("redirects unauthenticated users to the intro page", async () => {
    await renderApp("/");

    expect(
      screen.getByRole("heading", {
        name: /onboard developers/i,
      }),
    ).toBeInTheDocument();
  });

  it("shows login page at /login", async () => {
    await renderApp("/login");

    expect(
      screen.getByRole("heading", { name: /welcome back/i }),
    ).toBeInTheDocument();
  });

  it("shows signup page at /signup", async () => {
    await renderApp("/signup");

    expect(
      screen.getByRole("heading", { name: /create an account/i }),
    ).toBeInTheDocument();
  });

  it("redirects /dashboard to login when unauthenticated", async () => {
    await renderApp("/dashboard");

    await vi.waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /welcome back/i }),
      ).toBeInTheDocument();
    });
  });

  // #74/G1: without these two, a route change is invisible to anyone not
  // watching the pixels — same tab title on all 23 pages, and focus left behind
  // in the sidebar so Tab walked the nav again instead of entering the page.
  it("names the route in the document title", async () => {
    await renderApp("/login");

    expect(document.title).toBe("Log in · OnboardBuddy");
  });

  it("puts the skip link first in tab order, targeting the main region", async () => {
    await renderApp("/help");

    const skip = screen.getByRole("link", { name: /skip to content/i });
    expect(skip).toHaveAttribute("href", "#main");
    expect(document.getElementById("main")).toHaveAttribute("tabindex", "-1");

    const tabbables = document.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(tabbables[0]).toBe(skip);
  });
});
