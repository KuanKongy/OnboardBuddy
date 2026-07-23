import { expect } from "chai";
import {
  ageLabelFrom,
  claimForReceipt,
  inlineMarkersToText,
  receiptStaleness,
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
      receiptStaleness({ nodeStableKey: null, ownNodeHash: null, latestNodeHash: null }),
    ).to.equal("unknown");
    expect(
      receiptStaleness({ nodeStableKey: "a/b.ts#fn", ownNodeHash: null, latestNodeHash: "h" }),
    ).to.equal("unknown");
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
