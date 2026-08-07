import { expect } from "chai";
import { prepareAnalysisRun, type TxClient } from "../../src/api/services/analysisStarter.js";

/** Recording fake for the transactional client — no pool, no DB. */
function fakeClient(handler: (text: string, params?: unknown[]) => { rows: unknown[] }) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const client: TxClient = {
    query: async (text, params) => {
      calls.push({ text, params });
      return handler(text, params);
    },
  };
  return { client, calls };
}

const BASE = {
  projectId: "p1",
  requestedBy: "u1",
  projectDefaultBranch: "main",
};

describe("prepareAnalysisRun", () => {
  it("rejects a scope that doesn't belong to the project", async () => {
    const { client } = fakeClient((text) => {
      if (text.includes("FROM analysis_scopes")) return { rows: [] };
      return { rows: [] };
    });
    const result = await prepareAnalysisRun(client, { ...BASE, scopeId: "scope-x" });
    expect(result).to.deep.equal({ ok: false, reason: "scope_not_found" });
  });

  it("picks incremental_update when a complete snapshot exists, analyze_scope otherwise", async () => {
    for (const [hasSnapshot, expected] of [[true, "incremental_update"], [false, "analyze_scope"]] as const) {
      const { client } = fakeClient((text) => {
        if (text.includes("FROM analysis_snapshots")) return { rows: hasSnapshot ? [{ "?column?": 1 }] : [] };
        if (text.includes("FROM analysis_jobs") && text.includes("status IN")) return { rows: [] };
        if (text.startsWith("INSERT INTO analysis_jobs")) return { rows: [{ id: "job-1", status: "queued" }] };
        return { rows: [] };
      });
      const result = await prepareAnalysisRun(client, { ...BASE, branch: "main", commit: "abc" });
      expect(result.ok).to.equal(true);
      if (result.ok) expect(result.jobType).to.equal(expected);
    }
  });

  it("returns the active twin instead of inserting a duplicate", async () => {
    const { client, calls } = fakeClient((text) => {
      if (text.includes("FROM analysis_snapshots")) return { rows: [] };
      if (text.includes("FROM analysis_jobs")) return { rows: [{ id: "job-active" }] };
      return { rows: [] };
    });
    const result = await prepareAnalysisRun(client, { ...BASE, commit: "abc" });
    expect(result).to.deep.equal({ ok: false, reason: "active_twin", activeJobId: "job-active" });
    expect(calls.some((c) => c.text.startsWith("INSERT"))).to.equal(false);
  });

  it("inserts the job with the requester and effective branch", async () => {
    let insertParams: unknown[] | undefined;
    const { client } = fakeClient((text, params) => {
      if (text.includes("FROM analysis_snapshots")) return { rows: [] };
      if (text.includes("FROM analysis_jobs") && !text.startsWith("INSERT")) return { rows: [] };
      if (text.startsWith("INSERT INTO analysis_jobs")) {
        insertParams = params;
        return { rows: [{ id: "job-2", status: "queued" }] };
      }
      return { rows: [] };
    });
    const result = await prepareAnalysisRun(client, {
      ...BASE,
      requestedBy: "webhook-owner",
      scopeId: null,
      branch: null, // no explicit branch → falls back to the project default
      commit: "c0ffee1234",
    });
    expect(result.ok).to.equal(true);
    // (project, scope, requested_by, job_type, role, branch, commit, depth, checkpoint)
    expect(insertParams![2]).to.equal("webhook-owner");
    expect(insertParams![5]).to.equal("main");
    expect(insertParams![6]).to.equal("c0ffee1234");
  });

  /**
   * The commit subject rides `checkpoint` because M5 freezes the schema. Two
   * things can go wrong silently: a run started without a message writing
   * `null` into a NOT NULL column (every analysis 500s), and the webhook's
   * `head_commit.message` — full body, unbounded — landing verbatim on a row
   * that the packages list reads back for every card.
   */
  it("stamps the capped commit subject on the job checkpoint, and '{}' when there is none", async () => {
    const insertFor = async (commitMessage?: string | null) => {
      let insertParams: unknown[] | undefined;
      const { client } = fakeClient((text, params) => {
        if (text.includes("FROM analysis_snapshots")) return { rows: [] };
        if (text.includes("FROM analysis_jobs") && !text.startsWith("INSERT")) return { rows: [] };
        if (text.startsWith("INSERT INTO analysis_jobs")) {
          insertParams = params;
          return { rows: [{ id: "job-3", status: "queued" }] };
        }
        return { rows: [] };
      });
      const result = await prepareAnalysisRun(client, { ...BASE, commit: "abc", commitMessage });
      expect(result.ok).to.equal(true);
      return insertParams![8];
    };

    expect(await insertFor("Fix the webhook HEAD check")).to.equal(
      JSON.stringify({ commitMessage: "Fix the webhook HEAD check" }),
    );
    // Subject only, capped: a GitHub push payload carries the whole message.
    const long = await insertFor(`Fix the guard\n\nLong body explaining why.\n${"x".repeat(400)}`);
    expect(JSON.parse(String(long))).to.deep.equal({ commitMessage: "Fix the guard" });
    const capped = JSON.parse(String(await insertFor("y".repeat(500)))) as { commitMessage: string };
    expect(capped.commitMessage).to.have.length(200);

    // No message = an empty object, never NULL (the column is NOT NULL) and
    // never a `commitMessage` key the packages list would read back as "".
    expect(await insertFor()).to.equal("{}");
    expect(await insertFor(null)).to.equal("{}");
    expect(await insertFor("\n\n")).to.equal("{}");
  });
});
