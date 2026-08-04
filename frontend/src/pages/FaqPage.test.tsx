import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * /faq is the answer page a visitor without an account lands on (the landing
 * page links here, and signed-out /help redirects here). Three ways it can
 * break without throwing: it picks up app chrome that would bounce every click
 * to /login, it fires the `/projects` fetch that guarantees a 401 in a
 * visitor's console, or the moved copy reintroduces the em dashes the public
 * pages do not use.
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

const { FaqPage } = await import("./FaqPage");

async function renderFaq() {
  let container!: HTMLElement;
  await act(async () => {
    const view = render(
      <MemoryRouter initialEntries={["/faq"]}>
        <FaqPage />
      </MemoryRouter>,
    );
    container = view.container;
  });
  return container;
}

describe("FaqPage", () => {
  beforeEach(() => {
    apiFetch.mockClear();
    authState.current = { user: null, loading: false, signOut: vi.fn() };
  });

  it("renders on the public shell with no app sidebar", async () => {
    await renderFaq();

    const header = within(screen.getByRole("banner"));
    expect(header.getByRole("link", { name: /get started/i })).toBeInTheDocument();
    expect(header.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Sidebar navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^faq$/i })).toBeInTheDocument();
  });

  it("fetches nothing", async () => {
    await renderFaq();

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps the public copy em-dash-free", async () => {
    const container = await renderFaq();

    expect(container.textContent).not.toContain("—");
  });

  it("opens an answer when its question is clicked", async () => {
    await renderFaq();

    const question = screen.getByRole("button", { name: /what happens when i analyze a repo/i });
    expect(question).toHaveAttribute("aria-expanded", "false");
    // Answers stay mounted (the accordion animates a grid row), so `inert` is
    // what actually hides a closed one from a reader and from the tab order.
    expect(screen.getByText(/16-phase pipeline/).closest("[inert]")).not.toBeNull();

    fireEvent.click(question);

    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/16-phase pipeline/).closest("[inert]")).toBeNull();
  });
});
