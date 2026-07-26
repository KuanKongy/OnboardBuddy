import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import {
  BadPackageParamError,
  PackageNotFoundError,
  readPackageParam,
  resolvePackageContext,
} from "../../src/api/services/packageResolver.js";
import { startRun, recordSkippedCached, type RunIdentity } from "../../src/worker/ai/generationRuns.js";
import { authHeader, installTestAuth, mockQuery, resetTestHarness, TEST_USER } from "../helpers/testHarness.js";

const app = createApp();
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const PKG_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_PKG_ID = "44444444-4444-4444-4444-444444444444";
const SNAP_ID = "55555555-5555-5555-5555-555555555555";
const SCOPE_ID = "66666666-6666-6666-6666-666666666666";

const PKG_ROW = {
  package_id: PKG_ID,
  snapshot_id: SNAP_ID,
  scope_id: SCOPE_ID,
  role: "backend",
  branch: "dev",
  commit_hash: "abc1234def",
};

const MEMBER_ROW = {
  project_id: PROJECT_ID,
  user_id: TEST_USER.id,
  permission_tier: "owner",
  developer_role: "backend",
  default_package_id: null as string | null,
};

describe("packageResolver", () => {
  afterEach(() => resetTestHarness());

  describe("readPackageParam", () => {
    it("returns undefined when absent or empty", () => {
      expect(readPackageParam(undefined)).to.equal(undefined);
      expect(readPackageParam("")).to.equal(undefined);
      expect(readPackageParam(null)).to.equal(undefined);
    });

    it("accepts a UUID and rejects garbage", () => {
      expect(readPackageParam(PKG_ID)).to.equal(PKG_ID);
      expect(() => readPackageParam("not-a-uuid")).to.throw(BadPackageParamError);
      expect(() => readPackageParam(["a", "b"])).to.throw(BadPackageParamError);
    });
  });

  describe("resolvePackageContext fallback chain", () => {
    it("explicit package_id wins and never falls back", async () => {
      mockQuery((text, params) => {
        if (text.includes("WHERE op.id = $1 AND op.project_id = $2")) {
          expect(params).to.deep.equal([PKG_ID, PROJECT_ID]);
          return { rows: [PKG_ROW] };
        }
        throw new Error(`unexpected query: ${text}`);
      });
      const ctx = await resolvePackageContext({ projectId: PROJECT_ID, userId: TEST_USER.id, packageId: PKG_ID });
      expect(ctx).to.deep.include({
        packageId: PKG_ID,
        snapshotId: SNAP_ID,
        branch: "dev",
        source: "explicit",
      });
    });

    it("throws PackageNotFoundError for an explicit id outside the project", async () => {
      mockQuery((text) => {
        if (text.includes("WHERE op.id = $1")) return { rows: [] };
        throw new Error(`unexpected query: ${text}`);
      });
      try {
        await resolvePackageContext({ projectId: PROJECT_ID, packageId: OTHER_PKG_ID });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.be.instanceOf(PackageNotFoundError);
      }
    });

    it("falls back to the caller's member default", async () => {
      mockQuery((text) => {
        if (text.includes("pm.default_package_id = op.id")) return { rows: [PKG_ROW] };
        throw new Error(`unexpected query: ${text}`);
      });
      const ctx = await resolvePackageContext({ projectId: PROJECT_ID, userId: TEST_USER.id });
      expect(ctx?.source).to.equal("member_default");
      expect(ctx?.snapshotId).to.equal(SNAP_ID);
    });

    it("falls back to the latest complete snapshot when no default is set", async () => {
      mockQuery((text) => {
        if (text.includes("pm.default_package_id = op.id")) return { rows: [] };
        if (text.includes("FROM analysis_snapshots")) {
          return { rows: [{ id: SNAP_ID, scope_id: SCOPE_ID, branch: "main", commit_hash: "abc1234def" }] };
        }
        if (text.includes("WHERE snapshot_id = $1")) return { rows: [] }; // no package yet
        throw new Error(`unexpected query: ${text}`);
      });
      const ctx = await resolvePackageContext({ projectId: PROJECT_ID, userId: TEST_USER.id });
      expect(ctx?.source).to.equal("latest");
      expect(ctx?.packageId).to.equal(null);
      expect(ctx?.snapshotId).to.equal(SNAP_ID);
    });

    it("returns null when nothing has been analyzed", async () => {
      mockQuery((text) => {
        if (text.includes("pm.default_package_id")) return { rows: [] };
        if (text.includes("FROM analysis_snapshots")) return { rows: [] };
        throw new Error(`unexpected query: ${text}`);
      });
      const ctx = await resolvePackageContext({ projectId: PROJECT_ID, userId: TEST_USER.id });
      expect(ctx).to.equal(null);
    });

    /**
     * Bugs #77 / #80: an unfinished package generation left the newest
     * snapshot on 'paused'. The chain ended at "latest complete", found none,
     * and Architecture / Dependencies / Tutorials / Classes all 404'd — over
     * extraction that had completed.
     */
    it("skips a paused newest snapshot for the last complete one, and says so", async () => {
      const PAUSED_SNAP = "77777777-7777-7777-7777-777777777777";
      mockQuery((text) => {
        if (text.includes("pm.default_package_id = op.id")) return { rows: [] };
        if (text.includes("FROM analysis_snapshots")) {
          return {
            rows: [
              { id: PAUSED_SNAP, scope_id: SCOPE_ID, branch: "main", commit_hash: "newcommit", status: "paused" },
              { id: SNAP_ID, scope_id: SCOPE_ID, branch: "main", commit_hash: "abc1234def", status: "complete" },
            ],
          };
        }
        if (text.includes("WHERE snapshot_id = $1")) return { rows: [{ id: PKG_ID, role: "backend", branch: "dev" }] };
        throw new Error(`unexpected query: ${text}`);
      });

      const ctx = await resolvePackageContext({ projectId: PROJECT_ID, userId: TEST_USER.id });
      expect(ctx?.snapshotId).to.equal(SNAP_ID);
      expect(ctx?.packageId).to.equal(PKG_ID);
      expect(ctx?.snapshotStatus).to.equal("complete");
      // Degrading is never silent — the caller can tell the reader which
      // analysis it is looking at and why it is not the newest.
      expect(ctx?.servingOlderSnapshot).to.equal(true);
      expect(ctx?.newerSnapshotStatus).to.equal("paused");
    });

    it("still serves a paused snapshot when no complete one exists, flagged as such", async () => {
      const PAUSED_SNAP = "77777777-7777-7777-7777-777777777777";
      mockQuery((text) => {
        if (text.includes("pm.default_package_id = op.id")) return { rows: [] };
        if (text.includes("FROM analysis_snapshots")) {
          return {
            rows: [{ id: PAUSED_SNAP, scope_id: SCOPE_ID, branch: "main", commit_hash: "newcommit", status: "paused" }],
          };
        }
        if (text.includes("WHERE snapshot_id = $1")) return { rows: [] };
        throw new Error(`unexpected query: ${text}`);
      });

      // The extracted data on this snapshot is real (#80 measured 71 workflows
      // on exactly this shape), so a 404 was the wrong answer.
      const ctx = await resolvePackageContext({ projectId: PROJECT_ID, userId: TEST_USER.id });
      expect(ctx?.snapshotId).to.equal(PAUSED_SNAP);
      expect(ctx?.snapshotStatus).to.equal("paused");
      expect(ctx?.servingOlderSnapshot).to.equal(false);
    });
  });

  describe("feature endpoints honor ?package_id=", () => {
    it("GET /capabilities 404s on an unknown explicit package", async () => {
      installTestAuth();
      mockQuery((text) => {
        if (text.includes("FROM project_members")) return { rows: [MEMBER_ROW] };
        if (text.includes("WHERE op.id = $1")) return { rows: [] };
        return { rows: [] };
      });
      const res = await request(app)
        .get(`/api/projects/${PROJECT_ID}/capabilities?package_id=${OTHER_PKG_ID}`)
        .set(authHeader());
      expect(res.status).to.equal(404);
      expect(res.body.error).to.include("Package not found");
    });

    it("GET /capabilities 400s on a malformed package_id", async () => {
      installTestAuth();
      mockQuery((text) => {
        if (text.includes("FROM project_members")) return { rows: [MEMBER_ROW] };
        return { rows: [] };
      });
      const res = await request(app)
        .get(`/api/projects/${PROJECT_ID}/capabilities?package_id=garbage`)
        .set(authHeader());
      expect(res.status).to.equal(400);
    });
  });
});

describe("PUT /api/projects/:id/default-package", () => {
  afterEach(() => resetTestHarness());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).put(`/api/projects/${PROJECT_ID}/default-package`);
    expect(res.status).to.equal(401);
  });

  it("validates the package belongs to the project", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [MEMBER_ROW] };
      if (text.includes("FROM onboarding_packages WHERE id = $1")) return { rows: [] };
      return { rows: [] };
    });
    const res = await request(app)
      .put(`/api/projects/${PROJECT_ID}/default-package`)
      .set(authHeader())
      .send({ package_id: OTHER_PKG_ID });
    expect(res.status).to.equal(404);
  });

  it("sets the caller's own member default", async () => {
    installTestAuth();
    let updateParams: unknown[] | undefined;
    mockQuery((text, params) => {
      if (text.includes("FROM project_members")) return { rows: [MEMBER_ROW] };
      if (text.includes("FROM onboarding_packages WHERE id = $1")) return { rows: [{ id: PKG_ID }] };
      if (text.includes("UPDATE project_members SET default_package_id")) {
        updateParams = params;
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await request(app)
      .put(`/api/projects/${PROJECT_ID}/default-package`)
      .set(authHeader())
      .send({ package_id: PKG_ID });
    expect(res.status).to.equal(200);
    expect(res.body.default_package_id).to.equal(PKG_ID);
    expect(updateParams).to.deep.equal([PROJECT_ID, TEST_USER.id, PKG_ID]);
  });

  it("clears the default with null", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [MEMBER_ROW] };
      if (text.includes("UPDATE project_members SET default_package_id")) return { rows: [] };
      return { rows: [] };
    });
    const res = await request(app)
      .put(`/api/projects/${PROJECT_ID}/default-package`)
      .set(authHeader())
      .send({ package_id: null });
    expect(res.status).to.equal(200);
    expect(res.body.default_package_id).to.equal(null);
  });
});

describe("GET /api/projects/:id/runs", () => {
  afterEach(() => resetTestHarness());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/runs`);
    expect(res.status).to.equal(401);
  });

  it("maps job rows into run entries with per-job cost and sections", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [MEMBER_ROW] };
      if (text.includes("FROM analysis_jobs aj")) {
        return {
          rows: [{
            id: "77777777-7777-7777-7777-777777777777",
            job_type: "generate_package",
            status: "complete",
            progress_pct: 100,
            current_step: "Onboarding package ready",
            error_message: null,
            snapshot_id: SNAP_ID,
            role: "backend",
            requested_branch: "dev",
            requested_commit: null,
            requested_depth: "standard",
            created_at: "2026-07-15T10:00:00Z",
            started_at: "2026-07-15T10:00:05Z",
            finished_at: "2026-07-15T10:03:05Z",
            attempt: 1,
            step_log: [{ step: "Generating sections (0/11)", pct: 15, ts: "2026-07-15T10:00:10Z" }],
            section_type: null,
            duration_ms: "180000",
            requested_by_email: TEST_USER.email,
            snapshot_branch: "main",
            snapshot_commit: "abc1234def",
            scope_path: "backend",
            scope_name: "backend",
            llm_calls: 41,
            cached_calls: 30,
            input_tokens: "812345",
            output_tokens: "90312",
            estimated_cost_usd: "0.4312",
            package_id: PKG_ID,
            package_role: "backend",
            package_branch: "dev",
            package_status: "draft",
            generated_sections: ["start_here", "architecture"],
            cached_sections: ["data_schema"],
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/runs?limit=5`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.runs).to.have.length(1);
    const run = res.body.runs[0];
    expect(run.job_type).to.equal("generate_package");
    expect(run.duration_ms).to.equal(180000);
    expect(run.cost).to.deep.equal({
      estimated_cost_usd: 0.4312,
      llm_calls: 41,
      cached_calls: 30,
      input_tokens: 812345,
      output_tokens: 90312,
    });
    expect(run.sections.generated).to.deep.equal(["start_here", "architecture"]);
    expect(run.sections.cached).to.deep.equal(["data_schema"]);
    expect(run.package).to.deep.equal({ id: PKG_ID, role: "backend", branch: "dev", status: "draft" });
    expect(run.config.branch).to.equal("main"); // resolved snapshot branch wins over requested
  });
});

describe("ai_generation_runs job attribution", () => {
  afterEach(() => resetTestHarness());

  const identity: RunIdentity = {
    snapshotId: SNAP_ID,
    packageId: PKG_ID,
    jobId: "88888888-8888-8888-8888-888888888888",
    targetType: "section",
    sectionType: "start_here",
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    modelTier: "strong",
    keySource: "server",
    promptVersion: "v1",
    inputHash: "deadbeef",
  };

  it("startRun inserts job_id", async () => {
    let captured: { text: string; params?: unknown[] } | undefined;
    mockQuery((text, params) => {
      captured = { text, params };
      return { rows: [{ id: "run-1" }] };
    });
    await startRun(identity);
    expect(captured!.text).to.include("job_id");
    expect(captured!.params).to.include(identity.jobId);
  });

  it("recordSkippedCached inserts job_id too", async () => {
    let captured: { text: string; params?: unknown[] } | undefined;
    mockQuery((text, params) => {
      captured = { text, params };
      return { rows: [{ id: "run-2" }] };
    });
    await recordSkippedCached(identity);
    expect(captured!.text).to.include("job_id");
    expect(captured!.params).to.include(identity.jobId);
  });
});
