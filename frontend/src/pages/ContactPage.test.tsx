import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The contact page frames the team, not the product: Nam is the maintainer and
 * the one point of contact, so only his card carries contact pills; the rest of
 * the team is credited by name with no role, no status, and no contact of their
 * own. These assertions pin exactly that split, and that no phone is published.
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
  it("presents Nam as the maintainer with one row of email, LinkedIn, and GitHub", async () => {
    await renderContact();

    expect(screen.getByText("Nam Le")).toBeInTheDocument();
    expect(screen.getByText("Maintainer")).toBeInTheDocument();

    // Exactly three contact pills, all Nam's: email, LinkedIn, GitHub. No phone.
    const copyPills = screen.getAllByRole("button", { name: /^Copy / });
    expect(copyPills).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Copy email" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy LinkedIn" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy GitHub" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy phone" })).not.toBeInTheDocument();
  });

  it("credits the rest of the team by name, with no role, status, or contact", async () => {
    await renderContact();

    for (const name of ["Eugene N.", "Sahib R.", "Bradley S."]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Only Nam carries pills; nobody else adds one, so the total stays three.
    expect(screen.getAllByRole("button", { name: /^Copy / })).toHaveLength(3);
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
