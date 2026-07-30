import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  it("uses seconds, then minutes, then hours", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(727_000)).toBe("12m 7s");
    expect(formatDuration(3_600_000)).toBe("1h 0m");
  });

  // A merged chained run is the common case, and the formatters this replaced had no
  // hours branch — they printed "560m 7s".
  it("renders a merged-row sum in hours instead of hundreds of minutes", () => {
    expect(formatDuration(33_607_000)).toBe("9h 20m");
    expect(formatDuration(33_607_000)).not.toMatch(/^\d{3,}m/);
  });

  it("keeps the empty and sub-second cases the callers relied on", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(NaN)).toBe("");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(200)).toBe("<1s");
    // A live elapsed counter can be handed a negative delta from clock skew.
    expect(formatDuration(-5_000)).toBe("0s");
  });
});
