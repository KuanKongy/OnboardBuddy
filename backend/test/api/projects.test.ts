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
});
