import { Router } from "express";
import { pool, query } from "../../lib/db.js";
import { INVITABLE_TIERS, isDeveloperRole, isInvitableTier } from "../lib/permissionTiers.js";
import { requireUuidParam } from "../middleware/requireUuidParam.js";

export const invitationsRouter = Router();

invitationsRouter.get("/", async (req, res) => {
  try {
    const email = req.user!.email;

    // The inbox is history, not a work queue: declined and expired invitations
    // stay listed so "what happened to that invite?" has an answer on screen.
    // `live` carries what the filter used to decide — it is the accept path's
    // own predicate (the IS NULL arm keeps pre-TTL rows valid), so the client
    // can offer Accept exactly where Accept would succeed. Accept itself still
    // re-checks; this column is presentation, not authorization.
    const result = await query(
      `SELECT pi.*, p.repo_owner, p.repo_name, p.branch,
              u.email AS invited_by_email,
              (pi.status = 'pending' AND (pi.expires_at IS NULL OR pi.expires_at > NOW())) AS live
       FROM project_invitations pi
       INNER JOIN projects p ON p.id = pi.project_id
       LEFT JOIN users u ON u.id = pi.invited_by
       WHERE LOWER(pi.email) = LOWER($1)
       ORDER BY pi.created_at DESC
       LIMIT 100`,
      [email],
    );

    res.json({ invitations: result.rows });
  } catch (err) {
    console.error("List invitations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

invitationsRouter.get("/:invitationId", requireUuidParam("invitationId"), async (req, res) => {
  try {
    const { invitationId } = req.params;
    const email = req.user!.email;

    const result = await query(
      `SELECT pi.*, p.repo_owner, p.repo_name, p.branch
       FROM project_invitations pi
       INNER JOIN projects p ON p.id = pi.project_id
       WHERE pi.id = $1`,
      [invitationId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    const invitation = result.rows[0] as { email: string };
    if (invitation.email.toLowerCase() !== email.toLowerCase()) {
      res.status(403).json({ error: "This invitation is not for your account" });
      return;
    }

    res.json({ invitation: result.rows[0] });
  } catch (err) {
    console.error("Get invitation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// #72: migration 004 added the 'declined' arm to the status CHECK, so a refusal
// is no longer recorded as if an admin had revoked it. Declines written before
// that migration are still sitting in the table as 'revoked' and read as
// revocations — they are indistinguishable from real ones, so nothing backfills
// them.
// No expiry guard, unlike accept: a stale invitation is still discardable.
invitationsRouter.post("/:invitationId/decline", requireUuidParam("invitationId"), async (req, res) => {
  try {
    const { invitationId } = req.params;
    const email = req.user!.email;

    const invResult = await query(
      `SELECT id, email, status FROM project_invitations WHERE id = $1`,
      [invitationId],
    );

    if (invResult.rows.length === 0) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    const invitation = invResult.rows[0] as { email: string; status: string };

    // An invitation id is not a capability for anyone but its addressee.
    if (invitation.email.toLowerCase() !== email.toLowerCase()) {
      res.status(403).json({ error: "This invitation is not for your account" });
      return;
    }

    if (invitation.status !== "pending") {
      res.status(409).json({ error: `Invitation has already been ${invitation.status}` });
      return;
    }

    // The write is the arbiter: an accept landing since the read above must not
    // be overwritten with a decline.
    const result = await query(
      `UPDATE project_invitations
       SET status = 'declined'
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [invitationId],
    );

    if (result.rows.length === 0) {
      res.status(409).json({ error: "Invitation is no longer pending" });
      return;
    }

    res.json({ invitation: result.rows[0] });
  } catch (err) {
    console.error("Decline invitation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Dismiss: a dead invitation (revoked, declined, or expired) is the invitee's to
// clear out. Only one row backs both views, so this takes the entry off the
// project's team page as well as out of the inbox — which is the point, since a
// refusal nobody can tidy away is what kept both lists growing.
// A live pending invitation is not dismissible: declining it is the answer, and
// silently deleting it would leave the inviter waiting on nothing.
invitationsRouter.delete("/:invitationId", requireUuidParam("invitationId"), async (req, res) => {
  try {
    const { invitationId } = req.params;
    const email = req.user!.email;

    // Same liveness predicate as the inbox and the accept path, evaluated by
    // Postgres so "expired" means expired by the database's clock.
    const invResult = await query(
      `SELECT id, email, status, expires_at,
              (status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())) AS live
       FROM project_invitations
       WHERE id = $1`,
      [invitationId],
    );

    if (invResult.rows.length === 0) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    const invitation = invResult.rows[0] as { email: string; live: boolean };

    // An invitation id is not a capability for anyone but its addressee.
    if (invitation.email.toLowerCase() !== email.toLowerCase()) {
      res.status(403).json({ error: "This invitation is not for your account" });
      return;
    }

    if (invitation.live) {
      res.status(409).json({ error: "This invitation is still pending. Decline it instead." });
      return;
    }

    // The write re-checks liveness: resend writes a new id rather than reviving
    // this one, so nothing should be able to re-liven the row between the read
    // and here — but the delete is the arbiter, not the read.
    const result = await query(
      `DELETE FROM project_invitations
       WHERE id = $1 AND NOT (status = 'pending' AND (expires_at IS NULL OR expires_at > NOW()))`,
      [invitationId],
    );

    if (result.rowCount === 0) {
      res.status(409).json({ error: "This invitation is still pending. Decline it instead." });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Dismiss invitation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

invitationsRouter.post("/:invitationId/accept", requireUuidParam("invitationId"), async (req, res) => {
  let client: import("pg").PoolClient | undefined;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error("Accept invitation: failed to acquire DB connection:", err);
    res.status(503).json({ error: "Service temporarily unavailable" });
    return;
  }
  try {
    const { invitationId } = req.params;
    const userId = req.user!.id;
    const email = req.user!.email;
    // express.json leaves req.body undefined on a bodyless POST.
    const { developer_role } = (req.body ?? {}) as { developer_role?: string };

    await client.query("BEGIN");

    const invResult = await client.query(
      `SELECT * FROM project_invitations
       WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())
       FOR UPDATE`,
      [invitationId],
    );

    if (invResult.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Invitation not found or expired" });
      return;
    }

    const invitation = invResult.rows[0] as {
      id: string;
      project_id: string;
      email: string;
      permission_tier: string;
      developer_role: string | null;
      status: string;
    };

    if (invitation.email.toLowerCase() !== email.toLowerCase()) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: "This invitation is not for your account" });
      return;
    }

    // Accept deletes the row rather than marking it 'accepted', so this arm is
    // not dead code: revoked, declined and expired rows still reach it, and the
    // deployed Milestone4 app is still writing 'accepted' into the same table.
    if (invitation.status !== "pending") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: `Invitation has already been ${invitation.status}` });
      return;
    }

    // The tier is re-checked on the way *out* of the table, not only on the
    // way in (#66): rows written before the invitation route whitelisted its
    // input can still be sitting here pending, and this is the statement that
    // turns one into real permissions. An owner invitation can no longer be
    // redeemed at all — ownership moves by transfer.
    if (!isInvitableTier(invitation.permission_tier)) {
      await client.query("ROLLBACK");
      res.status(400).json({
        error: `This invitation grants an unsupported permission tier (${invitation.permission_tier}). Ask an admin to re-send it as one of: ${INVITABLE_TIERS.join(", ")}.`,
      });
      return;
    }

    const role = invitation.developer_role ?? developer_role;
    if (!role) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "developer_role is required" });
      return;
    }
    // A role the schema does not allow would otherwise fail on the CHECK
    // constraint and surface as a 500 for what is a bad request body.
    if (!isDeveloperRole(role)) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Invalid developer_role" });
      return;
    }

    // Once the invitation is redeemed the member row IS the record of it, and an
    // 'accepted' row left behind put the same person on screen twice — once in the
    // roster, once in the invitation history beside it. So the row goes, and with
    // it accepted_by/accepted_at (the columns stay: the schema is frozen). The
    // cost is that re-POSTing this id now answers "not found or expired" rather
    // than "already accepted".
    await client.query(
      `DELETE FROM project_invitations WHERE id = $1`,
      [invitationId],
    );

    const memberResult = await client.query(
      `INSERT INTO project_members (project_id, user_id, permission_tier, developer_role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [invitation.project_id, userId, invitation.permission_tier, role],
    );

    const projectResult = await client.query(
      `SELECT * FROM projects WHERE id = $1`,
      [invitation.project_id],
    );

    await client.query("COMMIT");

    res.json({
      project: projectResult.rows[0],
      member: memberResult.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof Error && err.message.includes("duplicate key")) {
      res.status(409).json({ error: "You are already a member of this project" });
      return;
    }
    console.error("Accept invitation error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});
