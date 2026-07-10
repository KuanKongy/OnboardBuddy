import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

const app = createApp();
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("GET /api/projects/:id/onboarding", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/onboarding`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
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
