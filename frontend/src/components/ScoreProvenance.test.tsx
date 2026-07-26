import { render, screen } from "@testing-library/react";
import { ScoreProvenance, type ScoreProvenanceData } from "./ScoreProvenance";

/**
 * A real payload from `GET /projects/:id/graph/nodes/:key` — the API route
 * handler for a repo of this shape. Kept verbatim (values, wording, order) so
 * a change to the backend's derivation shows up here as a diff rather than
 * being quietly re-narrated by the component.
 */
const FULL: ScoreProvenanceData = {
  available: true,
  method: "weighted_signals",
  label: "Importance",
  score: 0.6135,
  formula: "score = Σ (signal ÷ snapshot maximum) × weight, over 9 signals",
  inputs: [
    { key: "workflowParticipation", label: "Workflow participation", weight: 0.2, value: 1, contribution: 0.2, measured: "in 4 traced workflows" },
    { key: "sideEffects", label: "Side-effect breadth", weight: 0.15, value: 0.75, contribution: 0.1125, measured: "3 kinds of side effect" },
    { key: "routeSchemaOwnership", label: "Route / schema ownership", weight: 0.1, value: 1, contribution: 0.1, measured: "owns a route or database table" },
    { key: "entrypointParticipation", label: "Entry point", weight: 0.1, value: 1, contribution: 0.1, measured: "entry point" },
    { key: "fanCentrality", label: "Fan-in / fan-out centrality", weight: 0.15, value: 0.44, contribution: 0.066, measured: "11 weighted call/import edges" },
    { key: "exportedSurface", label: "Exported surface", weight: 0.15, value: 0.15, contribution: 0.0225, measured: "exported" },
    { key: "churn", label: "Churn (last 90 days)", weight: 0.05, value: 0.25, contribution: 0.0125, measured: "3 commits in 90 days" },
    { key: "testProximity", label: "Test coverage", weight: 0.05, value: 0, contribution: 0, measured: "no test references it" },
    { key: "configRelevance", label: "Config & environment", weight: 0.05, value: 0, contribution: 0, measured: "reads no configuration" },
  ],
  reasons: ["Participates in 4 workflows", "Handles a route", "Entry point"],
  lever: "Biggest lever: fan-in / fan-out centrality is at 44% of the snapshot's highest file; closing that gap is worth up to 8.4 points.",
  scaleNote:
    "Every signal is divided by the highest value any file reaches in THIS snapshot, so 100 would mean leading every signal at once. The scale is relative to this repository — it is not comparable across projects.",
  caveat: null,
};

/** A cluster whose members all fell outside the stored top 500 — the mean has nothing under it. */
const MISSING: ScoreProvenanceData = {
  available: false,
  label: "Criticality",
  score: 0.42,
  reason:
    "None of this component's 31 members has a stored criticality score, so the number has no derivation.",
};

/** A real zero: every signal measured, every one of them empty. */
const ZERO: ScoreProvenanceData = {
  available: true,
  method: "weighted_signals",
  label: "Importance",
  score: 0,
  formula: "score = Σ (signal ÷ snapshot maximum) × weight, over 9 signals",
  inputs: [
    { key: "workflowParticipation", label: "Workflow participation", weight: 0.2, value: 0, contribution: 0, measured: "in no traced workflow" },
    { key: "fanCentrality", label: "Fan-in / fan-out centrality", weight: 0.15, value: 0, contribution: 0, measured: "nothing imports or calls it" },
    { key: "exportedSurface", label: "Exported surface", weight: 0.15, value: 0, contribution: 0, measured: "exports nothing" },
    { key: "sideEffects", label: "Side-effect breadth", weight: 0.15, value: 0, contribution: 0, measured: "no side effects detected" },
    { key: "entrypointParticipation", label: "Entry point", weight: 0.1, value: 0, contribution: 0, measured: "not an entry point" },
    { key: "routeSchemaOwnership", label: "Route / schema ownership", weight: 0.1, value: 0, contribution: 0, measured: "owns no route or table" },
    { key: "testProximity", label: "Test coverage", weight: 0.05, value: 0, contribution: 0, measured: "no test references it" },
    { key: "configRelevance", label: "Config & environment", weight: 0.05, value: 0, contribution: 0, measured: "reads no configuration" },
    { key: "churn", label: "Churn (last 90 days)", weight: 0.05, value: 0, contribution: 0, measured: "no commits in 90 days" },
  ],
  reasons: [],
  lever:
    "Biggest lever: workflow participation is at 0% of the snapshot's highest file; closing that gap is worth up to 20 points.",
  scaleNote: "Every signal is divided by the highest value any file reaches in THIS snapshot.",
  caveat: null,
};

const MEAN: ScoreProvenanceData = {
  available: true,
  method: "member_mean",
  label: "Criticality",
  score: 0.42,
  formula: "component score = mean of its 3 scored files",
  inputs: [
    { key: "src/api/routes/auth.ts", label: "auth.ts", weight: null, value: 0.71, contribution: 0.2367, measured: "src/api/routes/auth.ts" },
    { key: "src/api/routes/projects.ts", label: "projects.ts", weight: null, value: 0.4, contribution: 0.1333, measured: "src/api/routes/projects.ts" },
    { key: "src/api/routes/health.ts", label: "health.ts", weight: null, value: 0.15, contribution: 0.05, measured: "src/api/routes/health.ts" },
  ],
  reasons: ["Averages 3 member files", "Top member auth.ts scores 71"],
  lever: "It is a mean, not a maximum: one critical file cannot lift a large component.",
  scaleNote: "Each member's own score comes from the 9-signal candidate ranking.",
  caveat: "3 of 12 members carry a score; the rest are not ranked and were not part of the average.",
};

describe("ScoreProvenance", () => {
  describe("with a full breakdown", () => {
    it("shows the formula, every signal with its measured value and weight, and the lever", () => {
      render(<ScoreProvenance data={FULL} />);

      expect(screen.getByText(FULL.available ? FULL.formula : "")).toBeInTheDocument();
      expect(screen.getByText("Workflow participation")).toBeInTheDocument();
      expect(screen.getByText("— in 4 traced workflows")).toBeInTheDocument();
      // The arithmetic, not just the result: value × weight → points.
      expect(screen.getByText("100% × 20% → 20 pts")).toBeInTheDocument();
      expect(screen.getByText("44% × 15% → 6.6 pts")).toBeInTheDocument();
      expect(screen.getByText(/Biggest lever/)).toBeInTheDocument();
      expect(screen.getByText(/relative to this repository/)).toBeInTheDocument();
    });

    it("lists all nine signals in the panel and says how many contributed nothing", () => {
      render(<ScoreProvenance data={FULL} />);

      expect(screen.getAllByRole("listitem")).toHaveLength(9 + 3); // signals + stored reasons
      expect(screen.getByText("2 of 9 signals contributed nothing.")).toBeInTheDocument();
    });

    it("truncates to the top signals in a tooltip and counts the rest", () => {
      render(<ScoreProvenance data={FULL} variant="tooltip" />);

      expect(screen.getByText("Workflow participation")).toBeInTheDocument();
      expect(screen.queryByText("Config & environment")).not.toBeInTheDocument();
      expect(screen.getByText(/\+ 5 more signals, 2 of them scoring 0/)).toBeInTheDocument();
    });

    it("drops the stored reasons where the host already prints them", () => {
      render(<ScoreProvenance data={FULL} showReasons={false} />);

      expect(screen.queryByText("Participates in 4 workflows")).not.toBeInTheDocument();
      expect(screen.getByText("Workflow participation")).toBeInTheDocument();
    });
  });

  describe("with no stored breakdown", () => {
    it("says the derivation is unavailable and gives the stored reason", () => {
      render(<ScoreProvenance data={MISSING} />);

      expect(screen.getByText("How this number was derived is unavailable")).toBeInTheDocument();
      expect(screen.getByText(/None of this component's 31 members/)).toBeInTheDocument();
    });

    it("invents nothing: no formula, no signals, no lever", () => {
      render(<ScoreProvenance data={MISSING} />);

      expect(screen.queryByText(/Σ/)).not.toBeInTheDocument();
      expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
      expect(screen.queryByText(/Biggest lever/)).not.toBeInTheDocument();
      // Not even the score it belongs to — a percentage here would read as a
      // breakdown that we do not have.
      expect(screen.queryByText(/42/)).not.toBeInTheDocument();
    });

    it("treats a missing payload the same as an unavailable one", () => {
      render(<ScoreProvenance data={undefined} />);

      expect(screen.getByText("How this number was derived is unavailable")).toBeInTheDocument();
      expect(screen.getByText(/arrived without its derivation/)).toBeInTheDocument();
    });
  });

  describe("with a zero score", () => {
    it("explains the zero instead of falling back to 'unavailable'", () => {
      render(<ScoreProvenance data={ZERO} />);

      expect(screen.queryByText("How this number was derived is unavailable")).not.toBeInTheDocument();
      expect(screen.getByText("9 of 9 signals contributed nothing.")).toBeInTheDocument();
      expect(screen.getByText("— in no traced workflow")).toBeInTheDocument();
      expect(screen.getByText("— nothing imports or calls it")).toBeInTheDocument();
    });

    it("still names what would raise it, weighted by the heaviest empty signal", () => {
      render(<ScoreProvenance data={ZERO} />);

      expect(screen.getByText(/worth up to 20 points/)).toBeInTheDocument();
      expect(screen.getAllByText("0% × 20% → 0 pts")).toHaveLength(1);
    });
  });

  describe("with an averaged component score", () => {
    it("names the members it averaged and carries the incompleteness caveat", () => {
      render(<ScoreProvenance data={MEAN} />);

      expect(screen.getByText("component score = mean of its 3 scored files")).toBeInTheDocument();
      expect(screen.getByText("auth.ts")).toBeInTheDocument();
      expect(screen.getByText("score 71 → 23.7 pts")).toBeInTheDocument();
      expect(screen.getByText(/3 of 12 members carry a score/)).toBeInTheDocument();
    });
  });
});
