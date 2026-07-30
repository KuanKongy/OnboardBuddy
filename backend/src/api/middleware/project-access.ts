import type { Request, Response, NextFunction } from "express";
import { query } from "../../lib/db.js";
import { isUuid } from "../lib/uuid.js";

export function requireProjectAccess(...allowedTiers: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = req.params.id;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      // #74/B11: this is the gate every project-scoped route already passes
      // through, so it is where a malformed id is cheapest to catch — sending
      // one to `project_id = $1` raised a uuid cast error and answered 500 for
      // a project that could not exist under any spelling.
      if (!isUuid(projectId)) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const result = await query(
        `SELECT project_id, user_id, permission_tier, developer_role, default_package_id
         FROM project_members
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, userId],
      );

      if (result.rows.length === 0) {
        res.status(403).json({ error: "You are not a member of this project" });
        return;
      }

      const member = result.rows[0] as {
        project_id: string;
        user_id: string;
        permission_tier: string;
        developer_role: string;
        default_package_id: string | null;
      };

      if (allowedTiers.length > 0 && !allowedTiers.includes(member.permission_tier)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }

      req.projectMember = member;
      next();
    } catch (err) {
      console.error("Project access check error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
