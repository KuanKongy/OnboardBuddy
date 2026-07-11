/**
 * Symbol semantic pass (doc/Pipeline.md "Semantic Pass"): depth-gated,
 * batched per file with hard limits, content-address cached, cheap tier.
 * Trivial and unselected symbols get facts-only records (no LLM call);
 * failed symbols are retried individually, then fall back to facts-only
 * with an llm_failed flag — never silently dropped.
 */

import { BudgetExceededError } from '../ai/budgetEnforcer.js';
import { MAX_SYMBOLS_PER_CALL, MAX_SNIPPET_CHARS, MAX_REQUEST_INPUT_TOKENS, CHARS_PER_TOKEN } from '../engine/budgets.js';
import type { EvidenceNode } from '../types/analysis.js';
import type { SemanticContext } from './context.js';
import {
  PROMPT_VERSIONS, OUTPUT_RULES, batchedSymbolSchema, renderSummary,
  type SemanticRecordBody, type RecordConfidence,
} from './recordTypes.js';
import {
  evidenceHashForSymbol, lookupRecord, insertRecord, mapToSnapshot, attachReceipts,
  type StoredRecord, type RecordCacheKey, type ReceiptDraft,
} from './recordStore.js';

const SYMBOL_NODE_TYPES = new Set(['function', 'method', 'class', 'interface', 'type', 'enum', 'variable']);
const PROMPT_OVERHEAD_TOKENS = 800;
const PER_SYMBOL_FACTS_TOKENS = 200;

export interface SymbolPassResult {
  records: Map<string, StoredRecord>; // stableKey -> active record (llm, cached, or facts-only)
  llmRecords: number;
  factsOnlyRecords: number;
  cacheHits: number;
  retriedSymbols: number;
  failedSymbols: number;
  /** True when a budget 'degrade' downgraded remaining symbols to facts-only. */
  degraded: boolean;
}

interface SymbolTarget {
  node: EvidenceNode;
  evidenceHash: string;
  cacheKey: RecordCacheKey;
}

export async function runSymbolPass(ctx: SemanticContext): Promise<SymbolPassResult> {
  const result: SymbolPassResult = {
    records: new Map(), llmRecords: 0, factsOnlyRecords: 0,
    cacheHits: 0, retriedSymbols: 0, failedSymbols: 0, degraded: false,
  };
  const nodesByKey = new Map(ctx.graph.nodes.filter((n) => SYMBOL_NODE_TYPES.has(n.type)).map((n) => [n.stableKey, n]));

  // At full depth everything selected gets an LLM record; at cheap/standard
  // trivial symbols that slipped into the selection (workflow participants)
  // still get facts-only records per the trivial-classification rule.
  const llmKeys: string[] = [];
  const factsOnlyKeys: string[] = [...ctx.gating.factsOnly];
  for (const key of ctx.gating.selected) {
    const node = nodesByKey.get(key);
    if (!node) continue;
    if (ctx.depth !== 'full' && node.metadata.isTrivial === true) factsOnlyKeys.push(key);
    else llmKeys.push(key);
  }

  // Facts-only records first: deterministic, no budget interaction.
  for (const key of factsOnlyKeys) {
    const node = nodesByKey.get(key);
    if (!node) continue;
    const record = await ensureFactsOnlyRecord(ctx, node);
    result.records.set(key, record);
    result.factsOnlyRecords += 1;
  }

  // LLM targets: resolve cache hits, then batch the misses per file.
  const misses: SymbolTarget[] = [];
  for (const key of llmKeys) {
    const node = nodesByKey.get(key);
    if (!node) continue;
    const evidenceHash = evidenceHashForSymbol(node, ctx.graph, ctx.sideEffects);
    const cacheKey: RecordCacheKey = {
      projectId: ctx.projectId, stableKey: key, level: 'symbol', evidenceHash,
      promptVersion: PROMPT_VERSIONS.symbol, depth: ctx.depth, modelFamily: ctx.modelFamily.cheap,
    };
    const cached = await lookupRecord(cacheKey);
    if (cached) {
      await mapToSnapshot(ctx.snapshotId, cached, ctx.nodeIdMap.get(key) ?? null);
      result.records.set(key, cached);
      result.cacheHits += 1;
    } else {
      misses.push({ node, evidenceHash, cacheKey });
    }
  }

  try {
    for (const batch of planBatches(misses.map((m) => m.node))) {
      const targets = batch.map((n) => misses.find((m) => m.node.stableKey === n.stableKey)!);
      // A whole-batch failure falls through to per-symbol retries (spec:
      // "failed symbols are retried individually, not the whole file").
      const produced = await callBatch(ctx, targets).catch((err) => {
        if (isControlError(err)) throw err;
        return new Map<string, StoredRecord>();
      });
      const missing = targets.filter((t) => !produced.has(t.node.stableKey));
      // Per-symbol retry (spec): failed symbols are retried individually.
      for (const target of missing) {
        result.retriedSymbols += 1;
        const single = await callBatch(ctx, [target]).catch((err) => {
          if (isControlError(err)) throw err;
          return new Map<string, StoredRecord>();
        });
        if (!single.has(target.node.stableKey)) {
          const fallback = await ensureFactsOnlyRecord(ctx, target.node, [{ kind: 'llm_failed' }]);
          produced.set(target.node.stableKey, fallback);
          result.failedSymbols += 1;
          result.factsOnlyRecords += 1;
        } else {
          produced.set(target.node.stableKey, single.get(target.node.stableKey)!);
        }
      }
      for (const [key, record] of produced) {
        result.records.set(key, record);
        if (!record.factsOnly) result.llmRecords += 1;
      }
    }
  } catch (err) {
    if (err instanceof BudgetExceededError && err.behavior === 'degrade') {
      // Budget degrade: remaining targets drop to facts-only records.
      result.degraded = true;
      for (const target of misses) {
        if (result.records.has(target.node.stableKey)) continue;
        const record = await ensureFactsOnlyRecord(ctx, target.node, [{ kind: 'budget_degraded' }]);
        result.records.set(target.node.stableKey, record);
        result.factsOnlyRecords += 1;
      }
    } else {
      throw err;
    }
  }

  return result;
}

/** Groups symbols by file, then chunks by count and estimated input tokens. */
export function planBatches(nodes: EvidenceNode[]): EvidenceNode[][] {
  const byFile = new Map<string, EvidenceNode[]>();
  for (const node of nodes) {
    const file = node.filePath ?? '';
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(node);
  }
  const batches: EvidenceNode[][] = [];
  for (const fileNodes of byFile.values()) {
    let current: EvidenceNode[] = [];
    let currentTokens = PROMPT_OVERHEAD_TOKENS;
    for (const node of fileNodes) {
      const snippetChars = Math.min((node.snippet ?? '').length, MAX_SNIPPET_CHARS);
      const tokens = Math.ceil(snippetChars / CHARS_PER_TOKEN) + PER_SYMBOL_FACTS_TOKENS;
      if (current.length >= MAX_SYMBOLS_PER_CALL || (current.length > 0 && currentTokens + tokens > MAX_REQUEST_INPUT_TOKENS)) {
        batches.push(current);
        current = [];
        currentTokens = PROMPT_OVERHEAD_TOKENS;
      }
      current.push(node);
      currentTokens += tokens;
    }
    if (current.length > 0) batches.push(current);
  }
  return batches;
}

// ── LLM batch call ───────────────────────────────────────────────────────────

interface RawSymbolRecord extends SemanticRecordBody {
  stable_key: string;
}

async function callBatch(ctx: SemanticContext, targets: SymbolTarget[], critiqueNotes?: string): Promise<Map<string, StoredRecord>> {
  const produced = new Map<string, StoredRecord>();
  if (targets.length === 0) return produced;

  const sections: string[] = [];
  const aliasByKey = new Map<string, string>();
  targets.forEach((t, i) => {
    const alias = `r${i + 1}`;
    aliasByKey.set(t.node.stableKey, alias);
    sections.push(renderSymbolFacts(ctx, t.node, alias));
  });

  const prompt = [
    `You are documenting symbols from a codebase for onboarding. For EACH symbol below, produce one semantic record.`,
    OUTPUT_RULES,
    critiqueNotes ? `A previous attempt was rejected by review. Fix these problems:\n${critiqueNotes}` : null,
    `Set each record's stable_key to the symbol's stable key exactly as given.`,
    sections.join('\n\n'),
  ].filter(Boolean).join('\n\n');

  const response = await ctx.ai.call<{ records: RawSymbolRecord[] }>({
    tier: 'cheap',
    targetType: 'symbol_record',
    promptVersion: PROMPT_VERSIONS.symbol,
    schemaName: 'symbol_records',
    schema: batchedSymbolSchema(),
    user: prompt,
  });

  const byKey = new Map((response.value?.records ?? []).map((r) => [r.stable_key, r]));
  for (const target of targets) {
    const raw = byKey.get(target.node.stableKey);
    if (!raw) continue;
    const body = normalizeBody(ctx, target.node, raw);
    const record = await insertRecord({
      key: target.cacheKey,
      record: body,
      summary: renderSummary(target.node.name, body),
      confidence: body.confidence,
      factsOnly: false,
      status: 'pending', // critique promotes to usable
      model: response.model,
      tokenUsage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
    });
    await attachReceipts({
      projectId: ctx.projectId,
      snapshotId: ctx.snapshotId,
      commitHash: ctx.commitHash,
      record,
      drafts: [symbolReceiptDraft(ctx, target.node, aliasByKey.get(target.node.stableKey)!)],
    });
    await mapToSnapshot(ctx.snapshotId, record, ctx.nodeIdMap.get(target.node.stableKey) ?? null);
    produced.set(target.node.stableKey, record);
  }
  return produced;
}

function renderSymbolFacts(ctx: SemanticContext, node: EvidenceNode, receiptAlias: string): string {
  const callees = ctx.graph.edges.filter((e) => e.type === 'calls' && e.sourceKey === node.stableKey).map((e) => e.targetKey);
  const callers = ctx.graph.edges.filter((e) => e.type === 'calls' && e.targetKey === node.stableKey).map((e) => e.sourceKey);
  const effects = ctx.sideEffects
    .filter((s) => s.symbolStableKey === node.stableKey || (s.nodeStableKey === node.stableKey && !s.symbolStableKey))
    .map((s) => `${s.kind}${s.target ? ` -> ${s.target}` : ''}`);
  const lines = [
    `### Symbol ${node.stableKey}  (receipt id: ${receiptAlias})`,
    `kind: ${node.type}; name: ${node.name}; file: ${node.filePath}; exported: ${node.exported === true}`,
    node.metadata.signature ? `signature: ${String(node.metadata.signature)}` : null,
    callers.length > 0 ? `called by: ${callers.slice(0, 10).join(', ')}` : 'called by: (none detected)',
    callees.length > 0 ? `calls: ${callees.slice(0, 10).join(', ')}` : 'calls: (none detected)',
    effects.length > 0 ? `detected side effects: ${effects.join('; ')}` : null,
    node.metadata.behaviorSignals ? `behavior signals: ${JSON.stringify(node.metadata.behaviorSignals)}` : null,
  ].filter(Boolean) as string[];
  if (ctx.privacyMode === 'full_ai' && node.snippet) {
    lines.push('```', node.snippet.slice(0, MAX_SNIPPET_CHARS), '```');
  } else {
    lines.push('(code snippet withheld by privacy settings — reason from the facts above only)');
  }
  return lines.join('\n');
}

function symbolReceiptDraft(ctx: SemanticContext, node: EvidenceNode, alias: string): ReceiptDraft {
  return {
    alias,
    kind: 'code_snippet',
    trustLevel: 'code',
    nodeId: ctx.nodeIdMap.get(node.stableKey) ?? null,
    nodeStableKey: node.stableKey,
    nodeHash: node.hash ?? null,
    filePath: node.filePath,
    symbolName: node.name,
    lineStart: node.lineStart ?? null,
    lineEnd: node.lineEnd ?? null,
    snippet: node.snippet?.slice(0, MAX_SNIPPET_CHARS) ?? null,
  };
}

/** Merges deterministic side effects into the LLM record (spec: mergedWithDeterministic). */
function normalizeBody(ctx: SemanticContext, node: EvidenceNode, raw: RawSymbolRecord): SemanticRecordBody {
  const { stable_key: _ignored, ...body } = raw;
  const detected = ctx.sideEffects.filter(
    (s) => s.symbolStableKey === node.stableKey || (s.nodeStableKey === node.stableKey && !s.symbolStableKey),
  );
  const effects = [...(body.side_effects ?? [])];
  for (const d of detected) {
    const existing = effects.find((e) => e.kind === d.kind);
    if (existing) existing.mergedWithDeterministic = true;
    else effects.push({ kind: d.kind, description: `Detected deterministically${d.target ? `: ${d.target}` : ''}`, mergedWithDeterministic: true });
  }
  return { ...body, side_effects: effects };
}

// ── Facts-only records ───────────────────────────────────────────────────────

export function buildFactsOnlyBody(ctx: Pick<SemanticContext, 'graph' | 'sideEffects'>, node: EvidenceNode): SemanticRecordBody {
  const callees = ctx.graph.edges.filter((e) => e.type === 'calls' && e.sourceKey === node.stableKey).map((e) => e.targetKey);
  const effects = ctx.sideEffects
    .filter((s) => s.symbolStableKey === node.stableKey || (s.nodeStableKey === node.stableKey && !s.symbolStableKey))
    .map((s) => ({ kind: s.kind, description: s.target ? `target: ${s.target}` : 'detected deterministically', mergedWithDeterministic: true }));
  const signals = Array.isArray(node.metadata.purposeSignals) ? (node.metadata.purposeSignals as string[]) : [];
  const purpose = signals.length > 0
    ? `${node.type} '${node.name}' (${signals.join(', ')})`
    : `${node.type} '${node.name}' in ${node.filePath ?? 'unknown file'}`;
  return {
    purpose,
    behavior: 'Facts-only record: deterministic extraction without LLM analysis at this depth.',
    responsibilities: [],
    business_concepts: [],
    side_effects: effects,
    inputs_outputs: null,
    dependencies_narrative: callees.length > 0 ? `Calls ${callees.slice(0, 10).join(', ')}.` : 'No resolved outgoing calls.',
    design_patterns: [],
    risks_invariants: [],
    confidence: 'medium' as RecordConfidence,
    claims: [],
  };
}

async function ensureFactsOnlyRecord(
  ctx: SemanticContext,
  node: EvidenceNode,
  flags: Array<Record<string, unknown>> = [],
): Promise<StoredRecord> {
  const cacheKey: RecordCacheKey = {
    projectId: ctx.projectId,
    stableKey: node.stableKey,
    level: 'symbol',
    evidenceHash: evidenceHashForSymbol(node, ctx.graph, ctx.sideEffects),
    promptVersion: PROMPT_VERSIONS.factsOnly,
    depth: ctx.depth,
    modelFamily: 'deterministic',
  };
  let record = await lookupRecord(cacheKey);
  if (!record) {
    const body = buildFactsOnlyBody(ctx, node);
    record = await insertRecord({
      key: cacheKey,
      record: body,
      summary: renderSummary(node.name, body),
      confidence: 'medium',
      factsOnly: true,
      status: 'usable', // nothing to critique: content is deterministic
      flags,
    });
  }
  await mapToSnapshot(ctx.snapshotId, record, ctx.nodeIdMap.get(node.stableKey) ?? null);
  return record;
}

/**
 * Regenerates one symbol record with critique notes attached (doc/Pipeline.md:
 * "rejected records are regenerated once with the critique attached").
 * Same content-address key — the record row is updated in place.
 */
export async function regenerateSymbolRecord(
  ctx: SemanticContext,
  stableKey: string,
  critiqueNotes: string,
): Promise<StoredRecord | null> {
  const node = ctx.graph.nodes.find((n) => n.stableKey === stableKey);
  if (!node) return null;
  const evidenceHash = evidenceHashForSymbol(node, ctx.graph, ctx.sideEffects);
  const target: SymbolTarget = {
    node,
    evidenceHash,
    cacheKey: {
      projectId: ctx.projectId, stableKey, level: 'symbol', evidenceHash,
      promptVersion: PROMPT_VERSIONS.symbol, depth: ctx.depth, modelFamily: ctx.modelFamily.cheap,
    },
  };
  const produced = await callBatch(ctx, [target], critiqueNotes).catch((err) => {
    if (isControlError(err)) throw err;
    return new Map<string, StoredRecord>();
  });
  return produced.get(stableKey) ?? null;
}

function isControlError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'AiPausedError' || name === 'KillSwitchError' || name === 'AiDisabledError'
    || (err instanceof BudgetExceededError);
}
