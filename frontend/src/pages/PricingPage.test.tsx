import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PLANS } from "@/lib/plans";

/**
 * The pricing page shows the three public plans and nothing about the internal
 * Dev tier. The two enforced facts (monthly credits and pace) are asserted from
 * lib/plans.ts, not retyped here, so this pins that the page renders what that
 * module holds. The old concurrency line and the "Recommended" highlight are
 * both gone, and the preview tiers show a disabled "Coming soon", not a link.
 */

const authState = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, loading: false, signOut: vi.fn() },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState.current,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const { PricingPage } = await import("./PricingPage");

async function renderPricing() {
  let container!: HTMLElement;
  await act(async () => {
    const view = render(
      <MemoryRouter initialEntries={["/pricing"]}>
        <PricingPage />
      </MemoryRouter>,
    );
    container = view.container;
  });
  return container;
}

describe("PricingPage", () => {
  it("renders exactly the three public plans as headings", async () => {
    await renderPricing();

    expect(screen.getByRole("heading", { name: /^Free$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Pro$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Max$/ })).toBeInTheDocument();
  });

  it("never surfaces the internal Dev tier", async () => {
    const container = await renderPricing();

    expect(container.textContent).not.toMatch(/\bDev\b/);
    // And plans.ts itself carries no plan the page could accidentally reveal.
    expect(PLANS.map((p) => p.id)).toEqual(["free", "pro", "max"]);
  });

  it("shows the two enforced facts straight from plans.ts", async () => {
    await renderPricing();

    for (const plan of PLANS) {
      expect(screen.getByText(plan.monthlyCredits)).toBeInTheDocument();
      expect(screen.getByText(plan.pace)).toBeInTheDocument();
    }
  });

  it("drops the concurrency line entirely", async () => {
    const container = await renderPricing();

    expect(container.textContent).not.toMatch(/at a time/i);
    expect(container.textContent).not.toMatch(/concurren/i);
  });

  it("makes Free a real CTA and the preview tiers disabled 'Coming soon' buttons", async () => {
    await renderPricing();

    // Free links to signup. Scoped to the page body: the header carries its own
    // "Get started" CTA, and this assertion is about the plan card's.
    const body = within(screen.getByRole("main"));
    expect(body.getByRole("link", { name: /get started/i })).toHaveAttribute("href", "/signup");

    // Pro and Max are disabled buttons, not links.
    const comingSoon = screen.getAllByRole("button", { name: /coming soon/i });
    expect(comingSoon).toHaveLength(2);
    for (const button of comingSoon) expect(button).toBeDisabled();
    expect(screen.queryByRole("link", { name: /coming soon/i })).not.toBeInTheDocument();
  });

  it("no longer highlights a recommended plan", async () => {
    const container = await renderPricing();

    expect(container.textContent).not.toMatch(/Recommended/i);
  });

  it("states the credit unit and keeps the public copy em-dash-free", async () => {
    const container = await renderPricing();

    expect(screen.getByText("1 credit = CA$1 of analysis.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("—");
  });
});
