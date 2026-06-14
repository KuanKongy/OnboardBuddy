import { Router } from "express";
import { pool, query } from "../../lib/db.js";

export const invitationsRouter = Router();

invitationsRouter.get("/", async (req, res) => {
  try {
    const email = req.user!.email;

    const result = await query(
      `SELECT pi.*, p.repo_owner, p.repo_name, p.branch,
              u.email AS invited_by_email
       FROM project_invitations pi
       INNER JOIN projects p ON p.id = pi.project_id
       LEFT JOIN users u ON u.id = pi.invited_by
       WHERE LOWER(pi.email) = LOWER($1) AND pi.status = 'pending'
       ORDER BY pi.created_at DESC`,
      [email],
    );

    res.json({ invitations: result.rows });
  } catch (err) {
    console.error("List invitations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

invitationsRouter.get("/:invitationId", async (req, res) => {
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

invitationsRouter.post("/:invitationId/accept", async (req, res) => {
  const client = await pool.connect();
  try {
    const { invitationId } = req.params;
    const userId = req.user!.id;
    const email = req.user!.email;
    const { developer_role } = req.body as { developer_role?: string };

    await client.query("BEGIN");

    const invResult = await client.query(
      `SELECT * FROM project_invitations WHERE id = $1 FOR UPDATE`,
      [invitationId],
    );

    if (invResult.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Invitation not found" });
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

    if (invitation.status !== "pending") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: `Invitation has already been ${invitation.status}` });
      return;
    }

    const role = invitation.developer_role ?? developer_role;
    if (!role) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "developer_role is required" });
      return;
    }

    await client.query(
      `UPDATE project_invitations
       SET status = 'accepted', accepted_by = $1, accepted_at = NOW()
       WHERE id = $2`,
      [userId, invitationId],
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
    await client.query("ROLLBACK");
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
