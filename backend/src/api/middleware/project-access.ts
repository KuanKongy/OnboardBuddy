import type { Request, Response, NextFunction } from "express";
import { query } from "../../lib/db.js";

export function requireProjectAccess(...allowedTiers: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const projectId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const result = await query(
      `SELECT project_id, user_id, permission_tier, developer_role
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
    };

    if (allowedTiers.length > 0 && !allowedTiers.includes(member.permission_tier)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    req.projectMember = member;
    next();
  };
}
