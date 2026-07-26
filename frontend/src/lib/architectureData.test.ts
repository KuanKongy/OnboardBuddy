import { describe, expect, it } from "vitest";
import { clusterSize } from "./architectureData";

/**
 * `members` holds file, symbol, config and schema nodes, so `members.length`
 * was never a file count. Rendering it as one printed "0 files" over a
 * Database Schema cluster holding 37 tables, and described a config cluster by
 * the single stray module in it.
 */
describe("clusterSize", () => {
  it("counts files for a normal code cluster", () => {
    expect(
      clusterSize({
        members: new Array(21),
        metadata: { fileCount: 21, primaryMemberNoun: "file", memberCountsByType: { module: 21 } },
      }),
    ).to.deep.equal({ count: 21, noun: "file" });
  });

  it("counts tables for a schema cluster that has no files at all", () => {
    expect(
      clusterSize({
        members: new Array(37),
        metadata: { fileCount: 0, primaryMemberNoun: "table", memberCountsByType: { schema: 37 } },
      }),
    ).to.deep.equal({ count: 37, noun: "table" });
  });

  it("counts config files when config members dominate a lone module", () => {
    expect(
      clusterSize({
        members: new Array(23),
        metadata: { fileCount: 1, primaryMemberNoun: "config file", memberCountsByType: { module: 1, config: 22 } },
      }),
    ).to.deep.equal({ count: 22, noun: "config file" });
  });

  it("falls back to members.length for snapshots taken before the rework", () => {
    // Pre-rework clusters carry no fileCount. members.length is at least an
    // upper bound, which beats rendering 0 or crashing.
    expect(clusterSize({ members: new Array(9), metadata: {} })).to.deep.equal({ count: 9, noun: "file" });
  });
});
