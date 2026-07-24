/**
 * Deterministic backbones for the CONSULT chapter (plan: "reference:
 * austere, deterministic-first, byte-stable"). Every table below is built
 * from SQL/graph facts; the LLM writes ONLY the intro and per-group
 * one-liners around a [[backbone]] marker that the generator replaces with
 * these blocks — the model never touches (and so never corrupts) the facts.
 *
 * Also home to the config-fact readers over the config graph nodes that
 * step 0's config-as-flow extraction annotates (topology, env vars, package
 * scripts, CI) — several specs share them.
 */

import { query } from '../../lib/db.js';
import type { RuntimeTopology, CiPipeline, EnvVarDoc } from '../engine/configFlowExtractor.js';

export interface ConfigFacts {
  topology: RuntimeTopology | null;
  testTopology: RuntimeTopology | null;
  envFiles: Array<{ path: string; vars: EnvVarDoc[] }>;
  packageScripts: Array<{ path: string; scripts: Record<string, string> }>;
  ci: CiPipeline[];
}

/** Config-as-flow facts stamped on config nodes at analyze time (step 0). */
export async function loadConfigFacts(snapshotId: string): Promise<ConfigFacts> {
  const rows = (await query(
    `SELECT file_path, metadata FROM graph_nodes
     WHERE snapshot_id = $1 AND type = 'config'
       AND (metadata ? 'topology' OR metadata ? 'envVars' OR metadata ? 'scripts' OR metadata ? 'ci')`,
    [snapshotId],
  )).rows as Array<{ file_path: string; metadata: Record<string, unknown> }>;

  const facts: ConfigFacts = { topology: null, testTopology: null, envFiles: [], packageScripts: [], ci: [] };
  for (const row of rows) {
    const meta = row.metadata;
    if (meta.topology) {
      const topo = meta.topology as RuntimeTopology;
      if (/test/i.test(row.file_path.split('/').pop() ?? '')) {
        facts.testTopology ??= topo;
      } else {
        facts.topology ??= topo;
      }
    }
    if (Array.isArray(meta.envVars)) {
      facts.envFiles.push({ path: row.file_path, vars: meta.envVars as EnvVarDoc[] });
    }
    if (meta.scripts && typeof meta.scripts === 'object') {
      facts.packageScripts.push({ path: row.file_path, scripts: meta.scripts as Record<string, string> });
    }
    if (meta.ci) facts.ci.push(meta.ci as CiPipeline);
  }
  facts.envFiles.sort((a, b) => a.path.localeCompare(b.path));
  facts.packageScripts.sort((a, b) => a.path.localeCompare(b.path));
  return facts;
}

const cell = (v: unknown): string =>
  String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);

// ── routes_jobs ──────────────────────────────────────────────────────────────

interface RouteRow {
  method: string | null;
  route_path: string | null;
  file_path: string;
  line_start: number | null;
  symbol: string | null;
  workflow_title: string | null;
}

/** First two path segments group routes (mount order isn't persisted; see spec note). */
function routeGroup(path: string): string {
  const segs = path.split('/').filter(Boolean);
  return '/' + segs.slice(0, 2).join('/');
}

export async function buildRoutesJobsBackbone(snapshotId: string): Promise<string> {
  const routes = (await query(
    `SELECT e.method, e.route_path, n.file_path, n.line_start,
            e.metadata->>'symbolName' AS symbol, w.title AS workflow_title
     FROM entrypoints e
     JOIN graph_nodes n ON n.id = e.node_id
     LEFT JOIN workflows w ON w.entrypoint_id = e.id
     WHERE e.snapshot_id = $1 AND e.trigger_type = 'http_route' AND e.route_path IS NOT NULL
     ORDER BY e.route_path, e.method`,
    [snapshotId],
  )).rows as RouteRow[];

  const consumers = (await query(
    `SELECT e.route_path AS queue_name, n.file_path, e.metadata->>'symbolName' AS symbol
     FROM entrypoints e JOIN graph_nodes n ON n.id = e.node_id
     WHERE e.snapshot_id = $1 AND e.trigger_type = 'worker_job'
     ORDER BY e.route_path`,
    [snapshotId],
  )).rows as Array<{ queue_name: string | null; file_path: string; symbol: string | null }>;

  const jobs = (await query(
    `SELECT DISTINCT s.target AS job, s.metadata->>'queueHint' AS hint
     FROM side_effects s
     WHERE s.snapshot_id = $1 AND s.type = 'queue_enqueue' AND s.target IS NOT NULL
     ORDER BY 2, 1`,
    [snapshotId],
  )).rows as Array<{ job: string; hint: string | null }>;

  const parts: string[] = [];

  const groups = new Map<string, RouteRow[]>();
  for (const r of routes) {
    const g = routeGroup(r.route_path!);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [group, rows] of ordered) {
    parts.push(`#### \`${group}\``);
    parts.push('| Method | Path | Handler | Workflow |');
    parts.push('| --- | --- | --- | --- |');
    for (const r of rows) {
      const handler = `\`${r.file_path}${r.line_start ? `:${r.line_start}` : ''}\`${r.symbol ? ` ${cell(r.symbol)}` : ''}`;
      parts.push(`| ${cell(r.method)} | \`${cell(r.route_path)}\` | ${handler} | ${cell(r.workflow_title ?? '')} |`);
    }
    parts.push('');
  }

  if (consumers.length > 0) {
    parts.push('#### Queues & background jobs');
    parts.push('| Queue | Consumer | Job types enqueued |');
    parts.push('| --- | --- | --- |');
    for (const c of consumers) {
      const queueJobs = jobs
        .filter((j) => j.hint && c.queue_name && j.hint === normalizeToken(c.queue_name))
        .map((j) => `\`${j.job}\``).join(', ');
      parts.push(`| ${cell(c.queue_name)} | \`${cell(c.file_path)}\`${c.symbol ? ` ${cell(c.symbol)}` : ''} | ${queueJobs || '—'} |`);
    }
    parts.push('');
  }

  const webhooks = routes.filter((r) => /webhook/i.test(r.route_path ?? ''));
  if (webhooks.length > 0) {
    parts.push('#### Webhooks (externally triggered)');
    for (const w of webhooks) {
      parts.push(`- \`${w.method} ${w.route_path}\` — handled in \`${w.file_path}\``);
    }
    parts.push('');
  }

  return parts.join('\n').trim();
}

/** Mirror of the detector's queue-token normalization (kept dependency-free). */
function normalizeToken(raw: string): string {
  return raw.replace(/^get/i, '').replace(/queue/gi, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().replace(/s$/, '');
}

// ── data_model ───────────────────────────────────────────────────────────────

export async function buildDataModelBackbone(snapshotId: string): Promise<string> {
  const tables = (await query(
    `SELECT name, file_path, line_start, metadata->'references' AS refs
     FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema' ORDER BY line_start NULLS LAST, name`,
    [snapshotId],
  )).rows as Array<{ name: string; file_path: string; line_start: number | null; refs: string[] | null }>;
  if (tables.length === 0) return '';

  const access = (await query(
    `SELECT tn.name AS table_name, sn.file_path AS accessor, count(*)::int AS n
     FROM graph_edges e
     JOIN graph_nodes sn ON sn.id = e.source_node_id
     JOIN graph_nodes tn ON tn.id = e.target_node_id
     WHERE e.snapshot_id = $1 AND e.type = 'touches_schema' AND sn.file_path IS NOT NULL
     GROUP BY 1, 2 ORDER BY 3 DESC`,
    [snapshotId],
  )).rows as Array<{ table_name: string; accessor: string; n: number }>;
  const accessors = new Map<string, string[]>();
  for (const a of access) {
    const list = accessors.get(a.table_name) ?? [];
    if (list.length < 3 && !list.includes(a.accessor)) list.push(a.accessor);
    accessors.set(a.table_name, list);
  }

  const sourceFiles = [...new Set(tables.map((t) => t.file_path))];
  const parts: string[] = [
    `Source of truth: ${sourceFiles.map((f) => `\`${f}\``).join(', ')} (${tables.length} tables, listed in schema-file order).`,
    '',
    '| Table | Defined at | References | Accessed by |',
    '| --- | --- | --- | --- |',
  ];
  for (const t of tables) {
    const refs = (t.refs ?? []).map((r) => `\`${r}\``).join(', ');
    const acc = (accessors.get(t.name) ?? []).map((a) => `\`${a}\``).join(', ');
    parts.push(`| \`${cell(t.name)}\` | ${cell(`${t.file_path}${t.line_start ? `:${t.line_start}` : ''}`)} | ${refs || '—'} | ${acc || '—'} |`);
  }
  return parts.join('\n');
}

// ── guardrails_ops ───────────────────────────────────────────────────────────

const GUARDRAIL_NAME = /budget|kill|privacy|secret|guard|limit|heartbeat|throttle|quota|sanitiz|redact/i;

export async function buildGuardrailsBackbone(snapshotId: string, facts: ConfigFacts): Promise<string> {
  const parts: string[] = [];

  for (const envFile of facts.envFiles) {
    parts.push(`#### Environment variables (\`${envFile.path}\` — names only, values never analyzed)`);
    parts.push('| Variable | Documented purpose |');
    parts.push('| --- | --- |');
    for (const v of envFile.vars) {
      parts.push(`| \`${cell(v.name)}\` | ${cell(v.comment ?? '—')} |`);
    }
    parts.push('');
  }

  const guardSymbols = (await query(
    `SELECT stable_key, name, file_path, line_start,
            COALESCE((metadata->>'dependentCount')::int, 0) AS dependents
     FROM graph_nodes
     WHERE snapshot_id = $1 AND type IN ('function', 'class', 'variable', 'method')
       AND name ~* $2 AND trust_level = 'code'
     ORDER BY 5 DESC, name LIMIT 14`,
    [snapshotId, GUARDRAIL_NAME.source],
  )).rows as Array<{ stable_key: string; name: string; file_path: string; line_start: number | null; dependents: number }>;
  if (guardSymbols.length > 0) {
    parts.push('#### Guardrail code (name-matched enforcement points)');
    parts.push('| Symbol | Where |');
    parts.push('| --- | --- |');
    for (const g of guardSymbols) {
      parts.push(`| \`${cell(g.name)}\` | \`${cell(`${g.file_path}${g.line_start ? `:${g.line_start}` : ''}`)}\` |`);
    }
    parts.push('');
  }

  return parts.join('\n').trim();
}
