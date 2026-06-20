import { expect } from "chai";
import {
  checkReceiptStaleness,
  createStaleFlags,
} from "../../src/worker/engine/sectionValidator.js";
import { mockQuery, resetTestHarness } from "../helpers/testHarness.js";

describe("incremental re-analysis", () => {
  afterEach(() => {
    resetTestHarness();
  });

  it("Changed file hashes are detected between snapshots", async () => {
    mockQuery((text) => {
      if (text.includes("FROM source_receipts sr")) {
        return {
          rows: [{
            receipt_id: "r1",
            section_id: "sec-1",
            node_stable_key: "src/auth.ts",
            node_hash: "old-hash",
            file_path: "src/auth.ts",
          }],
        };
      }
      if (text.includes("SELECT hash FROM graph_nodes")) {
        return { rows: [{ hash: "new-hash" }] };
      }
      return { rows: [] };
    });

    const stale = await checkReceiptStaleness("snap-new", "snap-old");
    expect(stale).to.have.length(1);
    expect(stale[0]!.reason).to.include("hash changed");
  });

  it("Changed symbol hashes identify impacted workflow steps", async () => {
    mockQuery((text) => {
      if (text.includes("FROM source_receipts sr")) {
        return {
          rows: [{
            receipt_id: "r2",
            section_id: "sec-workflow",
            node_stable_key: "src/services/login.ts",
            node_hash: "was-valid",
            file_path: "src/services/login.ts",
          }],
        };
      }
      if (text.includes("SELECT hash FROM graph_nodes")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const stale = await checkReceiptStaleness("snap-new", "snap-old");
    expect(stale[0]!.sectionId).to.equal("sec-workflow");
    expect(stale[0]!.reason).to.include("File removed");
  });

  it("Linked package sections are marked stale after impacted workflow changes", async () => {
    const updates: unknown[][] = [];
    mockQuery((text, params) => {
      if (text.startsWith("INSERT INTO stale_flags")) {
        return { rows: [] };
      }
      if (text.includes("UPDATE package_sections SET review_status = 'stale'")) {
        updates.push(params ?? []);
        return { rows: [] };
      }
      return { rows: [] };
    });

    await createStaleFlags("snap-1", [{
      receiptId: "r3",
      sectionId: "sec-linked",
      reason: "File modified: src/db/userRepo.ts (hash changed)",
    }]);

    expect(updates).to.have.length(1);
    expect(updates[0]![0]).to.equal("sec-linked");
  });

  it("Generated section receipts store stable symbol keys and observed hashes", async () => {
    mockQuery((text) => {
      if (text.includes("FROM source_receipts sr")) {
        return {
          rows: [{
            receipt_id: "r4",
            section_id: "sec-4",
            node_stable_key: "src/utils/crypto.ts",
            node_hash: "same-hash",
            file_path: "src/utils/crypto.ts",
          }],
        };
      }
      if (text.includes("SELECT hash FROM graph_nodes")) {
        return { rows: [{ hash: "same-hash" }] };
      }
      return { rows: [] };
    });

    const stale = await checkReceiptStaleness("snap-new", "snap-old");
    expect(stale).to.have.length(0);
  });

  it("Unchanged sections are not flagged", async () => {
    mockQuery(() => ({ rows: [] }));

    const stale = await checkReceiptStaleness("snap-new", "snap-old");
    expect(stale).to.have.length(0);
  });
});
