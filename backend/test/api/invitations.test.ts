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

/**
 * `pool.connect()` has no injection seam, so the accept transaction gets its
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
      statements.push({ text: text.trim(), params });
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

describe("GET /api/invitations", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/invitations");

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });

  // The inbox is history: an invitation the caller declined, or one that ran out
  // of time, stays on screen with an explanation. `live` is what replaces the
  // filter — it carries the accept path's own predicate (IS NULL arm included,
  // so pre-TTL rows stay redeemable) to the client that decides where to offer
  // Accept.
  it("lists invitations that are no longer pending, and asks Postgres for live", async () => {
    installTestAuth();
    const seen: string[] = [];
    mockQuery((text) => {
      seen.push(text);
      return {
        rows: [
          { id: "inv-1", status: "pending", live: true },
          { id: "inv-2", status: "declined", live: false },
        ],
      };
    });

    const res = await request(app).get("/api/invitations").set(authHeader());

    expect(res.status).to.equal(200);
    expect(res.body.invitations.map((i: { status: string }) => i.status))
      .to.deep.equal(["pending", "declined"]);
    expect(seen[0]).to.include(
      "(pi.status = 'pending' AND (pi.expires_at IS NULL OR pi.expires_at > NOW())) AS live",
    );
    // The email match is the whole WHERE clause — a status or expiry predicate
    // creeping back in is what would silently empty the history again.
    expect(seen[0]).to.match(/WHERE LOWER\(pi\.email\) = LOWER\(\$1\)\s+ORDER BY/);
  });
});

describe("GET /api/invitations/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/invitations/some-uuid");

    expect(res.status).to.equal(401);
  });
});

describe("POST /api/invitations/:id/accept", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/invitations/some-uuid/accept")
      .send({ developer_role: "backend" });

    expect(res.status).to.equal(401);
  });

  // Found by the live probe: express.json leaves req.body undefined on a
  // bodyless POST, and the destructure 500'd before the transaction began.
  it("answers a bodyless accept with 404, not a destructure 500", async () => {
    installTestAuth();
    const original = pool.connect;
    (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    });
    try {
      const res = await request(app)
        .post("/api/invitations/44444444-4444-4444-4444-444444444444/accept")
        .set(authHeader());

      expect(res.status).to.equal(404);
    } finally {
      (pool as unknown as { connect: typeof original }).connect = original;
    }
  });

  // An accepted invitation left in the table showed the new member twice: once in
  // the roster, once in the invitation history beside it. The member row is the
  // record now, so accept deletes rather than stamping 'accepted'.
  it("deletes the invitation on accept instead of marking it accepted", async () => {
    installTestAuth();
    const ACCEPT_ID = "66666666-6666-6666-6666-666666666666";
    const PROJECT_ID = "88888888-8888-8888-8888-888888888888";
    const client = stubPoolClient((text) => {
      if (text.startsWith("SELECT * FROM project_invitations")) {
        return {
          rows: [{
            id: ACCEPT_ID,
            project_id: PROJECT_ID,
            // Addressed to the caller in a different case, as a real row can be.
            email: "Tester@Example.com",
            permission_tier: "developer",
            developer_role: "backend",
            status: "pending",
          }],
        };
      }
      if (text.startsWith("INSERT INTO project_members")) {
        return { rows: [{ project_id: PROJECT_ID, user_id: TEST_USER.id, permission_tier: "developer" }] };
      }
      if (text.startsWith("SELECT * FROM projects")) return { rows: [{ id: PROJECT_ID }] };
      return { rows: [] };
    });

    try {
      const res = await request(app)
        .post(`/api/invitations/${ACCEPT_ID}/accept`)
        .set(authHeader());

      expect(res.status).to.equal(200);
      expect(res.body.project.id).to.equal(PROJECT_ID);
      expect(res.body.member.user_id).to.equal(TEST_USER.id);

      const texts = client.statements.map((s) => s.text);
      expect(texts.filter((t) => t.includes("DELETE FROM project_invitations"))).to.have.lengthOf(1);
      expect(texts.some((t) => t.includes("SET status = 'accepted'"))).to.equal(false);
      // Both writes are one unit: a deleted invitation with no member row would
      // lock the invitee out of a project they were told they had joined.
      expect(texts[0]).to.equal("BEGIN");
      expect(texts[texts.length - 1]).to.equal("COMMIT");
    } finally {
      client.restore();
    }
  });
});

describe("DELETE /api/invitations/:invitationId", () => {
  afterEach(resetTestHarness);

  const INVITATION_ID = "77777777-7777-7777-7777-777777777777";

  /**
   * Serves one invitation row to the dismiss route and records every statement.
   * `row` is null for an id that matches nothing. Postgres evaluates `live`, so
   * an expired-pending row is a 'pending' row the database calls dead.
   */
  function installInvitation(row: { email: string; status: string; live: boolean } | null) {
    const statements: Array<{ text: string; params: unknown[] }> = [];
    installTestAuth();
    mockQuery((text, params = []) => {
      statements.push({ text, params: params as unknown[] });
      // Checked first: the DELETE names project_invitations too.
      if (text.includes("DELETE FROM project_invitations")) {
        return { rows: [], rowCount: row && !row.live ? 1 : 0 };
      }
      if (text.includes("FROM project_invitations")) {
        return { rows: row ? [{ id: INVITATION_ID, ...row }] : [] };
      }
      return { rows: [] };
    });
    return statements;
  }

  const dismiss = () =>
    request(app).delete(`/api/invitations/${INVITATION_ID}`).set(authHeader());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).delete(`/api/invitations/${INVITATION_ID}`);

    expect(res.status).to.equal(401);
  });

  it("answers 404 for an invitation id that matches nothing", async () => {
    const statements = installInvitation(null);

    const res = await dismiss();

    expect(res.status).to.equal(404);
    expect(statements.filter((s) => s.text.includes("DELETE FROM project_invitations"))).to.deep.equal([]);
  });

  // An invitation id is not a capability for anyone but its addressee — deleting
  // somebody else's row would clear it from their inbox and the team page both.
  it("refuses an invitation addressed to somebody else, and deletes nothing", async () => {
    const statements = installInvitation({
      email: "someone-else@example.com",
      status: "declined",
      live: false,
    });

    const res = await dismiss();

    expect(res.status).to.equal(403);
    expect(statements.filter((s) => s.text.includes("DELETE FROM project_invitations"))).to.deep.equal([]);
  });

  // Dismissing a live invitation would leave the inviter waiting on nothing.
  it("refuses a live invitation and points at Decline, deleting nothing", async () => {
    const statements = installInvitation({
      email: "tester@example.com",
      status: "pending",
      live: true,
    });

    const res = await dismiss();

    expect(res.status).to.equal(409);
    expect(res.body.error).to.include("Decline it instead");
    expect(statements.filter((s) => s.text.includes("DELETE FROM project_invitations"))).to.deep.equal([]);
  });

  it("dismisses a declined invitation", async () => {
    const statements = installInvitation({
      email: "TESTER@example.com",
      status: "declined",
      live: false,
    });

    const res = await dismiss();

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ success: true });
    const del = statements.find((s) => s.text.includes("DELETE FROM project_invitations"))!;
    expect(del.params).to.deep.equal([INVITATION_ID]);
    // The read is advisory; the write is what refuses a row that is still live.
    expect(del.text).to.include(
      "NOT (status = 'pending' AND (expires_at IS NULL OR expires_at > NOW()))",
    );
  });

  // The row that has no other way out: still 'pending', past its TTL, so neither
  // Accept nor Decline applies and only this route can clear it.
  it("dismisses an expired invitation that is still 'pending'", async () => {
    const statements = installInvitation({
      email: "tester@example.com",
      status: "pending",
      live: false,
    });

    const res = await dismiss();

    expect(res.status).to.equal(200);
    // Postgres decides liveness, so what a route test pins is that the route asks
    // for it with the accept path's own predicate, IS NULL arm included.
    const read = statements.find((s) => s.text.includes("SELECT id, email, status"))!;
    expect(read.text).to.include(
      "(status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())) AS live",
    );
  });
});

describe("POST /api/invitations/:invitationId/decline", () => {
  afterEach(resetTestHarness);

  const INVITATION_ID = "33333333-3333-3333-3333-333333333333";

  /** Serves one invitation row and records every statement the route ran. */
  function installInvitation(row: { email: string; status: string }) {
    const statements: string[] = [];
    installTestAuth();
    mockQuery((text) => {
      statements.push(text);
      if (text.startsWith("SELECT id, email, status")) {
        return { rows: [{ id: INVITATION_ID, ...row }] };
      }
      if (text.includes("UPDATE project_invitations")) {
        return { rows: [{ id: INVITATION_ID, status: "declined" }] };
      }
      return { rows: [] };
    });
    return statements;
  }

  const decline = () =>
    request(app).post(`/api/invitations/${INVITATION_ID}/decline`).set(authHeader());

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).post(`/api/invitations/${INVITATION_ID}/decline`);

    expect(res.status).to.equal(401);
  });

  // #72: 'declined' only became a legal status in migration 004. Writing it
  // against an un-migrated database is a CHECK violation and a 500, so this pins
  // the word the route writes — the migration and this line ship together.
  it("declines a pending invitation addressed to the caller", async () => {
    const statements = installInvitation({ email: "TESTER@example.com", status: "pending" });

    const res = await decline();

    expect(res.status).to.equal(200);
    expect(res.body.invitation.status).to.equal("declined");
    const write = statements.find((s) => s.includes("UPDATE project_invitations"))!;
    expect(write).to.include("SET status = 'declined'");
    // The write refuses to run against a row that stopped being pending.
    expect(write).to.include("AND status = 'pending'");
  });

  it("refuses an invitation addressed to somebody else", async () => {
    const statements = installInvitation({ email: "someone-else@example.com", status: "pending" });

    const res = await decline();

    expect(res.status).to.equal(403);
    expect(statements.filter((s) => s.includes("UPDATE project_invitations"))).to.deep.equal([]);
  });

  it("refuses an invitation that was already accepted", async () => {
    const statements = installInvitation({ email: "tester@example.com", status: "accepted" });

    const res = await decline();

    expect(res.status).to.equal(409);
    expect(res.body.error).to.include("accepted");
    expect(statements.filter((s) => s.includes("UPDATE project_invitations"))).to.deep.equal([]);
  });
});
