import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPreviousSnapshot, flagStaleArtifacts } from "../../src/worker/incrementalAnalyzer.js";
import { mockQuery, resetTestHarness } from "../helpers/testHarness.js";

/**
 * Branch scoping of the incremental diff. Both halves used to be branch-blind:
 * the baseline was "the previous snapshot of this scope" and the staleness it
 * produced hit "every package of this scope". Analyzing a feature branch
 * therefore diffed it against main, called every commit main lacked a change,
 * and marked MAIN's package stale for work that never touched it — a wrong
 * stale badge on the package everyone reads, produced by an analysis of a
 * branch nobody had opened yet.
 *
 * Neither half is visible in a green pipeline run: the diff still completes,
 * the counts still look plausible, and only the branch column says the flags
 * landed on the wrong package. Hence a test on the SQL and on the rows it acts
 * against, plus a source guard on the call sites — passing the branch is what
 * makes the parameters mean anything.
 */
const SRC = join(import.meta.dirname, "../../src");

const PACKAGE_BRANCH = "main";
/** Param index of the branch bind in each query ($9 / $5, asserted below). */
const SECTIONS_BRANCH_PARAM = 8;
const TUTORIALS_BRANCH_PARAM = 4;

interface Recorded { text: string; params: unknown[] }

/**
 * A DB holding ONE package, on `main`, with one stale-able section and one
 * stale-able tutorial. The section/tutorial queries return it only when the
 * caller's branch bind matches — i.e. the fixture answers the way Postgres
 * would with the `op.branch = $n` filter in place.
 */
function fixtureDb(): Recorded[] {
  const statements: Recorded[] = [];
  mockQuery((text, params = []) => {
    statements.push({ text, params });
    if (text.includes("FROM package_sections ps")) {
      return {
        rows: params[SECTIONS_BRANCH_PARAM] === PACKAGE_BRANCH
          ? [{ id: "sec-1", type: "big_picture", role: "general", package_id: "pkg-main" }]
          : [],
      };
    }
    if (text.includes("FROM tutorials t")) {
      return {
        rows: params[TUTORIALS_BRANCH_PARAM] === PACKAGE_BRANCH
          ? [{ id: "tut-1", stable_key: "tut:login", package_id: "pkg-main" }]
          : [],
      };
    }
    return { rows: [] };
  });
  return statements;
}

const diffParams = (branch: string) => ({
  projectId: "proj-1",
  scopeId: "scope-1",
  branch,
  newSnapshotId: "snap-new",
  newCommit: "cccc",
  changedFilePaths: ["src/auth.ts"],
  changedSymbolKeys: ["src/auth.ts#login"],
  invalidatedRecordIds: [],
});

describe("incremental diff branch scoping", () => {
  afterEach(() => {
    resetTestHarness();
  });

  it("hard-filters the diff baseline to the branch, and returns null when the branch has none", async () => {
    let seen: Recorded | undefined;
    mockQuery((text, params = []) => {
      seen = { text, params };
      return { rows: [] };
    });

    const previous = await findPreviousSnapshot("scope-1", "snap-new", "feature/x");

    // Empty is not a failure: it means "first analysis of this branch", which
    // the caller turns into a full generation rather than a diff.
    expect(previous).to.equal(null);
    expect(seen?.text, "baseline is branch-hard, not branch-preferring").to.include("s.branch = $3");
    expect(seen?.params[2]).to.equal("feature/x");
  });

  it("cannot stale another branch's package", async () => {
    const statements = fixtureDb();

    const result = await flagStaleArtifacts(diffParams("feature/x"));

    expect(result.staleSections).to.equal(0);
    expect(result.staleTutorials).to.equal(0);
    expect(result.stalePackages).to.equal(0);
    expect(result.stalePackageIds).to.deep.equal([]);
    // Nothing was written at all — no flags, no status changes on main's rows.
    const writes = statements.filter((s) => /^\s*(UPDATE|INSERT)/.test(s.text));
    expect(writes.map((w) => w.text.trim().slice(0, 40)), "no writes for a foreign branch").to.deep.equal([]);
  });

  it("still stales sections, tutorials and the package on the analyzed branch", async () => {
    const statements = fixtureDb();

    const result = await flagStaleArtifacts(diffParams(PACKAGE_BRANCH));

    expect(result.staleSections).to.equal(1);
    expect(result.staleTutorials).to.equal(1);
    expect(result.stalePackages).to.equal(1);
    expect(result.stalePackageIds).to.deep.equal(["pkg-main"]);

    // The branch bind sits where the fixture reads it — if these move, the two
    // tests above stop testing anything.
    expect(statements.find((s) => s.text.includes("FROM package_sections ps"))?.text)
      .to.include("op.branch = $9");
    expect(statements.find((s) => s.text.includes("FROM tutorials t"))?.text)
      .to.include("op.branch = $5");

    const writes = statements.map((s) => s.text.replace(/\s+/g, " ").trim());
    expect(writes.some((t) => t.startsWith("UPDATE package_sections SET review_status = 'stale'"))).to.equal(true);
    expect(writes.some((t) => t.startsWith("UPDATE tutorials SET status = 'stale'"))).to.equal(true);
    expect(writes.some((t) => t.startsWith("UPDATE onboarding_packages SET status = 'stale'"))).to.equal(true);
  });

  it("passes the analyzed branch from the worker into both halves", () => {
    // Source text, not execution: worker/index.ts constructs BullMQ consumers
    // at module load, so importing it here would open a Redis connection
    // (the same reason worker/chainedGeneration.test.ts reads source).
    const workerSrc = readFileSync(join(SRC, "worker/index.ts"), "utf8");

    const baselineCalls = workerSrc.match(/findPreviousSnapshot\([^)]*\)/g) ?? [];
    expect(baselineCalls, "baseline call sites").to.have.length(1);
    expect(baselineCalls[0]).to.equal("findPreviousSnapshot(scope.scopeId, snapshotId, branch)");

    const diffCall = workerSrc.match(/runIncrementalDiff\(\{[\s\S]*?\}\)/)?.[0] ?? "";
    expect(diffCall, "runIncrementalDiff call site").to.not.equal("");
    expect(diffCall, "the diff is told which branch it describes").to.match(/^\s*branch,\s*$/m);
  });
});
