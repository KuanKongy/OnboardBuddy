import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { pool } from "../../src/lib/db.js";
import {
  TEST_USER,
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
} from "../helpers/testHarness.js";

const app = createApp();

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

/** What `requireProjectAccess` reads for a caller who owns this project. */
function ownerRow(permission_tier = "owner") {
  return {
    project_id: PROJECT_ID,
    user_id: TEST_USER.id,
    permission_tier,
    developer_role: "general",
    default_package_id: null,
  };
}

describe("GET /api/projects/:id/members", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${PROJECT_ID}/members`);

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });

  // Approvals and read marks are different facts from different tables; the
  // one-statement part is what a second round trip per member would undo.
  it("carries approvals and read marks for each member in one statement", async () => {
    installTestAuth();
    const statements: string[] = [];
    mockQuery((text) => {
      statements.push(text);
      if (text.includes("FROM project_members pm")) {
        return {
          rows: [{
            project_id: PROJECT_ID, user_id: TEST_USER.id, permission_tier: "developer",
            developer_role: "backend", joined_at: "2026-07-01T00:00:00.000Z",
            email: TEST_USER.email, github_username: null,
            sections_reviewed: 2, sections_read: 5,
          }],
        };
      }
      if (text.includes("FROM project_members")) return { rows: [ownerRow("developer")] };
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/members`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.members[0]).to.include({ sections_reviewed: 2, sections_read: 5 });

    const list = statements.find((s) => s.includes("sections_read"))!;
    expect(statements.filter((s) => s.includes("sections_read"))).to.have.lengthOf(1);
    // jsonb_typeof guard: a scalar readSections would 22023 the whole list.
    expect(list).to.include("up.user_id = pm.user_id AND up.project_id = pm.project_id");
    expect(list).to.include("jsonb_typeof(up.position -> 'readSections') = 'array'");
  });
});

describe("GET /api/projects/:id/members/invitations", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(
      `/api/projects/${PROJECT_ID}/members/invitations`,
    );

    expect(res.status).to.equal(401);
  });

  // Postgres evaluates the filter, so the predicate itself is what a route test
  // can assert; real expired rows are exercised by the live probe.
  it("filters expired invitations with the accept path's own predicate", async () => {
    installTestAuth();
    const seen: string[] = [];
    mockQuery((text) => {
      seen.push(text);
      if (text.includes("FROM project_members")) return { rows: [ownerRow()] };
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/projects/${PROJECT_ID}/members/invitations`)
      .set(authHeader());

    expect(res.status).to.equal(200);
    const list = seen.find((s) => s.includes("FROM project_invitations"))!;
    expect(list).to.include("(pi.expires_at IS NULL OR pi.expires_at > NOW())");
  });
});

describe("POST /api/projects/:id/members/invitations", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/members/invitations`)
      .send({ email: "invite@example.com", permission_tier: "developer" });

    expect(res.status).to.equal(401);
  });

  // Bug #66: the tier arrived from the request body and was inserted verbatim,
  // so an admin could mint a second owner on accept — walking around both the
  // "use ownership transfer" guard on the member PATCH and the "cannot remove
  // the owner" guard on the member DELETE, leaving an owner nobody could
  // remove. A typo'd tier reached the CHECK constraint and 500'd.
  it("refuses to invite an owner, and answers a typo'd tier with a 400 rather than a 500", async () => {
    installTestAuth();
    const writes: string[] = [];
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [ownerRow("admin")] };
      if (text.includes("INSERT INTO project_invitations")) {
        writes.push(text);
        return { rows: [{ id: "invitation-1" }] };
      }
      return { rows: [] };
    });

    const invite = (permission_tier: string) =>
      request(app)
        .post(`/api/projects/${PROJECT_ID}/members/invitations`)
        .set(authHeader())
        .send({ email: "invite@example.com", permission_tier });

    const asOwner = await invite("owner");
    const asTypo = await invite("develper");

    expect(asOwner.status).to.equal(400);
    expect(asTypo.status).to.equal(400);
    expect(writes, "no invitation row may be written for a rejected tier").to.have.lengthOf(0);
  });

  // The silent failure: the inviter gets a 201 and a pending row, the invitee
  // never gets an invitation they can redeem.
  it("stores a trimmed address and stamps the 14-day expiry", async () => {
    installTestAuth();
    const inserts: Array<{ text: string; params: unknown[] }> = [];
    mockQuery((text, params = []) => {
      if (text.includes("FROM project_members pm")) return { rows: [] };
      if (text.includes("FROM project_members")) return { rows: [ownerRow()] };
      if (text.includes("FROM project_invitations")) return { rows: [] };
      if (text.includes("INSERT INTO project_invitations")) {
        inserts.push({ text, params: params as unknown[] });
        return { rows: [{ id: "invitation-1" }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/members/invitations`)
      .set(authHeader())
      .send({ email: "  Bob@Acme.test \n", permission_tier: "developer" });

    expect(res.status).to.equal(201);
    expect(inserts).to.have.lengthOf(1);
    // Untrimmed, `LOWER(email) = LOWER($1)` on the invitee's inbox would miss it.
    expect(inserts[0]!.params[1]).to.equal("Bob@Acme.test");
    expect(inserts[0]!.text).to.include("expires_at");
    expect(inserts[0]!.params[5], "TTL in days").to.equal(14);
  });

  it("rejects a malformed address, your own address, and someone already on the team", async () => {
    installTestAuth();
    const writes: string[] = [];
    mockQuery((text) => {
      // The already-a-member lookup joins users; the generic branch below is
      // the access gate, whose text also names project_members.
      if (text.includes("FROM project_members pm")) return { rows: [{ "?column?": 1 }] };
      if (text.includes("FROM project_members")) return { rows: [ownerRow()] };
      if (text.includes("INSERT INTO project_invitations")) {
        writes.push(text);
        return { rows: [{ id: "invitation-1" }] };
      }
      return { rows: [] };
    });

    const invite = (email: string) =>
      request(app)
        .post(`/api/projects/${PROJECT_ID}/members/invitations`)
        .set(authHeader())
        .send({ email, permission_tier: "developer" });

    const malformed = await invite("bob@acme");
    const self = await invite(` ${TEST_USER.email.toUpperCase()} `);
    const member = await invite("teammate@acme.test");

    expect(malformed.status).to.equal(400);
    expect(self.status).to.equal(400);
    expect(member.status).to.equal(409);
    expect(writes, "none of these may write an invitation row").to.have.lengthOf(0);
  });

  // An expired-but-still-'pending' row is invisible in both lists, yet the partial
  // unique index blocks its replacement — a 409 with nothing on screen to revoke.
  it("replaces an expired pending invitation instead of refusing forever", async () => {
    installTestAuth();
    const statements: string[] = [];
    mockQuery((text) => {
      statements.push(text);
      if (text.includes("FROM project_members pm")) return { rows: [] };
      if (text.includes("FROM project_members")) return { rows: [ownerRow()] };
      if (text.includes("FROM project_invitations")) {
        return { rows: [{ id: "stale-invitation", live: false }] };
      }
      if (text.includes("INSERT INTO project_invitations")) return { rows: [{ id: "invitation-2" }] };
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/members/invitations`)
      .set(authHeader())
      .send({ email: "bob@acme.test", permission_tier: "developer" });

    expect(res.status).to.equal(201);
    expect(statements.some((s) => s.includes("SET status = 'expired'"))).to.equal(true);
  });

  it("refuses a second live invitation for the same address", async () => {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members pm")) return { rows: [] };
      if (text.includes("FROM project_members")) return { rows: [ownerRow()] };
      if (text.includes("FROM project_invitations")) {
        return { rows: [{ id: "live-invitation", live: true }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/members/invitations`)
      .set(authHeader())
      .send({ email: "bob@acme.test", permission_tier: "developer" });

    expect(res.status).to.equal(409);
  });
});

describe("PATCH /api/projects/:id/members/:userId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/members/some-user-id`)
      .send({ developer_role: "frontend" });

    expect(res.status).to.equal(401);
  });
});

/**
 * `pool.connect()` has no injection seam, so the transactional route gets its
 * client swapped on the pool for one test. Always restore in a `finally` — a
 * leaked stub silently breaks every later suite that uses the pool.
 */
function stubPoolClient(
  handler: (text: string, params: unknown[]) => { rows: unknown[] },
): { statements: Array<{ text: string; params: unknown[] }>; restore: () => void } {
  const statements: Array<{ text: string; params: unknown[] }> = [];
  const original = pool.connect;
  const fake = {
    query: async (text: string, params: unknown[] = []) => {
      statements.push({ text: text.trim().split("\n")[0]!.trim(), params });
      return handler(text.trim(), params);
    },
    release: () => {},
  };
  (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => fake;
  return {
    statements,
    restore: () => {
      (pool as unknown as { connect: typeof original }).connect = original;
    },
  };
}

describe("POST /api/projects/:id/members/:userId/transfer-ownership", () => {
  afterEach(resetTestHarness);

  const TARGET_ID = "44444444-4444-4444-4444-444444444444";

  /** The caller owns the project; everything else comes from the stub client. */
  function installOwnerCaller() {
    installTestAuth();
    mockQuery((text) => {
      if (text.includes("FROM project_members")) return { rows: [ownerRow()] };
      return { rows: [] };
    });
  }

  const transfer = (target = TARGET_ID) =>
    request(app)
      .post(`/api/projects/${PROJECT_ID}/members/${target}/transfer-ownership`)
      .set(authHeader());

  it("returns 401 when unauthenticated", async () => {
    const res = await transfer();

    expect(res.status).to.equal(401);
  });

  // `projects.user_id` has to move with the tiers: account deletion cascades owned
  // projects through it, so an old owner left there takes the project with them.
  it("swaps both tiers and moves projects.user_id, demoting before promoting", async () => {
    installOwnerCaller();
    const client = stubPoolClient((text) => {
      if (text.startsWith("SELECT user_id, permission_tier")) {
        return { rows: [{ user_id: TARGET_ID, permission_tier: "developer" }] };
      }
      if (text.startsWith("UPDATE project_members")) {
        // The demote names 'owner' in its WHERE clause, so match on the SET.
        const tier = text.includes("SET permission_tier = 'owner'") ? "owner" : "admin";
        return { rows: [{ user_id: "x", permission_tier: tier }] };
      }
      return { rows: [] };
    });

    try {
      const res = await transfer();

      expect(res.status).to.equal(200);
      expect(res.body.new_owner.permission_tier).to.equal("owner");
      expect(res.body.previous_owner.permission_tier).to.equal("admin");

      const script = client.statements.map((s) => s.text);
      expect(script[0]).to.equal("BEGIN");
      expect(script[script.length - 1]).to.equal("COMMIT");

      const demote = client.statements.findIndex((s) => s.text.includes("SET permission_tier = 'admin'"));
      const promote = client.statements.findIndex((s) => s.text.includes("SET permission_tier = 'owner'"));
      // Two owners must never coexist, not even inside the transaction.
      expect(demote).to.be.greaterThan(-1);
      expect(promote).to.be.greaterThan(demote);
      expect(client.statements[demote]!.params).to.deep.equal([PROJECT_ID, TEST_USER.id]);
      expect(client.statements[promote]!.params).to.deep.equal([PROJECT_ID, TARGET_ID]);

      const projectWrite = client.statements.find((s) => s.text.includes("UPDATE projects"))!;
      expect(projectWrite.params).to.deep.equal([TARGET_ID, PROJECT_ID]);
    } finally {
      client.restore();
    }
  });

  it("answers 404 for a user who is not a member of this project", async () => {
    installOwnerCaller();
    const client = stubPoolClient(() => ({ rows: [] }));

    try {
      const res = await transfer();

      expect(res.status).to.equal(404);
      expect(client.statements.map((s) => s.text)).to.include("ROLLBACK");
      expect(client.statements.some((s) => s.text.startsWith("UPDATE"))).to.equal(false);
    } finally {
      client.restore();
    }
  });

  it("answers 400 when the owner transfers to themselves", async () => {
    installOwnerCaller();
    const client = stubPoolClient(() => ({
      rows: [{ user_id: TEST_USER.id, permission_tier: "owner" }],
    }));

    try {
      const res = await transfer(TEST_USER.id);

      expect(res.status).to.equal(400);
      expect(client.statements.some((s) => s.text.startsWith("UPDATE"))).to.equal(false);
    } finally {
      client.restore();
    }
  });

  // A concurrent transfer leaves the demote matching no row; promoting anyway
  // would mint a second owner.
  it("rolls back and answers 409 when the caller is no longer the owner", async () => {
    installOwnerCaller();
    const client = stubPoolClient((text) => {
      if (text.startsWith("SELECT user_id, permission_tier")) {
        return { rows: [{ user_id: TARGET_ID, permission_tier: "developer" }] };
      }
      return { rows: [] };
    });

    try {
      const res = await transfer();

      expect(res.status).to.equal(409);
      expect(res.body.error).to.include("concurrently");
      const script = client.statements.map((s) => s.text);
      expect(script).to.include("ROLLBACK");
      expect(script).to.not.include("COMMIT");
      expect(script.some((s) => s.includes("SET permission_tier = 'owner'"))).to.equal(false);
    } finally {
      client.restore();
    }
  });

  // UNIQUE (user_id, repo_owner, repo_name): nothing rolls forward from here, so
  // the 409 has to name what is in the way.
  it("rolls back and explains the 409 when the new owner already has this repo", async () => {
    installOwnerCaller();
    const client = stubPoolClient((text) => {
      if (text.startsWith("SELECT user_id, permission_tier")) {
        return { rows: [{ user_id: TARGET_ID, permission_tier: "admin" }] };
      }
      if (text.startsWith("UPDATE projects")) {
        throw new Error(
          'duplicate key value violates unique constraint "projects_user_id_repo_owner_repo_name_key"',
        );
      }
      if (text.startsWith("UPDATE project_members")) {
        return { rows: [{ user_id: "x", permission_tier: "admin" }] };
      }
      return { rows: [] };
    });

    try {
      const res = await transfer();

      expect(res.status).to.equal(409);
      expect(res.body.error).to.include("already has a separate project");
      const script = client.statements.map((s) => s.text);
      expect(script).to.include("ROLLBACK");
      expect(script).to.not.include("COMMIT");
    } finally {
      client.restore();
    }
  });
});

describe("DELETE /api/projects/:id/members/me", () => {
  afterEach(resetTestHarness);

  /** Records every statement so the DELETE can be proven present or absent. */
  function installMemberOfTier(permission_tier: string) {
    const executed: Array<{ text: string; params: unknown[] }> = [];
    installTestAuth();
    mockQuery((text, params = []) => {
      executed.push({ text, params: params as unknown[] });
      if (text.includes("FROM project_members")) return { rows: [ownerRow(permission_tier)] };
      return { rows: [], rowCount: 1 };
    });
    return executed;
  }

  const leave = () =>
    request(app).delete(`/api/projects/${PROJECT_ID}/members/me`).set(authHeader());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).delete(`/api/projects/${PROJECT_ID}/members/me`);

    expect(res.status).to.equal(401);
  });

  // A 404 here means `/me` fell through to `delete("/:userId")`, whose
  // requireUuidParam rejects the literal segment.
  it("removes a developer's own membership", async () => {
    const executed = installMemberOfTier("developer");

    const res = await leave();

    expect(res.status).to.equal(200);
    const deletes = executed.filter((q) => q.text.includes("DELETE FROM project_members"));
    expect(deletes).to.have.lengthOf(1);
    expect(deletes[0]!.params).to.deep.equal([PROJECT_ID, TEST_USER.id]);
  });

  // An ownerless project is not a state the rest of the system answers for.
  it("refuses to let the owner walk out, and deletes nothing", async () => {
    const executed = installMemberOfTier("owner");

    const res = await leave();

    expect(res.status).to.equal(403);
    expect(res.body.error).to.include("Transfer ownership");
    expect(executed.filter((q) => q.text.includes("DELETE FROM project_members"))).to.deep.equal([]);
  });
});

describe("DELETE /api/projects/:id/members/:userId", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).delete(
      `/api/projects/${PROJECT_ID}/members/some-user-id`,
    );

    expect(res.status).to.equal(401);
  });

  it("answers a non-uuid :userId with 404, not a 500 from a uuid cast", async () => {
    installTestAuth();
    const queries: string[] = [];
    mockQuery((text) => {
      queries.push(text);
      if (text.includes("FROM project_members")) return { rows: [ownerRow()] };
      return { rows: [] };
    });

    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/members/not-a-uuid`)
      .set(authHeader());

    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({ error: "Not found" });
    // The membership lookup is the access gate; nothing keyed on the bad id ran.
    expect(queries.filter((q) => q.includes("DELETE FROM project_members"))).to.deep.equal([]);
  });
});
