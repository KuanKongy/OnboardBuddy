import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * /terms mirrors /privacy: a public legal page that must stand on its own.
 * Public shell, a "Last updated" date, the clauses a commercial ToS cannot
 * skip (warranty, liability, governing law), and no em dashes.
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

const { TermsPage } = await import("./TermsPage");

async function renderTerms() {
  let container!: HTMLElement;
  await act(async () => {
    const view = render(
      <MemoryRouter initialEntries={["/terms"]}>
        <TermsPage />
      </MemoryRouter>,
    );
    container = view.container;
  });
  return container;
}

describe("TermsPage", () => {
  beforeEach(() => {
    apiFetch.mockClear();
    authState.current = { user: null, loading: false, signOut: vi.fn() };
  });

  it("renders on the public shell with no app sidebar", async () => {
    await renderTerms();

    const header = within(screen.getByRole("banner"));
    expect(header.getByRole("link", { name: /get started/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Sidebar navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^terms of service$/i })).toBeInTheDocument();
  });

  it("states when it was last updated", async () => {
    await renderTerms();

    expect(screen.getByText(/^Last updated: /)).toBeInTheDocument();
  });

  it("carries the load-bearing commercial clauses", async () => {
    await renderTerms();

    expect(screen.getByRole("heading", { name: /disclaimer of warranty/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /limitation of liability/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /governing law/i })).toBeInTheDocument();
    expect(screen.getByText(/British Columbia/)).toBeInTheDocument();
  });

  it("keeps the public copy em-dash-free", async () => {
    const container = await renderTerms();

    expect(container.textContent).not.toContain("—");
  });
});
