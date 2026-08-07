/**
 * Tutorials: annotated code walkthroughs, with runbooks kept beside them.
 *
 * Three generations of this file, each fixing the last one's overcorrection:
 *
 *   v2 essays        one traced step → one LLM card. Graded "no difference
 *                    with writing sections". Correctly killed.
 *   v3 procedures    action / expected / verify computed from evidence, an
 *                    8-step cap, marker-plant-and-revert. It fixed fabrication
 *                    and overcorrected: the owner read it as "overwhelming and
 *                    strange", and a four-stage pipeline rendered as 2 steps.
 *   v4 walkthroughs  the owner's own spec — *"code and it highlighted the
 *                    important lines, while explaining what it does, what is
 *                    happening with handoff to next step."*
 *
 * What v4 changes here (doc/TUTORIAL_REDESIGN.md §2-§5):
 *
 *   • Traced flows become WALKTHROUGHS via `attemptWalkthrough`: windowed
 *     snippet, deterministically located highlights, 2-3 sentences of
 *     narration, one hand-off sentence per card, a landing statement at the
 *     end. `mode: 'walkthrough'`.
 *   • A composed journey becomes PHASES — one per member, walked from that
 *     member's own trace rather than the composer's two-step spine, with every
 *     boundary rendered as a connector. Nothing is cut; extra steps fold.
 *   • `run_it` / `run_tests` keep their v3 procedure shape and gain
 *     `mode: 'howto'`, because Diátaxis is right that they are how-to guides.
 *     They are relabelled and regrouped, never deleted.
 *
 * What did NOT change is the thing v3 got right: the model annotates, it does
 * not author. Files, lines, snippets, highlights, phases, hand-off targets and
 * landing facts are all computed from evidence, and every one of them has a
 * deterministic fallback — which is why a facts-only package renders a
 * complete walkthrough with the code never leaving the system.
 *
 * `DEFAULT_MAX_TUTORIALS` is a cap, not a target. When it binds, the number of
 * eligible tutorials is recorded and the tab says so; when nothing is
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
  attemptWalkthrough,
  buildRunEnvironment,
  detectPackageManager,
  handoffNamesNext,
  lintProcedure,
  lintWalkthrough,
  narrationIsFiller,
  type ProcedureDraft,
  type ProcedureSkipReason,
  type ProcedureStep,
  type StepEffect,
  type TestGuard,
  type TraceStep,
  type WalkthroughDraft,
  type WalkthroughEmitSite,
  type WalkthroughFinding,
  type WalkthroughJourney,
  type WalkthroughStep,
} from './tutorialProcedure.js';

/**
 * v4 is the annotated-walkthrough rewrite (doc/TUTORIAL_REDESIGN.md): a bump
 * here invalidates every v3 procedure, which is intended — the step SHAPE
 * changed, so a cached v3 card would render as an empty walkthrough.
 *
 * v5 bans the filler openers ("This step involves …", "as part of the overall
 * …") in the prompt AND rejects them on the way in. The bump is what stops the
 * v4 cards — whose narration is the filler this gate now refuses — from being
 * cloned forward untouched for as long as the flow itself does not change.
 *
 * v6 does the same for the em dash: banned in the prompt, refused at
 * acceptance. Without the bump, v5 cards keep serving the dashes untouched.
 */
export const TUTORIAL_PROMPT_VERSION = 'tutorial-v6-walkthrough';
/** A ceiling on the reader's attention, not a quota to fill. */
// 6, up from 4: with run-it and run-tests occupying two slots, 4 left only
// two traced flows — a senior reviewer opening a repo with five real user
// flows saw three of them missing and read that as "the tool can't see my
// app". Still a cap, not a target; it binds only when the evidence supports
// more, and the overflow list names what was left out.
const DEFAULT_MAX_TUTORIALS = 6;
// 1M-context sizing (Track B): fuller step snippets, cheap at flash prices.
const SNIPPET_CAP = 2_400;

/**
 * A tutorial title is a heading, and headings in this product do not end in a
 * full stop — but the model ends roughly one in six with one, so a tab of six
 * cards showed five bare titles and "Onboarding page loads and sets up auth
 * and tour state." Trailing dots only; nothing inside the title is touched.
 */
const asTitle = (text: string): string => text.replace(/[.\s]+$/, '');

export interface GenerateTutorialsParams {
  /**
   * `null` under `ai_disabled`: the skeleton is complete without a model, so
   * the tab ships structural walkthroughs instead of going empty. See
   * `generateDeterministicTutorials`.
   */
  ai: AiClient | null;
  snapshotId: string;
  projectId: string;
  packageId: string;
  role: DeveloperRole;
  commitHash: string;
  projections: ProjectedTarget[];
  /** Mechanical privacy enforcement (doc/Pipeline.md "Privacy modes"): every
   * prompt builder takes the mode as an input. Steps keep their snippets in
   * the DB for the reader either way; only the PROMPT withholds them. */
  privacyMode: 'full_ai' | 'facts_only_ai' | 'ai_disabled';
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
  /** For a journey: how its first member is triggered ("HTTP POST", "UI page"). */
  entry_trigger_type: string | null;
  /** Whether any step of this flow belongs to a named business capability. */
  realizes_capability: boolean;
  step_count: number;
  effect_steps: number;
  /**
   * `workflows.metadata.journey`, whatever shape the composer emits. Read
   * defensively and never keyed on a journey *category*: boundary discovery is
   * being generalized underneath this file, and a walkthrough only needs the
   * member list and the crossings between them.
   */
  journey: WalkthroughJourney | null;
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
  metadata: TraceStep['metadata'];
}

/**
 * One selected tutorial, ready to annotate and persist.
 *
 * `mode` is the Diátaxis split made mechanical (doc/TUTORIAL_REDESIGN.md §5):
 * `run_it`/`run_tests` are how-to guides — their titles name a goal, they
 * assume competence, they serve application rather than acquisition — and a
 * reading walkthrough is the tutorial. They are grouped, not deleted; the
 * action/expected/verify card is the right shape for a runbook and keeps it.
 */
interface BaseCandidate {
  workflow: WorkflowRow;
  /** Traced steps behind the tutorial, for the diagram and the evidence hash. */
  traceSteps: StepRow[];
  score: number;
  family: string;
}
type Candidate =
  | (BaseCandidate & { mode: 'howto'; draft: ProcedureDraft })
  | (BaseCandidate & { mode: 'walkthrough'; draft: WalkthroughDraft });

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

/**
 * The model's job on a walkthrough: two sentences per card, over a skeleton it
 * cannot alter. `handoff` is separate from `narration` because the linter
 * checks it differently — a hand-off that does not name the next step's symbol
 * or file is replaced by the deterministic template rather than shipped.
 */
const WALKTHROUGH_SCHEMA = {
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
        required: ['step_order', 'narration'],
        properties: {
          step_order: { type: 'integer' },
          narration: { type: 'string' },
          handoff: { type: 'string' },
        },
      },
    },
  },
};

export async function generateTutorials(params: GenerateTutorialsParams): Promise<TutorialResult> {
  const { candidates, report } = await selectProcedures(params);
  const result: TutorialResult = { tutorials: 0, steps: 0, failed: 0, selection: report };

  // 6 = DEFAULT_MAX_TUTORIALS, so a default-sized selection goes out in one
  // wave instead of two. Concurrency only — the number of tutorials (capped by
  // `maxTutorials`), the calls each makes, and their prompts are untouched.
  await mapLimit(candidates, 6, async (candidate, index) => {
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

/** Why a single-tutorial regeneration could not be served. */
export type TutorialRegenerationMiss = 'workflow_gone' | 'no_longer_eligible';

export interface RegenerateOneResult {
  ok: boolean;
  /** Set when `ok` is false — what the reader should be told. */
  miss?: TutorialRegenerationMiss;
  cached?: boolean;
  steps?: number;
  detail?: string;
}

/**
 * Bug #36 — rebuild ONE tutorial against the current snapshot.
 *
 * The mirror of `regenerate_section`, and it exists for the same reason:
 * incremental analysis flags a tutorial stale when a file its steps cite
 * changes, and until now the only way to clear that flag was to regenerate the
 * whole package — every section, every other tutorial, paid for again.
 *
 * `stableKey` is the tutorial row's own key (`tut:<workflow stable key>`).
 * Selection is re-run rather than trusting the old row: a tutorial only exists
 * where the evidence supports a procedure, and evidence is exactly what
 * changed. Two honest misses come out of that and are reported rather than
 * silently producing nothing:
 *
 * - `workflow_gone`     — the flow no longer exists in this snapshot.
 * - `no_longer_eligible`— the flow is still there but no longer yields a
 *                         procedure (its traced effect disappeared, say).
 *
 * The cap is deliberately NOT applied: the reader already has this tutorial and
 * is asking for it to be refreshed, so "it lost a slot to a higher-ranked flow"
 * is not a reason to refuse. `selectProcedures` is asked for an unbounded set
 * and the requested key is picked out of it.
 */
export async function regenerateOneTutorial(
  params: GenerateTutorialsParams,
  stableKey: string,
): Promise<RegenerateOneResult> {
  const { candidates, report } = await selectProcedures({ ...params, maxTutorials: Number.MAX_SAFE_INTEGER });
  const index = candidates.findIndex((c) => `tut:${c.workflow.stable_key}` === stableKey);
  if (index === -1) {
    const workflowKey = stableKey.startsWith('tut:') ? stableKey.slice(4) : stableKey;
    const skipped = report.skipped.find((s) => s.detail === workflowKey || s.title === workflowKey);
    const stillExists = skipped !== undefined
      || (await query(
        `SELECT 1 FROM workflows WHERE snapshot_id = $1 AND stable_key = $2`,
        [params.snapshotId, workflowKey],
      )).rows.length > 0;
    return {
      ok: false,
      miss: stillExists ? 'no_longer_eligible' : 'workflow_gone',
      detail: skipped?.reason,
    };
  }

  const candidate = candidates[index]!;
  // Rank 0: a single regeneration is not re-ranking the set, and passing the
  // selection index would let this row claim a position it did not win.
  const one = await generateOneTutorial(params, candidate, 0, report);
  return { ok: true, cached: one.cached, steps: candidate.draft.steps.length };
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

/**
 * Selection order, and why it is this order.
 *
 * This mirrors the Workflows rail's contract (`WORKFLOW_ORDERING` in
 * api/routes/workflows.ts — tier, then business capability, then the flow's
 * own score) and adds the signal the rail does not have to apply: the role
 * projection, i.e. the same number that decides the **Critical 25%**
 * (`roleProjection.ts`). A tab that tutorialises flows the rest of the product
 * has already ranked as marginal is not a selection bug in one file, it is two
 * parts of the product disagreeing in public.
 *
 * The projection arrives in `params.projections`, already scoped to the
 * package's role by the caller. Nothing here reads a role name: re-weighting
 * for backend/frontend/devops/qa is a weight-table change in
 * `semantic/projections.ts`, not an edit to this file.
 *
 * Each weight is a CEILING on that signal's contribution, and they are chosen
 * so tier cannot be overturned:
 *
 *     realizes_capability    1.00   (0 or 1)
 *     crosses a boundary     0.60   (0 or 1 — see below)
 *     role projection        0.60   (score ∈ [0,1])
 *     critical_for_workflow  0.20   (view score ∈ [0,1])
 *     effect richness        0.40   (0.08 × min(effect_steps, 5))
 *     mechanised fraction    0.20   (steps with a runnable verification)
 *     extractor importance   0.15   (0.05 × min(importance_score, 3))
 *                          ──────
 *                            3.15  <  core − supporting = 3.20
 *
 * The previous comment here claimed the same property for a 1.4 gap while the
 * secondary terms already summed past 2 — a journey's own importance score is
 * 2.3 on its own. The arithmetic above is the version that holds.
 */
const TIER_WEIGHT: Record<WorkflowRow['tier'], number> = { core: 3.5, supporting: 0.3, surface: 0 };
const CAPABILITY_WEIGHT = 1.0;
/**
 * A flow that crosses a boundary — an enqueue answered by a worker, an OAuth
 * redirect that comes back, one surface entered by several routes. Those are
 * the composed journeys of `journeyComposer.ts`, "the product journeys a team
 * lead would whiteboard", and they are the only candidate shape that shows a
 * full-stack reader the hand-off itself: the request arriving, the job
 * crossing, the worker picking it up, the rows appearing. No single-route
 * trace can teach that, because neither side of a queue can see the other.
 *
 * The composer already says so (`importanceScore = maxMemberScore + 1.5`);
 * clamping the extractor's score to a 0.15 tie-break threw that statement
 * away, and the four journeys of this product — repo import, analysis,
 * onboarding generation, authentication — lost their slots to individual page
 * and route traces. Named and weighted here so the signal is legible instead
 * of smuggled in through a raw score. Read off the steps, not off
 * `trigger_type`, so any future composition earns it the same way.
 */
const CROSSES_BOUNDARY_WEIGHT = 0.6;
const PROJECTION_WEIGHT = 0.6;
const WORKFLOW_VIEW_WEIGHT = 0.2;
const EFFECT_RICHNESS_WEIGHT = 0.08;
const MECHANISED_WEIGHT = 0.2;
const EXTRACTOR_SCORE_WEIGHT = 0.05;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0);

/**
 * `mechanised` is the fraction of the procedure the reader can check by
 * running something — a genuine quality signal, but a small one: it decides
 * between two flows that are otherwise equally important, never between an
 * important flow and a convenient one.
 */
function rankTraceCandidate(
  row: WorkflowRow,
  steps: StepRow[],
  projection: ProjectedTarget | undefined,
  mechanised: number,
): number {
  const crossesBoundary = steps.some((s) => typeof s.metadata?.journeyBoundary === 'string');
  return (
    TIER_WEIGHT[row.tier]
    + (row.realizes_capability ? CAPABILITY_WEIGHT : 0)
    + (crossesBoundary ? CROSSES_BOUNDARY_WEIGHT : 0)
    + PROJECTION_WEIGHT * clamp01(projection?.score ?? 0)
    + WORKFLOW_VIEW_WEIGHT * clamp01(projection?.viewScores.critical_for_workflow ?? 0)
    + EFFECT_RICHNESS_WEIGHT * Math.min(row.effect_steps, 5)
    + MECHANISED_WEIGHT * clamp01(mechanised)
    + EXTRACTOR_SCORE_WEIGHT * Math.min(Math.max(row.importance_score, 0), 3)
  );
}

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
export async function selectProcedures(
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
            -- A composed journey carries its first member's entry point, but
            -- fall back to resolving that member explicitly: the journey rows
            -- are the ones a reader most needs a trigger for, and a null here
            -- kills them all with 'no_way_to_trigger'.
            COALESCE(ep.route_path, mep.route_path) AS route_path,
            COALESCE(ep.method, mep.method) AS method,
            CASE WHEN w.trigger_type = 'journey' THEN mw.trigger_type END AS entry_trigger_type,
            -- Same signal, same join as the Workflows rail
            -- (api/routes/workflows.ts): capability_members is polymorphic,
            -- (member_type, member_id) — there is no cm.node_id column.
            EXISTS (
              SELECT 1 FROM workflow_steps ws
              JOIN capability_members cm
                ON cm.member_type = 'node' AND cm.member_id = ws.node_id
              WHERE ws.workflow_id = w.id
            ) AS realizes_capability,
            w.metadata->'journey' AS journey,
            (SELECT count(*)::int FROM workflow_steps ws WHERE ws.workflow_id = w.id) AS step_count,
            (SELECT count(*)::int FROM workflow_steps ws WHERE ws.workflow_id = w.id
              AND ws.step_kind IN ('data_write', 'async_work', 'side_effect', 'auth_guard')) AS effect_steps
     FROM workflows w
     LEFT JOIN entrypoints ep ON ep.id = w.entrypoint_id
     LEFT JOIN workflows mw
       ON w.trigger_type = 'journey'
      AND mw.snapshot_id = w.snapshot_id
      AND mw.stable_key = w.metadata->'journey'->'members'->>0
     LEFT JOIN entrypoints mep ON mep.id = mw.entrypoint_id
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
    entry_trigger_type: w.entry_trigger_type ?? null,
    realizes_capability: w.realizes_capability === true,
    step_count: Number(w.step_count ?? 0),
    effect_steps: Number(w.effect_steps ?? 0),
    journey: readJourney(w.journey),
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
  const idByStableKey = new Map(rows.map((r) => [r.stable_key, r.id]));
  const effectsByNode = await loadSideEffects(params.snapshotId);
  // Only registration-shaped entries need publishers looked up: an HTTP route
  // states its own trigger, a handler on `socket:draw-ops` cannot.
  const emitSitesByToken = await loadEmitSites(
    params.snapshotId,
    rows.map((r) => REGISTRATION_TOKEN.exec(r.route_path ?? '')?.[1]).filter((t): t is string => Boolean(t)),
  );
  // A journey and its members are loaded twice by definition (once as rows in
  // their own right, once as phases); one cache keeps that from being N+1.
  const stepCache = new Map<string, StepRow[]>();
  const loadSteps = async (workflowId: string): Promise<StepRow[]> => {
    const hit = stepCache.get(workflowId);
    if (hit) return hit;
    const loaded = await loadWorkflowSteps(params.snapshotId, workflowId);
    stepCache.set(workflowId, loaded);
    return loaded;
  };

  const setup: Candidate[] = [];
  const traces: Array<{ row: Candidate; score: number; family: string }> = [];

  for (const row of rows) {
    // A `surface` flow has no traced effects, so there is no line worth
    // marking and no result to confirm. Recorded, not silently dropped.
    if (row.tier === 'surface') {
      report.skipped.push({
        title: row.title,
        reason: 'surface_tier_no_traced_effects',
        detail: `"${row.title}" is a real entry point, but nothing was traced from it. There is no path to walk, only a file to open.`,
      });
      continue;
    }

    if (row.config_flow === 'compose_up') {
      const attempt = attemptRunItProcedure(env, facts);
      if (attempt.ok) setup.push({ mode: 'howto', workflow: row, draft: attempt.draft, traceSteps: [], score: 1_000, family: 'dev_command' });
      else report.skipped.push({ title: row.title, ...attempt.skip });
      continue;
    }
    if (row.config_flow === 'compose_test' || row.trigger_type === 'ci_pipeline') {
      // One "run the tests" procedure is enough; a repo with both a test
      // compose and a CI file would otherwise get the same steps twice.
      if (setup.some((c) => c.draft.kind === 'run_tests')) continue;
      const attempt = attemptRunTestsProcedure(env, facts, guards);
      if (attempt.ok) setup.push({ mode: 'howto', workflow: row, draft: attempt.draft, traceSteps: [], score: 900, family: 'dev_command' });
      else report.skipped.push({ title: row.title, ...attempt.skip });
      continue;
    }
    if (row.config_flow) continue; // another config journey; not a procedure

    const steps = await loadSteps(row.id);
    if (steps.length === 0) {
      report.skipped.push({ title: row.title, reason: 'too_few_steps', detail: `"${row.title}" has no persisted steps.` });
      continue;
    }
    // Every journey member is walked from its OWN trace, not from the
    // composer's two-step-per-member spine. That spine is why "the onboarding
    // package generation is just 2 steps"; the phases below are why it is not.
    const memberSteps = new Map<string, TraceStep[]>();
    for (const member of row.journey?.members ?? []) {
      const memberId = idByStableKey.get(member);
      if (!memberId) continue;
      memberSteps.set(member, (await loadSteps(memberId)).map((s) => toTraceStep(s, effectsByNode)));
    }
    const attempt = attemptWalkthrough(
      {
        title: row.title,
        purpose: row.purpose,
        tier: row.tier,
        triggerType: row.trigger_type,
        entryTriggerType: row.entry_trigger_type,
        routePath: row.route_path,
        httpMethod: row.method,
        steps: steps.map((s) => toTraceStep(s, effectsByNode)),
        coveringTests: guards.filter((g) => steps.some((s) => g.covers === s.symbol_name)).map((g) => g.testFile),
        journey: row.journey,
        memberSteps,
        emitSites: emitSitesByToken.get(REGISTRATION_TOKEN.exec(row.route_path ?? '')?.[1] ?? '') ?? [],
      },
      env,
    );
    if (!attempt.ok) {
      report.skipped.push({ title: row.title, ...attempt.skip });
      continue;
    }

    const projection = projectionByKey.get(row.stable_key);
    // A reading's "mechanised" fraction is how much of it a highlight actually
    // points at — the walkthrough equivalent of a runnable verification.
    const highlighted = attempt.draft.steps.filter((s) => s.highlights.length > 0).length / attempt.draft.steps.length;
    traces.push({
      row: { mode: 'walkthrough', workflow: row, draft: attempt.draft, traceSteps: steps, score: 0, family: workflowFamily(row.trigger_type) },
      score: rankTraceCandidate(row, steps, projection, highlighted),
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

/**
 * The no-AI answer: the same tutorials, unannotated (doc/TUTORIAL_REDESIGN.md
 * §2.5, §7).
 *
 * Everything a walkthrough is made of — order, files, line spans, snippets,
 * highlights, phases, hand-off targets, the entry statement and the landing
 * facts — is computed from evidence, so a model is the last 20% of the card and
 * not the card. Before this, `ai_disabled` deleted the package's tutorials and
 * wrote none back, and the tab went blank: a privacy setting silently removed a
 * feature that never needed a provider in the first place. Every step ships
 * `narration_source: 'deterministic'`, which the reader already renders as a
 * label, so nothing here can be mistaken for written prose.
 */
export function generateDeterministicTutorials(
  params: Omit<GenerateTutorialsParams, 'ai' | 'privacyMode'>,
): Promise<TutorialResult> {
  return generateTutorials({ ...params, ai: null, privacyMode: 'ai_disabled' });
}

async function loadWorkflowSteps(snapshotId: string, workflowId: string): Promise<StepRow[]> {
  return (await query(
    `SELECT ws.id, ws.step_order, ws.node_id, ws.file_path, ws.symbol_name, ws.line_start,
            ws.line_end, ws.step_kind, ws.deterministic_description, ws.metadata,
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

const toTraceStep = (s: StepRow, effectsByNode?: Map<string, StepEffect[]>): TraceStep => ({
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
  effects: (s.node_id && effectsByNode?.get(s.node_id)) || [],
  // journeyMember / journeyBoundary: how a composed journey is compressed to
  // its spine and how far one trigger reaches. See `journeyWalkOf`.
  metadata: s.metadata ?? null,
});

/**
 * The composer's journey annotation, read defensively.
 *
 * Boundary discovery is being generalized underneath this file, so nothing
 * here may key on a journey *category* or a fixed boundary vocabulary: the
 * only contract is "a list of members and the crossings between them". An
 * unrecognised `kind` string flows straight through to the reader as the
 * connector's label, which is exactly what a new detector should get for free.
 */
function readJourney(raw: unknown): WalkthroughJourney | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  const members = Array.isArray(j.members) ? j.members.filter((m): m is string => typeof m === 'string') : [];
  if (members.length < 2) return null;
  const titles = Array.isArray(j.member_titles) ? j.member_titles.map((t) => String(t)) : [];
  const boundaries = (Array.isArray(j.boundaries) ? j.boundaries : [])
    .map((b) => (b && typeof b === 'object' ? (b as Record<string, unknown>) : {}))
    .filter((b) => typeof b.kind === 'string' && Number.isInteger(b.after))
    .map((b) => ({
      after: Number(b.after),
      kind: String(b.kind),
      detail: b.detail == null ? undefined : String(b.detail),
      // The composer's normalized hand-off token, when it emitted one: an
      // exact literal to scan for beats parsing one back out of prose.
      token: b.token == null ? undefined : String(b.token),
      // …except that the normalized one is lowercased and de-pluralized, so
      // it matches nothing in a snippet spelling it `getAnalysisQueue`. Absent
      // on snapshots analysed before the composer recorded it.
      tokenRaw: b.tokenRaw == null ? undefined : String(b.tokenRaw),
    }));
  return { members, memberTitles: titles, boundaries };
}

/**
 * Side effects by the node that performs them, for highlight location.
 *
 * `evidence` — the matched call expression — is the only handle a highlight
 * has: `DetectedSideEffect` carries no line number and graph edges carry no
 * call-site lines, so the builder scans the verified snippet for this text
 * rather than looking a range up. Scoped to nodes some trace actually visits,
 * which bounds this to the traced surface rather than the whole repository.
 */
async function loadSideEffects(snapshotId: string): Promise<Map<string, StepEffect[]>> {
  const rows = (await query(
    `SELECT DISTINCT se.node_id, se.type, se.target, se.evidence
     FROM side_effects se
     WHERE se.snapshot_id = $1
       AND se.node_id IN (
         SELECT ws.node_id FROM workflow_steps ws
         JOIN workflows w ON w.id = ws.workflow_id
         WHERE w.snapshot_id = $1 AND ws.node_id IS NOT NULL)`,
    [snapshotId],
  )).rows as Array<{ node_id: string; type: string; target: string | null; evidence: string | null }>;
  const byNode = new Map<string, StepEffect[]>();
  for (const r of rows) {
    if (!r.evidence) continue;
    const list = byNode.get(r.node_id) ?? [];
    list.push({ kind: r.type, target: r.target, evidence: r.evidence });
    byNode.set(r.node_id, list);
  }
  return byNode;
}

/** `prefix:name` registrations carry the token; a bare route does not. */
const REGISTRATION_TOKEN = /^[a-z]+:(.+)$/;
/** Publish-shaped calls, matched against the verified bytes of every symbol. */
const PUBLISH_CALL = String.raw`(?:emit|publish|send|dispatch)\s*\(\s*['"\x60]`;

/**
 * Where each event token is published inside this repository.
 *
 * A handler registered on `socket:create-room` has no route a reader can send
 * anything to; the honest answer to "how do I set this off" is the call that
 * writes that name. `side_effects.evidence` cannot supply it — the detector
 * records `.emit(` with the literal already stripped — so this scans the same
 * verified snippet bytes the receipts prove, which is the identical technique
 * the highlight locator uses.
 *
 * One statement for every token: a `LATERAL regexp_matches` attributes each hit
 * to the token it matched, so a file that publishes four events is found once.
 */
async function loadEmitSites(snapshotId: string, tokens: string[]): Promise<Map<string, WalkthroughEmitSite[]>> {
  const byToken = new Map<string, WalkthroughEmitSite[]>();
  const wanted = [...new Set(tokens)].filter((t) => t.length >= 3);
  if (wanted.length === 0) return byToken;
  const pattern = `${PUBLISH_CALL}(${wanted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})['"\`]`;
  const rows = (await query(
    `SELECT DISTINCT n.file_path, n.name, n.line_start, n.line_end, m[1] AS token
     FROM graph_nodes n, LATERAL regexp_matches(n.snippet, $2, 'g') AS m
     WHERE n.snapshot_id = $1 AND n.snippet IS NOT NULL
       AND n.type IN ('function', 'method', 'class', 'module', 'file')
     LIMIT 400`,
    [snapshotId, pattern],
  )).rows as Array<{ file_path: string | null; name: string | null; line_start: number | null; line_end: number | null; token: string }>;
  for (const r of rows) {
    if (!r.file_path) continue;
    const list = byToken.get(r.token) ?? [];
    list.push({ filePath: r.file_path, symbolName: r.name, lineStart: r.line_start, lineEnd: r.line_end });
    byToken.set(r.token, list);
  }
  return byToken;
}

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
    steps: candidate.mode === 'walkthrough'
      // Highlights and phases are part of the skeleton, so they belong in the
      // key: a re-analysis that moves a highlight must not clone the old card.
      // `entry` rides the key too: a reading whose stated trigger changed is a
      // different reading, and cloning the old card would keep shipping the
      // door the detector no longer believes in.
      ? candidate.draft.steps.map((s) => [s.order, s.role, s.filePath, s.lineStart,
        s.phase?.member ?? '', s.boundary?.kind ?? '', s.collapsed, s.entry?.text ?? '',
        s.highlights.map((h) => `${h.start}-${h.end}:${h.source}`).join(','),
        (s.snippet ?? '').slice(0, SNIPPET_CAP)])
      : candidate.draft.steps.map((s) => [s.order, s.kind, s.action, s.command ?? '', s.filePath,
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

  const output = await annotate(params, candidate);
  // The model wrote narration and hand-offs over a skeleton it cannot alter;
  // applying them is where a hand-off that names nothing gets replaced by the
  // deterministic template rather than shipped broken.
  const narrationRejects = candidate.mode === 'walkthrough'
    ? applyWalkthroughAnnotation(candidate.draft, output)
    : [];
  // Nothing to lint when nothing was written: `explanationLint` asks whether
  // prose explains, and the deterministic templates are not prose.
  const lint = params.ai === null
    ? { issues: [] as string[], hits: [] as string[] }
    : lintAnnotation(candidate, output, workflow.title);
  // A rejected narration is a finding the lint cannot make: by the time it
  // runs, the filler has already been swapped back out for the template.
  const structural = candidate.mode === 'walkthrough'
    ? [...narrationRejects, ...lintWalkthrough(candidate.draft, workflow.journey)]
      .map((f) => ({ order: f.stepOrder, code: f.code as string, detail: f.detail }))
    : lintProcedure(candidate.draft).map((f) => ({ order: f.stepOrder, code: f.code as string, detail: f.detail }));

  const unknowns: Array<{ kind: string; detail: string }> = [
    ...draft.gaps.map((g) => ({ kind: g.kind, detail: g.detail })),
    ...structural.map((f) => ({ kind: `step_${f.code}`, detail: f.order > 0 ? `step ${f.order}: ${f.detail}` : f.detail })),
  ];
  if (report.capBinding && rank === 0) {
    unknowns.push({
      kind: 'tutorial_cap_reached',
      detail: `${report.eligible} tutorials could be built from this repository; the ${report.cap} strongest are shown. The rest are listed on this tab.`,
    });
  }
  // Never "high" when the machine found a hole in the reading or the prose.
  const confidence =
    structural.length > 0 || lint.issues.length > 0
      ? (output.confidence === 'high' ? 'medium' : output.confidence)
      : output.confidence;

  const diagramSteps: DiagramStep[] = (candidate.traceSteps.length > 0 ? candidate.traceSteps.map((s) => ({
    stepOrder: s.step_order, filePath: s.file_path, symbolName: s.symbol_name,
    stepKind: s.step_kind, description: s.deterministic_description,
  })) : candidate.mode === 'walkthrough' ? candidate.draft.steps.map((s) => ({
    stepOrder: s.order, filePath: s.filePath, symbolName: s.symbolName ?? null,
    stepKind: s.role, description: s.narration,
  })) : candidate.draft.steps.map((s) => ({
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
     (candidate.mode === 'walkthrough' ? output.title : '') || draft.title,
     output.summary ?? '', diagramKind, mermaid,
     confidence, JSON.stringify(unknowns),
     JSON.stringify({
       prompt_version: TUTORIAL_PROMPT_VERSION,
       workflow: workflow.stable_key,
       goal: output.goal ?? '',
       evidence_hash: evidenceHash,
       // `mode` is what the tab groups on — "Code walkthroughs" above
       // "Run & verify" (doc/TUTORIAL_REDESIGN.md §5). `procedure_kind` stays
       // for the icons and for rows written before v4.
       mode: candidate.mode,
       // Who wrote the prose. The tab says so out loud, because a package
       // generated with AI off must not read as though a model saw the code.
       annotation: params.ai === null ? 'deterministic' : 'ai',
       procedure_kind: draft.kind,
       rank,
       selection: report,
       procedure_lint: structural.map((f) => `${f.order}:${f.code}`),
       explanation_lint: lint.hits,
     })],
  )).rows[0] as { id: string }).id;

  await persistSteps(params, tutorialId, workflow, candidate.mode === 'walkthrough'
    ? candidate.draft.steps.map((s) => walkthroughRow(s))
    : candidate.draft.steps.map((s) => procedureRow(s, output.whyByOrder.get(s.order) ?? '')));
  return { cached: false };
}

/**
 * A step as the `tutorial_steps` table takes it. The columns predate both
 * rewrites, so everything with no column of its own rides `metadata` (jsonb) —
 * which is what makes v4 a migration-free change.
 */
interface PersistableStep {
  order: number;
  nodeId?: string | null;
  nodeHash?: string | null;
  filePath: string;
  symbolName?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  snippet?: string | null;
  /** `explanation` holds the reader-visible prose, so pre-v4 consumers keep working. */
  explanation: string;
  metadata: Record<string, unknown>;
  /** What the receipt asserts this step's bytes support. */
  claim: string;
}

const procedureRow = (step: ProcedureStep, why: string): PersistableStep => ({
  order: step.order,
  nodeId: step.nodeId,
  nodeHash: step.nodeHash,
  filePath: step.filePath,
  symbolName: step.symbolName,
  lineStart: step.lineStart,
  lineEnd: step.lineEnd,
  snippet: step.snippet,
  explanation: why,
  metadata: {
    mode: 'howto',
    stepKind: step.kind,
    action: step.action,
    command: step.command ?? null,
    expected: step.expected,
    verify: step.verify,
    verify_command: step.verifyCommand ?? null,
    evidence: step.evidence,
    ...(step.workflowStepOrder != null ? { workflow_step_order: step.workflowStepOrder } : {}),
  },
  claim: `${step.action} (expected: ${step.expected})`,
});

/** doc/TUTORIAL_REDESIGN.md §2.2 — the walkthrough step contract, verbatim. */
const walkthroughRow = (step: WalkthroughStep): PersistableStep => ({
  order: step.order,
  nodeId: step.nodeId,
  nodeHash: step.nodeHash,
  filePath: step.filePath,
  symbolName: step.symbolName,
  lineStart: step.lineStart,
  lineEnd: step.lineEnd,
  snippet: step.snippet,
  // The narration IS the explanation column: `summaryWorker` copies step
  // explanations onto workflow steps, and that copy must keep working.
  explanation: step.narration,
  metadata: {
    mode: 'walkthrough',
    role: step.role,
    phase: step.phase,
    highlights: step.highlights,
    window: step.window,
    handoff: step.handoff,
    landing: step.landing,
    boundary: step.boundary,
    ...(step.entry ? { entry: step.entry } : {}),
    narration_source: step.narrationSource,
    collapsed: step.collapsed,
    evidence: step.evidence,
    ...(step.appendix ? { appendix: step.appendix } : {}),
    ...(step.workflowStepOrder != null ? { workflow_step_order: step.workflowStepOrder } : {}),
  },
  claim: step.narration,
});

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
  steps: PersistableStep[],
): Promise<void> {
  if (steps.length === 0) return;

  // Bulk step persistence (Track C): 3 statements per tutorial instead of
  // 3 per STEP (~21 steps × 3 = 63 round trips each before).
  const stepValues: unknown[] = [];
  const stepTuples = steps.map((step, i) => {
    stepValues.push(
      tutorialId, step.order, step.nodeId ?? null, step.filePath, step.symbolName ?? null,
      step.lineStart ?? null, step.lineEnd ?? null, step.snippet?.slice(0, SNIPPET_CAP) ?? null,
      step.explanation, JSON.stringify(step.metadata),
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
      step.claim.slice(0, 1_000),
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
  /** How-to: one `why` per step. Walkthrough: the narration paragraph. */
  whyByOrder: Map<number, string>;
  /** Walkthrough only: the hand-off sentence, before it is checked. */
  handoffByOrder: Map<number, string>;
  runId: string | null;
}

const PROCEDURE_INTENT: Record<string, string> = {
  run_it: 'get this repository running locally and confirm it is actually up',
  run_tests: 'run the automated tests and know which of them guards which behaviour',
  trace_flow: 'watch one real flow execute and prove which lines it reaches',
};

const annotate = (params: GenerateTutorialsParams, candidate: Candidate): Promise<Annotation> =>
  params.ai === null
    ? Promise.resolve(deterministicAnnotation(candidate))
    : candidate.mode === 'walkthrough'
      ? annotateWalkthrough(params, candidate.workflow, candidate.draft)
      : annotateProcedure(params, candidate.workflow, candidate.draft);

/** A file list, deduped and ordered as the reader meets them. */
function filesOf(candidate: Candidate): string[] {
  return [...new Set(candidate.draft.steps.map((s) => s.filePath))];
}

/**
 * The tutorial-level prose, written from the same facts the steps are.
 *
 * Deliberately flat and countable — files, cards, phases, the stated entry, the
 * stated landing. It reads as a manifest rather than as an essay, and that is
 * the point: an unannotated package should look unannotated, not like a worse
 * version of the annotated one.
 */
function deterministicAnnotation(candidate: Candidate): Annotation {
  const files = filesOf(candidate);
  const where = files.length === 1 ? `\`${files[0]}\`` : `${files.length} files, starting in \`${files[0]}\``;
  if (candidate.mode === 'howto') {
    const draft = candidate.draft;
    return {
      title: draft.title,
      goal: `Run this repository's own commands and see what they report.`,
      summary: `${draft.steps.length} step${draft.steps.length === 1 ? '' : 's'}, each a command or file this repository declares, with the result to compare against. `
        + `Built from ${where} with no model involved, so nothing here is phrased beyond what the configuration states.`,
      confidence: 'medium',
      whyByOrder: new Map(),
      handoffByOrder: new Map(),
      runId: null,
    };
  }
  const draft = candidate.draft;
  const visible = draft.steps.filter((s) => !s.collapsed && !s.appendix);
  const phases = new Set(visible.map((s) => s.phase?.member).filter(Boolean)).size;
  const entry = draft.steps.find((s) => s.entry)?.entry ?? null;
  const landing = visible[visible.length - 1]?.landing ?? null;
  return {
    title: draft.title,
    goal: `Follow this path through ${where} and see where each leg hands over to the next.`,
    summary: [
      `${visible.length} card${visible.length === 1 ? '' : 's'}${phases > 1 ? ` across ${phases} legs` : ''} over ${where}.`,
      entry?.text ?? null,
      landing,
      `Written from the structure alone. This project has AI generation switched off, so every line below is the trace and the code, with no prose added.`,
    ].filter(Boolean).join(' '),
    confidence: 'medium',
    whyByOrder: new Map(),
    handoffByOrder: new Map(),
    runId: null,
  };
}

/**
 * Narration and hand-offs, over a skeleton the model cannot alter.
 *
 * Two hard rules beyond v3's: the hand-off sentence must NAME the next step's
 * symbol or file basename (checked, not requested — a sentence that names
 * neither is replaced by the deterministic template), and narration must not
 * restate the hand-off. `facts_only_ai` skips per-step prose entirely: a
 * walkthrough without its code in front of the model would be narration about
 * lines it never saw, so the deterministic templates ship instead, labelled.
 */
async function annotateWalkthrough(
  params: GenerateTutorialsParams,
  workflow: WorkflowRow,
  draft: WalkthroughDraft,
): Promise<Annotation> {
  const withSnippets = params.privacyMode === 'full_ai';
  const visible = draft.steps.filter((s) => !s.collapsed && !s.appendix);

  const stepBlocks = visible.map((s) => {
    const win = s.window;
    const lines = s.snippet?.replace(/\n$/, '').split('\n') ?? [];
    const shown = win && s.lineStart != null
      ? lines.slice(win.start - s.lineStart, win.end - s.lineStart + 1).join('\n')
      : (s.snippet ?? '');
    return [
      `### Step ${s.order} [${s.role}]${s.phase ? ` (phase ${s.phase.index} of ${s.phase.count}: ${s.phase.title})` : ''}`,
      `Location: ${s.filePath}${s.lineStart ? `:${s.lineStart}${s.lineEnd ? `-${s.lineEnd}` : ''}` : ''}${s.symbolName ? ` (\`${s.symbolName}\`)` : ''}`,
      `What the trace records: ${s.narration}`,
      s.highlights.length > 0
        ? `Highlighted for the reader: ${s.highlights.map((h) => `lines ${h.start}-${h.end} (${h.label})`).join('; ')}`
        : 'No line could be highlighted on this step. Do not refer to highlighted lines.',
      s.handoff
        ? `Hand-off goes to step ${s.handoff.toStep}: ${s.handoff.toSymbol ? `\`${s.handoff.toSymbol}\` in ` : ''}${s.handoff.toFile}${s.boundary ? ` (crossing: ${s.boundary.detail})` : ''}`
        : `This is the last step. What now exists: ${s.landing ?? 'unknown'}`,
      shown
        ? (withSnippets
          ? '```\n' + shown.slice(0, SNIPPET_CAP) + '\n```'
          : '(code withheld by privacy settings)')
        : null,
    ].filter(Boolean).join('\n');
  });

  // The entry fact goes in the prompt, not just the card: without it the model
  // reliably wrote "send a request to this handler" over a socket registration
  // no request can reach, and the reader had no way to know it was false.
  const entry = draft.steps.find((s) => s.entry)?.entry ?? null;
  const prompt = [
    `A new contributor is reading the path below in this repository: "${workflow.title}" (${workflow.trigger_type}; ${workflow.purpose}). They have the code on screen with the listed lines highlighted. Your job is the prose between the snippets.`,
    'Every file, line, snippet, highlight and hand-off target below was read out of this repository. You are NOT choosing them and must not restate them.',
    entry
      ? `How this path is entered. This is a fact, already shown to the reader: ${entry.text}${entry.kind === 'http' ? '' : ' Nothing here is reached by an HTTP request; never write that the reader can send, curl or POST anything to set it off.'}`
      : null,
    [
      'Produce:',
      '- title: at most 8 words, naming the path the reader follows.',
      '- goal: ONE sentence "After this, you can …" naming what they will be able to find or change unaided.',
      '- summary: 1-2 plain sentences on what this path does end to end, and one clause on what it does not cover.',
      '- steps: for each step_order:',
      '    · narration: 2-3 sentences, at most 55 words, on what this code does IN THIS FLOW. Open on the action. The first word should be doing something to something. Ground every claim in the snippet and the highlight labels.',
      '    · handoff: EXACTLY ONE sentence saying how control or data reaches the next step. It MUST name the next step\'s symbol or its file name. On the last step, return "". The landing statement is already written.',
      '- confidence: how well the evidence supports this reading end to end.',
    ].join('\n'),
    [
      'Hard rules:',
      '- narration must not restate the hand-off, and the hand-off must not restate the narration.',
      '- NEVER open a narration with "This step involves", "This step is", "This interaction", "This code" or "This function/method is responsible for". The reader can see which step they are on; describe the code, not the step.',
      '- NEVER write "as part of the overall …" (or "the larger/broader …"). It is true of every step in every flow, so it states nothing. Say what this code leaves behind that the next step needs.',
      '- Never invent a file, symbol, table, queue or flag that is not written above. If you want to name one and cannot find it, say nothing.',
      '- Never refer to "the highlighted line" on a step whose highlights are listed as none.',
      '- No filler ("this is important", "as we can see", "simply", "essentially"), no tour-guide framing ("let\'s take a look", "we will now"), and no sentence about "this tutorial" or "this step".',
      '- No sentence that would read the same for any other codebase.',
      // Prints the character in order to ban it. Narration that carries one
      // anyway is rejected at acceptance and the deterministic sentence is kept.
      '- Never use the em dash character (—). Use a comma, colon, parentheses, or a new sentence.',
      withSnippets
        ? '- Stay inside the snippets given; write "unknown" rather than guessing.'
        : '- The code is withheld from you by this project\'s privacy settings. Never claim to describe lines you were not given.',
    ].join('\n'),
    draft.gaps.length > 0
      ? `Known limits of this reading (the reader is shown these; do not repeat them verbatim, but do not contradict them):\n${draft.gaps.map((g) => `- ${g.detail}`).join('\n')}`
      : 'This reading has no recorded evidence gaps.',
    stepBlocks.join('\n\n'),
  ].filter(Boolean).join('\n\n');

  const response = await params.ai!.call<{
    goal: string; title: string; summary: string;
    confidence: 'high' | 'medium' | 'low';
    steps: Array<{ step_order: number; narration?: string; handoff?: string }>;
  }>({
    tier: 'strong',
    targetType: 'tutorial',
    packageId: params.packageId,
    promptVersion: TUTORIAL_PROMPT_VERSION,
    schemaName: 'tutorial',
    schema: WALKTHROUGH_SCHEMA,
    user: prompt,
    maxOutputTokens: 6_000,
  });
  const value = response.value!;

  const clean = (text: string): string => repairExplanation(text ?? '', {}).markdown.trim();
  const whyByOrder = new Map<number, string>();
  const handoffByOrder = new Map<number, string>();
  // Facts-only: the skeleton is already complete and honest, so nothing the
  // model wrote without the code is allowed onto a step.
  if (withSnippets) {
    for (const s of value.steps ?? []) {
      const narration = clean(s.narration ?? '');
      if (narration) whyByOrder.set(s.step_order, narration);
      const handoff = clean(s.handoff ?? '');
      if (handoff) handoffByOrder.set(s.step_order, handoff);
    }
  }

  return {
    title: asTitle(clean(value.title ?? '')),
    goal: clean(value.goal ?? ''),
    summary: clean(value.summary ?? ''),
    confidence: value.confidence ?? 'medium',
    whyByOrder,
    handoffByOrder,
    runId: response.runId ?? null,
  };
}

/**
 * Move the model's prose onto the skeleton, one gate at a time. Nothing that
 * fails a gate is shipped: the deterministic template stays and the step keeps
 * saying `deterministic`, which the UI labels exactly as cluster summaries
 * already label their source.
 */
function applyWalkthroughAnnotation(draft: WalkthroughDraft, output: Annotation): WalkthroughFinding[] {
  const rejected: WalkthroughFinding[] = [];
  for (const step of draft.steps) {
    if (step.appendix) continue;
    const narration = output.whyByOrder.get(step.order);
    if (narration && narration.length >= 20) {
      if (narrationIsFiller(narration)) {
        // Same gate as a hand-off that names nothing: the deterministic
        // sentence is plainer, but it is about this step's code rather than
        // about the fact that this step is a step.
        rejected.push({
          stepOrder: step.order,
          code: 'narration_filler',
          detail: 'the narration described the step instead of the code, so the deterministic sentence was kept',
        });
      } else if (narration.includes('—')) {
        // The prompt bans the character; this is the acceptance-side half of
        // that rule. The deterministic sentence is already written, so a step
        // that slips a dash through costs the reader nothing but the AI voice.
        rejected.push({
          stepOrder: step.order,
          code: 'narration_em_dash',
          detail: 'the narration used an em dash, so the deterministic sentence was kept',
        });
      } else {
        step.narration = narration;
        step.narrationSource = 'ai';
      }
    }
    const handoff = output.handoffByOrder.get(step.order);
    if (step.handoff && handoff && handoffNamesNext(handoff, step.handoff)) {
      if (handoff.includes('—')) {
        rejected.push({
          stepOrder: step.order,
          code: 'handoff_em_dash',
          detail: 'the hand-off used an em dash, so the deterministic sentence was kept',
        });
      } else {
        step.handoff = { ...step.handoff, text: handoff, source: 'ai' };
      }
    }
  }
  return rejected;
}

/**
 * The model annotates; it does not author. Actions, expected results and
 * verifications are already fixed, so the prompt hands them over as read-only
 * context and asks for one sentence of `why` per step — the part a human
 * genuinely writes better than a template, and the only part that can be
 * empty without breaking the procedure.
 */
async function annotateProcedure(
  params: GenerateTutorialsParams,
  workflow: WorkflowRow,
  draft: ProcedureDraft,
): Promise<Annotation> {
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
        : '(code snippet withheld by privacy settings: write from the facts above only)')
      : null,
  ].filter(Boolean).join('\n'));

  const prompt = [
    `A new contributor is about to run the procedure below against the repository. Its purpose is to ${PROCEDURE_INTENT[draft.kind] ?? 'work with this repository'}.`,
    'Every step is already written and every command, path, port and line below was read out of this repository. You are NOT writing the steps and must not restate them.',
    [
      'Produce:',
      '- title: imperative, at most 8 words, naming what the reader will have DONE (not what they will have read).',
      '- goal: ONE sentence "After this, you can …" naming the concrete thing they can now do unaided.',
      '- summary: 1-2 plain sentences on what running this gets them, and one clause on what it does not cover.',
      '- steps: for each step_order, `why`: AT MOST ONE short sentence saying what this step proves or why it sits where it does. Return "" when the action already says it; an empty `why` is the correct answer more often than not.',
      '- confidence: how well the evidence supports this procedure end to end.',
    ].join('\n'),
    [
      'Hard rules:',
      '- Never restate a command, a path, an expected result or a verification. The reader has them on screen next to your text.',
      '- Never invent a command, file, port, table or flag that is not written above. If you want to name one and cannot find it, say nothing.',
      '- No filler ("this is important", "as we can see", "simply", "essentially"), no tour-guide framing ("let\'s take a look", "we will now"), and no sentence about "this tutorial" or "this section".',
      '- No sentence that would read the same for any other codebase.',
      '- Never use the em dash character (—). Use a comma, colon, parentheses, or a new sentence.',
      withSnippets
        ? '- Stay inside the snippets and evidence given; write "unknown" rather than guessing.'
        : '- The code is withheld from you by this project\'s privacy settings, but the reader still sees it. Never claim to quote or describe lines you were not given.',
    ].join('\n'),
    draft.gaps.length > 0
      ? `Known limits of this procedure (the reader is shown these; do not repeat them verbatim, but do not contradict them):\n${draft.gaps.map((g) => `- ${g.detail}`).join('\n')}`
      : 'This procedure has no recorded evidence gaps.',
    stepBlocks.join('\n\n'),
  ].join('\n\n');

  const response = await params.ai!.call<{
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
    title: asTitle(clean(value.title ?? '')),
    goal: clean(value.goal ?? ''),
    summary: clean(value.summary ?? ''),
    confidence: value.confidence ?? 'medium',
    whyByOrder,
    handoffByOrder: new Map(),
    runId: response.runId ?? null,
  };
}

/**
 * The prose the model did write, held to the same contract as every other
 * explanation the product emits. Each sentence is rendered with the file:line
 * its step is grounded in, which is what `explanationLint` counts as a
 * citation — so an uncited claim here means the model wrote something its step
 * does not support.
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
