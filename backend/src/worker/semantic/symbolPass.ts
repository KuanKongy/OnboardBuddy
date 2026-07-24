/**
 * Symbol semantic pass (doc/Pipeline.md "Semantic Pass"): depth-gated,
 * batched across files with hard limits, content-address cached, cheap
 * tier. Trivial and unselected symbols get facts-only records (no LLM
 * call); a failing batch splits in half recursively (leaf 4), then failed
 * symbols are retried individually and fall back to facts-only with an
 * llm_failed flag — never silently dropped. Persistence is bulk: one
 * lookup, one insert, one receipts attach, one snapshot map per batch
 * (latency overhaul Tracks B+C).
 */

import { BudgetExceededError } from '../ai/budgetEnforcer.js';
import { mapLimit } from '../../lib/parallel.js';
import {
  MAX_SYMBOLS_PER_CALL, MAX_SNIPPET_CHARS, MAX_REQUEST_INPUT_TOKENS, CHARS_PER_TOKEN,
  SYMBOL_BATCH_OUTPUT_TOKENS_PER_SYMBOL,
} from '../engine/budgets.js';
import { capReceiptSpan } from '../engine/receiptSpan.js';
import type { EvidenceNode } from '../types/analysis.js';
import type { SemanticContext } from './context.js';
import {
  PROMPT_VERSIONS, OUTPUT_RULES, batchedSymbolSchema, renderSummary,
  type SemanticRecordBody, type RecordConfidence,
} from './recordTypes.js';
import {
  evidenceHashForSymbol, lookupRecord, lookupRecords, insertRecord, insertRecordsBulk,
  mapToSnapshot, mapToSnapshotBulk, attachReceipts, attachReceiptsBulk, depthLookupOrder,
  type StoredRecord, type RecordCacheKey, type ReceiptDraft, type InsertRecordInput,
  type PriorSymbolRecord,
} from './recordStore.js';

const SYMBOL_NODE_TYPES = new Set(['function', 'method', 'class', 'interface', 'type', 'enum', 'variable']);
const PROMPT_OVERHEAD_TOKENS = 800;
const PER_SYMBOL_FACTS_TOKENS = 200;

export interface SymbolPassResult {
  records: Map<string, StoredRecord>; // stableKey -> active record (llm, cached, or facts-only)
  llmRecords: number;
  factsOnlyRecords: number;
  cacheHits: number;
  /** Prior-mapping exact matches re-mapped without any lookup (Track E). */
  carriedForward: number;
  retriedSymbols: number;
  failedSymbols: number;
  /** True when a budget 'degrade' downgraded remaining symbols to facts-only. */
  degraded: boolean;
}

/**
 * Carry-forward gate (Track E): a prior record substitutes for a fresh
 * lookup exactly when the SAME computation would have been a cache hit —
 * evidence hash, prompt version, model family, a depth the current run
 * accepts, and a non-superseded status. Model-family membership makes a
 * model swap automatically re-key everything.
 */
export function isCarryForwardEligible(
  prior: PriorSymbolRecord | undefined,
  expected: { evidenceHash: string; promptVersion: string; modelFamily: string; depth: SemanticDepthLike },
): prior is PriorSymbolRecord {
  if (!prior) return false;
  return prior.evidenceHash === expected.evidenceHash
    && prior.promptVersion === expected.promptVersion
    && prior.modelFamily === expected.modelFamily
    && depthLookupOrder(expected.depth).includes(prior.semanticDepth)
    && (prior.status === 'usable' || prior.status === 'pending' || prior.status === 'rejected');
}

type SemanticDepthLike = Parameters<typeof depthLookupOrder>[0];

interface SymbolTarget {
  node: EvidenceNode;
  evidenceHash: string;
  cacheKey: RecordCacheKey;
}

export async function runSymbolPass(ctx: SemanticContext): Promise<SymbolPassResult> {
  const result: SymbolPassResult = {
    records: new Map(), llmRecords: 0, factsOnlyRecords: 0,
    cacheHits: 0, carriedForward: 0, retriedSymbols: 0, failedSymbols: 0, degraded: false,
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

  // Facts-only records: deterministic, no budget interaction. Bulk path —
  // one lookup, one insert, one snapshot map for the whole set instead of
  // ~4 round trips per record.
  let factsTargets: Array<{ node: EvidenceNode; cacheKey: RecordCacheKey }> = [];
  for (const key of factsOnlyKeys) {
    const node = nodesByKey.get(key);
    if (!node) continue;
    factsTargets.push({
      node,
      cacheKey: {
        projectId: ctx.projectId, stableKey: key, level: 'symbol',
        evidenceHash: evidenceHashForSymbol(node, ctx.graph, ctx.sideEffects),
        promptVersion: PROMPT_VERSIONS.factsOnly, depth: ctx.depth, modelFamily: 'deterministic',
      },
    });
  }
  if (factsTargets.length > 0) {
    // Carry-forward first (Track E): exact prior matches skip the lookup.
    const carriedFacts: Array<{ record: StoredRecord; nodeId: string | null }> = [];
    const factsNeedingLookup: typeof factsTargets = [];
    for (const t of factsTargets) {
      const prior = ctx.priorSymbolRecords?.get(t.node.stableKey);
      if (isCarryForwardEligible(prior, {
        evidenceHash: t.cacheKey.evidenceHash, promptVersion: PROMPT_VERSIONS.factsOnly,
        modelFamily: 'deterministic', depth: ctx.depth,
      })) {
        carriedFacts.push({ record: prior, nodeId: ctx.nodeIdMap.get(t.node.stableKey) ?? null });
        result.records.set(t.node.stableKey, prior);
        result.factsOnlyRecords += 1;
        result.carriedForward += 1;
      } else {
        factsNeedingLookup.push(t);
      }
    }
    if (carriedFacts.length > 0) await mapToSnapshotBulk(ctx.snapshotId, carriedFacts);
    factsTargets = factsNeedingLookup;
  }
  if (factsTargets.length > 0) {
    const cachedFacts = await lookupRecords(
      {
        projectId: ctx.projectId, level: 'symbol',
        promptVersion: PROMPT_VERSIONS.factsOnly, depth: ctx.depth, modelFamily: 'deterministic',
      },
      factsTargets.map((t) => ({ stableKey: t.cacheKey.stableKey, evidenceHash: t.cacheKey.evidenceHash })),
    );
    const freshInputs: InsertRecordInput[] = [];
    for (const t of factsTargets) {
      if (cachedFacts.has(t.node.stableKey)) continue;
      const body = buildFactsOnlyBody(ctx, t.node);
      freshInputs.push({
        key: t.cacheKey, record: body, summary: renderSummary(t.node.name, body),
        confidence: 'medium', factsOnly: true, status: 'usable',
      });
    }
    const inserted = freshInputs.length > 0 ? await insertRecordsBulk(freshInputs) : new Map<string, StoredRecord>();
    const all = factsTargets.map((t) => {
      const record = cachedFacts.get(t.node.stableKey) ?? inserted.get(t.node.stableKey)!;
      result.records.set(t.node.stableKey, record);
      result.factsOnlyRecords += 1;
      return { record, nodeId: ctx.nodeIdMap.get(t.node.stableKey) ?? null };
    });
    await mapToSnapshotBulk(ctx.snapshotId, all);
  }

  // LLM targets: evidence hashes are in-memory; the cache resolves in ONE
  // bulk lookup instead of a mapLimit-8 fan-out of per-key SELECTs.
  const misses: SymbolTarget[] = [];
  const llmTargets: SymbolTarget[] = [];
  for (const key of llmKeys) {
    const node = nodesByKey.get(key);
    if (!node) continue;
    const evidenceHash = evidenceHashForSymbol(node, ctx.graph, ctx.sideEffects);
    llmTargets.push({
      node, evidenceHash,
      cacheKey: {
        projectId: ctx.projectId, stableKey: key, level: 'symbol', evidenceHash,
        promptVersion: PROMPT_VERSIONS.symbol, depth: ctx.depth, modelFamily: ctx.modelFamily.cheap,
      },
    });
  }
  // Carry-forward first (Track E): exact prior matches skip lookup + LLM.
  const carriedLlm: Array<{ record: StoredRecord; nodeId: string | null }> = [];
  const llmNeedingLookup: SymbolTarget[] = [];
  for (const target of llmTargets) {
    const prior = ctx.priorSymbolRecords?.get(target.node.stableKey);
    if (isCarryForwardEligible(prior, {
      evidenceHash: target.evidenceHash, promptVersion: PROMPT_VERSIONS.symbol,
      modelFamily: ctx.modelFamily.cheap, depth: ctx.depth,
    })) {
      carriedLlm.push({ record: prior, nodeId: ctx.nodeIdMap.get(target.node.stableKey) ?? null });
      result.records.set(target.node.stableKey, prior);
      result.cacheHits += 1;
      result.carriedForward += 1;
    } else {
      llmNeedingLookup.push(target);
    }
  }
  if (carriedLlm.length > 0) await mapToSnapshotBulk(ctx.snapshotId, carriedLlm);

  const cachedLlm = await lookupRecords(
    {
      projectId: ctx.projectId, level: 'symbol',
      promptVersion: PROMPT_VERSIONS.symbol, depth: ctx.depth, modelFamily: ctx.modelFamily.cheap,
    },
    llmNeedingLookup.map((t) => ({ stableKey: t.cacheKey.stableKey, evidenceHash: t.evidenceHash })),
  );
  const cachedEntries: Array<{ record: StoredRecord; nodeId: string | null }> = [];
  for (const target of llmNeedingLookup) {
    const cached = cachedLlm.get(target.node.stableKey);
    if (cached) {
      cachedEntries.push({ record: cached, nodeId: ctx.nodeIdMap.get(target.node.stableKey) ?? null });
      result.records.set(target.node.stableKey, cached);
      result.cacheHits += 1;
    } else {
      misses.push(target);
    }
  }
  if (cachedEntries.length > 0) await mapToSnapshotBulk(ctx.snapshotId, cachedEntries);

  try {
    // Batches run concurrently — the AiClient semaphore bounds provider
    // pressure; this loop was the single biggest wall-clock cost when serial.
    const targetByKey = new Map(misses.map((m) => [m.node.stableKey, m]));
    const batches = planBatches(misses.map((m) => m.node));
    let batchesDone = 0;
    await ctx.onProgress?.({ phase: 'semantic_symbols', done: 0, total: Math.max(1, batches.length), detail: `Semantic: symbol records (0/${batches.length} batches)` });
    await mapLimit(batches, 28, async (batch) => {
      const targets = batch.map((n) => targetByKey.get(n.stableKey)!);
      const produced = await runBatchWithSplitting(ctx, targets, result);
      for (const [key, record] of produced) {
        result.records.set(key, record);
        if (!record.factsOnly) result.llmRecords += 1;
      }
      batchesDone += 1;
      await ctx.onProgress?.({ phase: 'semantic_symbols', done: batchesDone, total: batches.length, detail: `Semantic: symbol records (${batchesDone}/${batches.length} batches)` });
    });
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

/**
 * Packs symbols into batches of up to MAX_SYMBOLS_PER_CALL / the input
 * token cap. Symbols are sorted by file for prompt locality but batches
 * pack ACROSS files — per-file batches averaged 2-5 symbols on real repos,
 * which pinned the call count to ~the file count no matter the cap
 * (latency overhaul Track B).
 */
export function planBatches(nodes: EvidenceNode[]): EvidenceNode[][] {
  const sorted = [...nodes].sort((a, b) =>
    (a.filePath ?? '').localeCompare(b.filePath ?? '') || (a.lineStart ?? 0) - (b.lineStart ?? 0),
  );
  const batches: EvidenceNode[][] = [];
  let current: EvidenceNode[] = [];
  let currentTokens = PROMPT_OVERHEAD_TOKENS;
  for (const node of sorted) {
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
  return batches;
}

/**
 * Failure blast-radius control for 32-symbol batches: a failing or
 * partially-missing batch splits in half (halves retried concurrently)
 * down to a leaf of 4, where the original per-symbol retry -> facts-only
 * fallback applies. One bad response no longer serializes 32 single-symbol
 * retry calls.
 */
const RETRY_LEAF_SIZE = 4;

async function runBatchWithSplitting(
  ctx: SemanticContext,
  targets: SymbolTarget[],
  result: SymbolPassResult,
): Promise<Map<string, StoredRecord>> {
  const produced = await callBatch(ctx, targets).catch((err) => {
    if (isControlError(err)) throw err;
    return new Map<string, StoredRecord>();
  });
  const missing = targets.filter((t) => !produced.has(t.node.stableKey));
  if (missing.length === 0) return produced;

  if (missing.length > RETRY_LEAF_SIZE) {
    const mid = Math.ceil(missing.length / 2);
    const halves = [missing.slice(0, mid), missing.slice(mid)];
    const sub = await mapLimit(halves, 2, (half) => runBatchWithSplitting(ctx, half, result));
    for (const map of sub) for (const [k, v] of map) produced.set(k, v);
    return produced;
  }

  // Leaf: per-symbol retry (spec) then honest facts-only fallback.
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
  return produced;
}

// ── LLM batch call ───────────────────────────────────────────────────────────

interface RawSymbolRecord extends SemanticRecordBody {
  stable_key: string;
}

/**
 * Static prompt prefix shared byte-identically by every symbol call in a
 * run — the system message is the prefix providers cache (Track B).
 */
const SYMBOL_SYSTEM_PROMPT = [
  `You are documenting symbols from a codebase for onboarding. For EACH symbol below, produce one semantic record.`,
  OUTPUT_RULES,
  `Set each record's stable_key to the symbol's stable key exactly as given.`,
].join('\n\n');

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
    critiqueNotes ? `A previous attempt was rejected by review. Fix these problems:\n${critiqueNotes}` : null,
    sections.join('\n\n'),
  ].filter(Boolean).join('\n\n');

  const response = await ctx.ai.call<{ records: RawSymbolRecord[] }>({
    tier: 'cheap',
    targetType: 'symbol_record',
    promptVersion: PROMPT_VERSIONS.symbol,
    schemaName: 'symbol_records',
    schema: batchedSymbolSchema(),
    system: SYMBOL_SYSTEM_PROMPT,
    user: prompt,
    // Provider default output caps would truncate a 32-record batch.
    // 4k floor covers deepseek reasoning tokens (counted against max_tokens).
    maxOutputTokens: Math.min(60_000, 4_000 + SYMBOL_BATCH_OUTPUT_TOKENS_PER_SYMBOL * targets.length),
  });

  const byKey = new Map((response.value?.records ?? []).map((r) => [r.stable_key, r]));
  const toPersist: Array<{ target: SymbolTarget; input: InsertRecordInput }> = [];
  for (const target of targets) {
    const raw = byKey.get(target.node.stableKey);
    if (!raw) continue;
    const body = normalizeBody(ctx, target.node, raw);
    toPersist.push({
      target,
      input: {
        key: target.cacheKey,
        record: body,
        summary: renderSummary(target.node.name, body),
        confidence: body.confidence,
        factsOnly: false,
        status: 'pending', // critique promotes to usable
        model: response.model,
        tokenUsage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
      },
    });
  }
  if (toPersist.length === 0) return produced;

  // Bulk persistence: 3 statement groups per batch instead of ~6 round
  // trips per record (Track C).
  const inserted = await insertRecordsBulk(toPersist.map((p) => p.input));
  const items = toPersist.map(({ target }) => {
    const record = inserted.get(target.node.stableKey)!;
    return {
      record,
      drafts: [symbolReceiptDraft(ctx, target.node, aliasByKey.get(target.node.stableKey)!)],
      nodeId: ctx.nodeIdMap.get(target.node.stableKey) ?? null,
    };
  });
  await attachReceiptsBulk({
    projectId: ctx.projectId,
    snapshotId: ctx.snapshotId,
    commitHash: ctx.commitHash,
    items: items.map(({ record, drafts }) => ({ record, drafts })),
  });
  await mapToSnapshotBulk(ctx.snapshotId, items.map(({ record, nodeId }) => ({ record, nodeId })));
  for (const { record } of items) produced.set(record.stableKey, record);
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
  // Span cap (audit §3.7): a receipt over a whole 550-line component is not
  // verifiable; slice to the first 40 lines and keep the true extent.
  return capReceiptSpan({
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
  });
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
