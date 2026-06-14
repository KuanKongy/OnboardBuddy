import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

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
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/members/invitations`)
      .send({ email: "invite@example.com", permission_tier: "developer" });

    expect(res.status).to.equal(401);
  });
});

describe("PATCH /api/projects/:id/members/members/:userId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/members/members/some-user-id`)
      .send({ developer_role: "frontend" });

    expect(res.status).to.equal(401);
  });
});

describe("DELETE /api/projects/:id/members/members/:userId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).delete(
      `/api/projects/${PROJECT_ID}/members/members/some-user-id`,
    );

    expect(res.status).to.equal(401);
  });
});
