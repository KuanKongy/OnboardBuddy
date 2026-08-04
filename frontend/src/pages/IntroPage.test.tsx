import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PHASE_ORDER } from "@/lib/pipelinePhases";
import { PRIVACY_MODES } from "@/lib/privacyModes";

let mockUser: { id: string } | null = null;
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, loading: false, signOut: vi.fn() }),
}));

const { IntroPage } = await import("./IntroPage");

function renderPage() {
  return render(
    <TooltipProvider>
      <MemoryRouter>
        <IntroPage />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  mockUser = null;
});

describe("IntroPage", () => {
  it("keeps the pinned h1 phrase and never overclaims", () => {
    renderPage();
    // App.test pins the same phrase on "/"; both must move together.
    expect(screen.getByRole("heading", { level: 1, name: /onboard developers/i })).toBeInTheDocument();
    // Only TS/JS are parsed to symbols, so "any codebase" would be a lie.
    expect(document.body.textContent).not.toMatch(/any codebase|all codebases/i);
  });

  it("renders no em dash anywhere, including aria labels", () => {
    const { container } = renderPage();
    expect(container.textContent).not.toContain("—");
    for (const el of Array.from(container.querySelectorAll("[aria-label]"))) {
      expect(el.getAttribute("aria-label")).not.toContain("—");
    }
  });

  it("sends signed-out visitors to signup and signed-in visitors to the dashboard", () => {
    const { unmount } = renderPage();
    expect(screen.getAllByRole("link", { name: /get started/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /go to dashboard/i })).toBeNull();
    unmount();

    // The audit ledger flagged the old page for inviting signed-in users to
    // sign up; the whole surface must flip, not just the header.
    mockUser = { id: "user-1" };
    renderPage();
    expect(screen.getAllByRole("link", { name: /go to dashboard/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /get started/i })).toBeNull();
    expect(document.querySelector('a[href="/signup"]')).toBeNull();
  });

  it("computes the stat strip from the source modules", () => {
    renderPage();
    // A phase-list change must fail HERE loudly rather than silently
    // rewriting the marketing numbers.
    expect(PHASE_ORDER).toHaveLength(16);
    const facts = screen.getByRole("region", { name: "Product facts" });
    expect(within(facts).getByText(String(PHASE_ORDER.length))).toBeInTheDocument();
    expect(within(facts).getByText("pipeline phases")).toBeInTheDocument();
    expect(within(facts).getByText("handbook sections")).toBeInTheDocument();
  });

  it("renders all 16 phases and dims the skipped seven under AI disabled", () => {
    renderPage();
    const section = document.getElementById("pipeline")!;
    expect(section).not.toBeNull();

    const chips = within(section).getAllByRole("button", { name: /phase/i });
    expect(chips).toHaveLength(PHASE_ORDER.length);

    fireEvent.click(within(section).getByRole("radio", { name: "AI disabled" }));
    const skipped = within(section).getAllByRole("button", { name: /skipped under AI disabled/i });
    // Mirrors the backend's SEMANTIC_PHASES: exactly seven phases skip, and
    // generation is NOT among them (it runs LLM-free instead).
    expect(PHASE_ORDER.filter((p) => p.skippedWhenAiDisabled)).toHaveLength(7);
    expect(skipped).toHaveLength(7);
    expect(skipped.map((el) => el.getAttribute("aria-label"))).not.toContain(
      expect.stringMatching(/generate onboarding/i),
    );
  });

  it("shows a phase's real description when its chip is clicked", () => {
    renderPage();
    const section = document.getElementById("pipeline")!;
    const workflows = PHASE_ORDER.find((p) => p.key === "workflows")!;
    fireEvent.click(within(section).getByRole("button", { name: /trace workflows/i }));
    expect(within(section).getByText(workflows.desc)).toBeInTheDocument();
  });

  it("visibly distinguishes Full AI from Facts-only AI", () => {
    renderPage();
    const section = document.getElementById("pipeline")!;
    // Select an AI phase, then flip modes: the data chip and caption change.
    fireEvent.click(within(section).getByRole("button", { name: /explain symbols/i }));
    expect(within(section).getByText("Sends code snippets + facts")).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("radio", { name: "Facts-only AI" }));
    expect(within(section).getByText("Sends extracted facts only, no code")).toBeInTheDocument();
    expect(within(section).queryByText("Sends code snippets + facts")).toBeNull();
    expect(within(section).getByText(/code never leaves the system/)).toBeInTheDocument();
  });

  it("renders the three privacy modes from the shared module", () => {
    renderPage();
    const section = document.getElementById("privacy")!;
    expect(section).not.toBeNull();
    for (const mode of PRIVACY_MODES) {
      expect(within(section).getByText(mode.label)).toBeInTheDocument();
      expect(within(section).getByText(mode.hint)).toBeInTheDocument();
    }
  });

  it("gives every anchor-linked section a labelled landmark", () => {
    renderPage();
    for (const id of ["product", "how", "privacy", "pipeline"]) {
      const section = document.getElementById(id);
      expect(section, id).not.toBeNull();
      expect(section!.getAttribute("aria-labelledby"), id).toBe(`${id}-title`);
      expect(document.getElementById(`${id}-title`), id).not.toBeNull();
    }
  });

  it("has the a11y frame the rest of the app already got", () => {
    renderPage();
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute("href", "#main");
    const main = document.getElementById("main");
    expect(main).not.toBeNull();
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("navigation", { name: "Landing sections" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Footer" })).toBeInTheDocument();
    expect(document.querySelector('a[href="/help"]')).not.toBeNull();
    expect(document.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(document.querySelector('a[href="/terms"]')).not.toBeNull();
  });
});
