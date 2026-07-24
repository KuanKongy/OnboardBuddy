/**
 * Request-flow tutorial generator (doc/Pipeline.md "Request-flow
 * tutorials"): traced real examples, not prose essays. Workflows are
 * selected by critical_for_workflow x role projection; each step carries
 * its code snippet, an LLM explanation citing the step receipt, and
 * file/line identity; the Mermaid diagram is derived deterministically
 * from the trace (sequence, or dataflow for data-heavy workflows).
 */

import { query } from '../../lib/db.js';
import { mapLimit } from '../../lib/parallel.js';
import type { AiClient } from '../ai/aiClient.js';
import type { DeveloperRole } from '../semantic/projections.js';
import type { ProjectedTarget } from './roleProjection.js';
import { workflowDiagramKind, workflowSequenceDiagram, workflowDataflowDiagram, type DiagramStep } from './diagrams.js';

export const TUTORIAL_PROMPT_VERSION = 'tutorial-v2';
const DEFAULT_MAX_TUTORIALS = 4;
const SNIPPET_CAP = 1_200;

export interface GenerateTutorialsParams {
  ai: AiClient;
  snapshotId: string;
  projectId: string;
  packageId: string;
  role: DeveloperRole;
  commitHash: string;
  projections: ProjectedTarget[];
  maxTutorials?: number;
}

export interface TutorialResult {
  tutorials: number;
  steps: number;
  failed: number;
}

interface WorkflowRow {
  id: string;
  stable_key: string;
  title: string;
  trigger_type: string;
  purpose: string;
}

interface StepRow {
  id: string;
  step_order: number;
  node_id: string | null;
  file_path: string;
  symbol_name: string | null;
  line_start: number | null;
  line_end: number | null;
  step_kind: string | null;
  deterministic_description: string;
  snippet: string | null;
  node_hash: string | null;
  record_summary: string | null;
}

const TUTORIAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['goal', 'title', 'summary', 'confidence', 'steps'],
  properties: {
    goal: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step_order', 'explanation'],
        properties: { step_order: { type: 'integer' }, explanation: { type: 'string' } },
      },
    },
  },
};

export async function generateTutorials(params: GenerateTutorialsParams): Promise<TutorialResult> {
  const result: TutorialResult = { tutorials: 0, steps: 0, failed: 0 };
  const workflows = await selectWorkflows(params);

  await mapLimit(workflows, 4, async (workflow) => {
    const steps = (await query(
      `SELECT ws.id, ws.step_order, ws.node_id, ws.file_path, ws.symbol_name, ws.line_start,
              ws.line_end, ws.step_kind, ws.deterministic_description,
              n.snippet, n.hash AS node_hash, sr.summary AS record_summary
       FROM workflow_steps ws
       LEFT JOIN graph_nodes n ON n.id = ws.node_id
       LEFT JOIN snapshot_semantic_records ssr
         ON ssr.snapshot_id = $2 AND ssr.node_id = ws.node_id AND ssr.record_level = 'symbol'
       LEFT JOIN semantic_records sr ON sr.id = ssr.record_id
       WHERE ws.workflow_id = $1 ORDER BY ws.step_order`,
      [workflow.id, params.snapshotId],
    )).rows as StepRow[];
    if (steps.length === 0) return;

    try {
      await generateOneTutorial(params, workflow, steps);
      result.tutorials += 1;
      result.steps += steps.length;
    } catch (err) {
      if (isControlError(err)) throw err;
      result.failed += 1;
      console.warn(`[tutorialGenerator] failed for ${workflow.stable_key}:`, err instanceof Error ? err.message : err);
    }
  });
  return result;
}

/** Trigger family for diversity capping: trivial-read families are capped. */
export function workflowFamily(triggerType: string): string {
  if (triggerType === 'HTTP GET') return 'read_route';
  if (triggerType === 'UI page') return 'ui';
  if (triggerType.startsWith('HTTP ')) return 'write_route';
  return triggerType;
}

/**
 * Selection = criticality x side-effect richness x layer diversity (audit
 * §5.3): pure score-order used to fill every tutorial slot with trivial
 * GETs and page renders while the flows that write, enqueue, and cross
 * layers — the ones a contributor must understand — never made the cut.
 * Read-only families are capped at two slots; leftovers backfill by score.
 */
export function pickDiverseWorkflows<T>(
  scored: Array<{ row: T; score: number; family: string }>,
  max: number,
): T[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const CAPPED_FAMILIES = new Set(['read_route', 'ui']);
  const CAP = 2;
  const picked: typeof sorted = [];
  const familyCount = new Map<string, number>();
  for (const entry of sorted) {
    if (picked.length >= max) break;
    const n = familyCount.get(entry.family) ?? 0;
    if (CAPPED_FAMILIES.has(entry.family) && n >= CAP) continue;
    familyCount.set(entry.family, n + 1);
    picked.push(entry);
  }
  for (const entry of sorted) {
    if (picked.length >= max) break;
    if (!picked.includes(entry)) picked.push(entry);
  }
  return picked.map((e) => e.row);
}

/** Top workflows by critical_for_workflow blended with the role projection. */
async function selectWorkflows(params: GenerateTutorialsParams): Promise<WorkflowRow[]> {
  const max = params.maxTutorials ?? DEFAULT_MAX_TUTORIALS;
  const projectionByKey = new Map(
    params.projections.filter((p) => p.targetType === 'workflow').map((p) => [p.stableKey, p]),
  );
  const rows = (await query(
    `SELECT w.id, w.stable_key, w.title, w.trigger_type, w.purpose,
            (SELECT count(*)::int FROM workflow_steps ws WHERE ws.workflow_id = w.id) AS step_count,
            (SELECT count(*)::int FROM workflow_steps ws WHERE ws.workflow_id = w.id
              AND ws.step_kind IN ('data_write', 'async_work', 'side_effect')) AS effect_steps
     FROM workflows w WHERE w.snapshot_id = $1`,
    [params.snapshotId],
  )).rows as Array<WorkflowRow & { step_count: number; effect_steps: number }>;
  return pickDiverseWorkflows(
    rows.map((row) => {
      const projection = projectionByKey.get(row.stable_key);
      const workflowView = projection?.viewScores.critical_for_workflow ?? 0;
      const effectRichness = row.effect_steps / Math.max(row.step_count, 1);
      return {
        row: row as WorkflowRow,
        score: workflowView + (projection?.score ?? 0) + 0.2 * effectRichness,
        family: workflowFamily(row.trigger_type),
      };
    }),
    max,
  );
}

async function generateOneTutorial(params: GenerateTutorialsParams, workflow: WorkflowRow, steps: StepRow[]): Promise<void> {
  const stepSections = steps.map((s) => [
    `### Step ${s.step_order} (receipt s${s.step_order})`,
    `${s.file_path}${s.symbol_name ? `::${s.symbol_name}` : ''}${s.line_start ? ` (L${s.line_start}-${s.line_end})` : ''} [${s.step_kind ?? 'step'}]`,
    `Deterministic: ${s.deterministic_description}`,
    s.record_summary ? `Record: ${s.record_summary.slice(0, 200)}` : null,
    s.snippet ? '```\n' + s.snippet.slice(0, SNIPPET_CAP) + '\n```' : '(no snippet available)',
  ].filter(Boolean).join('\n'));

  const prompt = [
    `You are writing a code-reading tutorial for a developer new to this repo. The tutorial walks the workflow "${workflow.title}" (${workflow.trigger_type}; purpose: ${workflow.purpose}) step by step, with the reader looking at each step's code alongside your explanation.`,
    [
      'Produce:',
      '- goal: ONE sentence of the form "After this tutorial, you can …" naming the concrete skill the reader gains (trace / change / debug this specific flow).',
      '- title: imperative and specific to this flow, at most 8 words (e.g. "Trace a login request to the database").',
      '- summary: 1-2 plain-language sentences on what the flow does end to end.',
      '- steps: for EACH traced step, an explanation of AT MOST 3 short sentences that (1) names identifiers actually visible in the snippet (function, route, table, queue), (2) says what this step contributes to the flow — why it sits between its neighbors, and (3) if non-obvious, points at the one line or branch worth reading closely.',
    ].join('\n'),
    'Hard rules: the reader sees the code next to your text, so never restate it line by line. No filler ("this is important", "as we can see", "simply", "essentially"). No sentence that could apply to any codebase. Stay grounded in the snippet and deterministic description (the receipt); write "unknown" rather than guessing.',
    stepSections.join('\n\n'),
  ].join('\n\n');

  const response = await params.ai.call<{ goal: string; title: string; summary: string; confidence: 'high' | 'medium' | 'low'; steps: Array<{ step_order: number; explanation: string }> }>({
    tier: 'strong',
    targetType: 'tutorial',
    packageId: params.packageId,
    promptVersion: TUTORIAL_PROMPT_VERSION,
    schemaName: 'tutorial',
    schema: TUTORIAL_SCHEMA,
    user: prompt,
  });
  const output = response.value!;
  const explanationByOrder = new Map(output.steps.map((s) => [s.step_order, s.explanation]));

  // Validation (tutorial flavor): every traced step needs an explanation;
  // missing ones become honest unknowns and cap confidence at medium.
  const unknowns: Array<{ kind: string; detail: string }> = [];
  for (const step of steps) {
    if (!explanationByOrder.get(step.step_order)?.trim()) {
      unknowns.push({ kind: 'unexplained_step', detail: `step ${step.step_order} (${step.file_path})` });
    }
  }
  const confidence = unknowns.length > 0 && output.confidence === 'high' ? 'medium' : output.confidence;

  const diagramSteps: DiagramStep[] = steps.map((s) => ({
    stepOrder: s.step_order, filePath: s.file_path, symbolName: s.symbol_name,
    stepKind: s.step_kind, description: s.deterministic_description,
  }));
  const diagramKind = workflowDiagramKind(diagramSteps);
  const mermaid = diagramKind === 'dataflow'
    ? workflowDataflowDiagram(workflow.title, diagramSteps)
    : workflowSequenceDiagram(workflow.title, diagramSteps);

  // Replace this package's previous tutorial for the workflow.
  const stableKey = `tut:${workflow.stable_key}`;
  await query(`DELETE FROM tutorials WHERE package_id = $1 AND stable_key = $2`, [params.packageId, stableKey]);
  const tutorialId = ((await query(
    `INSERT INTO tutorials
       (snapshot_id, package_id, workflow_id, generation_run_id, stable_key, title, summary,
        diagram_kind, diagram_mermaid, status, confidence, unknowns, generation_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12)
     RETURNING id`,
    [params.snapshotId, params.packageId, workflow.id, response.runId, stableKey,
     output.title || workflow.title, output.summary ?? '', diagramKind, mermaid,
     confidence, JSON.stringify(unknowns),
     JSON.stringify({ prompt_version: TUTORIAL_PROMPT_VERSION, workflow: workflow.stable_key, goal: output.goal ?? '' })],
  )).rows[0] as { id: string }).id;

  for (const step of steps) {
    const stepId = ((await query(
      `INSERT INTO tutorial_steps
         (tutorial_id, step_order, node_id, file_path, symbol_name, line_start, line_end, snippet, explanation, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [tutorialId, step.step_order, step.node_id, step.file_path, step.symbol_name,
       step.line_start, step.line_end, step.snippet?.slice(0, SNIPPET_CAP) ?? null,
       explanationByOrder.get(step.step_order) ?? '',
       JSON.stringify({ stepKind: step.step_kind })],
    )).rows[0] as { id: string }).id;

    // Step receipt: the traced evidence this explanation rests on.
    const receiptId = ((await query(
      `INSERT INTO source_receipts
         (project_id, snapshot_id, receipt_kind, trust_level, tutorial_step_id, node_id,
          workflow_id, node_stable_key, node_hash, file_path, symbol_name, line_start,
          line_end, snippet, commit_hash)
       VALUES ($1, $2, 'workflow_step', 'code', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [params.projectId, params.snapshotId, stepId, step.node_id, workflow.id,
       step.symbol_name ? `${step.file_path}#${step.symbol_name}` : step.file_path,
       step.node_hash, step.file_path, step.symbol_name, step.line_start, step.line_end,
       step.snippet?.slice(0, SNIPPET_CAP) ?? null, params.commitHash],
    )).rows[0] as { id: string }).id;
    await query(`UPDATE tutorial_steps SET receipt_ids = $2 WHERE id = $1`, [stepId, [receiptId]]);
  }
}

function isControlError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'AiPausedError' || name === 'KillSwitchError' || name === 'BudgetExceededError' || name === 'AiDisabledError';
}
