import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import {
  TEST_USER,
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
} from "../helpers/testHarness.js";

/**
 * Bug #65 — child objects addressed by their own id only.
 *
 * `requireProjectAccess` proves the caller manages the project *in the path*.
 * It cannot prove the child in the path belongs to that project, so every
 * child lookup has to join through its parent and filter on the project id
 * itself. These tests drive the boundary from the outside: the caller owns
 * project A and passes a child id that lives in project B.
 *
 * The fake database below is deliberately hostile — it answers any *unscoped*
 * lookup with project B's row. A route that forgets the join therefore gets a
 * 200 and leaks (or writes) across the tenant boundary, which is exactly the
 * failure these assertions have to catch.
 */
const app = createApp();

const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FOREIGN_SECTION = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FOREIGN_WORKFLOW = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const FOREIGN_MEMBER = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SECRET_SNIPPET = "const STRIPE_SECRET = process.env.STRIPE_SECRET;";

/** Every statement the route executed, so a write can be proven absent. */
let executed: Array<{ text: string; params: unknown[] }> = [];

function scopedToProjectA(params: unknown[]): boolean {
  return params.includes(PROJECT_A);
}

/**
 * A database in which the caller owns project A and the child ids in the URL
 * belong to project B. Anything asked *without* the project id gets project
 * B's data back — that is the whole point.
 */
function installForeignChildDatabase(): void {
  executed = [];
  installTestAuth();
  mockQuery((text, params = []) => {
    executed.push({ text, params: params as unknown[] });

    if (text.includes("FROM project_members")) {
      return {
        rows: [{
          project_id: PROJECT_A,
          user_id: TEST_USER.id,
          permission_tier: "owner",
          developer_role: "general",
          default_package_id: null,
        }],
      };
    }

    // Scoped lookups (project id among the params) find nothing: the child is
    // not in project A.
    if (scopedToProjectA(params as unknown[])) return { rows: [], rowCount: 0 };

    if (text.includes("FROM source_receipts")) {
      return {
        rows: [{
          id: "receipt-1",
          file_path: "billing/secrets.ts",
          symbol_name: "STRIPE_SECRET",
          line_start: 1,
          line_end: 1,
          snippet: SECRET_SNIPPET,
          confidence: "high",
          commit_hash: "deadbee",
          node_stable_key: "billing/secrets.ts#STRIPE_SECRET",
          node_hash: "hash",
          claim: "loads the billing secret",
          node_metadata: null,
          symbol_summary: null,
        }],
      };
    }

    if (text.includes("UPDATE package_sections")) {
      return { rows: [{ id: FOREIGN_SECTION, package_id: "pkg-in-project-b", review_status: "approved" }], rowCount: 1 };
    }

    // Follow-up "is the whole package approved now?" count.
    if (text.includes("COUNT(*)") && text.includes("FROM package_sections")) {
      return { rows: [{ count: "0" }] };
    }

    if (text.includes("FROM workflows")) {
      return { rows: [{ id: FOREIGN_WORKFLOW, title: "Project B checkout", trigger_type: "http", purpose: "bill a customer", importance_score: 9, confidence: "high" }] };
    }

    if (text.includes("FROM package_sections") || text.includes("FROM workflow_steps")) {
      return { rows: [] };
    }

    return { rows: [] };
  });
}

describe("Bug #65 — routes must scope child objects to the project in the path", () => {
  afterEach(resetTestHarness);

  it("GET …/onboarding/sections/:sectionId/receipts does not serve another project's source", async () => {
    installForeignChildDatabase();

    const res = await request(app)
      .get(`/api/projects/${PROJECT_A}/onboarding/sections/${FOREIGN_SECTION}/receipts`)
      .set(authHeader());

    expect(res.status).to.equal(404);
    expect(JSON.stringify(res.body)).to.not.include(SECRET_SNIPPET);
  });

  it("PATCH …/onboarding/sections/:sectionId/review does not write to another project's section", async () => {
    installForeignChildDatabase();

    const res = await request(app)
      .patch(`/api/projects/${PROJECT_A}/onboarding/sections/${FOREIGN_SECTION}/review`)
      .set(authHeader())
      .send({ review_status: "approved" });

    expect(res.status).to.equal(404);

    // The write itself must never have been attempted unscoped, and the
    // package status must not have been recomputed for project B either.
    const unscopedWrites = executed.filter(
      (q) => /^\s*UPDATE/i.test(q.text) && !scopedToProjectA(q.params),
    );
    expect(unscopedWrites, JSON.stringify(unscopedWrites)).to.have.lengthOf(0);
  });

  // #72: ownership transfer rewrites `projects.user_id` and both tiers, so it is
  // owner-only. An admin can already manage members, which makes "admin can
  // transfer" the plausible mistake — and the way it would fail is silent, since
  // the transfer itself looks like an ordinary member write.
  it("POST …/members/:userId/transfer-ownership is refused to admins and developers", async () => {
    for (const tier of ["admin", "developer"]) {
      executed = [];
      installTestAuth();
      mockQuery((text, params = []) => {
        executed.push({ text, params: params as unknown[] });
        if (text.includes("FROM project_members")) {
          return {
            rows: [{
              project_id: PROJECT_A,
              user_id: TEST_USER.id,
              permission_tier: tier,
              developer_role: "general",
              default_package_id: null,
            }],
          };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .post(`/api/projects/${PROJECT_A}/members/${FOREIGN_MEMBER}/transfer-ownership`)
        .set(authHeader());

      expect(res.status, tier).to.equal(403);
      const writes = executed.filter((q) => /^\s*(UPDATE|BEGIN)/i.test(q.text));
      expect(writes, `${tier}: ${JSON.stringify(writes)}`).to.have.lengthOf(0);
    }
  });

  it("GET …/workflows/:workflowId/walkthrough does not serve another project's walkthrough", async () => {
    installForeignChildDatabase();

    const res = await request(app)
      .get(`/api/projects/${PROJECT_A}/workflows/${FOREIGN_WORKFLOW}/walkthrough`)
      .set(authHeader());

    expect(res.status).to.equal(404);
    expect(JSON.stringify(res.body)).to.not.include("Project B checkout");
  });
});
