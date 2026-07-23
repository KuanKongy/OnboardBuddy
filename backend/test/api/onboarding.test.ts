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

  it("serves receipts with computed staleness, claim and age — not hardcoded values", async () => {
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
      if (text.includes("FROM package_sections")) {
        return {
          rows: [{
            id: "sec-1", type: "start_here", title: "Start Here", content: "body",
            confidence: "high", review_status: "draft", analyzed_commit: "9f4d168",
            reviewed_at: null, reviewed_by: null, reviewed_by_email: null,
            generation_context: {
              claims: [
                { claim: "query() runs SQL", receiptIds: ["bundle-r1"], confidence: "high" },
              ],
            },
            diagrams: [], unknowns: [],
          }],
        };
      }
      if (text.includes("FROM analysis_snapshots") && text.includes("scope_id")) {
        return { rows: [{ id: LATEST_SNAPSHOT }] };
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
              analyzed_at: "2026-07-16T15:40:00Z",
              own_node_hash: "hash-1", latest_node_hash: "hash-1", symbol_summary: "Runs a query.",
            },
            {
              // stale: symbol hash differs in the latest analysis
              id: "sr-2", file_path: "backend/src/api/routes/projects.ts", symbol_name: "POST /",
              line_start: 51, line_end: 144, snippet: "post(", confidence: "high",
              commit_hash: "9f4d168", node_stable_key: "backend/src/api/routes/projects.ts#POST /",
              trust_level: "code", claim: "creates a project", bundle_receipt_id: "bundle-r2",
              analyzed_at: "2026-07-16T15:40:00Z",
              own_node_hash: "hash-2", latest_node_hash: "hash-CHANGED", symbol_summary: null,
            },
            {
              // unknown: doc evidence, nothing to re-verify against
              id: "sr-3", file_path: "README.md", symbol_name: null,
              line_start: 72, line_end: 74, snippet: null, confidence: "medium",
              commit_hash: "9f4d168", node_stable_key: "docnode:doc:README.md#graphs",
              trust_level: "docs", claim: null, bundle_receipt_id: null,
              analyzed_at: "2026-07-16T15:40:00Z",
              own_node_hash: null, latest_node_hash: null, symbol_summary: null,
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
    const receipts = res.body.package.sections[0].blocks[0].receipts;
    expect(receipts).to.have.length(3);

    const [fresh, stale, unknown] = receipts;
    expect(fresh.staleness).to.equal("fresh");
    expect(fresh.claim).to.equal("query() runs SQL"); // legacy claim via generation_context
    expect(fresh.ageLabel).to.match(/^analyzed /);
    expect(fresh.ageLabel).to.not.equal("recent");
    expect(fresh.id).to.equal("sr-1");
    expect(fresh.bundleReceiptId).to.equal("bundle-r1");
    expect(fresh.trustLevel).to.equal("code");
    expect(fresh.commitHash).to.equal("9f4d168");

    expect(stale.staleness).to.equal("stale");
    expect(stale.claim).to.equal("creates a project"); // stored claim wins

    expect(unknown.staleness).to.equal("unknown"); // docs are never a green "Current"
    expect(unknown.claim).to.equal(null);
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
