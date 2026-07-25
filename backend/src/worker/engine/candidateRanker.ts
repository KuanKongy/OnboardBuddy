import type { EvidenceGraph, EvidenceNode } from '../types/analysis.js';
import type { DetectedEntrypoint } from './entrypointDetector.js';
import type { DetectedSideEffect } from './sideEffectDetector.js';
import type { ExtractedWorkflow } from './workflowExtractor.js';
import type { ChurnStats } from './churnService.js';
import { budgetForDepth, type SemanticDepth } from './budgets.js';
import { isTestOrFixturePath } from './testPaths.js';
import { query } from '../../lib/db.js';

/**
 * Phase A deterministic candidate ranking (doc/Pipeline.md "Phase A").
 * Cheap and auditable, runs before any LLM call. Writes criticality_scores
 * rows with phase='candidate', view='candidate' and drives depth gating.
 * Every signal is normalized to [0, 1] within the snapshot (per target type)
 * before weighting; scores are never presented without reasons.
 */

export const CANDIDATE_WEIGHTS = {
  workflowParticipation: 0.2,
  fanCentrality: 0.15,
  exportedSurface: 0.15,
  sideEffects: 0.15,
  entrypointParticipation: 0.1,
  routeSchemaOwnership: 0.1,
  testProximity: 0.05,
  configRelevance: 0.05,
  churn: 0.05,
} as const;

export type CandidateSignal = keyof typeof CANDIDATE_WEIGHTS;

/**
 * How much of its fan-in a behaviour-free module keeps. Damped, not zeroed:
 * a shared module everything depends on is still worth knowing, just not
 * ahead of the code that does something.
 */
const LOW_CONTENT_FAN_DAMPING = 0.35;

export interface CandidateRanking {
  targetType: 'symbol' | 'file' | 'workflow';
  stableKey: string;
  score: number;
  /** Normalized [0,1] per-signal contributions (before weights). */
  breakdown: Record<CandidateSignal, number>;
  /** Raw signal values, kept for auditability. */
  raw: Record<CandidateSignal, number>;
  reasons: string[];
}

const SYMBOL_NODE_TYPES = new Set(['function', 'method', 'class', 'interface', 'type', 'enum', 'variable']);

export interface RankCandidatesInput {
  graph: EvidenceGraph;
  entrypoints: DetectedEntrypoint[];
  sideEffects: DetectedSideEffect[];
  workflows: ExtractedWorkflow[];
  /** File path or top-level dir -> churn stats. Missing churn = 0-weight. */
  churn?: Map<string, ChurnStats>;
}

export function rankCandidates(input: RankCandidatesInput): CandidateRanking[] {
  const churn = input.churn ?? new Map<string, ChurnStats>();

  // ── Index the graph ────────────────────────────────────────────────────────
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  const testedFiles = new Set<string>();
  const schemaOwners = new Set<string>();
  const routeHandlers = new Set<string>();

  for (const e of input.graph.edges) {
    if (e.type === 'calls' || e.type === 'imports') {
      fanIn.set(e.targetKey, (fanIn.get(e.targetKey) ?? 0) + 1);
      fanOut.set(e.sourceKey, (fanOut.get(e.sourceKey) ?? 0) + 1);
    } else if (e.type === 'tests') {
      testedFiles.add(e.targetKey);
    } else if (e.type === 'touches_schema') {
      schemaOwners.add(e.sourceKey);
    } else if (e.type === 'handles_route') {
      routeHandlers.add(e.targetKey);
    }
  }

  const entrypointKeys = new Set<string>();
  const routeEntrypointKeys = new Set<string>();
  const uiOnlyEntrypointKeys = new Set<string>();
  for (const ep of input.entrypoints) {
    entrypointKeys.add(ep.symbolStableKey ?? ep.nodeStableKey);
    entrypointKeys.add(ep.nodeStableKey);
    if (ep.kind === 'http_route') {
      routeEntrypointKeys.add(ep.symbolStableKey ?? ep.nodeStableKey);
      routeEntrypointKeys.add(ep.nodeStableKey);
    }
  }
  // UI pages are entrypoints, but EVERY page is one — full entrypoint credit
  // made the top of the ranking a wall of near-identical page components
  // while the pipeline code they render never surfaced. Pages that are ONLY
  // ui_route entrypoints get half credit; anything that is also a route
  // handler / job / CLI keeps full weight.
  for (const ep of input.entrypoints) {
    if (ep.kind !== 'ui_route') continue;
    for (const key of [ep.symbolStableKey ?? ep.nodeStableKey, ep.nodeStableKey]) {
      uiOnlyEntrypointKeys.add(key);
    }
  }
  for (const ep of input.entrypoints) {
    if (ep.kind === 'ui_route') continue;
    uiOnlyEntrypointKeys.delete(ep.symbolStableKey ?? ep.nodeStableKey);
    uiOnlyEntrypointKeys.delete(ep.nodeStableKey);
  }

  const effectCount = new Map<string, number>();
  // Distinct KINDS, not raw occurrences. Ten writes to the same table is one
  // thing a symbol does; a write plus an enqueue plus an outbound call is
  // three, and that breadth is what makes a symbol worth learning first.
  const effectKinds = new Map<string, Set<string>>();
  const addKind = (key: string, kind: string) => {
    const set = effectKinds.get(key);
    if (set) set.add(kind);
    else effectKinds.set(key, new Set([kind]));
  };
  for (const se of input.sideEffects) {
    const key = se.symbolStableKey ?? se.nodeStableKey;
    effectCount.set(key, (effectCount.get(key) ?? 0) + 1);
    effectCount.set(se.nodeStableKey, (effectCount.get(se.nodeStableKey) ?? 0) + 1);
    addKind(key, se.kind);
    addKind(se.nodeStableKey, se.kind);
  }

  const workflowCount = new Map<string, number>();
  for (const wf of input.workflows) {
    for (const step of wf.steps) {
      workflowCount.set(step.nodeStableKey, (workflowCount.get(step.nodeStableKey) ?? 0) + 1);
      workflowCount.set(step.filePath, (workflowCount.get(step.filePath) ?? 0) + 1);
    }
  }

  const churnFor = (filePath: string | null): ChurnStats | undefined => {
    if (!filePath) return undefined;
    const own = churn.get(filePath);
    if (own) return own;
    const topDir = filePath.includes('/') ? filePath.split('/')[0]! : '';
    return topDir ? churn.get(topDir) : undefined;
  };

  // ── Raw signals per target ─────────────────────────────────────────────────
  interface RawTarget {
    targetType: CandidateRanking['targetType'];
    stableKey: string;
    node?: EvidenceNode;
    raw: Record<CandidateSignal, number>;
    reasons: string[];
  }
  const targets: RawTarget[] = [];

  for (const node of input.graph.nodes) {
    const isFile = node.type === 'module' || node.type === 'file';
    const isSymbol = SYMBOL_NODE_TYPES.has(node.type);
    if (!isFile && !isSymbol) continue;

    const key = node.stableKey;
    const filePath = node.filePath ?? key;
    // Tests and fixtures are evidence (testProximity, clusters), never
    // ranked learning targets — a fixture file once out-ranked real routes.
    if (isTestOrFixturePath(filePath)) continue;
    const signals = Array.isArray(node.metadata.behaviorSignals)
      ? (node.metadata.behaviorSignals as string[]) : [];
    const purposes = Array.isArray(node.metadata.purposeSignals)
      ? (node.metadata.purposeSignals as string[]) : [];

    const fi = fanIn.get(key) ?? 0;
    const fo = fanOut.get(key) ?? 0;
    const exported = isFile
      ? (Array.isArray(node.metadata.exportedSymbols) ? (node.metadata.exportedSymbols as string[]).length : 0)
      : node.exported ? 1 : 0;
    const effects = effectCount.get(key) ?? 0;
    const isEntry = entrypointKeys.has(key) ? (uiOnlyEntrypointKeys.has(key) ? 0.5 : 1) : 0;
    const ownsRouteOrSchema =
      schemaOwners.has(key) || routeHandlers.has(key) || routeEntrypointKeys.has(key) ? 1 : 0;
    const tested = testedFiles.has(filePath) || testedFiles.has(key) ? 1 : 0;
    const configRelevant = signals.includes('env_read') || purposes.includes('configuration') ? 1 : 0;
    const churnStats = churnFor(filePath);
    const wfCount = workflowCount.get(key) ?? 0;

    /**
     * Damps centrality for modules that everything imports but which do
     * nothing on their own.
     *
     * `fanCentrality` alone handed a top-quartile score to `cn()`,
     * `utils.ts`, a types file — anything imported everywhere. Those then
     * occupied slots in Critical 25%, which is supposed to answer "what should
     * I read first", and pushed out the routes and handlers that actually
     * carry behaviour. Popularity is not importance: a file with no effects,
     * in no workflow, owning no route or schema, is infrastructure. It is
     * damped rather than zeroed, because a genuinely central shared module is
     * still worth knowing about — just not before the login flow.
     */
    const carriesBehaviour = effects > 0 || wfCount > 0 || isEntry > 0 || ownsRouteOrSchema > 0;
    const fanCentrality = (fi + fo * 0.5) * (carriesBehaviour ? 1 : LOW_CONTENT_FAN_DAMPING);

    const raw: Record<CandidateSignal, number> = {
      workflowParticipation: wfCount,
      fanCentrality,
      exportedSurface: exported,
      // Breadth of behaviour, not repetition of it.
      sideEffects: effectKinds.get(key)?.size ?? 0,
      entrypointParticipation: isEntry,
      routeSchemaOwnership: ownsRouteOrSchema,
      testProximity: tested,
      configRelevance: configRelevant,
      churn: churnStats?.commitCount90d ?? 0,
    };

    const reasons: string[] = [];
    if (wfCount > 0) reasons.push(`Participates in ${wfCount} workflow${wfCount > 1 ? 's' : ''}`);
    if (fi >= 3) reasons.push(isFile ? `Imported by ${fi} files` : `Called by ${fi} symbols`);
    if (isSymbol && node.exported) reasons.push('Exported public surface');
    if (isFile && exported >= 3) reasons.push(`Exports ${exported} symbols`);
    if (effects > 0) reasons.push(`Has ${effects} detected side effect${effects > 1 ? 's' : ''}`);
    if (isEntry === 1) reasons.push('Entry point');
    else if (isEntry > 0) reasons.push('Entry point (UI page — reduced weight)');
    if (schemaOwners.has(key)) reasons.push('Touches database schema');
    if (routeHandlers.has(key) || routeEntrypointKeys.has(key)) reasons.push('Handles a route');
    if (tested) reasons.push('Covered by tests');
    if (configRelevant) reasons.push('Reads configuration/environment');
    if ((churnStats?.commitCount90d ?? 0) > 0) {
      reasons.push(`${churnStats!.commitCount90d} commits in the last 90 days`);
    }

    targets.push({ targetType: isFile ? 'file' : 'symbol', stableKey: key, node, raw, reasons });
  }

  for (const wf of input.workflows) {
    const effectStepKinds = new Set(
      wf.steps.map((s) => s.stepKind).filter((k) =>
        k === 'data_read' || k === 'data_write' || k === 'async_work' || k === 'side_effect'),
    );
    const raw: Record<CandidateSignal, number> = {
      // The workflow's own tier-aware score, NOT its length. `wf.steps.length`
      // here was the same length-is-importance bug the extractor had, in a
      // second place: it fed criticality_scores, so a 20-step trace through
      // shared components outranked a 4-step login in Critical 25% as well as
      // in the workflow list.
      workflowParticipation: wf.importanceScore,
      fanCentrality: 0,
      exportedSurface: 0,
      // Breadth of behaviour, matching how symbols are now scored.
      sideEffects: effectStepKinds.size,
      entrypointParticipation: 1,
      routeSchemaOwnership: wf.steps.some((s) => s.stepKind === 'data_read' || s.stepKind === 'data_write') ? 1 : 0,
      testProximity: 0,
      configRelevance: 0,
      churn: 0,
    };
    targets.push({
      targetType: 'workflow',
      stableKey: wf.stableKey,
      raw,
      // The extractor already explained its own ranking in plain language;
      // repeating the step count here contradicted it.
      reasons: [
        `${wf.tier === 'core' ? 'Core user flow' : wf.tier === 'surface' ? 'Entry point, no traced effects' : 'Supporting flow'} — ${wf.triggerType}`,
        ...wf.rankingReasons.slice(0, 2),
      ],
    });
  }

  // ── Normalize per target type, weight, score ──────────────────────────────
  const rankings: CandidateRanking[] = [];
  const byType = new Map<string, RawTarget[]>();
  for (const t of targets) byType.set(t.targetType, [...(byType.get(t.targetType) ?? []), t]);

  for (const group of byType.values()) {
    const maxima = {} as Record<CandidateSignal, number>;
    for (const signal of Object.keys(CANDIDATE_WEIGHTS) as CandidateSignal[]) {
      maxima[signal] = Math.max(...group.map((t) => t.raw[signal]), 0);
    }
    for (const t of group) {
      const breakdown = {} as Record<CandidateSignal, number>;
      let score = 0;
      for (const [signal, weight] of Object.entries(CANDIDATE_WEIGHTS) as Array<[CandidateSignal, number]>) {
        const normalized = maxima[signal] > 0 ? t.raw[signal] / maxima[signal] : 0;
        breakdown[signal] = Math.round(normalized * 1000) / 1000;
        score += normalized * weight;
      }
      rankings.push({
        targetType: t.targetType,
        stableKey: t.stableKey,
        score: Math.round(score * 100000) / 100000,
        breakdown,
        raw: t.raw,
        reasons: t.reasons,
      });
    }
  }

  return rankings.sort((a, b) => b.score - a.score);
}

// ─── Depth gating (doc/Pipeline.md "Depth gating") ───────────────────────────

export interface DepthGatingResult {
  /** Symbol stable keys selected for LLM semantic records, best first. */
  selected: string[];
  /** Symbols represented by facts-only records (no LLM call). */
  factsOnly: string[];
}

/**
 * Decides which symbols get LLM semantic records at a given depth. Everything
 * not selected still gets a facts-only record so retrieval always has
 * something honest to return.
 */
export function gateSymbolsForDepth(
  depth: SemanticDepth,
  rankings: CandidateRanking[],
  input: Pick<RankCandidatesInput, 'graph' | 'entrypoints' | 'workflows'>,
): DepthGatingResult {
  const budget = budgetForDepth(depth);
  const symbolNodes = input.graph.nodes.filter((n) => SYMBOL_NODE_TYPES.has(n.type));
  const nodesByKey = new Map(symbolNodes.map((n) => [n.stableKey, n]));
  const scoreByKey = new Map(
    rankings.filter((r) => r.targetType === 'symbol').map((r) => [r.stableKey, r.score]),
  );
  const bySDesc = (a: string, b: string) => (scoreByKey.get(b) ?? 0) - (scoreByKey.get(a) ?? 0);

  const entrypointKeys = new Set<string>();
  for (const ep of input.entrypoints) {
    if (ep.symbolStableKey) entrypointKeys.add(ep.symbolStableKey);
  }
  const workflowKeys = new Set<string>();
  for (const wf of input.workflows) {
    for (const step of wf.steps) workflowKeys.add(step.nodeStableKey);
  }
  const fanIn = new Map<string, number>();
  for (const e of input.graph.edges) {
    if (e.type === 'calls') fanIn.set(e.targetKey, (fanIn.get(e.targetKey) ?? 0) + 1);
  }
  const isRouteish = (n: EvidenceNode) =>
    entrypointKeys.has(n.stableKey) || /route|controller|handler/i.test(n.filePath ?? '');

  let selected: string[];
  if (depth === 'full') {
    // Every symbol, including trivial ones.
    selected = symbolNodes.map((n) => n.stableKey).sort(bySDesc);
  } else {
    const cheapSet = symbolNodes
      .filter((n) => n.metadata.isTrivial !== true && (n.exported === true || isRouteish(n)))
      .map((n) => n.stableKey);
    if (depth === 'cheap') {
      selected = cheapSet.sort(bySDesc);
      // Target ~ top 25% of extracted symbols, inside the hard budget.
      const targetCount = Math.max(1, Math.ceil(symbolNodes.length * 0.25));
      selected = selected.slice(0, Math.min(targetCount, budget.maxSymbolsToLlm));
    } else {
      const set = new Set(cheapSet);
      // Spec: standard = cheap + ALL workflow participants. Participation in
      // a traced workflow earns a record even for otherwise-trivial symbols.
      for (const key of workflowKeys) {
        if (nodesByKey.has(key)) set.add(key);
      }
      for (const n of symbolNodes) {
        if (n.metadata.isTrivial !== true && (fanIn.get(n.stableKey) ?? 0) >= 5) set.add(n.stableKey);
      }
      selected = [...set].sort(bySDesc);
    }
  }
  selected = selected.slice(0, budget.maxSymbolsToLlm);

  const selectedSet = new Set(selected);
  const factsOnly = symbolNodes.map((n) => n.stableKey).filter((k) => !selectedSet.has(k));
  return { selected, factsOnly };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const PERSIST_LIMIT = 500;

/**
 * Writes Phase A rows (phase='candidate', view='candidate'). Candidate
 * ranking is role-independent; rows are stored under role='general' (the
 * projection interim consumers read). Phase B adds the per-role views.
 */
export async function persistCandidateRankings(
  snapshotId: string,
  rankings: CandidateRanking[],
  nodeIdMap: Map<string, string>,
  workflowIdMap: Map<string, string>,
): Promise<number> {
  // Chunked multi-VALUES upserts — the per-row loop cost ~500 round trips
  // against the remote pooler (latency overhaul Track C).
  const persistable = rankings.slice(0, PERSIST_LIMIT)
    .map((r) => ({
      r,
      nodeId: r.targetType === 'workflow' ? null : nodeIdMap.get(r.stableKey) ?? null,
      targetId: r.targetType === 'workflow' ? workflowIdMap.get(r.stableKey) ?? null : null,
    }))
    .filter(({ r, nodeId }) => r.targetType === 'workflow' || nodeId !== null);

  const CHUNK = 250;
  let written = 0;
  for (let i = 0; i < persistable.length; i += CHUNK) {
    const part = persistable.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = part.map(({ r, nodeId, targetId }, j) => {
      values.push(snapshotId, r.targetType, nodeId, targetId, r.stableKey, r.score,
        JSON.stringify({ normalized: r.breakdown, raw: r.raw }), r.reasons);
      const base = j * 8;
      return `($${base + 1}, 'candidate', 'candidate', $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, 'general', $${base + 6}, $${base + 7}, $${base + 8})`;
    });
    await query(
      `INSERT INTO criticality_scores
         (snapshot_id, phase, view, target_type, target_node_id, target_id, stable_key, role, score, score_breakdown, reasons)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (snapshot_id, phase, view, target_type, stable_key, COALESCE(role, ''))
       DO UPDATE SET score = EXCLUDED.score, score_breakdown = EXCLUDED.score_breakdown,
                     reasons = EXCLUDED.reasons, target_node_id = EXCLUDED.target_node_id,
                     target_id = EXCLUDED.target_id`,
      values,
    );
    written += part.length;
  }
  return written;
}
