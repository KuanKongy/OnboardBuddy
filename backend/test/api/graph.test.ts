import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { explanationFromSummary } from "../../src/api/routes/graph.js";
import {
  TEST_PROJECT_ID,
  TEST_USER,
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
} from "../helpers/testHarness.js";

const app = createApp();
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("GET /api/projects/:id/graph/dependencies", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/graph/dependencies`);
    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });
});

/**
 * Bug #70 regression pin. `dependentCount` was hardcoded to 0 in the grouped
 * view, so on every project the default screen read "N imports · 0 imported by"
 * for each group while the canvas drew arrows into it. Nothing covered it, and
 * a zero is the easiest value in the world to reintroduce.
 */
describe("GET /api/projects/:id/graph/dependencies — grouped view (bug #70)", () => {
  afterEach(resetTestHarness);

  const SNAPSHOT_ID = "aaaaaaaa-0000-0000-0000-00000000000a";

  /** Two directories over the 60-node clustering threshold, wired one way. */
  function graphFixture() {
    const nodes = [
      ...Array.from({ length: 31 }, (_, i) => ({
        id: `back-${i}`, stable_key: `backend/src/a${i}.ts`, type: "module",
        name: `a${i}.ts`, file_path: `backend/src/a${i}.ts`, metadata: { importCount: 3 },
      })),
      ...Array.from({ length: 31 }, (_, i) => ({
        id: `front-${i}`, stable_key: `frontend/src/b${i}.ts`, type: "module",
        name: `b${i}.ts`, file_path: `frontend/src/b${i}.ts`, metadata: { importCount: 1 },
      })),
    ];
    const edges = [
      // Cross-directory: frontend imports backend. These are the arrows the
      // grouped view draws, and the population `dependentCount` must count.
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `cross-${i}`, source_node_id: `front-${i}`, target_node_id: `back-${i}`,
        type: "imports", weight: 1,
      })),
      // Internal to backend/src: counted separately, never as "imported by".
      { id: "internal-1", source_node_id: "back-0", target_node_id: "back-1", type: "imports", weight: 1 },
    ];
    return { nodes, edges };
  }

  it("counts cross-directory inbound edges as dependentCount instead of reporting zero", async () => {
    installTestAuth();
    const { nodes, edges } = graphFixture();
    mockQuery((text) => {
      // Member-default resolution also joins project_members, so the access
      // check has to be matched by its own column list first.
      if (text.includes("pm.default_package_id = op.id")) return { rows: [] };
      if (text.includes("FROM project_members")) {
        return {
          rows: [{
            project_id: TEST_PROJECT_ID, user_id: TEST_USER.id,
            permission_tier: "developer", developer_role: "general", default_package_id: null,
          }],
        };
      }
      if (text.includes("FROM analysis_snapshots s")) {
        return { rows: [{ id: SNAPSHOT_ID, scope_id: null, branch: "main", commit_hash: "abc", status: "complete" }] };
      }
      if (text.includes("FROM onboarding_packages")) return { rows: [] };
      if (text.includes("FROM graph_nodes") && text.includes("type = 'module'")) return { rows: nodes };
      if (text.includes("FROM graph_edges")) return { rows: edges };
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${TEST_PROJECT_ID}/graph/dependencies`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.clustered).to.equal(true);
    const byDir = new Map<string, { importCount: number; dependentCount: number; internalImportCount: number }>(
      (res.body.graph.nodes as Array<{ metadata: { directory: string; importCount: number; dependentCount: number; internalImportCount: number } }>)
        .map((n) => [n.metadata.directory, n.metadata]),
    );

    // The bug: this read 0 while four arrows pointed at the group.
    expect(byDir.get("backend/src")!.dependentCount).to.equal(4);
    // The paired half — both numbers count links that CROSS the boundary, so
    // backend/src's own internal import does not inflate either of them.
    expect(byDir.get("backend/src")!.importCount).to.equal(0);
    expect(byDir.get("backend/src")!.internalImportCount).to.equal(1);
    expect(byDir.get("frontend/src")!.importCount).to.equal(4);
    expect(byDir.get("frontend/src")!.dependentCount).to.equal(0);
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
