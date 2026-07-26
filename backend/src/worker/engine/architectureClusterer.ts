import { builtinModules } from 'node:module';
import type { PoolClient } from 'pg';
import type { EvidenceGraph, EvidenceNode, RepoInventory } from '../types/analysis.js';
import type { CandidateRanking } from './candidateRanker.js';
import type { ExtractedWorkflow } from './workflowExtractor.js';
import { frameworksOfPackage } from './repoIngester.js';
import { pool, query } from '../../lib/db.js';

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
  // Per-package, not the repo-wide union: in a monorepo the union reports
  // React to the backend and Express to the frontend. The union survives only
  // as the last-resort default for files under no package at all.
  const frameworksByScope = new Map<string, Set<string>>(
    input.inventory.packages.map((p) => [p.root, frameworksOfPackage(p)]),
  );
  const repoFrameworks = new Set(input.inventory.detectedFrameworks.map((f) => f.toLowerCase()));

  // Monorepos (workspace packages like frontend/, backend/) scope clusters
  // per package root; single-package repos get unscoped clusters.
  const fileNodes = input.graph.nodes.filter((n) => n.type === 'module' || n.type === 'file');
  const packageRoots = input.inventory.packages.map((p) => p.root).filter((r) => r !== '');
  const scopeOf = (path: string): string =>
    packageRoots.find((r) => path.startsWith(`${r}/`)) ?? '';

  interface Bucket {
    label: string;
    /** null until step 4b infers it from the bucket's own members. */
    kind: ClusterKind | null;
    scope: string;
    members: Array<{ node: EvidenceNode; reason: string }>;
  }
  const buckets = new Map<string, Bucket>();

  const put = (
    clusterKey: string,
    label: string,
    kind: ClusterKind | null,
    scope: string,
    node: EvidenceNode,
    reason: string,
  ) => {
    const bucket = buckets.get(clusterKey) ?? { label, kind, scope, members: [] };
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
    const clusterKey = `cluster:${scope ? `${scope}/` : ''}${slugOf(category)}`;
    const label = scope ? `${humanize(scope.split('/').pop()!)} · ${category}` : category;
    // A rule match names the kind outright; anything else waits for its
    // members to be known rather than being typed from a repo-wide guess.
    put(clusterKey, label, rule?.kind ?? null, scope, node,
      rule ? `Path matches ${rule.pattern.source.slice(0, 60)}` : `Grouped under ${scope || 'repository root'}`);
    clusterKeyByFile.set(path, clusterKey);
  }

  // ── 2. Config + schema evidence nodes join devops/database clusters ───────
  for (const node of input.graph.nodes) {
    if (node.type === 'config') {
      put('cluster:configuration-deployment', 'Configuration & Deployment', 'devops_layer', '', node, 'Config evidence file');
      clusterKeyByFile.set(node.stableKey, 'cluster:configuration-deployment');
    } else if (node.type === 'schema') {
      put('cluster:database-schema', 'Database Schema', 'database_layer', '', node, 'Schema (table) definition');
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

  // ── 5. Resolve kinds, score, and explain each cluster from member facts ───
  const importsByFile = externalImportsByFile(input.graph);
  const bucketLabels = new Map([...buckets].map(([key, b]) => [key, b.label]));
  const workflowTitle = new Map(input.workflows.map((w) => [w.stableKey, w.title]));
  // Boundary links, resolved to labels and human flow names once for every
  // cluster rather than per cluster — the same shape `loadClusterNarratives`
  // reads out of SQL, so the analysis-time and request-time narratives are
  // produced by the same function from the same facts.
  const inboundLinks = new Map<string, ClusterBoundaryLink[]>();
  const outboundLinks = new Map<string, ClusterBoundaryLink[]>();
  for (const edge of aggregated.values()) {
    const sourceLabel = bucketLabels.get(edge.sourceClusterKey);
    const targetLabel = bucketLabels.get(edge.targetClusterKey);
    if (!sourceLabel || !targetLabel) continue;
    const carries = edge.workflowCrossings
      .map((key) => workflowTitle.get(key))
      .filter((t): t is string => !!t);
    (outboundLinks.get(edge.sourceClusterKey) ?? outboundLinks.set(edge.sourceClusterKey, []).get(edge.sourceClusterKey)!)
      .push({ other: targetLabel, type: edge.type, carries });
    (inboundLinks.get(edge.targetClusterKey) ?? inboundLinks.set(edge.targetClusterKey, []).get(edge.targetClusterKey)!)
      .push({ other: sourceLabel, type: edge.type, carries });
  }
  // A package only one cluster imports is the fact that explains why that
  // cluster is a separate box; a package half the repo imports explains nothing.
  const clustersByExternal = new Map<string, Set<string>>();
  for (const [filePath, specs] of importsByFile) {
    const clusterKey = clusterKeyByFile.get(filePath);
    if (!clusterKey) continue;
    for (const spec of specs) {
      if (!isThirdParty(spec)) continue;
      (clustersByExternal.get(spec) ?? clustersByExternal.set(spec, new Set()).get(spec)!).add(clusterKey);
    }
  }
  const exclusiveExternals = new Map<string, string[]>();
  for (const [spec, owners] of clustersByExternal) {
    if (owners.size !== 1) continue;
    const key = [...owners][0]!;
    (exclusiveExternals.get(key) ?? exclusiveExternals.set(key, []).get(key)!).push(spec);
  }

  const clusters: ArchitectureCluster[] = [];
  for (const [stableKey, bucket] of buckets) {
    const fileMembers = bucket.members.filter((m) => m.node.type === 'module' || m.node.type === 'file');
    const scores = bucket.members
      .map((m) => scoreByKey.get(m.node.stableKey))
      .filter((s): s is number => s != null);
    const criticalScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100000) / 100000
      : 0;

    const kind =
      bucket.kind ??
      inferClusterKind(
        bucket.members.map((m) => m.node),
        frameworksByScope.get(bucket.scope) ?? repoFrameworks,
        importsByFile,
      );

    // Counted by node type, because a "Database Schema" cluster holds table
    // nodes and a "Configuration" cluster holds config nodes — neither has any
    // file members, which is why both used to render as "0 files" over dozens
    // of real members.
    const byType: Record<string, number> = {};
    for (const m of bucket.members) byType[m.node.type] = (byType[m.node.type] ?? 0) + 1;

    const memberKeys = new Set(bucket.members.map((m) => m.node.stableKey));
    const tables = new Set<string>();
    for (const e of input.graph.edges) {
      if (e.type !== 'touches_schema') continue;
      if (!memberKeys.has(e.sourceKey) && !memberKeys.has(nodeFile(input.graph, e.sourceKey) ?? '')) continue;
      if (typeof e.metadata.table === 'string') tables.add(e.metadata.table);
    }

    const narrative = buildClusterNarrative({
      label: bucket.label,
      kind,
      commonPath: commonDirectory(fileMembers.map((m) => m.node.stableKey)),
      tables: [...tables],
      exclusiveExternals: exclusiveExternals.get(stableKey) ?? [],
      inbound: inboundLinks.get(stableKey) ?? [],
      outbound: outboundLinks.get(stableKey) ?? [],
    });

    clusters.push({
      stableKey,
      label: bucket.label,
      kind,
      criticalScore,
      deterministicSummary: narrative.summary,
      members: bucket.members.map((m) => ({ nodeStableKey: m.node.stableKey, reason: m.reason })),
      metadata: {
        // The single definition of a cluster's file count. Everything that
        // shows a count to a user or a model reads THIS, not a row count over
        // architecture_cluster_members (which includes symbols and configs).
        // Counts live HERE and are rendered as a chip; they are deliberately
        // absent from `deterministicSummary`, which has to explain instead.
        fileCount: fileMembers.length,
        memberCount: bucket.members.length,
        memberCountsByType: byType,
        /** Noun the UI should use — "files" is wrong for schema/config clusters. */
        primaryMemberNoun: primaryMemberNoun(byType, fileMembers.length),
        narrative,
      },
    });
  }

  return {
    clusters: clusters.sort((a, b) => b.criticalScore - a.criticalScore),
    edges: [...aggregated.values()].sort((a, b) => b.weight - a.weight),
  };
}

/**
 * A real third-party dependency, as opposed to a relative path or a Node
 * builtin. `fs`, `path` and `crypto` are importable without the `node:` prefix,
 * and reporting "the only component that pulls in fs" says nothing about
 * architecture — every server component reads files.
 */
function isThirdParty(specifier: string): boolean {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return false;
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return !builtinModules.includes(bare) && !specifier.startsWith('node:');
}

/** Bare package name for an import specifier: '@scope/pkg/sub' -> '@scope/pkg'. */
function packageOfSpecifier(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/**
 * External packages each file imports, keyed by file path. Built from the
 * edges that land on `external` boundary nodes, which is the only record of a
 * third-party dependency at file granularity.
 *
 * `references_external` is the type the graph builder actually emits for a
 * third-party import (`evidenceGraphBuilder.ts:201`); `imports` is reserved for
 * edges that resolved to a file inside the scope. Matching only `imports` here
 * meant this map was ALWAYS EMPTY on a real repository — verified against the
 * live FloowForge snapshot, which has 131 external references and returned
 * nothing. Everything downstream that reads it therefore never fired: the
 * documented "what these files actually import beats what the manifest
 * declares" tier of `inferClusterKind` silently fell through to the scope's
 * package.json on every repo. The unit fixture used `imports`, so the test was
 * green while the feature was dead. Both types are accepted so the fixture and
 * the pipeline agree.
 */
function externalImportsByFile(graph: EvidenceGraph): Map<string, Set<string>> {
  const nodeByKey = new Map(graph.nodes.map((n) => [n.stableKey, n]));
  const byFile = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.type !== 'imports' && edge.type !== 'references_external') continue;
    const target = nodeByKey.get(edge.targetKey);
    if (!target || target.type !== 'external') continue;
    const raw = typeof target.metadata.specifier === 'string' ? target.metadata.specifier : target.name;
    const set = byFile.get(edge.sourceKey) ?? new Set<string>();
    set.add(packageOfSpecifier(raw));
    byFile.set(edge.sourceKey, set);
  }
  return byFile;
}

/**
 * Kind for a bucket the path rules did not name, inferred from that bucket's
 * OWN members.
 *
 * This replaces `fallbackKind(frameworks)`, which read the repo-wide framework
 * set — the union of every package.json in the repo. A single React dependency
 * anywhere therefore typed EVERY unnamed bucket `frontend_ui`: in the audit
 * that was 19 of 21 `* Modules` clusters, including `Backend · Modules` and
 * `Server · Modules`, both of which are server code.
 *
 * Evidence is used strongest-first: a JSX file renders UI whatever the
 * manifest claims, what these files actually import beats what the package
 * declares, and only then does the scope's own package.json get a say.
 */
function inferClusterKind(
  members: EvidenceNode[],
  scopeFrameworks: Set<string>,
  importsByFile: Map<string, Set<string>>,
): ClusterKind {
  const files = members.filter((n) => n.type === 'module' || n.type === 'file');
  if (files.length === 0) return 'other';

  const jsxFiles = files.filter((n) => /\.[jt]sx$/i.test(n.stableKey)).length;
  if (jsxFiles / files.length >= 0.4) return 'frontend_ui';

  const imported = new Set<string>();
  for (const f of files) for (const spec of importsByFile.get(f.stableKey) ?? []) imported.add(spec);
  const imports = (...names: string[]): boolean => names.some((n) => imported.has(n));

  if (imports('express', 'fastify', 'koa', '@nestjs/core')) return 'api_layer';
  if (imports('bullmq', 'bull', 'agenda')) return 'worker_layer';
  if (imports('pg', 'prisma', '@prisma/client', 'mongoose', 'knex', 'drizzle-orm', 'typeorm')) return 'database_layer';
  if (imports('react', 'react-dom', 'vue', 'svelte')) return 'frontend_ui';

  const scoped = (...names: string[]): boolean => names.some((n) => scopeFrameworks.has(n));
  if (scoped('react', 'vue', 'svelte', 'nextjs')) return 'frontend_ui';
  if (scoped('express', 'fastify', 'koa', 'nestjs')) return 'api_layer';
  if (scoped('bullmq', 'bull')) return 'worker_layer';
  // Honest 'other' beats a confident wrong label.
  return 'other';
}

/**
 * The noun that honestly describes what a cluster contains, chosen by which
 * member type actually dominates.
 *
 * Two failures this avoids. A cluster built purely from schema evidence has no
 * file members, so counting "files" reported 0 over 48 tables. And
 * `Configuration & Deployment` holds one module beside twenty-two config
 * nodes — "1 file" is technically true and describes almost none of it.
 */
function primaryMemberNoun(byType: Record<string, number>, fileCount: number): 'file' | 'table' | 'config file' {
  const candidates: Array<[('file' | 'table' | 'config file'), number]> = [
    ['file', fileCount],
    ['table', byType.schema ?? 0],
    ['config file', byType.config ?? 0],
  ];
  // Ties go to the earlier entry, which keeps a plain code cluster reading as
  // "files" rather than flipping nouns on an incidental config node.
  return candidates.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

function nodeFile(graph: EvidenceGraph, key: string): string | null {
  // touches_schema sources are symbols; membership is tracked per file.
  const hash = key.indexOf('#');
  return hash > 0 ? key.slice(0, hash) : null;
}

// ─── Cluster narrative ───────────────────────────────────────────────────────

/**
 * WHY a component exists, rather than what it contains.
 *
 * The summary this replaces was `"<label>: 9 files, 40 symbols"` — printed
 * under a heading that already said the label, beside a chip that already said
 * the count. That is an inventory, and a reader who wants to know what "Auth
 * services" is responsible for learns nothing from it. Measured examples of the
 * same failure reaching generated prose: `"State — Responsibility: Manages
 * frontend application state. File Count: 2 files."` (the label reworded, with
 * the count offered as the explanation) and `"API Routes — Responsibility:
 * Handles API requests"` (a tautology).
 *
 * Three sentences, each answering a question a count cannot:
 *   responsibility — what this part of the system is FOR, in the repo's own nouns
 *   boundary       — what crosses in and out, and what those crossings CARRY
 *   separation     — why it is drawn as its own component at all
 *
 * Counts are deliberately absent from every one of them: they live in
 * `metadata` and are rendered as a chip beside the component, where a count
 * belongs.
 */
export interface ClusterBoundaryLink {
  /** Label of the component on the other side. */
  other: string;
  type: ClusterEdgeType;
  /** Human flow names travelling across this link — never stable keys. */
  carries: string[];
}

export interface ClusterNarrativeFacts {
  label: string;
  kind: ClusterKind;
  /** Directory every member sits under, when they share one. */
  commonPath: string | null;
  /** Database tables this component's own code reads or writes. */
  tables: string[];
  /** Third-party packages this component imports and no other one does. */
  exclusiveExternals: string[];
  inbound: ClusterBoundaryLink[];
  outbound: ClusterBoundaryLink[];
}

export interface ClusterNarrative {
  responsibility: string;
  boundary: string;
  separation: string;
  /** What the evidence could not establish — part of the explanation, not an omission. */
  unknowns: string[];
  /** The three sentences joined; what `deterministic_summary` stores. */
  summary: string;
}

/**
 * What a component of this kind is for, stated so that it could not be
 * produced by rewording the label. "API layer — handles API requests" is the
 * failure these sentences exist to make impossible.
 */
const KIND_RESPONSIBILITY: Record<ClusterKind, string> = {
  api_layer: 'Requests from outside this process enter the system here and are turned into work the rest of the code does.',
  auth_layer: 'Decides who a caller is and what they are allowed to do, before anything else runs.',
  database_layer: 'Owns how this system stores data and reads it back, so no other component writes storage access by hand.',
  frontend_ui: 'Renders what a person sees and turns what they do into calls on the rest of the system.',
  frontend_state: 'Holds the state screens read from, so no screen has to keep its own copy in sync.',
  worker_layer: 'Runs work outside the request path, so a slow job never blocks whoever asked for it.',
  analysis_engine: 'Turns raw input into the structured facts the rest of the system reasons over.',
  integration_layer: 'Talks to services this repository does not own, and is where their failures land first.',
  devops_layer: 'Describes how this system is built, configured and shipped — not what it does while running.',
  test_layer: 'Holds the checks that fail when behaviour elsewhere changes; nothing at runtime depends on it.',
  shared_module: 'Has no domain of its own: it exists so the components that do are not each writing the same thing.',
  other: 'No structural rule placed this code, so what it is for is not established by the evidence here.',
};

/**
 * How a connection of each type reads in a sentence, from each side, plus how
 * much it tells a reader.
 *
 * `rank` collapses the several edges two components share down to the one worth
 * saying. Every `calls` edge is also an `imports` edge, so describing both
 * printed "It calls into Shared Utilities; imports Shared Utilities" — the same
 * relationship twice, which is the flat-edge-list failure this narrative exists
 * to stop repeating. Higher rank wins; `imports` is last because it is the
 * weakest claim any of them makes.
 */
const EDGE_VERB: Record<ClusterEdgeType, { rank: number; out: string; inOne: string; inMany: string }> = {
  reads_writes_data: { rank: 6, out: 'reads and writes', inOne: 'reads and writes it', inMany: 'read and write it' },
  enqueues_job: { rank: 5, out: 'enqueues jobs onto', inOne: 'enqueues jobs onto it', inMany: 'enqueue jobs onto it' },
  sends_request: { rank: 4, out: 'sends requests to', inOne: 'sends requests to it', inMany: 'send requests to it' },
  tests: { rank: 3, out: 'tests', inOne: 'tests it', inMany: 'test it' },
  calls: { rank: 2, out: 'calls into', inOne: 'calls into it', inMany: 'call into it' },
  uses_config: { rank: 1, out: 'reads configuration from', inOne: 'reads configuration from it', inMany: 'read configuration from it' },
  imports: { rank: 0, out: 'imports', inOne: 'imports it', inMany: 'import it' },
};

/** "a", "a and b", "a, b and c" — never a bare comma list ending in a dangle. */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Distinct, order-preserving, capped — every fact list in the narrative is one. */
function take(values: Iterable<string>, limit: number): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!v || out.includes(v)) continue;
    out.push(v);
    if (out.length === limit) break;
  }
  return out;
}

/** How many components one side of a boundary names before it says "and others". */
const MAX_PARTNERS = 3;

/**
 * One direction of a boundary in words: "reads and writes Database Schema,
 * calls into Shared Utilities and Workers".
 *
 * Each partner is named once, under the strongest verb the two of them share,
 * so a component that both imports and calls another appears once rather than
 * in two clauses that a reader has to notice are the same relationship.
 */
function describeLinks(links: ClusterBoundaryLink[], side: 'out' | 'in'): string {
  const strongest = new Map<string, ClusterEdgeType>();
  for (const link of links) {
    const current = strongest.get(link.other);
    if (!current || EDGE_VERB[link.type].rank > EDGE_VERB[current].rank) strongest.set(link.other, link.type);
  }

  const byVerb = new Map<ClusterEdgeType, string[]>();
  for (const [other, type] of strongest) {
    (byVerb.get(type) ?? byVerb.set(type, []).get(type)!).push(other);
  }

  return [...byVerb.entries()]
    .sort((a, b) => EDGE_VERB[b[0]].rank - EDGE_VERB[a[0]].rank)
    .map(([type, all]) => {
      const shown = take(all, MAX_PARTNERS);
      // `list()` would render "A, B and C and others" — the truncation marker
      // takes the conjunction slot instead.
      const named = all.length > shown.length ? `${shown.join(', ')} and others` : list(shown);
      const verb = EDGE_VERB[type];
      return side === 'out'
        ? `${verb.out} ${named}`
        : `${named} ${all.length === 1 ? verb.inOne : verb.inMany}`;
    })
    .join(', ');
}

export function buildClusterNarrative(facts: ClusterNarrativeFacts): ClusterNarrative {
  const unknowns: string[] = [];

  // ── Responsibility: the kind's role, made specific by this repo's own nouns.
  const evidence: string[] = [];
  const tables = take(facts.tables, 5);
  if (tables.length > 0) {
    evidence.push(`it reads or writes the ${list(tables)} table${tables.length === 1 ? '' : 's'}`);
  }
  const externals = take(facts.exclusiveExternals, 3);
  if (externals.length > 0) {
    evidence.push(`it is the only component here that pulls in ${list(externals)}`);
  }
  const responsibility = evidence.length > 0
    ? `${KIND_RESPONSIBILITY[facts.kind]} In this repository ${list(evidence)}.`
    : KIND_RESPONSIBILITY[facts.kind];

  // ── Boundary: what crosses, and what those crossings carry.
  const links = [...facts.inbound, ...facts.outbound];
  const carried = take(links.flatMap((l) => l.carries), 3);
  let boundary: string;
  if (links.length === 0) {
    boundary = 'Nothing in the traced evidence connects it to another component.';
    unknowns.push(
      'No traced connection reaches this component, which is a limit of the tracing as much as a fact about the code.',
    );
  } else {
    const out = describeLinks(facts.outbound, 'out');
    const inb = describeLinks(facts.inbound, 'in');
    const sentences: string[] = [];
    if (out) sentences.push(`It ${out}.`);
    if (inb) sentences.push(`${inb[0]!.toUpperCase()}${inb.slice(1)}.`);
    if (carried.length > 0) {
      sentences.push(`Traced flows crossing that boundary include ${list(carried)}.`);
    } else {
      sentences.push('No traced flow crosses that boundary — the links here are imports and calls only.');
      unknowns.push('No traced flow crosses this boundary, so what actually travels between these components at runtime is not established.');
    }
    boundary = sentences.join(' ');
  }

  // ── Separation: why it is its own component. Derived, never asserted.
  let separation: string;
  if (facts.inbound.length === 0 && facts.outbound.length === 0) {
    separation = 'It stands alone in this map; treat that as a gap in what could be traced, not as proof that nothing uses it.';
  } else if (facts.inbound.length === 0) {
    separation = 'Nothing else in the map depends on it, so a change made here stops at its own boundary.';
  } else if (facts.outbound.length === 0) {
    separation = 'It depends on nothing else in the map, which is what makes it safe for everything else to depend on it.';
  } else if (externals.length > 0) {
    separation = `Keeping it separate is what stops ${list(externals)} from spreading into the rest of the codebase.`;
  } else {
    separation = facts.commonPath
      ? `It is drawn as one component because its files share \`${facts.commonPath}\` — the grouping is by path and convention, not by a declared module boundary.`
      : 'It is drawn as one component by path and convention, not by a declared module boundary.';
  }

  if (evidence.length === 0 && carried.length === 0) {
    unknowns.push('Nothing in the evidence names what this component works on, so its responsibility above is inferred from its kind alone.');
  }

  return {
    responsibility,
    boundary,
    separation,
    unknowns,
    summary: [responsibility, boundary, separation].filter(Boolean).join(' '),
  };
}

/** Longest shared directory of a set of file paths, or null when they diverge. */
function commonDirectory(paths: string[]): string | null {
  const dirs = paths.filter(Boolean).map((p) => p.split('/').slice(0, -1));
  if (dirs.length === 0) return null;
  const first = dirs[0]!;
  let depth = first.length;
  for (const d of dirs) {
    let i = 0;
    while (i < depth && i < d.length && d[i] === first[i]) i++;
    depth = i;
    if (depth === 0) return null;
  }
  return first.slice(0, depth).join('/') || null;
}

/**
 * Narrative facts for every cluster of a persisted snapshot.
 *
 * The API and the `architecture_deep` prompt both call this, so the tab and the
 * generated section are two renderings of ONE dataset. They used to disagree —
 * the tab printed a count-only summary while the section wrote its own prose
 * from edge weights — which is a large part of why the architecture view "does
 * not make sense": the two surfaces described the same component differently.
 *
 * Computed at request time from stored rows rather than read out of
 * `metadata`, so snapshots analysed before this existed get the narrative too
 * without being re-analysed.
 */
/** The stored rows `buildNarrativesFromRows` turns into narrative facts. */
export interface ClusterNarrativeRows {
  clusters: Array<{ id: string; stable_key: string; label: string; kind: ClusterKind }>;
  edges: Array<{ source_cluster_id: string; target_cluster_id: string; type: ClusterEdgeType; crossings: unknown }>;
  members: Array<{ cluster_key: string; file_path: string }>;
  workflows: Array<{ stable_key: string; title: string }>;
  tables: Array<{ file_path: string | null; table_name: string }>;
  externals: Array<{ file_path: string; specifier: string }>;
}

/**
 * Row assembly, split from the queries so the narrative can be exercised
 * against a real snapshot's rows without a database connection.
 */
export function buildNarrativesFromRows(rows: ClusterNarrativeRows): Map<string, ClusterNarrative> {
  const labelById = new Map(rows.clusters.map((c) => [c.id, c.label]));
  const keyById = new Map(rows.clusters.map((c) => [c.id, c.stable_key]));

  const clusterOfFile = new Map<string, string>();
  const pathsByCluster = new Map<string, string[]>();
  for (const m of rows.members) {
    clusterOfFile.set(m.file_path, m.cluster_key);
    (pathsByCluster.get(m.cluster_key) ?? pathsByCluster.set(m.cluster_key, []).get(m.cluster_key)!).push(m.file_path);
  }

  const titleByKey = new Map(rows.workflows.map((w) => [w.stable_key, w.title]));

  const tablesByCluster = new Map<string, Set<string>>();
  for (const t of rows.tables) {
    const key = t.file_path ? clusterOfFile.get(t.file_path) : undefined;
    if (!key) continue;
    (tablesByCluster.get(key) ?? tablesByCluster.set(key, new Set()).get(key)!).add(t.table_name);
  }

  // "Exclusive" is the whole point: a package half the repo imports says
  // nothing about one component, while a package only this component imports
  // is precisely why it is drawn as its own box.
  const clustersByExternal = new Map<string, Set<string>>();
  for (const x of rows.externals) {
    const key = clusterOfFile.get(x.file_path);
    if (!key) continue;
    const pkg = packageOfSpecifier(x.specifier);
    if (!isThirdParty(pkg)) continue;
    (clustersByExternal.get(pkg) ?? clustersByExternal.set(pkg, new Set()).get(pkg)!).add(key);
  }
  const exclusiveByCluster = new Map<string, string[]>();
  for (const [pkg, owners] of clustersByExternal) {
    if (owners.size !== 1) continue;
    const key = [...owners][0]!;
    (exclusiveByCluster.get(key) ?? exclusiveByCluster.set(key, []).get(key)!).push(pkg);
  }

  const inbound = new Map<string, ClusterBoundaryLink[]>();
  const outbound = new Map<string, ClusterBoundaryLink[]>();
  for (const e of rows.edges) {
    const sourceKey = keyById.get(e.source_cluster_id);
    const targetKey = keyById.get(e.target_cluster_id);
    const sourceLabel = labelById.get(e.source_cluster_id);
    const targetLabel = labelById.get(e.target_cluster_id);
    if (!sourceKey || !targetKey || !sourceLabel || !targetLabel) continue;
    const carries = (Array.isArray(e.crossings) ? e.crossings : [])
      .filter((c): c is string => typeof c === 'string')
      .map((c) => titleByKey.get(c))
      .filter((t): t is string => !!t);
    (outbound.get(sourceKey) ?? outbound.set(sourceKey, []).get(sourceKey)!)
      .push({ other: targetLabel, type: e.type, carries });
    (inbound.get(targetKey) ?? inbound.set(targetKey, []).get(targetKey)!)
      .push({ other: sourceLabel, type: e.type, carries });
  }

  const out = new Map<string, ClusterNarrative>();
  for (const c of rows.clusters) {
    out.set(c.stable_key, buildClusterNarrative({
      label: c.label,
      kind: c.kind,
      commonPath: commonDirectory(pathsByCluster.get(c.stable_key) ?? []),
      tables: [...(tablesByCluster.get(c.stable_key) ?? [])],
      exclusiveExternals: exclusiveByCluster.get(c.stable_key) ?? [],
      inbound: inbound.get(c.stable_key) ?? [],
      outbound: outbound.get(c.stable_key) ?? [],
    }));
  }
  return out;
}

export async function loadClusterNarratives(snapshotId: string): Promise<Map<string, ClusterNarrative>> {
  const [clusterRows, edgeRows, memberRows, workflowRows, tableRows, externalRows] = await Promise.all([
    query(
      `SELECT id, stable_key, label, kind FROM architecture_clusters WHERE snapshot_id = $1`,
      [snapshotId],
    ),
    query(
      `SELECT e.source_cluster_id, e.target_cluster_id, e.type,
              COALESCE(e.metadata->'workflowCrossings', '[]'::jsonb) AS crossings
       FROM architecture_edges e WHERE e.snapshot_id = $1
       ORDER BY e.weight DESC`,
      [snapshotId],
    ),
    query(
      `SELECT c.stable_key AS cluster_key, gn.file_path
       FROM architecture_cluster_members m
       JOIN architecture_clusters c ON c.id = m.cluster_id
       JOIN graph_nodes gn ON gn.id = m.node_id
       WHERE c.snapshot_id = $1 AND gn.file_path IS NOT NULL`,
      [snapshotId],
    ),
    // Crossings are stored as workflow stable keys (`wf:web/app/page.tsx:Home`),
    // which are pipeline bookkeeping and must never reach a reader.
    query(`SELECT stable_key, title FROM workflows WHERE snapshot_id = $1`, [snapshotId]),
    query(
      `SELECT src.file_path, e.metadata->>'table' AS table_name
       FROM graph_edges e JOIN graph_nodes src ON src.id = e.source_node_id
       WHERE e.snapshot_id = $1 AND e.type = 'touches_schema' AND e.metadata->>'table' IS NOT NULL`,
      [snapshotId],
    ),
    query(
      `SELECT src.file_path, COALESCE(tgt.metadata->>'specifier', tgt.name) AS specifier
       FROM graph_edges e
       JOIN graph_nodes src ON src.id = e.source_node_id
       JOIN graph_nodes tgt ON tgt.id = e.target_node_id
       WHERE e.snapshot_id = $1 AND e.type = 'references_external' AND src.file_path IS NOT NULL`,
      [snapshotId],
    ),
  ]);

  return buildNarrativesFromRows({
    clusters: clusterRows.rows as ClusterNarrativeRows['clusters'],
    edges: edgeRows.rows as ClusterNarrativeRows['edges'],
    members: memberRows.rows as ClusterNarrativeRows['members'],
    workflows: workflowRows.rows as ClusterNarrativeRows['workflows'],
    tables: tableRows.rows as ClusterNarrativeRows['tables'],
    externals: externalRows.rows as ClusterNarrativeRows['externals'],
  });
}

function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function humanize(dir: string): string {
  return dir.charAt(0).toUpperCase() + dir.slice(1);
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Writes clusters, their members and their edges as ONE transaction.
 *
 * These were three independent statement loops. A failure partway through left
 * clusters persisted with no member rows, which reads downstream as a real
 * "0 files" cluster rather than as a half-finished write — and the cluster's
 * own `metadata.fileCount` still said otherwise, so the two disagreed with no
 * way to tell which was wrong.
 *
 * Pass a `PoolClient` to enlist in a caller's transaction; omit it and this
 * opens and commits its own.
 */
export async function persistArchitecture(
  snapshotId: string,
  map: ArchitectureMap,
  nodeIdMap: Map<string, string>,
  client?: PoolClient,
): Promise<void> {
  if (!client) {
    const own = await pool.connect();
    try {
      await own.query('BEGIN');
      await persistArchitecture(snapshotId, map, nodeIdMap, own);
      await own.query('COMMIT');
    } catch (err) {
      await own.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      own.release();
    }
    return;
  }

  const run = (text: string, values: unknown[]) => client.query(text, values);
  const clusterIdByKey = new Map<string, string>();
  let droppedTotal = 0;

  for (const cluster of map.clusters) {
    const result = await run(
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

    // A member whose node never made it into `nodeIdMap` is dropped here. That
    // is how clusters ended up with a non-zero metadata.fileCount and zero
    // member rows — the two counts came from different places and only one of
    // them knew about the drop. Never silent: the count rides along on the
    // cluster so the mismatch is visible instead of inferred.
    const dropped = cluster.members.length - memberRows.length;
    if (dropped > 0) {
      droppedTotal += dropped;
      console.warn(
        `[architecture] cluster ${cluster.stableKey}: ${dropped}/${cluster.members.length} members ` +
        `have no persisted graph node and were not linked`,
      );
    }

    if (memberRows.length > 0) {
      await run(
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
      const evidenceResult = await run(
        `SELECT id FROM graph_edges
         WHERE snapshot_id = $1 AND source_node_id = ANY($2::uuid[]) AND target_node_id = ANY($3::uuid[])
         LIMIT 20`,
        [snapshotId, sourceIds, targetIds],
      );
      evidenceIds = evidenceResult.rows.map((r) => r.id as string);
    }

    await run(
      `INSERT INTO architecture_edges
         (snapshot_id, source_cluster_id, target_cluster_id, type, weight, evidence_edge_ids, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [snapshotId, sourceClusterId, targetClusterId, edge.type, edge.weight,
       evidenceIds, JSON.stringify({ workflowCrossings: edge.workflowCrossings })],
    );
  }

  if (droppedTotal > 0) {
    console.warn(`[architecture] ${droppedTotal} cluster member(s) had no persisted graph node across all clusters`);
  }
}
