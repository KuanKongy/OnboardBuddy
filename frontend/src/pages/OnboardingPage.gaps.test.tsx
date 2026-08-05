import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PackageGapsPanel, PackageGapsToggle } from "./OnboardingPage";
import type { OnboardingSection, PackageCoverage } from "@/types/onboarding";

const SECTIONS: OnboardingSection[] = [
  {
    id: "guardrails-ops",
    sectionId: "sec-1",
    label: "Guardrails & Operations",
    status: "complete",
    confidence: "medium",
    blocks: [],
    diagrams: [],
    unknowns: [{ kind: "uncited_claim" }, { kind: "uncited_claim" }],
    unknownGroups: [{ kind: "uncited_claim", count: 2, variants: [] }],
  },
];

const COVERAGE: PackageCoverage = {
  snapshotCreatedAt: "2026-07-01T00:00:00Z",
  files: { parsed: 40, supported: 40, inScope: 90, unsupported: 0, cited: 12 },
  symbols: { total: 100, cited: 30 },
  workflows: { total: 4, covered: 2 },
  tutorialCount: 0,
  languages: null,
  detectionUnknowns: [{ kind: "trace_dead_ends", count: 3 }],
  gaps: { total: 3, sections: 2, detection: 1, groups: 1 },
};

/** The page's half of the split: it owns `open`, the panel renders below. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider>
      <PackageGapsToggle coverage={COVERAGE} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && <PackageGapsPanel coverage={COVERAGE} sections={SECTIONS} />}
    </TooltipProvider>
  );
}

const trigger = () => screen.getByRole("button", { name: /3 known gaps in this package/ });

describe("package-level known gaps (#85 remainder)", () => {
  it("expands the count into the gap items", () => {
    render(<Harness />);

    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("3 traces reached no effect")).toBeNull();

    fireEvent.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    // Both provenances, itemised: section gaps rolled up by kind, plus detection.
    expect(screen.getByText(/couldn't be backed by evidence/i)).toBeInTheDocument();
    expect(screen.getByText("× 2")).toBeInTheDocument();
    expect(screen.getByText(/in Guardrails & Operations/)).toBeInTheDocument();
    expect(screen.getByText("3 traces reached no effect")).toBeInTheDocument();
  });
});
