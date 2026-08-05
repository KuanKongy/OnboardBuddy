import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PHASE_ORDER, phaseDesc } from "@/lib/pipelinePhases";
import { PRIVACY_MODES } from "@/lib/privacyModes";

let mockUser: { id: string } | null = null;
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, loading: false, signOut: vi.fn() }),
}));

const { IntroPage } = await import("./IntroPage");

function renderPage(entries: string[] = ["/"]) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={entries}>
        <IntroPage />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/** Every span in #pipeline whose text is exactly "AI": the mode radios read
 *  "Full AI"/"AI disabled" and never match. */
function aiPills(section: HTMLElement) {
  return Array.from(section.querySelectorAll("span")).filter((el) => el.textContent === "AI");
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

  it("recolors the AI pills for facts-only and drops them under AI disabled", () => {
    renderPage();
    const section = document.getElementById("pipeline")!;
    const full = aiPills(section);
    expect(full.length).toBe(PHASE_ORDER.filter((p) => p.ai).length);
    for (const pill of full) expect(pill.className).toContain("text-primary");

    fireEvent.click(within(section).getByRole("radio", { name: "Facts-only AI" }));
    const facts = aiPills(section);
    expect(facts).toHaveLength(full.length);
    for (const pill of facts) expect(pill.className).toContain("text-info");

    // Nothing reaches a model in this mode, so no badge may still say "AI" —
    // generation included, which runs but runs deterministically.
    fireEvent.click(within(section).getByRole("radio", { name: "AI disabled" }));
    expect(aiPills(section)).toHaveLength(0);
  });

  it("swaps a phase's description when the privacy mode changes", () => {
    renderPage();
    const section = document.getElementById("pipeline")!;
    const symbols = PHASE_ORDER.find((p) => p.key === "semantic_symbols")!;
    const perMode = PRIVACY_MODES.map((m) => phaseDesc(symbols, m.key));
    // Three modes, three different sentences: identical copy would make the
    // mode toggle a lie.
    expect(new Set(perMode).size).toBe(3);

    fireEvent.click(within(section).getByRole("button", { name: /explain symbols/i }));
    expect(within(section).getByText(perMode[0]!)).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("radio", { name: "Facts-only AI" }));
    expect(within(section).getByText(perMode[1]!)).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("radio", { name: "AI disabled" }));
    expect(within(section).getByText(perMode[2]!)).toBeInTheDocument();
  });

  it("keeps every phase description em-dash-free and every AI phase mode-complete", () => {
    for (const phase of PHASE_ORDER) {
      for (const [field, value] of Object.entries(phase)) {
        if (!field.startsWith("desc") || typeof value !== "string") continue;
        expect(value, `${phase.key}.${field}`).not.toContain("—");
      }
      // A phase that reaches a model must say what it does when it cannot:
      // falling back to the neutral desc would claim a model call.
      if (phase.ai) {
        expect(phase.descFactsOnly, phase.key).toBeTruthy();
        expect(phase.descAiDisabled, phase.key).toBeTruthy();
      }
    }
  });

  it("scrolls to the section named in the location hash", () => {
    // React Router does not scroll on hash navigation and jsdom has no
    // scrollIntoView at all, so the effect is only observable through a stub.
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: () => void };
    const original = proto.scrollIntoView;
    const scrolledTo: Element[] = [];
    proto.scrollIntoView = function (this: Element) {
      scrolledTo.push(this);
    };
    try {
      renderPage(["/#how"]);
      expect(scrolledTo).toContain(document.getElementById("how"));
    } finally {
      if (original) proto.scrollIntoView = original;
      else delete proto.scrollIntoView;
    }
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
    expect(document.querySelector('a[href="/faq"]')).not.toBeNull();
    expect(document.querySelector('a[href="/privacy"]')).not.toBeNull();
    // The guarantee card and the row inside it share one accessible name: the
    // card is a role="link" div (so the text stays selectable) and the row is
    // the real anchor that carries the href.
    const breakdown = screen.getAllByRole("link", { name: "Full privacy breakdown, mode by mode" });
    expect(breakdown).toHaveLength(2);
    expect(breakdown.some((el) => el.getAttribute("href") === "/privacy")).toBe(true);
    expect(document.querySelector('a[href="/terms"]')).not.toBeNull();
  });
});
