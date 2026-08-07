import { expect } from "chai";
import {
  ageLabelFrom,
  claimCounts,
  claimForReceipt,
  confidenceReasonFor,
  inlineMarkersToText,
  packageGenerationMode,
  receiptStaleness,
  receiptVerification,
} from "../../src/api/lib/receiptPresentation.js";

describe("receiptPresentation.inlineMarkersToText", () => {
  it("converts markers to (path:line) citations and drops unresolvable ones", () => {
    const map = new Map([
      ["b-1", { filePath: "backend/src/lib/db.ts", lineStart: 25 }],
      ["b-2", { filePath: "README.md", lineStart: null }],
    ]);
    expect(
      inlineMarkersToText("Runs SQL [[receipt:b-1]]. Documented [[receipt:b-2]]. Ghost [[receipt:b-3]].", map),
    ).to.equal("Runs SQL (backend/src/lib/db.ts:25). Documented (README.md). Ghost.");
  });

  it("converts unverified spans to an explicit [unverified] tag — no marker syntax leaks", () => {
    expect(
      inlineMarkersToText("[[unverified]]The scheduler retries forever[[/unverified]] and more.", new Map()),
    ).to.equal("The scheduler retries forever *[unverified]* and more.");
  });
});

describe("receiptPresentation.receiptStaleness", () => {
  it("is fresh when the symbol hash is unchanged in the latest analysis", () => {
    expect(
      receiptStaleness({ nodeStableKey: "a/b.ts#fn", ownNodeHash: "h1", latestNodeHash: "h1" }),
    ).to.equal("fresh");
  });

  it("is stale when the symbol hash changed", () => {
    expect(
      receiptStaleness({ nodeStableKey: "a/b.ts#fn", ownNodeHash: "h1", latestNodeHash: "h2" }),
    ).to.equal("stale");
  });

  it("is stale when the symbol no longer exists in the latest analysis", () => {
    expect(
      receiptStaleness({ nodeStableKey: "a/b.ts#fn", ownNodeHash: "h1", latestNodeHash: null }),
    ).to.equal("stale");
  });

  it("is unknown for synthesis/doc keys and missing keys — never a fake fresh", () => {
    expect(
      receiptStaleness({ nodeStableKey: "docnode:doc:README.md#x", ownNodeHash: "h", latestNodeHash: "h" }),
    ).to.equal("unknown");
    expect(
      receiptStaleness({ nodeStableKey: "wf:GET /api/projects", ownNodeHash: "h", latestNodeHash: "h" }),
    ).to.equal("unknown");
    expect(
      receiptStaleness({ nodeStableKey: null, ownNodeHash: null, latestNodeHash: null }),
    ).to.equal("unknown");
    expect(
      receiptStaleness({ nodeStableKey: "a/b.ts#fn", ownNodeHash: null, latestNodeHash: "h" }),
    ).to.equal("unknown");
  });

  it("route symbols with path-param colons are ordinary graph keys, not synthesis", () => {
    expect(
      receiptStaleness({
        nodeStableKey: "backend/src/api/routes/projects.ts#POST /:id/analyze",
        ownNodeHash: "h1",
        latestNodeHash: "h1",
      }),
    ).to.equal("fresh");
    expect(
      receiptStaleness({
        nodeStableKey: "backend/src/api/routes/projects.ts#POST /:id/analyze",
        ownNodeHash: "h1",
        latestNodeHash: "h2",
      }),
    ).to.equal("stale");
  });
});

describe("receiptPresentation.receiptVerification", () => {
  const base = {
    latestCommitHash: "abc1234",
    receiptLineStart: 23,
    receiptLineEnd: 26,
    ownNodeLineStart: 20,
    latestNodeLineStart: 20,
    latestNodeLineEnd: 40,
  };

  it("verified: unchanged symbol at unchanged lines, checked against the latest commit", () => {
    const v = receiptVerification({ ...base, staleness: "fresh", latestNodeHash: "h1" });
    expect(v).to.deep.equal({
      status: "verified",
      checkedAgainstCommit: "abc1234",
      lineStart: 23,
      lineEnd: 26,
    });
  });

  it("re_anchored: unchanged symbol that moved shifts the receipt span by its delta", () => {
    const v = receiptVerification({
      ...base,
      staleness: "fresh",
      latestNodeHash: "h1",
      latestNodeLineStart: 275, // symbol moved down 255 lines
    });
    expect(v).to.deep.equal({
      status: "re_anchored",
      checkedAgainstCommit: "abc1234",
      lineStart: 278,
      lineEnd: 281,
    });
  });

  it("changed: modified symbol reports where it now lives, never re-anchors the snippet", () => {
    const v = receiptVerification({
      ...base,
      staleness: "stale",
      latestNodeHash: "h-CHANGED",
      latestNodeLineStart: 30,
      latestNodeLineEnd: 55,
    });
    expect(v).to.deep.equal({
      status: "changed",
      checkedAgainstCommit: "abc1234",
      lineStart: 30,
      lineEnd: 55,
    });
  });

  it("missing: symbol gone from the latest analysis", () => {
    const v = receiptVerification({ ...base, staleness: "stale", latestNodeHash: null });
    expect(v).to.deep.equal({
      status: "missing",
      checkedAgainstCommit: "abc1234",
      lineStart: null,
      lineEnd: null,
    });
  });

  it("unverifiable: docs/synthesis receipts claim nothing about any commit", () => {
    const v = receiptVerification({ ...base, staleness: "unknown", latestNodeHash: null });
    expect(v).to.deep.equal({
      status: "unverifiable",
      checkedAgainstCommit: null,
      lineStart: null,
      lineEnd: null,
    });
  });
});

/**
 * The reader draws the cited fraction as a dial and prints `confidenceReason`
 * beside it. Both read the same stored claims, so a divergence here shows up
 * as a picture contradicting the sentence under it — which is why the counts
 * live in one function and the reason is now rendered from it.
 */
describe("receiptPresentation.claimCounts", () => {
  it("tallies tracked, cited and downgraded claims", () => {
    expect(
      claimCounts({
        claims: [
          { claim: "a", receiptIds: ["r1"], confidence: "high" },
          { claim: "b", receiptIds: ["r1", "r2"], confidence: "medium" },
          { claim: "c", receiptIds: [], confidence: "low" },
          { claim: "d", confidence: "low" },
        ],
      }),
    ).to.deep.equal({ total: 4, cited: 2, low: 2 });
  });

  it("is null when the generation tracked no claims — 0/0 is not the same as untracked", () => {
    expect(claimCounts(null)).to.equal(null);
    expect(claimCounts({})).to.equal(null);
    expect(claimCounts({ claims: [] })).to.equal(null);
    expect(claimCounts({ claims: "bogus" })).to.equal(null);
  });
});

describe("receiptPresentation.confidenceReasonFor", () => {
  it("counts cited claims and downgrades from the stored validation", () => {
    const ctx = {
      claims: [
        { claim: "a", receiptIds: ["r1"], confidence: "high" },
        { claim: "b", receiptIds: ["r1", "r2"], confidence: "medium" },
        { claim: "c", receiptIds: [], confidence: "low" },
      ],
    };
    expect(confidenceReasonFor(ctx, 6)).to.equal(
      "2/3 tracked claims cite receipts · 1 downgraded to low · 6 receipts",
    );
  });

  it("omits the downgrade clause when nothing was downgraded", () => {
    const ctx = { claims: [{ claim: "a", receiptIds: ["r1"], confidence: "high" }] };
    expect(confidenceReasonFor(ctx, 1)).to.equal("1/1 tracked claims cite receipts · 1 receipt");
  });

  it("is honest when claim tracking is missing", () => {
    expect(confidenceReasonFor(null, 4)).to.equal(
      "4 receipts · per-claim tracking not available for this generation",
    );
    expect(confidenceReasonFor({}, 0)).to.equal(
      "no receipts; content is not independently verifiable",
    );
    // An empty claim array reads as untracked, not as "0 of 0 cited" — the one
    // boundary the shared-counts refactor could have moved.
    expect(confidenceReasonFor({ claims: [] }, 4)).to.equal(
      "4 receipts · per-claim tracking not available for this generation",
    );
  });
});

describe("receiptPresentation.ageLabelFrom", () => {
  const now = new Date("2026-07-23T12:00:00Z");

  it("labels same-day, yesterday, day counts, and old dates", () => {
    expect(ageLabelFrom("2026-07-23T08:00:00Z", now)).to.equal("analyzed today");
    expect(ageLabelFrom("2026-07-22T08:00:00Z", now)).to.equal("analyzed yesterday");
    expect(ageLabelFrom("2026-07-17T08:00:00Z", now)).to.equal("analyzed 6 days ago");
    expect(ageLabelFrom("2026-01-02T08:00:00Z", now)).to.equal("analyzed on 2 Jan 2026");
  });

  it("returns empty for missing or invalid dates instead of inventing one", () => {
    expect(ageLabelFrom(null, now)).to.equal("");
    expect(ageLabelFrom("not-a-date", now)).to.equal("");
  });
});

describe("receiptPresentation.claimForReceipt", () => {
  const ctx = {
    claims: [
      { claim: "db.ts executes queries", receiptIds: ["r-uuid-1"], confidence: "high" },
      { claim: "also cited by r1", receiptIds: ["r-uuid-1", "r-uuid-2"], confidence: "high" },
      { claim: "third match ignored", receiptIds: ["r-uuid-1"], confidence: "low" },
      { claim: "", receiptIds: ["r-uuid-3"], confidence: "low" },
    ],
  };

  it("finds claims citing the bundle receipt id (capped at two)", () => {
    expect(claimForReceipt("r-uuid-1", ctx)).to.equal(
      "db.ts executes queries · also cited by r1",
    );
    expect(claimForReceipt("r-uuid-2", ctx)).to.equal("also cited by r1");
  });

  it("returns null when unmatched, empty, or malformed", () => {
    expect(claimForReceipt("r-uuid-3", ctx)).to.equal(null); // empty claim text
    expect(claimForReceipt("nope", ctx)).to.equal(null);
    expect(claimForReceipt(null, ctx)).to.equal(null);
    expect(claimForReceipt("r-uuid-1", null)).to.equal(null);
    expect(claimForReceipt("r-uuid-1", { claims: "bogus" })).to.equal(null);
  });
});

describe("receiptPresentation.packageGenerationMode", () => {
  const det = { mode: "deterministic", privacy_mode: "ai_disabled" };
  const ai = (privacy: string) => ({ prompt_version: "section-v6", privacy_mode: privacy });

  it("reports a no-AI package as structural-only and says why", () => {
    const mode = packageGenerationMode([det, det, det]);
    expect(mode.kind).to.equal("deterministic");
    expect(mode.privacyMode).to.equal("ai_disabled");
    expect(mode.deterministicSections).to.equal(3);
    expect(mode.label).to.match(/Structural only/);
    expect(mode.label).to.match(/extracted directly from the code/);
  });

  it("labels facts-only packages and stays silent for ordinary full_ai ones", () => {
    expect(packageGenerationMode([ai("facts_only_ai")]).label).to.match(/no code left the system/);
    const full = packageGenerationMode([ai("full_ai"), ai("full_ai")]);
    expect(full.kind).to.equal("ai_assisted");
    expect(full.label).to.equal(null); // nothing unusual to disclose
  });

  it("does not claim a package is no-AI when only some sections are", () => {
    // A regenerate_section under ai_disabled against an otherwise AI package:
    // calling the whole thing structural-only would be as wrong as calling it
    // AI-written.
    const mixed = packageGenerationMode([det, ai("full_ai"), ai("full_ai")]);
    expect(mixed.kind).to.equal("mixed");
    expect(mixed.privacyMode).to.equal(null);
    expect(mixed.label).to.match(/1 of 3 sections/);
  });

  it("reads legacy rows that predate privacy_mode, and stays silent with nothing to read", () => {
    // The deterministic path has always stamped mode:'deterministic'.
    expect(packageGenerationMode([{ mode: "deterministic" }]).kind).to.equal("deterministic");
    // A pre-privacy_mode AI section is ai_assisted with an unknown mode, never
    // mislabeled as no-AI.
    const legacy = packageGenerationMode([{ prompt_version: "section-v5" }]);
    expect(legacy.kind).to.equal("ai_assisted");
    expect(legacy.privacyMode).to.equal(null);
    expect(packageGenerationMode([]).kind).to.equal("unknown");
  });
});
