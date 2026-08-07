import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { decrypt } from "../../src/lib/encryption.js";
import {
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
  TEST_PROJECT_ID,
  TEST_USER,
} from "../helpers/testHarness.js";

const app = createApp();

function memberRow(tier: string) {
  return {
    project_id: TEST_PROJECT_ID,
    user_id: TEST_USER.id,
    permission_tier: tier,
    developer_role: "general",
  };
}

describe("project LLM key endpoints (BYO key)", () => {
  afterEach(() => resetTestHarness());

  it("requires authentication", async () => {
    const res = await request(app).get(`/api/projects/${TEST_PROJECT_ID}/llm-key`);
    expect(res.status).to.equal(401);
  });

  it("GET returns existence + models but never the key value", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow("member")] };
      if (text.includes("FROM project_llm_keys")) {
        return { rows: [{ provider: "openrouter", created_at: "2026-07-01", updated_at: "2026-07-01", created_by_email: "admin@x.dev" }] };
      }
      if (text.includes("FROM project_settings")) return { rows: [{ model_tier_overrides: {}, model_failure_behavior: {} }] };
      if (text.includes("FROM ai_generation_runs")) {
        return { rows: [{ key_source: "project", calls: 12, input_tokens: 1000, output_tokens: 200, estimated_cost_usd: 0.05 }] };
      }
      return { rows: [] };
    });

    const res = await request(app).get(`/api/projects/${TEST_PROJECT_ID}/llm-key`).set(authHeader());
    expect(res.status).to.equal(200);
    expect(res.body.key.exists).to.equal(true);
    expect(res.body.models.cheap).to.be.an("array");
    expect(res.body.usage_by_key_source[0].calls).to.equal(12);
    expect(JSON.stringify(res.body)).to.not.match(/api_key/);
  });

  it("PUT is rejected for non-admin members", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow("member")] };
      return { rows: [] };
    });

    const res = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/llm-key`)
      .set(authHeader())
      .send({ api_key: "sk-or-v1-abcdef123456" });
    expect(res.status).to.equal(403);
  });

  it("PUT stores the key encrypted for owners", async () => {
    installTestAuth();
    let storedEncrypted: string | null = null;
    mockQuery((text, params) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow("owner")] };
      if (text.includes("INSERT INTO project_llm_keys")) {
        storedEncrypted = params?.[2] as string;
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/llm-key`)
      .set(authHeader())
      .send({ api_key: "sk-or-v1-abcdef123456" });
    expect(res.status).to.equal(200);
    expect(res.body.key.exists).to.equal(true);
    expect(storedEncrypted).to.be.a("string");
    expect(storedEncrypted).to.not.include("sk-or-v1-abcdef123456");
    expect(decrypt(storedEncrypted!)).to.equal("sk-or-v1-abcdef123456");
  });

  // Rotating a key is the common case, and (project_id, provider) is unique:
  // without the upsert clause the second PUT would come back a 500 that reads
  // as "saving your key is broken" with the old key still in force.
  it("PUT replaces an existing key instead of colliding on the unique index", async () => {
    installTestAuth();
    const upserts: Array<{ text: string; params?: unknown[] }> = [];
    mockQuery((text, params) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow("owner")] };
      if (text.includes("INSERT INTO project_llm_keys")) {
        upserts.push({ text, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const first = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/llm-key`)
      .set(authHeader())
      .send({ api_key: "sk-or-v1-first111111" });
    const second = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/llm-key`)
      .set(authHeader())
      .send({ api_key: "sk-or-v1-second22222" });

    expect(first.status).to.equal(200);
    expect(second.status).to.equal(200);
    expect(upserts).to.have.length(2);
    expect(upserts[1]!.text).to.include("ON CONFLICT (project_id, provider) DO UPDATE");
    // The replacement is what gets stored, not the key it replaced.
    expect(decrypt(upserts[1]!.params?.[2] as string)).to.equal("sk-or-v1-second22222");
  });

  it("PUT rejects trivial keys and unknown providers", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow("owner")] };
      return { rows: [] };
    });

    const short = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/llm-key`).set(authHeader()).send({ api_key: "x" });
    expect(short.status).to.equal(400);

    const badProvider = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/llm-key`).set(authHeader())
      .send({ api_key: "sk-or-v1-abcdef123456", provider: "acme-ai" });
    expect(badProvider.status).to.equal(400);
  });

  it("DELETE removes the key for admins", async () => {
    installTestAuth();
    let deleted = false;
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow("admin")] };
      if (text.includes("DELETE FROM project_llm_keys")) {
        deleted = true;
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app).delete(`/api/projects/${TEST_PROJECT_ID}/llm-key`).set(authHeader());
    expect(res.status).to.equal(200);
    expect(res.body.key.exists).to.equal(false);
    expect(deleted).to.equal(true);
  });
});

describe("snapshot metrics endpoint", () => {
  afterEach(() => resetTestHarness());

  const SNAPSHOT_ID = "33333333-3333-3333-3333-333333333333";

  it("returns phases, budget usage, and per-model LLM aggregates", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow("member")] };
      if (text.includes("FROM analysis_snapshots")) {
        return { rows: [{ id: SNAPSHOT_ID, status: "complete", budget_usage: { llm_calls: 10 } }] };
      }
      if (text.includes("FROM snapshot_phases")) {
        return { rows: [{ phase: "generation", status: "complete", metrics: { sections: 9 } }] };
      }
      if (text.includes("FROM ai_generation_runs")) {
        return { rows: [{ model: "m", model_tier: "strong", status: "complete", calls: 10 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/snapshots/${SNAPSHOT_ID}/metrics`)
      .set(authHeader());
    expect(res.status).to.equal(200);
    expect(res.body.snapshot.budget_usage.llm_calls).to.equal(10);
    expect(res.body.phases[0].phase).to.equal("generation");
    expect(res.body.llm[0].model_tier).to.equal("strong");
  });

  it("404s when the snapshot is not in the project", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow("member")] };
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/snapshots/${SNAPSHOT_ID}/metrics`)
      .set(authHeader());
    expect(res.status).to.equal(404);
  });
});

describe("PUT /settings — Phase 4 fields", () => {
  afterEach(() => resetTestHarness());

  function ownerHarness(captured: { text?: string; params?: unknown[] }) {
    installTestAuth();
    mockQuery((text, params) => {
      if (text.includes("FROM project_members")) return { rows: [memberRow("owner")] };
      if (text.startsWith("UPDATE project_settings")) {
        captured.text = text;
        captured.params = params;
        return { rows: [{ project_id: TEST_PROJECT_ID }] };
      }
      return { rows: [] };
    });
  }

  it("accepts valid budget/model settings", async () => {
    const captured: { text?: string; params?: unknown[] } = {};
    ownerHarness(captured);

    const res = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/settings`)
      .set(authHeader())
      .send({
        budget_overrides: { max_llm_calls: 500 },
        budget_stop_behavior: "degrade",
        model_failure_behavior: { cheap: ["retry", "fail"] },
        model_tier_overrides: { strong: ["anthropic/claude-sonnet-4.5"] },
      });
    expect(res.status).to.equal(200);
    expect(captured.text).to.include("budget_overrides");
    expect(captured.text).to.include("model_tier_overrides");
  });

  it("rejects malformed budget_overrides and failure behaviors", async () => {
    const captured: { text?: string; params?: unknown[] } = {};
    ownerHarness(captured);

    const badBudget = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/settings`).set(authHeader())
      .send({ budget_overrides: { max_llm_calls: -5 } });
    expect(badBudget.status).to.equal(400);

    const badBehavior = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/settings`).set(authHeader())
      .send({ model_failure_behavior: { cheap: ["explode"] } });
    expect(badBehavior.status).to.equal(400);

    const badStop = await request(app)
      .put(`/api/projects/${TEST_PROJECT_ID}/settings`).set(authHeader())
      .send({ budget_stop_behavior: "shrug" });
    expect(badStop.status).to.equal(400);
  });
});
