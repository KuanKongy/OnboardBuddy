import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * /privacy is a policy page a visitor reads before signing up, so it has to
 * stand on its own: the public shell rather than app chrome that would bounce
 * every click to /login, an effective date (a policy without one is not a
 * policy), and none of the em dashes the public pages do not use.
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

const { PrivacyPage } = await import("./PrivacyPage");

async function renderPrivacy() {
  let container!: HTMLElement;
  await act(async () => {
    const view = render(
      <MemoryRouter initialEntries={["/privacy"]}>
        <PrivacyPage />
      </MemoryRouter>,
    );
    container = view.container;
  });
  return container;
}

describe("PrivacyPage", () => {
  beforeEach(() => {
    apiFetch.mockClear();
    authState.current = { user: null, loading: false, signOut: vi.fn() };
  });

  it("renders on the public shell with no app sidebar", async () => {
    await renderPrivacy();

    const header = within(screen.getByRole("banner"));
    expect(header.getByRole("link", { name: /get started/i })).toBeInTheDocument();
    expect(header.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Sidebar navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^privacy policy$/i })).toBeInTheDocument();
  });

  it("states an effective date", async () => {
    await renderPrivacy();

    expect(screen.getByText(/Effective date/)).toBeInTheDocument();
  });

  it("keeps the public copy em-dash-free", async () => {
    const container = await renderPrivacy();

    expect(container.textContent).not.toContain("—");
  });
});
