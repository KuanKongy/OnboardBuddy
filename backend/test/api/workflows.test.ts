import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

const app = createApp();
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("GET /api/projects/:id/workflows", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/workflows`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/projects/:id/workflows/:workflowId/walkthrough", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/workflows/some-id/walkthrough`);
    expect(res.status).to.equal(401);
  });
});
