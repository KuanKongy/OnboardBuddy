import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { __resetAuthRateLimitForTests } from "../../src/api/middleware/authRateLimit.js";

const app = createApp();

describe("POST /api/auth/signup", () => {
  // Bug #66: the endpoint created a *confirmed* account for any address from
  // an unauthenticated request, bypassing the confirmation email that real
  // sign-up sends — and invitations are matched on email address. It is gone,
  // and this asserts it stays gone rather than being reintroduced by someone
  // who finds the route documented somewhere.
  it("no longer exists — the confirmation bypass was removed", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "victim@example.com", password: "password123" });

    expect(res.status).to.equal(404);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(__resetAuthRateLimitForTests);
  afterEach(__resetAuthRateLimitForTests);

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

  // Bug #66: unlimited login attempts were proxied straight to the auth
  // provider, so guessing was free and the provider's own throttling — which
  // sees every attempt arriving from the backend's address — would have
  // degraded sign-in for every user rather than for the attacker.
  it("throttles repeated attempts against one account with a 429 and a Retry-After", async () => {
    // No password in the body on purpose: the limiter runs ahead of the
    // handler, so the attempt is counted either way, and the spec never has to
    // reach the auth provider over the network to prove the window closes.
    const attempt = () => request(app).post("/api/auth/login").send({ email: "victim@example.com" });

    const statuses: number[] = [];
    let retryAfter: string | undefined;
    for (let i = 0; i < 12; i++) {
      const res = await attempt();
      statuses.push(res.status);
      if (res.status === 429) retryAfter = res.headers["retry-after"];
    }

    expect(statuses.filter((s) => s === 429).length).to.be.greaterThan(0);
    // The window is 10, so the eleventh attempt onward is refused.
    expect(statuses.slice(10)).to.deep.equal([429, 429]);
    expect(Number(retryAfter)).to.be.greaterThan(0);
  });

  it("throttles one account without locking a different account out", async () => {
    for (let i = 0; i < 11; i++) {
      await request(app).post("/api/auth/login").send({ email: "victim@example.com" });
    }

    const otherUser = await request(app)
      .post("/api/auth/login")
      .send({ email: "colleague@example.com" });

    expect(otherUser.status).to.not.equal(429);
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

describe("DELETE /api/auth/account", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).delete("/api/auth/account");

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});
