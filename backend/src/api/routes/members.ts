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

/**
 * #74/B4: invitations were written with `expires_at` NULL, which every read
 * treats as "never expires" — an address invited once could still join months
 * later, after the person had left the team. The schema is frozen for M5, so
 * the TTL is stamped by the INSERT rather than by a column default; rows
 * written before this keep their NULL and stay valid (the alternative is
 * retro-expiring invitations people are currently holding).
 */
const INVITATION_TTL_DAYS = 14;

/** Enough to catch a typo'd or pasted-with-junk address; the invitation is
 *  redeemed by signing in with the address, so a wrong one is simply dead. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

membersRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    // Two different things, deliberately both reported (#74/F16). `reviewed` is
    // editorial: sections an owner/admin signed off. `read_marks` is the
    // member's own reading — the reader's "Mark as read" toggle, which every
    // tier has and which is what a lead actually means by "how far are they".
    // The old page showed only the first under a label that read like the
    // second, so a developer's progress was permanently 0.
    //
    // Read marks live in `user_progress.position -> 'readSections'` (no schema
    // of their own; the frozen-schema constraint is why). The
    // `jsonb_typeof = 'array'` filter is load-bearing, not defensive: on a row
    // whose readSections is a scalar, `jsonb_array_length` raises 22023 and
    // takes the whole member list down with it.
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

    // Same expiry predicate as the accept path (#74/B4) — an invitation that
    // can no longer be redeemed must not be listed as pending, or an admin
    // sits waiting on someone who cannot get in and won't re-invite them
    // (the pending-unique index would reject a second invitation anyway).
    // The IS NULL arm keeps rows written before the TTL existed.
    const result = await query(
      `SELECT pi.*, u.email AS invited_by_email
       FROM project_invitations pi
       LEFT JOIN users u ON u.id = pi.invited_by
       WHERE pi.project_id = $1 AND pi.status = 'pending'
         AND (pi.expires_at IS NULL OR pi.expires_at > NOW())
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
    const { email: rawEmail, permission_tier, developer_role } = req.body as {
      email: string;
      permission_tier: string;
      developer_role?: string;
    };

    if (!rawEmail || !permission_tier) {
      res.status(400).json({ error: "email and permission_tier are required" });
      return;
    }

    // #74/B9: the address was stored exactly as typed and never checked, so a
    // trailing space (or a newline from a paste) produced an invitation that
    // matched nobody — `LOWER(email) = LOWER($1)` on the invitee's inbox never
    // finds " bob@acme.test", and the invitation looked sent from both sides.
    const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "Enter a valid email address" });
      return;
    }

    // Inviting yourself always ended in a dead invitation: you are already a
    // member, so accepting it fails on the members primary key.
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

    // Someone who is already on the team got an invitation they could never
    // redeem (accept 409s on the members primary key), and the inviter was
    // told it worked. Membership is by user, the invitation is by address, so
    // the check has to go through `users`.
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
      // Expired but still status='pending'. `idx_project_invitations_pending_unique_email`
      // would reject the replacement, and the pending lists no longer show this
      // row — so without retiring it here the inviter is told an invitation
      // exists that they can neither see nor revoke, forever. 'expired' is in
      // the frozen status CHECK, so this needs no schema change.
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

/**
 * Bug #72: ownership was unmovable. The member PATCH refuses to assign 'owner'
 * to anyone else and refuses to demote the owner, which is right — ownership is
 * not a tier edit. It is this: two tier changes and `projects.user_id`, together
 * or not at all.
 *
 * `projects.user_id` is load-bearing and moves with the tier. Account deletion
 * cascades owned projects and reassigns other people's RESTRICT rows to
 * `projects.user_id` (`services/accountDeletion.ts`), so leaving it pointing at
 * the old owner means their account deletion would take the whole project with
 * it. Tier resolution itself reads `project_members` only, and GitHub access is
 * per-installation rather than per-user, so analysis keeps working across the
 * transfer.
 */
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

      // Demote first, and only from 'owner': if a concurrent transfer already
      // moved ownership, this matches nothing and the whole thing rolls back.
      // Promoting first instead would leave two owners for the width of the
      // transaction — and a project with two owners is a state the remove and
      // PATCH guards are written to assume cannot exist.
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
        // UNIQUE (user_id, repo_owner, repo_name): the new owner has imported
        // this same repo themselves. Nothing here can resolve that for them, so
        // say which project is in the way rather than answer 500.
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

/**
 * Bug #72: leaving a project was impossible. Removal required owner/admin on
 * `/:userId`, and that route refuses `targetUserId === req.user.id` ("Cannot
 * remove yourself"), so a developer who no longer worked on a repo kept it on
 * their dashboard forever and had to ask an owner to evict them.
 *
 * Literal `/me`, and registered ABOVE `delete("/:userId")` — Express matches in
 * registration order, and the `:userId` route's `requireUuidParam` would answer
 * a non-uuid segment with 404 before this handler ever ran.
 *
 * `requireProjectAccess()` with no tiers: any member may leave. Nothing else is
 * deleted with the row — `default_package_id` lives on it, while `user_progress`
 * and the sections this member approved are keyed to the user and project and
 * survive, so rejoining later returns their reading position and the editorial
 * history stays attributable.
 */
membersRouter.delete("/me", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user!.id;

    // The owner is `projects.user_id` as well as a member row, and the account
    // cascade + orphan reassignment both go through it, so an owner cannot
    // simply walk out and leave the project without one.
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
