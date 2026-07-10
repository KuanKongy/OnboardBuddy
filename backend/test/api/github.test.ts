import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import {
  MOCK_GITHUB_ACCOUNTS,
  mockGithubConnection,
  mockGithubInstallationsFetch,
} from "../helpers/githubMocks.js";
import {
  authHeader,
  installTestAuth,
  resetTestHarness,
} from "../helpers/testHarness.js";

const app = createApp();
const originalFetch = globalThis.fetch;

function resetGithubMocks(): void {
  globalThis.fetch = originalFetch;
  resetTestHarness();
}

describe("GET /api/github/app", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/github/app");

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/github/installations", () => {
  afterEach(resetGithubMocks);

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
    expect(res.body.github_username).to.equal(MOCK_GITHUB_ACCOUNTS.owner.login);
    expect(res.body.installations.map((inst: { account: { login: string } }) => inst.account.login))
      .to.deep.equal([MOCK_GITHUB_ACCOUNTS.owner.login]);
  });
});

describe("GET /api/github/repos", () => {
  afterEach(resetGithubMocks);

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
      .query({ installation_id: MOCK_GITHUB_ACCOUNTS.otherUser.installationId })
      .set(authHeader());

    expect(res.status).to.equal(403);
    expect(res.body.error).to.include("You do not have access");
  });
});

describe("GET /api/github/repos/:owner/:repo/branches", () => {
  afterEach(resetGithubMocks);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .get("/api/github/repos/owner/repo/branches")
      .query({ installation_id: 123 });

    expect(res.status).to.equal(401);
  });

  it("rejects branch access through another account's installation", async () => {
    installTestAuth();
    mockGithubConnection();
    mockGithubInstallationsFetch();

    const res = await request(app)
      .get("/api/github/repos/owner/repo/branches")
      .query({ installation_id: MOCK_GITHUB_ACCOUNTS.otherUser.installationId })
      .set(authHeader());

    expect(res.status).to.equal(403);
    expect(res.body.error).to.include("You do not have access");
  });
});
