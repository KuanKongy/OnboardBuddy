import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { classifyIntent } from "../../src/qa/askService.js";
import { internalChatEnabled } from "../../src/api/routes/internalChat.js";
import {
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
  TEST_PROJECT_ID,
  TEST_USER,
} from "../helpers/testHarness.js";

const app = createApp();

function memberRow() {
  return {
    project_id: TEST_PROJECT_ID,
    user_id: TEST_USER.id,
    permission_tier: "member",
    developer_role: "general",
  };
}

describe("phase 8 — intent classification", () => {
  it("maps question shapes onto retrieval views", () => {
    expect(classifyIntent("What does the auth service do?")).to.equal("what_does");
    expect(classifyIntent("What handles payment processing?")).to.equal("what_handles");
    expect(classifyIntent("Who calls saveSession?")).to.equal("what_uses");
    expect(classifyIntent("What breaks if the session store fails?")).to.equal("what_breaks");
    expect(classifyIntent("Tell me about this repo")).to.equal("general");
  });
});

describe("POST /api/projects/:id/ask", () => {
  afterEach(() => resetTestHarness());

  it("requires authentication", async () => {
    const res = await request(app).post(`/api/projects/${TEST_PROJECT_ID}/ask`).send({ question: "What does this do?" });
    expect(res.status).to.equal(401);
  });

  it("rejects trivial questions and invalid roles", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow()] };
      return { rows: [] };
    });
    const empty = await request(app).post(`/api/projects/${TEST_PROJECT_ID}/ask`).set(authHeader()).send({ question: "x" });
    expect(empty.status).to.equal(400);
    const badRole = await request(app).post(`/api/projects/${TEST_PROJECT_ID}/ask`).set(authHeader())
      .send({ question: "What does this do?", role: "wizard" });
    expect(badRole.status).to.equal(400);
  });

  it("404s when the project has no analyzed snapshot", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow()] };
      return { rows: [] }; // snapshot resolution finds nothing
    });
    const res = await request(app).post(`/api/projects/${TEST_PROJECT_ID}/ask`).set(authHeader())
      .send({ question: "What does this repo do?" });
    expect(res.status).to.equal(404);
  });

  it("403s when the project has AI disabled", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow()] };
      if (text.includes("FROM analysis_snapshots")) {
        return { rows: [{
          snapshot_id: "33333333-3333-3333-3333-333333333333", scope_id: "s", commit_hash: "c",
          semantic_depth: "standard", privacy_mode: "ai_disabled", default_role: "general",
          budget_overrides: {}, model_failure_behavior: {}, model_tier_overrides: {},
        }] };
      }
      return { rows: [] };
    });
    const res = await request(app).post(`/api/projects/${TEST_PROJECT_ID}/ask`).set(authHeader())
      .send({ question: "What does this repo do?" });
    expect(res.status).to.equal(403);
  });
});

describe("phase 8 — internal chat page", () => {
  it("is gated behind the dev-only flag", () => {
    // Tests run with NODE_ENV=test, so the page is enabled here.
    expect(internalChatEnabled()).to.equal(true);
  });

  it("serves the self-contained page", async () => {
    const res = await request(app).get("/api/internal/chat");
    expect(res.status).to.equal(200);
    expect(res.type).to.equal("text/html");
    expect(res.text).to.include("Q&amp;A eval");
    expect(res.text).to.include("/ask");
  });
});
