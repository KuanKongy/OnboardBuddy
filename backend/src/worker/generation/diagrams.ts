/**
 * Deterministic Mermaid diagrams (doc/Pipeline.md "Generation"): derived
 * from deterministic data — cluster edges, workflow steps, schema
 * references. The LLM may caption them but never invents nodes/edges.
 */

import { isTestOrFixturePath } from '../engine/testPaths.js';

export interface DiagramSpec {
  kind: 'architecture' | 'sequence' | 'dataflow' | 'schema';
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
