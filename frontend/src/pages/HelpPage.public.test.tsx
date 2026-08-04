import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * /help sits outside ProtectedRoute so the privacy answer is readable without
 * an account: signed in it is the Help tab in the app shell, signed out it
 * redirects to the public /faq page. Two things about that are silent when
 * they break:
 *
 *  1. The branch is chosen by session, not by route. Get it wrong and a
 *     signed-out visitor either sees the app sidebar (whose every link bounces
 *     to /login) or a signed-in reader loses the shell they navigated from —
 *     both render perfectly, neither throws.
 *  2. Nothing may fetch `/projects` on the signed-out path. It would 401 every
 *     time, and `useProjects` swallows the failure into an unrendered `error`,
 *     so the only trace is a red line in a visitor's console.
 */

const authState = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, loading: false, signOut: vi.fn() },
}));

const apiFetch = vi.hoisted(() => vi.fn(async () => ({ projects: [] })));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState.current,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/lib/api", () => ({
  apiFetch,
  ApiError: class ApiError extends Error {},
}));

const { HelpRoute } = await import("../App");

async function renderHelp() {
  await act(async () => {
    render(
      // A stub for /faq rather than the real page: this file is about which
      // branch /help takes, and FaqPage has its own test.
      <MemoryRouter initialEntries={["/help"]}>
        <TooltipProvider>
          <Routes>
            <Route path="/help" element={<HelpRoute />} />
            <Route path="/faq" element={<h1>public faq stub</h1>} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );
  });
}

describe("HelpRoute chrome picker", () => {
  beforeEach(() => {
    apiFetch.mockClear();
    authState.current = { user: null, loading: false, signOut: vi.fn() };
  });

  it("redirects a signed-out visitor to the public FAQ", async () => {
    await renderHelp();

    expect(screen.getByRole("heading", { name: /public faq stub/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Sidebar navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /help & faq/i })).not.toBeInTheDocument();
  });

  it("does not fetch projects while signed out", async () => {
    await renderHelp();

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps the app shell — and no public header — for a signed-in reader", async () => {
    authState.current = { user: { id: "u1" }, loading: false, signOut: vi.fn() };
    await renderHelp();

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign up/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Sidebar navigation")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /help & faq/i })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/projects");
  });
});
