import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { explanationFromSummary } from "../../src/api/routes/graph.js";

const app = createApp();
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("GET /api/projects/:id/graph/dependencies", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/graph/dependencies`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/projects/:id/graph/nodes/:nodeId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/graph/nodes/some-node-id`);
    expect(res.status).to.equal(401);
  });

  it("returns 401 for stable_key style node ids", async () => {
    const res = await request(app).get(
      `/api/projects/${PROJECT_ID}/graph/nodes/${encodeURIComponent("src/index.ts")}`,
    );
    expect(res.status).to.equal(401);
  });
});

describe("GET /api/projects/:id/graph/architecture", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/graph/architecture`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("GET /api/projects/:id/graph/classes", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/graph/classes`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

describe("explanationFromSummary", () => {
  /**
   * 54% of the fleet's class/interface records are facts-only, and their
   * summary is built as `<Name>: <kind> '<Name>' (<signals>)` — the name in
   * the panel heading and the kind in the badge, nothing else. Showing that as
   * "what this does" is exactly the restatement owner H1 rules out, so it must
   * come back as absent rather than as text.
   */
  it("keeps a real purpose and rejects the facts-only restatement of the label", () => {
    expect([
      explanationFromSummary("ValidationOutcome: Represents the outcome of validating generated content.", {
        factsOnly: false,
        strip: ["src/a.ts#ValidationOutcome", "ValidationOutcome"],
      }),
      explanationFromSummary("GitHubUser: interface 'GitHubUser' (github_integration)", {
        factsOnly: true,
        strip: ["src/lib/github.ts#GitHubUser", "GitHubUser"],
      }),
    ]).to.deep.equal(["Represents the outcome of validating generated content.", null]);
  });
});

describe("GET /api/projects/:id/graph/workflows/:workflowId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(
      `/api/projects/${PROJECT_ID}/graph/workflows/00000000-0000-0000-0000-000000000002`,
    );
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});
