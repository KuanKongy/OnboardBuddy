import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

const app = createApp();

describe("GET /api/projects", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/projects");

    expect(res.status).to.equal(401);
    expect(res.body.error).to.include("Missing");
  });

  it("returns 401 with a malformed Authorization header", async () => {
    const res = await request(app)
      .get("/api/projects")
      .set("Authorization", "Token abc123");

    expect(res.status).to.equal(401);
  });
});

describe("POST /api/projects", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/projects")
      .send({ repo_owner: "owner", repo_name: "repo", branch: "main" });

    expect(res.status).to.equal(401);
  });
});

describe("GET /api/projects/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/projects/some-uuid");

    expect(res.status).to.equal(401);
  });
});

describe("DELETE /api/projects/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).delete("/api/projects/some-uuid");

    expect(res.status).to.equal(401);
  });
});

describe("POST /api/projects/:id/analyze", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).post("/api/projects/some-uuid/analyze");

    expect(res.status).to.equal(401);
  });
});

describe("PUT /api/projects/:id/settings", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .put("/api/projects/some-uuid/settings")
      .send({ ignored_paths: ["node_modules"] });

    expect(res.status).to.equal(401);
  });
});
