import { expect } from "chai";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  branchRankSql,
  latestSnapshotOrderSql,
  pushedAtSql,
  wantedBranchSql,
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
    // It is an ORDER BY term, so it can only reorder rows, never drop them —
    // and an unspecified branch falls back to the project's own default.
    const order = latestSnapshotOrderSql("s", "$2");
    expect(order).to.contain(`${branchRankSql("s", wantedBranchSql("s", "$2"))} DESC`);
    expect(order).to.contain("SELECT pb.branch FROM projects pb");

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
    // Branch appears only in ORDER BY, never in WHERE — so asking for a branch
    // nobody analyzed still resolves instead of returning nothing.
    const whereClause = latestQuery.slice(
      latestQuery.search(/\bWHERE\b/i),
      latestQuery.search(/\bORDER BY\b/i),
    );
    expect(whereClause).to.not.match(/\bbranch\b/i);
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
        for (const stmt of src.split("`")) {
          // Every alias analysis_snapshots is bound to in this statement.
          const aliases = [...stmt.matchAll(/\b(?:FROM|JOIN)\s+analysis_snapshots(?:\s+(?!ON\b|WHERE\b)([a-z0-9_]+))?/gi)]
            .map((m) => m[1] ?? "analysis_snapshots");
          if (aliases.length === 0) continue;
          // The banned shape: created_at as the FIRST sort key of a snapshot
          // relation. latestSnapshotOrderSql keeps `<alias>.created_at DESC`
          // as its LAST tiebreak, which is fine — only leading it is the bug.
          for (const alias of aliases) {
            const leading = new RegExp(
              `ORDER BY\\s+(?:${alias}\\.)?created_at DESC`, "i",
            );
            if (leading.test(stmt)) {
              offenders.push(`${full}: ${stmt.replace(/\s+/g, " ").trim().slice(0, 110)}`);
              break;
            }
          }
        }
      }
    };
    walk(join(import.meta.dirname, "../../src"));
    expect(offenders, `use latestSnapshotOrderSql():\n${offenders.join("\n")}`).to.deep.equal([]);
  });
});
