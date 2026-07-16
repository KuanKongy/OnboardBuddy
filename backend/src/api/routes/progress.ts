import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";

export const progressRouter = Router({ mergeParams: true });

const VALID_KINDS = ["onboarding", "tutorial"] as const;
type ProgressKind = (typeof VALID_KINDS)[number];

// Per-user "continue where you left off" markers. ref_id is polymorphic
// (onboarding: package_id; tutorial: tutorial_id), so each row is enriched
// with a title + still_exists flag — regenerated content orphans old refs
// and the UI falls back to its static links.
progressRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user!.id;

    const result = await query(
      `SELECT up.kind, up.ref_id, up.position, up.updated_at,
              CASE up.kind
                WHEN 'onboarding' THEN op.id IS NOT NULL
                ELSE t.id IS NOT NULL
              END AS still_exists,
              CASE up.kind
                WHEN 'onboarding' THEN op.role
                ELSE t.title
              END AS title
       FROM user_progress up
       LEFT JOIN onboarding_packages op ON up.kind = 'onboarding' AND op.id = up.ref_id
       LEFT JOIN tutorials t ON up.kind = 'tutorial' AND t.id = up.ref_id
       WHERE up.project_id = $1 AND up.user_id = $2
       ORDER BY up.updated_at DESC`,
      [projectId, userId],
    );

    res.json({ items: result.rows });
  } catch (err) {
    console.error("List progress error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

progressRouter.put("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user!.id;
    const { kind, ref_id, position } = req.body as {
      kind?: string;
      ref_id?: string;
      position?: unknown;
    };

    if (!kind || !VALID_KINDS.includes(kind as ProgressKind)) {
      res.status(400).json({ error: "kind must be one of: onboarding, tutorial" });
      return;
    }
    if (!ref_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref_id)) {
      res.status(400).json({ error: "ref_id must be a UUID" });
      return;
    }
    if (position === undefined || position === null || typeof position !== "object" || Array.isArray(position)) {
      res.status(400).json({ error: "position must be a JSON object" });
      return;
    }

    const result = await query(
      `INSERT INTO user_progress (user_id, project_id, kind, ref_id, position)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, project_id, kind, ref_id)
       DO UPDATE SET position = EXCLUDED.position, updated_at = now()
       RETURNING kind, ref_id, position, updated_at`,
      [userId, projectId, kind, ref_id, JSON.stringify(position)],
    );

    res.json({ progress: result.rows[0] });
  } catch (err) {
    console.error("Save progress error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
