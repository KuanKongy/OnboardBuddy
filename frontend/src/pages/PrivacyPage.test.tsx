import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * /privacy is a policy page a visitor reads before signing up, so it has to
 * stand on its own: the public shell rather than app chrome that would bounce
 * every click to /login, a "Last updated" date (a policy without one is not a
 * policy), a stable #modes anchor (the landing page deep-links to it), and
 * none of the em dashes the public pages do not use.
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

async function renderPrivacy(entry = "/privacy") {
  let container!: HTMLElement;
  await act(async () => {
    const view = render(
      <MemoryRouter initialEntries={[entry]}>
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

  it("states when it was last updated", async () => {
    await renderPrivacy();

    expect(screen.getByText(/^Last updated: /)).toBeInTheDocument();
  });

  it("keeps the #modes anchor the landing page deep-links to", async () => {
    await renderPrivacy();

    const modes = document.getElementById("modes");
    expect(modes).not.toBeNull();
    expect(modes!.getAttribute("aria-labelledby")).toBe("modes-h");
  });

  it("scrolls the hash target into view on a deep link", async () => {
    // jsdom implements neither scrollIntoView nor rAF-driven paints, and the
    // browser automation harness suspends smooth scrolling in occluded
    // windows, so this is the one place the deep-link scroll can be pinned:
    // the hook must call scrollIntoView on #modes after mount.
    const scrolledTo: string[] = [];
    const proto = Element.prototype as unknown as { scrollIntoView?: (this: Element, opts?: unknown) => void };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) {
      scrolledTo.push(this.id);
    };
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    try {
      await renderPrivacy("/privacy#modes");
      expect(scrolledTo).toContain("modes");
    } finally {
      raf.mockRestore();
      if (original) proto.scrollIntoView = original;
      else delete proto.scrollIntoView;
    }
  });

  it("keeps the public copy em-dash-free", async () => {
    const container = await renderPrivacy();

    expect(container.textContent).not.toContain("—");
  });
});
