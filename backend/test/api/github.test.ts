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
  TEST_USER,
} from "../helpers/testHarness.js";
import { createInstallationState } from "../../src/lib/github-installation-state.js";

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

describe("POST /api/github/oauth/complete", () => {
  afterEach(resetGithubMocks);

  // #74/B2: this catch-all answered `400 { error: err.message }` for anything
  // that escaped, and lib/github.ts interpolated GitHub's whole response body
  // into that message — so a provoked failure reflected GitHub's JSON back to
  // the caller. The body now lives on GitHubApiError.body, log-only.
  it("does not reflect GitHub's response body when the code exchange fails", async () => {
    installTestAuth();
    const state = createInstallationState(TEST_USER.id);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: "bad_verification_code", internal_hint: "SHOULD-NOT-LEAK" }),
        { status: 401 },
      )) as typeof fetch;

    const res = await request(app)
      .post("/api/github/oauth/complete")
      .set(authHeader())
      .send({ code: "whatever", state });

    expect(res.status).to.equal(500);
    expect(res.body.error).to.equal("Failed to complete GitHub OAuth");
    expect(JSON.stringify(res.body)).to.not.include("SHOULD-NOT-LEAK");
  });

  // The other half of the whitelist: an error type written to be read by the
  // caller keeps its message and its 400.
  it("still answers 400 with the message for a stale install-state token", async () => {
    installTestAuth();

    const res = await request(app)
      .post("/api/github/oauth/complete")
      .set(authHeader())
      .send({ code: "whatever", state: "tampered.state" });

    expect(res.status).to.equal(400);
    expect(res.body.error).to.include("Invalid installation state");
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

  it("validates installation_id by shape, not truthiness (bug #8)", async () => {
    // `!Number(raw)` answered the wrong question twice, and both answers are
    // silent: `0` is a well-formed id, so it belongs to the ownership check
    // (403), not to "you forgot the parameter" (400); and `Number()` reads
    // "0x2329" as 9001, which would authorize one installation while `POST
    // /projects` persists the other spelling into a text column the webhook
    // later string-matches. Neither shows up as an error anywhere.
    const statuses: Record<string, number> = {};
    for (const installation_id of ["0", "0x2329", "9001.5", "-9001", ""]) {
      installTestAuth();
      mockGithubConnection();
      mockGithubInstallationsFetch();
      const res = await request(app)
        .get("/api/github/repos")
        .query({ installation_id })
        .set(authHeader());
      statuses[installation_id] = res.status;
      resetGithubMocks();
    }

    expect(statuses).to.deep.equal({
      "0": 403, // parses; simply is not an installation of yours
      "0x2329": 400, // not a decimal id, however Number() reads it
      "9001.5": 400,
      "-9001": 400,
      "": 400, // genuinely absent
    });
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
