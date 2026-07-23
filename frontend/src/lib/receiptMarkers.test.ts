import { describe, expect, it } from "vitest";
import { receiptForHref, receiptNumberById, renderReceiptMarkers } from "./receiptMarkers";
import type { SourceReceipt } from "@/types/onboarding";

const receipt = (bundleReceiptId: string | null, filePath: string): SourceReceipt => ({
  bundleReceiptId,
  filePath,
  staleness: "fresh",
  confidence: "high",
  ageLabel: "analyzed today",
});

const receipts = [
  receipt("uuid-a", "backend/src/lib/db.ts"),
  receipt(null, "README.md"),
  receipt("uuid-b", "backend/src/worker/index.ts"),
];

describe("receiptNumberById", () => {
  it("numbers receipts by list position (1-based), skipping ones without bundle ids", () => {
    const map = receiptNumberById(receipts);
    expect(map.get("uuid-a")).toBe(1);
    expect(map.get("uuid-b")).toBe(3);
    expect(map.size).toBe(2);
  });
});

describe("renderReceiptMarkers", () => {
  it("turns resolvable markers into numbered receipt links", () => {
    expect(
      renderReceiptMarkers("Queries run here [[receipt:uuid-a]].", receipts),
    ).toBe("Queries run here [1](#receipt:uuid-a).");
  });

  it("drops markers for receipts the API did not serve", () => {
    expect(
      renderReceiptMarkers("Ghost citation [[receipt:uuid-ghost]].", receipts),
    ).toBe("Ghost citation.");
  });

  it("handles adjacent markers", () => {
    expect(
      renderReceiptMarkers("Both [[receipt:uuid-a]][[receipt:uuid-b]] agree.", receipts),
    ).toBe("Both [1](#receipt:uuid-a)[3](#receipt:uuid-b) agree.");
  });

  it("leaves plain text and normal links untouched", () => {
    const text = "See [the docs](https://example.com) and `code`.";
    expect(renderReceiptMarkers(text, receipts)).toBe(text);
  });

  it("turns unverified spans into #unverified links for the dotted-underline render", () => {
    expect(
      renderReceiptMarkers("[[unverified]]The queue retries forever.[[/unverified]]", receipts),
    ).toBe("[The queue retries forever.](#unverified)");
  });

  it("unwraps unverified spans whose text would nest brackets", () => {
    expect(
      renderReceiptMarkers("[[unverified]]see [note] here[[/unverified]]", receipts),
    ).toBe("see [note] here");
  });
});

describe("receiptForHref", () => {
  it("resolves #receipt: hrefs to the served receipt", () => {
    expect(receiptForHref("#receipt:uuid-b", receipts)?.filePath).toBe(
      "backend/src/worker/index.ts",
    );
  });

  it("returns null for normal hrefs and unknown ids", () => {
    expect(receiptForHref("https://example.com", receipts)).toBeNull();
    expect(receiptForHref("#receipt:nope", receipts)).toBeNull();
    expect(receiptForHref(undefined, receipts)).toBeNull();
  });
});
