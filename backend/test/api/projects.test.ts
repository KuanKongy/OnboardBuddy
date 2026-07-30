import crypto from "node:crypto";
import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { pool } from "../../src/lib/db.js";
import { encrypt } from "../../src/lib/encryption.js";
import { __setSummaryPublishForTests } from "../../src/api/services/analysisStarter.js";
import { MOCK_GITHUB_ACCOUNTS, mockGithubConnection, mockGithubInstallationsFetch } from "../helpers/githubMocks.js";
import { authHeader, installTestAuth, mockQuery, resetTestHarness, TEST_PROJECT_ID } from "../helpers/testHarness.js";

const app = createApp();
const originalFetch = globalThis.fetch;

describe("GET /api/projects", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/projects");

    expect(res.status).to.equal(401);
    expect(res.body.error).to.include("Missing");
  });

  it("returns 401 with a malformed Authorization header", async () => {
    const res = await request(app)
      .get("/api/projects")
      .set("Authorization", "Token abc123");

    expect(res.status).to.equal(401);
  });
});

describe("POST /api/projects", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetTestHarness();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/projects")
      .send({ repo_owner: "owner", repo_name: "repo", branch: "main" });

    expect(res.status).to.equal(401);
  });

  it("rejects project creation with another user's GitHub installation", async () => {
    installTestAuth();
    mockGithubConnection();
    mockGithubInstallationsFetch();

    const res = await request(app)
      .post("/api/projects")
      .set(authHeader())
      .send({
        repo_owner: MOCK_GITHUB_ACCOUNTS.otherUser.login,
        repo_name: "secret-repo",
        branch: "main",
        github_installation_id: String(MOCK_GITHUB_ACCOUNTS.otherUser.installationId),
      });

    expect(res.status).to.equal(403);
    expect(res.body.error).to.include("You do not have access");
  });

  // #74/B7 + #74/F4. Both cases used to be indistinguishable from a server
  // fault: an unreadable repo rethrew into the generic 500, and the duplicate
  // 409 named no project, so the importer had nowhere to send the user.
  describe("failures the caller can act on", () => {
    const ownerInstallation = MOCK_GITHUB_ACCOUNTS.owner.installationId;
    let previousKey: string | undefined;

    before(() => {
      // The route reaches getRepo through a real App JWT, so signing has to
      // work; the test harness points the key path at /dev/null on purpose.
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

    it("answers 422, not 500, when no branch was given and GitHub will not show us the repo", async () => {
      installTestAuth();
      mockGithubConnection();
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = input.toString();
        if (url === "https://api.github.com/user/installations") {
          return new Response(JSON.stringify({
            installations: [{
              id: ownerInstallation,
              account: { id: MOCK_GITHUB_ACCOUNTS.owner.id, login: MOCK_GITHUB_ACCOUNTS.owner.login, type: "User" },
              app_id: 123456,
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url === `https://api.github.com/app/installations/${ownerInstallation}/access_tokens`) {
          return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
        }
        if (url === "https://api.github.com/repos/acme/private-thing") {
          return new Response(
            JSON.stringify({ message: "Not Found", documentation_url: "https://docs.github.com/rest" }),
            { status: 404 },
          );
        }
        throw new Error(`Unexpected GitHub fetch: ${url}`);
      }) as typeof fetch;

      const res = await request(app)
        .post("/api/projects")
        .set(authHeader())
        // No `branch` — that is what makes the repo fetch load-bearing.
        .send({
          repo_owner: "acme",
          repo_name: "private-thing",
          github_installation_id: String(ownerInstallation),
        });

      expect(res.status).to.equal(422);
      expect(res.body.error).to.include("Repository not accessible");
      // GitHub's response body must not travel with it.
      expect(JSON.stringify(res.body)).to.not.include("documentation_url");
    });

    it("names the existing project in the duplicate-repo 409", async () => {
      installTestAuth();
      const existingId = "33333333-3333-3333-3333-333333333333";
      mockQuery((text) => {
        if (text.includes("FROM github_connections")) return { rows: [connectionRow()] };
        if (text.includes("SELECT id FROM projects")) return { rows: [{ id: existingId }] };
        throw new Error(`Unexpected query: ${text}`);
      });
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = input.toString();
        if (url === "https://api.github.com/user/installations") {
          return new Response(JSON.stringify({
            installations: [{
              id: ownerInstallation,
              account: { id: MOCK_GITHUB_ACCOUNTS.owner.id, login: MOCK_GITHUB_ACCOUNTS.owner.login, type: "User" },
              app_id: 123456,
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        // A branch was supplied, so the metadata fetch is best-effort: this
        // failure is only logged and the INSERT still runs.
        return new Response("upstream unavailable", { status: 503 });
      }) as typeof fetch;
      const client = stubPoolClient((text) => {
        if (text.startsWith("INSERT INTO projects")) {
          throw new Error(
            'duplicate key value violates unique constraint "projects_user_id_repo_owner_repo_name_key"',
          );
        }
        return { rows: [] };
      });

      try {
        const res = await request(app)
          .post("/api/projects")
          .set(authHeader())
          .send({
            repo_owner: "acme",
            repo_name: "api",
            branch: "main",
            github_installation_id: String(ownerInstallation),
          });

        expect(res.status).to.equal(409);
        expect(res.body.project_id).to.equal(existingId);
        expect(client.statements).to.include("ROLLBACK");
      } finally {
        client.restore();
      }
    });
  });
});

/** The github_connections row shape `getUserGithubConnection` expects. */
function connectionRow() {
  return {
    github_user_id: MOCK_GITHUB_ACCOUNTS.owner.id,
    github_username: MOCK_GITHUB_ACCOUNTS.owner.login,
    access_token_encrypted: encrypt("github-user-token"),
    access_token_expires_at: new Date(Date.now() + 60 * 60 * 1000),
    refresh_token_encrypted: null,
    refresh_token_expires_at: null,
  };
}

/**
 * `pool.connect()` has no injection seam and POST /api/projects needs a real
 * transaction, so the client is swapped on the pool for the length of one test.
 * Restored in a `finally` — a leaked stub would silently break every later
 * suite that touches the pool.
 */
function stubPoolClient(
  handler: (text: string) => { rows: unknown[] },
): { statements: string[]; restore: () => void } {
  const statements: string[] = [];
  const original = pool.connect;
  const fake = {
    query: async (text: string) => {
      statements.push(text.trim().split("\n")[0]!.trim());
      return handler(text.trim());
    },
    release: () => {},
  };
  (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => fake;
  return {
    statements,
    restore: () => {
      (pool as unknown as { connect: typeof original }).connect = original;
    },
  };
}

describe("GET /api/projects/activity", () => {
  afterEach(() => resetTestHarness());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/projects/activity");

    expect(res.status).to.equal(401);
  });

  it("merges runs and packages newest-first and tags each kind", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM analysis_jobs")) {
        return {
          rows: [
            {
              id: "job-1", project_id: TEST_PROJECT_ID, repo_owner: "acme", repo_name: "api",
              status: "complete", job_type: "analyze_scope", branch: "main", role: null,
              scope: "Whole repository", at: "2026-07-16T10:00:00.000Z",
            },
          ],
        };
      }
      if (text.includes("FROM onboarding_packages")) {
        return {
          rows: [
            {
              id: "pkg-1", project_id: TEST_PROJECT_ID, repo_owner: "acme", repo_name: "api",
              status: "draft", role: "backend", branch: "main",
              scope: "Whole repository", at: "2026-07-16T11:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app).get("/api/projects/activity").set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.activity).to.have.length(2);
    // The package (11:00) outranks the run (10:00).
    expect(res.body.activity[0].kind).to.equal("package");
    expect(res.body.activity[0].id).to.equal("pkg-1");
    expect(res.body.activity[1].kind).to.equal("analysis");
    expect(res.body.activity[1].job_type).to.equal("analyze_scope");
  });

  it("caps the limit parameter at 50", async () => {
    installTestAuth();
    const limits: number[] = [];
    mockQuery((text, params) => {
      if (text.includes("FROM analysis_jobs") || text.includes("FROM onboarding_packages")) {
        limits.push(params?.[1] as number);
      }
      return { rows: [] };
    });

    const res = await request(app).get("/api/projects/activity?limit=999").set(authHeader());

    expect(res.status).to.equal(200);
    expect(limits).to.deep.equal([50, 50]);
  });
});

describe("GET /api/projects/:id", () => {
  afterEach(() => resetTestHarness());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/projects/some-uuid");

    expect(res.status).to.equal(401);
  });

  // Bug #74/B11: `project_id = 'not-a-uuid'` is a Postgres cast error, so the
  // access check 500'd on a project id that could not name anything.
  it("answers a non-uuid :id with 404 JSON instead of a 500", async () => {
    installTestAuth();
    let queried = false;
    mockQuery(() => {
      queried = true;
      return { rows: [] };
    });

    const res = await request(app).get("/api/projects/not-a-uuid").set(authHeader());

    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({ error: "Not found" });
    expect(queried, "the database was never asked").to.equal(false);
  });
});

describe("DELETE /api/projects/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).delete("/api/projects/some-uuid");

    expect(res.status).to.equal(401);
  });
});

describe("POST /api/projects/:id/analyze", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).post("/api/projects/some-uuid/analyze");

    expect(res.status).to.equal(401);
  });
});

describe("POST /api/projects/:id/summarize", () => {
  afterEach(() => {
    __setSummaryPublishForTests(null);
    resetTestHarness();
  });

  /**
   * Bug #74/B5. The three generation producers published straight to the queue,
   * so a submission that threw left the row committed 'queued' with nothing to
   * consume it: "waiting for worker" forever, and the per-package concurrency
   * guard then refused every retry as already in progress. Driven through the
   * route because the wiring is the thing that regressed, not the helper.
   */
  it("fails the queued row instead of leaving it stranded when the queue rejects", async () => {
    installTestAuth();
    const writes: Array<{ text: string; params?: unknown[] }> = [];
    mockQuery((text, params) => {
      writes.push({ text, params });
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: TEST_PROJECT_ID, user_id: "u1",
            permission_tier: "owner", developer_role: "general", default_package_id: null,
          }],
        };
      }
      if (text.includes("FROM analysis_snapshots")) {
        return { rows: [{ id: "snap-1", commit_hash: "abc", branch: "main", scope_id: "scope-1" }] };
      }
      if (text.includes("FROM analysis_jobs") && text.includes("status IN")) return { rows: [] };
      if (text.trim().startsWith("INSERT INTO analysis_jobs")) return { rows: [{ id: "job-9" }] };
      return { rows: [] };
    });
    __setSummaryPublishForTests(async () => {
      throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
    });

    const res = await request(app)
      .post(`/api/projects/${TEST_PROJECT_ID}/summarize`)
      .set(authHeader())
      .send({});

    // A 202 here would be the lie: nothing was queued.
    expect(res.status).to.equal(500);
    const fail = writes.find((w) => w.text.includes("SET status = 'failed'"));
    expect(fail, "the row must not be left on 'queued'").to.exist;
    expect(fail!.params?.[0]).to.equal("job-9");
    expect(String(fail!.params?.[1])).to.include("press Analyze again");
  });
});

describe("PUT /api/projects/:id/settings", () => {
  afterEach(() => resetTestHarness());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .put("/api/projects/some-uuid/settings")
      .send({ ignored_paths: ["node_modules"] });

    expect(res.status).to.equal(401);
  });

  it("rejects a non-boolean auto_reanalyze_on_push", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: "22222222-2222-2222-2222-222222222222",
            user_id: "11111111-1111-1111-1111-111111111111",
            permission_tier: "owner",
            developer_role: "backend",
            default_package_id: null,
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put("/api/projects/22222222-2222-2222-2222-222222222222/settings")
      .set(authHeader())
      .send({ auto_reanalyze_on_push: "yes" });

    expect(res.status).to.equal(400);
    expect(res.body.error).to.include("auto_reanalyze_on_push");
  });

  // Bug #9: the SET clauses were assembled by hand, field by field. The
  // handler now walks the allowlist rather than the request body, so a key
  // the allowlist does not name cannot appear in the statement — whatever it
  // is called, and whatever it contains.
  it("builds the UPDATE from the allowlist, never from the request body", async () => {
    installTestAuth();
    let updateSql = "";
    let updateParams: unknown[] = [];
    mockQuery((text, params) => {
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: "22222222-2222-2222-2222-222222222222",
            user_id: "11111111-1111-1111-1111-111111111111",
            permission_tier: "owner",
            developer_role: "backend",
            default_package_id: null,
          }],
        };
      }
      if (text.includes("UPDATE project_settings")) {
        updateSql = text;
        updateParams = (params ?? []) as unknown[];
        return { rows: [{ project_id: "22222222-2222-2222-2222-222222222222" }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put("/api/projects/22222222-2222-2222-2222-222222222222/settings")
      .set(authHeader())
      .send({
        privacy_mode: "facts_only_ai",
        // None of these are settings. One is a real column on another table,
        // one is an injection attempt, one is a plausible-looking typo.
        permission_tier: "owner",
        "privacy_mode = 'full_ai', ignored_paths": ["x"],
        privacyMode: "full_ai",
      });

    expect(res.status).to.equal(200);
    expect(updateSql).to.include("privacy_mode = $2");
    expect(updateParams).to.deep.equal(["22222222-2222-2222-2222-222222222222", "facts_only_ai"]);
    expect(updateSql).to.not.include("permission_tier");
    expect(updateSql).to.not.include("full_ai");
    expect(updateSql).to.not.include("privacyMode");
  });

  it("answers an unknown-only body with 400 rather than an empty UPDATE", async () => {
    installTestAuth();
    let updated = false;
    mockQuery((text) => {
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: "22222222-2222-2222-2222-222222222222",
            user_id: "11111111-1111-1111-1111-111111111111",
            permission_tier: "owner",
            developer_role: "backend",
            default_package_id: null,
          }],
        };
      }
      if (text.includes("UPDATE project_settings")) updated = true;
      return { rows: [] };
    });

    const res = await request(app)
      .put("/api/projects/22222222-2222-2222-2222-222222222222/settings")
      .set(authHeader())
      .send({ not_a_setting: true });

    expect(res.status).to.equal(400);
    expect(updated).to.equal(false);
  });
});

describe("GET /api/projects/:id/runs", () => {
  afterEach(() => resetTestHarness());

  // The overview merges an auto-chained package generation into the analysis
  // that caused it, and the only thing telling the two apart from a package a
  // person asked for is this key. A mapper that dropped it would leave the UI
  // silently guessing by timestamp adjacency — pairs would still merge, just
  // sometimes the wrong ones.
  it("exposes the chaining link, null for a package nobody chained", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: TEST_PROJECT_ID,
            user_id: "11111111-1111-1111-1111-111111111111",
            permission_tier: "developer",
            developer_role: "backend",
            default_package_id: null,
          }],
        };
      }
      if (text.includes("FROM analysis_jobs aj")) {
        expect(text).to.include("aj.checkpoint->>'chainedFrom' AS chained_from");
        return {
          rows: [
            { id: "gen-auto", job_type: "generate_package", status: "complete", chained_from: "analyze-1",
              created_at: "2026-07-29T10:05:00.000Z", step_log: [] },
            { id: "gen-manual", job_type: "generate_package", status: "complete", chained_from: null,
              created_at: "2026-07-29T09:00:00.000Z", step_log: [] },
            { id: "analyze-1", job_type: "analyze_scope", status: "complete", chained_from: null,
              created_at: "2026-07-29T10:00:00.000Z", step_log: [] },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/runs`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.runs.map((r: { chained_from: string | null }) => r.chained_from))
      .to.deep.equal(["analyze-1", null, null]);
  });
});
