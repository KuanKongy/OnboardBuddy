import type { EvidenceGraph, EvidenceNode, RepoInventory } from '../types/analysis.js';
import type { CandidateRanking } from './candidateRanker.js';
import type { ExtractedWorkflow } from './workflowExtractor.js';
import { query } from '../../lib/db.js';

/**
 * Deterministic architecture clustering (doc/Pipeline.md "Architecture
 * clustering"): path-based grouping + framework-based kind assignment,
 * node edges collapsed into weighted cluster edges, member candidate scores
 * aggregated, deterministic summaries from member facts. No LLM anywhere —
 * the LLM later labels/explains clusters, it never invents them.
 */

export type ClusterKind =
  | 'frontend_ui' | 'frontend_state' | 'api_layer' | 'auth_layer'
  | 'database_layer' | 'worker_layer' | 'analysis_engine'
  | 'integration_layer' | 'devops_layer' | 'test_layer' | 'shared_module' | 'other';

export type ClusterEdgeType =
  | 'imports' | 'calls' | 'sends_request' | 'enqueues_job'
  | 'reads_writes_data' | 'uses_config' | 'tests';

export interface ArchitectureCluster {
  stableKey: string;
  label: string;
  kind: ClusterKind;
  criticalScore: number;
  deterministicSummary: string;
  members: Array<{ nodeStableKey: string; reason: string }>;
  metadata: Record<string, unknown>;
}

export interface ArchitectureClusterEdge {
  sourceClusterKey: string;
  targetClusterKey: string;
  type: ClusterEdgeType;
  weight: number;
  /** Sample underlying graph edges (resolved to ids at persist time). */
  evidence: Array<{ sourceKey: string; targetKey: string; type: string }>;
  /** Workflows whose traces cross this cluster boundary. */
  workflowCrossings: string[];
}

export interface ArchitectureMap {
  clusters: ArchitectureCluster[];
  edges: ArchitectureClusterEdge[];
}

// Path rules, first match wins. `category` names the cluster within a top
// scope; `kind` is the schema enum.
const PATH_RULES: Array<{ pattern: RegExp; category: string; kind: ClusterKind }> = [
  { pattern: /(^|\/)(__tests__|tests?|e2e|cypress)(\/|$)|\.(test|spec)\.[jt]sx?$/i, category: 'Tests', kind: 'test_layer' },
  { pattern: /(^|\/)(migrations?|db|database|models?|schema|prisma|repositories)(\/|$)/i, category: 'Database', kind: 'database_layer' },
  { pattern: /(^|\/)(routes?|controllers?|api|middleware)(\/|$)/i, category: 'API Routes', kind: 'api_layer' },
  { pattern: /(^|\/)auth(\/|$)|auth[A-Z]/, category: 'Auth', kind: 'auth_layer' },
  { pattern: /(^|\/)(workers?|jobs?|queues?)(\/|$)/i, category: 'Workers', kind: 'worker_layer' },
  { pattern: /(^|\/)(engine|analysis|analyzer|parser)(\/|$)/i, category: 'Analysis Engine', kind: 'analysis_engine' },
  { pattern: /(^|\/)(pages?|views?|components?|layouts?|screens?)(\/|$)/i, category: 'UI', kind: 'frontend_ui' },
  { pattern: /(^|\/)(hooks?|store|state|contexts?|redux|slices?)(\/|$)/i, category: 'State', kind: 'frontend_state' },
  { pattern: /(^|\/)(integrations?|clients?|github|external)(\/|$)/i, category: 'Integrations', kind: 'integration_layer' },
  { pattern: /(^|\/)(utils?|lib|shared|common|helpers?|types?)(\/|$)/i, category: 'Shared Utilities', kind: 'shared_module' },
  { pattern: /(^|\/)(services?)(\/|$)/i, category: 'Services', kind: 'shared_module' },
  { pattern: /(^|\/)(config|settings|deploy|infra|scripts?|\.github)(\/|$)/i, category: 'Configuration & Deployment', kind: 'devops_layer' },
];

export interface ClusterArchitectureInput {
  graph: EvidenceGraph;
  inventory: RepoInventory;
  workflows: ExtractedWorkflow[];
  rankings: CandidateRanking[];
}

export function clusterArchitecture(input: ClusterArchitectureInput): ArchitectureMap {
  const scoreByKey = new Map(input.rankings.map((r) => [r.stableKey, r.score]));
  const frameworks = new Set(input.inventory.detectedFrameworks.map((f) => f.toLowerCase()));

  // Monorepos (workspace packages like frontend/, backend/) scope clusters
  // per package root; single-package repos get unscoped clusters.
  const fileNodes = input.graph.nodes.filter((n) => n.type === 'module' || n.type === 'file');
  const packageRoots = input.inventory.packages.map((p) => p.root).filter((r) => r !== '');
  const scopeOf = (path: string): string =>
    packageRoots.find((r) => path.startsWith(`${r}/`)) ?? '';

  interface Bucket {
    label: string;
    kind: ClusterKind;
    members: Array<{ node: EvidenceNode; reason: string }>;
  }
  const buckets = new Map<string, Bucket>();

  const put = (clusterKey: string, label: string, kind: ClusterKind, node: EvidenceNode, reason: string) => {
    const bucket = buckets.get(clusterKey) ?? { label, kind, members: [] };
    bucket.members.push({ node, reason });
    buckets.set(clusterKey, bucket);
  };

  // ── 1. Path-based grouping of file nodes ───────────────────────────────────
  const clusterKeyByFile = new Map<string, string>();
  for (const node of fileNodes) {
    const path = node.stableKey;
    const scope = scopeOf(path);
    const rule = PATH_RULES.find((r) => r.pattern.test(path));
    const category = rule?.category ?? 'Modules';
    const kind = rule?.kind ?? fallbackKind(frameworks);
    const clusterKey = `cluster:${scope ? `${scope}/` : ''}${slugOf(category)}`;
    const label = scope ? `${humanize(scope.split('/').pop()!)} · ${category}` : category;
    put(clusterKey, label, kind, node,
      rule ? `Path matches ${rule.pattern.source.slice(0, 60)}` : `Grouped under ${scope || 'repository root'}`);
    clusterKeyByFile.set(path, clusterKey);
  }

  // ── 2. Config + schema evidence nodes join devops/database clusters ───────
  for (const node of input.graph.nodes) {
    if (node.type === 'config') {
      put('cluster:configuration-deployment', 'Configuration & Deployment', 'devops_layer', node, 'Config evidence file');
      clusterKeyByFile.set(node.stableKey, 'cluster:configuration-deployment');
    } else if (node.type === 'schema') {
      put('cluster:database-schema', 'Database Schema', 'database_layer', node, 'Schema (table) definition');
      clusterKeyByFile.set(node.stableKey, 'cluster:database-schema');
    }
  }

  // ── 3. Collapse node edges into weighted cluster edges ────────────────────
  // Symbols resolve to their file's cluster via filePath.
  const nodeByKey = new Map(input.graph.nodes.map((n) => [n.stableKey, n]));
  const clusterOfKey = (key: string): string | undefined => {
    const direct = clusterKeyByFile.get(key);
    if (direct) return direct;
    const node = nodeByKey.get(key);
    return node?.filePath ? clusterKeyByFile.get(node.filePath) : undefined;
  };

  const EDGE_TYPE_MAP: Record<string, ClusterEdgeType | undefined> = {
    imports: 'imports',
    calls: 'calls',
    http_calls: 'sends_request',
    enqueues_job: 'enqueues_job',
    handles_job: 'enqueues_job',
    touches_schema: 'reads_writes_data',
    queries_database: 'reads_writes_data',
    writes_database: 'reads_writes_data',
    reads_env: 'uses_config',
    tests: 'tests',
  };

  const aggregated = new Map<string, ArchitectureClusterEdge>();
  for (const e of input.graph.edges) {
    const mapped = EDGE_TYPE_MAP[e.type];
    if (!mapped) continue;
    const source = clusterOfKey(e.sourceKey);
    const target = clusterOfKey(e.targetKey);
    if (!source || !target || source === target) continue;

    const aggKey = `${source}->${target}:${mapped}`;
    const agg = aggregated.get(aggKey) ?? {
      sourceClusterKey: source,
      targetClusterKey: target,
      type: mapped,
      weight: 0,
      evidence: [],
      workflowCrossings: [],
    };
    agg.weight++;
    if (agg.evidence.length < 20) {
      agg.evidence.push({ sourceKey: e.sourceKey, targetKey: e.targetKey, type: e.type });
    }
    aggregated.set(aggKey, agg);
  }

  // ── 4. Attach workflow crossings ───────────────────────────────────────────
  for (const wf of input.workflows) {
    for (let i = 1; i < wf.steps.length; i++) {
      const from = clusterOfKey(wf.steps[i - 1]!.nodeStableKey);
      const to = clusterOfKey(wf.steps[i]!.nodeStableKey);
      if (!from || !to || from === to) continue;
      for (const agg of aggregated.values()) {
        if (agg.sourceClusterKey === from && agg.targetClusterKey === to &&
            !agg.workflowCrossings.includes(wf.stableKey)) {
          agg.workflowCrossings.push(wf.stableKey);
        }
      }
    }
  }

  // ── 5. Score + summarize clusters from member facts ───────────────────────
  const clusters: ArchitectureCluster[] = [];
  for (const [stableKey, bucket] of buckets) {
    const fileMembers = bucket.members.filter((m) => m.node.type === 'module' || m.node.type === 'file');
    const scores = bucket.members
      .map((m) => scoreByKey.get(m.node.stableKey))
      .filter((s): s is number => s != null);
    const criticalScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100000) / 100000
      : 0;

    clusters.push({
      stableKey,
      label: bucket.label,
      kind: bucket.kind,
      criticalScore,
      deterministicSummary: summarize(bucket, input.graph),
      members: bucket.members.map((m) => ({ nodeStableKey: m.node.stableKey, reason: m.reason })),
      metadata: {
        fileCount: fileMembers.length,
        memberCount: bucket.members.length,
      },
    });
  }

  return {
    clusters: clusters.sort((a, b) => b.criticalScore - a.criticalScore),
    edges: [...aggregated.values()].sort((a, b) => b.weight - a.weight),
  };
}

function fallbackKind(frameworks: Set<string>): ClusterKind {
  if (frameworks.has('react') || frameworks.has('vue') || frameworks.has('svelte')) return 'frontend_ui';
  if (frameworks.has('express') || frameworks.has('fastify') || frameworks.has('koa')) return 'api_layer';
  return 'other';
}

function summarize(bucket: { label: string; members: Array<{ node: EvidenceNode }> }, graph: EvidenceGraph): string {
  const memberKeys = new Set(bucket.members.map((m) => m.node.stableKey));
  const files = bucket.members.filter((m) => m.node.type === 'module' || m.node.type === 'file');
  const symbolCount = graph.nodes.filter(
    (n) => n.filePath != null && memberKeys.has(n.filePath) &&
      n.type !== 'module' && n.type !== 'file',
  ).length;

  const parts = [`${files.length} file${files.length === 1 ? '' : 's'}`];
  if (symbolCount > 0) parts.push(`${symbolCount} symbols`);

  const tables = new Set<string>();
  for (const e of graph.edges) {
    if (e.type === 'touches_schema' && (memberKeys.has(e.sourceKey) || memberKeys.has(nodeFile(graph, e.sourceKey) ?? ''))) {
      const table = typeof e.metadata.table === 'string' ? e.metadata.table : null;
      if (table) tables.add(table);
    }
  }
  if (tables.size > 0) parts.push(`touches table${tables.size > 1 ? 's' : ''} ${[...tables].slice(0, 5).join(', ')}`);

  return `${bucket.label}: ${parts.join(', ')}.`;
}

function nodeFile(graph: EvidenceGraph, key: string): string | null {
  // touches_schema sources are symbols; membership is tracked per file.
  const hash = key.indexOf('#');
  return hash > 0 ? key.slice(0, hash) : null;
}

function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function humanize(dir: string): string {
  return dir.charAt(0).toUpperCase() + dir.slice(1);
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export async function persistArchitecture(
  snapshotId: string,
  map: ArchitectureMap,
  nodeIdMap: Map<string, string>,
): Promise<void> {
  const clusterIdByKey = new Map<string, string>();

  for (const cluster of map.clusters) {
    const result = await query(
      `INSERT INTO architecture_clusters
         (snapshot_id, stable_key, label, kind, critical_score, deterministic_summary, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (snapshot_id, stable_key) DO UPDATE
         SET label = EXCLUDED.label, kind = EXCLUDED.kind,
             critical_score = EXCLUDED.critical_score,
             deterministic_summary = EXCLUDED.deterministic_summary,
             metadata = EXCLUDED.metadata
       RETURNING id`,
      [snapshotId, cluster.stableKey, cluster.label, cluster.kind,
       cluster.criticalScore, cluster.deterministicSummary, JSON.stringify(cluster.metadata)],
    );
    const clusterId = result.rows[0]?.id as string | undefined;
    if (!clusterId) continue;
    clusterIdByKey.set(cluster.stableKey, clusterId);

    const memberRows = cluster.members
      .map((m) => ({ nodeId: nodeIdMap.get(m.nodeStableKey), reason: m.reason }))
      .filter((m): m is { nodeId: string; reason: string } => m.nodeId != null);
    if (memberRows.length > 0) {
      await query(
        `INSERT INTO architecture_cluster_members (cluster_id, node_id, membership_reason)
         SELECT $1, unnest($2::uuid[]), unnest($3::text[])
         ON CONFLICT DO NOTHING`,
        [clusterId, memberRows.map((m) => m.nodeId), memberRows.map((m) => m.reason)],
      );
    }
  }

  for (const edge of map.edges) {
    const sourceClusterId = clusterIdByKey.get(edge.sourceClusterKey);
    const targetClusterId = clusterIdByKey.get(edge.targetClusterKey);
    if (!sourceClusterId || !targetClusterId) continue;

    // Resolve sample underlying edges to graph_edges ids for receipts.
    const sourceIds = edge.evidence.map((s) => nodeIdMap.get(s.sourceKey)).filter((x): x is string => x != null);
    const targetIds = edge.evidence.map((s) => nodeIdMap.get(s.targetKey)).filter((x): x is string => x != null);
    let evidenceIds: string[] = [];
    if (sourceIds.length > 0 && targetIds.length > 0) {
      const evidenceResult = await query(
        `SELECT id FROM graph_edges
         WHERE snapshot_id = $1 AND source_node_id = ANY($2::uuid[]) AND target_node_id = ANY($3::uuid[])
         LIMIT 20`,
        [snapshotId, sourceIds, targetIds],
      );
      evidenceIds = evidenceResult.rows.map((r) => r.id as string);
    }

    await query(
      `INSERT INTO architecture_edges
         (snapshot_id, source_cluster_id, target_cluster_id, type, weight, evidence_edge_ids, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [snapshotId, sourceClusterId, targetClusterId, edge.type, edge.weight,
       evidenceIds, JSON.stringify({ workflowCrossings: edge.workflowCrossings })],
    );
  }
}
