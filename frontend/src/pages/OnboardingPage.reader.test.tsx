import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SectionView } from "./OnboardingPage";
import type { OnboardingSection } from "@/types/onboarding";

/**
 * Owner feedback K1: known gaps and citations stay in the package but "should
 * only show up on demand". The regression this guards is the one the audit
 * measured — a gaps block at 63% of its section (§19.4) and a 43-chip citation
 * footer rendered all at once (§19.3) — so the affordance must both hide the
 * detail by default and state how much is behind it.
 */
const receipt = (filePath: string) => ({ filePath, staleness: "fresh" as const });

const SECTION: OnboardingSection = {
  id: "guardrails-ops",
  sectionId: "sec-1",
  label: "Guardrails & Operations",
  status: "complete",
  confidence: "medium",
  claims: { total: 9, cited: 7, low: 1 },
  blocks: [
    {
      title: "Guardrails & Operations",
      body: "Budgets cap one run.",
      receipts: [receipt("lib/queue.ts"), receipt("lib/budget.ts"), receipt("lib/db.ts")],
    },
  ],
  diagrams: [],
  unknowns: [
    { kind: "budget_degraded" },
    { kind: "noReceipt", detail: "no evidence for the webhook path" },
  ],
};

function renderSection(section: OnboardingSection = SECTION) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SectionView section={section} projectId="p1" onReceiptClick={() => {}} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("reader gaps & citations (K1)", () => {
  it("keeps both lists collapsed behind an affordance that names their size", async () => {
    renderSection();

    expect(
      ["3 citations", "2 known gaps"].map((label) => ({
        label,
        expanded: screen.getByRole("button", { name: new RegExp(label) }).getAttribute("aria-expanded"),
        detailShown: screen.queryByText(/lib\/budget\.ts|analysis budget ran out/i) !== null,
      })),
    ).toEqual([
      { label: "3 citations", expanded: "false", detailShown: false },
      { label: "2 known gaps", expanded: "false", detailShown: false },
    ]);

    await userEvent.click(screen.getByRole("button", { name: /2 known gaps/ }));
    expect(screen.getByText(/analysis budget ran out/i)).toBeInTheDocument();
  });

  it("draws the grade as a pie labelled with the arithmetic behind it", () => {
    const { unmount } = renderSection();
    expect(
      screen.getByRole("img", { name: "Medium confidence: 7 of 9 claims cite receipts" }),
    ).toBeInTheDocument();
    unmount();

    // `claims: null` is a real answer (generations that predate the claim
    // ledger), not a missing field: the pie still has to draw and still has to
    // name the grade, rather than render a NaN arc with no label.
    renderSection({ ...SECTION, claims: null });
    expect(screen.getByRole("img", { name: "Medium confidence" })).toBeInTheDocument();
  });

  it("renders GFM tables as real tables, not literal pipe characters", () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <SectionView
            section={{
              ...SECTION,
              unknowns: [],
              blocks: [
                {
                  title: "Guardrails & Operations",
                  body: "| Variable | Purpose |\n| --- | --- |\n| REDIS_URL | queue backend |",
                  receipts: [],
                },
              ],
            }}
            projectId="p1"
            onReceiptClick={() => {}}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    // The audit's "pipe soup" (READER_REDESIGN.md N1): without remark-gfm this
    // body renders as one paragraph containing literal `|` characters.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Variable" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "queue backend" })).toBeInTheDocument();
    expect(screen.queryByText(/\|\s*---\s*\|/)).toBeNull();
  });
});
