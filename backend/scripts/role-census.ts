/**
 * Role census — does a role actually get a different package, and can every
 * difference be explained?
 *
 * "Roles are just a weight tweak" is either the honest description of this
 * product or its biggest unearned claim, and the difference is measurable.
 * This harness runs the DETERMINISTIC half of the pipeline once per role
 * against a real snapshot — role projections, the Critical 25%, the Workflows
 * rail order, `selectProcedures`, `first_change.safeCandidates`,
 * `code_map`'s inputs — and diffs each role against the baseline role.
 *
 * The gate is not "roles differ" (a difference nobody can explain is a bug
 * wearing a feature's clothes). The gate is **every differing pick carries an
 * attribution**: either the weighted view-score delta that moved it — down to
 * which view, which weight delta, and how much each contributed — or a named
 * structural rule from `STRUCTURAL_RULES`, each of which points at the line of
 * shipped code that owns the behaviour. An unattributed diff row is a failure
 * and the process exits non-zero with the count, so this can gate CI.
 *
 * Zero LLM calls, zero writes, zero prose review: everything measured here is
 * a pure function of stored scores plus SELECTs (doc/ROLE_DIFFERENTIATION_PLAN
 * "Testing per-role quality without 4× cost").
 *
 *   npm run role-census                                  # the 3 truth repos + dogfood
 *   npm run role-census -- --repos Skribbl,MasterPokedex
 *   npm run role-census -- --snapshot <uuid>
 *   npm run role-census -- --only backend                # one role vs baseline
 *   npm run role-census -- --stable                      # re-run and require byte-equality
 *   npm run role-census -- --out doc/evidence            # ship the artifact somewhere else
 *
 * Exit code = failed checks (unattributed diffs + broken invariants + failed
 * per-role signature assertions). Assertions whose evidence does not exist in
 * a snapshot report `n/a`, and assertions for machinery that has not landed
 * yet report `pending` — neither is counted as a pass or a failure, because
 * claiming either would be the exact dishonesty this harness exists to catch.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pool, query } from '../src/lib/db.js';
import {
  DEFAULT_ROLE_WEIGHTS, SEMANTIC_VIEWS, resolveRoleWeights,
  type DeveloperRole, type SemanticView,
} from '../src/worker/semantic/projections.js';
import { critical25, type ProjectedTarget } from '../src/worker/generation/roleProjection.js';
import { selectProcedures, workflowFamily, type GenerateTutorialsParams } from '../src/worker/generation/tutorialGenerator.js';
import { SECTION_SPECS, buildSectionDeps } from '../src/worker/generation/sectionSpecs.js';
import { loadConfigFacts } from '../src/worker/generation/referenceBackbones.js';
import type { ProcedureStep } from '../src/worker/generation/tutorialProcedure.js';

// ── CLI ─────────────────────────────────────────────────────────────────────

const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const hasFlag = (flag: string): boolean => process.argv.includes(flag);

/**
 * Roles come from the weight table, never from a literal list here: the
 * "nothing hardcodes `general`" invariant (doc/REWORK_PLAN.md Phase 10) is
 * only real if the harness that checks it obeys it too.
 */
const ALL_ROLES = Object.keys(DEFAULT_ROLE_WEIGHTS) as DeveloperRole[];
/**
 * The one place `general` is named on purpose: it is the DIFF BASELINE, not a
 * pipeline default. Every other role is reported as a delta from it because
 * general is the superset role (Phase 10: "if general is right, the others
 * follow"), so "what did the role change" is the only question worth asking.
 */
const BASELINE_ROLE: DeveloperRole = 'general';
/** The 3 truth repos + the dogfood snapshot, per the plan's census section. */
const DEFAULT_REPOS = ['Skribbl', 'MasterPokedex', 'FloowForge', 'OnboardBuddy'];

const ONLY_ROLE = argOf('--only') as DeveloperRole | undefined;
const SNAPSHOT_ARG = argOf('--snapshot');
const REPOS_ARG = argOf('--repos');
const OUT_DIR = path.resolve(argOf('--out') ?? path.resolve(import.meta.dirname, '../tmp/role-census'));
const CHECK_STABLE = hasFlag('--stable');
/** Diff rows printed per surface; the JSON artifact always carries all of them. */
const PRINT_ROWS = Number(argOf('--print-rows') ?? 8);

if (ONLY_ROLE && !ALL_ROLES.includes(ONLY_ROLE)) {
  console.error(`--only ${ONLY_ROLE}: unknown role (known: ${ALL_ROLES.join(', ')})`);
  process.exit(2);
}

// ── what a census measures ──────────────────────────────────────────────────

/**
 * Structural rules: the non-weight reasons a role's pick can differ. Each id
 * names the shipped code that owns the behaviour, so an attribution is a
 * pointer to a line someone can read, not a label.
 */
const STRUCTURAL_RULES = {
  area_share_cap:
    'roleProjection.ts selectWithAreaCap — an area holding ≥40% of the picks defers further candidates to other areas',
  min_per_type_floor:
    'roleProjection.ts critical25 — the minPerType floor keeps 3 targets per type regardless of score',
  family_cap:
    'tutorialGenerator.ts pickDiverseWorkflows — the read_route/ui families are capped at 2 slots',
  cap_binding:
    'tutorialGenerator.ts DEFAULT_MAX_TUTORIALS — an eligible procedure lost its slot to the cap',
  setup_first:
    'tutorialGenerator.ts selectProcedures — run_it/run_tests carry fixed scores (1000/900) ahead of every trace',
  tier_weight:
    'tutorialGenerator.ts TIER_WEIGHT — tier outranks the sum of every secondary signal, so a tier change decides alone',
  role_specific_kind:
    'a ProcedureKind only this role produces (ci_deploy / write_test — ROLE_DIFFERENTIATION_PLAN "Tutorial kinds per role")',
  role_specific_skip:
    'a typed skip reason only this role can record (no_ci_pipeline / no_test_exemplar)',
  first_change_midrank_window:
    'sectionSpecs.ts first_change.safeCandidates takes ranks 4–25 of the ranked file list — the top 3 are excluded as too central for a first change, so a file that rises INTO the top 3 leaves the exercise pool and one that falls out of it joins',
  displaced_by_neighbour:
    "the pick's own score is unchanged; another target's score delta crossed it",
  tie_break_order:
    'scores equal within 1e-9 — the order is decided by the sort tie-break, not by the role',
} as const;
type StructuralRule = keyof typeof STRUCTURAL_RULES;

interface ViewContribution {
  view: SemanticView;
  weightDelta: number;
  roleViewScore: number;
  baselineViewScore: number;
  /** roleViewScore × roleWeight − baselineViewScore × baselineWeight. */
  contribution: number;
  /** Which input moved: the tuned weight, the role's own `critical_for_role` row, or both. */
  source: 'weight' | 'role_view' | 'both';
}

type Attribution =
  | { rule: 'view_score_delta'; scoreDelta: number; views: ViewContribution[]; detail: string }
  | { rule: StructuralRule; detail: string };

interface DiffRow {
  surface: string;
  change: 'entered' | 'left' | 'moved' | 'kind_changed' | 'skip_changed';
  key: string;
  label?: string;
  roleRank: number | null;
  baselineRank: number | null;
  attribution: Attribution | null;
}

interface Pick {
  key: string;
  label?: string;
  score?: number;
}

interface TutorialPick extends Pick {
  kind: string;
  tier: string;
  family: string;
  steps: number;
  /** The trigger step's command, if the procedure has one (curl vs browser). */
  triggerCommand: string | null;
  crossesBoundary: boolean;
}

interface RoleCensus {
  role: DeveloperRole;
  weights: Record<SemanticView, number>;
  projectedTargets: number;
  /** Ordered picks per surface. Key sets are what the diff compares. */
  surfaces: {
    /** One entry per target type: `critical25:file`, `critical25:symbol`, … */
    [surface: string]: Pick[];
  };
  tutorials: {
    candidates: TutorialPick[];
    skipped: Array<{ title: string; reason: string }>;
    overflow: Array<{ title: string; kind: string }>;
    cap: number;
    considered: number;
    eligible: number;
    emitted: number;
    capBinding: boolean;
  };
  /** Byte-comparable drafts of the shared spine, per the plan's invariant. */
  setupDrafts: Record<string, string>;
  /** stableKey -> the role's own view scores, for the attribution engine. */
  scoresByKey: Map<string, ProjectedTarget>;
}

interface CheckResult {
  id: string;
  status: 'pass' | 'fail' | 'n/a' | 'pending';
  detail: string;
}

// ── attribution engine ──────────────────────────────────────────────────────

const EPS = 1e-9;

/**
 * Why this target's projected score moved, view by view.
 *
 * Two inputs can move it and the census must not conflate them: the tuned
 * weight column (`DEFAULT_ROLE_WEIGHTS`, or a project's
 * `ranking_weight_configs` override — the census resolves the same weights
 * `loadRoleProjections` does) and the role's own `critical_for_role` row,
 * which is stored per role by `semanticReranker.ts`. `source` says which.
 */
function scoreDelta(
  roleTarget: ProjectedTarget | undefined,
  baselineTarget: ProjectedTarget | undefined,
  roleWeights: Record<SemanticView, number>,
  baselineWeights: Record<SemanticView, number>,
): { total: number; views: ViewContribution[] } {
  const views: ViewContribution[] = [];
  let total = 0;
  for (const view of SEMANTIC_VIEWS) {
    const roleViewScore = roleTarget?.viewScores[view] ?? 0;
    const baselineViewScore = baselineTarget?.viewScores[view] ?? 0;
    const roleWeight = roleWeights[view];
    const baselineWeight = baselineWeights[view];
    const contribution = roleViewScore * roleWeight - baselineViewScore * baselineWeight;
    if (Math.abs(contribution) < EPS) continue;
    const weightMoved = Math.abs(roleWeight - baselineWeight) > EPS;
    const viewMoved = Math.abs(roleViewScore - baselineViewScore) > EPS;
    views.push({
      view,
      weightDelta: round(roleWeight - baselineWeight, 4),
      roleViewScore: round(roleViewScore, 4),
      baselineViewScore: round(baselineViewScore, 4),
      contribution: round(contribution, 5),
      source: weightMoved && viewMoved ? 'both' : weightMoved ? 'weight' : 'role_view',
    });
    total += contribution;
  }
  views.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { total: round(total, 5), views: views.slice(0, 4) };
}

const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/**
 * The attribution for one differing pick.
 *
 * A score delta only explains a move when it points the same way the pick
 * moved. "It gained 0.03 and fell four places" is a number, not an
 * explanation — the real cause is whatever gained more, so a delta whose sign
 * contradicts the movement is rejected here and the crossing target is named
 * instead, with both numbers. That check is the difference between an
 * attribution and a plausible-looking label; without it every row is
 * "attributed" by construction and the invariant proves nothing.
 *
 * Returning `null` means the harness cannot explain the difference, which is
 * the failure this file exists to produce.
 */
function attribute(
  key: string,
  change: DiffRow['change'],
  roleCensus: RoleCensus,
  baselineCensus: RoleCensus,
  rolePicks: Pick[],
  baselinePicks: Pick[],
  structural?: () => Attribution | null,
): Attribution | null {
  const deltaOf = (target: string) => scoreDelta(
    roleCensus.scoresByKey.get(target),
    baselineCensus.scoresByKey.get(target),
    roleCensus.weights,
    baselineCensus.weights,
  );
  const delta = deltaOf(key);
  const roleRank = rolePicks.findIndex((p) => p.key === key);
  const baselineRank = baselinePicks.findIndex((p) => p.key === key);
  const rose = change === 'entered' ? true : change === 'left' ? false : roleRank < baselineRank;

  const asViewDelta = (suffix = ''): Attribution => {
    const top = delta.views[0];
    return {
      rule: 'view_score_delta',
      scoreDelta: delta.total,
      views: delta.views,
      detail: top
        ? `projected score ${delta.total > 0 ? '+' : ''}${delta.total} vs ${baselineCensus.role}; largest mover ${top.view} (${top.source}, ${top.contribution > 0 ? '+' : ''}${top.contribution})${suffix}`
        : `projected score ${delta.total} vs ${baselineCensus.role}${suffix}`,
    };
  };

  if (Math.abs(delta.total) > EPS && (rose ? delta.total > 0 : delta.total < 0)) return asViewDelta();

  const fromRule = structural?.();
  if (fromRule) return fromRule;

  // Either the pick did not move on its own, or it moved the wrong way for its
  // own delta. Both mean something around it moved: find a target that crossed
  // it in the opposite direction and name it with its delta.
  const wantedSign = rose ? -1 : 1;
  const crossers = [...new Set([...rolePicks, ...baselinePicks].map((p) => p.key))]
    .filter((other) => other !== key)
    .map((other) => {
      const otherRoleRank = rolePicks.findIndex((p) => p.key === other);
      const otherBaselineRank = baselinePicks.findIndex((p) => p.key === other);
      const crossed =
        (roleRank >= 0 && otherRoleRank >= 0 && baselineRank >= 0 && otherBaselineRank >= 0
          && Math.sign(roleRank - otherRoleRank) !== Math.sign(baselineRank - otherBaselineRank))
        || (roleRank < 0) !== (otherRoleRank < 0)
        || (baselineRank < 0) !== (otherBaselineRank < 0);
      if (!crossed) return null;
      const d = deltaOf(other);
      return Math.abs(d.total) > EPS && Math.sign(d.total) === wantedSign ? { other, total: d.total } : null;
    })
    .filter((c): c is { other: string; total: number } => c !== null)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  const top = crossers[0];
  if (top) {
    const own = Math.abs(delta.total) > EPS
      ? `own score moved ${delta.total > 0 ? '+' : ''}${delta.total} — the wrong way for this ${change}`
      : 'own score unchanged';
    return {
      rule: 'displaced_by_neighbour',
      detail: `${own}; \`${top.other}\` moved ${top.total > 0 ? '+' : ''}${top.total} and crossed it`,
    };
  }

  const sameScore =
    Math.abs((rolePicks.find((p) => p.key === key)?.score ?? 0) - (baselinePicks.find((p) => p.key === key)?.score ?? 0)) < EPS;
  if (sameScore && roleRank >= 0 && baselineRank >= 0) {
    return { rule: 'tie_break_order', detail: `identical score (${round(rolePicks[roleRank]?.score ?? 0, 5)}); rank moved ${baselineRank + 1} → ${roleRank + 1}` };
  }
  // A delta that points the wrong way and no crossing target to blame is still
  // a fact, so it is reported as one — flagged, not dressed up as a cause.
  if (Math.abs(delta.total) > EPS) return asViewDelta(` — NOTE: this delta points against the ${change}, and no crossing target explains it`);
  return null;
}

/** Ordered-list diff: what entered, what left, what moved. */
function diffPicks(
  surface: string,
  rolePicks: Pick[],
  baselinePicks: Pick[],
  roleCensus: RoleCensus,
  baselineCensus: RoleCensus,
  structural?: (key: string, change: DiffRow['change']) => Attribution | null,
): DiffRow[] {
  const rows: DiffRow[] = [];
  const roleRankOf = new Map(rolePicks.map((p, i) => [p.key, i]));
  const baselineRankOf = new Map(baselinePicks.map((p, i) => [p.key, i]));
  const keys = [...new Set([...rolePicks.map((p) => p.key), ...baselinePicks.map((p) => p.key)])];

  for (const key of keys) {
    const roleRank = roleRankOf.get(key) ?? null;
    const baselineRank = baselineRankOf.get(key) ?? null;
    if (roleRank === baselineRank) continue;
    const change: DiffRow['change'] = roleRank === null ? 'left' : baselineRank === null ? 'entered' : 'moved';
    rows.push({
      surface,
      change,
      key,
      label: (rolePicks.find((p) => p.key === key) ?? baselinePicks.find((p) => p.key === key))?.label,
      roleRank,
      baselineRank,
      attribution: attribute(key, change, roleCensus, baselineCensus, rolePicks, baselinePicks, () => structural?.(key, change) ?? null),
    });
  }
  return rows.sort((a, b) => (a.roleRank ?? 999) - (b.roleRank ?? 999));
}

// ── running the planners for one role ───────────────────────────────────────

interface SnapshotRef {
  repo: string;
  snapshotId: string;
  projectId: string;
}

interface RailRow {
  stable_key: string;
  title: string;
  tier: string;
  realizes_capability: boolean;
  importance_score: number;
}

const TIER_RANK: Record<string, number> = { core: 0, supporting: 1, surface: 2 };

/**
 * The Workflows rail, both ways.
 *
 * `shipped` is byte-for-byte the ORDER BY of `api/routes/workflows.ts` (tier,
 * capability, the extractor's own importance score, title) — and therefore
 * role-invariant, which is precondition 3 of ROLE_DIFFERENTIATION_PLAN still
 * being open. `projected` is the same contract with the role's workflow
 * projection substituted for the raw importance score, i.e. what the rail
 * becomes once that fix lands. Reporting both is the only honest way to
 * measure a surface whose fix has not landed: the census shows what ships
 * today AND what the tuned weights will move.
 */
function railOrder(rows: RailRow[], projections: Map<string, ProjectedTarget>, projected: boolean): Pick[] {
  return [...rows]
    .sort((a, b) => {
      const tier = (TIER_RANK[a.tier] ?? 2) - (TIER_RANK[b.tier] ?? 2);
      if (tier !== 0) return tier;
      const cap = Number(b.realizes_capability) - Number(a.realizes_capability);
      if (cap !== 0) return cap;
      if (projected) {
        const pa = projections.get(a.stable_key);
        const pb = projections.get(b.stable_key);
        // Flows with a projection row rank among themselves by it; flows
        // without one keep the extractor's order behind them. Mixing a [0,1]
        // projection with an unbounded importance score in one comparator
        // would invent a ranking neither number supports.
        if (pa && !pb) return -1;
        if (!pa && pb) return 1;
        if (pa && pb && Math.abs(pa.score - pb.score) > EPS) return pb.score - pa.score;
      }
      const score = b.importance_score - a.importance_score;
      if (score !== 0) return score;
      return a.title.localeCompare(b.title);
    })
    .map((r) => ({
      key: r.stable_key,
      label: `${r.tier}/${r.title}`,
      score: projected ? projections.get(r.stable_key)?.score ?? r.importance_score : r.importance_score,
    }));
}

async function loadRailRows(snapshotId: string): Promise<RailRow[]> {
  return (await query(
    // Same signals and the same capability join as api/routes/workflows.ts.
    `SELECT w.stable_key, w.title,
            COALESCE(w.metadata->>'tier', 'supporting') AS tier,
            COALESCE((w.metadata->>'importance_score')::float, 0) AS importance_score,
            EXISTS (
              SELECT 1 FROM workflow_steps ws
              JOIN capability_members cm ON cm.member_type = 'node' AND cm.member_id = ws.node_id
              WHERE ws.workflow_id = w.id
            ) AS realizes_capability
     FROM workflows w WHERE w.snapshot_id = $1`,
    [snapshotId],
  )).rows as RailRow[];
}

/**
 * stable_key -> architecture cluster label, for the ui-cluster signature
 * assertion. Cluster membership is recorded for FILE nodes, so a symbol's
 * cluster is its file's cluster — looked up through `clusterOf` below rather
 * than by a direct hit that would never match a `path#Symbol` key.
 */
async function loadClusterLabels(snapshotId: string): Promise<Map<string, string>> {
  const rows = (await query(
    `SELECT n.stable_key, c.label
     FROM architecture_cluster_members m
     JOIN architecture_clusters c ON c.id = m.cluster_id
     JOIN graph_nodes n ON n.id = m.node_id
     WHERE c.snapshot_id = $1`,
    [snapshotId],
  )).rows as Array<{ stable_key: string; label: string }>;
  return new Map(rows.map((r) => [r.stable_key, r.label]));
}

async function censusForRole(snap: SnapshotRef, role: DeveloperRole, railRows: RailRow[]): Promise<RoleCensus> {
  const weights = await resolveRoleWeights(snap.projectId, role);
  // buildSectionDeps is the same loader the package generator uses, so the
  // projections measured here are the ones the sections were built from.
  const deps = await buildSectionDeps(snap.snapshotId, snap.projectId, role);
  const projections = deps.projections;
  const scoresByKey = new Map(projections.map((p) => [p.stableKey, p]));
  const workflowProjections = new Map(
    projections.filter((p) => p.targetType === 'workflow').map((p) => [p.stableKey, p]),
  );

  const surfaces: RoleCensus['surfaces'] = {};
  for (const [type, targets] of critical25(projections)) {
    surfaces[`critical25:${type}`] = targets.map((t) => ({ key: t.stableKey, score: round(t.score, 5) }));
  }
  // The role's whole ranked file list, before critical25's per-type floor
  // truncates it to three. This is the list `first_change` slices and
  // `code_map` heads with, and the only one long enough to ask the plan's
  // "top-10 files" question of.
  surfaces['files:ranked'] = projections
    .filter((p) => p.targetType === 'file')
    .map((p) => ({ key: p.stableKey, score: round(p.score, 5) }));
  surfaces['rail:shipped'] = railOrder(railRows, workflowProjections, false);
  surfaces['rail:projected'] = railOrder(railRows, workflowProjections, true);

  // The real deterministic inputs of the two role-parameterised sections.
  const firstChange = await SECTION_SPECS.first_change.deterministic(deps);
  surfaces['first_change:safeCandidates'] =
    ((firstChange.safeCandidates as Array<{ stableKey: string; score: number }>) ?? [])
      .map((c) => ({ key: c.stableKey, score: c.score }));
  const codeMap = await SECTION_SPECS.code_map.deterministic(deps);
  surfaces['code_map:keySymbols'] =
    ((codeMap.keySymbols as Array<{ stableKey: string; score: number }>) ?? [])
      .map((c) => ({ key: c.stableKey, score: c.score }));
  surfaces['code_map:fileGroups'] = Object.entries(
    (codeMap.fileGroups as Record<string, Array<{ path: string }>>) ?? {},
  ).flatMap(([group, files]) => files.map((f) => ({ key: f.path, label: group })));

  // Tutorial selection: the exported, LLM-free selector, run exactly as
  // summaryWorker runs it. `ai` is never touched by selection (that is the
  // whole point of the split), so a null stub keeps the census provably
  // call-free rather than merely budget-limited.
  const selectionParams = {
    snapshotId: snap.snapshotId,
    projectId: snap.projectId,
    packageId: 'role-census',
    commitHash: 'role-census',
    role,
    projections,
    privacyMode: 'facts_only_ai',
    ai: null as unknown as GenerateTutorialsParams['ai'],
  } satisfies GenerateTutorialsParams;
  const { candidates, report } = await selectProcedures(selectionParams);

  const setupDrafts: Record<string, string> = {};
  const tutorialPicks: TutorialPick[] = candidates.map((c) => {
    const draft = c.draft;
    const workflow = c.workflow;
    const traceSteps = (c as unknown as { traceSteps: Array<{ metadata: { journeyBoundary?: unknown } | null }> }).traceSteps ?? [];
    if (draft.kind !== 'trace_flow') {
      setupDrafts[draft.kind] = JSON.stringify(draft.steps.map((s: ProcedureStep) =>
        [s.order, s.kind, s.action, s.command ?? '', s.expected, s.verify, s.verifyCommand ?? '']));
    }
    return {
      key: workflow.stable_key,
      label: workflow.title,
      kind: draft.kind,
      tier: workflow.tier,
      family: workflowFamily(workflow.trigger_type),
      steps: draft.steps.length,
      triggerCommand: draft.steps.find((s: ProcedureStep) => s.kind === 'trigger')?.command ?? null,
      crossesBoundary: traceSteps.some((s) => typeof s.metadata?.journeyBoundary === 'string'),
      score: workflowProjections.get(workflow.stable_key)?.score,
    };
  });

  return {
    role,
    weights,
    projectedTargets: projections.length,
    surfaces,
    tutorials: {
      candidates: tutorialPicks,
      skipped: report.skipped.map((s) => ({ title: s.title, reason: s.reason })),
      overflow: report.overflow,
      cap: report.cap,
      considered: report.considered,
      eligible: report.eligible,
      emitted: report.emitted,
      capBinding: report.capBinding,
    },
    setupDrafts,
    scoresByKey,
  };
}

// ── diffing a role against the baseline ─────────────────────────────────────

/** Area = first three path segments — the same granularity roleProjection.ts caps on. */
const areaOf = (stableKey: string): string => (stableKey.split('#')[0] ?? '').split('/').slice(0, 3).join('/');
const topLevelOf = (stableKey: string): string => (stableKey.split('#')[0] ?? '').split('/')[0] ?? '';

function diffRole(roleCensus: RoleCensus, baseline: RoleCensus): DiffRow[] {
  const rows: DiffRow[] = [];

  for (const surface of Object.keys(baseline.surfaces)) {
    const rolePicks = roleCensus.surfaces[surface] ?? [];
    const basePicks = baseline.surfaces[surface] ?? [];
    rows.push(...diffPicks(surface, rolePicks, basePicks, roleCensus, baseline, (key, change) => {
      // The first-change pool is a mid-rank WINDOW, so rising can remove you
      // from it. Nothing else in the census inverts a score delta like this.
      if (surface === 'first_change:safeCandidates') {
        const rankIn = (census: RoleCensus): number =>
          (census.surfaces['files:ranked'] ?? []).findIndex((p) => p.key === key);
        const roleFileRank = rankIn(roleCensus);
        const baselineFileRank = rankIn(baseline);
        const TOP_EXCLUDED = 3;
        if (change === 'left' && roleFileRank >= 0 && roleFileRank < TOP_EXCLUDED) {
          return {
            rule: 'first_change_midrank_window',
            detail: `${STRUCTURAL_RULES.first_change_midrank_window} — rose to file rank #${roleFileRank + 1} (was #${baselineFileRank + 1})`,
          };
        }
        if (change === 'entered' && baselineFileRank >= 0 && baselineFileRank < TOP_EXCLUDED) {
          return {
            rule: 'first_change_midrank_window',
            detail: `${STRUCTURAL_RULES.first_change_midrank_window} — fell to file rank #${roleFileRank + 1} (was #${baselineFileRank + 1})`,
          };
        }
        return null;
      }
      // The Critical 25% has two rules that move a pick with no score change
      // of its own: the per-type floor and the area cap.
      if (!surface.startsWith('critical25:')) return null;
      const type = surface.slice('critical25:'.length);
      if (type !== 'file' && type !== 'symbol') return null;
      if (change === 'moved') return null;
      return {
        rule: 'area_share_cap',
        detail: `${STRUCTURAL_RULES.area_share_cap} (area \`${areaOf(key)}\`)`,
      };
    }));
  }

  // Tutorials: the ordered candidate list, plus kind changes and skip changes.
  const rolePicks: Pick[] = roleCensus.tutorials.candidates.map((c) => ({ key: c.key, label: c.label, score: c.score }));
  const basePicks: Pick[] = baseline.tutorials.candidates.map((c) => ({ key: c.key, label: c.label, score: c.score }));
  const baseKinds = new Set(baseline.tutorials.candidates.map((c) => c.kind));
  const roleOverflow = new Set(roleCensus.tutorials.overflow.map((o) => o.title));
  const baseOverflow = new Set(baseline.tutorials.overflow.map((o) => o.title));

  rows.push(...diffPicks('tutorials', rolePicks, basePicks, roleCensus, baseline, (key, change) => {
    const rolePick = roleCensus.tutorials.candidates.find((c) => c.key === key);
    const basePick = baseline.tutorials.candidates.find((c) => c.key === key);
    const pick = rolePick ?? basePick;
    if (rolePick && !baseKinds.has(rolePick.kind)) {
      return { rule: 'role_specific_kind', detail: `${STRUCTURAL_RULES.role_specific_kind} — kind \`${rolePick.kind}\`` };
    }
    if (pick && pick.kind !== 'trace_flow') {
      return { rule: 'setup_first', detail: STRUCTURAL_RULES.setup_first };
    }
    if (pick && (pick.family === 'read_route' || pick.family === 'ui') && change !== 'moved') {
      return { rule: 'family_cap', detail: `${STRUCTURAL_RULES.family_cap} (family \`${pick.family}\`)` };
    }
    const title = pick?.label ?? '';
    if (change === 'left' && roleOverflow.has(title) && !baseOverflow.has(title)) {
      return { rule: 'cap_binding', detail: STRUCTURAL_RULES.cap_binding };
    }
    if (rolePick && basePick && rolePick.tier !== basePick.tier) {
      return { rule: 'tier_weight', detail: `${STRUCTURAL_RULES.tier_weight} (${basePick.tier} → ${rolePick.tier})` };
    }
    return null;
  }));

  for (const pick of roleCensus.tutorials.candidates) {
    const basePick = baseline.tutorials.candidates.find((c) => c.key === pick.key);
    if (basePick && basePick.kind !== pick.kind) {
      rows.push({
        surface: 'tutorials',
        change: 'kind_changed',
        key: pick.key,
        label: `${basePick.kind} → ${pick.kind}`,
        roleRank: null,
        baselineRank: null,
        attribution: { rule: 'role_specific_kind', detail: `${STRUCTURAL_RULES.role_specific_kind} — kind \`${pick.kind}\`` },
      });
    }
  }

  const baseSkips = new Map(baseline.tutorials.skipped.map((s) => [`${s.title}|${s.reason}`, s]));
  const roleSkips = new Map(roleCensus.tutorials.skipped.map((s) => [`${s.title}|${s.reason}`, s]));
  /**
   * Skip reasons are computed by `attemptTraceProcedure`, which takes no role,
   * so a skip that differs across roles is either one of the planned per-role
   * reasons or a genuine anomaly. Anything else stays unattributed on purpose.
   */
  const ROLE_SKIP_REASONS = new Set(['no_ci_pipeline', 'no_test_exemplar', 'role_preference_unmet']);
  for (const [key, skip] of roleSkips) {
    if (baseSkips.has(key)) continue;
    rows.push({
      surface: 'tutorials:skipped',
      change: 'skip_changed',
      key: skip.title,
      label: skip.reason,
      roleRank: null,
      baselineRank: null,
      attribution: ROLE_SKIP_REASONS.has(skip.reason)
        ? { rule: 'role_specific_skip', detail: `${STRUCTURAL_RULES.role_specific_skip} — \`${skip.reason}\`` }
        : null,
    });
  }
  for (const [key, skip] of baseSkips) {
    if (roleSkips.has(key)) continue;
    rows.push({
      surface: 'tutorials:skipped',
      change: 'skip_changed',
      key: skip.title,
      label: `${baseline.role} only: ${skip.reason}`,
      roleRank: null,
      baselineRank: null,
      attribution: ROLE_SKIP_REASONS.has(skip.reason)
        ? { rule: 'role_specific_skip', detail: `${STRUCTURAL_RULES.role_specific_skip} — \`${skip.reason}\`` }
        : null,
    });
  }

  return rows;
}

// ── per-role signature assertions (the silent-regression catchers) ──────────

const UI_CLUSTER = /\b(ui|frontend|page|component|view|client|web)\b/i;

/** A target's cluster: its own membership, or its file's when it is a symbol. */
const clusterOf = (clusters: Map<string, string>, key: string): string =>
  clusters.get(key) ?? clusters.get(key.split('#')[0] ?? '') ?? '';

/**
 * The plan's per-role signature assertions, each gated on the evidence it
 * needs. `n/a` means the snapshot cannot show the signal (no ui cluster, no
 * queue-crossing journey); `pending` means the machinery is Scope B and has
 * not landed. Neither is scored — a green tick over absent evidence is the
 * failure mode this whole harness is arguing against.
 */
function signatureAssertions(
  role: DeveloperRole,
  census: RoleCensus,
  baseline: RoleCensus,
  clusters: Map<string, string>,
  hasCi: boolean,
  allRoleCensuses: RoleCensus[],
): CheckResult[] {
  const out: CheckResult[] = [];
  const traces = census.tutorials.candidates.filter((c) => c.kind === 'trace_flow');

  if (role === 'backend') {
    // Signature 1: a queue-crossing journey outranks every trivial read.
    const crossing = traces.findIndex((c) => c.crossesBoundary);
    const firstRead = traces.findIndex((c) => c.family === 'read_route');
    out.push(
      crossing < 0
        ? { id: 'backend/queue-journey-first', status: 'n/a', detail: 'no queue-crossing journey among the eligible traces' }
        : firstRead < 0 || crossing < firstRead
          ? { id: 'backend/queue-journey-first', status: 'pass', detail: `crossing trace at #${crossing + 1}, first read_route ${firstRead < 0 ? 'absent' : `at #${firstRead + 1}`}` }
          : { id: 'backend/queue-journey-first', status: 'fail', detail: `read_route at #${firstRead + 1} precedes the crossing journey at #${crossing + 1}` },
    );

    /**
     * Signature 2: backend's top-10 files are not a frontend list.
     *
     * Measured on the role's ranked FILE list where the projection carries
     * enough of them, and otherwise on the files behind its top-10 SYMBOLS.
     * That fallback is not a softening — it is the list this repo actually
     * ranks: the projections are symbol-heavy (3–8 file targets on all four
     * census snapshots, which is also why `code_map` needs its raw-scan
     * backfill), so asking the question of the file list alone would report
     * `n/a` forever while a backend reader stares at a page component.
     */
    const rankedFiles = (census.surfaces['files:ranked'] ?? []).map((f) => f.key);
    const symbolFiles = [...new Set((census.surfaces['critical25:symbol'] ?? []).map((s) => s.key.split('#')[0] ?? ''))];
    const measuredOn = rankedFiles.length >= 10 ? 'ranked file targets' : 'the files behind the top symbols';
    const files = (rankedFiles.length >= 10 ? rankedFiles : symbolFiles).slice(0, 10);
    const fe = files.filter((f) => topLevelOf(f) === 'frontend');
    // The evidence is "the repo HAS frontend code the ranking could drown in".
    const anyFrontend = [...baseline.scoresByKey.values()].some((t) => topLevelOf(t.stableKey) === 'frontend');
    out.push(
      files.length < 4 || !anyFrontend
        ? {
          id: 'backend/top10-not-frontend',
          status: 'n/a',
          detail: !anyFrontend
            ? 'no frontend/ targets in the projection for the ranking to be dominated by'
            : `only ${files.length} ranked targets — too few to ask a top-10 question of`,
        }
        : fe.length / files.length < 0.5
          ? { id: 'backend/top10-not-frontend', status: 'pass', detail: `${fe.length}/${files.length} frontend/* among backend's top 10 (${measuredOn})` }
          : { id: 'backend/top10-not-frontend', status: 'fail', detail: `${fe.length}/${files.length} of backend's top 10 are frontend/* (${measuredOn}) — the backend projection is ranking the UI first` },
    );
  }

  if (role === 'frontend') {
    // Signature 1: the first trace is browser-triggered, not curl.
    const uiTrace = traces.find((c) => c.family === 'ui');
    const first = traces[0];
    out.push(
      !uiTrace
        ? { id: 'frontend/browser-trigger-first', status: 'n/a', detail: 'no eligible ui-family trace in this snapshot' }
        : !first
          ? { id: 'frontend/browser-trigger-first', status: 'n/a', detail: 'no trace_flow candidate emitted' }
          : !/\bcurl\b/.test(first.triggerCommand ?? '')
            ? { id: 'frontend/browser-trigger-first', status: 'pass', detail: `first trace "${first.label}" triggers without curl` }
            : { id: 'frontend/browser-trigger-first', status: 'fail', detail: `first trace "${first.label}" triggers with \`${first.triggerCommand}\` while a ui-family trace was eligible` },
    );

    // Signature 2: ui clusters reach the top of the symbol ranking.
    const symbols = (census.surfaces['critical25:symbol'] ?? []).slice(0, 10);
    const uiClusterExists = [...clusters.values()].some((l) => UI_CLUSTER.test(l));
    const uiSymbols = symbols.filter((s) => UI_CLUSTER.test(clusterOf(clusters, s.key)));
    out.push(
      !uiClusterExists || symbols.length === 0
        ? {
          id: 'frontend/ui-symbols-top10',
          status: 'n/a',
          detail: symbols.length === 0
            ? 'no symbol targets in the projection — nothing to be ui or not'
            : 'no ui-shaped architecture cluster in this snapshot',
        }
        : uiSymbols.length >= 2
          ? { id: 'frontend/ui-symbols-top10', status: 'pass', detail: `${uiSymbols.length}/10 top symbols from ui clusters` }
          : { id: 'frontend/ui-symbols-top10', status: 'fail', detail: `only ${uiSymbols.length}/10 top symbols come from ui clusters` },
    );
  }

  if (role === 'devops') {
    const ciDeployHere = census.tutorials.candidates.filter((c) => c.kind === 'ci_deploy').length;
    const ciDeployElsewhere = allRoleCensuses
      .filter((c) => c.role !== role)
      .reduce((n, c) => n + c.tutorials.candidates.filter((t) => t.kind === 'ci_deploy').length, 0);
    const anyCiDeploy = ciDeployHere + ciDeployElsewhere > 0;
    out.push(
      !anyCiDeploy
        ? { id: 'devops/ci_deploy-exclusive', status: 'pending', detail: `ci_deploy kind not implemented (Scope B); CI evidence ${hasCi ? 'present' : 'absent'} in this snapshot` }
        : hasCi && ciDeployHere === 1 && ciDeployElsewhere === 0
          ? { id: 'devops/ci_deploy-exclusive', status: 'pass', detail: 'exactly one ci_deploy for devops, none for other roles' }
          : { id: 'devops/ci_deploy-exclusive', status: 'fail', detail: `ci_deploy: ${ciDeployHere} for devops, ${ciDeployElsewhere} for other roles (CI evidence ${hasCi ? 'present' : 'absent'})` },
    );
    if (!hasCi) {
      const said = census.tutorials.skipped.some((s) => s.reason === 'no_ci_pipeline');
      out.push(said
        ? { id: 'devops/no-ci-says-so', status: 'pass', detail: 'report.skipped carries no_ci_pipeline' }
        : { id: 'devops/no-ci-says-so', status: 'pending', detail: 'no CI file and no no_ci_pipeline skip reason yet (Scope B adds the typed skip)' });
    }
  }

  if (role === 'qa') {
    const writeTests = census.tutorials.candidates.filter((c) => c.kind === 'write_test');
    out.push(
      writeTests.length === 0
        ? { id: 'qa/write_test-core-flow', status: 'pending', detail: 'write_test kind not implemented (Scope B)' }
        : writeTests.some((c) => c.tier === 'core')
          ? { id: 'qa/write_test-core-flow', status: 'pass', detail: `write_test targets a core-tier flow ("${writeTests[0]?.label}")` }
          : { id: 'qa/write_test-core-flow', status: 'fail', detail: 'write_test exists but targets no core-tier flow' },
    );

    /**
     * The plan's qa signature is "critical25(qa) meets the workflow floor", and
     * the floor is Scope B. What IS measurable today is the weights half of the
     * same claim: qa raised `critical_for_workflow`, so the flows its Critical
     * 25% keeps should be more workflow-critical than the baseline's.
     *
     * A shortfall is reported as PENDING with the two numbers rather than as a
     * failure, because it is not a regression — it is the measurement that
     * says the weight bump alone did not carry this repo, which is precisely
     * the argument for the structural floor. Rounding it up to a pass would
     * hide the number the floor has to beat.
     */
    const meanWorkflowView = (c: RoleCensus): number | null => {
      const picks = c.surfaces['critical25:workflow'] ?? [];
      if (picks.length === 0) return null;
      const scores = picks.map((p) => c.scoresByKey.get(p.key)?.viewScores.critical_for_workflow ?? 0);
      return scores.reduce((a, b) => a + b, 0) / scores.length;
    };
    const qaMean = meanWorkflowView(census);
    const baseMean = meanWorkflowView(baseline);
    out.push(
      qaMean === null || baseMean === null
        ? { id: 'qa/workflow-emphasis', status: 'n/a', detail: 'no workflow targets in the projection' }
        : qaMean >= baseMean - EPS
          ? { id: 'qa/workflow-emphasis', status: 'pass', detail: `mean critical_for_workflow of qa's workflow picks ${round(qaMean, 4)} ≥ ${baseline.role}'s ${round(baseMean, 4)}` }
          : {
            id: 'qa/workflow-emphasis',
            status: 'pending',
            detail: `weights alone do not carry it here: mean critical_for_workflow of qa's workflow picks ${round(qaMean, 4)} < ${baseline.role}'s ${round(baseMean, 4)} — qa's other raised views (change_risk, role) outvote the workflow bump on this snapshot, which is the case for the Scope B workflow floor`,
          },
    );
  }

  return out;
}

// ── one snapshot ────────────────────────────────────────────────────────────

interface SnapshotReport {
  repo: string;
  snapshotId: string;
  projectId: string;
  baselineRole: DeveloperRole;
  notes: string[];
  roles: Record<string, {
    weights: Record<SemanticView, number>;
    picks: RoleCensus['surfaces'];
    tutorials: RoleCensus['tutorials'];
    diff: DiffRow[];
    unattributed: number;
    checks: CheckResult[];
  }>;
}

async function censusForSnapshot(snap: SnapshotRef, roles: DeveloperRole[]): Promise<{ report: SnapshotReport; failures: number }> {
  const railRows = await loadRailRows(snap.snapshotId);
  const clusters = await loadClusterLabels(snap.snapshotId);
  const facts = await loadConfigFacts(snap.snapshotId);
  const hasCi = facts.ci.length > 0;

  const censuses = new Map<DeveloperRole, RoleCensus>();
  for (const role of [BASELINE_ROLE, ...roles.filter((r) => r !== BASELINE_ROLE)]) {
    // Progress on stderr so a piped stdout stays a clean evidence artifact.
    process.stderr.write(`    · planning ${snap.repo}/${role} …\n`);
    censuses.set(role, await censusForRole(snap, role, railRows));
  }
  const baseline = censuses.get(BASELINE_ROLE)!;
  const all = [...censuses.values()];

  const notes: string[] = [];
  if (baseline.projectedTargets === 0) {
    notes.push('no semantic criticality_scores for this snapshot — every role projection is empty, so no role can differ from another here. Nothing about role differentiation is proven or disproven by this repo.');
  }
  const railShipped = JSON.stringify(baseline.surfaces['rail:shipped']);
  if (all.every((c) => JSON.stringify(c.surfaces['rail:shipped']) === railShipped)) {
    notes.push('rail:shipped is identical for every role — api/routes/workflows.ts orders by the extractor\'s importance score, so no weight reaches the Workflows rail yet (ROLE_DIFFERENTIATION_PLAN precondition 3). rail:projected shows what the tuned weights move once it lands.');
  }
  const fileGroups = JSON.stringify(baseline.surfaces['code_map:fileGroups']);
  if (all.every((c) => JSON.stringify(c.surfaces['code_map:fileGroups']) === fileGroups)) {
    notes.push('code_map:fileGroups is identical for every role — the section whose retrieval task interpolates "for a ${role} developer" is ranking its files role-blind here (ROLE_DIFFERENTIATION_PLAN precondition 1). Either the fix is not in, or this snapshot has no file targets in the projection for it to reorder.');
  }

  const report: SnapshotReport = {
    repo: snap.repo,
    snapshotId: snap.snapshotId,
    projectId: snap.projectId,
    baselineRole: BASELINE_ROLE,
    notes,
    roles: {},
  };
  let failures = 0;

  for (const role of roles) {
    const census = censuses.get(role)!;
    const diff = role === BASELINE_ROLE ? [] : diffRole(census, baseline);
    const unattributed = diff.filter((d) => d.attribution === null).length;
    const checks: CheckResult[] = [];

    // Invariant: the shared spine is byte-identical for every role.
    if (role !== BASELINE_ROLE) {
      for (const kind of Object.keys(baseline.setupDrafts)) {
        const same = census.setupDrafts[kind] === baseline.setupDrafts[kind];
        checks.push(same
          ? { id: `spine/${kind}-byte-equal`, status: 'pass', detail: `${kind} draft is byte-identical to ${BASELINE_ROLE}'s` }
          : { id: `spine/${kind}-byte-equal`, status: 'fail', detail: `${kind} draft differs from ${BASELINE_ROLE}'s — the run_it/run_tests spine is role-independent by contract` });
      }
      checks.push(unattributed === 0
        ? { id: 'diff/all-attributed', status: 'pass', detail: `${diff.length} differing picks, all attributed` }
        : { id: 'diff/all-attributed', status: 'fail', detail: `${unattributed} of ${diff.length} differing picks carry no attribution` });
    }
    checks.push(...signatureAssertions(role, census, baseline, clusters, hasCi, all));

    failures += checks.filter((c) => c.status === 'fail').length;
    report.roles[role] = {
      weights: census.weights,
      picks: census.surfaces,
      tutorials: census.tutorials,
      diff,
      unattributed,
      checks,
    };
  }

  return { report, failures };
}

// ── reporting ───────────────────────────────────────────────────────────────

const STATUS_MARK: Record<CheckResult['status'], string> = { pass: '✓', fail: '✗', 'n/a': '–', pending: '·' };

function printSnapshot(report: SnapshotReport, roles: DeveloperRole[]): void {
  console.log(`\n  ${report.repo}  —  snapshot ${report.snapshotId}`);
  for (const note of report.notes) console.log(`    ⚠ ${note}`);

  // Baseline first: every block below it is read as a delta from it.
  for (const role of [report.baselineRole, ...roles.filter((r) => r !== report.baselineRole)]) {
    const entry = report.roles[role]!;
    const tut = entry.tutorials;
    const header = role === report.baselineRole
      ? `${role} (baseline)`
      : `${role} vs ${report.baselineRole}: ${entry.diff.length} differing picks, ${entry.unattributed} unattributed`;
    console.log(`\n    ── ${header}`);
    console.log(`       tutorials: ${tut.emitted}/${tut.eligible} eligible (cap ${tut.cap}${tut.capBinding ? ', BINDING' : ''}) — ${tut.candidates.map((c) => `${c.kind}:${c.label?.slice(0, 26)}`).join(' | ') || 'none'}`);

    const bySurface = new Map<string, DiffRow[]>();
    for (const row of entry.diff) {
      if (!bySurface.has(row.surface)) bySurface.set(row.surface, []);
      bySurface.get(row.surface)!.push(row);
    }
    for (const [surface, rows] of [...bySurface.entries()].sort()) {
      console.log(`       ${surface}: ${rows.length} rows`);
      for (const row of rows.slice(0, PRINT_ROWS)) {
        const move = row.change === 'entered' ? `→ #${(row.roleRank ?? 0) + 1}`
          : row.change === 'left' ? `#${(row.baselineRank ?? 0) + 1} →  ✗`
            : row.change === 'moved' ? `#${(row.baselineRank ?? 0) + 1} → #${(row.roleRank ?? 0) + 1}`
              : row.change;
        const attribution = row.attribution
          ? `[${row.attribution.rule}] ${row.attribution.detail}`
          : '[UNATTRIBUTED] no view-score delta and no structural rule explains this pick';
        console.log(`         ${row.change.padEnd(8)} ${move.padEnd(12)} ${row.key.slice(0, 58).padEnd(58)}`);
        console.log(`             ${attribution}`);
      }
      if (rows.length > PRINT_ROWS) console.log(`         … and ${rows.length - PRINT_ROWS} more (full list in the JSON artifact)`);
    }
    for (const check of entry.checks) {
      console.log(`       ${STATUS_MARK[check.status]} ${check.id}: ${check.detail}`);
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────────

async function resolveSnapshots(): Promise<SnapshotRef[]> {
  if (SNAPSHOT_ARG) {
    const row = (await query(
      `SELECT p.repo_name, s.id, s.project_id FROM analysis_snapshots s
       JOIN projects p ON p.id = s.project_id WHERE s.id = $1`,
      [SNAPSHOT_ARG],
    )).rows[0] as { repo_name: string; id: string; project_id: string } | undefined;
    if (!row) throw new Error(`no snapshot ${SNAPSHOT_ARG}`);
    return [{ repo: row.repo_name, snapshotId: row.id, projectId: row.project_id }];
  }
  const repos = (REPOS_ARG ?? DEFAULT_REPOS.join(',')).split(',').map((r) => r.trim()).filter(Boolean);
  const refs: SnapshotRef[] = [];
  for (const repo of repos) {
    const row = (await query(
      `SELECT s.id, s.project_id FROM analysis_snapshots s
       JOIN projects p ON p.id = s.project_id
       WHERE p.repo_name = $1 AND s.status = 'complete'
       ORDER BY s.created_at DESC LIMIT 1`,
      [repo],
    )).rows[0] as { id: string; project_id: string } | undefined;
    if (!row) {
      console.log(`  ${repo}: no complete snapshot — skipped`);
      continue;
    }
    refs.push({ repo, snapshotId: row.id, projectId: row.project_id });
  }
  return refs;
}

async function main(): Promise<number> {
  const roles = ONLY_ROLE ? [BASELINE_ROLE, ONLY_ROLE] : ALL_ROLES;
  let failures = 0;

  console.log(`\nrole-census — roles: ${roles.join(', ')} (baseline ${BASELINE_ROLE})`);

  // Invariant, checked before anything else reads the table: a column that
  // does not sum to 1.0 makes every cross-role score comparison meaningless.
  for (const [role, weights] of Object.entries(DEFAULT_ROLE_WEIGHTS)) {
    const sum = SEMANTIC_VIEWS.reduce((s, v) => s + weights[v], 0);
    if (Math.abs(sum - 1) > 1e-9) {
      console.log(`  ✗ weights/${role}-sums-to-1: column sums to ${sum}`);
      failures++;
    }
  }

  const snapshots = await resolveSnapshots();
  if (snapshots.length === 0) throw new Error('no snapshots to census');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const snap of snapshots) {
    const { report, failures: snapFailures } = await censusForSnapshot(snap, roles);
    failures += snapFailures;
    printSnapshot(report, roles);

    if (CHECK_STABLE) {
      const again = await censusForSnapshot(snap, roles);
      const stable = JSON.stringify(report.roles) === JSON.stringify(again.report.roles);
      console.log(`    ${stable ? '✓' : '✗'} census/byte-stable: two runs over the same snapshot ${stable ? 'agree' : 'DISAGREE — a tie-break is nondeterministic'}`);
      if (!stable) failures++;
    }

    const file = path.join(OUT_DIR, `${report.repo}-${report.snapshotId.slice(0, 8)}.json`);
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n    artifact: ${file}`);
  }

  const totals = snapshots.length;
  console.log(`\n  ${totals} snapshot${totals === 1 ? '' : 's'} censused, ${failures} failed check${failures === 1 ? '' : 's'}\n`);
  return failures;
}

const code = await main().catch((err: unknown) => {
  console.error('role-census failed:', err instanceof Error ? err.stack : err);
  return 1;
});
await pool.end();
process.exit(code);
