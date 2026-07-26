import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { resolveForRequest } from "../services/packageResolver.js";

export const capabilitiesRouter = Router({ mergeParams: true });

/**
 * How the list is ordered, written next to the ORDER BY that does it — the
 * same contract the Workflows list serves, because it is the same model.
 * Alphabetical (`ORDER BY c.name`) was the previous order, which meant the
 * first thing a reader saw was whichever capability happened to start with A.
 */
const CAPABILITY_ORDERING = {
  summary: "Tier first, then whether a person triggers it, then the flow score behind it.",
  steps: [
    "Tier: capabilities delivered by core user flows, then those delivered by supporting flows (jobs, admin, dev paths)",
    "Within a tier: capabilities a person triggers directly come before ones the system triggers itself",
    "Then the importance score of the strongest flow that delivers it",
    "Ties break on flow count, then alphabetically",
  ],
} as const;

/**
 * The rule that decides what exists at all. Served rather than hard-coded in
 * the page so the empty state quotes the same rule the pass applied.
 */
const BINDING_RULE = {
  summary:
    "A capability is derived from evidence and then named, never named and then justified. It is emitted only when a group of traced flows binds to all three legs below.",
  legs: [
    "At least one entry point — an HTTP route, page, event handler, job or command something outside the code can trigger.",
    "At least one traced flow that reaches past its own trigger, so there is a path to follow.",
    "At least one schema table or named external service those flows actually touch.",
  ],
} as const;

type CapMetadata = {
  user_value?: string | null;
  where_to_start?: Array<{ stable_key: string; reason?: string }>;
  tier?: "core" | "supporting";
  rank?: number;
  score?: number;
  realizes_user_action?: boolean;
  named_by?: "model" | "deterministic";
  derivation?: string[];
  binding?: {
    key?: string;
    key_source?: string;
    entrypoints?: Array<{ kind: string; route: string | null; filePath: string; symbol: string | null }>;
    schemas?: string[];
    services?: string[];
    flows?: Array<{ stableKey: string; title: string; tier: string; stepCount: number }>;
  };
};

/**
 * Business capabilities derived by the semantic pass (doc/Pipeline.md
 * "Capabilities"), with the flows, code and clusters they bind to — plus the
 * derivation report, so an empty list can say WHY it is empty instead of
 * looking like a failed analysis.
 */
capabilitiesRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    if (!ctx) {
      res.json({ capabilities: [], snapshotId: null, ordering: CAPABILITY_ORDERING, bindingRule: BINDING_RULE, derivation: null });
      return;
    }
    const snapshotId = ctx.snapshotId;

    // Ordered by the same model Workflows uses: tier decides before any score
    // is compared. Snapshots analysed before capabilities carried a tier fall
    // through every clause and land on the old alphabetical order, which is
    // the honest degradation — not a fabricated rank.
    const capsResult = await query(
      `SELECT c.id, c.stable_key, c.name, c.description, c.confidence, c.metadata,
              sr.summary AS record_summary
       FROM capabilities c
       LEFT JOIN semantic_records sr ON sr.id = c.record_id
       WHERE c.snapshot_id = $1
       ORDER BY
         CASE COALESCE(c.metadata->>'tier', 'supporting')
           WHEN 'core' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END,
         COALESCE((c.metadata->>'realizes_user_action')::boolean, false) DESC,
         COALESCE((c.metadata->>'score')::numeric, 0) DESC,
         c.name ASC`,
      [snapshotId],
    );

    const memberResult = await query(
      `SELECT cm.capability_id, cm.member_type, cm.member_id, cm.stable_key, cm.membership_reason,
              w.title AS workflow_title, w.trigger_type, w.purpose AS workflow_purpose,
              COALESCE(w.metadata->>'tier', 'supporting') AS workflow_tier,
              (SELECT COUNT(*)::int FROM workflow_steps s WHERE s.workflow_id = w.id) AS workflow_steps,
              COALESCE(cs.score, (w.metadata->>'importance_score')::numeric, 0) AS workflow_score,
              ac.label AS cluster_label, ac.stable_key AS cluster_key, ac.kind AS cluster_kind,
              gn.stable_key AS node_key, gn.name AS node_name, gn.file_path AS node_file
       FROM capability_members cm
       LEFT JOIN workflows w ON w.id = cm.member_id AND cm.member_type = 'workflow'
       LEFT JOIN criticality_scores cs
         ON cs.snapshot_id = w.snapshot_id AND cs.phase = 'candidate' AND cs.view = 'candidate'
        AND cs.target_type = 'workflow' AND cs.stable_key = w.stable_key AND cs.role = 'general'
       LEFT JOIN architecture_clusters ac ON ac.id = cm.member_id AND cm.member_type = 'cluster'
       LEFT JOIN graph_nodes gn ON gn.id = cm.member_id AND cm.member_type = 'node'
       WHERE cm.capability_id IN (SELECT id FROM capabilities WHERE snapshot_id = $1)`,
      [snapshotId],
    );

    // Tutorials for the "learn it" links, keyed by source workflow.
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
      capability_id: string; member_type: string; member_id: string; stable_key: string | null;
      membership_reason: string;
      workflow_title: string | null; trigger_type: string | null; workflow_purpose: string | null;
      workflow_tier: string | null; workflow_steps: number | null; workflow_score: string | number | null;
      cluster_label: string | null; cluster_key: string | null; cluster_kind: string | null;
      node_key: string | null; node_name: string | null; node_file: string | null;
    };
    const membersByCap = new Map<string, MemberRow[]>();
    for (const m of memberResult.rows as MemberRow[]) {
      if (!membersByCap.has(m.capability_id)) membersByCap.set(m.capability_id, []);
      membersByCap.get(m.capability_id)!.push(m);
    }

    const capabilities = (capsResult.rows as Array<{
      id: string; stable_key: string; name: string; description: string;
      confidence: string; metadata: CapMetadata | null; record_summary: string | null;
    }>).map((c) => {
      const members = membersByCap.get(c.id) ?? [];
      const meta = c.metadata ?? {};
      const binding = meta.binding ?? {};
      return {
        id: c.id,
        stableKey: c.stable_key,
        name: c.name,
        description: c.description,
        confidence: c.confidence,
        summary: c.record_summary,
        userValue: meta.user_value ?? null,
        tier: meta.tier ?? null,
        score: typeof meta.score === "number" ? meta.score : null,
        realizesUserAction: meta.realizes_user_action ?? null,
        // Whether the words a reader is looking at came from a model or from
        // the derivation itself. A deterministic name is not a defect, but
        // pretending it was written is.
        namedBy: meta.named_by ?? null,
        derivation: meta.derivation ?? [],
        binding: {
          key: binding.key ?? null,
          keySource: binding.key_source ?? null,
          entrypoints: binding.entrypoints ?? [],
          schemas: binding.schemas ?? [],
          services: binding.services ?? [],
        },
        whereToStart: meta.where_to_start ?? [],
        workflows: members
          .filter((m) => m.member_type === "workflow" && m.workflow_title)
          .map((m) => ({
            id: m.member_id,
            stableKey: m.stable_key,
            title: m.workflow_title!,
            triggerType: m.trigger_type,
            purpose: m.workflow_purpose,
            tier: m.workflow_tier,
            stepCount: m.workflow_steps ?? 0,
            score: Number(m.workflow_score ?? 0),
            reason: m.membership_reason || null,
            tutorials: tutorialsByWorkflow.get(m.member_id) ?? [],
          }))
          .sort((a, b) => b.score - a.score),
        // The code the capability binds to: entry points and effect sites,
        // not every file its traces wandered through.
        nodes: members
          .filter((m) => m.member_type === "node" && m.node_key)
          .map((m) => ({
            stableKey: m.node_key!,
            name: m.node_name,
            filePath: m.node_file,
            reason: m.membership_reason || null,
          })),
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

    res.json({
      capabilities,
      ordering: CAPABILITY_ORDERING,
      bindingRule: BINDING_RULE,
      derivation: await loadDerivation(snapshotId),
      snapshotId,
      packageId: ctx.packageId,
    });
  } catch (err) {
    console.error("Capabilities list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * What the derivation considered and rejected.
 *
 * The stored report is the authority when it exists; the counts below are
 * recomputed from the same tables either way, so a snapshot analysed before
 * capabilities kept a report still gets an honest denominator instead of a
 * blank empty state.
 */
async function loadDerivation(snapshotId: string): Promise<{
  tracedFlows: number;
  consideredFlows: number;
  boundFlows: number;
  entrypoints: number;
  schemaTables: number;
  unbound: Array<{ title: string; missing: string }>;
  reportStored: boolean;
} | null> {
  const counts = (await query(
    `SELECT
       (SELECT COUNT(*)::int FROM workflows WHERE snapshot_id = $1) AS traced_flows,
       (SELECT COUNT(*)::int FROM workflows
         WHERE snapshot_id = $1 AND COALESCE(metadata->>'tier', 'supporting') <> 'surface') AS considered_flows,
       (SELECT COUNT(DISTINCT cm.member_id)::int FROM capability_members cm
         WHERE cm.member_type = 'workflow'
           AND cm.capability_id IN (SELECT id FROM capabilities WHERE snapshot_id = $1)) AS bound_flows,
       (SELECT COUNT(*)::int FROM entrypoints WHERE snapshot_id = $1) AS entrypoints,
       (SELECT COUNT(*)::int FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema') AS schema_tables`,
    [snapshotId],
  )).rows[0] as {
    traced_flows: number; considered_flows: number; bound_flows: number;
    entrypoints: number; schema_tables: number;
  } | undefined;
  if (!counts) return null;

  const recordRow = (await query(
    `SELECT sr.record
     FROM snapshot_semantic_records ssr
     JOIN semantic_records sr ON sr.id = ssr.record_id
     WHERE ssr.snapshot_id = $1 AND ssr.stable_key = 'capabilities' AND ssr.record_level = 'capability'
     LIMIT 1`,
    [snapshotId],
  )).rows[0] as { record?: { derivation?: { unbound?: Array<{ title: string; missing: string }> } } } | undefined;
  const unbound = recordRow?.record?.derivation?.unbound ?? null;

  return {
    tracedFlows: counts.traced_flows,
    consideredFlows: counts.considered_flows,
    boundFlows: counts.bound_flows,
    entrypoints: counts.entrypoints,
    schemaTables: counts.schema_tables,
    // Capped: this is a summary of what was left out, not a second list of
    // everything the repo contains.
    unbound: (unbound ?? []).slice(0, 40),
    reportStored: unbound !== null,
  };
}
