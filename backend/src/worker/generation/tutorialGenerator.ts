/**
 * Tutorials: procedures, not prose.
 *
 * The graded complaint — *"tutorial is not effective, it currently has no
 * difference with writing sections"* — was a statement about this file. It and
 * `sectionGenerator.ts` asked a model for paragraphs about traced steps, so
 * both produced essays and the tab had nothing of its own. Every MasterPokedex
 * tutorial came out as *"Trace the X page UI flow"*: 11-20 cards of *"The
 * `fetchPokemonSpecies` function fetches additional data…"*. That is
 * `traced_flows` chopped into cards.
 *
 * What changed: the shape of a step, and therefore who writes it.
 *
 *   before                          after
 *   ──────────────────────────      ──────────────────────────────────────
 *   one traced step → one card      one PROCEDURE → 3-8 steps
 *   LLM writes the whole card       `tutorialProcedure.ts` computes
 *                                   action / expected / verify from evidence
 *   selection by score              selection by whether a procedure EXISTS
 *   4 tutorials, always             only what the evidence supports; 0 is a
 *                                   valid answer
 *
 * The model now annotates rather than authors: a title, a goal, a summary and
 * at most one sentence of `why` per step, over a skeleton it cannot alter.
 * A step's action, its expected result and its verification come from compose
 * services and their published ports, package scripts, CI jobs, `.env`
 * templates and traced workflow steps with real file+line identity. This is
 * the same division `referenceBackbones.ts` makes for CONSULT tables, applied
 * to the DO chapter's most failure-prone surface.
 *
 * `DEFAULT_MAX_TUTORIALS` is a cap, not a target. When it binds, the number of
 * eligible procedures is recorded and the tab says so; when nothing is
 * eligible, the reasons are recorded per workflow and the tab says *that*.
 */

import { createHash } from 'node:crypto';
import { query } from '../../lib/db.js';
import { mapLimit } from '../../lib/parallel.js';
import type { AiClient } from '../ai/aiClient.js';
import type { DeveloperRole } from '../semantic/projections.js';
import type { ProjectedTarget } from './roleProjection.js';
import { workflowDiagramKind, workflowSequenceDiagram, workflowDataflowDiagram, type DiagramStep } from './diagrams.js';
import { loadConfigFacts } from './referenceBackbones.js';
import { lintExplanation } from './explanationLint.js';
import { repairExplanation } from './sectionGenerator.js';
import {
  attemptRunItProcedure,
  attemptRunTestsProcedure,
  attemptTraceProcedure,
  buildRunEnvironment,
  detectPackageManager,
  lintProcedure,
  type ProcedureDraft,
  type ProcedureSkipReason,
  type ProcedureStep,
  type TestGuard,
  type TraceStep,
} from './tutorialProcedure.js';

/** v3 is the procedural rewrite: a bump here invalidates every v2 essay. */
export const TUTORIAL_PROMPT_VERSION = 'tutorial-v3-procedure';
/** A ceiling on the reader's attention, not a quota to fill. */
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
  /** Mechanical privacy enforcement (doc/Pipeline.md "Privacy modes"): every
   * prompt builder takes the mode as an input. Steps keep their snippets in
   * the DB for the reader either way; only the PROMPT withholds them. */
  privacyMode: 'full_ai' | 'facts_only_ai';
  maxTutorials?: number;
}

/**
 * What the tab needs in order to be honest about what it is showing —
 * including when it is showing nothing.
 */
export interface TutorialSelectionReport {
  /** `DEFAULT_MAX_TUTORIALS`, or the caller's override. */
  cap: number;
  /** Workflows examined. */
  considered: number;
  /** Procedures the evidence actually supported. */
  eligible: number;
  /** Emitted after the cap. */
  emitted: number;
  /** True when real procedures were dropped purely because of the cap. */
  capBinding: boolean;
  byTier: { core: number; supporting: number; surface: number };
  /** Why each rejected workflow could not become a procedure. */
  skipped: Array<{ title: string; reason: ProcedureSkipReason; detail: string }>;
  /** Eligible procedures that lost to the cap. */
  overflow: Array<{ title: string; kind: string }>;
}

export interface TutorialResult {
  tutorials: number;
  steps: number;
  failed: number;
  /** Of `tutorials`, how many were byte-identical cache clones. */
  cached?: number;
  selection?: TutorialSelectionReport;
}

interface WorkflowRow {
  id: string;
  stable_key: string;
  title: string;
  trigger_type: string;
  purpose: string;
  tier: 'core' | 'supporting' | 'surface';
  importance_score: number;
  config_flow: string | null;
  route_path: string | null;
  method: string | null;
  step_count: number;
  effect_steps: number;
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

/** One selected procedure, ready to annotate and persist. */
interface Candidate {
  workflow: WorkflowRow;
  draft: ProcedureDraft;
  /** Traced steps behind the procedure, for the diagram and the evidence hash. */
  traceSteps: StepRow[];
  score: number;
  family: string;
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
        required: ['step_order', 'why'],
        properties: { step_order: { type: 'integer' }, why: { type: 'string' } },
      },
    },
  },
};

export async function generateTutorials(params: GenerateTutorialsParams): Promise<TutorialResult> {
  const { candidates, report } = await selectProcedures(params);
  const result: TutorialResult = { tutorials: 0, steps: 0, failed: 0, selection: report };

  await mapLimit(candidates, 4, async (candidate, index) => {
    try {
      const one = await generateOneTutorial(params, candidate, index, report);
      result.tutorials += 1;
      result.steps += candidate.draft.steps.length;
      if (one.cached) result.cached = (result.cached ?? 0) + 1;
    } catch (err) {
      if (isControlError(err)) throw err;
      result.failed += 1;
      console.warn(`[tutorialGenerator] failed for ${candidate.workflow.stable_key}:`, err instanceof Error ? err.message : err);
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

/** Where a flow sits in the tiered list, as a selection weight. */
const TIER_WEIGHT: Record<WorkflowRow['tier'], number> = { core: 1.2, supporting: 0.6, surface: 0 };

/**
 * Which workflows can become procedures, and which of those fit under the cap.
 *
 * Ordering is deliberate rather than purely numeric: "get it running" and
 * "run the tests" come first because that is the order a newcomer needs them
 * in and because their verifications are the strongest in the set (a service
 * list and an exit status are not matters of opinion). Traced flows follow,
 * ranked by tier — the Phase 3 signal — then role projection, then how much
 * of the procedure the evidence could mechanise.
 *
 * A workflow that yields no procedure is recorded with its reason. That
 * record is the tab's honest empty state.
 */
async function selectProcedures(
  params: GenerateTutorialsParams,
): Promise<{ candidates: Candidate[]; report: TutorialSelectionReport }> {
  const max = params.maxTutorials ?? DEFAULT_MAX_TUTORIALS;
  const facts = await loadConfigFacts(params.snapshotId);
  const env = buildRunEnvironment(facts, await detectRepoPackageManager(params.snapshotId));
  const guards = await loadTestGuards(params.snapshotId);

  const workflows = (await query(
    `SELECT w.id, w.stable_key, w.title, w.trigger_type, w.purpose,
            COALESCE(w.metadata->>'tier', 'supporting') AS tier,
            COALESCE((w.metadata->>'importance_score')::float, 0) AS importance_score,
            w.metadata->>'config_flow' AS config_flow,
            ep.route_path, ep.method,
            (SELECT count(*)::int FROM workflow_steps ws WHERE ws.workflow_id = w.id) AS step_count,
            (SELECT count(*)::int FROM workflow_steps ws WHERE ws.workflow_id = w.id
              AND ws.step_kind IN ('data_write', 'async_work', 'side_effect')) AS effect_steps
     FROM workflows w
     LEFT JOIN entrypoints ep ON ep.id = w.entrypoint_id
     WHERE w.snapshot_id = $1`,
    [params.snapshotId],
  )).rows as Array<Partial<WorkflowRow> & { id: string; stable_key: string; title: string }>;

  const rows: WorkflowRow[] = workflows.map((w) => ({
    id: w.id,
    stable_key: w.stable_key,
    title: w.title,
    trigger_type: w.trigger_type ?? 'unknown',
    purpose: w.purpose ?? '',
    tier: (w.tier as WorkflowRow['tier']) ?? 'supporting',
    importance_score: Number(w.importance_score ?? 0),
    config_flow: w.config_flow ?? null,
    route_path: w.route_path ?? null,
    method: w.method ?? null,
    step_count: Number(w.step_count ?? 0),
    effect_steps: Number(w.effect_steps ?? 0),
  }));

  const report: TutorialSelectionReport = {
    cap: max,
    considered: rows.length,
    eligible: 0,
    emitted: 0,
    capBinding: false,
    byTier: {
      core: rows.filter((r) => r.tier === 'core').length,
      supporting: rows.filter((r) => r.tier === 'supporting').length,
      surface: rows.filter((r) => r.tier === 'surface').length,
    },
    skipped: [],
    overflow: [],
  };

  const projectionByKey = new Map(
    params.projections.filter((p) => p.targetType === 'workflow').map((p) => [p.stableKey, p]),
  );

  const setup: Candidate[] = [];
  const traces: Array<{ row: Candidate; score: number; family: string }> = [];

  for (const row of rows) {
    // A `surface` flow has no traced effects, so there is no line worth
    // marking and no result to confirm. Recorded, not silently dropped.
    if (row.tier === 'surface') {
      report.skipped.push({
        title: row.title,
        reason: 'surface_tier_no_traced_effects',
        detail: `"${row.title}" is a real entry point, but nothing was traced from it — no procedure can be built on an empty trace.`,
      });
      continue;
    }

    if (row.config_flow === 'compose_up') {
      const attempt = attemptRunItProcedure(env, facts);
      if (attempt.ok) setup.push({ workflow: row, draft: attempt.draft, traceSteps: [], score: 1_000, family: 'dev_command' });
      else report.skipped.push({ title: row.title, ...attempt.skip });
      continue;
    }
    if (row.config_flow === 'compose_test' || row.trigger_type === 'ci_pipeline') {
      // One "run the tests" procedure is enough; a repo with both a test
      // compose and a CI file would otherwise get the same steps twice.
      if (setup.some((c) => c.draft.kind === 'run_tests')) continue;
      const attempt = attemptRunTestsProcedure(env, facts, guards);
      if (attempt.ok) setup.push({ workflow: row, draft: attempt.draft, traceSteps: [], score: 900, family: 'dev_command' });
      else report.skipped.push({ title: row.title, ...attempt.skip });
      continue;
    }
    if (row.config_flow) continue; // another config journey; not a procedure

    const steps = await loadWorkflowSteps(params.snapshotId, row.id);
    if (steps.length === 0) {
      report.skipped.push({ title: row.title, reason: 'too_few_steps', detail: `"${row.title}" has no persisted steps.` });
      continue;
    }
    const attempt = attemptTraceProcedure(
      {
        title: row.title,
        purpose: row.purpose,
        tier: row.tier,
        triggerType: row.trigger_type,
        routePath: row.route_path,
        httpMethod: row.method,
        steps: steps.map(toTraceStep),
        coveringTests: guards.filter((g) => steps.some((s) => g.covers === s.symbol_name)).map((g) => g.testFile),
      },
      env,
    );
    if (!attempt.ok) {
      report.skipped.push({ title: row.title, ...attempt.skip });
      continue;
    }

    const projection = projectionByKey.get(row.stable_key);
    const mechanised = attempt.draft.steps.filter((s) => s.verifyCommand).length / attempt.draft.steps.length;
    traces.push({
      row: { workflow: row, draft: attempt.draft, traceSteps: steps, score: 0, family: workflowFamily(row.trigger_type) },
      // Tier first (Phase 3's ranking signal), then role fit, then how much of
      // the procedure the reader can actually check by running something.
      score:
        TIER_WEIGHT[row.tier] +
        row.importance_score +
        (projection?.viewScores.critical_for_workflow ?? 0) +
        (projection?.score ?? 0) +
        0.4 * mechanised,
      family: workflowFamily(row.trigger_type),
    });
  }

  report.eligible = setup.length + traces.length;
  const traceSlots = Math.max(0, max - setup.length);
  const pickedTraces = pickDiverseWorkflows(traces, traceSlots);
  const candidates = [...setup, ...pickedTraces].slice(0, max).map((c, i) => ({ ...c, score: 1_000 - i }));

  report.emitted = candidates.length;
  report.capBinding = report.eligible > candidates.length;
  const emittedKeys = new Set(candidates.map((c) => c.workflow.stable_key));
  report.overflow = [...setup, ...traces.map((t) => t.row)]
    .filter((c) => !emittedKeys.has(c.workflow.stable_key))
    .map((c) => ({ title: c.workflow.title, kind: c.draft.kind }));

  return { candidates, report };
}

async function loadWorkflowSteps(snapshotId: string, workflowId: string): Promise<StepRow[]> {
  return (await query(
    `SELECT ws.id, ws.step_order, ws.node_id, ws.file_path, ws.symbol_name, ws.line_start,
            ws.line_end, ws.step_kind, ws.deterministic_description,
            n.snippet, n.hash AS node_hash, sr.summary AS record_summary
     FROM workflow_steps ws
     LEFT JOIN graph_nodes n ON n.id = ws.node_id
     LEFT JOIN snapshot_semantic_records ssr
       ON ssr.snapshot_id = $2 AND ssr.node_id = ws.node_id AND ssr.record_level = 'symbol'
     LEFT JOIN semantic_records sr ON sr.id = ssr.record_id
     WHERE ws.workflow_id = $1 ORDER BY ws.step_order`,
    [workflowId, snapshotId],
  )).rows as StepRow[];
}

const toTraceStep = (s: StepRow): TraceStep => ({
  order: s.step_order,
  filePath: s.file_path,
  symbolName: s.symbol_name,
  lineStart: s.line_start,
  lineEnd: s.line_end,
  stepKind: s.step_kind,
  description: s.deterministic_description,
  nodeId: s.node_id,
  nodeHash: s.node_hash,
  snippet: s.snippet,
});

/** Lockfile → package manager, so a printed command is the one that works here. */
async function detectRepoPackageManager(snapshotId: string): Promise<ReturnType<typeof detectPackageManager>> {
  const rows = (await query(
    `SELECT file_path FROM repository_files
     WHERE snapshot_id = $1 AND file_path ~ '(^|/)(pnpm-lock\\.yaml|yarn\\.lock|bun\\.lockb?|package-lock\\.json)$'
     ORDER BY length(file_path) LIMIT 8`,
    [snapshotId],
  )).rows as Array<{ file_path: string }>;
  return detectPackageManager(rows.map((r) => r.file_path));
}

/** `tests` edges: which test file guards which symbol. A named test is a fact. */
async function loadTestGuards(snapshotId: string): Promise<TestGuard[]> {
  const rows = (await query(
    `SELECT sn.file_path AS test_file, COALESCE(tn.name, tn.file_path) AS covers
     FROM graph_edges e
     JOIN graph_nodes sn ON sn.id = e.source_node_id
     JOIN graph_nodes tn ON tn.id = e.target_node_id
     WHERE e.snapshot_id = $1 AND e.type = 'tests'
     LIMIT 40`,
    [snapshotId],
  )).rows as Array<{ test_file: string; covers: string }>;
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.test_file}|${r.covers}`;
    if (seen.has(key) || !r.test_file || !r.covers) return false;
    seen.add(key);
    return true;
  }).map((r) => ({ testFile: r.test_file, covers: r.covers }));
}

// ── one tutorial ────────────────────────────────────────────────────────────

async function generateOneTutorial(
  params: GenerateTutorialsParams,
  candidate: Candidate,
  rank: number,
  report: TutorialSelectionReport,
): Promise<{ cached: boolean }> {
  const { workflow, draft } = candidate;
  // Tutorial cache (same contract as the section cache): keyed on the
  // deterministic inputs — here, the PROCEDURE itself. The skeleton is
  // computed from evidence, so hashing it covers the workflow, its steps and
  // every command/port/path the procedure names in one go.
  // privacyMode is part of the key: the prompt differs by mode, so a
  // facts-only run must not clone a tutorial that was annotated WITH the code
  // in front of the model (and vice versa). Without it, switching the setting
  // produced a byte-identical package and looked like the setting did nothing.
  const evidenceHash = createHash('sha256').update(JSON.stringify({
    v: TUTORIAL_PROMPT_VERSION,
    privacy: params.privacyMode,
    workflow: workflow.stable_key,
    kind: draft.kind,
    gaps: draft.gaps,
    steps: draft.steps.map((s) => [s.order, s.kind, s.action, s.command ?? '', s.filePath,
      s.lineStart, s.expected, s.verify, s.verifyCommand ?? '',
      (s.snippet ?? '').slice(0, SNIPPET_CAP)]),
  })).digest('hex');
  // Quality gate on reuse, same contract as the section cache — the cache must
  // never immortalize a bad run. This matters here for a specific reason: the
  // tutorial row is INSERTed with its evidence_hash before its steps are, so a
  // process death between those two statements leaves a hash-bearing row with
  // zero steps (the section cache gained its gate after exactly this crash
  // window cloned an EMPTY section forward on every regeneration). Without the
  // `EXISTS` check, that step-less tutorial would be cloned forward for as long
  // as the flow stayed unchanged, and `result.steps` would count steps that do
  // not exist.
  const cachedTutorial = (await query(
    `SELECT t.id FROM tutorials t
     JOIN analysis_snapshots s ON s.id = t.snapshot_id
     WHERE s.project_id = $1 AND t.stable_key = $2
       AND t.generation_context->>'evidence_hash' = $3
       AND t.status IN ('draft', 'approved')
       AND t.confidence IN ('high', 'medium')
       AND length(COALESCE(t.summary, '')) >= 80
       AND EXISTS (SELECT 1 FROM tutorial_steps ts WHERE ts.tutorial_id = t.id)
     ORDER BY t.created_at DESC LIMIT 1`,
    [params.projectId, `tut:${workflow.stable_key}`, evidenceHash],
  )).rows[0] as { id: string } | undefined;
  if (cachedTutorial) {
    await cloneTutorial(params, workflow, cachedTutorial.id, evidenceHash, rank);
    return { cached: true };
  }

  const output = await annotateProcedure(params, candidate);
  const lint = lintAnnotation(candidate, output, workflow.title);
  const procedureFindings = lintProcedure(draft);

  const unknowns: Array<{ kind: string; detail: string }> = [
    ...draft.gaps.map((g) => ({ kind: g.kind, detail: g.detail })),
    ...procedureFindings.map((f) => ({ kind: `step_${f.code}`, detail: `step ${f.stepOrder}: ${f.detail}` })),
  ];
  if (report.capBinding && rank === 0) {
    unknowns.push({
      kind: 'tutorial_cap_reached',
      detail: `${report.eligible} procedures could be built from this repository; the ${report.cap} strongest are shown. The rest are listed on this tab.`,
    });
  }
  // Never "high" when the machine found a hole in the procedure or the prose.
  const confidence =
    procedureFindings.length > 0 || lint.issues.length > 0
      ? (output.confidence === 'high' ? 'medium' : output.confidence)
      : output.confidence;

  const diagramSteps: DiagramStep[] = (candidate.traceSteps.length > 0 ? candidate.traceSteps.map((s) => ({
    stepOrder: s.step_order, filePath: s.file_path, symbolName: s.symbol_name,
    stepKind: s.step_kind, description: s.deterministic_description,
  })) : draft.steps.map((s) => ({
    stepOrder: s.order, filePath: s.filePath, symbolName: s.symbolName ?? null,
    stepKind: s.kind, description: s.action,
  })));
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
    [params.snapshotId, params.packageId, workflow.id, output.runId, stableKey,
     // The setup procedures name themselves exactly ("Bring the stack up and
     // confirm it answers"); there is nothing for a model to improve and a
     // drifting title on the tab's first entry is the worst place for one.
     // A traced flow's title carries the flow's own name, so the model's
     // phrasing earns its keep there.
     (draft.kind === 'trace_flow' ? output.title : '') || draft.title,
     output.summary ?? '', diagramKind, mermaid,
     confidence, JSON.stringify(unknowns),
     JSON.stringify({
       prompt_version: TUTORIAL_PROMPT_VERSION,
       workflow: workflow.stable_key,
       goal: output.goal ?? '',
       evidence_hash: evidenceHash,
       procedure_kind: draft.kind,
       rank,
       selection: report,
       procedure_lint: procedureFindings.map((f) => `${f.stepOrder}:${f.code}`),
       explanation_lint: lint.hits,
     })],
  )).rows[0] as { id: string }).id;

  await persistSteps(params, tutorialId, workflow, draft.steps, output.whyByOrder);
  return { cached: false };
}

/**
 * Persist the procedure. `metadata` carries the parts the schema has no column
 * for — action, command, expected, verify — which is what makes this a
 * migration-free change: `tutorial_steps.metadata` is already jsonb.
 *
 * `workflow_step_order` is load-bearing beyond this file: `summaryWorker`
 * copies tutorial explanations onto workflow steps for the deterministic
 * walkthrough, and a procedure's step 4 is no longer the flow's step 4. The
 * copy joins on this key so only steps that really mirror a traced step
 * propagate.
 */
async function persistSteps(
  params: GenerateTutorialsParams,
  tutorialId: string,
  workflow: WorkflowRow,
  steps: ProcedureStep[],
  whyByOrder: Map<number, string>,
): Promise<void> {
  if (steps.length === 0) return;

  // Bulk step persistence (Track C): 3 statements per tutorial instead of
  // 3 per STEP (~21 steps × 3 = 63 round trips each before).
  const stepValues: unknown[] = [];
  const stepTuples = steps.map((step, i) => {
    stepValues.push(
      tutorialId, step.order, step.nodeId ?? null, step.filePath, step.symbolName ?? null,
      step.lineStart ?? null, step.lineEnd ?? null, step.snippet?.slice(0, SNIPPET_CAP) ?? null,
      whyByOrder.get(step.order) ?? '',
      JSON.stringify({
        stepKind: step.kind,
        action: step.action,
        command: step.command ?? null,
        expected: step.expected,
        verify: step.verify,
        verify_command: step.verifyCommand ?? null,
        evidence: step.evidence,
        ...(step.workflowStepOrder != null ? { workflow_step_order: step.workflowStepOrder } : {}),
      }),
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
      params.projectId, params.snapshotId,
      // A step whose evidence is a compose file or a manifest is config, not
      // code; saying "code" would overstate what backs the command.
      step.nodeId || step.symbolName ? 'code' : 'config',
      stepIdByOrder.get(step.order)!, step.nodeId ?? null,
      workflow.id, step.symbolName ? `${step.filePath}#${step.symbolName}` : step.filePath,
      step.nodeHash ?? null, step.filePath, step.symbolName ?? null, step.lineStart ?? null, step.lineEnd ?? null,
      step.snippet?.slice(0, SNIPPET_CAP) ?? null, params.commitHash,
      `${step.action} — expected: ${step.expected}`.slice(0, 1_000),
    );
    const base = i * 15;
    return `($${base + 1}, $${base + 2}, 'workflow_step', $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15})`;
  });
  const receiptRows = (await query(
    `INSERT INTO source_receipts
       (project_id, snapshot_id, receipt_kind, trust_level, tutorial_step_id, node_id,
        workflow_id, node_stable_key, node_hash, file_path, symbol_name, line_start,
        line_end, snippet, commit_hash, claim)
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
}

// ── the model's remaining job ───────────────────────────────────────────────

interface Annotation {
  title: string;
  goal: string;
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  whyByOrder: Map<number, string>;
  runId: string | null;
}

const PROCEDURE_INTENT: Record<ProcedureDraft['kind'], string> = {
  run_it: 'get this repository running locally and confirm it is actually up',
  run_tests: 'run the automated tests and know which of them guards which behaviour',
  trace_flow: 'watch one real flow execute and prove which lines it reaches',
};

/**
 * The model annotates; it does not author. Actions, expected results and
 * verifications are already fixed, so the prompt hands them over as read-only
 * context and asks for one sentence of `why` per step — the part a human
 * genuinely writes better than a template, and the only part that can be
 * empty without breaking the procedure.
 */
async function annotateProcedure(params: GenerateTutorialsParams, candidate: Candidate): Promise<Annotation> {
  const { workflow, draft } = candidate;
  const withSnippets = params.privacyMode === 'full_ai';

  const stepBlocks = draft.steps.map((s) => [
    `### Step ${s.order} [${s.kind}]`,
    `Action: ${s.action}`,
    s.command ? `Command: \`${s.command}\`` : null,
    `Expected: ${s.expected}`,
    `Verify: ${s.verify}${s.verifyCommand ? ` (\`${s.verifyCommand}\`)` : ''}`,
    `Evidence: ${s.evidence}`,
    s.snippet
      ? (withSnippets
        // Tutorials were the single largest facts-only leak: ~2.4k characters
        // of raw source per step, sent to the provider while the project
        // setting said "no code leaves the system".
        ? '```\n' + s.snippet.slice(0, SNIPPET_CAP) + '\n```'
        : '(code snippet withheld by privacy settings — write from the facts above only)')
      : null,
  ].filter(Boolean).join('\n'));

  const prompt = [
    `A new contributor is about to run the procedure below against the repository. Its purpose is to ${PROCEDURE_INTENT[draft.kind]}${draft.kind === 'trace_flow' ? `, for the flow "${workflow.title}" (${workflow.trigger_type}; ${workflow.purpose})` : ''}.`,
    'Every step is already written and every command, path, port and line below was read out of this repository. You are NOT writing the steps and must not restate them.',
    [
      'Produce:',
      '- title: imperative, at most 8 words, naming what the reader will have DONE (not what they will have read).',
      '- goal: ONE sentence "After this, you can …" naming the concrete thing they can now do unaided.',
      '- summary: 1-2 plain sentences on what running this gets them, and one clause on what it does not cover.',
      '- steps: for each step_order, `why` — AT MOST ONE short sentence saying what this step proves or why it sits where it does. Return "" when the action already says it; an empty `why` is the correct answer more often than not.',
      '- confidence: how well the evidence supports this procedure end to end.',
    ].join('\n'),
    [
      'Hard rules:',
      '- Never restate a command, a path, an expected result or a verification — the reader has them on screen next to your text.',
      '- Never invent a command, file, port, table or flag that is not written above. If you want to name one and cannot find it, say nothing.',
      '- No filler ("this is important", "as we can see", "simply", "essentially"), no tour-guide framing ("let\'s take a look", "we will now"), and no sentence about "this tutorial" or "this section".',
      '- No sentence that would read the same for any other codebase.',
      withSnippets
        ? '- Stay inside the snippets and evidence given; write "unknown" rather than guessing.'
        : '- The code is withheld from you by this project\'s privacy settings, but the reader still sees it — never claim to quote or describe lines you were not given.',
    ].join('\n'),
    draft.gaps.length > 0
      ? `Known limits of this procedure (the reader is shown these; do not repeat them verbatim, but do not contradict them):\n${draft.gaps.map((g) => `- ${g.detail}`).join('\n')}`
      : 'This procedure has no recorded evidence gaps.',
    stepBlocks.join('\n\n'),
  ].join('\n\n');

  const response = await params.ai.call<{
    goal: string; title: string; summary: string;
    confidence: 'high' | 'medium' | 'low';
    steps: Array<{ step_order: number; why: string }>;
  }>({
    tier: 'strong',
    targetType: 'tutorial',
    packageId: params.packageId,
    promptVersion: TUTORIAL_PROMPT_VERSION,
    schemaName: 'tutorial',
    schema: TUTORIAL_SCHEMA,
    user: prompt,
    maxOutputTokens: 4_000,
  });
  const value = response.value!;

  // `repairExplanation` strips leaked internal keys (`wf:…`, `cluster:…`) that
  // the prompt forbids and models emit anyway — reused rather than reinvented.
  const clean = (text: string): string => repairExplanation(text ?? '', {}).markdown.trim();
  const whyByOrder = new Map<number, string>();
  for (const s of value.steps ?? []) {
    const why = clean(s.why ?? '');
    if (why) whyByOrder.set(s.step_order, why);
  }

  return {
    title: clean(value.title ?? ''),
    goal: clean(value.goal ?? ''),
    summary: clean(value.summary ?? ''),
    confidence: value.confidence ?? 'medium',
    whyByOrder,
    runId: response.runId ?? null,
  };
}

/**
 * The prose the model did write, held to the same contract as every other
 * explanation the product emits. Each `why` is rendered with the file:line its
 * step is grounded in, which is what `explanationLint` counts as a citation —
 * so an uncited claim here means the model wrote something its step does not
 * support.
 */
function lintAnnotation(candidate: Candidate, output: Annotation, subject: string): { issues: string[]; hits: string[] } {
  const lines = [
    output.goal,
    output.summary,
    ...candidate.draft.steps
      .filter((s) => output.whyByOrder.get(s.order))
      .map((s) => `- ${output.whyByOrder.get(s.order)} (${s.evidence})`),
  ].filter(Boolean);
  const result = lintExplanation(lines.join('\n\n'), {
    scope: { kind: 'workflow', subject },
    mode: 'tutorial',
  });
  return { issues: result.issues, hits: result.hits };
}

// ── cache clone ─────────────────────────────────────────────────────────────

/** Cache hit: clone the tutorial row, its steps, and their receipts. */
async function cloneTutorial(
  params: GenerateTutorialsParams,
  workflow: WorkflowRow,
  sourceTutorialId: string,
  evidenceHash: string,
  rank: number,
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
       SET generation_context = generation_context || jsonb_build_object('mode', 'cache_hit', 'evidence_hash', $2::text, 'rank', $4::int),
           workflow_id = $3, updated_at = now()
       WHERE id = $1`,
      [sourceTutorialId, evidenceHash, workflow.id, rank],
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
            generation_context || jsonb_build_object('mode', 'cache_hit', 'cached_from_tutorial_id', id, 'evidence_hash', $5::text, 'rank', $6::int)
     FROM tutorials WHERE id = $1
     RETURNING id`,
    [sourceTutorialId, params.snapshotId, params.packageId, workflow.id, evidenceHash, rank],
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
        line_end, snippet, commit_hash, claim, metadata)
     SELECT sr.project_id, sr.snapshot_id, sr.receipt_kind, sr.trust_level, ns.id, sr.node_id,
            $3, sr.node_stable_key, sr.node_hash, sr.file_path, sr.symbol_name, sr.line_start,
            sr.line_end, sr.snippet, sr.commit_hash, sr.claim, sr.metadata
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
