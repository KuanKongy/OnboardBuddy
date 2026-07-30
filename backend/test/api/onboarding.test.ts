import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import {
  TEST_PROJECT_ID,
  TEST_USER,
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
} from "../helpers/testHarness.js";

const app = createApp();
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("GET /api/projects/:id/onboarding", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/onboarding`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });

  it("serves receipts with computed staleness, verification, claim and age — not hardcoded values", async () => {
    installTestAuth();
    const LATEST_SNAPSHOT = "aaaaaaaa-0000-0000-0000-00000000000a";
    const OLD_SNAPSHOT = "bbbbbbbb-0000-0000-0000-00000000000b";
    mockQuery((text) => {
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: TEST_PROJECT_ID,
            user_id: TEST_USER.id,
            permission_tier: "developer",
            developer_role: "general",
          }],
        };
      }
      if (text.includes("FROM onboarding_packages")) {
        return {
          rows: [{
            id: "pkg-1", snapshot_id: OLD_SNAPSHOT, scope_id: "scope-1", role: "general",
            status: "draft", analyzed_commit: "9f4d168", branch: "main",
            created_at: "2026-07-17T01:00:00Z", updated_at: "2026-07-17T01:00:00Z",
          }],
        };
      }
      // Coverage aggregate — must be matched before the package_sections
      // branch (its SQL joins package_sections too).
      if (text.includes("tutorial_count")) {
        return {
          rows: [{ tutorial_count: 4, workflows_covered: 16, symbols_cited: 47, files_cited: 31 }],
        };
      }
      if (text.includes("FROM package_sections")) {
        return {
          rows: [{
            id: "sec-1", type: "start_here", title: "Start Here", content: "body",
            confidence: "high", review_status: "draft", analyzed_commit: "9f4d168",
            reviewed_at: null, reviewed_by: null, reviewed_by_email: null,
            generation_context: {
              claims: [
                { claim: "query() runs SQL", receiptIds: ["bundle-r1"], confidence: "high" },
                { claim: "uncited thing", receiptIds: [], confidence: "low" },
              ],
            },
            diagrams: [], unknowns: [],
          }],
        };
      }
      if (text.includes("file_count") && text.includes("FROM analysis_snapshots")) {
        // Deliberately three different numbers, in the ratio real snapshots
        // show: 240 files in scope, 191 of them source in a supported
        // language, 194 actually parsed (the extra 3 are config .ts files,
        // parsed but not categorised as source). The old fixture set
        // in-scope == supported, which hid the distinction the endpoint now
        // has to keep straight.
        return {
          rows: [{
            created_at: "2026-07-16T15:40:00Z", file_count: 240, parsed_file_count: 194,
            symbol_count: 1305, workflow_count: 66,
            language_inventory: { supportedFileCount: 191, unsupportedFileCount: 49 },
          }],
        };
      }
      if (text.includes("FROM analysis_snapshots") && text.includes("scope_id")) {
        return { rows: [{ id: LATEST_SNAPSHOT, commit_hash: "abc9999" }] };
      }
      if (text.includes("FROM source_receipts")) {
        return {
          rows: [
            {
              // fresh: hash unchanged in latest snapshot; claim from legacy context
              id: "sr-1", file_path: "backend/src/lib/db.ts", symbol_name: "query",
              line_start: 23, line_end: 26, snippet: "export function query", confidence: "high",
              commit_hash: "9f4d168", node_stable_key: "backend/src/lib/db.ts#query",
              trust_level: "code", claim: null, bundle_receipt_id: "bundle-r1",
              truncated_from_line_end: null,
              analyzed_at: "2026-07-16T15:40:00Z",
              own_node_hash: "hash-1", own_node_line_start: 20,
              latest_node_hash: "hash-1", latest_node_line_start: 20, latest_node_line_end: 40,
              symbol_summary: "Runs a query.",
            },
            {
              // stale: symbol hash differs in the latest analysis
              id: "sr-2", file_path: "backend/src/api/routes/projects.ts", symbol_name: "POST /",
              line_start: 51, line_end: 144, snippet: "post(", confidence: "high",
              commit_hash: "9f4d168", node_stable_key: "backend/src/api/routes/projects.ts#POST /",
              trust_level: "code", claim: "creates a project", bundle_receipt_id: "bundle-r2",
              truncated_from_line_end: null,
              analyzed_at: "2026-07-16T15:40:00Z",
              own_node_hash: "hash-2", own_node_line_start: 51,
              latest_node_hash: "hash-CHANGED", latest_node_line_start: 60, latest_node_line_end: 150,
              symbol_summary: null,
            },
            {
              // unknown: doc evidence, nothing to re-verify against
              id: "sr-3", file_path: "README.md", symbol_name: null,
              line_start: 72, line_end: 74, snippet: null, confidence: "medium",
              commit_hash: "9f4d168", node_stable_key: "docnode:doc:README.md#graphs",
              trust_level: "docs", claim: null, bundle_receipt_id: null,
              truncated_from_line_end: null,
              analyzed_at: "2026-07-16T15:40:00Z",
              own_node_hash: null, own_node_line_start: null,
              latest_node_hash: null, latest_node_line_start: null, latest_node_line_end: null,
              symbol_summary: null,
            },
            {
              // re-anchored: hash unchanged but the symbol moved down 255 lines
              id: "sr-4", file_path: "backend/src/api/routes/projects.ts", symbol_name: "POST /:id/analyze",
              line_start: 100, line_end: 120, snippet: "post(", confidence: "high",
              commit_hash: "9f4d168", node_stable_key: "backend/src/api/routes/projects.ts#POST /:id/analyze",
              trust_level: "code", claim: null, bundle_receipt_id: null,
              truncated_from_line_end: null,
              analyzed_at: "2026-07-16T15:40:00Z",
              own_node_hash: "hash-4", own_node_line_start: 95,
              latest_node_hash: "hash-4", latest_node_line_start: 350, latest_node_line_end: 420,
              symbol_summary: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/onboarding?role=general`)
      .set(authHeader());
    expect(res.status).to.equal(200);
    const section = res.body.package.sections[0];
    const receipts = section.blocks[0].receipts;
    expect(receipts).to.have.length(4);

    const [fresh, stale, unknown, moved] = receipts;
    expect(fresh.staleness).to.equal("fresh");
    expect(fresh.claim).to.equal("query() runs SQL"); // legacy claim via generation_context
    expect(fresh.ageLabel).to.match(/^analyzed /);
    expect(fresh.ageLabel).to.not.equal("recent");
    expect(fresh.id).to.equal("sr-1");
    expect(fresh.bundleReceiptId).to.equal("bundle-r1");
    expect(fresh.trustLevel).to.equal("code");
    expect(fresh.commitHash).to.equal("9f4d168");
    expect(fresh.verification).to.deep.equal({
      status: "verified", checkedAgainstCommit: "abc9999", lineStart: 23, lineEnd: 26,
    });

    expect(stale.staleness).to.equal("stale");
    expect(stale.claim).to.equal("creates a project"); // stored claim wins
    expect(stale.verification.status).to.equal("changed");
    expect(stale.verification.lineStart).to.equal(60); // where the changed symbol now lives

    expect(unknown.staleness).to.equal("unknown"); // docs are never a green "Current"
    expect(unknown.claim).to.equal(null);
    expect(unknown.verification.status).to.equal("unverifiable");
    expect(unknown.verification.checkedAgainstCommit).to.equal(null);

    expect(moved.staleness).to.equal("fresh");
    expect(moved.verification).to.deep.equal({
      status: "re_anchored", checkedAgainstCommit: "abc9999", lineStart: 355, lineEnd: 375,
    });

    // Confidence arrives with its mechanical reason (audit §3.6).
    expect(section.confidence).to.equal("high");
    expect(section.confidenceReason).to.equal(
      "1/2 tracked claims cite receipts · 1 downgraded to low · 4 receipts",
    );

    // Coverage strip denominators (audit §4.2) — counts, no model output.
    expect(res.body.package.coverage).to.deep.include({
      snapshotCreatedAt: "2026-07-16T15:40:00Z",
      tutorialCount: 4,
    });
    // `parsed` is the honest coverage figure and must NOT be `inScope`: the
    // old response reported in-scope files as "analyzed", overstating real
    // coverage by up to 9x on audited projects.
    expect(res.body.package.coverage.files).to.deep.equal({
      parsed: 194, supported: 191, inScope: 240, unsupported: 49, cited: 31,
    });
    expect(res.body.package.coverage.symbols).to.deep.equal({ total: 1305, cited: 47 });
    expect(res.body.package.coverage.workflows).to.deep.equal({ total: 66, covered: 16 });
    // The ranking claim ships its own derivation: the formula, every signal
    // with its real weight, and what the scale means. The strip used to send
    // bare signal/weight pairs and let the frontend narrate them.
    const ranking = res.body.package.coverage.rankingProvenance;
    expect(ranking.available).to.equal(true);
    expect(ranking.formula).to.contain("snapshot maximum");
    expect(ranking.inputs).to.be.an("array").with.length(9);
    expect(ranking.inputs[0]).to.include({ key: "workflowParticipation", weight: 0.2 });
    expect(ranking.inputs[0].label).to.be.a("string").that.is.not.empty;
    // Weights are served, never restated in the UI, so they cannot drift.
    const total = ranking.inputs.reduce((sum: number, i: { weight: number }) => sum + i.weight, 0);
    expect(total).to.be.closeTo(1, 1e-9);
  });
});

describe("GET /api/projects/:id/onboarding/provenance", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/onboarding/provenance`);
    expect(res.status).to.equal(401);
  });

  it("aggregates models, cost, and per-section generation facts", async () => {
    installTestAuth();
    const PKG = "cccccccc-0000-0000-0000-00000000000c";
    mockQuery((text) => {
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: TEST_PROJECT_ID, user_id: TEST_USER.id,
            permission_tier: "developer", developer_role: "general",
          }],
        };
      }
      if (text.includes("op.id AS package_id")) {
        return {
          rows: [{
            package_id: PKG, snapshot_id: "snap-1", scope_id: "scope-1",
            role: "general", branch: "main", commit_hash: "9f4d168",
          }],
        };
      }
      if (text.includes("semantic_depth")) {
        return {
          rows: [{
            id: PKG, role: "general", analyzed_commit: "9f4d168", branch: "main",
            created_at: "2026-07-17T01:00:00Z", semantic_depth: "standard", privacy_mode: "full_ai",
            snapshot_budget_usage: { llm_calls: 258, input_tokens: 20, output_tokens: 9, estimated_cost_usd: 3.4 },
            budget_overrides: {},
          }],
        };
      }
      // The generation job that built this package, with the per-run budget
      // baseline the enforcer metered from. Must precede the models route:
      // this query also names ai_generation_runs (in a subquery).
      if (text.includes("budgetBaseline")) {
        return {
          rows: [{
            id: "job-gen-1",
            budget_baseline: { llm_calls: 240, input_tokens: 10, output_tokens: 5, estimated_cost_usd: 3 },
            llm_calls: 18,
          }],
        };
      }
      if (text.includes("FROM ai_generation_runs")) {
        return {
          rows: [{
            provider: "openrouter", model: "openai/gpt-4o", model_tier: "strong",
            calls: 15, cached_calls: 3, failed_calls: 0,
            input_tokens: "120000", output_tokens: "25000", cost_usd: "0.55",
          }],
        };
      }
      if (text.includes("FROM package_sections")) {
        return {
          rows: [{
            id: "sec-1", type: "start_here", title: "Start Here", confidence: "high",
            review_status: "draft", receipt_count: 6,
            generation_context: {
              prompt_version: "section-v3",
              retrieval: { seeds: 12, candidates: 40, selected: 18, views: ["operations"] },
              validation: { issues: ["claim names db.ts but cites no receipt from it"], retried: true, hardFailure: false },
              claims: [
                { claim: "a", receiptIds: ["r1"], confidence: "high" },
                { claim: "b", receiptIds: [], confidence: "low" },
              ],
              inline_citations: { resolved: 11, dropped: [], unverified_marked: 1, unverified_unmatched: 0 },
              voice_lint: { remaining_hits: ["seamless"] },
            },
            unknowns: [{ kind: "uncited_claim", detail: "b" }],
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/onboarding/provenance?package_id=${PKG}`)
      .set(authHeader());
    expect(res.status).to.equal(200);
    expect(res.body.package).to.deep.include({
      id: PKG, role: "general", analyzedCommit: "9f4d168",
      semanticDepth: "standard", privacyMode: "full_ai",
    });
    // Budget is reported per run against the cap, with the snapshot's
    // lifetime totals beside it — a package built on an already-expensive
    // snapshot must not read as "over budget".
    expect(res.body.budget).to.deep.equal({
      capLlmCalls: 300, usedThisRun: 18, remaining: 282,
      lifetimeLlmCalls: 258, lifetimeCostUsd: 3.4, jobId: "job-gen-1",
    });
    expect(res.body.models).to.have.length(1);
    expect(res.body.models[0]).to.deep.include({
      model: "openai/gpt-4o", tier: "strong", calls: 15, cachedCalls: 3,
      inputTokens: 120000, outputTokens: 25000, costUsd: 0.55,
    });
    const sec = res.body.sections[0];
    expect(sec).to.deep.include({
      type: "start_here", promptVersion: "section-v3", receiptCount: 6, unknownsCount: 1,
    });
    expect(sec.validation.issues).to.have.length(1);
    expect(sec.validation.retried).to.equal(true);
    expect(sec.voiceLintHits).to.deep.equal(["seamless"]);
    expect(sec.claims).to.deep.equal({ total: 2, cited: 1, low: 1 });
    expect(sec.confidenceReason).to.equal(
      "1/2 tracked claims cite receipts · 1 downgraded to low · 6 receipts",
    );
  });
});

describe("GET /api/projects/:id/onboarding/packages", () => {
  afterEach(resetTestHarness);

  /**
   * #74/B13 rewrote this query — six correlated subqueries became two lateral
   * aggregates, plus a LIMIT. The frontend card grid reads these exact keys, so
   * the shape is the contract; the counts themselves were checked against the
   * live schema (old and new forms return identical rows for all 13 packages).
   */
  it("keeps the card-grid response shape, and caps the list", async () => {
    installTestAuth();
    let packagesSql = "";
    mockQuery((text) => {
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: TEST_PROJECT_ID, user_id: TEST_USER.id,
            permission_tier: "developer", developer_role: "general", default_package_id: null,
          }],
        };
      }
      if (text.includes("FROM onboarding_packages op")) {
        packagesSql = text;
        return {
          rows: [{
            id: "pkg-1", snapshot_id: "snap-1", role: "general", status: "complete",
            analyzed_commit: "abc", branch: "main", created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-02T00:00:00Z", scope_name: "Whole repository",
            path_prefix: "", scope_kind: "repo", semantic_depth: "standard",
            privacy_mode: "full_ai", section_count: 12, stale_sections: 1,
            approved_sections: 2, low_confidence_sections: 3, tutorial_count: 6,
            is_latest_commit: true,
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/onboarding/packages`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.packages).to.have.length(1);
    expect(res.body.packages[0]).to.include({
      section_count: 12, stale_sections: 1, approved_sections: 2,
      low_confidence_sections: 3, tutorial_count: 6, is_latest_commit: true,
    });
    expect(packagesSql).to.match(/LIMIT 100/);
    // The rollups come from laterals now; a correlated subquery creeping back in
    // is the regression this pins.
    expect(packagesSql).to.include("LEFT JOIN LATERAL");
    expect(packagesSql).to.not.include("SELECT count(*)::int FROM package_sections");
  });
});

describe("GET /api/projects/:id/onboarding/export", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/onboarding/export?role=general`);
    expect(res.status).to.equal(401);
  });
});

describe("GET /api/projects/:id/onboarding/sections/:sectionId/receipts", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/onboarding/sections/some-id/receipts`);
    expect(res.status).to.equal(401);
  });
});

describe("GET /api/projects/:id/onboarding/validate", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/onboarding/validate`);
    expect(res.status).to.equal(401);
  });
});

describe("PATCH /api/projects/:id/onboarding/sections/:sectionId/review", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/onboarding/sections/some-id/review`)
      .send({ review_status: "approved" });
    expect(res.status).to.equal(401);
  });
});
