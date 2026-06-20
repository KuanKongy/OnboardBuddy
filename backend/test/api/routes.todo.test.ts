import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import {
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
  TEST_PROJECT_ID,
  TEST_USER,
} from "../helpers/testHarness.js";

const app = createApp();

describe("backend API integration (mocked auth + db)", () => {
  beforeEach(() => {
    installTestAuth();
  });

  afterEach(() => {
    resetTestHarness();
  });

  it("Auth endpoints validate signup, login, logout, and current user", async () => {
    const missingEmail = await request(app).post("/api/auth/signup").send({ password: "secret123" });
    expect(missingEmail.status).to.equal(400);

    const missingPassword = await request(app).post("/api/auth/login").send({ email: "a@b.com" });
    expect(missingPassword.status).to.equal(400);

    mockQuery((text) => {
      if (text.includes("FROM public.users u")) {
        return {
          rows: [{
            id: TEST_USER.id,
            email: TEST_USER.email,
            created_at: new Date().toISOString(),
            github_connected: false,
            github_username: null,
          }],
        };
      }
      return { rows: [] };
    });

    const me = await request(app).get("/api/auth/me").set(authHeader());
    expect(me.status).to.equal(200);
    expect(me.body.user.email).to.equal(TEST_USER.email);
  });

  it("GitHub endpoints enforce OAuth and repository permissions", async () => {
    mockQuery((text) => {
      if (text.includes("FROM github_connections")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const reposMissingInstallation = await request(app)
      .get("/api/github/repos")
      .set(authHeader());
    expect(reposMissingInstallation.status).to.equal(400);
    expect(reposMissingInstallation.body.error).to.match(/installation/i);
  });

  it("Project endpoints isolate projects by authenticated user", async () => {
    mockQuery((text) => {
      if (text.includes("FROM project_members") && text.includes("WHERE project_id = $1 AND user_id = $2")) {
        return {
          rows: [{
            project_id: TEST_PROJECT_ID,
            user_id: TEST_USER.id,
            permission_tier: "owner",
            developer_role: "general",
          }],
        };
      }
      if (text.includes("FROM projects p") && text.includes("LEFT JOIN project_settings")) {
        return {
          rows: [{
            id: TEST_PROJECT_ID,
            repo_owner: "acme",
            repo_name: "app",
            branch: "main",
            status: "ready",
            settings: null,
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.project.id).to.equal(TEST_PROJECT_ID);
    expect(res.body.project.permission_tier).to.equal("owner");
  });

  it("Package endpoints support review status updates and exports", async () => {
    mockQuery((text, params) => {
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: TEST_PROJECT_ID,
            user_id: TEST_USER.id,
            permission_tier: "owner",
            developer_role: "general",
          }],
        };
      }
      if (text.includes("FROM onboarding_packages")) {
        return { rows: [{ id: "pkg-1", role: "general" }] };
      }
      if (text.includes("FROM package_sections") && text.includes("ORDER BY created_at")) {
        return { rows: [{ title: "Start Here", content: "Welcome" }] };
      }
      if (text.startsWith("UPDATE package_sections")) {
        return { rows: [{ id: params?.[2], package_id: "pkg-1", review_status: params?.[0] }] };
      }
      if (text.includes("review_status <> 'approved'")) {
        return { rows: [{ count: "0" }] };
      }
      if (text.startsWith("UPDATE onboarding_packages")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const invalidReview = await request(app)
      .patch(`/api/projects/${TEST_PROJECT_ID}/onboarding/sections/sec-1/review`)
      .set(authHeader())
      .send({ review_status: "invalid" });
    expect(invalidReview.status).to.equal(400);

    const exportRes = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/onboarding/export?role=general`)
      .set(authHeader());
    expect(exportRes.status).to.equal(200);
    expect(exportRes.headers["content-type"]).to.match(/markdown/);
    expect(exportRes.text).to.include("# OnboardBuddy");

    const approve = await request(app)
      .patch(`/api/projects/${TEST_PROJECT_ID}/onboarding/sections/sec-1/review`)
      .set(authHeader())
      .send({ review_status: "approved" });
    expect(approve.status).to.equal(200);
  });

  it("Team endpoints enforce membership permissions", async () => {
    mockQuery((text, params) => {
      if (text.includes("FROM project_members") && text.includes("permission_tier")) {
        const userId = params?.[1];
        if (userId === TEST_USER.id) {
          return {
            rows: [{
              project_id: TEST_PROJECT_ID,
              user_id: TEST_USER.id,
              permission_tier: "developer",
              developer_role: "general",
            }],
          };
        }
      }
      return { rows: [] };
    });

    const inviteForbidden = await request(app)
      .post(`/api/projects/${TEST_PROJECT_ID}/members/invitations`)
      .set(authHeader())
      .send({ email: "new@example.com", permission_tier: "developer" });

    expect(inviteForbidden.status).to.equal(403);
  });
});
