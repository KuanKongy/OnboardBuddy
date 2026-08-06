import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Run history merges an auto-chained package generation into the analysis that
 * caused it, and `checkpoint->>'chainedFrom'` is the only thing that says which
 * analysis (M5 freezes the schema, so the link rides a checkpoint key the way
 * `sectionType`/`tutorialTitle` do). Lose the key and the UI falls back to
 * timestamp adjacency, which merges pairs that were never a pair — a wrong
 * merge HIDES a run, so nothing about the failure is loud.
 *
 * Read as source text, not executed: `worker/index.ts` constructs its BullMQ
 * consumers at module load (the same reason `worker/runStatus.ts` exists as a
 * separate module), and the manual `/summarize` handler publishes to the queue
 * before it answers — neither statement can run in-process without Redis. The
 * key actually reaching a row is verified live, not here.
 */
const SRC = join(import.meta.dirname, "../../src");

function statementsWith(file: string, ...needles: string[]): string[] {
  return readFileSync(join(SRC, file), "utf8")
    .split("`")
    .filter((stmt) => needles.every((n) => stmt.includes(n)));
}

describe("auto-chained package generation", () => {
  it("stamps the analyze job's id on the generate_package row it enqueues", () => {
    const inserts = statementsWith("worker/index.ts", "INSERT INTO analysis_jobs", "'generate_package'");
    expect(inserts, "one generate_package insert in the worker").to.have.length(1);
    expect(inserts[0]).to.include("checkpoint");

    const workerSrc = readFileSync(join(SRC, "worker/index.ts"), "utf8");
    // The checkpoint is assembled now (it also carries the only-stale flags),
    // so the guard is on the key going in AND on the blob staying NULL when
    // there is nothing to say — an always-`{}` checkpoint would make every
    // unchained generation look like it had a link the reader could follow.
    expect(workerSrc).to.include("checkpoint.chainedFrom = opts.chainedFrom");
    expect(workerSrc).to.include("Object.keys(checkpoint).length > 0 ? JSON.stringify(checkpoint) : null");

    // Every call site must say which kind of generation it is: chained to an
    // analysis (history merges the pair into that analysis's row) or an
    // only-stale rebuild (its own row, its own cost). Neither = a row the
    // history cannot place; both = one run claiming to be two.
    const callSites = workerSrc.match(/enqueueSummaryGeneration\(\{[\s\S]*?\}\)/g) ?? [];
    expect(callSites, "enqueue call sites found").to.have.length.greaterThan(0);
    for (const site of callSites) {
      const chained = site.includes("chainedFrom:");
      const onlyStale = site.includes("onlyStale:");
      expect(chained !== onlyStale, `exactly one of chainedFrom/onlyStale:\n${site}`).to.equal(true);
    }
    // The analysis-chained sites (reuse short-circuit + end of a full run)
    // still stamp the analyze job's own id.
    expect(
      callSites.filter((s) => s.includes("chainedFrom: jobId")),
      "analysis-chained call sites",
    ).to.have.length(2);
  });

  it("leaves the manual /summarize row unchained (absence of the key is what makes it its own row)", () => {
    const inserts = statementsWith("api/routes/projects.ts", "INSERT INTO analysis_jobs", "'generate_package'");
    expect(inserts, "one generate_package insert in the API").to.have.length(1);
    expect(inserts[0]).to.not.include("checkpoint");
  });
});
