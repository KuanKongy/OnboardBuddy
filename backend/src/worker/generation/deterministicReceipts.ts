/**
 * Deterministic receipts for ai_disabled packages: the SAME kind of evidence
 * the AI path attaches (file/line/snippet source_receipts, served by
 * GET /onboarding/sections/:id/receipts), built purely from extracted graph
 * data — graph_nodes already carry capped snippets with exact line ranges.
 * Each section cites the code objects its own deterministic query rendered,
 * so the reader's receipt chips and staleness tracking work identically
 * whether or not AI narration is on.
 */

import { query } from '../../lib/db.js';
import { isRunControlError } from '../runStatus.js';
import { loadDecisionNotes } from './decisionComments.js';
import type { SectionDeps, SectionType } from './sectionSpecs.js';

export interface DeterministicReceiptRow {
  receiptKind: 'code_snippet' | 'config_snippet' | 'doc_snippet' | 'workflow_step';
  trustLevel: 'code' | 'config' | 'tests' | 'docs' | 'llm_inference';
  nodeId?: string | null;
  workflowId?: string | null;
  nodeStableKey?: string | null;
  filePath?: string | null;
  symbolName?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  snippet?: string | null;
  detectionExpression?: string | null;
  claim?: string | null;
}

interface NodeRow {
  id: string;
  stable_key: string;
  name: string;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  snippet: string | null;
  trust_level: 'code' | 'config' | 'tests' | 'docs' | 'llm_inference';
}

/** The `graph_nodes` columns every receipt row is built from, in `NodeRow` order. */
const NODE_COLUMNS = [
  'id', 'stable_key', 'name', 'file_path', 'line_start', 'line_end', 'snippet', 'trust_level',
] as const;

/**
 * The node projection, qualified by the alias it is being read THROUGH.
 *
 * This used to be a bare `n.`-prefixed constant, which is correct only while
 * every query reads `graph_nodes` directly. `architecture_deep` stopped doing
 * that when it grew a ranking subquery: the outer SELECT reads the derived
 * table `ranked`, where no `n` exists, so the constant expanded to
 * `SELECT n.id, … FROM (…) ranked` and Postgres rejected the whole statement
 * with `missing FROM-clause entry for table "n"` (SQLSTATE 42P01). The section
 * failed on every project for hours. Taking the alias as an argument is what
 * makes the qualification a decision at each call site instead of an
 * assumption baked into a string.
 */
const nodeFields = (alias: string): string => NODE_COLUMNS.map((c) => `${alias}.${c}`).join(', ');

/** Reading `graph_nodes` directly, as `n`. */
const NODE_FIELDS = nodeFields('n');

function kindForTrust(trust: NodeRow['trust_level']): DeterministicReceiptRow['receiptKind'] {
  if (trust === 'config') return 'config_snippet';
  if (trust === 'docs') return 'doc_snippet';
  return 'code_snippet';
}

function fromNode(n: NodeRow, claim: string | null): DeterministicReceiptRow {
  return {
    receiptKind: kindForTrust(n.trust_level),
    trustLevel: n.trust_level,
    nodeId: n.id,
    nodeStableKey: n.stable_key,
    filePath: n.file_path,
    symbolName: n.name,
    lineStart: n.line_start,
    lineEnd: n.line_end,
    snippet: n.snippet,
    claim,
  };
}

/** Nodes for projection-driven sections; claims come from the projection reasons. */
async function nodesForProjections(
  deps: SectionDeps,
  targets: Array<{ stableKey: string; reasons: string[] }>,
  cap: number,
): Promise<DeterministicReceiptRow[]> {
  const wanted = targets.slice(0, cap);
  if (wanted.length === 0) return [];
  const byKey = new Map(wanted.map((t) => [t.stableKey, t]));
  const rows = (await query(
    `SELECT ${NODE_FIELDS} FROM graph_nodes n WHERE n.snapshot_id = $1 AND n.stable_key = ANY($2)`,
    [deps.snapshotId, [...byKey.keys()]],
  )).rows as NodeRow[];
  return rows.map((n) => fromNode(n, byKey.get(n.stable_key)?.reasons.slice(0, 2).join('; ') ?? null));
}

async function entrypointReceipts(deps: SectionDeps, cap: number): Promise<DeterministicReceiptRow[]> {
  const rows = (await query(
    `SELECT ${NODE_FIELDS}, e.trigger_type, e.method, e.route_path
     FROM entrypoints e JOIN graph_nodes n ON n.id = e.node_id
     WHERE e.snapshot_id = $1 ORDER BY e.trigger_type LIMIT $2`,
    [deps.snapshotId, cap],
  )).rows as Array<NodeRow & { trigger_type: string; method: string | null; route_path: string | null }>;
  return rows.map((r) => fromNode(r, `Entry point (${r.trigger_type})${r.method ? `: ${r.method} ${r.route_path ?? ''}`.trimEnd() : ''}`));
}

/**
 * The section's evidence rows. Every query reads only deterministic tables
 * (graph_nodes, entrypoints, workflows, side_effects, cluster/capability
 * members) — zero LLM involvement, exactly the ai_disabled contract.
 */
export async function collectSectionReceipts(
  sectionType: SectionType,
  deps: SectionDeps,
): Promise<DeterministicReceiptRow[]> {
  switch (sectionType) {
    case 'big_picture': {
      // Entry points + the config files the topology narration cites.
      const configs = (await query(
        `SELECT ${NODE_FIELDS} FROM graph_nodes n
         WHERE n.snapshot_id = $1 AND n.type = 'config'
           AND n.metadata->>'configKind' IN ('compose', 'env_example')
         ORDER BY length(n.stable_key) LIMIT 4`,
        [deps.snapshotId],
      )).rows as NodeRow[];
      return [
        ...configs.map((n) => fromNode(n, `Runtime configuration: ${n.file_path ?? n.name}`)),
        ...(await entrypointReceipts(deps, 8)),
      ];
    }
    case 'routes_jobs':
      return entrypointReceipts(deps, 15);
    case 'common_tasks':
      return entrypointReceipts(deps, 8);

    case 'setup_run': {
      const rows = (await query(
        `SELECT ${NODE_FIELDS} FROM graph_nodes n
         WHERE n.snapshot_id = $1 AND n.type = 'config'
           AND n.metadata->>'configKind' IN ('compose', 'package_json', 'env_example', 'docker')
         ORDER BY length(n.stable_key) LIMIT 8`,
        [deps.snapshotId],
      )).rows as NodeRow[];
      return rows.map((n) => fromNode(n, `Run configuration: ${n.file_path ?? n.name}`));
    }

    case 'first_change':
      return nodesForProjections(
        deps,
        deps.projections.filter((p) => p.targetType === 'file').slice(3, 25),
        8,
      );

    case 'architecture_deep': {
      // TWO representative members per cluster, ranked so the clusters the
      // prompt actually narrates are the ones that get receipts.
      //
      // The previous query said "most-critical clusters first" and did not do
      // it: `DISTINCT ON (c.id) … ORDER BY c.id` ranks by a random UUID, and
      // the caller then took the first ten. `sectionSpecs.ts` narrates the top
      // MAX_NARRATED_CLUSTERS (6) by `critical_score`, so on a repo with more
      // clusters than that — OnboardBuddy has fourteen — the six components
      // with subsections and the ten with receipts were two unrelated samples.
      // Measured consequence: architecture_deep shipped zero citations on 7 of
      // 11 stored packages. Ranking by the SAME key the prompt ranks by is what
      // makes "cite this component's receipt" an instruction the model can
      // follow; preferring a member that carries a snippet is what makes the
      // receipt worth citing.
      //
      // The outer SELECT reads the derived table, so every column here is
      // qualified with `ranked` — `n` exists only inside the subquery. Getting
      // that wrong is what took the section down on 11 of 11 projects.
      const rows = (await query(
        `SELECT ${nodeFields('ranked')}, ranked.cluster_label, ranked.membership_reason FROM (
           SELECT ${NODE_FIELDS}, c.label AS cluster_label, m.membership_reason,
                  c.critical_score,
                  ROW_NUMBER() OVER (
                    PARTITION BY c.id
                    ORDER BY (n.snippet IS NULL), n.file_path, n.line_start NULLS LAST
                  ) AS rn
           FROM architecture_clusters c
           JOIN architecture_cluster_members m ON m.cluster_id = c.id
           JOIN graph_nodes n ON n.id = m.node_id
           WHERE c.snapshot_id = $1
         ) ranked
         WHERE ranked.rn <= 2
         ORDER BY ranked.critical_score DESC, ranked.cluster_label, ranked.rn`,
        [deps.snapshotId],
      )).rows as Array<NodeRow & { cluster_label: string; membership_reason: string }>;
      // Cluster members give the section its STRUCTURE; the decision comments
      // give it the WHY, which is the half the golden checklist found missing.
      // Each one is citable at the exact comment line, so a decision→consequence
      // sentence can point at the rationale the repo's authors wrote themselves
      // instead of at the symbol it happens to sit above.
      const decisions = await loadDecisionNotes(deps.snapshotId, 8);
      return [
        // Two per cluster across the six narrated components, with headroom for
        // the next few — the generator caps the merge at 28 either way.
        ...rows.slice(0, 16).map((r) =>
          fromNode(r, `Member of the "${r.cluster_label}" cluster${r.membership_reason ? ` (${r.membership_reason})` : ''}`)),
        ...decisions.map((d) => ({
          receiptKind: kindForTrust(d.trustLevel),
          trustLevel: d.trustLevel,
          nodeId: d.nodeId,
          nodeStableKey: d.nodeStableKey,
          filePath: d.filePath,
          symbolName: d.symbolName,
          lineStart: d.lineStart,
          lineEnd: d.lineEnd,
          snippet: d.note,
          claim: `Design rationale recorded in the code: ${d.note.slice(0, 180)}`,
        })),
      ];
    }

    case 'code_map': {
      // Same source as the spec's fileGroups (criticality_scores files) —
      // receipts must cover the files the section actually maps.
      const ranked = (await query(
        `SELECT DISTINCT ON (stable_key) stable_key, score, reasons
         FROM criticality_scores
         WHERE snapshot_id = $1 AND target_type = 'file'
         ORDER BY stable_key, score DESC`,
        [deps.snapshotId],
      )).rows as Array<{ stable_key: string; score: number; reasons: string[] }>;
      const targets = ranked
        .sort((a, b) => Number(b.score) - Number(a.score))
        .slice(0, 24)
        .map((r) => ({ stableKey: r.stable_key, reasons: r.reasons ?? [] }));
      return nodesForProjections(deps, targets, 20);
    }

    case 'capabilities': {
      const rows = (await query(
        `SELECT ${NODE_FIELDS}, c.name AS capability_name
         FROM capability_members cm
         JOIN capabilities c ON c.id = cm.capability_id
         JOIN graph_nodes n ON n.snapshot_id = $1 AND n.stable_key = cm.stable_key
         WHERE c.snapshot_id = $1 AND cm.member_type = 'node'
         LIMIT 12`,
        [deps.snapshotId],
      )).rows as Array<NodeRow & { capability_name: string }>;
      if (rows.length > 0) {
        return rows.map((r) => fromNode(r, `Implements the "${r.capability_name}" capability`));
      }
      // ai_disabled has no capabilities — cite the traced workflows' triggers.
      const triggers = (await query(
        `SELECT ${NODE_FIELDS}, w.title AS workflow_title, w.id AS workflow_id
         FROM workflows w
         JOIN entrypoints e ON e.id = w.entrypoint_id
         JOIN graph_nodes n ON n.id = e.node_id
         WHERE w.snapshot_id = $1 LIMIT 12`,
        [deps.snapshotId],
      )).rows as Array<NodeRow & { workflow_title: string; workflow_id: string }>;
      return triggers.map((r) => ({
        ...fromNode(r, `Triggers the "${r.workflow_title}" workflow`),
        workflowId: r.workflow_id,
      }));
    }

    case 'traced_flows': {
      // First and last traced step of each journey (falling back to raw
      // workflows on snapshots without journeys) — where a flow enters and
      // what it ends on, the two lines a reader checks first.
      const rows = (await query(
        `SELECT ranked.workflow_id, ranked.title, ranked.step_kind, ranked.deterministic_description,
                ranked.file_path AS step_file, ranked.symbol_name AS step_symbol,
                ranked.line_start AS step_line_start, ranked.line_end AS step_line_end,
                ranked.node_id, n.stable_key, n.snippet, n.trust_level, n.name
         FROM (
           SELECT ws.*, w.title,
                  ROW_NUMBER() OVER (PARTITION BY ws.workflow_id ORDER BY ws.step_order ASC) AS rn_first,
                  ROW_NUMBER() OVER (PARTITION BY ws.workflow_id ORDER BY ws.step_order DESC) AS rn_last
           FROM workflow_steps ws JOIN workflows w ON w.id = ws.workflow_id
           WHERE w.snapshot_id = $1
             AND (w.trigger_type = 'journey'
                  OR NOT EXISTS (SELECT 1 FROM workflows j
                                 WHERE j.snapshot_id = $1 AND j.trigger_type = 'journey'))
         ) ranked
         LEFT JOIN graph_nodes n ON n.id = ranked.node_id
         WHERE ranked.rn_first = 1 OR ranked.rn_last = 1
         LIMIT 15`,
        [deps.snapshotId],
      )).rows as Array<{
        workflow_id: string; title: string; step_kind: string | null; deterministic_description: string | null;
        step_file: string; step_symbol: string | null; step_line_start: number | null; step_line_end: number | null;
        node_id: string | null; stable_key: string | null; snippet: string | null;
        trust_level: NodeRow['trust_level'] | null; name: string | null;
      }>;
      return rows.map((r) => ({
        receiptKind: 'workflow_step' as const,
        trustLevel: r.trust_level ?? 'code',
        nodeId: r.node_id,
        workflowId: r.workflow_id,
        nodeStableKey: r.stable_key,
        filePath: r.step_file,
        symbolName: r.step_symbol ?? r.name,
        lineStart: r.step_line_start,
        lineEnd: r.step_line_end,
        snippet: r.snippet,
        claim: `"${r.title}"${r.step_kind ? ` ${r.step_kind} step` : ' step'}${r.deterministic_description ? `: ${r.deterministic_description}` : ''}`,
      }));
    }

    case 'data_model':
    case 'concepts': {
      const rows = (await query(
        `SELECT ${NODE_FIELDS} FROM graph_nodes n
         WHERE n.snapshot_id = $1 AND n.type = 'schema' LIMIT 15`,
        [deps.snapshotId],
      )).rows as NodeRow[];
      return rows.map((n) => fromNode(n, `Schema object: ${n.name}`));
    }

    case 'guardrails_ops': {
      const rows = (await query(
        `SELECT ${NODE_FIELDS}, s.type AS effect_type, s.target, s.evidence
         FROM side_effects s JOIN graph_nodes n ON n.id = s.node_id
         WHERE s.snapshot_id = $1 ORDER BY s.type LIMIT 12`,
        [deps.snapshotId],
      )).rows as Array<NodeRow & { effect_type: string; target: string | null; evidence: string }>;
      return rows.map((r) => ({
        ...fromNode(r, `${r.effect_type.replace(/_/g, ' ')}${r.target ? ` → ${r.target}` : ''}`),
        detectionExpression: r.evidence,
      }));
    }

    default:
      return [];
  }
}

/**
 * A receipt-collection attempt that is allowed to have failed.
 *
 * `gap` is non-null when the evidence queries could not RUN — a malformed
 * statement, a dropped column, a dead connection. It is the section's honest
 * unknown (`package_sections.unknowns`, same shape as every other gap the
 * reader is shown) and the machine-readable reason in `generation_context`.
 */
export interface ReceiptGap {
  kind: 'receipts_unavailable';
  detail: string;
}

export interface ReceiptCollection {
  rows: DeterministicReceiptRow[];
  gap: ReceiptGap | null;
}

/**
 * `collectSectionReceipts`, but a broken query degrades the EVIDENCE instead of
 * destroying the SECTION.
 *
 * The failure this exists for: `architecture_deep`'s ranking query referenced
 * an alias that its outer FROM did not declare, every call threw
 * `missing FROM-clause entry for table "n"`, `summaryWorker`'s per-section
 * catch turned that into `recordMissingSection`, and the driver's message was
 * interpolated straight into reader-facing markdown —
 * `> **This section could not be generated.** missing FROM-clause entry for
 * table "n"` — on 11 of 11 audited projects, for hours, with nothing else
 * distinguishing it from an ordinary model failure.
 *
 * Degrade rather than fail, for three reasons:
 *
 *  1. BLAST RADIUS. Receipts are supplementary evidence. A section's prose
 *     comes from `spec.deterministic()`, a different query set entirely, and
 *     the AI path additionally carries semantic receipts from retrieval. Losing
 *     the deterministic receipts should cost the citations, not the component
 *     map, the diagram and the decision narrative — all of which were destroyed
 *     here by evidence the reader never even sees directly.
 *  2. A DRIVER MESSAGE IS NOT PROSE. Failing loudly, as implemented, meant
 *     failing INTO the content column. The reason has to land where failures
 *     are queried (`generation_context`, `unknowns`), not where sentences are
 *     read.
 *  3. SILENCE WAS THE ACTUAL DEFECT. So the degrade is loud in every place that
 *     can be grepped or asserted: a `receipts_unavailable` unknown renders on
 *     the section as a named gap, `generation_context.deterministic_receipts`
 *     records the reason and SQLSTATE, the row is BARRED from the section cache
 *     so a degraded run can never be immortalized, and it goes to stderr. What
 *     it must never again be is a paragraph.
 *
 * Run-control signals (pause/kill/budget/AI-disabled) still propagate untouched
 * — nothing here calls a model, but absorbing one would be a spending bug.
 */
export async function collectSectionReceiptsOrGap(
  sectionType: SectionType,
  deps: SectionDeps,
): Promise<ReceiptCollection> {
  try {
    return { rows: await collectSectionReceipts(sectionType, deps), gap: null };
  } catch (err) {
    if (isRunControlError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // SQLSTATE, when pg gave us one: `42P01` (undefined table/alias) and
    // `42703` (undefined column) are the two that mean "this statement was
    // never going to run", i.e. a deploy-time defect rather than bad data.
    const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : null;
    const detail = `Evidence receipts for this section could not be collected${code ? ` (SQLSTATE ${code})` : ''}: ${message.slice(0, 200)}`;
    console.error(`[receipts] ${sectionType}: deterministic receipt query failed — section ships without citations:`, message);
    return { rows: [], gap: { kind: 'receipts_unavailable', detail } };
  }
}

/** Section-owned receipt copies — mirrors the AI path's persistSection insert. */
export async function insertSectionReceipts(params: {
  projectId: string;
  snapshotId: string;
  sectionId: string;
  commitHash: string;
  rows: DeterministicReceiptRow[];
}): Promise<void> {
  for (const r of params.rows) {
    await query(
      `INSERT INTO source_receipts
         (project_id, snapshot_id, receipt_kind, trust_level, section_id, node_id, workflow_id,
          node_stable_key, file_path, symbol_name, line_start, line_end, snippet,
          detection_expression, claim, commit_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [params.projectId, params.snapshotId, r.receiptKind, r.trustLevel, params.sectionId,
       r.nodeId ?? null, r.workflowId ?? null, r.nodeStableKey ?? null, r.filePath ?? null,
       r.symbolName ?? null, r.lineStart ?? null, r.lineEnd ?? null, r.snippet ?? null,
       r.detectionExpression ?? null, r.claim ?? null, params.commitHash,
       JSON.stringify({ source: 'deterministic' })],
    );
  }
}
