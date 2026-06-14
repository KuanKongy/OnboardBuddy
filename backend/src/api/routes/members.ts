import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";

export const membersRouter = Router({ mergeParams: true });

membersRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    const result = await query(
      `SELECT pm.project_id, pm.user_id, pm.permission_tier, pm.developer_role, pm.joined_at,
              u.email
       FROM project_members pm
       INNER JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY pm.joined_at ASC`,
      [projectId],
    );

    res.json({ members: result.rows });
  } catch (err) {
    console.error("List members error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

membersRouter.get("/invitations", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    const result = await query(
      `SELECT pi.*, u.email AS invited_by_email
       FROM project_invitations pi
       LEFT JOIN users u ON u.id = pi.invited_by
       WHERE pi.project_id = $1 AND pi.status = 'pending'
       ORDER BY pi.created_at DESC`,
      [projectId],
    );

    res.json({ invitations: result.rows });
  } catch (err) {
    console.error("List project invitations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

membersRouter.post("/invitations", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const invitedBy = req.user!.id;
    const { email, permission_tier, developer_role } = req.body as {
      email: string;
      permission_tier: string;
      developer_role?: string;
    };

    if (!email || !permission_tier) {
      res.status(400).json({ error: "email and permission_tier are required" });
      return;
    }

    const existing = await query(
      `SELECT id FROM project_invitations
       WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'`,
      [projectId, email],
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: "A pending invitation already exists for this email" });
      return;
    }

    const result = await query(
      `INSERT INTO project_invitations (project_id, email, permission_tier, developer_role, invited_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [projectId, email, permission_tier, developer_role ?? null, invitedBy],
    );

    res.status(201).json({ invitation: result.rows[0] });
  } catch (err) {
    console.error("Create invitation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

membersRouter.patch("/invitations/:invitationId", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const { invitationId } = req.params;
    const projectId = req.params.id;

    const result = await query(
      `UPDATE project_invitations
       SET status = 'revoked'
       WHERE id = $1 AND project_id = $2 AND status = 'pending'
       RETURNING *`,
      [invitationId, projectId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Pending invitation not found" });
      return;
    }

    res.json({ invitation: result.rows[0] });
  } catch (err) {
    console.error("Revoke invitation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

membersRouter.patch("/members/:userId", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const targetUserId = req.params.userId;
    const callerTier = req.projectMember!.permission_tier;
    const { permission_tier, developer_role } = req.body as {
      permission_tier?: string;
      developer_role?: string;
    };

    const targetResult = await query(
      `SELECT permission_tier FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, targetUserId],
    );

    if (targetResult.rows.length === 0) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    const targetTier = (targetResult.rows[0] as { permission_tier: string }).permission_tier;

    if (callerTier === "admin" && targetTier !== "developer") {
      res.status(403).json({ error: "Admins can only modify developers" });
      return;
    }

    const setClauses: string[] = [];
    const values: unknown[] = [projectId, targetUserId];
    let paramIndex = 3;

    if (permission_tier !== undefined) {
      setClauses.push(`permission_tier = $${paramIndex++}`);
      values.push(permission_tier);
    }
    if (developer_role !== undefined) {
      setClauses.push(`developer_role = $${paramIndex++}`);
      values.push(developer_role);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const result = await query(
      `UPDATE project_members SET ${setClauses.join(", ")}
       WHERE project_id = $1 AND user_id = $2
       RETURNING *`,
      values,
    );

    res.json({ member: result.rows[0] });
  } catch (err) {
    console.error("Update member error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

membersRouter.delete("/members/:userId", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const targetUserId = req.params.userId;

    const targetResult = await query(
      `SELECT permission_tier FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, targetUserId],
    );

    if (targetResult.rows.length === 0) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    const targetTier = (targetResult.rows[0] as { permission_tier: string }).permission_tier;
    if (targetTier === "owner") {
      res.status(403).json({ error: "Cannot remove the project owner" });
      return;
    }

    await query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, targetUserId],
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Remove member error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
