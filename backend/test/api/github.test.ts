import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { encrypt } from "../../src/lib/encryption.js";
import {
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
} from "../helpers/testHarness.js";

const app = createApp();
const originalFetch = globalThis.fetch;

describe("GET /api/github/app", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/github/app");

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/github/installations", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetTestHarness();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/github/installations");

    expect(res.status).to.equal(401);
  });

  it("only returns installations for the connected GitHub account", async () => {
    installTestAuth();
    mockGithubConnection();
    mockGithubInstallationsFetch();

    const res = await request(app)
      .get("/api/github/installations")
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.github_username).to.equal("KuanKongy");
    expect(res.body.installations.map((inst: { account: { login: string } }) => inst.account.login))
      .to.deep.equal(["KuanKongy"]);
  });
});

describe("GET /api/github/repos", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetTestHarness();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .get("/api/github/repos")
      .query({ installation_id: 123 });

    expect(res.status).to.equal(401);
  });

  it("rejects repository access through another account's installation", async () => {
    installTestAuth();
    mockGithubConnection();
    mockGithubInstallationsFetch();

    const res = await request(app)
      .get("/api/github/repos")
      .query({ installation_id: 9002 })
      .set(authHeader());

    expect(res.status).to.equal(403);
    expect(res.body.error).to.include("You do not have access");
  });
});

describe("GET /api/github/repos/:owner/:repo/branches", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .get("/api/github/repos/owner/repo/branches")
      .query({ installation_id: 123 });

    expect(res.status).to.equal(401);
  });
});

function mockGithubConnection(): void {
  mockQuery((text) => {
    if (text.includes("FROM github_connections")) {
      return {
        rows: [{
          github_user_id: 101,
          github_username: "KuanKongy",
          access_token_encrypted: encrypt("github-user-token"),
          access_token_expires_at: new Date(Date.now() + 60 * 60 * 1000),
          refresh_token_encrypted: null,
          refresh_token_expires_at: null,
        }],
      };
    }

    throw new Error(`Unexpected query: ${text}`);
  });
}

function mockGithubInstallationsFetch(): void {
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);

    if (url === "https://api.github.com/user/installations") {
      return new Response(JSON.stringify({
        installations: [
          { id: 9001, account: { id: 101, login: "KuanKongy", type: "User" }, app_id: 123456 },
          { id: 9002, account: { id: 202, login: "ng-eugene", type: "User" }, app_id: 123456 },
          { id: 9003, account: { id: 303, login: "en80801-arch", type: "User" }, app_id: 123456 },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected GitHub fetch: ${url}; previous calls: ${calls.join(", ")}`);
  }) as typeof fetch;
}
