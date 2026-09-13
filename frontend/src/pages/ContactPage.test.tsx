import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The contact page is a router, not an About page: three channels (questions
 * to GitHub Discussions, bugs to the issue tracker, collaboration to Nam by
 * copied email or LinkedIn). These assertions pin the destinations, the
 * copy-with-toast behaviour, and the removal of the old About content (team
 * roster, copy-to-clipboard pills) so it cannot creep back.
 */

const authState = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, loading: false, signOut: vi.fn() },
}));

const copyToClipboard = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState.current,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/lib/clipboard", () => ({ copyToClipboard }));

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

    const discussLink = screen.getByRole("link", { name: /^Start a discussion/ });
    expect(discussLink).toHaveAttribute(
      "href",
      "https://github.com/KuanKongy/OnboardBuddy/discussions",
    );
    expect(discussLink).toHaveAttribute("target", "_blank");

    const issueLink = screen.getByRole("link", { name: /^Report an issue/ });
    expect(issueLink).toHaveAttribute(
      "href",
      "https://github.com/KuanKongy/OnboardBuddy/issues/new",
    );
    expect(issueLink).toHaveAttribute("target", "_blank");

    const linkedInLink = screen.getByRole("link", { name: /^Contact Nam/ });
    expect(linkedInLink).toHaveAttribute("href", "https://www.linkedin.com/in/kuankongy/");
    expect(linkedInLink).toHaveAttribute("target", "_blank");
  });

  it("copies the email and confirms with a toast", async () => {
    await renderContact();

    const emailButton = screen.getByRole("button", { name: /^Email Nam/ });
    await act(async () => {
      fireEvent.click(emailButton);
    });

    expect(copyToClipboard).toHaveBeenCalledWith("khanhpronam@gmail.com");
    expect(screen.getByRole("status")).toHaveTextContent("Email copied to clipboard");

    // The footer "Email" button shares the same behaviour.
    copyToClipboard.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Email" }));
    });
    expect(copyToClipboard).toHaveBeenCalledWith("khanhpronam@gmail.com");
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
