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

const REF_ID = "33333333-3333-3333-3333-333333333333";

/** Membership row for the access middleware + canned responses per table. */
function mockProgressQueries(saved: unknown[] = []): void {
  mockQuery((text) => {
    if (text.includes("FROM project_members")) {
      return {
        rows: [{
          project_id: TEST_PROJECT_ID,
          user_id: TEST_USER.id,
          permission_tier: "developer",
          developer_role: "backend",
        }],
      };
    }
    if (text.includes("INSERT INTO user_progress")) {
      return { rows: saved };
    }
    if (text.includes("FROM user_progress")) {
      return { rows: saved };
    }
    return { rows: [] };
  });
}

describe("GET /api/projects/:id/progress", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${TEST_PROJECT_ID}/progress`);
    expect(res.status).to.equal(401);
  });

  it("returns the user's resume markers", async () => {
    installTestAuth();
    mockProgressQueries([
      {
        kind: "tutorial",
        ref_id: REF_ID,
        position: { stepOrder: 3 },
        updated_at: "2026-07-11T00:00:00Z",
        still_exists: true,
        title: "Trace a login request",
      },
    ]);

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/progress`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.items).to.have.length(1);
    expect(res.body.items[0].position.stepOrder).to.equal(3);
    expect(res.body.items[0].still_exists).to.equal(true);
  });
});

describe("PUT /api/projects/:id/progress", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/progress`)
      .send({ kind: "tutorial", ref_id: REF_ID, position: { stepOrder: 1 } });
    expect(res.status).to.equal(401);
  });

  it("rejects an unknown kind", async () => {
    installTestAuth();
    mockProgressQueries();
    const res = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/progress`)
      .set(authHeader())
      .send({ kind: "bookmark", ref_id: REF_ID, position: {} });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.include("kind");
  });

  it("rejects a non-UUID ref_id", async () => {
    installTestAuth();
    mockProgressQueries();
    const res = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/progress`)
      .set(authHeader())
      .send({ kind: "tutorial", ref_id: "not-a-uuid", position: {} });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.include("UUID");
  });

  it("rejects a non-object position", async () => {
    installTestAuth();
    mockProgressQueries();
    const res = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/progress`)
      .set(authHeader())
      .send({ kind: "tutorial", ref_id: REF_ID, position: [1, 2] });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.include("position");
  });

  it("upserts and echoes the saved marker", async () => {
    installTestAuth();
    mockProgressQueries([
      { kind: "onboarding", ref_id: REF_ID, position: { sectionType: "architecture" }, updated_at: "2026-07-11T00:00:00Z" },
    ]);
    const res = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/progress`)
      .set(authHeader())
      .send({ kind: "onboarding", ref_id: REF_ID, position: { sectionType: "architecture" } });
    expect(res.status).to.equal(200);
    expect(res.body.progress.position.sectionType).to.equal("architecture");
  });
});
