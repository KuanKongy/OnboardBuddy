import type { EvidenceGraph, EvidenceNode } from '../types/analysis.js';
import type { DetectedEntrypoint } from './entrypointDetector.js';
import type { DetectedSideEffect } from './sideEffectDetector.js';
import type { ExtractedWorkflow } from './workflowExtractor.js';
import type { ChurnStats } from './churnService.js';
import { budgetForDepth, type SemanticDepth } from './budgets.js';
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
  for (const ep of input.entrypoints) {
    entrypointKeys.add(ep.symbolStableKey ?? ep.nodeStableKey);
    entrypointKeys.add(ep.nodeStableKey);
    if (ep.kind === 'http_route') {
      routeEntrypointKeys.add(ep.symbolStableKey ?? ep.nodeStableKey);
      routeEntrypointKeys.add(ep.nodeStableKey);
    }
  }

  const effectCount = new Map<string, number>();
  for (const se of input.sideEffects) {
    const key = se.symbolStableKey ?? se.nodeStableKey;
    effectCount.set(key, (effectCount.get(key) ?? 0) + 1);
    effectCount.set(se.nodeStableKey, (effectCount.get(se.nodeStableKey) ?? 0) + 1);
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
    const isEntry = entrypointKeys.has(key) ? 1 : 0;
    const ownsRouteOrSchema =
      schemaOwners.has(key) || routeHandlers.has(key) || routeEntrypointKeys.has(key) ? 1 : 0;
    const tested = testedFiles.has(filePath) || testedFiles.has(key) ? 1 : 0;
    const configRelevant = signals.includes('env_read') || purposes.includes('configuration') ? 1 : 0;
    const churnStats = churnFor(filePath);
    const wfCount = workflowCount.get(key) ?? 0;

    const raw: Record<CandidateSignal, number> = {
      workflowParticipation: wfCount,
      fanCentrality: fi + fo * 0.5,
      exportedSurface: exported,
      sideEffects: effects,
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
    if (isEntry) reasons.push('Entry point');
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
    const effectSteps = wf.steps.filter((s) =>
      s.stepKind === 'data_read' || s.stepKind === 'data_write' ||
      s.stepKind === 'async_work' || s.stepKind === 'side_effect').length;
    const raw: Record<CandidateSignal, number> = {
      workflowParticipation: wf.steps.length,
      fanCentrality: 0,
      exportedSurface: 0,
      sideEffects: effectSteps,
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
      reasons: [
        `Traces ${wf.triggerType} through ${wf.steps.length} steps`,
        ...(effectSteps > 0 ? [`Reaches ${effectSteps} side-effect step${effectSteps > 1 ? 's' : ''}`] : []),
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
  let written = 0;
  for (const r of rankings.slice(0, PERSIST_LIMIT)) {
    const nodeId = r.targetType === 'workflow' ? null : nodeIdMap.get(r.stableKey);
    const targetId = r.targetType === 'workflow' ? workflowIdMap.get(r.stableKey) : null;
    if (r.targetType !== 'workflow' && !nodeId) continue;

    await query(
      `INSERT INTO criticality_scores
         (snapshot_id, phase, view, target_type, target_node_id, target_id, stable_key, role, score, score_breakdown, reasons)
       VALUES ($1, 'candidate', 'candidate', $2, $3, $4, $5, 'general', $6, $7, $8)
       ON CONFLICT (snapshot_id, phase, view, target_type, stable_key, COALESCE(role, ''))
       DO UPDATE SET score = EXCLUDED.score, score_breakdown = EXCLUDED.score_breakdown,
                     reasons = EXCLUDED.reasons, target_node_id = EXCLUDED.target_node_id,
                     target_id = EXCLUDED.target_id`,
      [
        snapshotId,
        r.targetType,
        nodeId ?? null,
        targetId ?? null,
        r.stableKey,
        r.score,
        JSON.stringify({ normalized: r.breakdown, raw: r.raw }),
        r.reasons,
      ],
    );
    written++;
  }
  return written;
}
