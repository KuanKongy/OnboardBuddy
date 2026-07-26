import { strict as assert } from "node:assert";
import { groupGaps, summarizeGaps } from "../gapSummary.js";

/**
 * A10: the trust strip and the sections used to count two disjoint
 * populations under one word ("6 known unknowns" over a page holding 89 gap
 * entries). The reconciliation is arithmetic, so it is testable: the strip's
 * total must be exactly what the reader can scroll to, and the grouped rows
 * must lose nothing.
 */
describe("gap reconciliation (A10)", () => {
  it("reports one total that equals sections + detection, and groups without losing entries", () => {
    // Shaped like the audited FloowForge package: one section spraying the
    // same sentence per env var, one section repeating a pipeline complaint,
    // plus snapshot-level detection dead-ends.
    const guardrails = ["API_RATE_LIMIT_ENABLED", "CONTEXT_MAX_TOKENS", "SUPABASE_URL", "REDIS_URL"].map(
      (name) => ({ kind: "uncited_claim", detail: `There are no documented guardrails for \`${name}\`.` }),
    );
    const codeMap = ["web/lib/api.ts", "web/lib/supabase/server.ts"].map((file) => ({
      kind: "incomplete_coverage",
      detail: `The evidence for \`${file}\` does not contain direct snippet information.`,
    }));
    const detection = [{ kind: "trace_dead_ends" }, { kind: "journey_gap" }];

    const summary = summarizeGaps([guardrails, codeMap], detection);
    const rows = [...groupGaps(guardrails), ...groupGaps(codeMap)];

    assert.deepEqual(
      {
        total: summary.total,
        sections: summary.sections,
        detection: summary.detection,
        groups: summary.groups,
        rowCounts: rows.map((r) => r.count),
        // each kind collapsed onto a single template, so one variant per row
        variantsPerRow: rows.map((r) => r.variants.length),
        regrouped: rows.reduce((n, r) => n + r.count, 0),
      },
      {
        // one number, and it is the sum of both provenances
        total: 8,
        sections: 6,
        detection: 2,
        // 4 + 2 section gaps collapse to 2 rows; the 2 detection kinds stay distinct
        groups: 4,
        rowCounts: [4, 2],
        variantsPerRow: [1, 1],
        // grouping is lossless: every raw gap is still counted somewhere
        regrouped: summary.sections,
      },
    );
  });
});
