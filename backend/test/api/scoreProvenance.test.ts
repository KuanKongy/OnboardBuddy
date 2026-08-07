import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import {
  buildCandidateProvenance,
  buildMeanProvenance,
  buildWeightTableProvenance,
  type ScoreProvenanceAvailable,
} from "../../src/api/services/scoreProvenance.js";
import { CANDIDATE_WEIGHTS } from "../../src/worker/engine/candidateRanker.js";
import {
  TEST_PROJECT_ID,
  TEST_USER,
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
} from "../helpers/testHarness.js";

const app = createApp();

/** Exactly what `persistCandidateRankings` writes into score_breakdown. */
const STORED_BREAKDOWN = {
  normalized: {
    workflowParticipation: 1, fanCentrality: 0.44, exportedSurface: 0.15,
    sideEffects: 0.75, entrypointParticipation: 1, routeSchemaOwnership: 1,
    testProximity: 0, configRelevance: 0, churn: 0.25,
  },
  raw: {
    workflowParticipation: 4, fanCentrality: 11, exportedSurface: 3,
    sideEffects: 3, entrypointParticipation: 1, routeSchemaOwnership: 1,
    testProximity: 0, configRelevance: 0, churn: 3,
  },
};

const memberRow = (project = TEST_PROJECT_ID) => ({
  project_id: project,
  user_id: TEST_USER.id,
  permission_tier: "developer",
  developer_role: "general",
});

describe("score provenance", () => {
  describe("buildCandidateProvenance", () => {
    it("reproduces the ranker's arithmetic from the stored row", () => {
      const p = buildCandidateProvenance({
        label: "Importance",
        score: 0.6135,
        breakdown: STORED_BREAKDOWN,
        reasons: ["Handles a route"],
        targetType: "file",
      }) as ScoreProvenanceAvailable;

      expect(p.available).to.equal(true);
      expect(p.inputs).to.have.length(9);
      // Biggest contributor first, so a truncated tooltip truncates the least
      // important end of the list.
      expect(p.inputs[0]).to.include({ key: "workflowParticipation", weight: 0.2, value: 1 });
      expect(p.inputs[0]!.contribution).to.be.closeTo(0.2, 1e-9);
      // The weighted sum of the parts is the score the row stores.
      const summed = p.inputs.reduce((sum, i) => sum + (i.contribution ?? 0), 0);
      expect(summed).to.be.closeTo(0.6135, 1e-9);
      expect(p.reasons).to.deep.equal(["Handles a route"]);
    });

    it("words each raw value as the thing it counted", () => {
      const p = buildCandidateProvenance({
        label: "Importance", score: 0.6135, breakdown: STORED_BREAKDOWN, targetType: "file",
      }) as ScoreProvenanceAvailable;
      const measured = Object.fromEntries(p.inputs.map((i) => [i.key, i.measured]));

      expect(measured.workflowParticipation).to.equal("in 4 traced workflows");
      expect(measured.sideEffects).to.equal("3 kinds of side effect");
      expect(measured.testProximity).to.equal("no test references it");
      expect(measured.churn).to.equal("3 commits in 90 days");
    });

    it("relabels the slots a workflow row reuses for other quantities", () => {
      const p = buildCandidateProvenance({
        label: "Criticality",
        score: 0.5,
        breakdown: { normalized: { workflowParticipation: 1 }, raw: { workflowParticipation: 0.82 } },
        targetType: "workflow",
      }) as ScoreProvenanceAvailable;

      // On a workflow this slot holds the flow's own importance, not a count of
      // workflows it participates in — labelling it the latter would be a lie
      // in the place a reader is most likely to check.
      expect(p.inputs[0]!.label).to.equal("Flow importance (tier + trigger)");
      expect(p.inputs[0]!.measured).to.equal("importance 0.82");
    });

    it("says which signals a flow cannot earn, and where that caps its score", () => {
      const p = buildCandidateProvenance({
        label: "Criticality",
        score: 0.45,
        breakdown: {
          normalized: {
            workflowParticipation: 1, sideEffects: 0.5, entrypointParticipation: 1,
            routeSchemaOwnership: 1, fanCentrality: 0, exportedSurface: 0,
            testProximity: 0, configRelevance: 0, churn: 0,
          },
          raw: {
            workflowParticipation: 0.9, sideEffects: 1, entrypointParticipation: 1,
            routeSchemaOwnership: 1, churn: 12,
          },
        },
        targetType: "workflow",
      }) as ScoreProvenanceAvailable;
      const measured = Object.fromEntries(p.inputs.map((i) => [i.key, i.measured]));

      // Only two signals genuinely cannot apply: a flow is a path through the
      // import graph, so it has no importers and exports nothing.
      expect(measured.fanCentrality).to.equal("not measured for flows");
      expect(measured.exportedSurface).to.equal("not measured for flows");

      // churn, testProximity and configRelevance used to be lumped in with
      // them, which cost every flow 15% of the weight for signals that are
      // perfectly measurable on a flow. They are computed now, so the copy
      // must not claim otherwise.
      expect(measured.churn).to.not.equal("not measured for flows");

      // And no ceiling: excluding inapplicable signals from the DENOMINATOR
      // rather than scoring them zero is what lets a flow reach 100. A caveat
      // quoting a maximum below 100 would be describing the old arithmetic.
      expect(p.caveat ?? "").to.not.match(/\b(55|tops out)\b/);
      expect(p.scaleNote).to.contain("100 would mean leading");

      // The lever must never point at a signal no change to the repo could move.
      expect(p.lever).to.not.contain("centrality");
      expect(p.lever).to.contain("side-effect breadth");
    });

    it("names the heaviest missing signal as the lever", () => {
      const p = buildCandidateProvenance({
        label: "Importance",
        score: 0,
        breakdown: { normalized: { workflowParticipation: 0, fanCentrality: 0 }, raw: {} },
        targetType: "file",
      }) as ScoreProvenanceAvailable;

      expect(p.lever).to.contain("workflow participation");
      expect(p.lever).to.contain("20 points");
    });

    it("reports unavailable rather than guessing when nothing was stored", () => {
      for (const breakdown of [null, undefined, {}, "{}", { raw: { churn: 1 } }, { normalized: {} }]) {
        const p = buildCandidateProvenance({
          label: "Importance", score: 0.4, breakdown, targetType: "file",
        });
        expect(p.available, JSON.stringify(breakdown)).to.equal(false);
        if (!p.available) expect(p.reason).to.be.a("string").that.is.not.empty;
      }
    });
  });

  describe("buildMeanProvenance", () => {
    const members = [
      { key: "a.ts", name: "a.ts", filePath: "a.ts", score: 0.7 },
      { key: "b.ts", name: "b.ts", filePath: "b.ts", score: 0.4 },
      { key: "c.ts", name: "c.ts", filePath: "c.ts", score: 0.1 },
    ];

    it("states the mean, its members, and each member's share of it", () => {
      const p = buildMeanProvenance({
        label: "Criticality", score: 0.4, scoredMembers: members,
        totalMemberCount: 3, memberNoun: "file",
      }) as ScoreProvenanceAvailable;

      expect(p.method).to.equal("member_mean");
      expect(p.formula).to.equal("component score = mean of its 3 scored files");
      expect(p.inputs[0]).to.include({ key: "a.ts", weight: null, value: 0.7 });
      expect(p.inputs[0]!.contribution).to.be.closeTo(0.7 / 3, 1e-9);
      expect(p.reasons[1]).to.equal("Top member a.ts scores 70");
      expect(p.caveat).to.equal(null);
    });

    it("says so when the listed members do not reproduce the stored number", () => {
      // Persistence keeps the top 500 candidate scores per snapshot, so a big
      // component's stored mean can cover members whose rows are gone. The two
      // numbers must not be presented as if they agree.
      const p = buildMeanProvenance({
        label: "Criticality", score: 0.25, scoredMembers: members,
        totalMemberCount: 40, memberNoun: "file",
      }) as ScoreProvenanceAvailable;

      expect(p.caveat).to.contain("40 members");
      expect(p.caveat).to.contain("25");
    });

    it("counts the unranked members when the mean itself is intact", () => {
      const p = buildMeanProvenance({
        label: "Criticality", score: 0.4, scoredMembers: members,
        totalMemberCount: 9, memberNoun: "file",
      }) as ScoreProvenanceAvailable;

      expect(p.caveat).to.contain("3 of 9 members carry a score");
    });

    it("refuses to derive anything when no member has a score", () => {
      const p = buildMeanProvenance({
        label: "Criticality", score: 0, scoredMembers: [],
        totalMemberCount: 31, memberNoun: "file",
      });

      expect(p.available).to.equal(false);
      if (!p.available) expect(p.reason).to.contain("31 members");
    });
  });

  describe("buildWeightTableProvenance", () => {
    it("serves the ranker's own weights, so the UI cannot drift from them", () => {
      const p = buildWeightTableProvenance();
      const served = Object.fromEntries(p.inputs.map((i) => [i.key, i.weight]));

      expect(served).to.deep.equal(CANDIDATE_WEIGHTS);
      // Values are deliberately absent: a weight table describes no target.
      expect(p.inputs.every((i) => i.value === null && i.contribution === null)).to.equal(true);
      expect(p.scaleNote).to.contain("Phase A");
    });
  });
});

describe("GET /api/projects/:id/graph/architecture — cluster score derivation", () => {
  afterEach(resetTestHarness);

  it("explains a cluster score as the mean of the member scores it averaged", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow()] };
      if (text.includes("FROM analysis_snapshots")) {
        return { rows: [{ id: "snap-1", scope_id: "scope-1", branch: "main", commit_hash: "abc1234" }] };
      }
      if (text.includes("FROM onboarding_packages")) return { rows: [] };
      if (text.includes("FROM architecture_clusters WHERE")) {
        return {
          rows: [{
            id: "c1", stable_key: "cluster:backend/api-routes", label: "Backend · API Routes",
            kind: "api_layer", critical_score: 0.4, deterministic_summary: "3 files.",
            metadata: { fileCount: 3, primaryMemberNoun: "file" },
          }],
        };
      }
      if (text.includes("FROM architecture_edges")) return { rows: [] };
      if (text.includes("FROM architecture_cluster_members")) {
        return {
          rows: [
            { cluster_key: "cluster:backend/api-routes", member_key: "src/routes/auth.ts", name: "auth.ts", file_path: "src/routes/auth.ts" },
            { cluster_key: "cluster:backend/api-routes", member_key: "src/routes/projects.ts", name: "projects.ts", file_path: "src/routes/projects.ts" },
            { cluster_key: "cluster:backend/api-routes", member_key: "src/routes/health.ts", name: "health.ts", file_path: "src/routes/health.ts" },
          ],
        };
      }
      if (text.includes("record_level = 'module'")) return { rows: [] };
      if (text.includes("FROM criticality_scores")) {
        return {
          rows: [
            { stable_key: "src/routes/auth.ts", score: 0.7 },
            { stable_key: "src/routes/projects.ts", score: 0.4 },
            { stable_key: "src/routes/health.ts", score: 0.1 },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/graph/architecture`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    const cluster = res.body.clusters[0];
    expect(cluster.criticalScore).to.equal(0.4);
    expect(cluster.provenance.available).to.equal(true);
    expect(cluster.provenance.method).to.equal("member_mean");
    expect(cluster.provenance.formula).to.equal("component score = mean of its 3 scored files");
    expect(cluster.provenance.inputs.map((i: { key: string }) => i.key)).to.deep.equal([
      "src/routes/auth.ts", "src/routes/projects.ts", "src/routes/health.ts",
    ]);
    expect(cluster.provenance.caveat).to.equal(null);
  });

  it("says the derivation is unavailable when no member carries a score", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow()] };
      if (text.includes("FROM analysis_snapshots")) {
        return { rows: [{ id: "snap-1", scope_id: "scope-1", branch: "main", commit_hash: "abc1234" }] };
      }
      if (text.includes("FROM onboarding_packages")) return { rows: [] };
      if (text.includes("FROM architecture_clusters WHERE")) {
        return {
          rows: [{
            id: "c2", stable_key: "cluster:tests", label: "Tests", kind: "test_layer",
            critical_score: 0, deterministic_summary: "2 files.",
            metadata: { fileCount: 2, primaryMemberNoun: "file" },
          }],
        };
      }
      if (text.includes("FROM architecture_cluster_members")) {
        return {
          rows: [
            { cluster_key: "cluster:tests", member_key: "test/a.test.ts", name: "a.test.ts", file_path: "test/a.test.ts" },
            { cluster_key: "cluster:tests", member_key: "test/b.test.ts", name: "b.test.ts", file_path: "test/b.test.ts" },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/graph/architecture`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    // Test files are excluded from ranking, so this cluster's 0 is a floor
    // rather than a measurement — and the response says exactly that instead of
    // manufacturing a breakdown for it.
    expect(res.body.clusters[0].provenance.available).to.equal(false);
    expect(res.body.clusters[0].provenance.reason).to.contain("2 members");
    expect(res.body.clusters[0].provenance).to.not.have.property("inputs");
  });
});

describe("GET /api/projects/:id/workflows — flow score derivation", () => {
  afterEach(resetTestHarness);

  const workflowRow = (over: Record<string, unknown> = {}) => ({
    id: "wf-1", title: "POST /api/auth/login", trigger_type: "http_route",
    purpose: "Signs a user in.", importance_score: 0.82, confidence: "high",
    tier: "core", composite_score: 0.61, step_count: 6,
    reasons: ["Core user flow (http_route)"],
    score_breakdown: STORED_BREAKDOWN, has_candidate_score: true,
    realizes_capability: true,
    ...over,
  });

  it("returns the flow's signal breakdown and the rail's real sort order", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow()] };
      if (text.includes("FROM analysis_snapshots")) {
        return { rows: [{ id: "snap-1", scope_id: "scope-1", branch: "main", commit_hash: "abc1234" }] };
      }
      if (text.includes("FROM onboarding_packages")) return { rows: [] };
      if (text.includes("FROM workflows w")) return { rows: [workflowRow()] };
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/workflows`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    const wf = res.body.workflows[0];
    expect(wf.provenance.available).to.equal(true);
    expect(wf.provenance.inputs).to.have.length(9);
    // The raw breakdown is replaced by the derivation, so there is exactly one
    // description of the score in the payload.
    expect(wf).to.not.have.property("score_breakdown");
    expect(wf).to.not.have.property("has_candidate_score");
    // The list's order is a tier decision before it is a score decision; the
    // rail's tooltip says so from here rather than guessing.
    expect(res.body.ordering.summary).to.contain("Tier first");
    expect(res.body.ordering.steps).to.be.an("array").that.is.not.empty;
  });

  it("flags a flow whose number is the extractor's importance score, not a ranked one", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow()] };
      if (text.includes("FROM analysis_snapshots")) {
        return { rows: [{ id: "snap-1", scope_id: "scope-1", branch: "main", commit_hash: "abc1234" }] };
      }
      if (text.includes("FROM onboarding_packages")) return { rows: [] };
      if (text.includes("FROM workflows w")) {
        return { rows: [workflowRow({ score_breakdown: null, has_candidate_score: false, composite_score: 0.82 })] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/workflows`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.workflows[0].provenance.available).to.equal(false);
    expect(res.body.workflows[0].provenance.reason).to.contain("extractor's own importance score");
  });
});
