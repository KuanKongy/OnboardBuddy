import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { resolveForRequest } from "../services/packageResolver.js";

export const capabilitiesRouter = Router({ mergeParams: true });

/**
 * Business capabilities extracted by the semantic pass (doc/Pipeline.md
 * "Capabilities"), with their member workflows and architecture clusters —
 * the data behind the Capability Map tab.
 */
capabilitiesRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    if (!ctx) {
      res.json({ capabilities: [], snapshotId: null });
      return;
    }
    const snapshotId = ctx.snapshotId;

    const capsResult = await query(
      `SELECT c.id, c.stable_key, c.name, c.description, c.confidence, c.metadata,
              sr.summary AS record_summary
       FROM capabilities c
       LEFT JOIN semantic_records sr ON sr.id = c.record_id
       WHERE c.snapshot_id = $1
       ORDER BY c.name`,
      [snapshotId],
    );
    const memberResult = await query(
      `SELECT cm.capability_id, cm.member_type, cm.member_id, cm.membership_reason,
              w.title AS workflow_title, w.trigger_type, w.purpose AS workflow_purpose,
              COALESCE(cs.score, (w.metadata->>'importance_score')::numeric, 0) AS workflow_score,
              ac.label AS cluster_label, ac.stable_key AS cluster_key, ac.kind AS cluster_kind
       FROM capability_members cm
       LEFT JOIN workflows w ON w.id = cm.member_id AND cm.member_type = 'workflow'
       LEFT JOIN criticality_scores cs
         ON cs.snapshot_id = w.snapshot_id AND cs.phase = 'candidate' AND cs.view = 'candidate'
        AND cs.target_type = 'workflow' AND cs.stable_key = w.stable_key AND cs.role = 'general'
       LEFT JOIN architecture_clusters ac ON ac.id = cm.member_id AND cm.member_type = 'cluster'
       WHERE cm.capability_id IN (SELECT id FROM capabilities WHERE snapshot_id = $1)`,
      [snapshotId],
    );
    // Tutorials for the hub's "learn it" links: keyed by source workflow.
    const tutorialResult = await query(
      `SELECT t.id, t.title, t.workflow_id
       FROM tutorials t
       WHERE t.snapshot_id = $1 AND t.workflow_id IS NOT NULL AND t.status <> 'failed'`,
      [snapshotId],
    );
    const tutorialsByWorkflow = new Map<string, Array<{ id: string; title: string }>>();
    for (const t of tutorialResult.rows as Array<{ id: string; title: string; workflow_id: string }>) {
      if (!tutorialsByWorkflow.has(t.workflow_id)) tutorialsByWorkflow.set(t.workflow_id, []);
      tutorialsByWorkflow.get(t.workflow_id)!.push({ id: t.id, title: t.title });
    }

    type MemberRow = {
      capability_id: string; member_type: string; member_id: string; membership_reason: string;
      workflow_title: string | null; trigger_type: string | null; workflow_purpose: string | null;
      workflow_score: string | number | null;
      cluster_label: string | null; cluster_key: string | null; cluster_kind: string | null;
    };
    const membersByCap = new Map<string, MemberRow[]>();
    for (const m of memberResult.rows as MemberRow[]) {
      if (!membersByCap.has(m.capability_id)) membersByCap.set(m.capability_id, []);
      membersByCap.get(m.capability_id)!.push(m);
    }

    type CapMetadata = {
      user_value?: string;
      where_the_code_lives?: Array<{ stable_key: string; reason?: string }>;
      where_to_start?: Array<{ stable_key: string; reason?: string }>;
    };

    const capabilities = (capsResult.rows as Array<{
      id: string; stable_key: string; name: string; description: string;
      confidence: string; metadata: CapMetadata | null; record_summary: string | null;
    }>).map((c) => {
      const members = membersByCap.get(c.id) ?? [];
      const meta = c.metadata ?? {};
      const workflows = members
        .filter((m) => m.member_type === "workflow" && m.workflow_title)
        .map((m) => ({
          id: m.member_id,
          title: m.workflow_title!,
          triggerType: m.trigger_type,
          purpose: m.workflow_purpose,
          score: Number(m.workflow_score ?? 0),
          reason: m.membership_reason || null,
          tutorials: tutorialsByWorkflow.get(m.member_id) ?? [],
        }))
        .sort((a, b) => b.score - a.score);
      return {
        id: c.id,
        stableKey: c.stable_key,
        name: c.name,
        description: c.description,
        confidence: c.confidence,
        summary: c.record_summary,
        userValue: meta.user_value ?? null,
        whereToStart: meta.where_to_start ?? [],
        whereTheCodeLives: meta.where_the_code_lives ?? [],
        workflows,
        modules: members
          .filter((m) => m.member_type === "cluster" && m.cluster_label)
          .map((m) => ({
            id: m.member_id,
            label: m.cluster_label!,
            stableKey: m.cluster_key,
            kind: m.cluster_kind,
            reason: m.membership_reason || null,
          })),
      };
    });

    res.json({ capabilities, snapshotId, packageId: ctx.packageId });
  } catch (err) {
    console.error("Capabilities list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
