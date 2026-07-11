/**
 * Deterministic Mermaid diagrams (doc/Pipeline.md "Generation"): derived
 * from deterministic data — cluster edges, workflow steps, schema
 * references. The LLM may caption them but never invents nodes/edges.
 */

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

export function architectureDiagram(
  clusters: Array<{ stableKey: string; label: string; kind: string }>,
  edges: Array<{ sourceClusterKey: string; targetClusterKey: string; type: string; weight: number }>,
): string {
  const lines = ['flowchart TD'];
  for (const cluster of clusters) {
    lines.push(`  ${mermaidId(cluster.stableKey)}["${escapeLabel(cluster.label)}"]`);
  }
  const known = new Set(clusters.map((c) => c.stableKey));
  for (const edge of edges) {
    if (!known.has(edge.sourceClusterKey) || !known.has(edge.targetClusterKey)) continue;
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

export function workflowSequenceDiagram(title: string, steps: DiagramStep[]): string {
  const participants: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (!seen.has(step.filePath)) {
      seen.add(step.filePath);
      participants.push(step.filePath);
    }
  }
  const alias = new Map(participants.map((p, i) => [p, `P${i}`]));
  const lines = ['sequenceDiagram'];
  for (const p of participants) lines.push(`  participant ${alias.get(p)} as ${escapeLabel(p)}`);
  let previous: string | null = null;
  for (const step of steps) {
    const current = alias.get(step.filePath)!;
    const label = escapeLabel(`${step.stepOrder}. ${step.symbolName ?? step.stepKind ?? 'step'}`);
    lines.push(`  ${previous ?? current}->>${current}: ${label}`);
    previous = current;
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

export function schemaDiagram(
  tables: Array<{ name: string }>,
  accesses: Array<{ table: string; accessor: string; mode: string }>,
): string {
  const lines = ['flowchart LR'];
  const known = new Set<string>();
  for (const table of tables) {
    known.add(table.name);
    lines.push(`  ${mermaidId(`t_${table.name}`)}[("${escapeLabel(table.name)}")]`);
  }
  const seenAccessors = new Set<string>();
  for (const access of accesses) {
    if (!known.has(access.table)) continue;
    const accessorId = mermaidId(`a_${access.accessor}`);
    if (!seenAccessors.has(accessorId)) {
      seenAccessors.add(accessorId);
      lines.push(`  ${accessorId}["${escapeLabel(access.accessor)}"]`);
    }
    lines.push(`  ${accessorId} -->|${escapeLabel(access.mode)}| ${mermaidId(`t_${access.table}`)}`);
  }
  return lines.join('\n');
}
