import type { FileAnalysis, DependencyGraph } from '../types/analysis.js';
import type { DetectedEntrypoint } from './entrypointDetector.js';
import type { DetectedSideEffect } from './sideEffectDetector.js';
import { query } from '../../lib/db.js';

export interface ExtractedWorkflow {
  title: string;
  triggerType: string;
  purpose: string;
  stableKey: string;
  importanceScore: number;
  confidence: 'high' | 'medium' | 'low';
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  stepOrder: number;
  filePath: string;
  symbolName?: string;
  lineStart?: number;
  lineEnd?: number;
  stepKind: string;
  deterministicDescription: string;
}

export function extractWorkflows(
  fileAnalyses: FileAnalysis[],
  graph: DependencyGraph,
  entrypoints: DetectedEntrypoint[],
  sideEffects: DetectedSideEffect[],
): ExtractedWorkflow[] {
  const workflows: ExtractedWorkflow[] = [];

  const edgeIndex = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const existing = edgeIndex.get(edge.source) ?? [];
    existing.push(edge.target);
    edgeIndex.set(edge.source, existing);
  }

  const sideEffectsByFile = new Map<string, DetectedSideEffect[]>();
  for (const se of sideEffects) {
    const existing = sideEffectsByFile.get(se.nodeStableKey) ?? [];
    existing.push(se);
    sideEffectsByFile.set(se.nodeStableKey, existing);
  }

  for (const ep of entrypoints) {
    const visited = new Set<string>();
    const steps: WorkflowStep[] = [];
    const queue = [ep.nodeStableKey];
    let stepOrder = 0;

    while (queue.length > 0 && steps.length < 15) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      stepOrder++;
      const effects = sideEffectsByFile.get(current) ?? [];
      const stepKind = stepOrder === 1
        ? 'trigger'
        : effects.length > 0
          ? effects[0]!.kind === 'database_write' ? 'data_write' : 'side_effect'
          : 'validation';

      const fa = fileAnalyses.find((f) => f.relativePath === current);
      const mainSymbol = fa?.symbols.find((s) => s.exported && (s.kind === 'function' || s.kind === 'arrow-function'));

      steps.push({
        stepOrder,
        filePath: current,
        symbolName: ep.symbolName ?? mainSymbol?.name,
        lineStart: mainSymbol?.start?.line,
        lineEnd: mainSymbol?.end?.line,
        stepKind,
        deterministicDescription: buildStepDescription(current, stepKind, effects),
      });

      const dependencies = edgeIndex.get(current) ?? [];
      for (const dep of dependencies.slice(0, 5)) {
        if (!visited.has(dep)) queue.push(dep);
      }
    }

    if (steps.length >= 1) {
      const method = ep.method ?? ep.kind;
      const title = `${method} ${ep.symbolName ?? ep.filePath}`;
      workflows.push({
        title,
        triggerType: ep.kind === 'http_route' ? `HTTP ${ep.method ?? 'handler'}` : ep.kind,
        purpose: `Handles ${ep.kind.replace(/_/g, ' ')} in ${ep.filePath}`,
        stableKey: `wf:${ep.nodeStableKey}:${ep.symbolName ?? 'main'}`,
        importanceScore: steps.length * 0.1 + (sideEffectsByFile.get(ep.nodeStableKey)?.length ?? 0) * 0.2,
        confidence: steps.length >= 4 ? 'high' : steps.length >= 2 ? 'medium' : 'low',
        steps,
      });
    }
  }

  return workflows.sort((a, b) => b.importanceScore - a.importanceScore);
}

function buildStepDescription(filePath: string, stepKind: string, effects: DetectedSideEffect[]): string {
  switch (stepKind) {
    case 'trigger':
      return `Entry point: request enters via ${filePath}`;
    case 'data_write':
      return `Persists data: ${effects.map((e) => e.kind).join(', ')} in ${filePath}`;
    case 'side_effect':
      return `Side effect: ${effects.map((e) => e.kind).join(', ')} in ${filePath}`;
    default:
      return `Processes logic in ${filePath}`;
  }
}

export async function persistWorkflows(
  snapshotId: string,
  workflows: ExtractedWorkflow[],
  nodeIdMap: Map<string, string>,
): Promise<void> {
  for (const wf of workflows) {
    // importance_score lives in metadata: real ranking is criticality_scores
    // rows (phase='candidate'), this is only the extractor's raw ordering hint
    const wfResult = await query(
      `INSERT INTO workflows (snapshot_id, title, trigger_type, purpose, confidence, stable_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (snapshot_id, stable_key) DO UPDATE
         SET title = EXCLUDED.title, trigger_type = EXCLUDED.trigger_type,
             purpose = EXCLUDED.purpose, confidence = EXCLUDED.confidence,
             metadata = EXCLUDED.metadata
       RETURNING id`,
      [snapshotId, wf.title, wf.triggerType, wf.purpose, wf.confidence, wf.stableKey,
       JSON.stringify({ importance_score: wf.importanceScore })],
    );

    if (wfResult.rows.length === 0) continue;
    const workflowId = wfResult.rows[0].id as string;

    // Clear old steps in case this is an upsert
    await query(`DELETE FROM workflow_steps WHERE workflow_id = $1`, [workflowId]);

    for (const step of wf.steps) {
      const nodeId = nodeIdMap.get(step.filePath) ?? null;
      await query(
        `INSERT INTO workflow_steps
           (workflow_id, step_order, node_id, file_path, symbol_name, line_start, line_end, step_kind, deterministic_description, role_relevance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          workflowId,
          step.stepOrder,
          nodeId,
          step.filePath,
          step.symbolName ?? null,
          step.lineStart ?? null,
          step.lineEnd ?? null,
          step.stepKind,
          step.deterministicDescription,
          '{}',
        ],
      );
    }
  }
}
