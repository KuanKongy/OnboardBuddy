export interface EvidenceSnapRow {
  commit_hash: string;
  branch: string;
  file_count: number;
  symbol_count: number;
  workflow_count: number;
  project_id: string;
  scope_id: string;
  repo_owner: string;
  repo_name: string;
  role: string;
}

export interface EvidenceNodeRow {
  id: string;
  stable_key: string;
  type: string;
  name: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  hash: string;
  import_count: number;
  metadata: { exportedSymbols?: string[]; importCount?: number };
  exported_symbols: string[];
}

export interface EvidenceEdgeRow {
  source_key: string;
  target_key: string;
  type: string;
}

export interface EvidenceWorkflowRow {
  id: string;
  title: string;
  trigger_type: string;
  purpose: string;
  importance_score: number;
  confidence: string;
  composite_score: number;
  ranking_reasons: string[];
  steps: Array<{
    step_order: number;
    file_path: string;
    symbol_name: string | null;
    line_start: number | null;
    line_end: number | null;
    explanation: string | null;
  }>;
}

export interface EvidenceCriticalRanking {
  file_path: string;
  name: string;
  composite_score: number;
  ranking_reasons: string[];
}

export interface EvidenceBundle {
  snap: EvidenceSnapRow;
  nodes: EvidenceNodeRow[];
  edges: EvidenceEdgeRow[];
  workflows: EvidenceWorkflowRow[];
  nodeIndex: Map<string, EvidenceNodeRow>;
  entrypoints: Array<{ kind: string; method: string | null; route_pattern: string | null; file_path: string; name: string }>;
  sideEffects: Array<{ kind: string; target: string | null; file_path: string }>;
  criticalRankings: EvidenceCriticalRanking[];
}

export function buildContext(bundle: EvidenceBundle): string {
  const { snap, nodes, edges, workflows, entrypoints, sideEffects, criticalRankings } = bundle;

  const top25pct = Math.max(Math.ceil(nodes.length * 0.25), 10);
  const criticalNodes = nodes.slice(0, Math.min(top25pct, 60));

  const nodesList = criticalNodes
    .map((n) => `  ${n.file_path} [${n.type}] imports:${n.import_count} exports:[${n.exported_symbols.slice(0, 8).join(', ')}]`)
    .join('\n') || '  (none)';

  const criticalKeySet = new Set(criticalNodes.map((n) => n.stable_key));
  const relevantEdges = edges.filter((e) => criticalKeySet.has(e.source_key) || criticalKeySet.has(e.target_key));
  const edgesList = relevantEdges.slice(0, 80)
    .map((e) => `  ${e.source_key} -[${e.type}]-> ${e.target_key}`)
    .join('\n') || '  (none)';

  const workflowsList = workflows.length > 0
    ? workflows.map((w) =>
        `  [${w.trigger_type}] "${w.title}" — ${w.purpose} (score:${w.composite_score}, confidence:${w.confidence})\n` +
        `    Reasons: ${w.ranking_reasons.length > 0 ? w.ranking_reasons.join('; ') : 'n/a'}\n` +
        `    Steps:\n` +
        w.steps.map((s) =>
          `      ${s.step_order}. ${s.file_path}${s.symbol_name ? `::${s.symbol_name}` : ''}` +
          (s.explanation ? ` — ${s.explanation}` : ''),
        ).join('\n'),
      ).join('\n\n')
    : '  (none detected)';

  const dirCounts = new Map<string, number>();
  for (const n of nodes) {
    const parts = n.file_path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, 2).join('/') : parts[0]!;
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const dirStructure = Array.from(dirCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([dir, count]) => `  ${dir}/ (${count} files)`)
    .join('\n');

  return `Repository: ${snap.repo_owner}/${snap.repo_name} (branch: ${snap.branch}, commit: ${snap.commit_hash.slice(0, 8)})
Stats: ${snap.file_count} files, ${snap.symbol_count} symbols, ${snap.workflow_count} detected workflows
Role context: Generating for "${snap.role}" developer perspective
Total graph: ${nodes.length} modules, ${edges.length} dependency edges

DIRECTORY STRUCTURE (top directories by file count):
${dirStructure}

CRITICAL MODULES (top ${criticalNodes.length} by connectivity — the 25% that matter most):
${nodesList}

DEPENDENCY EDGES (connections between critical modules):
${edgesList}

ENTRYPOINTS (how requests/events enter the system):
${entrypoints.length > 0
    ? entrypoints.map((ep) =>
        `  [${ep.kind}] ${ep.file_path}::${ep.name}${ep.method ? ` ${ep.method}` : ''}${ep.route_pattern ? ` ${ep.route_pattern}` : ''}`,
      ).join('\n')
    : '  (none detected)'}

SIDE EFFECTS (external writes/calls the system makes):
${sideEffects.length > 0
    ? sideEffects.map((se) =>
        `  [${se.kind}] ${se.file_path}${se.target ? ` → ${se.target}` : ''}`,
      ).join('\n')
    : '  (none detected)'}

END-TO-END WORKFLOWS (traced from entrypoints to side effects):
${workflowsList}

CRITICAL RANKINGS (files ranked by importance algorithm — use these as primary references):
${criticalRankings.length > 0
    ? criticalRankings.map((r) =>
        `  ${r.file_path}${r.name ? `::${r.name}` : ''} score:${Number(r.composite_score).toFixed(2)} reasons:[${(r.ranking_reasons ?? []).join(', ')}]`,
      ).join('\n')
    : '  (rankings not yet computed)'}`;
}

export const DEFAULT_SECTION_REVIEW_STATUS = 'draft' as const;
