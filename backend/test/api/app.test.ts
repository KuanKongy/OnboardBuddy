import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import {
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
} from "../helpers/testHarness.js";

const app = createApp();

/** A project list big enough to clear compression's 1kb threshold. */
function manyProjects(): Array<Record<string, unknown>> {
  return Array.from({ length: 60 }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    repo_owner: "onboardbuddy-fixture-owner",
    repo_name: `a-repository-with-a-long-name-${i}`,
    branch: "main",
    status: "complete",
    created_at: "2026-07-01T00:00:00.000Z",
    last_analyzed_at: "2026-07-02T00:00:00.000Z",
    repo_description: "The same sentence in every row, which is what gzip is good at.",
    primary_language: "TypeScript",
    repo_pushed_at: "2026-07-02T00:00:00.000Z",
    permission_tier: "owner",
    developer_role: "general",
    stale_count: 0,
  }));
}

function stubProjectList(): void {
  installTestAuth();
  mockQuery((text) => {
    if (text.includes("FROM projects")) return { rows: manyProjects() };
    return { rows: [] };
  });
}

describe("app middleware", () => {
  afterEach(resetTestHarness);

  it("gzips a JSON response when the client offers gzip, and not when it does not", async () => {
    stubProjectList();
    const gzipped = await request(app)
      .get("/api/projects")
      .set(authHeader())
      .set("Accept-Encoding", "gzip");

    expect(gzipped.status).to.equal(200);
    expect(gzipped.headers["content-encoding"]).to.equal("gzip");
    // Transparently decoded by the client, so the payload is unaffected.
    expect(gzipped.body.projects).to.have.length(60);

    stubProjectList();
    const plain = await request(app)
      .get("/api/projects")
      .set(authHeader())
      .set("Accept-Encoding", "identity");

    expect(plain.status).to.equal(200);
    expect(plain.headers["content-encoding"]).to.equal(undefined);
    expect(plain.body.projects).to.have.length(60);
  });

  // The error handler answers 500 for anything it does not recognise, so a
  // framework-thrown 4xx reaching the client is the thing worth pinning.
  it("forwards body-parser's own 4xx as JSON rather than flattening it to a 500", async () => {
    const malformed = await request(app)
      .post("/api/projects")
      .set("Content-Type", "application/json")
      .send('{"repo_owner": ');

    expect(malformed.status).to.equal(400);
    expect(malformed.headers["content-type"]).to.match(/json/);
    expect(malformed.body.error).to.be.a("string");

    // express.json defaults to a 100kb limit.
    const oversized = await request(app)
      .post("/api/projects")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ repo_owner: "x".repeat(200_000) }));

    expect(oversized.status).to.equal(413);
    expect(oversized.headers["content-type"]).to.match(/json/);
    expect(oversized.body.error).to.be.a("string");
  });
});
