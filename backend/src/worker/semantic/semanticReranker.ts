/**
 * Phase B semantic reranking (doc/Pipeline.md "rerank-v1"): after
 * synthesis, the strong model scores the candidate top slice per view;
 * each LLM score is blended 50/50 with deterministic per-view features and
 * normalized within the snapshot. Catches low-degree but vital code that
 * Phase A under-ranks. Writes criticality_scores rows with
 * phase='semantic' — one row per (view, target), plus one
 * critical_for_role row per role.
 */

import { query } from '../../lib/db.js';
import { mapLimit } from '../../lib/parallel.js';
import type { SemanticContext } from './context.js';
import type { CandidateRanking, CandidateSignal } from '../engine/candidateRanker.js';
import { PROMPT_VERSIONS, OUTPUT_RULES } from './recordTypes.js';
import type { StoredRecord } from './recordStore.js';
import type { SynthesisResult } from './synthesisPass.js';
import type { DeveloperRole, SemanticView } from './projections.js';

const TOP_SLICE_SYMBOLS_FILES = 40;
const TARGETS_PER_RERANK_CALL = 10;
const ROLES: DeveloperRole[] = ['backend', 'frontend', 'devops', 'qa', 'general'];

export interface RerankTarget {
  targetType: 'symbol' | 'file' | 'workflow' | 'cluster' | 'capability';
  stableKey: string;
  name: string;
  summary: string;
  candidateBreakdown: Partial<Record<CandidateSignal, number>>;
  candidateScore: number;
  record: StoredRecord | null;
  inCapability: boolean;
}

export interface RerankResult {
  targets: number;
  rowsWritten: number;
  llmCalls: number;
}

// ── Deterministic per-view features ──────────────────────────────────────────

/**
 * Heuristic view features over Phase A signals + record fields, each in
 * [0,1]. The spec fixes the blend (50/50), not these formulas — they are
 * tunable constants, stored per row in score_breakdown for audit.
 */
export function deterministicViewScores(target: RerankTarget): Record<Exclude<SemanticView, 'critical_for_role'>, number> {
  const b = target.candidateBreakdown;
  const record = target.record?.record;
  const risks = Math.min(1, (record?.risks_invariants?.length ?? 0) / 3);
  const businessConcepts = Math.min(1, (record?.business_concepts?.length ?? 0) / 5);
  return {
    critical_for_runtime: clamp01(0.4 * (b.sideEffects ?? 0) + 0.3 * (b.entrypointParticipation ?? 0) + 0.3 * (b.fanCentrality ?? 0)),
    critical_for_business: clamp01(0.5 * businessConcepts + 0.5 * (target.inCapability ? 1 : 0)),
    critical_for_onboarding: clamp01(0.5 * target.candidateScore + 0.3 * (b.entrypointParticipation ?? 0) + 0.2 * (b.workflowParticipation ?? 0)),
    critical_for_change_risk: clamp01(0.4 * (b.churn ?? 0) + 0.3 * (b.fanCentrality ?? 0) + 0.3 * risks),
    critical_for_architecture: clamp01(0.5 * (b.fanCentrality ?? 0) + 0.5 * (b.routeSchemaOwnership ?? 0)),
    critical_for_workflow: clamp01(b.workflowParticipation ?? 0),
  };
}

/** Path/signal heuristics for per-role deterministic relevance. */
export function deterministicRoleScores(target: RerankTarget): Record<DeveloperRole, number> {
  const b = target.candidateBreakdown;
  const key = target.stableKey.toLowerCase();
  const isUi = /\.(tsx|jsx|vue|svelte)|component|frontend|ui\//.test(key);
  const isApiOrDb = (b.routeSchemaOwnership ?? 0) > 0 || (b.sideEffects ?? 0) > 0;
  return {
    backend: clamp01(0.5 * (isApiOrDb ? 1 : 0) + 0.3 * (b.sideEffects ?? 0) + 0.2 * (b.entrypointParticipation ?? 0)),
    frontend: clamp01(0.7 * (isUi ? 1 : 0) + 0.3 * (b.entrypointParticipation ?? 0)),
    devops: clamp01(0.7 * (b.configRelevance ?? 0) + 0.3 * (b.churn ?? 0)),
    qa: clamp01(0.6 * (b.testProximity ?? 0) + 0.4 * (b.workflowParticipation ?? 0)),
    general: clamp01(target.candidateScore),
  };
}

// ── Target selection ─────────────────────────────────────────────────────────

export function selectRerankTargets(
  ctx: Pick<SemanticContext, 'rankings' | 'workflows' | 'architecture'>,
  symbolRecords: Map<string, StoredRecord>,
  synthesis: SynthesisResult,
  capabilityMemberKeys: Set<string>,
): RerankTarget[] {
  const targets: RerankTarget[] = [];
  const rankingByKey = new Map(ctx.rankings.map((r) => [`${r.targetType}:${r.stableKey}`, r]));
  const breakdownOf = (r: CandidateRanking | undefined) => r?.breakdown ?? {};

  let taken = 0;
  for (const ranking of ctx.rankings) {
    if (taken >= TOP_SLICE_SYMBOLS_FILES) break;
    if (ranking.targetType === 'workflow') continue;
    const record = ranking.targetType === 'symbol'
      ? symbolRecords.get(ranking.stableKey) ?? null
      : synthesis.fileRecords.get(ranking.stableKey) ?? null;
    if (!record) continue; // rerank only what the semantic pass covered
    targets.push({
      targetType: ranking.targetType,
      stableKey: ranking.stableKey,
      name: ranking.stableKey,
      summary: record.summary,
      candidateBreakdown: ranking.breakdown,
      candidateScore: ranking.score,
      record,
      inCapability: capabilityMemberKeys.has(ranking.stableKey),
    });
    taken += 1;
  }

  for (const workflow of ctx.workflows) {
    const ranking = rankingByKey.get(`workflow:${workflow.stableKey}`);
    targets.push({
      targetType: 'workflow',
      stableKey: workflow.stableKey,
      name: workflow.title,
      summary: synthesis.workflowRecords.get(workflow.stableKey)?.summary ?? `${workflow.title}: ${workflow.purpose}`,
      candidateBreakdown: breakdownOf(ranking),
      candidateScore: ranking?.score ?? 0,
      record: synthesis.workflowRecords.get(workflow.stableKey) ?? null,
      inCapability: capabilityMemberKeys.has(workflow.stableKey),
    });
  }

  for (const cluster of ctx.architecture.clusters) {
    targets.push({
      targetType: 'cluster',
      stableKey: cluster.stableKey,
      name: cluster.label,
      summary: synthesis.moduleRecords.get(cluster.stableKey)?.summary ?? cluster.deterministicSummary,
      candidateBreakdown: { fanCentrality: Math.min(1, cluster.criticalScore) },
      candidateScore: Math.min(1, cluster.criticalScore),
      record: synthesis.moduleRecords.get(cluster.stableKey) ?? null,
      inCapability: capabilityMemberKeys.has(cluster.stableKey),
    });
  }
  return targets;
}

// ── LLM scoring ──────────────────────────────────────────────────────────────

interface LlmTargetScores {
  stable_key: string;
  runtime: number;
  business: number;
  onboarding: number;
  change_risk: number;
  architecture: number;
  workflow: number;
  roles: Record<DeveloperRole, number>;
  reasons: string[];
}

const score100 = { type: 'number' } as const;
const RERANK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['targets'],
  properties: {
    targets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stable_key', 'runtime', 'business', 'onboarding', 'change_risk', 'architecture', 'workflow', 'roles', 'reasons'],
        properties: {
          stable_key: { type: 'string' },
          runtime: score100, business: score100, onboarding: score100,
          change_risk: score100, architecture: score100, workflow: score100,
          roles: {
            type: 'object',
            additionalProperties: false,
            required: ['backend', 'frontend', 'devops', 'qa', 'general'],
            properties: { backend: score100, frontend: score100, devops: score100, qa: score100, general: score100 },
          },
          reasons: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const LLM_VIEW_FIELD: Record<Exclude<SemanticView, 'critical_for_role'>, keyof Omit<LlmTargetScores, 'stable_key' | 'roles' | 'reasons'>> = {
  critical_for_runtime: 'runtime',
  critical_for_business: 'business',
  critical_for_onboarding: 'onboarding',
  critical_for_change_risk: 'change_risk',
  critical_for_architecture: 'architecture',
  critical_for_workflow: 'workflow',
};

export async function runSemanticReranking(
  ctx: SemanticContext,
  symbolRecords: Map<string, StoredRecord>,
  synthesis: SynthesisResult,
): Promise<RerankResult> {
  const capabilityMemberKeys = new Set<string>(
    ((await query(
      `SELECT cm.stable_key FROM capability_members cm
       JOIN capabilities c ON c.id = cm.capability_id WHERE c.snapshot_id = $1`,
      [ctx.snapshotId],
    )).rows as Array<{ stable_key: string }>).map((r) => r.stable_key),
  );
  const targets = selectRerankTargets(ctx, symbolRecords, synthesis, capabilityMemberKeys);
  if (targets.length === 0) return { targets: 0, rowsWritten: 0, llmCalls: 0 };

  // LLM scores per batch (concurrent — provider pressure is bounded by the
  // AiClient semaphore)
  let llmCalls = 0;
  const llmByKey = new Map<string, LlmTargetScores>();
  const rerankBatches: RerankTarget[][] = [];
  for (let i = 0; i < targets.length; i += TARGETS_PER_RERANK_CALL) {
    rerankBatches.push(targets.slice(i, i + TARGETS_PER_RERANK_CALL));
  }
  await mapLimit(rerankBatches, 6, async (batch) => {
    const prompt = [
      'Score each target 0-100 per criticality view: runtime (what breaks the app when wrong), business (domain importance), onboarding (what a newcomer must understand first), change_risk (operational risk / invariants), architecture (boundary and coupling importance), workflow (workflow criticality), and per-role relevance (backend/frontend/devops/qa/general). Give 1-3 short reasons per target. Judge from the summaries and deterministic signals; do not invent facts.',
      OUTPUT_RULES,
      batch.map((t) => [
        `### ${t.stableKey} (${t.targetType})`,
        `summary: ${t.summary.slice(0, 300)}`,
        `phase-A signals: ${JSON.stringify(t.candidateBreakdown)}`,
        t.record?.record.risks_invariants?.length ? `risks: ${t.record.record.risks_invariants.join('; ').slice(0, 200)}` : null,
      ].filter(Boolean).join('\n')).join('\n\n'),
    ].join('\n\n');

    const response = await ctx.ai.call<{ targets: LlmTargetScores[] }>({
      tier: 'strong',
      targetType: 'rerank',
      promptVersion: PROMPT_VERSIONS.rerank,
      schemaName: 'rerank_scores',
      schema: RERANK_SCHEMA,
      user: prompt,
    });
    llmCalls += 1;
    for (const t of response.value?.targets ?? []) llmByKey.set(t.stable_key, t);
  });

  // Blend 50/50, then normalize per view within the snapshot.
  type Blended = {
    target: RerankTarget;
    views: Record<Exclude<SemanticView, 'critical_for_role'>, { blended: number; det: number; llm: number }>;
    roles: Record<DeveloperRole, { blended: number; det: number; llm: number }>;
    reasons: string[];
  };
  const blended: Blended[] = targets.map((target) => {
    const det = deterministicViewScores(target);
    const detRoles = deterministicRoleScores(target);
    const llm = llmByKey.get(target.stableKey);
    const views = {} as Blended['views'];
    for (const view of Object.keys(LLM_VIEW_FIELD) as Array<keyof typeof LLM_VIEW_FIELD>) {
      const llmScore = llm ? clamp01(Number(llm[LLM_VIEW_FIELD[view]]) / 100) : det[view];
      views[view] = { det: det[view], llm: llmScore, blended: 0.5 * det[view] + 0.5 * llmScore };
    }
    const roles = {} as Blended['roles'];
    for (const role of ROLES) {
      const llmScore = llm ? clamp01(Number(llm.roles?.[role] ?? 0) / 100) : detRoles[role];
      roles[role] = { det: detRoles[role], llm: llmScore, blended: 0.5 * detRoles[role] + 0.5 * llmScore };
    }
    return { target, views, roles, reasons: llm?.reasons?.slice(0, 5) ?? [] };
  });

  for (const view of Object.keys(LLM_VIEW_FIELD) as Array<keyof typeof LLM_VIEW_FIELD>) {
    normalize(blended, (b) => b.views[view].blended, (b, v) => { b.views[view].blended = v; });
  }
  for (const role of ROLES) {
    normalize(blended, (b) => b.roles[role].blended, (b, v) => { b.roles[role].blended = v; });
  }

  // Persist
  let rowsWritten = 0;
  for (const b of blended) {
    const ids = await resolveTargetIds(ctx, b.target);
    for (const view of Object.keys(LLM_VIEW_FIELD) as Array<keyof typeof LLM_VIEW_FIELD>) {
      await upsertScore(ctx, b.target, view, null, b.views[view].blended,
        { deterministic: b.views[view].det, llm: b.views[view].llm }, b.reasons, ids);
      rowsWritten += 1;
    }
    for (const role of ROLES) {
      await upsertScore(ctx, b.target, 'critical_for_role', role, b.roles[role].blended,
        { deterministic: b.roles[role].det, llm: b.roles[role].llm }, b.reasons, ids);
      rowsWritten += 1;
    }
  }
  return { targets: targets.length, rowsWritten, llmCalls };
}

async function resolveTargetIds(ctx: SemanticContext, target: RerankTarget): Promise<{ nodeId: string | null; targetId: string | null }> {
  if (target.targetType === 'symbol' || target.targetType === 'file') {
    return { nodeId: ctx.nodeIdMap.get(target.stableKey) ?? null, targetId: null };
  }
  if (target.targetType === 'workflow') {
    return { nodeId: null, targetId: ctx.workflowIdMap.get(target.stableKey) ?? null };
  }
  if (target.targetType === 'cluster') {
    const row = await query(`SELECT id FROM architecture_clusters WHERE snapshot_id = $1 AND stable_key = $2`, [ctx.snapshotId, target.stableKey]);
    return { nodeId: null, targetId: (row.rows[0] as { id: string } | undefined)?.id ?? null };
  }
  const row = await query(`SELECT id FROM capabilities WHERE snapshot_id = $1 AND stable_key = $2`, [ctx.snapshotId, target.stableKey]);
  return { nodeId: null, targetId: (row.rows[0] as { id: string } | undefined)?.id ?? null };
}

async function upsertScore(
  ctx: SemanticContext,
  target: RerankTarget,
  view: SemanticView,
  role: DeveloperRole | null,
  score: number,
  breakdown: Record<string, number>,
  reasons: string[],
  ids: { nodeId: string | null; targetId: string | null },
): Promise<void> {
  await query(
    `INSERT INTO criticality_scores
       (snapshot_id, phase, view, target_type, target_node_id, target_id, stable_key, role, score, score_breakdown, reasons)
     VALUES ($1, 'semantic', $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (snapshot_id, phase, view, target_type, stable_key, COALESCE(role, ''))
       DO UPDATE SET score = EXCLUDED.score, score_breakdown = EXCLUDED.score_breakdown, reasons = EXCLUDED.reasons`,
    [ctx.snapshotId, view, target.targetType, ids.nodeId, ids.targetId, target.stableKey, role,
     round5(score), JSON.stringify(breakdown), reasons],
  );
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function round5(n: number): number {
  return Math.round(n * 100_000) / 100_000;
}

function normalize<T>(items: T[], get: (t: T) => number, set: (t: T, v: number) => void): void {
  const max = Math.max(...items.map(get), 0);
  if (max <= 0) return;
  for (const item of items) set(item, get(item) / max);
}
