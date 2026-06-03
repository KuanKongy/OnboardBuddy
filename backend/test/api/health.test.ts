import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

describe("GET /api/health", () => {
  it("returns the API health payload", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({
      status: "ok",
      service: "onboardbuddy-api"
    });
  });
});
