/**
 * Request-flow tutorial generator (doc/Pipeline.md "Request-flow
 * tutorials"): traced real examples, not prose essays. Workflows are
 * selected by critical_for_workflow x role projection; each step carries
 * its code snippet, an LLM explanation citing the step receipt, and
 * file/line identity; the Mermaid diagram is derived deterministically
 * from the trace (sequence, or dataflow for data-heavy workflows).
 */

import { createHash } from 'node:crypto';
import { query } from '../../lib/db.js';
import { mapLimit } from '../../lib/parallel.js';
import type { AiClient } from '../ai/aiClient.js';
import type { DeveloperRole } from '../semantic/projections.js';
import type { ProjectedTarget } from './roleProjection.js';
import { workflowDiagramKind, workflowSequenceDiagram, workflowDataflowDiagram, type DiagramStep } from './diagrams.js';

export const TUTORIAL_PROMPT_VERSION = 'tutorial-v2';
const DEFAULT_MAX_TUTORIALS = 4;
// 1M-context sizing (Track B): fuller step snippets, cheap at flash prices.
const SNIPPET_CAP = 2_400;

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
  /** Of `tutorials`, how many were byte-identical cache clones. */
  cached?: number;
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
      const one = await generateOneTutorial(params, workflow, steps);
      result.tutorials += 1;
      result.steps += steps.length;
      if (one.cached) result.cached = (result.cached ?? 0) + 1;
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
      // Journey-first selection (ONBOARDING_UX_GOALS.md item 4): composed
      // product journeys and the dev-environment journey outrank any
      // route-level workflow of similar score — tutorials teach the flows a
      // team lead would whiteboard, with routes as the drill-down layer.
      const journeyBonus =
        row.trigger_type === 'journey' ? 1
        : row.trigger_type === 'dev_command' ? 0.5
        : 0;
      return {
        row: row as WorkflowRow,
        score: workflowView + (projection?.score ?? 0) + 0.2 * effectRichness + journeyBonus,
        family: workflowFamily(row.trigger_type),
      };
    }),
    max,
  );
}

async function generateOneTutorial(params: GenerateTutorialsParams, workflow: WorkflowRow, steps: StepRow[]): Promise<{ cached: boolean }> {
  // Tutorial cache (same contract as the section cache): keyed on the
  // deterministic inputs — the workflow identity and its traced steps.
  // Unchanged flow ⇒ the previous tutorial is cloned (row + steps +
  // receipts) at zero LLM cost.
  const evidenceHash = createHash('sha256').update(JSON.stringify({
    v: TUTORIAL_PROMPT_VERSION,
    workflow: workflow.stable_key,
    title: workflow.title,
    trigger: workflow.trigger_type,
    purpose: workflow.purpose,
    steps: steps.map((s) => [s.step_order, s.file_path, s.symbol_name, s.step_kind,
      s.line_start, s.line_end, s.deterministic_description, (s.snippet ?? '').slice(0, SNIPPET_CAP)]),
  })).digest('hex');
  const cachedTutorial = (await query(
    `SELECT t.id FROM tutorials t
     JOIN analysis_snapshots s ON s.id = t.snapshot_id
     WHERE s.project_id = $1 AND t.stable_key = $2
       AND t.generation_context->>'evidence_hash' = $3
       AND t.status IN ('draft', 'approved')
     ORDER BY t.created_at DESC LIMIT 1`,
    [params.projectId, `tut:${workflow.stable_key}`, evidenceHash],
  )).rows[0] as { id: string } | undefined;
  if (cachedTutorial) {
    await cloneTutorial(params, workflow, cachedTutorial.id, evidenceHash);
    return { cached: true };
  }

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
    maxOutputTokens: 8_000,
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
     JSON.stringify({ prompt_version: TUTORIAL_PROMPT_VERSION, workflow: workflow.stable_key, goal: output.goal ?? '', evidence_hash: evidenceHash })],
  )).rows[0] as { id: string }).id;

  if (steps.length === 0) return { cached: false };

  // Bulk step persistence (Track C): 3 statements per tutorial instead of
  // 3 per STEP (~21 steps × 3 = 63 round trips each before).
  const stepValues: unknown[] = [];
  const stepTuples = steps.map((step, i) => {
    stepValues.push(
      tutorialId, step.step_order, step.node_id, step.file_path, step.symbol_name,
      step.line_start, step.line_end, step.snippet?.slice(0, SNIPPET_CAP) ?? null,
      explanationByOrder.get(step.step_order) ?? '',
      JSON.stringify({ stepKind: step.step_kind }),
    );
    const base = i * 10;
    return `(${Array.from({ length: 10 }, (_, j) => `$${base + j + 1}`).join(', ')})`;
  });
  const stepRows = (await query(
    `INSERT INTO tutorial_steps
       (tutorial_id, step_order, node_id, file_path, symbol_name, line_start, line_end, snippet, explanation, metadata)
     VALUES ${stepTuples.join(', ')}
     RETURNING id, step_order`,
    stepValues,
  )).rows as Array<{ id: string; step_order: number }>;
  const stepIdByOrder = new Map(stepRows.map((r) => [r.step_order, r.id]));

  const receiptValues: unknown[] = [];
  const receiptTuples = steps.map((step, i) => {
    receiptValues.push(
      params.projectId, params.snapshotId, stepIdByOrder.get(step.step_order)!, step.node_id,
      workflow.id, step.symbol_name ? `${step.file_path}#${step.symbol_name}` : step.file_path,
      step.node_hash, step.file_path, step.symbol_name, step.line_start, step.line_end,
      step.snippet?.slice(0, SNIPPET_CAP) ?? null, params.commitHash,
    );
    const base = i * 13;
    return `($${base + 1}, $${base + 2}, 'workflow_step', 'code', $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`;
  });
  const receiptRows = (await query(
    `INSERT INTO source_receipts
       (project_id, snapshot_id, receipt_kind, trust_level, tutorial_step_id, node_id,
        workflow_id, node_stable_key, node_hash, file_path, symbol_name, line_start,
        line_end, snippet, commit_hash)
     VALUES ${receiptTuples.join(', ')}
     RETURNING id, tutorial_step_id`,
    receiptValues,
  )).rows as Array<{ id: string; tutorial_step_id: string }>;

  await query(
    `UPDATE tutorial_steps ts
     SET receipt_ids = ARRAY[u.receipt_id]::uuid[]
     FROM jsonb_to_recordset($1::jsonb) AS u(step_id uuid, receipt_id uuid)
     WHERE ts.id = u.step_id`,
    [JSON.stringify(receiptRows.map((r) => ({ step_id: r.tutorial_step_id, receipt_id: r.id })))],
  );
  return { cached: false };
}

/** Cache hit: clone the tutorial row, its steps, and their receipts. */
async function cloneTutorial(
  params: GenerateTutorialsParams,
  workflow: WorkflowRow,
  sourceTutorialId: string,
  evidenceHash: string,
): Promise<void> {
  const stableKey = `tut:${workflow.stable_key}`;
  // Same-package hit: the source row already IS this package's tutorial —
  // cloning would trip the (package_id, stable_key) unique index, and
  // deleting first destroys the source (both observed live). Keep the row,
  // stamp it as a cache hit.
  const source = (await query(
    `SELECT package_id FROM tutorials WHERE id = $1`,
    [sourceTutorialId],
  )).rows[0] as { package_id: string | null } | undefined;
  if (source?.package_id === params.packageId) {
    await query(
      `UPDATE tutorials
       SET generation_context = generation_context || jsonb_build_object('mode', 'cache_hit', 'evidence_hash', $2::text),
           workflow_id = $3, updated_at = now()
       WHERE id = $1`,
      [sourceTutorialId, evidenceHash, workflow.id],
    );
    return;
  }
  // Cross-package reuse: this package holds no row for the key (or an old
  // one, removed first — the source lives elsewhere and stays safe).
  await query(`DELETE FROM tutorials WHERE package_id = $1 AND stable_key = $2`, [params.packageId, stableKey]);
  const newId = ((await query(
    `INSERT INTO tutorials
       (snapshot_id, package_id, workflow_id, generation_run_id, stable_key, title, summary,
        diagram_kind, diagram_mermaid, status, confidence, unknowns, generation_context)
     SELECT $2, $3, $4, NULL, stable_key, title, summary,
            diagram_kind, diagram_mermaid, 'draft', confidence, unknowns,
            generation_context || jsonb_build_object('mode', 'cache_hit', 'cached_from_tutorial_id', id, 'evidence_hash', $5::text)
     FROM tutorials WHERE id = $1
     RETURNING id`,
    [sourceTutorialId, params.snapshotId, params.packageId, workflow.id, evidenceHash],
  )).rows[0] as { id: string }).id;

  await query(
    `INSERT INTO tutorial_steps
       (tutorial_id, step_order, node_id, file_path, symbol_name, line_start, line_end, snippet, explanation, metadata)
     SELECT $2, step_order, node_id, file_path, symbol_name, line_start, line_end, snippet, explanation, metadata
     FROM tutorial_steps WHERE tutorial_id = $1`,
    [sourceTutorialId, newId],
  );

  const clonedReceipts = (await query(
    `INSERT INTO source_receipts
       (project_id, snapshot_id, receipt_kind, trust_level, tutorial_step_id, node_id,
        workflow_id, node_stable_key, node_hash, file_path, symbol_name, line_start,
        line_end, snippet, commit_hash, metadata)
     SELECT sr.project_id, sr.snapshot_id, sr.receipt_kind, sr.trust_level, ns.id, sr.node_id,
            $3, sr.node_stable_key, sr.node_hash, sr.file_path, sr.symbol_name, sr.line_start,
            sr.line_end, sr.snippet, sr.commit_hash, sr.metadata
     FROM source_receipts sr
     JOIN tutorial_steps os ON os.id = sr.tutorial_step_id AND os.tutorial_id = $1
     JOIN tutorial_steps ns ON ns.tutorial_id = $2 AND ns.step_order = os.step_order
     RETURNING id, tutorial_step_id`,
    [sourceTutorialId, newId, workflow.id],
  )).rows as Array<{ id: string; tutorial_step_id: string }>;
  if (clonedReceipts.length > 0) {
    await query(
      `UPDATE tutorial_steps ts
       SET receipt_ids = ARRAY[u.receipt_id]::uuid[]
       FROM jsonb_to_recordset($1::jsonb) AS u(step_id uuid, receipt_id uuid)
       WHERE ts.id = u.step_id`,
      [JSON.stringify(clonedReceipts.map((r) => ({ step_id: r.tutorial_step_id, receipt_id: r.id })))],
    );
  }

}

function isControlError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'AiPausedError' || name === 'KillSwitchError' || name === 'BudgetExceededError' || name === 'AiDisabledError';
}
