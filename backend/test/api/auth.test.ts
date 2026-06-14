import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

const app = createApp();

describe("POST /api/auth/signup", () => {
  it("returns 400 when email is missing", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ password: "password123" });

    expect(res.status).to.equal(400);
    expect(res.body).to.have.property("error");
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "test@example.com" });

    expect(res.status).to.equal(400);
    expect(res.body).to.have.property("error");
  });

  it("returns 400 when body is empty", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({});

    expect(res.status).to.equal(400);
    expect(res.body.error).to.equal("Email and password are required");
  });
});

describe("POST /api/auth/login", () => {
  it("returns 400 when email is missing", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ password: "password123" });

    expect(res.status).to.equal(400);
    expect(res.body).to.have.property("error");
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@example.com" });

    expect(res.status).to.equal(400);
    expect(res.body).to.have.property("error");
  });
});

describe("POST /api/auth/logout", () => {
  it("returns 401 when no token is provided", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).to.equal(401);
    expect(res.body.error).to.include("Missing");
  });

  it("returns 401 with an invalid Bearer token", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", "Bearer invalid-token-xyz");

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("POST /api/auth/github/save-token", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/auth/github/save-token")
      .send({
        github_user_id: 123,
        github_username: "testuser",
        access_token: "gho_abc123",
        scopes: [],
      });

    expect(res.status).to.equal(401);
  });
});
