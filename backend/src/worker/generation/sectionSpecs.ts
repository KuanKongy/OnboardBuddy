/**
 * Per-section generation specs (doc/Pipeline.md "Generation" table): each
 * section has its own deterministic query, semantic retrieval views, and
 * prompt instructions — sections are generated one at a time, never in
 * one giant call. Diagram-bearing sections get Mermaid derived from
 * deterministic data only.
 */

import { query } from '../../lib/db.js';
import type { ViewType } from '../semantic/embeddingViews.js';
import type { DeveloperRole } from '../semantic/projections.js';
import { loadRoleProjections, critical25, type ProjectedTarget } from './roleProjection.js';
import { architectureDiagram, schemaDiagram, workflowSequenceDiagram, type DiagramSpec } from './diagrams.js';

export const SECTION_TYPES = [
  'start_here', 'architecture', 'entry_points', 'critical_25', 'capability_map',
  'role_path', 'workflow_guide', 'data_schema', 'safety_rails',
  'dependency_graph', 'doc_health',
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

/**
 * Canonical display titles (Design.md package structure). Section titles are
 * standardized — the LLM's title suggestion is ignored so packages always
 * read the same (bug: half the sections showed raw type strings like
 * "role_path", the other half LLM-invented titles).
 */
export const SECTION_TITLES: Record<SectionType, string> = {
  start_here: 'Start Here: Repository Overview',
  architecture: 'Architecture & Boundaries',
  entry_points: 'Entry Points and Why They Matter',
  critical_25: 'Critical 25% Learning Path',
  capability_map: 'Capability Map',
  role_path: 'Your Role-Based Path',
  workflow_guide: 'Workflow Guides',
  data_schema: 'Data Schema & Source of Truth',
  safety_rails: 'Safety Rails & Risky Areas',
  dependency_graph: 'Dependency & Coupling Reference',
  doc_health: 'Documentation Health',
};

export interface SectionDeps {
  snapshotId: string;
  projectId: string;
  role: DeveloperRole;
  /** Loaded once per package generation and shared across sections. */
  projections: ProjectedTarget[];
}

export interface SectionSpec {
  views: ViewType[];
  retrievalTask: (role: DeveloperRole) => string;
  instructions: string;
  deterministic: (deps: SectionDeps) => Promise<Record<string, unknown>>;
  diagrams?: (deps: SectionDeps) => Promise<DiagramSpec[]>;
}

const projectionRow = (t: ProjectedTarget) => ({
  targetType: t.targetType, stableKey: t.stableKey, score: Math.round(t.score * 1000) / 1000, reasons: t.reasons.slice(0, 4),
});

export const SECTION_SPECS: Record<SectionType, SectionSpec> = {
  start_here: {
    views: ['purpose', 'domain'],
    retrievalTask: (role) => `Repo purpose, tech stack, how to run and test it, and the first files a ${role} developer should read.`,
    instructions: [
      'Orient a ROLE developer joining this codebase. Structure exactly as:',
      '(1) "## What this is" — 2-4 sentences: what the system concretely does end to end and the stack, stated from the languageInventory, clusters and entrypoint evidence (name the languages, runtime processes and storage you can see — no marketing framing).',
      '(2) "## Run & verify" — the exact build/run/test commands, but ONLY commands present verbatim in the evidence (README/doc receipts, package.json scripts, compose files listed in runSurface). Cite the receipt for each command. If evidence contains no commands, write exactly: "Run commands are not derivable from the analyzed evidence — check the README." Never invent a command.',
      '(3) "## The lay of the land" — the top clusters with their real file counts and one factual sentence each on what lives there.',
      '(4) "## Read these first" — 5-7 files ORDERED for the ROLE. Each entry: the path plus a concrete, evidence-backed reason (fan-in, workflow participation, what it orchestrates). A reason must say what the file DOES, never that it is "key/important". Do not fill the list with UI pages unless the role is frontend.',
    ].join(' '),
    deterministic: async (deps) => {
      const snap = (await query(
        `SELECT file_count, symbol_count, workflow_count, language_inventory FROM analysis_snapshots WHERE id = $1`,
        [deps.snapshotId],
      )).rows[0];
      // Member counts included so "N files" in prose is a provided number,
      // never model arithmetic (a regeneration invented "approximately 64
      // files" for a 23-file cluster when counts weren't supplied).
      const clusters = (await query(
        `SELECT c.label, c.kind, c.critical_score,
                (SELECT count(*)::int FROM architecture_cluster_members m WHERE m.cluster_id = c.id) AS file_count
         FROM architecture_clusters c WHERE c.snapshot_id = $1 ORDER BY c.critical_score DESC LIMIT 8`,
        [deps.snapshotId],
      )).rows;
      const entrypoints = (await query(
        `SELECT e.trigger_type, e.method, e.route_path, n.file_path FROM entrypoints e JOIN graph_nodes n ON n.id = e.node_id WHERE e.snapshot_id = $1 LIMIT 15`,
        [deps.snapshotId],
      )).rows;
      // Build/run surface: compose files, manifests, READMEs — the files a
      // "Run & verify" section may cite commands from.
      const runSurface = (await query(
        `SELECT file_path, category FROM repository_files
         WHERE snapshot_id = $1 AND (
           file_path ILIKE '%docker-compose%' OR file_path ILIKE '%makefile%'
           OR file_path = 'package.json' OR file_path ILIKE '%/package.json'
           OR file_path ILIKE 'readme%' OR file_path ILIKE '%/readme%'
         )
         ORDER BY length(file_path) LIMIT 12`,
        [deps.snapshotId],
      )).rows;
      return {
        snapshot: snap,
        topClusters: clusters,
        entrypoints,
        runSurface,
        topForRole: deps.projections.filter((p) => p.targetType === 'file' || p.targetType === 'symbol').slice(0, 10).map(projectionRow),
      };
    },
  },

  architecture: {
    views: ['purpose', 'dependency'],
    retrievalTask: () => 'System architecture: layers, boundaries, and how the main modules relate.',
    instructions: 'Explain the architecture from the cluster map: each cluster\'s role, the typed edges between them, and how a request flows across boundaries. The attached Mermaid diagram is authoritative — describe it, do not contradict it.',
    deterministic: async (deps) => ({
      clusters: (await query(
        `SELECT stable_key, label, kind, critical_score, deterministic_summary FROM architecture_clusters WHERE snapshot_id = $1 ORDER BY critical_score DESC`,
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
  },

  entry_points: {
    views: ['purpose'],
    retrievalTask: (role) => `The entry points (routes, jobs, CLI commands) a ${role} developer must understand.`,
    instructions: 'List the important entry points grouped by trigger type. Route paths in the evidence are FULL mounted paths — reproduce them exactly, never abbreviate to sub-router paths. For each: exact file/symbol, what triggers it, connected workflow, and one sentence on purpose ONLY when the purpose is visible in the handler/workflow evidence — otherwise omit the purpose line instead of inventing one. Order by criticality for the ROLE and cover different routers rather than exhaustively listing one file\'s CRUD.',
    deterministic: async (deps) => ({
      entrypoints: (await query(
        `SELECT e.trigger_type, e.method, e.route_path, n.file_path, n.name AS symbol,
                w.title AS workflow_title
         FROM entrypoints e
         JOIN graph_nodes n ON n.id = e.node_id
         LEFT JOIN workflows w ON w.entrypoint_id = e.id
         WHERE e.snapshot_id = $1 ORDER BY e.trigger_type LIMIT 30`,
        [deps.snapshotId],
      )).rows,
    }),
  },

  critical_25: {
    views: ['purpose', 'domain'],
    retrievalTask: (role) => `Why the most critical files and symbols matter to a ${role} developer.`,
    instructions: [
      'Write the Critical 25% as an ORDERED LEARNING PATH, not an inventory.',
      'Open with one sentence of honest coverage using ONLY the provided coverage numbers: "This path covers N of M symbols and X of Y traced workflows — the top ~25% by composite criticality; everything else stays browsable in the Dependencies tab."',
      'Then 5-8 numbered stops in reading order for the ROLE. Each stop = one item from the provided critical25 data: what it does (from evidence), why it ranks here (quote its ranking reasons — fan-in, workflow participation, side effects), and what depends on it. Engineering facts only — no invented product or user consequences.',
      'Close with "## What this path leaves out" — one short paragraph naming the biggest areas NOT in the path (from the cluster evidence) and why deferring them is safe.',
    ].join(' '),
    deterministic: async (deps) => {
      const top = critical25(deps.projections);
      const snap = (await query(
        `SELECT symbol_count, file_count, workflow_count FROM analysis_snapshots WHERE id = $1`,
        [deps.snapshotId],
      )).rows[0] as { symbol_count: number | null; file_count: number | null; workflow_count: number | null } | undefined;
      return {
        critical25: Object.fromEntries([...top.entries()].map(([type, targets]) => [type, targets.map(projectionRow)])),
        coverage: {
          totalSymbols: snap?.symbol_count ?? null,
          totalFiles: snap?.file_count ?? null,
          totalWorkflows: snap?.workflow_count ?? null,
          selectedSymbols: top.get('symbol')?.length ?? 0,
          selectedFiles: top.get('file')?.length ?? 0,
          selectedWorkflows: top.get('workflow')?.length ?? 0,
        },
      };
    },
  },

  capability_map: {
    views: ['domain'],
    retrievalTask: () => 'The business capabilities this product provides and where each lives in the code.',
    instructions: 'Describe each business capability: what user value it delivers, which workflows implement it, and which modules own it. This is business context, not code documentation. If a capability has no userValue in the evidence, omit that line entirely — never print "N/A". Refer to workflows and modules by their human-readable titles; internal keys (wf:…, cluster:…) must never appear in the output.',
    deterministic: async (deps) => ({
      capabilities: (await query(
        `SELECT c.name, c.description, c.confidence, c.metadata->>'userValue' AS user_value,
                json_agg(json_build_object('type', cm.member_type, 'key', cm.stable_key)) AS members
         FROM capabilities c
         LEFT JOIN capability_members cm ON cm.capability_id = c.id
         WHERE c.snapshot_id = $1 GROUP BY c.id`,
        [deps.snapshotId],
      )).rows,
      workflows: (await query(
        `SELECT stable_key, title, purpose FROM workflows WHERE snapshot_id = $1 LIMIT 15`,
        [deps.snapshotId],
      )).rows,
    }),
  },

  role_path: {
    views: ['purpose', 'domain'],
    retrievalTask: (role) => `An ordered learning path for a new ${role} developer: what to study first and why.`,
    instructions: 'Produce an ordered learning path THROUGH THE CODEBASE for a ROLE developer — this is how a developer learns the code, NOT the product\'s end-user page journey. 5-10 steps, each naming concrete files/workflows/tutorials with the reason it comes at that position; span the codebase\'s areas (backend, worker, frontend) per the projections rather than walking the app\'s UI screens. Use the role projection ordering and capabilities as the backbone.',
    deterministic: async (deps) => ({
      roleOrdering: deps.projections.slice(0, 12).map(projectionRow),
      capabilities: (await query(
        `SELECT name, description FROM capabilities WHERE snapshot_id = $1`,
        [deps.snapshotId],
      )).rows,
      tutorials: (await query(
        `SELECT title, summary FROM tutorials WHERE snapshot_id = $1 AND status <> 'failed' LIMIT 10`,
        [deps.snapshotId],
      )).rows,
    }),
  },

  workflow_guide: {
    views: ['purpose', 'operations'],
    retrievalTask: () => 'End-to-end request flows: what each traced workflow does step by step.',
    instructions: 'One subsection per workflow: trigger, the traced steps in order (file::symbol with the step kind), side effects, and failure handling. Use only traced steps — never invent steps. Describe failure handling only from visible evidence (status codes, catch blocks in snippets); if none is visible, write "failure handling not visible in the trace". When a step WRITES data, say so explicitly — do not soften writes into reads.',
    deterministic: async (deps) => ({
      workflows: (await query(
        `SELECT w.stable_key, w.title, w.trigger_type, w.purpose, w.confidence,
                json_agg(json_build_object('order', ws.step_order, 'file', ws.file_path, 'symbol', ws.symbol_name,
                                           'kind', ws.step_kind, 'description', ws.deterministic_description)
                         ORDER BY ws.step_order) AS steps
         FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
         WHERE w.snapshot_id = $1 GROUP BY w.id
         ORDER BY COALESCE((SELECT max(cs.score) FROM criticality_scores cs
                            WHERE cs.snapshot_id = w.snapshot_id AND cs.target_type = 'workflow'
                              AND cs.stable_key = w.stable_key), 0) DESC
         LIMIT 8`,
        [deps.snapshotId],
      )).rows,
    }),
    diagrams: async (deps) => {
      const workflows = (await query(
        `SELECT w.title, json_agg(json_build_object('stepOrder', ws.step_order, 'filePath', ws.file_path,
                                                    'symbolName', ws.symbol_name, 'stepKind', ws.step_kind,
                                                    'description', ws.deterministic_description)
                                  ORDER BY ws.step_order) AS steps
         FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
         WHERE w.snapshot_id = $1 GROUP BY w.id
         ORDER BY COALESCE((SELECT max(cs.score) FROM criticality_scores cs
                            WHERE cs.snapshot_id = w.snapshot_id AND cs.target_type = 'workflow'
                              AND cs.stable_key = w.stable_key), 0) DESC
         LIMIT 3`,
        [deps.snapshotId],
      )).rows as Array<{ title: string; steps: Array<{ stepOrder: number; filePath: string; symbolName: string | null; stepKind: string | null; description: string }> }>;
      return workflows.map((w) => ({ kind: 'sequence' as const, mermaid: workflowSequenceDiagram(w.title, w.steps) }));
    },
  },

  data_schema: {
    views: ['operations', 'dependency'],
    retrievalTask: () => 'The data model: source-of-truth objects and who reads or writes them.',
    instructions: [
      'Document the data layer from the provided inventory.',
      'The total table count you state MUST be the provided schemaTableCount verbatim — never count the list yourself (it may be truncated; schemaNodesTruncated says so).',
      'Name the migration/schema file(s) as the source of truth once — do not repeat the same file path per table.',
      'Group tables into 3-6 domains by name and describe each group in one sentence.',
      'For the most-accessed tables, say which code writes them (dbSideEffects evidence).',
      'Say plainly when column-level details are not in the evidence.',
    ].join(' '),
    deterministic: async (deps) => {
      const schemaNodes = (await query(
        `SELECT stable_key, name, file_path FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema' ORDER BY name LIMIT 60`,
        [deps.snapshotId],
      )).rows;
      const schemaTableCount = Number(
        ((await query(
          `SELECT count(*)::int AS n FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema'`,
          [deps.snapshotId],
        )).rows[0] as { n: number }).n,
      );
      return {
        // The old query fed the model a silently LIMIT-truncated list; it
        // "counted" 25 tables in a 37-table schema and shipped the number.
        schemaTableCount,
        schemaNodesTruncated: schemaNodes.length < schemaTableCount,
        schemaNodes,
        dbSideEffects: (await query(
          `SELECT s.type, s.target, n.file_path FROM side_effects s JOIN graph_nodes n ON n.id = s.node_id
           WHERE s.snapshot_id = $1 AND s.type IN ('database_read', 'database_write') LIMIT 20`,
          [deps.snapshotId],
        )).rows,
      };
    },
    diagrams: async (deps) => {
      const tables = (await query(
        `SELECT name FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema' LIMIT 20`,
        [deps.snapshotId],
      )).rows as Array<{ name: string }>;
      const accesses = (await query(
        `SELECT tn.name AS table, sn.stable_key AS accessor, e.type AS mode
         FROM graph_edges e
         JOIN graph_nodes sn ON sn.id = e.source_node_id
         JOIN graph_nodes tn ON tn.id = e.target_node_id
         WHERE e.snapshot_id = $1 AND tn.type = 'schema' LIMIT 30`,
        [deps.snapshotId],
      )).rows as Array<{ table: string; accessor: string; mode: string }>;
      if (tables.length === 0) return [];
      return [{ kind: 'schema' as const, mermaid: schemaDiagram(tables, accesses) }];
    },
  },

  safety_rails: {
    views: ['operations'],
    retrievalTask: () => 'Risky areas: what requires extra caution, what tests to trust, dangerous side effects.',
    instructions: 'Identify dangerous areas grounded in the evidence: modules with risky side effects, invariants from the records, shared modules with wide blast radius, and the tests/config that guard them. For each: the concrete RISK.',
    deterministic: async (deps) => ({
      riskySideEffects: (await query(
        `SELECT s.type, s.target, n.file_path FROM side_effects s JOIN graph_nodes n ON n.id = s.node_id
         WHERE s.snapshot_id = $1 ORDER BY s.type LIMIT 20`,
        [deps.snapshotId],
      )).rows,
      testFiles: (await query(
        `SELECT stable_key FROM repository_files WHERE snapshot_id = $1 AND category = 'test' LIMIT 15`,
        [deps.snapshotId],
      )).rows,
      configFiles: (await query(
        `SELECT stable_key, category FROM repository_files WHERE snapshot_id = $1 AND category IN ('config', 'migration') LIMIT 15`,
        [deps.snapshotId],
      )).rows,
    }),
  },

  dependency_graph: {
    views: ['dependency'],
    retrievalTask: () => 'The dependency structure: central modules, coupling points, import patterns.',
    instructions: 'Explain the dependency structure: the highest fan-in modules and why they matter, key dependency chains, and coupling risks. Mostly deterministic facts — keep interpretation tight.',
    deterministic: async (deps) => ({
      centralNodes: (await query(
        `SELECT stable_key, name, (metadata->>'dependentCount')::int AS dependents
         FROM graph_nodes WHERE snapshot_id = $1 AND (metadata->>'dependentCount')::int > 0
         ORDER BY 3 DESC LIMIT 15`,
        [deps.snapshotId],
      )).rows,
      edgeCounts: (await query(
        `SELECT type, count(*)::int AS n FROM graph_edges WHERE snapshot_id = $1 GROUP BY type ORDER BY n DESC`,
        [deps.snapshotId],
      )).rows,
    }),
  },

  doc_health: {
    views: ['purpose'],
    retrievalTask: () => 'Documentation health: what is documented, what conflicts, what is missing.',
    instructions: 'Assess documentation health from the deterministic facts: doc files present, records flagged docs_conflict_with_code or rejected, and undocumented critical areas. Constructive priorities, not blame.',
    deterministic: async (deps) => ({
      docFiles: (await query(
        `SELECT stable_key FROM repository_files WHERE snapshot_id = $1 AND category = 'doc' LIMIT 15`,
        [deps.snapshotId],
      )).rows,
      flaggedRecords: (await query(
        `SELECT ssr.stable_key, sr.flags FROM semantic_records sr
         JOIN snapshot_semantic_records ssr ON ssr.record_id = sr.id
         WHERE ssr.snapshot_id = $1 AND (sr.status = 'rejected' OR jsonb_array_length(sr.flags) > 0) LIMIT 20`,
        [deps.snapshotId],
      )).rows,
      topUndocumented: deps.projections.slice(0, 8).map(projectionRow),
    }),
  },
};

/** Shared loader so every section reuses one projection pass. */
export async function buildSectionDeps(snapshotId: string, projectId: string, role: DeveloperRole): Promise<SectionDeps> {
  return { snapshotId, projectId, role, projections: await loadRoleProjections(snapshotId, projectId, role) };
}
