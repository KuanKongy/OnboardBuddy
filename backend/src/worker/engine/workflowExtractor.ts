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
   * 'trigger' kind used to swallow).
   */
  metadata?: { syntheticReturn?: boolean; syntheticSeedEffect?: boolean };
}

export interface ExtractedWorkflow {
  title: string;
  triggerType: string;
  purpose: string;
  stableKey: string;
  confidence: 'high' | 'medium' | 'low';
  entrypoint: DetectedEntrypoint;
  steps: WorkflowStep[];
  /** Raw ordering hint only — real ranking is criticality_scores rows. */
  importanceScore: number;
  externalDependencies: string[];
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
  const ctx = buildTraversalContext(input);
  const workflows: ExtractedWorkflow[] = [];
  const seenKeys = new Set<string>();

  for (const ep of input.entrypoints) {
    for (const seed of seedsForEntrypoint(ep, ctx)) {
      const wf = trace(ep, seed, ctx);
      if (!wf || seenKeys.has(wf.stableKey)) continue;
      seenKeys.add(wf.stableKey);
      workflows.push(wf);
    }
  }

  // Score ties: an AST-detected route (`PUT /dataset/:id/:kind`) beats a
  // convention-guessed seed over the same steps — it carries the real
  // method + route pattern, so it survives duplicate suppression.
  return suppressNearDuplicates(workflows.sort((a, b) =>
    b.importanceScore - a.importanceScore
    || Number(Boolean(b.entrypoint.routePattern)) - Number(Boolean(a.entrypoint.routePattern))));
}

/**
 * Drops workflows whose step nodes are ≥80% shared with a higher-ranked
 * workflow — UI-route seeds especially produce many traces over the same
 * few components, which crowds real flows out of the list.
 */
function suppressNearDuplicates(sorted: ExtractedWorkflow[]): ExtractedWorkflow[] {
  const kept: Array<{ wf: ExtractedWorkflow; keys: Set<string> }> = [];
  for (const wf of sorted) {
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

function trace(ep: DetectedEntrypoint, seed: EvidenceNode, ctx: TraversalContext): ExtractedWorkflow | null {
  const steps: WorkflowStep[] = [];
  const visited = new Set<string>();
  const externals: string[] = [];
  let effectCount = 0;

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
      if (effects.length > 0 || signals.some((s) => EFFECT_SIGNALS.has(s))) effectCount++;
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
            : null;
          if (!stepKind) continue; // reads/noise stay implicit
          pushStep(
            node,
            stepKind,
            stepKind === 'data_write'
              ? `Writes data${effect.target ? ` (${effect.target})` : ''} from ${node.name}`
              : `Enqueues async work${effect.target ? ` (${effect.target})` : ''} from ${node.name}`,
            { syntheticSeedEffect: true },
          );
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

  // A trigger with a response but nothing else is honest; a trigger alone,
  // or a trace that never reaches an effect/output, is not a workflow.
  if (steps.length < 2 || effectCount === 0) return null;

  // Express handlers respond after their callees run; make that explicit.
  // Tagged syntheticReturn: it re-references the seed node, and rendering it
  // as the same graph node would draw a bogus last→first cycle.
  const seedSignals = behaviorSignalsOf(seed);
  if (seedSignals.includes('response_output') && !steps.some((s) => s.stepKind === 'response')) {
    pushStep(seed, 'response', `Sends the response back from ${seed.name}`, { syntheticReturn: true });
  }

  const sideEffectSteps = steps.filter((s) =>
    s.stepKind === 'data_read' || s.stepKind === 'data_write' || s.stepKind === 'async_work' || s.stepKind === 'side_effect').length;

  // UI-route traces rarely reach real effects and mostly re-walk shared
  // components — rank them below server flows of the same size.
  const uiPenalty = ep.kind === 'ui_route' ? 0.5 : 1;

  return {
    title: workflowTitle(ep, seed),
    triggerType: ep.kind === 'http_route' ? `HTTP ${ep.method ?? 'handler'}`
      : ep.kind === 'ui_route' ? 'UI page' : ep.kind,
    purpose: classifyPurpose(ep, seed, steps, ctx),
    stableKey: `wf:${ep.nodeStableKey}:${seed.name}`,
    confidence: steps.length >= 4 && sideEffectSteps > 0 ? 'high' : steps.length >= 3 ? 'medium' : 'low',
    entrypoint: ep,
    steps,
    importanceScore: (steps.length * 0.1 + sideEffectSteps * 0.2) * uiPenalty,
    externalDependencies: externals,
  };
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
    case 'auth_guard':
      return `Checks authentication/authorization in ${where}`;
    case 'validation':
      return `Validates input in ${where}`;
    case 'data_write':
      return `Persists data (${effectLabel('database_write') || 'database write'}) in ${where}`;
    case 'data_read':
      return `Reads data in ${where}`;
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

function workflowTitle(ep: DetectedEntrypoint, seed: EvidenceNode): string {
  if (ep.kind === 'http_route') {
    return `${ep.method ?? 'HTTP'} ${ep.routePattern ?? seed.name}`;
  }
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
       JSON.stringify({ importance_score: wf.importanceScore, external_dependencies: wf.externalDependencies })],
    );

    if (wfResult.rows.length === 0) continue;
    const workflowId = wfResult.rows[0].id as string;
    workflowIdMap.set(wf.stableKey, workflowId);

    // Clear old steps in case this is an upsert
    await query(`DELETE FROM workflow_steps WHERE workflow_id = $1`, [workflowId]);

    for (const step of wf.steps) {
      await query(
        `INSERT INTO workflow_steps
           (workflow_id, step_order, node_id, file_path, symbol_name, line_start, line_end, step_kind, deterministic_description, role_relevance, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          workflowId,
          step.stepOrder,
          nodeIdMap.get(step.nodeStableKey) ?? null,
          step.filePath,
          step.symbolName ?? null,
          step.lineStart ?? null,
          step.lineEnd ?? null,
          step.stepKind,
          step.deterministicDescription,
          '{}',
          JSON.stringify(step.metadata ?? {}),
        ],
      );
    }
  }

  return workflowIdMap;
}
