import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The contact page lists three actual destinations (GitHub repo, LinkedIn,
 * email) rather than abstract channels. These assertions pin the destinations,
 * the copy-with-toast email behaviour, and the removal of the old About
 * content (team roster, copy-to-clipboard pills) so it cannot creep back.
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
  beforeEach(() => {
    copyToClipboard.mockClear();
  });

  it("titles itself as the way to get in touch", async () => {
    await renderContact();

    expect(screen.getByRole("heading", { name: "Get in touch" })).toBeInTheDocument();
  });

  it("offers the three destinations", async () => {
    await renderContact();

    expect(screen.getByRole("heading", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "LinkedIn" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Email" })).toBeInTheDocument();
  });

  it("points each destination at the real thing", async () => {
    await renderContact();

    const repoLink = screen.getByRole("link", { name: /^View on GitHub/ });
    expect(repoLink).toHaveAttribute("href", "https://github.com/KuanKongy/OnboardBuddy");
    expect(repoLink).toHaveAttribute("target", "_blank");

    const linkedInLink = screen.getByRole("link", { name: /^Connect on LinkedIn/ });
    expect(linkedInLink).toHaveAttribute("href", "https://www.linkedin.com/in/kuankongy/");
    expect(linkedInLink).toHaveAttribute("target", "_blank");
  });

  it("copies the email and confirms with a toast", async () => {
    await renderContact();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Send an email/ }));
    });

    expect(copyToClipboard).toHaveBeenCalledWith("khanhpronam@gmail.com");
    expect(screen.getByRole("status")).toHaveTextContent("Email copied to clipboard");
  });

  it("dismisses the toast early via the X", async () => {
    await renderContact();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Send an email/ }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Email copied to clipboard");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    // The message unmounts only after the exit fade finishes.
    await waitFor(() => expect(screen.queryByText("Email copied to clipboard")).toBeNull());
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

  it("keeps the public copy em-dash-free", async () => {
    const container = await renderContact();

    expect(container.textContent).not.toContain("—");
  });
});
