/**
 * Per-section generation specs — the 12-section Diátaxis architecture
 * (doc/ONBOARDING_QUALITY_LATENCY_PLAN.md "The new architecture"). Four
 * chapters, one documentation mode each; every spec declares its chapter +
 * mode (the generator applies the mode's voice scaffold), its deterministic
 * query, retrieval views, anchor diagrams, and depth budget. CONSULT
 * sections carry a deterministic markdown backbone the model annotates but
 * never edits. Sections are generated one at a time, never in one giant
 * call; diagrams derive from deterministic data only.
 */

import { query } from '../../lib/db.js';
import type { ViewType } from '../semantic/embeddingViews.js';
import type { DeveloperRole } from '../semantic/projections.js';
import { loadRoleProjections, critical25, type ProjectedTarget } from './roleProjection.js';
import {
  architectureDiagram, erDiagram, envExternalServices, topologyDiagram,
  workflowSequenceDiagram, type DiagramSpec, type DiagramStep,
} from './diagrams.js';
import {
  loadConfigFacts, buildRoutesJobsBackbone, buildDataModelBackbone, buildGuardrailsBackbone,
  type ConfigFacts,
} from './referenceBackbones.js';

export const SECTION_TYPES = [
  // ORIENT
  'big_picture', 'concepts',
  // UNDERSTAND
  'architecture_deep', 'traced_flows', 'code_map', 'capabilities',
  // DO
  'setup_run', 'first_change', 'common_tasks',
  // CONSULT
  'routes_jobs', 'data_model', 'guardrails_ops',
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export type Chapter = 'orient' | 'understand' | 'do' | 'consult';
export type SectionMode = 'explanation' | 'tutorial' | 'howto' | 'reference';

export const CHAPTERS: Record<Chapter, { title: string; blurb: string }> = {
  orient: {
    title: 'Orient',
    blurb: 'What this system is and the vocabulary it thinks in — read first, ~10 minutes.',
  },
  understand: {
    title: 'Understand',
    blurb: 'The deep middle: subsystems, end-to-end flows, the files that matter, and what the product does.',
  },
  do: {
    title: 'Do',
    blurb: 'Hands on: run it, make your first change, and the recipes for this repo\'s recurring tasks.',
  },
  consult: {
    title: 'Consult',
    blurb: 'Reference tables generated from code facts — routes, jobs, data model, guardrails. Look things up; don\'t read linearly.',
  },
};

/**
 * Canonical display titles. Section titles are standardized — the LLM's
 * title suggestion is ignored so packages always read the same.
 */
export const SECTION_TITLES: Record<SectionType, string> = {
  big_picture: 'The Big Picture',
  concepts: 'Concepts & Vocabulary',
  architecture_deep: 'Architecture in Depth',
  traced_flows: 'Traced Flows: End to End',
  code_map: 'Code Map: Files That Matter',
  capabilities: 'Capabilities: What It Does',
  setup_run: 'Set Up & Run It',
  first_change: 'Your First Change',
  common_tasks: 'Common Tasks',
  routes_jobs: 'Routes, Jobs & Webhooks',
  data_model: 'Data Model',
  guardrails_ops: 'Guardrails & Operations',
};

export interface SectionDeps {
  snapshotId: string;
  projectId: string;
  role: DeveloperRole;
  /** Loaded once per package generation and shared across sections. */
  projections: ProjectedTarget[];
  /** Depth-contract size class, from the snapshot's symbol count. */
  sizeClass: 'small' | 'mid' | 'large';
}

/** Output budgets by repo size class (depth contract — plan rule 7). */
export interface OutputBudget {
  small: number;
  mid: number;
  large: number;
}

export interface SectionSpec {
  chapter: Chapter;
  mode: SectionMode;
  views: ViewType[];
  retrievalTask: (role: DeveloperRole) => string;
  instructions: string;
  deterministic: (deps: SectionDeps) => Promise<Record<string, unknown>>;
  diagrams?: (deps: SectionDeps) => Promise<DiagramSpec[]>;
  /**
   * CONSULT only: deterministic markdown the generator splices in where the
   * model writes [[backbone]] (appended after the intro if the marker is
   * missing). The model annotates around it; the facts stay byte-stable.
   */
  backbone?: (deps: SectionDeps) => Promise<string>;
  /**
   * Deterministic coverage check against the section's own facts — the
   * model intermittently ships a TL;DR and stops (measured ~50% collapse on
   * enumeration-heavy sections). Returned issues trigger the existing
   * stricter retry with a concrete "you covered X of Y" complaint.
   */
  completenessCheck?: (content: string, deterministic: Record<string, unknown>) => string[];
  outputBudget: OutputBudget;
}

/** Items named in the facts that the prose never mentions. */
function missingItems(content: string, wanted: string[], label: string, minShare = 0.7): string[] {
  if (wanted.length === 0) return [];
  const missing = wanted.filter((w) => w && !content.includes(w));
  const covered = wanted.length - missing.length;
  if (covered >= Math.ceil(wanted.length * minShare)) return [];
  return [
    `INCOMPLETE: you covered ${covered} of ${wanted.length} required ${label} — the section must cover them all. Missing: ${missing.slice(0, 12).join(', ')}`,
  ];
}

const projectionRow = (t: ProjectedTarget) => ({
  targetType: t.targetType, stableKey: t.stableKey, score: Math.round(t.score * 1000) / 1000, reasons: t.reasons.slice(0, 4),
});

/**
 * Models copy whatever identifier they see, no matter the instructions —
 * wf:/cluster: stable keys leaked into three different sections before
 * this became mechanical. Projection rows for synthesis targets
 * (workflows, clusters) are served with their human title INSTEAD of the
 * stable key; path-keyed rows keep their stableKey (it IS the human name).
 */
async function humanizeProjectionRows(
  snapshotId: string,
  targets: ProjectedTarget[],
): Promise<Array<Record<string, unknown>>> {
  const titles = new Map<string, string>();
  for (const row of (await query(
    `SELECT stable_key, title AS name FROM workflows WHERE snapshot_id = $1
     UNION ALL
     SELECT stable_key, label AS name FROM architecture_clusters WHERE snapshot_id = $1`,
    [snapshotId],
  )).rows as Array<{ stable_key: string; name: string }>) {
    titles.set(row.stable_key, row.name);
  }
  return targets.map((t) => {
    if (titles.has(t.stableKey)) {
      const { stableKey: _hidden, ...rest } = projectionRow(t);
      return { ...rest, title: titles.get(t.stableKey) };
    }
    return projectionRow(t);
  });
}

/**
 * "Which tests protect you": tested-key -> test-file keys from the graph's
 * `tests` edges. A named test is a mechanical fact, "well tested" is not.
 */
async function testGuardsFor(snapshotId: string): Promise<Record<string, string[]>> {
  const rows = (await query(
    `SELECT tn.stable_key AS target_key, sn.stable_key AS test_key
     FROM graph_edges e
     JOIN graph_nodes sn ON sn.id = e.source_node_id
     JOIN graph_nodes tn ON tn.id = e.target_node_id
     WHERE e.snapshot_id = $1 AND e.type = 'tests'
     LIMIT 80`,
    [snapshotId],
  )).rows as Array<{ target_key: string; test_key: string }>;
  const guards: Record<string, string[]> = {};
  for (const r of rows) {
    (guards[r.target_key] ??= []).push(r.test_key);
  }
  return guards;
}

/** Journeys (composed + config) with their steps — the flow layer above raw workflows. */
async function loadJourneys(snapshotId: string, limit = 8): Promise<Array<Record<string, unknown>>> {
  return (await query(
    `SELECT w.title, w.trigger_type, w.purpose, w.confidence,
            w.metadata->'journey'->'member_titles' AS member_titles,
            json_agg(json_build_object('order', ws.step_order, 'file', ws.file_path, 'symbol', ws.symbol_name,
                                       'kind', ws.step_kind, 'description', ws.deterministic_description)
                     ORDER BY ws.step_order) AS steps
     FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
     WHERE w.snapshot_id = $1 AND w.trigger_type IN ('journey', 'dev_command', 'ci_pipeline')
     GROUP BY w.id
     ORDER BY (w.metadata->>'importance_score')::float DESC NULLS LAST
     LIMIT $2`,
    [snapshotId, limit],
  )).rows;
}

const snapshotCounts = async (snapshotId: string) =>
  (await query(
    `SELECT file_count, symbol_count, workflow_count, language_inventory FROM analysis_snapshots WHERE id = $1`,
    [snapshotId],
  )).rows[0];

export const SECTION_SPECS: Record<SectionType, SectionSpec> = {
  // ═══ ORIENT ═══════════════════════════════════════════════════════════════

  big_picture: {
    chapter: 'orient',
    mode: 'explanation',
    views: ['purpose', 'domain'],
    retrievalTask: () => 'What this system is end to end: its purpose, runtime processes, product journeys, and external services.',
    instructions: [
      'Explain what this system IS — the reader has never seen it. The anchor diagram (runtime topology) opens the section; refer to it, never contradict it.',
      'Cover, as flowing prose with a few short headers: (1) what the system does end to end and for whom, from the evidence; (2) the runtime shape — each compose service/process and its job, plus the external services (from the topology facts); (3) the product journeys BY NAME (the journeys data is authoritative — walk the 2-4 most important in one paragraph each: what enters, what crosses which boundary, what comes out); (4) why the system is shaped this way — the 2-3 structural decisions visible in the evidence (queues between phases, content-addressing, separate worker), each with its receipt.',
      'No instructions, no tables, no file inventories — link forward: details live in Architecture in Depth, commands in Set Up & Run It, lookup tables in the Consult chapter.',
    ].join(' '),
    deterministic: async (deps) => {
      const facts = await loadConfigFacts(deps.snapshotId);
      return {
        snapshot: await snapshotCounts(deps.snapshotId),
        topology: facts.topology,
        externalServices: envExternalServices(facts.envFiles.flatMap((f) => f.vars.map((v) => v.name))),
        journeys: await loadJourneys(deps.snapshotId, 6),
        topClusters: (await query(
          `SELECT c.label, c.kind,
                  (SELECT count(*)::int FROM architecture_cluster_members m WHERE m.cluster_id = c.id) AS file_count
           FROM architecture_clusters c WHERE c.snapshot_id = $1 ORDER BY c.critical_score DESC LIMIT 8`,
          [deps.snapshotId],
        )).rows,
      };
    },
    diagrams: async (deps) => {
      const facts = await loadConfigFacts(deps.snapshotId);
      if (facts.topology) {
        const externals = envExternalServices(facts.envFiles.flatMap((f) => f.vars.map((v) => v.name)));
        return [{ kind: 'topology', mermaid: topologyDiagram(facts.topology.services, externals) }];
      }
      // No compose file: fall back to the cluster map so the anchor rule holds.
      const clusters = (await query(
        `SELECT stable_key, label, kind FROM architecture_clusters WHERE snapshot_id = $1`,
        [deps.snapshotId],
      )).rows as Array<{ stable_key: string; label: string; kind: string }>;
      const edges = (await query(
        `SELECT sc.stable_key AS source_key, tc.stable_key AS target_key, e.type, e.weight
         FROM architecture_edges e
         JOIN architecture_clusters sc ON sc.id = e.source_cluster_id
         JOIN architecture_clusters tc ON tc.id = e.target_cluster_id
         WHERE e.snapshot_id = $1`,
        [deps.snapshotId],
      )).rows as Array<{ source_key: string; target_key: string; type: string; weight: number }>;
      return [{
        kind: 'architecture',
        mermaid: architectureDiagram(
          clusters.map((c) => ({ stableKey: c.stable_key, label: c.label, kind: c.kind })),
          edges.map((e) => ({ sourceClusterKey: e.source_key, targetClusterKey: e.target_key, type: e.type, weight: e.weight })),
        ),
      }];
    },
    outputBudget: { small: 4_000, mid: 6_000, large: 8_000 },
  },

  concepts: {
    chapter: 'orient',
    mode: 'explanation',
    views: ['domain', 'purpose'],
    retrievalTask: () => 'The domain vocabulary this codebase thinks in: its core nouns, what each means here, and where each lives.',
    instructions: [
      'Define the load-bearing vocabulary — the nouns a new joiner must know to follow any conversation about this code. Select 10-18 terms FROM THE EVIDENCE: schema table names, capability names, recurring record/workflow nouns, config concepts. Prefer terms this codebase uses with a SPECIFIC meaning over generic industry words.',
      'Format: "### term" then 2-4 sentences: what it means IN THIS SYSTEM (not the dictionary meaning), where it lives (the table and/or module, from the evidence), and how it relates to neighboring terms. Cite a receipt per term.',
      'Order terms so each definition only uses terms already defined. Close with one short paragraph on how the 3-4 most central terms connect end to end.',
    ].join(' '),
    deterministic: async (deps) => ({
      schemaTables: (await query(
        `SELECT name, file_path, metadata->'references' AS refs FROM graph_nodes
         WHERE snapshot_id = $1 AND type = 'schema' ORDER BY line_start NULLS LAST LIMIT 45`,
        [deps.snapshotId],
      )).rows,
      capabilities: (await query(
        `SELECT name, description FROM capabilities WHERE snapshot_id = $1 LIMIT 12`,
        [deps.snapshotId],
      )).rows,
      clusters: (await query(
        `SELECT label, kind FROM architecture_clusters WHERE snapshot_id = $1 ORDER BY critical_score DESC LIMIT 10`,
        [deps.snapshotId],
      )).rows,
      journeyTitles: (await query(
        `SELECT title, purpose FROM workflows WHERE snapshot_id = $1 AND trigger_type = 'journey'`,
        [deps.snapshotId],
      )).rows,
      envVarNames: (await loadConfigFacts(deps.snapshotId)).envFiles.flatMap((f) => f.vars.map((v) => v.name)).slice(0, 40),
    }),
    completenessCheck: (content, det) => {
      const issues: string[] = [];
      const terms = (content.match(/### /g) ?? []).length;
      if (terms < 8) issues.push(`INCOMPLETE: only ${terms} "### term" entries — define at least 10 load-bearing terms from the evidence.`);
      // The most-referenced schema tables ARE the load-bearing nouns —
      // a concepts section that skips them defines the wrong vocabulary.
      const tables = (det.schemaTables as Array<{ name?: string; refs?: string[] | null }> ?? []);
      const degree = new Map<string, number>();
      for (const t of tables) for (const r of t.refs ?? []) degree.set(r, (degree.get(r) ?? 0) + 1);
      const coreStems = [...degree.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name]) => name.replace(/^analysis_|^source_|^onboarding_/, '').replace(/s$/, ''));
      const lower = content.toLowerCase();
      const missing = coreStems.filter((stem) => stem.length >= 4 && !lower.includes(stem));
      if (coreStems.length >= 3 && missing.length * 2 > coreStems.length) {
        issues.push(`INCOMPLETE: the schema's most-referenced concepts are missing — define: ${missing.join(', ')}`);
      }
      return issues;
    },
    outputBudget: { small: 5_000, mid: 8_000, large: 11_000 },
  },

  // ═══ UNDERSTAND ═══════════════════════════════════════════════════════════

  architecture_deep: {
    chapter: 'understand',
    mode: 'explanation',
    views: ['purpose', 'dependency'],
    retrievalTask: () => 'System architecture in depth: each subsystem\'s responsibility, boundaries, crossings, and the design decisions behind them.',
    instructions: [
      'The anchor diagram (cluster map) opens the section — the prose walks it. Open with "## How a request flows": ONE real end-to-end path across cluster boundaries using clusterEdges and their workflow crossings, naming clusters in order.',
      'Then one "## <cluster label>" subsection PER major cluster (cover every cluster in the evidence with more than 2 files): its responsibility (from deterministic_summary — no "handles business logic" filler), its real file count, what crosses its boundary in and out (from clusterEdges), and the design decisions visible in the evidence for it — state each decision as decision → consequence ("transaction-mode pooler ⇒ no session state ⇒ every lock is a row lock") with a receipt. Admitting trade-offs is correct here; inventing them is not.',
      'Close with "## Tensions to know about": 2-3 places where the evidence shows coupling or asymmetry a newcomer will trip on (highest fan-in modules, cycles, wide-blast-radius shared code — from centralNodes).',
      'The interactive Architecture tab holds the full drill-down graph — say so once at the end, not per cluster.',
    ].join(' '),
    deterministic: async (deps) => ({
      clusters: (await query(
        `SELECT c.label, c.kind, c.critical_score, c.deterministic_summary,
                (SELECT count(*)::int FROM architecture_cluster_members m WHERE m.cluster_id = c.id) AS file_count
         FROM architecture_clusters c WHERE c.snapshot_id = $1 ORDER BY c.critical_score DESC`,
        [deps.snapshotId],
      )).rows,
      clusterEdges: (await query(
        `SELECT sc.label AS source, tc.label AS target, e.type, e.weight, e.metadata->'workflowCrossings' AS workflow_crossings
         FROM architecture_edges e
         JOIN architecture_clusters sc ON sc.id = e.source_cluster_id
         JOIN architecture_clusters tc ON tc.id = e.target_cluster_id
         WHERE e.snapshot_id = $1 ORDER BY e.weight DESC LIMIT 30`,
        [deps.snapshotId],
      )).rows,
      centralNodes: (await query(
        `SELECT stable_key, name, (metadata->>'dependentCount')::int AS dependents
         FROM graph_nodes WHERE snapshot_id = $1 AND (metadata->>'dependentCount')::int > 0
         ORDER BY 3 DESC LIMIT 12`,
        [deps.snapshotId],
      )).rows,
    }),
    diagrams: async (deps) => {
      const clusters = (await query(
        `SELECT stable_key, label, kind FROM architecture_clusters WHERE snapshot_id = $1`,
        [deps.snapshotId],
      )).rows as Array<{ stable_key: string; label: string; kind: string }>;
      const edges = (await query(
        `SELECT sc.stable_key AS source_key, tc.stable_key AS target_key, e.type, e.weight
         FROM architecture_edges e
         JOIN architecture_clusters sc ON sc.id = e.source_cluster_id
         JOIN architecture_clusters tc ON tc.id = e.target_cluster_id
         WHERE e.snapshot_id = $1`,
        [deps.snapshotId],
      )).rows as Array<{ source_key: string; target_key: string; type: string; weight: number }>;
      return [{
        kind: 'architecture',
        mermaid: architectureDiagram(
          clusters.map((c) => ({ stableKey: c.stable_key, label: c.label, kind: c.kind })),
          edges.map((e) => ({ sourceClusterKey: e.source_key, targetClusterKey: e.target_key, type: e.type, weight: e.weight })),
        ),
      }];
    },
    outputBudget: { small: 6_000, mid: 10_000, large: 15_000 },
  },

  traced_flows: {
    chapter: 'understand',
    mode: 'explanation',
    views: ['purpose', 'operations'],
    retrievalTask: () => 'End-to-end flows: what each product journey does step by step across boundaries, and why each hop exists.',
    instructions: [
      'Walk the provided journeys end to end — journeys are the authoritative flow layer (they already stitch route -> queue -> worker hops; member workflows are the drill-down). One "## <journey title>" per journey, most important first; each journey\'s sequence diagram is attached in order — refer to it.',
      'Per journey: one sentence on what it accomplishes, then the steps IN ORDER — for each hop name the real file::symbol, what happens there (from the step description and record evidence), and when a hop crosses a boundary (queue, redirect, service) say so explicitly. After the steps, one "Why this design" note per non-obvious structural choice visible in the flow (a queue between phases, an auth guard placement) with its receipt.',
      'Use only traced steps — never invent steps. Describe failure handling only from visible evidence; if none is visible for a journey, write "failure handling not visible in the trace".',
      'When a step WRITES data, say so explicitly — do not soften writes into reads.',
    ].join(' '),
    deterministic: async (deps) => ({
      journeys: await loadJourneys(deps.snapshotId, 5),
      // Members give the model per-hop drill-down steps for the narrative.
      memberWorkflows: (await query(
        `SELECT w.title, w.trigger_type, w.purpose,
                json_agg(json_build_object('order', ws.step_order, 'file', ws.file_path, 'symbol', ws.symbol_name,
                                           'kind', ws.step_kind, 'description', ws.deterministic_description)
                         ORDER BY ws.step_order) AS steps
         FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
         WHERE w.snapshot_id = $1 AND w.stable_key IN (
           SELECT jsonb_array_elements_text(metadata->'journey'->'members')
           FROM workflows WHERE snapshot_id = $1 AND trigger_type = 'journey'
         )
         GROUP BY w.id LIMIT 12`,
        [deps.snapshotId],
      )).rows,
    }),
    completenessCheck: (content, det) => {
      const titles = (det.journeys as Array<{ title?: string }> ?? []).map((j) => j.title ?? '');
      return missingItems(content, titles, 'journeys', 1);
    },
    diagrams: async (deps) => {
      const journeys = (await query(
        `SELECT w.title, json_agg(json_build_object('stepOrder', ws.step_order, 'filePath', ws.file_path,
                                                    'symbolName', ws.symbol_name, 'stepKind', ws.step_kind,
                                                    'description', ws.deterministic_description)
                                  ORDER BY ws.step_order) AS steps
         FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
         WHERE w.snapshot_id = $1 AND w.trigger_type = 'journey'
         GROUP BY w.id
         ORDER BY (w.metadata->>'importance_score')::float DESC NULLS LAST
         LIMIT 4`,
        [deps.snapshotId],
      )).rows as Array<{ title: string; steps: DiagramStep[] }>;
      return journeys.map((j) => ({ kind: 'sequence' as const, mermaid: workflowSequenceDiagram(j.title, j.steps) }));
    },
    outputBudget: { small: 6_000, mid: 10_000, large: 14_000 },
  },

  code_map: {
    chapter: 'understand',
    mode: 'explanation',
    views: ['purpose', 'dependency'],
    retrievalTask: (role) => `The files that matter most and why — what each does, its key functions, and how they connect, for a ${role} developer.`,
    instructions: [
      'A guided map of the files that matter, GROUPED BY SUBSYSTEM (the groups come from fileGroups — never present a flat ranked list; ranking selected the entries, grouping presents them).',
      'One "## <subsystem>" per group. Per file: `path` as a sub-heading or bold lead, then 1-2 sentences on why it matters HERE (from its record evidence: what it orchestrates, who depends on it — the dependents number is provided), then its key functions in the micro-format: `name(signature)` — one-liner · params worth knowing · returns · gotcha (only when the evidence shows one). Then one line: what calls it / what it calls (from the evidence).',
      'Cover every file in fileGroups. Numbers (dependents, counts) come verbatim from the facts. No scores in prose.',
    ].join(' '),
    deterministic: async (deps) => {
      // Files come straight from criticality_scores: the role projections
      // carry only a handful of file targets (they're symbol/workflow-heavy),
      // which starved the map — the live run produced a 2-file code_map.
      const ranked = (await query(
        `SELECT DISTINCT ON (stable_key) stable_key, score, reasons
         FROM criticality_scores
         WHERE snapshot_id = $1 AND target_type = 'file'
         ORDER BY stable_key, score DESC`,
        [deps.snapshotId],
      )).rows as Array<{ stable_key: string; score: number; reasons: string[] }>;
      const fileTargets = ranked
        .sort((a, b) => Number(b.score) - Number(a.score))
        .slice(0, 36)
        .map((r) => ({ stableKey: r.stable_key, reasons: r.reasons ?? [] }));
      const keys = fileTargets.map((t) => t.stableKey);
      const memberships = keys.length > 0 ? (await query(
        `SELECT n.stable_key, c.label
         FROM architecture_cluster_members m
         JOIN architecture_clusters c ON c.id = m.cluster_id
         JOIN graph_nodes n ON n.id = m.node_id
         WHERE c.snapshot_id = $1 AND n.stable_key = ANY($2)`,
        [deps.snapshotId, keys],
      )).rows as Array<{ stable_key: string; label: string }> : [];
      const clusterOf = new Map(memberships.map((m) => [m.stable_key, m.label]));
      const nodeFacts = keys.length > 0 ? (await query(
        `SELECT stable_key, (metadata->>'dependentCount')::int AS dependents,
                (metadata->>'importCount')::int AS imports, metadata->>'lineCount' AS line_count
         FROM graph_nodes WHERE snapshot_id = $1 AND stable_key = ANY($2)`,
        [deps.snapshotId, keys],
      )).rows as Array<{ stable_key: string; dependents: number | null; imports: number | null; line_count: string | null }> : [];
      const factsOf = new Map(nodeFacts.map((n) => [n.stable_key, n]));
      const groups: Record<string, Array<Record<string, unknown>>> = {};
      for (const t of fileTargets) {
        const group = clusterOf.get(t.stableKey) ?? 'Other';
        (groups[group] ??= []).push({
          path: t.stableKey,
          reasons: t.reasons.slice(0, 3),
          dependents: factsOf.get(t.stableKey)?.dependents ?? null,
          imports: factsOf.get(t.stableKey)?.imports ?? null,
        });
      }
      return {
        fileGroups: groups,
        keySymbols: (critical25(deps.projections).get('symbol') ?? []).slice(0, 30).map(projectionRow),
      };
    },
    completenessCheck: (content, det) => {
      const groups = det.fileGroups as Record<string, Array<{ path: string }>>;
      const paths = Object.values(groups ?? {}).flat().map((f) => f.path);
      return missingItems(content, paths, 'mapped files');
    },
    outputBudget: { small: 7_000, mid: 12_000, large: 17_000 },
  },

  capabilities: {
    chapter: 'understand',
    mode: 'explanation',
    views: ['domain'],
    retrievalTask: () => 'The product capabilities: what the system does for its users and where each capability lives in the code.',
    instructions: [
      'Describe each capability the system provides: what user value it delivers, which journeys/workflows implement it, which clusters/modules own it, and the 1-2 seams you would touch to EXTEND it (from the member evidence — the files where that capability\'s behavior is decided).',
      'This is business context anchored in code, not code documentation. If a capability has no userValue in the evidence, omit that line entirely — never print "N/A". Refer to workflows and modules by their human-readable titles; internal keys (wf:…, cluster:…) must never appear in the output.',
    ].join(' '),
    deterministic: async (deps) => {
      const rows = (await query(
        `SELECT c.name, c.description, c.confidence, c.metadata->>'userValue' AS user_value,
                json_agg(json_build_object('type', cm.member_type, 'key', cm.stable_key)) AS members
         FROM capabilities c
         LEFT JOIN capability_members cm ON cm.capability_id = c.id
         WHERE c.snapshot_id = $1 GROUP BY c.id`,
        [deps.snapshotId],
      )).rows as Array<{ members: Array<Record<string, unknown>> | null } & Record<string, unknown>>;
      return {
        // Unbounded member lists flooded the facts budget and starved the
        // prose — a capability's identity is its top seams, not every file.
        capabilities: rows.map((r) => ({ ...r, members: (r.members ?? []).slice(0, 12) })),
        journeys: (await query(
          `SELECT title, purpose FROM workflows WHERE snapshot_id = $1 AND trigger_type IN ('journey', 'dev_command') LIMIT 10`,
          [deps.snapshotId],
        )).rows,
      };
    },
    completenessCheck: (content, det) => {
      const caps = (det.capabilities as Array<{ name?: string }> ?? []).map((c) => c.name ?? '');
      return missingItems(content, caps, 'capabilities', 1);
    },
    outputBudget: { small: 4_000, mid: 7_000, large: 9_000 },
  },

  // ═══ DO ═══════════════════════════════════════════════════════════════════

  setup_run: {
    chapter: 'do',
    mode: 'tutorial',
    views: ['purpose'],
    retrievalTask: () => 'How to set up and run this project locally: prerequisites, environment, run commands, and how to verify each step.',
    instructions: [
      'A guaranteed-success first run. Steps come ONLY from evidence: compose files (the topology facts and devJourneys are parsed from them), package scripts, README receipts, and env templates. If evidence contains no run path, say exactly that and stop — never invent a command.',
      'Structure: "## Prerequisites" (tools implied by the evidence: docker for compose, node version if declared) → "## Configure" (the env file(s) to create, citing the template names — never values) → "## Run" (numbered steps; each step = ONE command in a code block + a "You should see:" verify line grounded in evidence — ports from the topology, service names, log strings only if a receipt shows them) → "## Run the tests" (the one-command test path from devJourneys, with its verify line) → "## If it breaks" (2-3 failure boxes ONLY from visible evidence: a required env var, a port in use, a missing file the compose mounts).',
      'Every promised result must be checkable. One unbranching path — no alternatives, no "you could also".',
    ].join(' '),
    deterministic: async (deps) => {
      const facts = await loadConfigFacts(deps.snapshotId);
      return {
        topology: facts.topology,
        testTopology: facts.testTopology,
        envFiles: facts.envFiles.map((f) => ({ path: f.path, varNames: f.vars.map((v) => v.name) })),
        packageScripts: facts.packageScripts,
        devJourneys: (await query(
          `SELECT w.title, w.purpose,
                  json_agg(json_build_object('order', ws.step_order, 'description', ws.deterministic_description) ORDER BY ws.step_order) AS steps
           FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
           WHERE w.snapshot_id = $1 AND w.trigger_type = 'dev_command' GROUP BY w.id`,
          [deps.snapshotId],
        )).rows,
        runSurface: (await query(
          `SELECT file_path, category FROM repository_files
           WHERE snapshot_id = $1 AND (
             file_path ILIKE '%docker-compose%' OR file_path ILIKE '%makefile%'
             OR file_path = 'package.json' OR file_path ILIKE '%/package.json'
             OR file_path ILIKE 'readme%' OR file_path ILIKE '%/readme%'
           )
           ORDER BY length(file_path) LIMIT 12`,
          [deps.snapshotId],
        )).rows,
      };
    },
    outputBudget: { small: 4_000, mid: 6_000, large: 8_000 },
  },

  first_change: {
    chapter: 'do',
    mode: 'tutorial',
    views: ['purpose', 'dependency'],
    retrievalTask: (role) => `A safe, real first change a new ${role} developer could make: where, what pattern to follow, and how to verify it.`,
    instructions: [
      'Design ONE starter exercise — a small, real, safe change in this repo — from the evidence: prefer an area that (a) appears in safeCandidates (moderate rank, low dependents), (b) has a test in testGuards, and (c) follows an existing visible pattern (an exemplar snippet in the receipts).',
      'Structure: "## The exercise" (one paragraph: what to add/change and why it is safe) → "## Files you will touch" (the exact files, each with one line on its role) → "## Steps" (numbered, imperative, one action each; point at the exemplar pattern to copy from with its receipt; state the expected diff shape — which file gains roughly how many lines where) → "## Verify" (the EXACT test file/command from the evidence; if testGuards has no test for the area, say plainly that tests are not visible and give the manual check instead) → "## What this teaches" (2-3 sentences connecting what they just touched to the bigger flows).',
      'The reader must succeed: no forks, no optional paths, no invented commands.',
    ].join(' '),
    deterministic: async (deps) => {
      const guards = await testGuardsFor(deps.snapshotId);
      const midRank = deps.projections
        .filter((p) => p.targetType === 'file')
        .slice(3, 25)
        .map(projectionRow);
      return {
        safeCandidates: midRank,
        testGuards: guards,
        churnedFiles: (await query(
          `SELECT stable_key, metadata->'churn'->>'commitCount90d' AS commits_90d
           FROM repository_files WHERE snapshot_id = $1
             AND (metadata->'churn'->>'commitCount90d')::int > 0
           ORDER BY (metadata->'churn'->>'commitCount90d')::int DESC LIMIT 12`,
          [deps.snapshotId],
        )).rows,
      };
    },
    outputBudget: { small: 3_500, mid: 5_000, large: 6_500 },
  },

  common_tasks: {
    chapter: 'do',
    mode: 'howto',
    views: ['purpose', 'dependency'],
    retrievalTask: () => 'The recurring engineering tasks in this repo: how to add a route, a table, a job, a page, a test — following existing patterns.',
    instructions: [
      'How-to recipes for THIS repo\'s recurring tasks. The taskShapes data lists the task patterns detected in this repo with exemplar files — write ONE "## How to <goal>" recipe per shape (skip shapes with no exemplars). Assume competence: no basics, no theory, no motivation paragraphs.',
      'Per recipe: goal-first title; then numbered steps in conditional-imperative voice ("If the route needs auth, wrap it in …"); each step names the REAL file to touch and points at the exemplar to copy from (cite its receipt); end with a one-line verification (the test pattern or command from the evidence).',
      'Steps are for someone who knows how to code — they need the repo\'s way, not a tutorial. Link to Consult tables for full option lists instead of enumerating them.',
    ].join(' '),
    deterministic: async (deps) => {
      // Task shapes detected from repo structure — each with real exemplars.
      const [routes, migrations, consumers, pages, tests] = await Promise.all([
        query(
          `SELECT n.file_path, count(*)::int AS routes FROM entrypoints e
           JOIN graph_nodes n ON n.id = e.node_id
           WHERE e.snapshot_id = $1 AND e.trigger_type = 'http_route'
           GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
          [deps.snapshotId],
        ),
        query(
          `SELECT file_path FROM repository_files WHERE snapshot_id = $1 AND category IN ('migration', 'schema') LIMIT 4`,
          [deps.snapshotId],
        ),
        query(
          `SELECT n.file_path FROM entrypoints e JOIN graph_nodes n ON n.id = e.node_id
           WHERE e.snapshot_id = $1 AND e.trigger_type = 'worker_job' LIMIT 4`,
          [deps.snapshotId],
        ),
        query(
          `SELECT n.file_path FROM entrypoints e JOIN graph_nodes n ON n.id = e.node_id
           WHERE e.snapshot_id = $1 AND e.trigger_type = 'ui_route' LIMIT 5`,
          [deps.snapshotId],
        ),
        query(
          `SELECT file_path FROM repository_files WHERE snapshot_id = $1 AND category = 'test' ORDER BY file_path LIMIT 6`,
          [deps.snapshotId],
        ),
      ]);
      const facts = await loadConfigFacts(deps.snapshotId);
      const taskShapes: Array<Record<string, unknown>> = [];
      if (routes.rows.length > 0) taskShapes.push({ goal: 'add an API route', exemplars: routes.rows });
      if (migrations.rows.length > 0) taskShapes.push({ goal: 'add or change a database table', exemplars: migrations.rows });
      if (consumers.rows.length > 0) taskShapes.push({ goal: 'add a background job', exemplars: consumers.rows });
      if (pages.rows.length > 0) taskShapes.push({ goal: 'add a UI page', exemplars: pages.rows });
      if (tests.rows.length > 0) {
        taskShapes.push({
          goal: 'write and run a test',
          exemplars: tests.rows,
          testCommands: facts.packageScripts.flatMap((p) =>
            Object.entries(p.scripts).filter(([k]) => /test/.test(k)).map(([k, v]) => `${k}: ${v}`)).slice(0, 4),
        });
      }
      return { taskShapes };
    },
    completenessCheck: (content, det) => {
      const goals = (det.taskShapes as Array<{ goal?: string }> ?? []).map((t) => t.goal ?? '');
      return missingItems(content, goals, 'task recipes', 1);
    },
    outputBudget: { small: 5_000, mid: 8_000, large: 10_000 },
  },

  // ═══ CONSULT ══════════════════════════════════════════════════════════════

  routes_jobs: {
    chapter: 'consult',
    mode: 'reference',
    views: ['purpose'],
    retrievalTask: () => 'Every route, queue, job type, and webhook — grouped for lookup.',
    instructions: [
      'Reference for lookup, not reading. Write: (1) a 2-3 sentence intro stating what the tables cover and how they are grouped, then the marker [[backbone]] on its own line (the deterministic route/queue/webhook tables are inserted there — you never write route tables yourself), then (2) "### Notes per group" — ONE factual line per route group naming its purpose, only where the evidence shows it (handler/workflow evidence); omit groups you cannot ground.',
      'Route paths in your prose must be FULL mounted paths copied from the evidence. Never instruct, never opine — describe.',
    ].join(' '),
    deterministic: async (deps) => ({
      routeCount: Number(((await query(
        `SELECT count(*)::int AS n FROM entrypoints WHERE snapshot_id = $1 AND trigger_type = 'http_route' AND route_path IS NOT NULL`,
        [deps.snapshotId],
      )).rows[0] as { n: number } | undefined)?.n ?? 0),
      queues: (await query(
        `SELECT route_path AS queue_name FROM entrypoints WHERE snapshot_id = $1 AND trigger_type = 'worker_job'`,
        [deps.snapshotId],
      )).rows,
      groupsPreview: (await query(
        `SELECT e.route_path, e.method, w.title AS workflow FROM entrypoints e
         LEFT JOIN workflows w ON w.entrypoint_id = e.id
         WHERE e.snapshot_id = $1 AND e.trigger_type = 'http_route' AND e.route_path IS NOT NULL
         ORDER BY e.route_path LIMIT 60`,
        [deps.snapshotId],
      )).rows,
    }),
    backbone: (deps) => buildRoutesJobsBackbone(deps.snapshotId),
    outputBudget: { small: 2_500, mid: 3_500, large: 4_500 },
  },

  data_model: {
    chapter: 'consult',
    mode: 'reference',
    views: ['operations', 'dependency'],
    retrievalTask: () => 'The data model: what each table group stores and which invariants matter.',
    instructions: [
      'Reference for lookup. Write: (1) a 2-3 sentence intro naming the schema source file(s) and the total table count VERBATIM from schemaTableCount (never count yourself), then the marker [[backbone]] on its own line (the deterministic table inventory is inserted there — you never write the table list yourself), then (2) "### Table groups" — group the tables into 3-6 domains by name/relationships and give ONE factual line per group on what it stores and the key relationship, grounded in the refs/access evidence.',
      'The anchor ER diagram is drawn from parsed foreign keys — refer to it; never contradict it. Say plainly that column-level detail beyond the evidence is not included.',
    ].join(' '),
    deterministic: async (deps) => {
      const schemaTableCount = Number(((await query(
        `SELECT count(*)::int AS n FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema'`,
        [deps.snapshotId],
      )).rows[0] as { n: number } | undefined)?.n ?? 0);
      return {
        schemaTableCount,
        tables: (await query(
          `SELECT name, metadata->'references' AS refs FROM graph_nodes
           WHERE snapshot_id = $1 AND type = 'schema' ORDER BY line_start NULLS LAST LIMIT 60`,
          [deps.snapshotId],
        )).rows,
      };
    },
    backbone: (deps) => buildDataModelBackbone(deps.snapshotId),
    diagrams: async (deps) => {
      const tables = (await query(
        `SELECT name, COALESCE(metadata->'references', '[]'::jsonb) AS refs
         FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema'`,
        [deps.snapshotId],
      )).rows as Array<{ name: string; refs: string[] }>;
      const mermaid = erDiagram(tables.map((t) => ({ name: t.name, references: t.refs ?? [] })));
      return mermaid ? [{ kind: 'er', mermaid }] : [];
    },
    outputBudget: { small: 2_500, mid: 3_500, large: 4_500 },
  },

  guardrails_ops: {
    chapter: 'consult',
    mode: 'reference',
    views: ['operations'],
    retrievalTask: () => 'Operational guardrails: budgets, kill switches, privacy modes, secret handling, env configuration — what each protects and where it is enforced.',
    instructions: [
      'Reference for lookup. Write: (1) a 2-3 sentence intro on what the tables cover, then the marker [[backbone]] on its own line (the deterministic env-var and guardrail-code tables are inserted there), then (2) "### What each guardrail protects" — for each guardrail SYMBOL in the backbone evidence, one factual line: what it protects and when it fires, ONLY where the record/receipt evidence shows it; omit symbols you cannot ground. Where the evidence shows an operational risk with no guardrail, state it as a gap.',
      'Env var VALUES are never in the evidence and never in the output — names and documented purposes only.',
    ].join(' '),
    deterministic: async (deps) => {
      const facts = await loadConfigFacts(deps.snapshotId);
      return {
        envFiles: facts.envFiles.map((f) => ({ path: f.path, varNames: f.vars.map((v) => v.name) })),
        externalIntegrations: (await query(
          `SELECT DISTINCT s.target FROM side_effects s
           WHERE s.snapshot_id = $1 AND s.type IN ('external_integration', 'auth_check') AND s.target IS NOT NULL LIMIT 15`,
          [deps.snapshotId],
        )).rows,
        ci: facts.ci,
      };
    },
    backbone: async (deps) => buildGuardrailsBackbone(deps.snapshotId, await loadConfigFacts(deps.snapshotId)),
    outputBudget: { small: 2_500, mid: 3_500, large: 4_500 },
  },
};

/** Shared loader so every section reuses one projection pass. */
export async function buildSectionDeps(snapshotId: string, projectId: string, role: DeveloperRole): Promise<SectionDeps> {
  const snap = (await query(
    `SELECT symbol_count FROM analysis_snapshots WHERE id = $1`,
    [snapshotId],
  )).rows[0] as { symbol_count: number | null } | undefined;
  return {
    snapshotId, projectId, role,
    projections: await loadRoleProjections(snapshotId, projectId, role),
    sizeClass: sizeClassFor(snap?.symbol_count),
  };
}

/** Depth-contract size class from the snapshot's symbol count. */
export function sizeClassFor(symbolCount: number | null | undefined): keyof OutputBudget {
  const n = symbolCount ?? 0;
  if (n < 800) return 'small';
  if (n < 3_000) return 'mid';
  return 'large';
}

export type { ConfigFacts };
