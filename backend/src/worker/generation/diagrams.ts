/**
 * Deterministic Mermaid diagrams (doc/Pipeline.md "Generation"): derived
 * from deterministic data — cluster edges, workflow steps, schema
 * references. The LLM may caption them but never invents nodes/edges.
 */

import { isTestOrFixturePath } from '../engine/testPaths.js';

export interface DiagramSpec {
  kind: 'architecture' | 'sequence' | 'dataflow' | 'schema' | 'topology' | 'er';
  mermaid: string;
}

/** Mermaid ids must be alphanumeric-ish; labels carry the real names. */
function mermaidId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'n';
}

function escapeLabel(raw: string): string {
  return raw.replace(/["[\]{}|]/g, ' ').trim().slice(0, 60);
}

// ── Architecture: clusters + typed edges ─────────────────────────────────────

/** Readability caps — a diagram that needs a magnifier is anti-evidence. */
const MAX_ARCH_EDGES = 16;

export function architectureDiagram(
  clusters: Array<{ stableKey: string; label: string; kind: string }>,
  edges: Array<{ sourceClusterKey: string; targetClusterKey: string; type: string; weight: number }>,
): string {
  // Test clusters double every hairball (tests import everything); their
  // edges say nothing about runtime architecture.
  const testKeys = new Set(clusters.filter((c) => c.kind === 'tests').map((c) => c.stableKey));
  const known = new Set(clusters.map((c) => c.stableKey));

  // Dedupe per direction (keep the heaviest edge), drop self-loops and
  // test-cluster edges, then keep only the strongest MAX_ARCH_EDGES.
  const best = new Map<string, { sourceClusterKey: string; targetClusterKey: string; type: string; weight: number }>();
  for (const edge of edges) {
    if (!known.has(edge.sourceClusterKey) || !known.has(edge.targetClusterKey)) continue;
    if (edge.sourceClusterKey === edge.targetClusterKey) continue;
    if (testKeys.has(edge.sourceClusterKey) || testKeys.has(edge.targetClusterKey)) continue;
    const key = `${edge.sourceClusterKey}->${edge.targetClusterKey}`;
    const prior = best.get(key);
    if (!prior || edge.weight > prior.weight) best.set(key, edge);
  }
  const kept = [...best.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_ARCH_EDGES);

  // Only draw clusters that participate in a kept edge — isolated boxes are
  // list content, not diagram content (the section text has the full list).
  const drawn = new Set(kept.flatMap((e) => [e.sourceClusterKey, e.targetClusterKey]));
  const lines = ['flowchart TD'];
  for (const cluster of clusters) {
    if (!drawn.has(cluster.stableKey)) continue;
    lines.push(`  ${mermaidId(cluster.stableKey)}["${escapeLabel(cluster.label)}"]`);
  }
  for (const edge of kept) {
    lines.push(`  ${mermaidId(edge.sourceClusterKey)} -->|${escapeLabel(edge.type)}| ${mermaidId(edge.targetClusterKey)}`);
  }
  return lines.join('\n');
}

// ── Workflow: sequence diagram from traced steps ─────────────────────────────

export interface DiagramStep {
  stepOrder: number;
  filePath: string;
  symbolName: string | null;
  stepKind: string | null;
  description: string;
}

const DATA_STEP_KINDS = new Set(['data_read', 'data_write']);

/** Data-heavy workflows (majority data steps) render as dataflow instead. */
export function workflowDiagramKind(steps: DiagramStep[]): 'sequence' | 'dataflow' {
  const dataSteps = steps.filter((s) => s.stepKind !== null && DATA_STEP_KINDS.has(s.stepKind)).length;
  return dataSteps * 2 > steps.length ? 'dataflow' : 'sequence';
}

const MAX_SEQUENCE_PARTICIPANTS = 8;

export function workflowSequenceDiagram(title: string, steps: DiagramStep[]): string {
  // Fixture/test files are never real flow participants — a trace step that
  // resolved a table to a fixture migration must not put that file on the
  // diagram as if production called it.
  const drawable = steps.filter((s) => !isTestOrFixturePath(s.filePath));
  if (drawable.length === 0) return 'sequenceDiagram\n  Note over _: no drawable steps';

  const participants: string[] = [];
  const seen = new Set<string>();
  for (const step of drawable) {
    if (!seen.has(step.filePath)) {
      seen.add(step.filePath);
      participants.push(step.filePath);
    }
    if (participants.length >= MAX_SEQUENCE_PARTICIPANTS) break;
  }
  const alias = new Map(participants.map((p, i) => [p, `P${i}`]));

  // Hub topology: every arrow originates from the flow's ENTRY participant.
  // The old chained form (each step's file "calling" the next step's file)
  // drew interactions that do not exist — button.tsx messaging badge.tsx,
  // one SQL file "calling" another. The trace records the ORDER files are
  // reached from the entry point; the diagram must not claim more than that.
  const entry = alias.get(drawable[0]!.filePath)!;
  const lines = ['sequenceDiagram'];
  for (const p of participants) lines.push(`  participant ${alias.get(p)} as ${escapeLabel(p)}`);
  let skipped = 0;
  for (const step of drawable) {
    const current = alias.get(step.filePath);
    if (!current) {
      skipped += 1;
      continue;
    }
    const label = escapeLabel(`${step.stepOrder}. ${step.symbolName ?? step.stepKind ?? 'step'}`);
    lines.push(`  ${entry}->>${current}: ${label}`);
  }
  if (skipped > 0) {
    lines.push(`  Note over ${entry}: +${skipped} more steps beyond ${MAX_SEQUENCE_PARTICIPANTS} files`);
  }
  return lines.join('\n');
}

export function workflowDataflowDiagram(title: string, steps: DiagramStep[]): string {
  const lines = ['flowchart LR'];
  const nodeIds: string[] = [];
  for (const step of steps) {
    const id = `s${step.stepOrder}`;
    nodeIds.push(id);
    const label = escapeLabel(`${step.filePath}${step.symbolName ? `::${step.symbolName}` : ''}`);
    const shape = step.stepKind !== null && DATA_STEP_KINDS.has(step.stepKind) ? `[(${label})]` : `["${label}"]`;
    lines.push(`  ${id}${shape}`);
  }
  for (let i = 1; i < nodeIds.length; i++) {
    const kind = steps[i]!.stepKind ?? 'step';
    lines.push(`  ${nodeIds[i - 1]} -->|${escapeLabel(kind)}| ${nodeIds[i]}`);
  }
  return lines.join('\n');
}

// ── Runtime topology: compose services + env-derived external services ───────

export interface TopologyService {
  name: string;
  ports?: string[];
  dependsOn?: string[];
  image?: string;
}

/**
 * External managed services inferred from env var NAMES (never values) — a
 * deterministic prefix/substring table, honest about its source ("from
 * .env"). First matching rule wins per variable; labels dedupe.
 */
const ENV_SERVICE_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /SUPABASE/i, label: 'Supabase (Postgres + Auth)' },
  { pattern: /^(DIRECT_)?DATABASE_URL$/i, label: 'Postgres' },
  { pattern: /REDIS|UPSTASH/i, label: 'Redis' },
  { pattern: /GITHUB/i, label: 'GitHub App/API' },
  { pattern: /OPENROUTER/i, label: 'OpenRouter' },
  { pattern: /OPENAI/i, label: 'OpenAI' },
  { pattern: /ANTHROPIC/i, label: 'Anthropic' },
  { pattern: /STRIPE/i, label: 'Stripe' },
  { pattern: /^(AWS|S3)_/i, label: 'AWS' },
  { pattern: /SENDGRID|RESEND|SMTP|MAILGUN/i, label: 'Email service' },
  { pattern: /SENTRY/i, label: 'Sentry' },
];

export function envExternalServices(envVarNames: string[]): string[] {
  const labels = new Set<string>();
  for (const name of envVarNames) {
    const rule = ENV_SERVICE_RULES.find((r) => r.pattern.test(name));
    if (rule) labels.add(rule.label);
  }
  // Supabase IS the Postgres — don't draw the database twice.
  if (labels.has('Supabase (Postgres + Auth)')) labels.delete('Postgres');
  return [...labels];
}

/**
 * The big_picture anchor: compose services (with their real wiring) plus the
 * external services the env names imply. Everything drawn is a parsed fact.
 */
export function topologyDiagram(
  services: TopologyService[],
  externalServices: string[],
): string {
  const lines = ['flowchart LR'];
  lines.push('  subgraph runtime["docker compose services"]');
  for (const s of services) {
    const detail = s.ports?.length ? ` :${s.ports.map((p) => p.split(':')[0]).join(', :')}` : '';
    lines.push(`    ${mermaidId(`svc_${s.name}`)}["${escapeLabel(`${s.name}${detail}`)}"]`);
  }
  lines.push('  end');
  for (const s of services) {
    for (const dep of s.dependsOn ?? []) {
      if (!services.some((o) => o.name === dep)) continue;
      lines.push(`  ${mermaidId(`svc_${s.name}`)} -->|depends on| ${mermaidId(`svc_${dep}`)}`);
    }
  }
  if (externalServices.length > 0) {
    lines.push('  subgraph external["external services (from .env names)"]');
    for (const label of externalServices) {
      lines.push(`    ${mermaidId(`ext_${label}`)}(["${escapeLabel(label)}"])`);
    }
    lines.push('  end');
    lines.push('  runtime -.-> external');
  }
  return lines.join('\n');
}

// ── ER diagram: real FK relationships from schema parsing ────────────────────

const MAX_ER_TABLES = 22;

export function erDiagram(
  tables: Array<{ name: string; references: string[] }>,
): string {
  // Prioritize connected tables (in+out FK degree); isolated tables list in
  // the section body instead of cluttering the diagram.
  const degree = new Map<string, number>();
  const known = new Set(tables.map((t) => t.name));
  for (const t of tables) {
    for (const ref of t.references) {
      if (!known.has(ref)) continue;
      degree.set(t.name, (degree.get(t.name) ?? 0) + 1);
      degree.set(ref, (degree.get(ref) ?? 0) + 1);
    }
  }
  const kept = new Set(
    [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ER_TABLES).map(([n]) => n),
  );
  const lines = ['erDiagram'];
  const seenPairs = new Set<string>();
  for (const t of tables) {
    if (!kept.has(t.name)) continue;
    for (const ref of t.references) {
      if (!kept.has(ref) || ref === t.name) continue;
      const pair = `${ref}->${t.name}`;
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      // parent ||--o{ child : "" — the child's FK points at the parent.
      lines.push(`  ${mermaidId(ref)} ||--o{ ${mermaidId(t.name)} : ""`);
    }
  }
  if (lines.length === 1) return '';
  return lines.join('\n');
}

// ── Data schema: tables + who reads/writes them ──────────────────────────────

const MAX_SCHEMA_TABLES = 12;
const MAX_ACCESSORS_PER_TABLE = 3;

export function schemaDiagram(
  tables: Array<{ name: string }>,
  accesses: Array<{ table: string; accessor: string; mode: string }>,
): string {
  const known = new Set(tables.map((t) => t.name));

  // Only connected tables are diagram content — 20+ isolated cylinders was
  // screens of scrolling that said nothing. Test/fixture accessors are
  // evidence noise, not the data topology.
  const usable = accesses.filter((a) => known.has(a.table) && !isTestOrFixturePath(a.accessor));
  const degree = new Map<string, number>();
  for (const a of usable) degree.set(a.table, (degree.get(a.table) ?? 0) + 1);
  const keptTables = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SCHEMA_TABLES)
    .map(([name]) => name);
  const keptSet = new Set(keptTables);

  const lines = ['flowchart LR'];
  for (const name of keptTables) {
    lines.push(`  ${mermaidId(`t_${name}`)}[("${escapeLabel(name)}")]`);
  }
  const perTable = new Map<string, number>();
  const seenAccessors = new Set<string>();
  const seenEdges = new Set<string>();
  for (const access of usable) {
    if (!keptSet.has(access.table)) continue;
    const used = perTable.get(access.table) ?? 0;
    if (used >= MAX_ACCESSORS_PER_TABLE) continue;
    const accessorId = mermaidId(`a_${access.accessor}`);
    const edgeKey = `${accessorId}->${access.table}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    perTable.set(access.table, used + 1);
    if (!seenAccessors.has(accessorId)) {
      seenAccessors.add(accessorId);
      lines.push(`  ${accessorId}["${escapeLabel(access.accessor)}"]`);
    }
    lines.push(`  ${accessorId} -->|${escapeLabel(access.mode)}| ${mermaidId(`t_${access.table}`)}`);
  }
  return lines.join('\n');
}
