/**
 * Grounded Q&A evaluation service (doc/Pipeline.md "Q&A Evaluation
 * Endpoint") — a dev tool, not a product feature. Flow: resolve the
 * snapshot (defaults: whole-repo scope, general role, latest complete
 * snapshot — answers never mix unrelated scopes), classify intent to pick
 * embedding views, retrieve through the same service that powers
 * generation, produce a qa-v1 grounded answer, and validate it with the
 * same citation validator. Runs are audited (target_type 'qa_answer')
 * but never persisted as content.
 */

import { query } from '../lib/db.js';
import { AiClient } from '../worker/ai/aiClient.js';
import { BudgetEnforcer } from '../worker/ai/budgetEnforcer.js';
import { resolveTierConfig } from '../worker/ai/modelTiers.js';
import { selectModel, isAutoSelection, overridesForSelection } from '../worker/ai/modelSelector.js';
import { AiDisabledError, type PrivacyMode } from '../worker/ai/privacy.js';
import type { AiProvider } from '../worker/ai/provider.js';
import type { SemanticDepth } from '../worker/engine/budgets.js';
import type { DeveloperRole } from '../worker/semantic/projections.js';
import { viewsForIntent, type ViewType } from '../worker/semantic/embeddingViews.js';
import { retrieve, type EvidenceBundleV2 } from '../retrieval/retrievalService.js';
import { rewriteQaUuidCitations } from '../worker/generation/citationMarkers.js';
import { validateGeneratedOutput, type GeneratedClaim } from '../worker/generation/citationValidator.js';

export const QA_PROMPT_VERSION = 'qa-v2';

export type QuestionIntent = 'what_does' | 'what_handles' | 'what_uses' | 'what_breaks' | 'general';

/** Heuristic intent classification driving view selection (doc/Pipeline.md). */
export function classifyIntent(question: string): QuestionIntent {
  const q = question.toLowerCase();
  if (/\b(break\w*|fail\w*|risk\w*|danger\w*|outage|goes? wrong|crash\w*)\b/.test(q)) return 'what_breaks';
  if (/\b(who calls|what calls|what uses|used by|depends? on|imports?|callers?)\b/.test(q)) return 'what_uses';
  if (/\b(what handles|which .{0,40}handles?|where is .{0,40}(handled|implemented)|responsible for)\b/.test(q)) return 'what_handles';
  if (/\b(what does|how does|what is|explain|describe|purpose of)\b/.test(q)) return 'what_does';
  return 'general';
}

export interface AskInput {
  projectId: string;
  question: string;
  scopeId?: string;
  role?: DeveloperRole;
  snapshotId?: string;
  /** Test seams. */
  provider?: AiProvider;
  embedQuery?: (text: string) => Promise<number[]>;
}

export interface AskAnswer {
  answerMarkdown: string;
  claims: GeneratedClaim[];
  receipts: Array<{
    receiptId: string;
    filePath?: string;
    symbolName?: string;
    lineStart?: number;
    lineEnd?: number;
    snippet?: string;
    trustLevel: string;
  }>;
  confidence: 'high' | 'medium' | 'low';
  unknowns: Array<{ kind: string; detail?: string | null }>;
  meta: {
    snapshotId: string;
    scopeId: string;
    role: DeveloperRole;
    intent: QuestionIntent;
    views: ViewType[];
    validationIssues: string[];
    retried: boolean;
  };
}

/** Thrown when the target project/scope has no answerable snapshot. */
export class NoSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoSnapshotError';
  }
}

interface ResolvedSnapshot {
  snapshotId: string;
  scopeId: string;
  commitHash: string;
  depth: SemanticDepth;
  privacyMode: PrivacyMode;
  budgetOverrides: unknown;
  modelFailureBehavior: unknown;
  modelTierOverrides: unknown;
  defaultRole: DeveloperRole;
}

/** Defaults per spec: whole-repo scope, general role, latest complete snapshot. */
async function resolveSnapshot(input: AskInput): Promise<ResolvedSnapshot> {
  const params: unknown[] = [input.projectId];
  let where: string;
  if (input.snapshotId) {
    params.push(input.snapshotId);
    where = `s.id = $2`;
  } else if (input.scopeId) {
    params.push(input.scopeId);
    where = `s.scope_id = $2 AND s.status = 'complete'`;
  } else {
    where = `sc.path_prefix = '' AND s.status = 'complete'`;
  }
  const row = (await query(
    `SELECT s.id AS snapshot_id, s.scope_id, s.commit_hash, s.semantic_depth, s.privacy_mode,
            COALESCE(ps.default_developer_role, 'general') AS default_role,
            COALESCE(ps.budget_overrides, '{}'::jsonb) AS budget_overrides,
            COALESCE(ps.model_failure_behavior, '{}'::jsonb) AS model_failure_behavior,
            COALESCE(ps.model_tier_overrides, '{}'::jsonb) AS model_tier_overrides
     FROM analysis_snapshots s
     JOIN analysis_scopes sc ON sc.id = s.scope_id
     LEFT JOIN project_settings ps ON ps.project_id = s.project_id
     WHERE s.project_id = $1 AND ${where}
     ORDER BY s.created_at DESC
     LIMIT 1`,
    params,
  )).rows[0] as {
    snapshot_id: string; scope_id: string; commit_hash: string; semantic_depth: SemanticDepth;
    privacy_mode: PrivacyMode; default_role: DeveloperRole; budget_overrides: unknown;
    model_failure_behavior: unknown; model_tier_overrides: unknown;
  } | undefined;
  if (!row) throw new NoSnapshotError('No analyzed snapshot found for this project/scope');
  return {
    snapshotId: row.snapshot_id, scopeId: row.scope_id, commitHash: row.commit_hash,
    depth: row.semantic_depth, privacyMode: row.privacy_mode,
    budgetOverrides: row.budget_overrides, modelFailureBehavior: row.model_failure_behavior,
    modelTierOverrides: row.model_tier_overrides, defaultRole: row.default_role,
  };
}

const QA_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answerMarkdown', 'confidence', 'claims', 'usedReceiptIds', 'unknowns'],
  properties: {
    answerMarkdown: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'receiptIds', 'confidence'],
        properties: {
          claim: { type: 'string' },
          receiptIds: { type: 'array', items: { type: 'string' } },
          confidence: { enum: ['high', 'medium', 'low'] },
        },
      },
    },
    usedReceiptIds: { type: 'array', items: { type: 'string' } },
    unknowns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'detail'],
        properties: { kind: { type: 'string' }, detail: { type: ['string', 'null'] } },
      },
    },
  },
};

interface QaRawOutput {
  answerMarkdown: string;
  confidence: 'high' | 'medium' | 'low';
  claims: GeneratedClaim[];
  usedReceiptIds: string[];
  unknowns: Array<{ kind: string; detail?: string | null }>;
}

export async function answerQuestion(input: AskInput): Promise<AskAnswer> {
  const snapshot = await resolveSnapshot(input);
  if (snapshot.privacyMode === 'ai_disabled') throw new AiDisabledError();
  const privacyMode = snapshot.privacyMode as 'full_ai' | 'facts_only_ai';
  const role = input.role ?? snapshot.defaultRole;
  const intent = classifyIntent(input.question);
  const views = viewsForIntent(intent);

  // Q&A shares the snapshot's budget: counters and limits apply, but an
  // HTTP request has no pause semantics — trips surface as errors.
  const budget = await new BudgetEnforcer({
    snapshotId: snapshot.snapshotId,
    depth: snapshot.depth,
    budgetOverrides: snapshot.budgetOverrides,
    stopBehavior: 'fail',
  }).load();
  // Ask follows the auto rotation too; the 5-min selection cache makes this
  // a no-op cost on interactive latency after the first question.
  let askOverrides: unknown = snapshot.modelTierOverrides;
  if (isAutoSelection(askOverrides)) {
    const selection = await selectModel({ projectId: input.projectId });
    if (selection.rankings.length > 0) askOverrides = overridesForSelection(selection);
  }
  const ai = new AiClient({
    projectId: input.projectId,
    snapshotId: snapshot.snapshotId,
    privacyMode,
    budget,
    provider: input.provider,
    tierConfig: resolveTierConfig({
      modelTierOverrides: askOverrides,
      modelFailureBehavior: snapshot.modelFailureBehavior,
    }),
  });

  const bundle = await retrieve({
    snapshotId: snapshot.snapshotId,
    projectId: input.projectId,
    task: input.question,
    privacyMode,
    views,
    role,
    embedQuery: input.embedQuery,
  });

  let { output } = await callQaModel(ai, input.question, role, bundle, null);
  let validation = await validateGeneratedOutput({
    bundle,
    output: { title: 'qa', contentMarkdown: output.answerMarkdown, confidence: output.confidence, claims: output.claims, usedReceiptIds: output.usedReceiptIds, unknowns: output.unknowns },
    snapshotId: snapshot.snapshotId,
  });
  let retried = false;
  if (validation.hardFailure) {
    retried = true;
    ({ output } = await callQaModel(ai, input.question, role, bundle, validation.issues));
    validation = await validateGeneratedOutput({
      bundle,
      output: { title: 'qa', contentMarkdown: output.answerMarkdown, confidence: output.confidence, claims: output.claims, usedReceiptIds: output.usedReceiptIds, unknowns: output.unknowns },
      snapshotId: snapshot.snapshotId,
    });
  }

  const used = new Set(validation.usedReceiptIds);
  // Raw UUID citations in the prose become the same [[receipt:…]] markers
  // sections use — the reader renders them as numbered chips; unknown ids
  // are stripped, never shipped as dead labels.
  const inline = rewriteQaUuidCitations(output.answerMarkdown, used);
  return {
    answerMarkdown: inline.content,
    claims: validation.adjustedClaims,
    receipts: bundle.receipts
      .filter((r) => used.has(r.receiptId))
      .map((r) => ({
        receiptId: r.receiptId,
        filePath: r.filePath,
        symbolName: r.symbolName,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        snippet: r.snippet, // already stripped by the bundle in facts-only mode
        trustLevel: r.trustLevel,
      })),
    confidence: validation.confidence,
    unknowns: validation.unknowns,
    meta: {
      snapshotId: snapshot.snapshotId,
      scopeId: snapshot.scopeId,
      role,
      intent,
      views,
      validationIssues: validation.issues,
      retried,
    },
  };
}

async function callQaModel(
  ai: AiClient,
  question: string,
  role: DeveloperRole,
  bundle: EvidenceBundleV2,
  previousIssues: string[] | null,
): Promise<{ output: QaRawOutput }> {
  const records = bundle.semanticContext.map(
    (r) => `- [${r.recordLevel}] ${r.stableKey} (confidence ${r.confidence}): ${r.summary.slice(0, 280)}`,
  );
  const receipts = bundle.receipts.map((r) => {
    const where = [r.filePath ?? r.nodeStableKey, r.lineStart ? `L${r.lineStart}-${r.lineEnd}` : null].filter(Boolean).join(' ');
    const snippet = r.snippet ? `\n  ${r.snippet.slice(0, 500).replace(/\n/g, '\n  ')}` : '';
    return `- receipt ${r.receiptId} [${r.receiptKind}, trust=${r.trustLevel}] ${where}${snippet}`;
  });
  const prompt = [
    `Answer this question from a ${role} developer about the ${bundle.repo.owner}/${bundle.repo.name} codebase (scope: ${bundle.scope.displayName}):`,
    `QUESTION: ${question}`,
    'Ground every substantive statement in the evidence below and cite receipt ids (the exact UUIDs) in claims and usedReceiptIds. If the evidence does not answer the question, say so plainly and record it in unknowns — never guess. Code receipts win over docs.',
    // Nested/unbalanced fences flip the rest of the answer into a code block
    // in the reader — seen live the first day the Q&A UI shipped.
    'answerMarkdown is standard CommonMark: never nest ``` fences, close every fence you open, and cite receipts in prose (never inside a code block).',
    previousIssues && previousIssues.length > 0
      ? `Your previous attempt FAILED validation. Fix these problems and cite only receipt ids that exist below:\n- ${previousIssues.join('\n- ')}`
      : null,
    `Semantic records:\n${records.join('\n') || '(none)'}`,
    `Receipts (cite by id):\n${receipts.join('\n') || '(none)'}`,
    bundle.unknowns.length > 0 ? `Known gaps: ${JSON.stringify(bundle.unknowns)}` : null,
  ].filter(Boolean).join('\n\n');

  const response = await ai.call<QaRawOutput>({
    tier: 'strong',
    targetType: 'qa_answer',
    promptVersion: QA_PROMPT_VERSION,
    schemaName: 'qa_answer',
    schema: QA_OUTPUT_SCHEMA,
    user: prompt,
    maxOutputTokens: 8_000,
  });
  return { output: response.value! };
}
