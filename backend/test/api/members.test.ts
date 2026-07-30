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

const app = createApp();

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("GET /api/projects/:id/members", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/members`);

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/projects/:id/members/invitations", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(
      `/api/projects/${PROJECT_ID}/members/invitations`,
    );

    expect(res.status).to.equal(401);
  });
});

describe("POST /api/projects/:id/members/invitations", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/members/invitations`)
      .send({ email: "invite@example.com", permission_tier: "developer" });

    expect(res.status).to.equal(401);
  });

  // Bug #66: the tier arrived from the request body and was inserted verbatim,
  // so an admin could mint a second owner on accept — walking around both the
  // "use ownership transfer" guard on the member PATCH and the "cannot remove
  // the owner" guard on the member DELETE, leaving an owner nobody could
  // remove. A typo'd tier reached the CHECK constraint and 500'd.
  it("refuses to invite an owner, and answers a typo'd tier with a 400 rather than a 500", async () => {
    installTestAuth();
    const writes: string[] = [];
    mockQuery((text) => {
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: PROJECT_ID,
            user_id: TEST_USER.id,
            permission_tier: "admin",
            developer_role: "general",
            default_package_id: null,
          }],
        };
      }
      if (text.includes("INSERT INTO project_invitations")) {
        writes.push(text);
        return { rows: [{ id: "invitation-1" }] };
      }
      return { rows: [] };
    });

    const invite = (permission_tier: string) =>
      request(app)
        .post(`/api/projects/${PROJECT_ID}/members/invitations`)
        .set(authHeader())
        .send({ email: "invite@example.com", permission_tier });

    const asOwner = await invite("owner");
    const asTypo = await invite("develper");

    expect(asOwner.status).to.equal(400);
    expect(asTypo.status).to.equal(400);
    expect(writes, "no invitation row may be written for a rejected tier").to.have.lengthOf(0);
  });
});

describe("PATCH /api/projects/:id/members/:userId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/members/some-user-id`)
      .send({ developer_role: "frontend" });

    expect(res.status).to.equal(401);
  });
});

describe("DELETE /api/projects/:id/members/:userId", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).delete(
      `/api/projects/${PROJECT_ID}/members/some-user-id`,
    );

    expect(res.status).to.equal(401);
  });

  // Bug #74/B11: `WHERE user_id = 'some-user-id'` is a uuid cast error, which
  // came back as a 500 for a member who cannot exist under that spelling.
  it("answers a non-uuid :userId with 404, not a 500 from a uuid cast", async () => {
    installTestAuth();
    const queries: string[] = [];
    mockQuery((text) => {
      queries.push(text);
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: PROJECT_ID,
            user_id: TEST_USER.id,
            permission_tier: "owner",
            developer_role: "general",
            default_package_id: null,
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/members/not-a-uuid`)
      .set(authHeader());

    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({ error: "Not found" });
    // The membership lookup is the access gate; nothing keyed on the bad id ran.
    expect(queries.filter((q) => q.includes("DELETE FROM project_members"))).to.deep.equal([]);
  });
});
