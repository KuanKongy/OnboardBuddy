import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import {
  validateSectionCitations,
} from "../../src/worker/engine/sectionValidator.js";
import { buildContext, DEFAULT_SECTION_REVIEW_STATUS } from "../../src/worker/engine/evidenceContext.js";
import {
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
  TEST_PROJECT_ID,
  TEST_USER,
} from "../helpers/testHarness.js";

const app = createApp();

describe("AI generation quality", () => {
  afterEach(() => {
    resetTestHarness();
  });
  it("Evidence bundles contain extracted structure instead of full source files", () => {
    const context = buildContext({
      snap: {
        commit_hash: "abc123456789",
        branch: "main",
        file_count: 42,
        symbol_count: 120,
        workflow_count: 3,
        repo_owner: "acme",
        repo_name: "app",
        role: "backend",
      },
      nodes: [{
        id: "n1",
        stable_key: "src/api/routes/auth.ts",
        type: "module",
        name: "auth.ts",
        file_path: "src/api/routes/auth.ts",
        line_start: 1,
        line_end: 80,
        hash: "hash-auth",
        import_count: 4,
        exported_symbols: ["authRouter"],
        metadata: { exportedSymbols: ["authRouter"], importCount: 4 },
      }],
      edges: [{ source_key: "src/index.ts", target_key: "src/api/routes/auth.ts", type: "imports" }],
      workflows: [],
      nodeIndex: new Map(),
      entrypoints: [{ kind: "http_route", method: "POST", route_pattern: "/login", file_path: "src/api/routes/auth.ts", name: "authRouter" }],
      sideEffects: [{ kind: "database_write", target: "users", file_path: "src/api/routes/auth.ts" }],
      criticalRankings: [{ file_path: "src/api/routes/auth.ts", name: "authRouter", composite_score: 0.82, ranking_reasons: ["Entry point"] }],
    });

    expect(context).to.include("Repository: acme/app");
    expect(context).to.include("src/api/routes/auth.ts");
    expect(context).to.not.include("export const authRouter");
  });

  it("Generated explanations include source receipts", async () => {
    mockQuery((text) => {
      if (text.includes("FROM package_sections")) {
        return { rows: [{ id: "sec-1", type: "start_here", content: "Intro", confidence: "high" }] };
      }
      if (text.includes("FROM source_receipts")) {
        return {
          rows: [{
            id: "rcpt-1",
            file_path: "src/api/routes/auth.ts",
            node_stable_key: "src/api/routes/auth.ts",
            confidence: "high",
          }],
        };
      }
      return { rows: [] };
    });

    const results = await validateSectionCitations("pkg-1");
    expect(results[0]!.valid).to.equal(true);
    expect(results[0]!.receiptCount).to.equal(1);
  });

  it("Uncited claims are rejected or marked low confidence", async () => {
    mockQuery((text) => {
      if (text.includes("FROM package_sections")) {
        return { rows: [{ id: "sec-2", type: "architecture", content: "x".repeat(600), confidence: "low" }] };
      }
      if (text.includes("FROM source_receipts")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const results = await validateSectionCitations("pkg-2");
    expect(results[0]!.valid).to.equal(false);
    expect(results[0]!.issues.length).to.be.greaterThan(0);
  });

  it("AI-disabled mode produces deterministic package sections only", async () => {
    installTestAuth();
    mockQuery((text, params) => {
      if (text.includes("FROM project_members") && params?.[0] === TEST_PROJECT_ID) {
        return {
          rows: [{
            project_id: TEST_PROJECT_ID,
            user_id: TEST_USER.id,
            permission_tier: "owner",
            developer_role: "general",
          }],
        };
      }
      if (text.includes("SELECT ai_enabled FROM project_settings")) {
        return { rows: [{ ai_enabled: false }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/projects/${TEST_PROJECT_ID}/summarize`)
      .set(authHeader());

    expect(res.status).to.equal(403);
    expect(res.body.error).to.match(/AI features are disabled/i);
  });

  it("Generated sections start as draft review status", () => {
    expect(DEFAULT_SECTION_REVIEW_STATUS).to.equal("draft");
  });
});
