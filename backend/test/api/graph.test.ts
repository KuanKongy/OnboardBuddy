import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

const app = createApp();
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("GET /api/projects/:id/graph/dependencies", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/graph/dependencies`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/projects/:id/graph/nodes/:nodeId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/graph/nodes/some-node-id`);
    expect(res.status).to.equal(401);
  });

  it("returns 401 for stable_key style node ids", async () => {
    const res = await request(app).get(
      `/api/projects/${PROJECT_ID}/graph/nodes/${encodeURIComponent("src/index.ts")}`,
    );
    expect(res.status).to.equal(401);
  });
});

describe("GET /api/projects/:id/graph/architecture", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/graph/architecture`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/projects/:id/graph/classes", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/graph/classes`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/projects/:id/graph/workflows/:workflowId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(
      `/api/projects/${PROJECT_ID}/graph/workflows/00000000-0000-0000-0000-000000000002`,
    );
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});
