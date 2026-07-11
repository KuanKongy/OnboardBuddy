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
    retrievalTask: (role) => `Repo purpose, main subsystems, and the first files a ${role} developer should read.`,
    instructions: 'Write a focused orientation: what this system does (business purpose first), the main subsystems, and a "read these first" list for the ROLE with WHY each file unlocks understanding. 3-6 paragraphs plus the list. Reference exact paths from the evidence.',
    deterministic: async (deps) => {
      const snap = (await query(
        `SELECT file_count, symbol_count, workflow_count, language_inventory FROM analysis_snapshots WHERE id = $1`,
        [deps.snapshotId],
      )).rows[0];
      const clusters = (await query(
        `SELECT label, kind, critical_score FROM architecture_clusters WHERE snapshot_id = $1 ORDER BY critical_score DESC LIMIT 8`,
        [deps.snapshotId],
      )).rows;
      const entrypoints = (await query(
        `SELECT e.trigger_type, e.method, e.route_path, n.file_path FROM entrypoints e JOIN graph_nodes n ON n.id = e.node_id WHERE e.snapshot_id = $1 LIMIT 15`,
        [deps.snapshotId],
      )).rows;
      return {
        snapshot: snap,
        topClusters: clusters,
        entrypoints,
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
    instructions: 'List the important entry points grouped by trigger type. For each: exact file/symbol, what triggers it, connected workflow, and one sentence on business purpose. Order by criticality for the ROLE.',
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
    instructions: 'Explain the Critical 25% by category (symbols, files, workflows, clusters). Use the ranking REASONS to justify each entry in prose — never dump raw scores. For each: what it does, why it is critical, and what breaks when it is wrong.',
    deterministic: async (deps) => {
      const top = critical25(deps.projections);
      return {
        critical25: Object.fromEntries([...top.entries()].map(([type, targets]) => [type, targets.map(projectionRow)])),
      };
    },
  },

  capability_map: {
    views: ['domain'],
    retrievalTask: () => 'The business capabilities this product provides and where each lives in the code.',
    instructions: 'Describe each business capability: what user value it delivers, which workflows implement it, and which modules own it. This is business context, not code documentation.',
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
    instructions: 'Produce an ordered learning path for the ROLE: 5-10 steps, each naming concrete files/workflows/tutorials with the reason it comes at that position. Use the role projection ordering and capabilities as the backbone.',
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
    instructions: 'One subsection per workflow: trigger, the traced steps in order (file::symbol with the step kind), side effects, and failure handling. Use only traced steps — never invent steps.',
    deterministic: async (deps) => ({
      workflows: (await query(
        `SELECT w.stable_key, w.title, w.trigger_type, w.purpose, w.confidence,
                json_agg(json_build_object('order', ws.step_order, 'file', ws.file_path, 'symbol', ws.symbol_name,
                                           'kind', ws.step_kind, 'description', ws.deterministic_description)
                         ORDER BY ws.step_order) AS steps
         FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
         WHERE w.snapshot_id = $1 GROUP BY w.id LIMIT 8`,
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
         WHERE w.snapshot_id = $1 GROUP BY w.id LIMIT 3`,
        [deps.snapshotId],
      )).rows as Array<{ title: string; steps: Array<{ stepOrder: number; filePath: string; symbolName: string | null; stepKind: string | null; description: string }> }>;
      return workflows.map((w) => ({ kind: 'sequence' as const, mermaid: workflowSequenceDiagram(w.title, w.steps) }));
    },
  },

  data_schema: {
    views: ['operations', 'dependency'],
    retrievalTask: () => 'The data model: source-of-truth objects and who reads or writes them.',
    instructions: 'Document the data layer: schema objects (tables/migrations), which code reads/writes each, and the constraints visible in the evidence. Say plainly when column-level details are not in the evidence.',
    deterministic: async (deps) => ({
      schemaNodes: (await query(
        `SELECT stable_key, name, file_path FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema' LIMIT 25`,
        [deps.snapshotId],
      )).rows,
      dbSideEffects: (await query(
        `SELECT s.type, s.target, n.file_path FROM side_effects s JOIN graph_nodes n ON n.id = s.node_id
         WHERE s.snapshot_id = $1 AND s.type IN ('database_read', 'database_write') LIMIT 20`,
        [deps.snapshotId],
      )).rows,
    }),
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
