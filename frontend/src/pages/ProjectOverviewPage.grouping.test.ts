import { describe, expect, it } from "vitest";
import { groupChainedRuns, mergedRunStatus, runPhaseKeys, sumRunCost } from "./ProjectOverviewPage";
import type { RunHistoryEntry } from "@/types/analysis";

/**
 * Pairing is where this feature can lie quietly: a merge that shouldn't happen
 * makes a run the user paid for disappear into someone else's row, and a merge
 * that doesn't happen brings back the two rows expanding to the same 16 phases.
 * Neither shows up as an error anywhere.
 */

const SNAP = "snapshot-1";

function entry(over: Partial<RunHistoryEntry> & { id: string; job_type: string; created_at: string }): RunHistoryEntry {
  return {
    status: "complete",
    progress_pct: 100,
    current_step: null,
    error_message: null,
    snapshot_id: SNAP,
    section_type: null,
    config: { branch: "main", commit: "abc1234", scope_path: null, scope_name: null, depth: "standard", role: null },
    requested_by_email: null,
    started_at: over.created_at,
    finished_at: over.created_at,
    duration_ms: null,
    attempt: 1,
    step_log: [],
    package: null,
    cost: { estimated_cost_usd: 0, llm_calls: 0, cached_calls: 0, input_tokens: 0, output_tokens: 0 },
    budget: { capLlmCalls: 500, usedThisRun: 0, remaining: 500, lifetimeLlmCalls: 0, lifetimeCostUsd: 0 },
    sections: { generated: [], cached: [] },
    ...over,
  };
}

describe("groupChainedRuns", () => {
  it("merges a generation into the analysis named by chained_from", () => {
    // /runs is newest-first, so the generation arrives before its analysis.
    const gen = entry({ id: "gen", job_type: "generate_package", created_at: "2026-07-29T10:04:31Z", chained_from: "an" });
    const analyze = entry({
      id: "an", job_type: "analyze_scope", created_at: "2026-07-29T10:00:00Z",
      finished_at: "2026-07-29T10:04:30Z",
    });

    const rows = groupChainedRuns([gen, analyze]);

    expect(rows).to.have.length(1);
    // The pair takes the analysis's place: the row is stamped with its
    // created_at, so the list stays sorted by what it shows.
    expect(rows[0]!.run.id).to.equal("an");
    expect(rows[0]!.partner?.id).to.equal("gen");
  });

  it("merges a legacy pair (no key) by adjacency, but not a package asked for later", () => {
    const analyze = entry({
      id: "an", job_type: "analyze_scope", created_at: "2026-07-29T10:00:00Z",
      finished_at: "2026-07-29T10:04:30Z",
    });
    // Rows written before chainedFrom existed carry no link at all.
    const chained = entry({ id: "legacy-gen", job_type: "generate_package", created_at: "2026-07-29T10:04:35Z" });
    const manual = entry({ id: "manual-gen", job_type: "generate_package", created_at: "2026-07-29T10:14:30Z" });

    const rows = groupChainedRuns([manual, chained, analyze]);

    expect(rows.map((r) => r.run.id)).to.deep.equal(["manual-gen", "an"]);
    // 10 minutes later is a person clicking Generate, not the worker chaining.
    expect(rows[0]!.partner).to.equal(null);
    expect(rows[1]!.partner?.id).to.equal("legacy-gen");
  });

  it("does not swallow a package asked for while the analysis was still running", () => {
    // Re-analysing the same commit reuses the snapshot, so this generation and
    // that analysis share a snapshot id and finish seconds apart — the only
    // thing telling them apart is that a chained row is never created BEFORE
    // its analysis finished.
    const analyze = entry({
      id: "an", job_type: "analyze_scope", created_at: "2026-07-29T10:00:00Z",
      finished_at: "2026-07-29T10:04:30Z",
    });
    const duringRun = entry({ id: "gen", job_type: "generate_package", created_at: "2026-07-29T10:04:00Z" });

    const rows = groupChainedRuns([analyze, duringRun]);

    expect(rows.map((r) => [r.run.id, r.partner])).to.deep.equal([["an", null], ["gen", null]]);
  });

  it("ignores an analysis that never completed — nothing was ever chained off it", () => {
    const failed = entry({
      id: "an", job_type: "analyze_scope", status: "failed", created_at: "2026-07-29T10:00:00Z",
      finished_at: "2026-07-29T10:04:30Z", error_message: "Analysis failed",
    });
    // A user reacting to the failure by regenerating the last good package.
    const manual = entry({ id: "gen", job_type: "generate_package", created_at: "2026-07-29T10:04:50Z" });

    const rows = groupChainedRuns([manual, failed]);

    expect(rows.map((r) => [r.run.id, r.partner])).to.deep.equal([["gen", null], ["an", null]]);
  });

  it("leaves a generation standalone when its analysis is off the page, rather than adopting a neighbour", () => {
    const gen = entry({
      id: "gen", job_type: "generate_package", created_at: "2026-07-29T10:04:31Z",
      chained_from: "analysis-on-the-next-page",
    });
    // Timing that WOULD satisfy the legacy window — the explicit key must win,
    // or a straddled pair silently absorbs an unrelated re-analysis.
    const other = entry({
      id: "other-analysis", job_type: "analyze_scope", created_at: "2026-07-29T10:03:00Z",
      finished_at: "2026-07-29T10:04:30Z",
    });

    const rows = groupChainedRuns([gen, other]);

    expect(rows.map((r) => [r.run.id, r.partner])).to.deep.equal([["gen", null], ["other-analysis", null]]);
  });

  it("never merges two generations into one analysis", () => {
    const analyze = entry({
      id: "an", job_type: "analyze_scope", created_at: "2026-07-29T10:00:00Z",
      finished_at: "2026-07-29T10:04:30Z",
    });
    const first = entry({ id: "gen-1", job_type: "generate_package", created_at: "2026-07-29T10:04:31Z", chained_from: "an" });
    // A retried enqueue, or a regeneration right on the heels of the run.
    const second = entry({ id: "gen-2", job_type: "generate_package", created_at: "2026-07-29T10:04:40Z" });

    const rows = groupChainedRuns([second, first, analyze]);

    expect(rows.map((r) => r.run.id)).to.deep.equal(["gen-2", "an"]);
    expect(rows[1]!.partner?.id).to.equal("gen-1");
  });

  it("adds up what the pair actually cost", () => {
    // The measured cold run of 2026-07-29 (snapshot b2ae71a2), so the numbers
    // this row promises are checkable against the two rows it replaced.
    const analysis = { estimated_cost_usd: 0.3476, llm_calls: 234, cached_calls: 0, input_tokens: 1_257_663, output_tokens: 604_099 };
    const generation = { estimated_cost_usd: 0.0975, llm_calls: 57, cached_calls: 0, input_tokens: 648_925, output_tokens: 81_573 };

    const total = sumRunCost(analysis, generation);
    // Displayed to 4dp — the raw float carries binary noise past that.
    expect(total.estimated_cost_usd.toFixed(4)).to.equal("0.4451");
    expect(total.llm_calls).to.equal(291);
    expect(total.input_tokens).to.equal(1_906_588);
    expect(total.output_tokens).to.equal(685_672);
    expect(total.cached_calls).to.equal(0);
  });
});

describe("merged row status and phases", () => {
  it("reports the worst half — a finished analysis whose package failed is not complete", () => {
    expect(mergedRunStatus("complete", "failed")).to.equal("failed");
    expect(mergedRunStatus("complete", "paused")).to.equal("paused");
    expect(mergedRunStatus("complete", "running")).to.equal("running");
    expect(mergedRunStatus("complete", "queued")).to.equal("queued");
    expect(mergedRunStatus("complete", "complete")).to.equal("complete");
    expect(mergedRunStatus("failed", "running")).to.equal("failed");
  });

  it("credits each standalone row with only the phases it ran", () => {
    // A merged pair really did run the whole pipeline.
    expect(runPhaseKeys("analyze_scope", true)).to.equal(undefined);

    const analysisOnly = runPhaseKeys("analyze_scope", false);
    expect(analysisOnly).to.include("ingest");
    expect(analysisOnly).to.include("embeddings");
    expect(analysisOnly).to.not.include("generation");
    expect(analysisOnly).to.not.include("validation");
    expect(runPhaseKeys("incremental_update", false)).to.deep.equal(analysisOnly);

    expect(runPhaseKeys("generate_package", false)).to.deep.equal(["generation", "validation"]);
    // Regenerations and preflights render their own step lists.
    expect(runPhaseKeys("regenerate_section", false)).to.equal(undefined);
    expect(runPhaseKeys("preflight", false)).to.equal(undefined);
  });
});
