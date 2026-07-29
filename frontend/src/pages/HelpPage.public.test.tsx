import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * /help moved out of ProtectedRoute so the privacy answer is readable without
 * an account. Two things about that are silent when they break:
 *
 *  1. The chrome is chosen by session, not by route. Get it wrong and a
 *     signed-out visitor either sees the app sidebar (whose every link bounces
 *     to /login) or a signed-in reader loses the shell they navigated from —
 *     both render perfectly, neither throws.
 *  2. The page must not fetch `/projects` while signed out. It would 401 every
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
      <MemoryRouter initialEntries={["/help"]}>
        <TooltipProvider>
          <HelpRoute />
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

  it("renders the public header for a signed-out visitor", async () => {
    await renderHelp();

    const header = within(screen.getByRole("banner"));
    expect(header.getByRole("link", { name: /sign up/i })).toBeInTheDocument();
    expect(header.getByRole("link", { name: /log in/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Sidebar navigation")).not.toBeInTheDocument();
    // The page itself still renders — public chrome, same content.
    expect(screen.getByRole("heading", { name: /help & faq/i })).toBeInTheDocument();
    expect(screen.getByText(/privacy & ai transparency/i)).toBeInTheDocument();
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
