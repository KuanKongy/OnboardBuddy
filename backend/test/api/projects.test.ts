import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
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
});

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
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/projects/some-uuid");

    expect(res.status).to.equal(401);
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
