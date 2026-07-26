import type { EvidenceGraph, EvidenceNode, EvidenceEdgeType } from '../types/analysis.js';
import type { DetectedEntrypoint } from './entrypointDetector.js';
import type { DetectedSideEffect } from './sideEffectDetector.js';
import { query } from '../../lib/db.js';

/**
 * Call-graph workflow extraction (doc/Pipeline.md "Workflow extraction").
 * Replaces the old file-level import-BFS: traces the symbol-level evidence
 * graph from every entrypoint through call/route/job/schema edges, keeps only
 * traces that reach a real side effect or response output, collapses noisy
 * helpers, and never invents a workflow when none is found.
 */

export type WorkflowStepKind =
  | 'trigger' | 'auth_guard' | 'validation' | 'data_read' | 'data_write'
  | 'async_work' | 'side_effect' | 'transform' | 'response';

export interface WorkflowStep {
  stepOrder: number;
  nodeStableKey: string;
  filePath: string;
  symbolName?: string;
  lineStart?: number;
  lineEnd?: number;
  stepKind: WorkflowStepKind;
  deterministicDescription: string;
  /**
   * syntheticReturn marks the final response step that re-references the
   * trigger symbol (Express handlers respond after their callees run). The
   * graph route renders it as a distinct terminal node instead of an edge
   * looping back to step 1. syntheticSeedEffect marks an effect step
   * surfaced from the trigger's own body (writes/enqueues that the
   * 'trigger' kind used to swallow). journeyMember/journeyBoundary annotate
   * composed-journey steps with their source workflow / boundary kind.
   */
  metadata?: {
    syntheticReturn?: boolean;
    syntheticSeedEffect?: boolean;
    journeyMember?: string;
    journeyBoundary?: string;
  };
}

export type WorkflowTier = 'core' | 'supporting' | 'surface';

/** Sort order for tiers; lower comes first. */
export const TIER_RANK: Record<WorkflowTier, number> = { core: 0, supporting: 1, surface: 2 };

export interface ExtractedWorkflow {
  title: string;
  triggerType: string;
  purpose: string;
  stableKey: string;
  confidence: 'high' | 'medium' | 'low';
  entrypoint: DetectedEntrypoint;
  steps: WorkflowStep[];
  /**
   * Where this sits in the list. `core` is a flow a person triggers that
   * changes state; `supporting` is everything else that reaches an effect;
   * `surface` is an entry point with no traced effects — an endpoint or page
   * that is real but whose flow could not be followed.
   */
  tier: WorkflowTier;
  /** Ordering within a tier — see `rankWorkflow`. */
  importanceScore: number;
  /** Plain-language reasons behind the score, shown in the UI. */
  rankingReasons: string[];
  externalDependencies: string[];
  /** Extra persisted metadata (journey membership, unknown-only flags, …). */
  metadata?: Record<string, unknown>;
}

/**
 * Honesty rule (doc/DETECTION_COVERAGE.md): a trace that dies is recorded,
 * not swallowed — dead-ends roll up into snapshot `unknowns` and the trust
 * panel as findable work. Only real, resolved entrypoints are recorded;
 * convention-guessed file seeds and effect-less UI pages are normal.
 */
export interface TraceDeadEnd {
  /** e.g. "message_consumer SUMMARY_QUEUE", "http_route POST /api/auth/login" */
  entrypoint: string;
  seedName: string;
  filePath: string;
  stepCount: number;
  reason: 'no_calls_traced' | 'no_effects_reached';
}

export interface WorkflowExtraction {
  workflows: ExtractedWorkflow[];
  deadEnds: TraceDeadEnd[];
}

const MAX_DEPTH = 8;
const MAX_STEPS = 20;

/** Edge types a request-flow trace follows (spec traversal set). */
const TRAVERSAL_EDGES: ReadonlySet<EvidenceEdgeType> = new Set([
  'calls', 'handles_route', 'registers_callback',
  'enqueues_job', 'handles_job', 'touches_schema',
]);

/** Signals that make a step a meaningful effect (keep-filter + terminals). */
const EFFECT_SIGNALS = new Set([
  'database_read', 'database_write', 'queue_enqueue', 'queue_consume',
  'http_request', 'filesystem', 'response_output',
]);

const NOISE_NAME = /^(log|debug|trace|warn|print|format|pretty|stringify|slugify|normalize|capitalize)/i;
const AUTH_NAME = /auth|login|logout|verify|token|session|permission|guard/i;
const VALIDATION_NAME = /valid|sanitize|assert|check|parse[A-Z_]|schema[A-Z_]/;

export interface ExtractWorkflowsInput {
  graph: EvidenceGraph;
  entrypoints: DetectedEntrypoint[];
  sideEffects: DetectedSideEffect[];
}

export function extractWorkflows(input: ExtractWorkflowsInput): ExtractedWorkflow[] {
  return extractWorkflowsDetailed(input).workflows;
}

export function extractWorkflowsDetailed(input: ExtractWorkflowsInput): WorkflowExtraction {
  const ctx = buildTraversalContext(input);
  const workflows: ExtractedWorkflow[] = [];
  const deadEnds: TraceDeadEnd[] = [];
  const seenKeys = new Set<string>();
  const seenDeadEnds = new Set<string>();

  for (const ep of input.entrypoints) {
    for (const seed of seedsForEntrypoint(ep, ctx)) {
      const result = trace(ep, seed, ctx);
      if (!result) continue;
      // A surface-tier trace now yields BOTH a workflow (so the endpoint is
      // listed) and a dead-end record (so the trust panel still reports that
      // nothing could be followed from it). Record the dead-end first, then
      // fall through — the two are no longer mutually exclusive.
      if (result.deadEnd) {
        const key = `${result.deadEnd.entrypoint}:${result.deadEnd.seedName}`;
        if (recordableDeadEnd(ep) && !seenDeadEnds.has(key)) {
          seenDeadEnds.add(key);
          deadEnds.push(result.deadEnd);
        }
      }
      if (!('workflow' in result)) continue;
      const wf = result.workflow;
      if (seenKeys.has(wf.stableKey)) continue;
      seenKeys.add(wf.stableKey);
      workflows.push(wf);
    }
  }

  // Tier first, then score. Score ties break toward an AST-detected route
  // (`PUT /dataset/:id/:kind`) over a convention-guessed seed across the same
  // steps — it carries the real method and pattern, so it is the one that
  // should survive duplicate suppression.
  const kept = suppressNearDuplicates(workflows.sort((a, b) =>
    TIER_RANK[a.tier] - TIER_RANK[b.tier]
    || b.importanceScore - a.importanceScore
    || Number(Boolean(b.entrypoint.routePattern)) - Number(Boolean(a.entrypoint.routePattern))));
  return { workflows: kept, deadEnds };
}

/**
 * Dead-ends worth surfacing: resolved consumers/handlers and AST-detected
 * routes. A UI page that renders without effects or a convention-guessed
 * file seed dying quietly is expected, not an extraction failure.
 */
function recordableDeadEnd(ep: DetectedEntrypoint): boolean {
  if (ep.kind === 'ui_route' || ep.kind === 'ui_action' || ep.kind === 'export') return false;
  if (ep.kind === 'http_route') return Boolean(ep.routePattern);
  return true;
}

/**
 * Drops workflows whose step nodes are ≥80% shared with a higher-ranked
 * workflow — UI-route seeds especially produce many traces over the same
 * few components, which crowds real flows out of the list.
 */
function suppressNearDuplicates(sorted: ExtractedWorkflow[]): ExtractedWorkflow[] {
  const kept: Array<{ wf: ExtractedWorkflow; keys: Set<string> }> = [];
  for (const wf of sorted) {
    // Surface entries are an inventory of entry points, not traces. Two routes
    // can legitimately share a handler, and a one-step entry overlaps
    // everything by definition — suppressing them would delete real endpoints
    // from the list this tier exists to provide.
    if (wf.tier === 'surface') { kept.push({ wf, keys: new Set() }); continue; }
    const keys = new Set(wf.steps.map((s) => s.nodeStableKey));
    const isDuplicate = kept.some(({ keys: otherKeys }) => {
      let shared = 0;
      for (const k of keys) if (otherKeys.has(k)) shared++;
      return shared / keys.size >= 0.8;
    });
    if (!isDuplicate) kept.push({ wf, keys });
  }
  return kept.map((k) => k.wf);
}

// ─── Traversal context ───────────────────────────────────────────────────────

interface TraversalContext {
  nodesByKey: Map<string, EvidenceNode>;
  /** Outgoing traversal edges, insertion-ordered. */
  outgoing: Map<string, Array<{ targetKey: string; type: EvidenceEdgeType }>>;
  /** contains edges, for hopping from a file entrypoint to its symbols. */
  contained: Map<string, string[]>;
  /** Side effects by symbol stable key (class methods fall back to class). */
  effectsByKey: Map<string, DetectedSideEffect[]>;
}

function buildTraversalContext(input: ExtractWorkflowsInput): TraversalContext {
  const nodesByKey = new Map(input.graph.nodes.map((n) => [n.stableKey, n]));
  const outgoing = new Map<string, Array<{ targetKey: string; type: EvidenceEdgeType }>>();
  const contained = new Map<string, string[]>();

  for (const e of input.graph.edges) {
    if (e.type === 'contains') {
      contained.set(e.sourceKey, [...(contained.get(e.sourceKey) ?? []), e.targetKey]);
    }
    if (!TRAVERSAL_EDGES.has(e.type)) continue;
    outgoing.set(e.sourceKey, [...(outgoing.get(e.sourceKey) ?? []), { targetKey: e.targetKey, type: e.type }]);
  }

  const effectsByKey = new Map<string, DetectedSideEffect[]>();
  for (const se of input.sideEffects) {
    const key = se.symbolStableKey ?? se.nodeStableKey;
    effectsByKey.set(key, [...(effectsByKey.get(key) ?? []), se]);
  }

  return { nodesByKey, outgoing, contained, effectsByKey };
}

/**
 * Seeds for one entrypoint: the handler symbol when the detector resolved it;
 * otherwise every plausible handler symbol contained in the entrypoint file
 * (exported, non-trivial, with outgoing traversal edges or effect signals).
 */
function seedsForEntrypoint(ep: DetectedEntrypoint, ctx: TraversalContext): EvidenceNode[] {
  if (ep.symbolStableKey) {
    const node = ctx.nodesByKey.get(ep.symbolStableKey);
    if (node) return [node];
    // Class-method handlers from older snapshots may be keyed with the bare
    // method name (`file#echo`) while the node is `file#Server.echo` — accept
    // an unambiguous `.name` suffix match in the same file before giving up.
    const qualified = qualifiedMemberMatch(ep.symbolStableKey, ctx);
    if (qualified) return [qualified];
  }
  const fileNode = ctx.nodesByKey.get(ep.nodeStableKey);
  if (!fileNode) return [];

  const candidates: EvidenceNode[] = [];
  const consider = (childKey: string, depth: number): void => {
    const child = ctx.nodesByKey.get(childKey);
    if (!child || child.metadata.isTrivial === true) return;
    // Classes rarely carry traversal edges themselves — their methods do.
    // Descend one level so a route file whose handlers are class methods
    // (`class Server { echo() {...} }`) still yields real seeds.
    if (child.type === 'class' && depth === 0) {
      for (const memberKey of ctx.contained.get(childKey) ?? []) consider(memberKey, depth + 1);
      return;
    }
    const hasFlow = (ctx.outgoing.get(childKey) ?? []).length > 0;
    if (hasFlow || hasEffect(child, ctx)) candidates.push(child);
  };
  for (const childKey of ctx.contained.get(fileNode.stableKey) ?? []) consider(childKey, 0);
  // A file-level entrypoint without a resolved handler is a guess — cap the
  // fan-out so one file doesn't spawn a workflow per symbol.
  return candidates.sort((a, b) => (a.lineStart ?? 0) - (b.lineStart ?? 0)).slice(0, 3);
}

/** Resolves `file#member` to the single `file#Class.member` node if exactly one class in the file declares it. */
function qualifiedMemberMatch(symbolStableKey: string, ctx: TraversalContext): EvidenceNode | null {
  const hashIdx = symbolStableKey.lastIndexOf('#');
  if (hashIdx <= 0) return null;
  const filePrefix = symbolStableKey.slice(0, hashIdx + 1);
  const memberSuffix = `.${symbolStableKey.slice(hashIdx + 1)}`;
  let match: EvidenceNode | null = null;
  for (const [key, node] of ctx.nodesByKey) {
    if (node.type !== 'method' || !key.startsWith(filePrefix) || !key.endsWith(memberSuffix)) continue;
    if (match) return null; // ambiguous — two classes declare the member
    match = node;
  }
  return match;
}

// ─── Trace ───────────────────────────────────────────────────────────────────

function trace(
  ep: DetectedEntrypoint,
  seed: EvidenceNode,
  ctx: TraversalContext,
): { workflow: ExtractedWorkflow; deadEnd?: TraceDeadEnd } | { deadEnd: TraceDeadEnd } | null {
  const steps: WorkflowStep[] = [];
  const visited = new Set<string>();
  const externals: string[] = [];
  let effectCount = 0;
  // Effects from recognized patterns only — a workflow kept alive purely by
  // unknown_external fallbacks is honest but low-trust.
  let knownEffectCount = 0;

  const pushStep = (node: EvidenceNode, kind: WorkflowStepKind, description: string, metadata?: WorkflowStep['metadata']) => {
    steps.push({
      stepOrder: steps.length + 1,
      nodeStableKey: node.stableKey,
      filePath: node.filePath ?? node.stableKey,
      symbolName: node.type === 'module' || node.type === 'file' ? undefined : node.name,
      lineStart: node.lineStart ?? undefined,
      lineEnd: node.lineEnd ?? undefined,
      stepKind: kind,
      deterministicDescription: description,
      metadata,
    });
  };

  const visit = (key: string, depth: number): void => {
    if (depth > MAX_DEPTH || steps.length >= MAX_STEPS || visited.has(key)) return;
    visited.add(key);
    const node = ctx.nodesByKey.get(key);
    if (!node) return;

    // Cross-boundary call: honest terminal step, never a guess.
    if (node.type === 'external') {
      externals.push(node.name);
      pushStep(node, 'side_effect', `Crosses the analysis boundary into ${node.name} (not analyzed)`);
      return;
    }

    // Schema node reached via touches_schema: a data step, then stop the path.
    if (node.type === 'schema') {
      const writes = steps.some((s) => s.stepKind === 'data_write');
      effectCount++;
      pushStep(node, writes ? 'data_write' : 'data_read', `Touches database table "${node.name}"`);
      return;
    }

    const effects = effectsFor(node, ctx);
    const signals = behaviorSignalsOf(node);
    const isSeed = depth === 0;
    const noisy = !isSeed && isNoisy(node, effects, signals);

    if (!noisy) {
      const kind = isSeed ? 'trigger' : classifyStep(node, effects, signals);
      if (effects.length > 0 || signals.some((s) => EFFECT_SIGNALS.has(s))) {
        effectCount++;
        if (effects.some((e) => e.kind !== 'unknown_external') || signals.some((s) => EFFECT_SIGNALS.has(s))) {
          knownEffectCount++;
        }
      }
      pushStep(node, kind, describeStep(node, kind, ep, effects, signals));
      // The seed is always a 'trigger', which used to swallow its own
      // effects: a handler that INSERTs a job row and enqueues it traced as
      // trigger -> reads -> response, with the write and the enqueue —
      // the whole point of the flow — invisible (audit §5.4). Surface them
      // as explicit steps on the same node.
      if (isSeed) {
        const seedEffectKinds = new Map<string, DetectedSideEffect>();
        for (const e of effects) if (!seedEffectKinds.has(e.kind)) seedEffectKinds.set(e.kind, e);
        for (const [effectKind, effect] of seedEffectKinds) {
          const stepKind =
            effectKind === 'database_write' ? 'data_write'
            : effectKind === 'message_publish' ? 'async_work'
            // Auth handlers do their work through the identity SDK in the
            // handler body itself — swallowing it re-hides the User Auth
            // journey the sink detection just recovered.
            : effectKind === 'auth_call' ? 'auth_guard'
            : effectKind === 'external_service' ? 'side_effect'
            : null;
          if (!stepKind) continue; // reads/noise stay implicit
          const description =
            stepKind === 'data_write' ? `Writes data${effect.target ? ` (${effect.target})` : ''} from ${node.name}`
            : stepKind === 'async_work' ? `Enqueues async work${effect.target ? ` (${effect.target})` : ''} from ${node.name}`
            : stepKind === 'auth_guard' ? `Authenticates via ${effect.target ?? 'auth sdk'} in ${node.name}`
            : `Calls external service${effect.target ? ` (${effect.target})` : ''} from ${node.name}`;
          pushStep(node, stepKind, description, { syntheticSeedEffect: true });
        }
      }
    }

    // Responses end a request flow — don't expand past them.
    if (!isSeed && signals.includes('response_output')) return;

    for (const edge of ctx.outgoing.get(key) ?? []) {
      visit(edge.targetKey, depth + 1);
    }
  };

  visit(seed.stableKey, 0);

  // A trigger that never reaches an effect is not a *flow*, but it is still a
  // real entry point into the system: an endpoint you can call, a page you can
  // open. Dropping those made the Workflows tab claim a repo had one workflow
  // when it had forty routes, so they are kept and tiered as `surface`
  // instead. The dead-end record rides along unchanged for the trust panel.
  const isSurface = steps.length < 2 || effectCount === 0;
  const deadEnd: TraceDeadEnd | undefined = isSurface
    ? {
        entrypoint: `${ep.kind}${ep.method ? ` ${ep.method}` : ''}${ep.routePattern ? ` ${ep.routePattern}` : ''}`,
        seedName: seed.name,
        filePath: seed.filePath ?? ep.filePath,
        stepCount: steps.length,
        reason: steps.length < 2 ? 'no_calls_traced' : 'no_effects_reached',
      }
    : undefined;

  // Express handlers respond after their callees run; make that explicit.
  // Tagged syntheticReturn: it re-references the seed node, and rendering it
  // as the same graph node would draw a bogus last→first cycle.
  const seedSignals = behaviorSignalsOf(seed);
  if (seedSignals.includes('response_output') && !steps.some((s) => s.stepKind === 'response')) {
    pushStep(seed, 'response', `Sends the response back from ${seed.name}`, { syntheticReturn: true });
  }

  const sideEffectSteps = steps.filter((s) =>
    s.stepKind === 'data_read' || s.stepKind === 'data_write' || s.stepKind === 'async_work' || s.stepKind === 'side_effect').length;

  // Kept alive only by unknown_external fallbacks: honest, but low-trust —
  // confidence is capped and the flag rides along for the trust panel.
  const unknownOnly = knownEffectCount === 0;
  const { tier, score, reasons } = rankWorkflow(ep, steps, isSurface, unknownOnly);

  return {
    workflow: {
      title: workflowTitle(ep, seed),
      triggerType: ep.kind === 'http_route' ? `HTTP ${ep.method ?? 'handler'}`
        : ep.kind === 'ui_route' ? 'UI page'
        : ep.kind === 'ui_action' ? 'UI action' : ep.kind,
      purpose: classifyPurpose(ep, seed, steps, ctx),
      stableKey: `wf:${ep.nodeStableKey}:${seed.name}`,
      confidence: unknownOnly ? 'low'
        : steps.length >= 4 && sideEffectSteps > 0 ? 'high' : steps.length >= 3 ? 'medium' : 'low',
      entrypoint: ep,
      steps,
      tier,
      importanceScore: score,
      rankingReasons: reasons,
      externalDependencies: externals,
      metadata: {
        ...(unknownOnly ? { unknown_effects_only: true } : {}),
        tier,
        ranking_reasons: reasons,
      },
    },
    ...(deadEnd ? { deadEnd } : {}),
  };
}

/** Effects that mean the flow changed something outside itself. */
const PERSISTENT_STEP_KINDS = new Set(['data_write', 'async_work', 'side_effect']);
/**
 * Authentication is state.
 *
 * `PERSISTENT_STEP_KINDS` counts rows, jobs and outbound calls, and nothing
 * else — so a login handler whose entire job is `supabase.auth.signInWith…`
 * or `jwt.sign` measured as a flow that changes NOTHING. Every auth route in
 * every repo therefore tiered `supporting`, sat below read-only endpoints in
 * the rail, and never reached the tutorial selector: a reviewer opening the
 * product saw `GET /installations` tutorialized while login was absent.
 *
 * What a login changes is who the caller IS — a session, a token, a cookie —
 * which is exactly the state a newcomer needs to watch change. It is counted
 * here as a state change; `PERSISTENT_STEP_KINDS` stays as it was for the
 * places that mean *stored* state specifically (the "changes stored state"
 * reason below).
 */
const STATE_CHANGING_STEP_KINDS = new Set([...PERSISTENT_STEP_KINDS, 'auth_guard']);
/** Entry points a person triggers, as opposed to the system triggering itself. */
const USER_TRIGGERED = new Set(['http_route', 'ui_route', 'ui_action', 'event_handler']);

/**
 * Where a flow belongs in the list, and how high within its tier.
 *
 * The old score was `(steps * 0.1 + effectSteps * 0.2)`, which is a length
 * measurement wearing an importance label: a 20-step trace through shared
 * helpers outranked a 4-step login every time, so the top of the list was
 * whatever happened to trace deepest rather than whatever mattered.
 *
 * What actually distinguishes an important flow is BREADTH — how many
 * different kinds of thing it does — plus whether a person triggers it and
 * whether it changes state. Length past a point is evidence of a trace that
 * wandered, so it is penalised rather than rewarded.
 *
 * Capability membership and git churn are deliberately absent: neither exists
 * yet at extraction time. They are applied as ordering signals in the API
 * layer, where they do.
 */
export function rankWorkflow(
  ep: DetectedEntrypoint,
  steps: WorkflowStep[],
  isSurface: boolean,
  unknownOnly: boolean,
): { tier: WorkflowTier; score: number; reasons: string[] } {
  const reasons: string[] = [];
  const kinds = new Set(steps.map((s) => s.stepKind));
  const distinctEffects = [...kinds].filter((k) => STATE_CHANGING_STEP_KINDS.has(k) || k === 'data_read').length;
  const persists = [...kinds].some((k) => PERSISTENT_STEP_KINDS.has(k));
  // Passing through somebody else's guard and BEING the thing that signs the
  // caller in are different facts. The second is this flow's own effect —
  // an `auth_call` detected in the handler's own body, surfaced as a
  // synthetic seed effect step — and it is what makes a login a core flow.
  const authSteps = steps.filter((s) => s.stepKind === 'auth_guard');
  const changesAuthState = authSteps.some((s) => s.metadata?.syntheticSeedEffect === true);
  const guarded = authSteps.length > 0;
  const userTriggered = USER_TRIGGERED.has(ep.kind);

  if (isSurface) {
    // Ordered among themselves so a real declared route sorts above a
    // convention-guessed file seed.
    const score = (ep.routePattern ? 0.2 : 0) + (userTriggered ? 0.1 : 0);
    return { tier: 'surface', score, reasons: ['no side effects traced from this entry point'] };
  }

  let score = 0;
  if (userTriggered) { score += 0.25; reasons.push('triggered by a user'); }
  if (persists) { score += 0.25; reasons.push('changes stored state'); }
  if (changesAuthState) { score += 0.25; reasons.push('changes who is signed in'); }
  else if (guarded) { score += 0.15; reasons.push('runs behind an auth check'); }
  if (distinctEffects > 0) {
    score += Math.min(distinctEffects, 4) * 0.08;
    reasons.push(`${distinctEffects} kind${distinctEffects === 1 ? '' : 's'} of side effect`);
  }
  if (ep.routePattern) score += 0.05;
  // A tie-break, NOT the old blanket `uiPenalty = 0.5`. That halved every UI
  // flow, so a page that writes to the database ranked below a server route
  // that did the same thing — a server-centric bias in a list that is supposed
  // to be ordered by importance to a user. The concern behind it (UI traces
  // wander through shared components) is now handled where it belongs: such a
  // trace reaches no effect, so it lands in `surface`. This small prior only
  // decides otherwise-identical flows, preferring the side that implements the
  // effect over the side that delegates to it.
  // Same tie-break, same reason: prefer the side that implements the effect
  // over the side that merely contains it. A handler wired to an interaction is
  // where the action happens; the page it sits on only hosts it.
  if (ep.kind === 'http_route' || ep.kind === 'ui_action') score += 0.03;

  // A trace that keeps going has usually wandered into shared utilities
  // rather than found more meaning. Bounded so a genuinely long flow is
  // demoted, not erased.
  const overLength = Math.max(0, steps.length - 8);
  if (overLength > 0) {
    score -= Math.min(0.2, overLength * 0.02);
    reasons.push(`${steps.length} steps — long traces drift into shared code`);
  }
  if (unknownOnly) {
    score *= 0.6;
    reasons.push('effects inferred, not resolved');
  }

  const tier: WorkflowTier = userTriggered && (persists || changesAuthState) ? 'core' : 'supporting';
  return { tier, score: Math.max(0, Math.round(score * 10000) / 10000), reasons };
}

// ─── Step classification ─────────────────────────────────────────────────────

function behaviorSignalsOf(node: EvidenceNode): string[] {
  const raw = node.metadata.behaviorSignals;
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function hasEffect(node: EvidenceNode, ctx: TraversalContext): boolean {
  return effectsFor(node, ctx).length > 0 || behaviorSignalsOf(node).some((s) => EFFECT_SIGNALS.has(s));
}

/** Side effects for a node; method nodes inherit their class's detections. */
function effectsFor(node: EvidenceNode, ctx: TraversalContext): DetectedSideEffect[] {
  const own = ctx.effectsByKey.get(node.stableKey);
  if (own) return own;
  const parentClass = node.metadata.parentClass;
  if (node.type === 'method' && typeof parentClass === 'string' && node.filePath) {
    return ctx.effectsByKey.get(`${node.filePath}#${parentClass}`) ?? [];
  }
  return [];
}

/** Collapses noisy helpers: trivial symbols, logging, pure formatting. */
function isNoisy(node: EvidenceNode, effects: DetectedSideEffect[], signals: string[]): boolean {
  if (effects.length > 0 || signals.some((s) => EFFECT_SIGNALS.has(s) || s === 'auth_check')) return false;
  return node.metadata.isTrivial === true || NOISE_NAME.test(node.name);
}

function classifyStep(node: EvidenceNode, effects: DetectedSideEffect[], signals: string[]): WorkflowStepKind {
  // Detected effects outrank name heuristics: a symbol named `saveSession`
  // that writes the DB is a data_write step, not an auth guard.
  const effectKinds = new Set(effects.map((e) => e.kind));
  if (effectKinds.has('database_write') || signals.includes('database_write')) return 'data_write';
  if (effectKinds.has('message_publish') || signals.includes('queue_enqueue')) return 'async_work';
  if (effectKinds.has('auth_call')) return 'auth_guard';
  // Before the generic `side_effect` fallback: a read is not a state change,
  // and `side_effect` counts as one — classifying reads there would tier every
  // read-only view as a flow that changes something.
  if (effectKinds.has('database_read')) return 'data_read';
  if (effectKinds.size > 0 || signals.includes('http_request') || signals.includes('filesystem')) return 'side_effect';
  if (signals.includes('auth_check') || AUTH_NAME.test(node.name)) return 'auth_guard';
  if (signals.includes('database_read')) return 'data_read';
  if (signals.includes('response_output')) return 'response';
  if (VALIDATION_NAME.test(node.name)) return 'validation';
  return 'transform';
}

function describeStep(
  node: EvidenceNode,
  kind: WorkflowStepKind,
  ep: DetectedEntrypoint,
  effects: DetectedSideEffect[],
  signals: string[],
): string {
  const where = `${node.name} (${node.filePath})`;
  // Name the actual effect targets (table, queue, URL) when detected — a step
  // description that says WHAT is touched beats a category label.
  const effectLabel = (wanted?: DetectedSideEffect['kind']) => {
    const relevant = wanted ? effects.filter((e) => e.kind === wanted) : effects;
    return relevant
      .map((e) => (e.target ? `${e.kind.replace(/_/g, ' ')} → ${e.target}` : e.kind.replace(/_/g, ' ')))
      .join(', ');
  };
  switch (kind) {
    case 'trigger':
      return `Entry point: ${ep.kind.replace(/_/g, ' ')}${ep.method ? ` ${ep.method}` : ''}${ep.routePattern ? ` ${ep.routePattern}` : ''} handled by ${where}`;
    case 'auth_guard': {
      const authTarget = effects.find((e) => e.kind === 'auth_call')?.target;
      return authTarget
        ? `Authenticates via ${authTarget} in ${where}`
        : `Checks authentication/authorization in ${where}`;
    }
    case 'validation':
      return `Validates input in ${where}`;
    case 'data_write':
      return `Persists data (${effectLabel('database_write') || 'database write'}) in ${where}`;
    case 'data_read':
      return `Reads data (${effectLabel('database_read') || 'database read'}) in ${where}`;
    case 'async_work':
      return `Enqueues async work (${effectLabel('message_publish') || 'queue job'}) in ${where}`;
    case 'side_effect':
      return `External effect (${effectLabel() || signals.filter((s) => EFFECT_SIGNALS.has(s)).join(', ') || 'external call'}) in ${where}`;
    case 'response':
      return `Sends the response from ${where}`;
    default:
      return `Transforms data in ${where}`;
  }
}

/**
 * Callback prefixes that carry no meaning of their own, and the bare callback
 * names left with nothing once they are stripped. Both lists are about the
 * SHAPE of a callback name, not about any domain: `handleSubmit` says the same
 * thing in every codebase ever written, which is why it needs its object
 * supplied from somewhere else.
 */
const CALLBACK_PREFIX = /^(?:handle|on)(?=[A-Z])/;
const CONTENTLESS_ACTION = /^(?:submit|click|change|press|key\w*|input|select|blur|focus|drag|drop|mouse\w*|touch\w*|action|event|it|this)$/i;

/** `handleCreateSet` -> `Create set`; `onDrop` -> `Drop`; `Form.handleSubmit` -> `Submit`. */
function humanizeAction(symbolName: string): string {
  // A member name (`Container.handleAddItem`, `Class.save`) already states its
  // owner, and the title states the owner separately — say it once.
  const member = symbolName.slice(symbolName.lastIndexOf('.') + 1);
  const stripped = member.replace(CALLBACK_PREFIX, '');
  const words = stripped
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/**
 * What a UI action DOES, in the repo's own words.
 *
 * `Page: FlashcardsView` names a place; `Create set — CreateFlashcardSet`
 * names an action, and an action is what a newcomer is looking for. The verb
 * comes from the handler symbol the author wrote and the object from the
 * component it lives in, so nothing is invented and no vocabulary is assumed.
 * When the handler name is pure callback boilerplate the component carries the
 * whole title rather than shipping a workflow called "Submit".
 */
function uiActionTitle(seed: EvidenceNode, ep: DetectedEntrypoint): string {
  const container = (ep.filePath.split('/').pop() ?? ep.filePath).replace(/\.[jt]sx?$/, '');
  const action = humanizeAction(seed.name);
  if (!action || CONTENTLESS_ACTION.test(action.replace(/\s+/g, ''))) {
    return `Action: ${container}`;
  }
  // When the handler and the file say the same thing, saying it twice is noise.
  if (action.replace(/\s+/g, '').toLowerCase() === container.replace(/[^A-Za-z0-9]/g, '').toLowerCase()) {
    return action;
  }
  return `${action} — ${container}`;
}

function workflowTitle(ep: DetectedEntrypoint, seed: EvidenceNode): string {
  if (ep.kind === 'http_route') {
    return `${ep.method ?? 'HTTP'} ${ep.routePattern ?? seed.name}`;
  }
  if (ep.kind === 'ui_action') return uiActionTitle(seed, ep);
  if (ep.kind === 'ui_route') return `Page: ${seed.name}`;
  if (ep.kind === 'message_consumer') return `Queue consumer: ${ep.routePattern ?? seed.name}`;
  return `${ep.kind.replace(/_/g, ' ')}: ${seed.name}`;
}

/** Deterministic purpose from trigger + purpose signals + effect summary. */
function classifyPurpose(
  ep: DetectedEntrypoint,
  seed: EvidenceNode,
  steps: WorkflowStep[],
  ctx: TraversalContext,
): string {
  const purposeCounts = new Map<string, number>();
  for (const step of steps) {
    const node = ctx.nodesByKey.get(step.nodeStableKey);
    const purposes = node?.metadata.purposeSignals;
    if (!Array.isArray(purposes)) continue;
    for (const p of purposes as string[]) purposeCounts.set(p, (purposeCounts.get(p) ?? 0) + 1);
  }
  const domain = [...purposeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const outcomes: string[] = [];
  if (steps.some((s) => s.stepKind === 'data_write')) outcomes.push('writes data');
  else if (steps.some((s) => s.stepKind === 'data_read')) outcomes.push('reads data');
  if (steps.some((s) => s.stepKind === 'async_work')) outcomes.push('enqueues async work');
  if (steps.some((s) => s.stepKind === 'response')) outcomes.push('responds to the caller');

  const trigger = ep.kind === 'http_route'
    ? `Handles ${ep.method ?? 'HTTP'} ${ep.routePattern ?? `requests via ${seed.name}`}`
    : `Handles ${ep.kind.replace(/_/g, ' ')} via ${seed.name}`;
  const domainPart = domain ? ` (${domain.replace(/_/g, ' ')})` : '';
  return outcomes.length > 0 ? `${trigger}${domainPart}: ${outcomes.join(', ')}` : `${trigger}${domainPart}`;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Returns workflow stable_key -> workflows.id (candidate ranking keys on it). */
export async function persistWorkflows(
  snapshotId: string,
  workflows: ExtractedWorkflow[],
  nodeIdMap: Map<string, string>,
  entrypointIdMap?: Map<DetectedEntrypoint, string>,
): Promise<Map<string, string>> {
  const workflowIdMap = new Map<string, string>();

  for (const wf of workflows) {
    const wfResult = await query(
      `INSERT INTO workflows (snapshot_id, title, trigger_type, purpose, confidence, stable_key, entrypoint_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (snapshot_id, stable_key) DO UPDATE
         SET title = EXCLUDED.title, trigger_type = EXCLUDED.trigger_type,
             purpose = EXCLUDED.purpose, confidence = EXCLUDED.confidence,
             entrypoint_id = EXCLUDED.entrypoint_id, metadata = EXCLUDED.metadata
       RETURNING id`,
      [snapshotId, wf.title, wf.triggerType, wf.purpose, wf.confidence, wf.stableKey,
       entrypointIdMap?.get(wf.entrypoint) ?? null,
       // tier/reasons written from the top-level fields rather than trusting
       // each producer's metadata bag — journeys and config flows set the
       // fields but build their own metadata.
       JSON.stringify({
         importance_score: wf.importanceScore,
         external_dependencies: wf.externalDependencies,
         ...(wf.metadata ?? {}),
         tier: wf.tier,
         ranking_reasons: wf.rankingReasons,
       })],
    );

    if (wfResult.rows.length === 0) continue;
    const workflowId = wfResult.rows[0].id as string;
    workflowIdMap.set(wf.stableKey, workflowId);

    // Clear old steps in case this is an upsert
    await query(`DELETE FROM workflow_steps WHERE workflow_id = $1`, [workflowId]);

    // One multi-VALUES INSERT per workflow — per-step rows cost a round
    // trip each across ~60 workflows × ~10 steps (Track C).
    if (wf.steps.length > 0) {
      const values: unknown[] = [];
      const tuples = wf.steps.map((step, j) => {
        values.push(
          workflowId, step.stepOrder, nodeIdMap.get(step.nodeStableKey) ?? null, step.filePath,
          step.symbolName ?? null, step.lineStart ?? null, step.lineEnd ?? null, step.stepKind,
          step.deterministicDescription, '{}', JSON.stringify(step.metadata ?? {}),
        );
        const base = j * 11;
        return `(${Array.from({ length: 11 }, (_, k) => `$${base + k + 1}`).join(', ')})`;
      });
      await query(
        `INSERT INTO workflow_steps
           (workflow_id, step_order, node_id, file_path, symbol_name, line_start, line_end, step_kind, deterministic_description, role_relevance, metadata)
         VALUES ${tuples.join(', ')}`,
        values,
      );
    }
  }

  return workflowIdMap;
}
