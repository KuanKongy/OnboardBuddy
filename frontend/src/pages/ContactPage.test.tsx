import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The contact page is a router, not an About page: three channels (feedback,
 * bugs, collaboration) each pointing at exactly one destination. These
 * assertions pin the three destinations, and pin the removal of the old About
 * content (team roster, copy-to-clipboard pills) so it cannot creep back.
 */

const authState = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, loading: false, signOut: vi.fn() },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState.current,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const { ContactPage } = await import("./ContactPage");

async function renderContact() {
  let container!: HTMLElement;
  await act(async () => {
    const view = render(
      <MemoryRouter initialEntries={["/contact"]}>
        <ContactPage />
      </MemoryRouter>,
    );
    container = view.container;
  });
  return container;
}

describe("ContactPage", () => {
  it("offers the three contact channels", async () => {
    await renderContact();

    expect(screen.getByText("Questions & Feedback")).toBeInTheDocument();
    expect(screen.getByText("Bug Report")).toBeInTheDocument();
    expect(screen.getByText("Collaboration")).toBeInTheDocument();
  });

  it("points each channel at its own destination", async () => {
    await renderContact();

    // Feedback and collaboration share the inbox but carry distinct subjects,
    // so a mis-wired subject line shows up here rather than in Nam's inbox.
    expect(screen.getByRole("link", { name: /^Email us/ })).toHaveAttribute(
      "href",
      "mailto:khanhpronam@gmail.com?subject=OnboardBuddy%20feedback",
    );
    expect(screen.getByRole("link", { name: /^Contact Nam/ })).toHaveAttribute(
      "href",
      "mailto:khanhpronam@gmail.com?subject=OnboardBuddy%20collaboration",
    );

    const issueLink = screen.getByRole("link", { name: /^Report an issue/ });
    expect(issueLink).toHaveAttribute(
      "href",
      "https://github.com/KuanKongy/OnboardBuddy/issues/new",
    );
    expect(issueLink).toHaveAttribute("target", "_blank");
  });

  it("credits the team in one attribution line", async () => {
    const container = await renderContact();

    expect(container.textContent).toContain("Nam Le");
    expect(container.textContent).toContain("OnboardBuddies");
  });

  it("drops the old About content: roster and copy pills", async () => {
    const container = await renderContact();

    expect(screen.queryAllByRole("button", { name: /^Copy / })).toHaveLength(0);
    for (const name of ["Eugene N.", "Sahib R.", "Bradley S."]) {
      expect(container.textContent).not.toContain(name);
    }
  });

  it("drops all active/inactive status language", async () => {
    const container = await renderContact();

    expect(container.textContent).not.toMatch(/Active/i);
    expect(container.textContent).not.toMatch(/Inactive/i);
  });

  it("keeps the public copy em-dash-free", async () => {
    const container = await renderContact();

    expect(container.textContent).not.toContain("—");
  });
});
