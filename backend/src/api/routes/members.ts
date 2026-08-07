import { Router } from "express";
import { pool, query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { requireUuidParam } from "../middleware/requireUuidParam.js";
import {
  DEVELOPER_ROLES,
  INVITABLE_TIERS,
  isDeveloperRole,
  isInvitableTier,
  isPermissionTier,
} from "../lib/permissionTiers.js";

export const membersRouter = Router({ mergeParams: true });

// Stamped by the INSERT rather than a column default: the schema is frozen, and
// rows written before this keep their NULL and stay valid.
const INVITATION_TTL_DAYS = 14;

/** Enough to catch a typo'd or pasted-with-junk address. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

membersRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    // `reviewed` is editorial sign-off; `read_marks` is the member's own reading,
    // which has no schema of its own and lives in `position -> 'readSections'`.
    // jsonb_typeof guard: a scalar there would 22023 the whole member list.
    const result = await query(
      `SELECT pm.project_id, pm.user_id, pm.permission_tier, pm.developer_role, pm.joined_at,
              u.email,
              gc.github_username,
              COALESCE(reviewed.sections_reviewed, 0) AS sections_reviewed,
              COALESCE(read_marks.sections_read, 0) AS sections_read
       FROM project_members pm
       INNER JOIN users u ON u.id = pm.user_id
       LEFT JOIN github_connections gc ON gc.user_id = pm.user_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS sections_reviewed
         FROM package_sections ps
         INNER JOIN onboarding_packages op ON op.id = ps.package_id
         WHERE op.project_id = pm.project_id AND ps.reviewed_by = pm.user_id
       ) reviewed ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(jsonb_array_length(up.position -> 'readSections')), 0)::int AS sections_read
         FROM user_progress up
         INNER JOIN onboarding_packages op ON op.id = up.ref_id AND op.project_id = up.project_id
         WHERE up.user_id = pm.user_id AND up.project_id = pm.project_id
           AND up.kind = 'onboarding'
           AND jsonb_typeof(up.position -> 'readSections') = 'array'
       ) read_marks ON true
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

    // The team page shows invitation history alongside the roster, so this lists
    // every invitation this project ever sent — declined and expired included.
    // `live` carries what the filter used to decide: the accept path's own
    // predicate (the IS NULL arm keeps pre-TTL rows valid), so the page can tell
    // "still open" from "over" without re-deriving expiry in the client. Revoke
    // and accept both re-check on the write; this column is presentation only.
    const result = await query(
      `SELECT pi.*, u.email AS invited_by_email,
              (pi.status = 'pending' AND (pi.expires_at IS NULL OR pi.expires_at > NOW())) AS live
       FROM project_invitations pi
       LEFT JOIN users u ON u.id = pi.invited_by
       WHERE pi.project_id = $1
       ORDER BY pi.created_at DESC
       LIMIT 200`,
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
    const { email: rawEmail, permission_tier, developer_role } = req.body as {
      email: string;
      permission_tier: string;
      developer_role?: string;
    };

    if (!rawEmail || !permission_tier) {
      res.status(400).json({ error: "email and permission_tier are required" });
      return;
    }

    // Untrimmed, a pasted address matches nothing on the invitee's inbox, which
    // compares with `LOWER(email) = LOWER($1)`.
    const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "Enter a valid email address" });
      return;
    }

    // Self-invitation is a dead invitation: accept fails on the members PK.
    if (email.toLowerCase() === req.user!.email.toLowerCase()) {
      res.status(400).json({ error: "You are already a member of this project" });
      return;
    }

    // Whitelist the tier here, at the only place it enters the system from a
    // request body. Unvalidated, `"owner"` was stored verbatim and granted on
    // accept (#66); a typo'd tier reached the CHECK constraint and surfaced as
    // a 500 instead of telling the caller what they got wrong.
    if (!isInvitableTier(permission_tier)) {
      res.status(400).json({ error: `permission_tier must be one of: ${INVITABLE_TIERS.join(", ")}` });
      return;
    }
    if (developer_role !== undefined && developer_role !== null && !isDeveloperRole(developer_role)) {
      res.status(400).json({ error: `developer_role must be one of: ${DEVELOPER_ROLES.join(", ")}` });
      return;
    }

    // Membership is by user and the invitation is by address, so the check has to
    // go through `users` — otherwise accept 409s on the members PK.
    const alreadyMember = await query(
      `SELECT 1 FROM project_members pm
       INNER JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 AND LOWER(u.email) = LOWER($2)`,
      [projectId, email],
    );

    if (alreadyMember.rows.length > 0) {
      res.status(409).json({ error: "That person is already a member of this project" });
      return;
    }

    const existing = await query(
      `SELECT id, (expires_at IS NULL OR expires_at > NOW()) AS live
       FROM project_invitations
       WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'`,
      [projectId, email],
    );

    const pending = existing.rows[0] as { id: string; live: boolean } | undefined;
    if (pending?.live) {
      res.status(409).json({ error: "A pending invitation already exists for this email" });
      return;
    }
    if (pending) {
      // Expired but still 'pending': invisible in every list, yet
      // idx_project_invitations_pending_unique_email would reject the replacement.
      await query(
        `UPDATE project_invitations SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
        [pending.id],
      );
    }

    const result = await query(
      `INSERT INTO project_invitations (project_id, email, permission_tier, developer_role, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(days => $6::int))
       RETURNING *`,
      [projectId, email, permission_tier, developer_role ?? null, invitedBy, INVITATION_TTL_DAYS],
    );

    res.status(201).json({ invitation: result.rows[0] });
  } catch (err) {
    console.error("Create invitation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

membersRouter.patch("/invitations/:invitationId", requireProjectAccess("owner", "admin"), requireUuidParam("invitationId"), async (req, res) => {
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

// Re-send an invitation that went nowhere: expired, revoked, or declined. The
// row is never revived — a new row with a new id and a fresh TTL is written from
// the old one's email/tier/role, so the dead invitation stays in the history
// where the team page shows it, and its id stops being redeemable.
membersRouter.post(
  "/invitations/:invitationId/resend",
  requireProjectAccess("owner", "admin"),
  requireUuidParam("invitationId"),
  async (req, res) => {
    try {
      const { invitationId } = req.params;
      const projectId = req.params.id;
      const invitedBy = req.user!.id;

      const existing = await query(
        `SELECT id, email, permission_tier, developer_role, status
         FROM project_invitations
         WHERE id = $1 AND project_id = $2`,
        [invitationId, projectId],
      );

      if (existing.rows.length === 0) {
        res.status(404).json({ error: "Invitation not found" });
        return;
      }

      const invitation = existing.rows[0] as {
        id: string;
        email: string;
        permission_tier: string;
        developer_role: string | null;
        status: string;
      };

      // Nothing to re-send: the invitee is already in. Re-sending would write a
      // second invitation that accept can only answer with a members-PK 409.
      if (invitation.status === "accepted") {
        res.status(409).json({ error: "That invitation has already been accepted" });
        return;
      }

      // Same out-of-the-table tier check as accept (#66): a row written before
      // the POST route whitelisted its input must not get a second life here.
      if (!isInvitableTier(invitation.permission_tier)) {
        res.status(400).json({
          error: `That invitation grants an unsupported permission tier (${invitation.permission_tier}). Send a new invitation as one of: ${INVITABLE_TIERS.join(", ")}.`,
        });
        return;
      }

      // Membership is by user and the invitation is by address, so the check has
      // to go through `users` — they may have joined by some other route since.
      const alreadyMember = await query(
        `SELECT 1 FROM project_members pm
         INNER JOIN users u ON u.id = pm.user_id
         WHERE pm.project_id = $1 AND LOWER(u.email) = LOWER($2)`,
        [projectId, invitation.email],
      );

      if (alreadyMember.rows.length > 0) {
        res.status(409).json({ error: "That person is already a member of this project" });
        return;
      }

      // idx_project_invitations_pending_unique_email is partial on 'pending', so
      // a still-pending original (live or merely past its TTL) blocks the
      // replacement. Retire it first, exactly as the POST route does.
      if (invitation.status === "pending") {
        await query(
          `UPDATE project_invitations SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
          [invitation.id],
        );
      }

      const result = await query(
        `INSERT INTO project_invitations (project_id, email, permission_tier, developer_role, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(days => $6::int))
         RETURNING *, true AS live`,
        [
          projectId,
          invitation.email,
          invitation.permission_tier,
          invitation.developer_role,
          invitedBy,
          INVITATION_TTL_DAYS,
        ],
      );

      res.status(201).json({ invitation: result.rows[0] });
    } catch (err) {
      // Two admins hitting Resend at once: the partial unique index arbitrates,
      // and the loser is told an invitation is already out rather than 500'd.
      if (err instanceof Error && err.message.includes("duplicate key")) {
        res.status(409).json({ error: "A pending invitation already exists for this email" });
        return;
      }
      console.error("Resend invitation error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

membersRouter.patch("/:userId", requireProjectAccess("owner", "admin"), requireUuidParam("userId"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const targetUserId = req.params.userId;
    const callerId = req.user!.id;
    const callerTier = req.projectMember!.permission_tier;
    const { permission_tier, developer_role } = req.body as {
      permission_tier?: string;
      developer_role?: string;
    };

    // Same vocabulary as the invitation route, from one definition — the two
    // used to keep their own copies, and only one of them checked.
    if (permission_tier !== undefined && !isPermissionTier(permission_tier)) {
      res.status(400).json({ error: "Invalid permission_tier" });
      return;
    }
    if (developer_role !== undefined && !isDeveloperRole(developer_role)) {
      res.status(400).json({ error: "Invalid developer_role" });
      return;
    }

    const targetResult = await query(
      `SELECT permission_tier FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, targetUserId],
    );

    if (targetResult.rows.length === 0) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    const targetTier = (targetResult.rows[0] as { permission_tier: string }).permission_tier;

    if (targetTier === "owner" && targetUserId === callerId && permission_tier && permission_tier !== "owner") {
      res.status(403).json({ error: "Cannot demote yourself as the project owner" });
      return;
    }

    if (callerTier === "admin") {
      if (targetTier !== "developer") {
        res.status(403).json({ error: "Admins can only modify developers" });
        return;
      }
      if (permission_tier && permission_tier !== "developer") {
        res.status(403).json({ error: "Admins cannot promote members above developer" });
        return;
      }
    }

    if (callerTier === "owner" && permission_tier === "owner" && targetUserId !== callerId) {
      res.status(403).json({ error: "Cannot assign owner tier to another member. Use ownership transfer instead." });
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

// Two tier changes plus `projects.user_id`, together or not at all.
// `projects.user_id` has to move: `services/accountDeletion.ts` cascades owned
// projects through it, so an old owner left there would take the project with them.
membersRouter.post(
  "/:userId/transfer-ownership",
  requireProjectAccess("owner"),
  requireUuidParam("userId"),
  async (req, res) => {
    let client: import("pg").PoolClient | undefined;
    try {
      client = await pool.connect();
    } catch (err) {
      console.error("Transfer ownership: failed to acquire DB connection:", err);
      res.status(503).json({ error: "Service temporarily unavailable" });
      return;
    }
    try {
      const projectId = req.params.id;
      const targetUserId = req.params.userId!;
      const callerId = req.user!.id;

      await client.query("BEGIN");

      const targetResult = await client.query(
        `SELECT user_id, permission_tier FROM project_members
         WHERE project_id = $1 AND user_id = $2
         FOR UPDATE`,
        [projectId, targetUserId],
      );

      if (targetResult.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Member not found" });
        return;
      }

      if (targetUserId === callerId) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "You already own this project" });
        return;
      }

      // Demote first, and only from 'owner': promoting first would leave two
      // owners for the width of the transaction, which no other guard allows for.
      const demoted = await client.query(
        `UPDATE project_members SET permission_tier = 'admin'
         WHERE project_id = $1 AND user_id = $2 AND permission_tier = 'owner'
         RETURNING *`,
        [projectId, callerId],
      );

      if (demoted.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Ownership changed concurrently — reload and retry" });
        return;
      }

      const promoted = await client.query(
        `UPDATE project_members SET permission_tier = 'owner'
         WHERE project_id = $1 AND user_id = $2
         RETURNING *`,
        [projectId, targetUserId],
      );

      try {
        await client.query(`UPDATE projects SET user_id = $1 WHERE id = $2`, [targetUserId, projectId]);
      } catch (err) {
        // UNIQUE (user_id, repo_owner, repo_name): the new owner already imported
        // this repo, so name what is in the way rather than answer 500.
        if (err instanceof Error && err.message.includes("duplicate key")) {
          await client.query("ROLLBACK");
          res.status(409).json({
            error: "The new owner already has a separate project for this repository. They must delete it first.",
          });
          return;
        }
        throw err;
      }

      await client.query("COMMIT");

      res.json({ new_owner: promoted.rows[0], previous_owner: demoted.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Transfer ownership error:", err);
      res.status(500).json({ error: "Internal server error" });
    } finally {
      client.release();
    }
  },
);

// Must stay registered ABOVE `delete("/:userId")`: Express matches in order, and
// that route's requireUuidParam would 404 the literal `/me` segment first.
// No tiers on requireProjectAccess — any member may leave.
membersRouter.delete("/me", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user!.id;

    // The account cascade and orphan reassignment both key on `projects.user_id`,
    // so an ownerless project is not a state the rest of the system answers for.
    if (req.projectMember!.permission_tier === "owner") {
      res.status(403).json({
        error: "Transfer ownership to another member before leaving the project",
      });
      return;
    }

    await query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId],
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Leave project error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

membersRouter.delete("/:userId", requireProjectAccess("owner", "admin"), requireUuidParam("userId"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const targetUserId = req.params.userId;
    const callerTier = req.projectMember!.permission_tier;

    if (targetUserId === req.user!.id) {
      res.status(403).json({ error: "Cannot remove yourself" });
      return;
    }

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

    if (callerTier === "admin" && targetTier !== "developer") {
      res.status(403).json({ error: "Admins can only remove developers" });
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
