import { describe, expect, it } from "vitest";
import { partialRunSteps, partialStepStatuses } from "./ProjectOverviewPage";

/**
 * The two claims a regeneration row makes that nothing else would catch: how
 * many steps it says ran, and which one it blames when the run failed. Both
 * are silent when wrong — the row still renders, it just lies.
 */
describe("partial run steps", () => {
  it("lists no citation step for a tutorial regeneration (that pass never runs)", () => {
    expect(partialRunSteps({ tutorial_title: "Create a project" }).map((s) => s.label)).toEqual([
      "Generate tutorial",
    ]);
    expect(partialRunSteps({ tutorial_title: null }).map((s) => s.label)).toEqual([
      "Generate onboarding",
      "Validate citations",
    ]);
  });

  it("blames generation, not validation, when a run fails at 100% without generating", () => {
    // The "section is from a previous layout" guard fails the job at 100.
    expect(partialStepStatuses({ status: "failed", progress_pct: 100 }, 2)).toEqual(["failed", "pending"]);
    expect(partialStepStatuses({ status: "failed", progress_pct: 93 }, 2)).toEqual(["complete", "failed"]);
    expect(partialStepStatuses({ status: "complete", progress_pct: 100 }, 2)).toEqual(["complete", "complete"]);
  });
});
