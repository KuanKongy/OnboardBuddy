import { expect } from "chai";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { pool } from "../../src/lib/db.js";
import {
  authHeader,
  installTestAuth,
  mockQuery,
  resetTestHarness,
} from "../helpers/testHarness.js";

const app = createApp();

describe("GET /api/invitations", () => {
  afterEach(resetTestHarness);

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/invitations");

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property("error");
  });

  // Copied from the accept path, including the IS NULL arm that keeps pre-TTL
  // rows redeemable.
  it("filters expired invitations with the accept path's own predicate", async () => {
    installTestAuth();
    const seen: string[] = [];
    mockQuery((text) => {
      seen.push(text);
      return { rows: [] };
    });

    const res = await request(app).get("/api/invitations").set(authHeader());

    expect(res.status).to.equal(200);
    expect(seen[0]).to.include("(pi.expires_at IS NULL OR pi.expires_at > NOW())");
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
        return { rows: [{ id: INVITATION_ID, status: "revoked" }] };
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

  // #72: the CHECK has no 'declined'; 'revoked' is the terminal stand-in, so this
  // also pins that the route writes a value the constraint accepts.
  it("retires a pending invitation addressed to the caller", async () => {
    const statements = installInvitation({ email: "TESTER@example.com", status: "pending" });

    const res = await decline();

    expect(res.status).to.equal(200);
    expect(res.body.invitation.status).to.equal("revoked");
    const write = statements.find((s) => s.includes("UPDATE project_invitations"))!;
    expect(write).to.include("SET status = 'revoked'");
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
