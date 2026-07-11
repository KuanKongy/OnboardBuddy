import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";

export const capabilitiesRouter = Router({ mergeParams: true });

/**
 * Business capabilities extracted by the semantic pass (doc/Pipeline.md
 * "Capabilities"), with their member workflows and architecture clusters —
 * the data behind the Capability Map tab.
 */
capabilitiesRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const snapResult = await query(
      `SELECT id FROM analysis_snapshots
       WHERE project_id = $1 AND status = 'complete'
       ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    );
    if (snapResult.rows.length === 0) {
      res.json({ capabilities: [], snapshotId: null });
      return;
    }
    const snapshotId = snapResult.rows[0].id as string;

    const capsResult = await query(
      `SELECT c.id, c.stable_key, c.name, c.description, c.confidence,
              sr.summary AS record_summary
       FROM capabilities c
       LEFT JOIN semantic_records sr ON sr.id = c.record_id
       WHERE c.snapshot_id = $1
       ORDER BY c.name`,
      [snapshotId],
    );
    const memberResult = await query(
      `SELECT cm.capability_id, cm.member_type, cm.member_id,
              w.title AS workflow_title, w.trigger_type,
              ac.label AS cluster_label, ac.stable_key AS cluster_key, ac.kind AS cluster_kind
       FROM capability_members cm
       LEFT JOIN workflows w ON w.id = cm.member_id AND cm.member_type = 'workflow'
       LEFT JOIN architecture_clusters ac ON ac.id = cm.member_id AND cm.member_type = 'cluster'
       WHERE cm.capability_id IN (SELECT id FROM capabilities WHERE snapshot_id = $1)`,
      [snapshotId],
    );

    type MemberRow = {
      capability_id: string; member_type: string; member_id: string;
      workflow_title: string | null; trigger_type: string | null;
      cluster_label: string | null; cluster_key: string | null; cluster_kind: string | null;
    };
    const membersByCap = new Map<string, MemberRow[]>();
    for (const m of memberResult.rows as MemberRow[]) {
      if (!membersByCap.has(m.capability_id)) membersByCap.set(m.capability_id, []);
      membersByCap.get(m.capability_id)!.push(m);
    }

    const capabilities = (capsResult.rows as Array<{
      id: string; stable_key: string; name: string; description: string;
      confidence: string; record_summary: string | null;
    }>).map((c) => {
      const members = membersByCap.get(c.id) ?? [];
      return {
        id: c.id,
        stableKey: c.stable_key,
        name: c.name,
        description: c.description,
        confidence: c.confidence,
        summary: c.record_summary,
        workflows: members
          .filter((m) => m.member_type === "workflow" && m.workflow_title)
          .map((m) => ({ id: m.member_id, title: m.workflow_title!, triggerType: m.trigger_type })),
        modules: members
          .filter((m) => m.member_type === "cluster" && m.cluster_label)
          .map((m) => ({ id: m.member_id, label: m.cluster_label!, stableKey: m.cluster_key, kind: m.cluster_kind })),
      };
    });

    res.json({ capabilities, snapshotId });
  } catch (err) {
    console.error("Capabilities list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
