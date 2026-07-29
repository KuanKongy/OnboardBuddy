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
    expect(workerSrc).to.include("JSON.stringify({ chainedFrom: opts.chainedFrom })");

    // Every call site must thread it — an untouched third one would look fine
    // and produce rows the history cannot pair.
    const callSites = workerSrc.match(/enqueueSummaryGeneration\(\{[\s\S]*?\}\)/g) ?? [];
    expect(callSites, "enqueue call sites found").to.have.length.greaterThan(0);
    for (const site of callSites) expect(site).to.include("chainedFrom: jobId");
  });

  it("leaves the manual /summarize row unchained (absence of the key is what makes it its own row)", () => {
    const inserts = statementsWith("api/routes/projects.ts", "INSERT INTO analysis_jobs", "'generate_package'");
    expect(inserts, "one generate_package insert in the API").to.have.length(1);
    expect(inserts[0]).to.not.include("checkpoint");
  });
});
