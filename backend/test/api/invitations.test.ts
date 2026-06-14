import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

const app = createApp();

describe("GET /api/invitations", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/invitations");

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/invitations/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/invitations/some-uuid");

    expect(res.status).to.equal(401);
  });
});

describe("POST /api/invitations/:id/accept", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/invitations/some-uuid/accept")
      .send({ developer_role: "backend" });

    expect(res.status).to.equal(401);
  });
});
