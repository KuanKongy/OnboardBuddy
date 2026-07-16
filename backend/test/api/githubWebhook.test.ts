import crypto from "node:crypto";
import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { verifyGithubSignature } from "../../src/api/routes/githubWebhook.js";
import { mockQuery, resetTestHarness } from "../helpers/testHarness.js";

const app = createApp();
const SECRET = "test-webhook-secret";
const SHA = "a".repeat(40);

function sign(body: string, secret = SECRET): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function pushBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ref: "refs/heads/main",
    after: SHA,
    deleted: false,
    repository: { name: "repo", owner: { login: "owner" } },
    installation: { id: 42 },
    ...overrides,
  });
}

function post(body: string, headers: Record<string, string> = {}) {
  return request(app)
    .post("/api/webhooks/github")
    .set("Content-Type", "application/json")
    .set("X-GitHub-Event", headers["X-GitHub-Event"] ?? "push")
    .set("X-Hub-Signature-256", headers["X-Hub-Signature-256"] ?? sign(body))
    .send(body);
}

describe("verifyGithubSignature", () => {
  it("accepts a correct sha256 signature", () => {
    const body = Buffer.from(pushBody());
    expect(verifyGithubSignature(body, sign(body.toString()), SECRET)).to.equal(true);
  });

  it("rejects a wrong secret, tampered body, and malformed headers", () => {
    const body = Buffer.from(pushBody());
    expect(verifyGithubSignature(body, sign(body.toString(), "other"), SECRET)).to.equal(false);
    expect(verifyGithubSignature(Buffer.from("tampered"), sign(body.toString()), SECRET)).to.equal(false);
    expect(verifyGithubSignature(body, undefined, SECRET)).to.equal(false);
    expect(verifyGithubSignature(body, "sha1=abc", SECRET)).to.equal(false);
    expect(verifyGithubSignature(body, "sha256=zz", SECRET)).to.equal(false);
  });
});

describe("POST /api/webhooks/github", () => {
  const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    resetTestHarness();
  });

  it("503s when no secret is configured", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const res = await post(pushBody());
    expect(res.status).to.equal(503);
  });

  it("401s on a bad signature before touching the database", async () => {
    let queried = false;
    mockQuery(() => {
      queried = true;
      return { rows: [] };
    });
    const body = pushBody();
    const res = await post(body, { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) });
    expect(res.status).to.equal(401);
    expect(queried).to.equal(false);
  });

  it("answers ping with a pong", async () => {
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const res = await post(body, { "X-GitHub-Event": "ping" });
    expect(res.status).to.equal(200);
    expect(res.body.pong).to.equal(true);
  });

  it("ignores non-push events with a 2xx", async () => {
    const body = JSON.stringify({ action: "opened" });
    const res = await post(body, { "X-GitHub-Event": "issues" });
    expect(res.status).to.equal(200);
    expect(res.body.ignored).to.equal("issues");
  });

  it("skips branch deletions, tags, and zero SHAs", async () => {
    for (const [body, reason] of [
      [pushBody({ deleted: true }), "branch_deleted"],
      [pushBody({ ref: "refs/tags/v1.0" }), "not_a_branch"],
      [pushBody({ after: "0".repeat(40) }), "no_head_commit"],
    ] as const) {
      const res = await post(body);
      expect(res.status).to.equal(200);
      expect(res.body.skipped).to.equal(reason);
    }
  });

  it("400s on malformed JSON", async () => {
    const res = await post("{not json");
    expect(res.status).to.equal(400);
  });

  it("skips cleanly when no project opted in", async () => {
    mockQuery((text) => {
      if (text.includes("auto_reanalyze_on_push = true")) return { rows: [] };
      return { rows: [] };
    });
    const res = await post(pushBody());
    expect(res.status).to.equal(200);
    expect(res.body.skipped).to.equal("no_matching_projects");
  });

  it("skips a project whose pushed branch has no packages", async () => {
    mockQuery((text) => {
      if (text.includes("auto_reanalyze_on_push = true")) {
        return { rows: [{ id: "p1", user_id: "owner-1", default_branch: "main" }] };
      }
      if (text.includes("FROM onboarding_packages")) return { rows: [] };
      return { rows: [] };
    });
    const res = await post(pushBody());
    expect(res.status).to.equal(200);
    expect(res.body.skipped).to.equal("no_packages_on_branch");
  });
});
