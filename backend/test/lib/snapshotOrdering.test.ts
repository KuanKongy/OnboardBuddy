import { expect } from "chai";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  branchRankSql,
  latestSnapshotOrderSql,
  pushedAtSql,
} from "../../src/lib/snapshotOrdering.js";
import { resolvePackageContext } from "../../src/api/services/packageResolver.js";
import { mockQuery, resetTestHarness } from "../helpers/testHarness.js";

const PROJECT_ID = "4b0c28ca-73dd-433a-a2e8-e9fc664df3ec";

describe("snapshotOrdering", () => {
  afterEach(() => resetTestHarness());

  // The bug: "latest" was `ORDER BY analysis_snapshots.created_at DESC`, which
  // is stamped when the run reached persistResults — i.e. it ranks snapshots by
  // which analysis got to RUN first, not by which commit was pushed last. A
  // push that waited in the queue behind other work therefore looked older than
  // one pushed after it.
  it("ranks by when the push was seen (analysis_jobs), not when the snapshot row landed", async () => {
    const order = latestSnapshotOrderSql("s");
    expect(order).to.contain("MIN(pj.created_at)");
    expect(order).to.contain("analysis_jobs pj");
    expect(order).to.contain("pj.job_type IN ('analyze_scope', 'incremental_update')");
    // Push recency must outrank the snapshot's own created_at, which survives
    // only as the last tiebreak for rows whose job row is gone.
    expect(order.indexOf("MIN(pj.created_at)")).to.be.lessThan(order.indexOf("s.created_at DESC"));
    // …and it must fall back to created_at rather than sorting those rows last.
    expect(pushedAtSql("s")).to.contain("COALESCE");

    // The resolver actually emits it.
    let latestQuery = "";
    mockQuery((text) => {
      if (text.includes("FROM analysis_snapshots s")) {
        latestQuery = text;
        return { rows: [] };
      }
      return { rows: [] };
    });
    await resolvePackageContext({ projectId: PROJECT_ID });
    expect(latestQuery, "resolver ran its latest-snapshot query").to.not.equal("");
    expect(latestQuery).to.contain("MIN(pj.created_at)");
    expect(latestQuery).to.not.match(/ORDER BY\s+created_at DESC/i);
  });

  // Branch scoping has to be a preference, not a `WHERE branch = $n`: a scope
  // with nothing analyzed on the asked-for branch must keep serving what it
  // has, not blank every tab.
  it("scopes to a branch without ever emptying the result", async () => {
    const rank = branchRankSql("s", "$2");
    // Caller named no branch -> every row still qualifies.
    expect(rank).to.contain("COALESCE($2, '') = ''");
    // Row predates branch stamping -> it still qualifies.
    expect(rank).to.contain("COALESCE(s.branch, '') = ''");
    // It is an ORDER BY term, so it can only reorder rows, never drop them.
    expect(latestSnapshotOrderSql("s", "$2")).to.contain(`${rank} DESC`);

    let latestQuery = "";
    let latestParams: unknown[] | undefined;
    mockQuery((text, params) => {
      if (text.includes("FROM analysis_snapshots s")) {
        latestQuery = text;
        latestParams = params;
        return { rows: [{ id: "s1", scope_id: null, branch: "main", commit_hash: "abc", status: "complete" }] };
      }
      return { rows: [] };
    });
    const ctx = await resolvePackageContext({ projectId: PROJECT_ID, branch: "branch-never-analyzed" });
    expect(latestParams).to.deep.equal([PROJECT_ID, "branch-never-analyzed"]);
    // No WHERE clause filters on branch, so the safe-degrade path resolves.
    expect(latestQuery).to.not.match(/WHERE[\s\S]*\bs\.branch\s*=/i);
    expect(ctx?.snapshotId).to.equal("s1");
  });

  // The original report was one route, but the idiom was copy-pasted across
  // routes, services and workers. A fix in one place while the others stay
  // stale is not a fix — so no reader may reintroduce the raw ordering.
  it("leaves no latest-snapshot query ordering analysis_snapshots by created_at", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== "__tests__" && entry !== "node_modules") walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
        const src = readFileSync(full, "utf8");
        // Statements that read analysis_snapshots AND order by a bare
        // created_at — the exact shape this module replaced.
        for (const stmt of src.split("`")) {
          if (!/FROM analysis_snapshots/i.test(stmt)) continue;
          if (/ORDER BY\s+(?:[a-z0-9_]+\.)?created_at DESC/i.test(stmt)) {
            offenders.push(`${full}: ${stmt.replace(/\s+/g, " ").trim().slice(0, 110)}`);
          }
        }
      }
    };
    walk(join(import.meta.dirname, "../../src"));
    expect(offenders, `use latestSnapshotOrderSql():\n${offenders.join("\n")}`).to.deep.equal([]);
  });
});
