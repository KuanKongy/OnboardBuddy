import crypto from "node:crypto";
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

  it("surfaces a GitHub-rejected token as reconnect-required, not a 500", async () => {
    installTestAuth();
    mockGithubConnection();
    // A stored token GitHub no longer accepts (revoked, or expired without a
    // usable refresh). The old message-substring guard let this escape as
    // 500 "Failed to list GitHub installations".
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (input.toString() === "https://api.github.com/user/installations") {
        return new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected GitHub fetch: ${input.toString()}`);
    }) as typeof fetch;

    const res = await request(app)
      .get("/api/github/installations")
      .set(authHeader());

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal("github_reconnect_required");
  });

  // Signing in through Supabase re-mints the user token behind our back (same
  // App credentials), so the stored copy dies with a future expires_at. The
  // clock check cannot see it; only GitHub's 401 can.
  it("refreshes once and retries when GitHub rejects a token the clock says is fine", async () => {
    installTestAuth();
    const log = mockGithubConnection({ refreshToken: "stored-refresh-token" });
    let installationCalls = 0;
    let refreshCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "https://api.github.com/user/installations") {
        installationCalls += 1;
        if (installationCalls === 1) {
          return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
        }
        return new Response(JSON.stringify({
          installations: [{
            id: MOCK_GITHUB_ACCOUNTS.owner.installationId,
            account: {
              id: MOCK_GITHUB_ACCOUNTS.owner.id,
              login: MOCK_GITHUB_ACCOUNTS.owner.login,
              type: "User",
            },
            app_id: 123456,
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "https://github.com/login/oauth/access_token") {
        refreshCalls += 1;
        return new Response(JSON.stringify({
          access_token: "fresh-user-token",
          expires_in: 28800,
          refresh_token: "next-refresh-token",
          refresh_token_expires_in: 15897600,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected GitHub fetch: ${url}`);
    }) as typeof fetch;

    const res = await request(app)
      .get("/api/github/installations")
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.installations.map((inst: { id: number }) => inst.id))
      .to.deep.equal([MOCK_GITHUB_ACCOUNTS.owner.installationId]);
    expect(installationCalls, "listing retried with the refreshed token").to.equal(2);
    expect(refreshCalls, "exactly one refresh — a retry loop would show more").to.equal(1);
    expect(log.statements.some((s) => s.text.includes("UPDATE github_connections")))
      .to.equal(true);
  });

  it("answers reconnect-required when the refresh is rejected too", async () => {
    installTestAuth();
    mockGithubConnection({ refreshToken: "revoked-refresh-token" });
    let installationCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "https://api.github.com/user/installations") {
        installationCalls += 1;
        return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
      }
      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ error: "bad_refresh_token" }), { status: 401 });
      }
      throw new Error(`Unexpected GitHub fetch: ${url}`);
    }) as typeof fetch;

    const res = await request(app)
      .get("/api/github/installations")
      .set(authHeader());

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal("github_reconnect_required");
    // The stored token is unchanged, so retrying the listing would only 401 again.
    expect(installationCalls).to.equal(1);
  });
});

describe("POST /api/github/oauth/complete", () => {
  afterEach(resetGithubMocks);

  // The body lives on GitHubApiError.body, log-only.
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

  // Reinstalling the App mints a new installation id; project rows keep the old
  // one and every branch request for them 403s until something rewrites it.
  describe("an installation id that went stale (App reinstalled)", () => {
    const staleInstallationId = 145949893;
    let previousKey: string | undefined;

    before(() => {
      // Minting the installation token signs a real App JWT, and the harness
      // points the key path at /dev/null on purpose.
      previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
      process.env.GITHUB_APP_PRIVATE_KEY = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      }).privateKey as unknown as string;
    });

    after(() => {
      if (previousKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
      else process.env.GITHUB_APP_PRIVATE_KEY = previousKey;
    });

    it("falls back to the owner's live installation and heals the stored id", async () => {
      installTestAuth();
      const log = mockGithubConnection();
      const liveInstallationId = MOCK_GITHUB_ACCOUNTS.owner.installationId;
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = input.toString();
        if (url === "https://api.github.com/user/installations") {
          return new Response(JSON.stringify({
            installations: [{
              id: liveInstallationId,
              account: {
                id: MOCK_GITHUB_ACCOUNTS.owner.id,
                login: MOCK_GITHUB_ACCOUNTS.owner.login,
                type: "User",
              },
              app_id: 123456,
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url === `https://api.github.com/app/installations/${liveInstallationId}/access_tokens`) {
          return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
        }
        if (url.startsWith(`https://api.github.com/repos/${MOCK_GITHUB_ACCOUNTS.owner.login}/rocket/branches`)) {
          return new Response(JSON.stringify([{ name: "main", commit: { sha: "abc123" } }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected GitHub fetch: ${url}`);
      }) as typeof fetch;

      const res = await request(app)
        .get(`/api/github/repos/${MOCK_GITHUB_ACCOUNTS.owner.login}/rocket/branches`)
        .query({ installation_id: staleInstallationId })
        .set(authHeader());

      expect(res.status).to.equal(200);
      expect(res.body.branches.map((b: { name: string }) => b.name)).to.deep.equal(["main"]);

      const heal = log.statements.find((s) => s.text.includes("UPDATE projects"));
      // Without the write the fallback still serves every request, silently, forever.
      expect(heal, "stale rows must be rewritten").to.not.equal(undefined);
      expect(heal!.params).to.deep.equal([
        String(liveInstallationId),
        MOCK_GITHUB_ACCOUNTS.owner.login,
        String(staleInstallationId),
      ]);
    });

    it("keeps the 403 when no installation belongs to that owner", async () => {
      installTestAuth();
      const log = mockGithubConnection();
      mockGithubInstallationsFetch();

      const res = await request(app)
        .get("/api/github/repos/acme/rocket/branches")
        .query({ installation_id: staleInstallationId })
        .set(authHeader());

      expect(res.status).to.equal(403);
      expect(res.body.error).to.include("You do not have access");
      expect(log.statements.some((s) => s.text.includes("UPDATE projects"))).to.equal(false);
    });
  });
});
