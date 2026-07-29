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
import { envInt } from '../../lib/env.js';
import {
  MAX_SYMBOLS_PER_CALL, MAX_SNIPPET_CHARS, MAX_REQUEST_INPUT_TOKENS, CHARS_PER_TOKEN,
  SYMBOL_BATCH_OUTPUT_TOKENS_PER_SYMBOL,
} from '../engine/budgets.js';
import { capReceiptSpan } from '../engine/receiptSpan.js';
import { symbolKey } from '../engine/stableKeys.js';
import { makeUntrustedFence, UNTRUSTED_DATA_RULE } from '../ai/untrustedData.js';
import type { EvidenceNode } from '../types/analysis.js';
import type { SemanticContext } from './context.js';
import {
  PROMPT_VERSIONS, OUTPUT_RULES, batchedSymbolSchema, renderSummary,
  type SemanticRecordBody, type RecordConfidence,
} from './recordTypes.js';
import {
  evidenceHashForSymbol, lookupRecord, lookupRecords, insertRecord, insertRecordsBulk,
  mapToSnapshot, mapToSnapshotBulk,  attachReceiptsBulk, depthLookupOrder,
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
    // Hedging budget for this run (see callBatchHedged): shared across all
    // batches so a single pathological phase cannot fan out duplicates.
    const hedge: HedgeState = { durations: [], fired: 0, max: envInt('SYMBOL_HEDGE_MAX', 3) };
    let batchesDone = 0;
    await ctx.onProgress?.({ phase: 'semantic_symbols', done: 0, total: Math.max(1, batches.length), detail: `Semantic: symbol records (0/${batches.length} batches)` });
    await mapLimit(batches, 28, async (batch) => {
      const targets = batch.map((n) => targetByKey.get(n.stableKey)!);
      const produced = await runBatchWithSplitting(ctx, targets, result, hedge);
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

// ── Symbol co-batching (families) ────────────────────────────────────────────

/**
 * A nested function's code is ALREADY inside its container's snippet: the
 * extractor emits handlers declared inside a top-level function as
 * `Container.inner` (symbolExtractor.extractNestedFunctions) and the container
 * node's snippet is the container's whole text. Batched separately, the same
 * lines were paid for twice in one call. Keeping a family in one batch lets
 * each child cite a line range into the container's fence instead of carrying
 * its own copy (renderSymbolFacts).
 *
 * Only the container's ACTUALLY-SENT window counts. The snippet is cut at
 * MAX_SNIPPET_CHARS, so a child declared past the cut is genuinely not in the
 * prompt and keeps its own snippet — pointing at it would be a citation to
 * text the model never received.
 */

/** Rendered pointer line, measured: ~130 chars for a long container key. */
const SNIPPET_POINTER_TOKENS = 40;

/** Container stable key for a nested symbol; null when the node is not nested. */
function containerKeyOf(node: EvidenceNode): string | null {
  const container = node.metadata.container;
  if (typeof container !== 'string' || container.length === 0 || !node.filePath) return null;
  const key = symbolKey(node.filePath, container);
  return key === node.stableKey ? null : key;
}

/**
 * The file lines a container's fence actually carries. The last line of a
 * truncated snippet is half a statement, so it is excluded — and a snippet
 * that already arrives at the cap was truncated by the extractor, which caps
 * at the same MAX_SNIPPET_CHARS.
 */
function sentSnippetWindow(container: EvidenceNode): { firstLine: number; lastLine: number } | null {
  const snippet = container.snippet;
  if (!snippet || container.lineStart == null) return null;
  const sent = snippet.slice(0, MAX_SNIPPET_CHARS);
  let lines = 1;
  for (let i = 0; i < sent.length; i++) if (sent.charCodeAt(i) === 10) lines += 1;
  if (snippet.length >= MAX_SNIPPET_CHARS) lines -= 1;
  if (lines < 1) return null;
  return { firstLine: container.lineStart, lastLine: container.lineStart + lines - 1 };
}

/** Where a symbol's code already sits inside a same-batch container's fence. */
export interface SnippetPointer {
  containerKey: string;
  /** 1-based line numbers WITHIN the container's rendered snippet. */
  fromLine: number;
  toLine: number;
}

/**
 * Which symbols in THIS batch can cite a container instead of repeating their
 * own snippet. Computed from the actual call targets, not from the plan: a
 * failing batch is retried in halves, and a half may carry the child without
 * its container.
 */
export function planSnippetDedupe(nodes: EvidenceNode[]): Map<string, SnippetPointer> {
  const pointers = new Map<string, SnippetPointer>();
  const indexByKey = new Map(nodes.map((n, i) => [n.stableKey, i]));
  nodes.forEach((node, index) => {
    const containerKey = containerKeyOf(node);
    if (!containerKey) return;
    const containerIndex = indexByKey.get(containerKey);
    // The pointer says "above", so the container's section has to precede this
    // one — the model can only cite what it has already read.
    if (containerIndex === undefined || containerIndex >= index) return;
    const window = sentSnippetWindow(nodes[containerIndex]!);
    if (!window || node.lineStart == null || node.lineEnd == null) return;
    if (node.lineStart < window.firstLine || node.lineEnd > window.lastLine) return;
    pointers.set(node.stableKey, {
      containerKey,
      fromLine: node.lineStart - window.firstLine + 1,
      toLine: node.lineEnd - window.firstLine + 1,
    });
  });
  return pointers;
}

/**
 * Input-token estimate for a batch as it will actually be RENDERED — a symbol
 * that cites a container pays for the pointer line, not for a second copy of
 * the snippet. Sharing planSnippetDedupe with the renderer is what keeps the
 * estimate from drifting away from the bytes on the wire.
 */
function estimateBatchTokens(nodes: EvidenceNode[]): number {
  const pointers = planSnippetDedupe(nodes);
  let tokens = PROMPT_OVERHEAD_TOKENS;
  for (const node of nodes) {
    tokens += PER_SYMBOL_FACTS_TOKENS;
    tokens += pointers.has(node.stableKey)
      ? SNIPPET_POINTER_TOKENS
      : Math.ceil(Math.min((node.snippet ?? '').length, MAX_SNIPPET_CHARS) / CHARS_PER_TOKEN);
  }
  return tokens;
}

/**
 * Groups the sorted symbols into families (a container followed by its nested
 * children) so the packer can keep one whole. The sort by (file, line) already
 * places a family adjacently — grouping explicitly instead of relying on that
 * means an odd shape (a container with no line info, a two-level nest) costs
 * the dedupe, not the family.
 */
function groupFamilies(sorted: EvidenceNode[]): EvidenceNode[][] {
  const byKey = new Map(sorted.map((n) => [n.stableKey, n]));
  const headKey = (node: EvidenceNode): string => {
    // Nesting is one level deep today; the bounded walk is a cycle guard, so a
    // key that somehow contains itself cannot spin here.
    let key = node.stableKey;
    for (let hops = 0; hops < 4; hops++) {
      const parent = containerKeyOf(byKey.get(key)!);
      if (!parent || !byKey.has(parent)) return key;
      key = parent;
    }
    return key;
  };
  const families = new Map<string, EvidenceNode[]>();
  const order: string[] = [];
  for (const node of sorted) {
    const head = headKey(node);
    const family = families.get(head);
    if (family) family.push(node);
    else { families.set(head, [node]); order.push(head); }
  }
  return order.map((head) => families.get(head)!);
}

/**
 * Packs symbols into batches of up to MAX_SYMBOLS_PER_CALL / the input
 * token cap. Symbols are sorted by file for prompt locality but batches
 * pack ACROSS files — per-file batches averaged 2-5 symbols on real repos,
 * which pinned the call count to ~the file count no matter the cap
 * (latency overhaul Track B). Families (see above) are placed as a unit so
 * their snippet dedupe survives the packing.
 */
export function planBatches(nodes: EvidenceNode[]): EvidenceNode[][] {
  const sorted = [...nodes].sort((a, b) =>
    (a.filePath ?? '').localeCompare(b.filePath ?? '') || (a.lineStart ?? 0) - (b.lineStart ?? 0),
  );
  const batches: EvidenceNode[][] = [];
  let current: EvidenceNode[] = [];
  let currentTokens = PROMPT_OVERHEAD_TOKENS;
  const flush = (): void => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentTokens = PROMPT_OVERHEAD_TOKENS;
  };

  for (const family of groupFamilies(sorted)) {
    // No pointer ever crosses families (a child sits in its container's family
    // whenever the container is in this run at all), so family costs are
    // additive and can be summed once here.
    const familyTokens = estimateBatchTokens(family) - PROMPT_OVERHEAD_TOKENS;
    const fitsOneBatch = family.length <= MAX_SYMBOLS_PER_CALL
      && PROMPT_OVERHEAD_TOKENS + familyTokens <= MAX_REQUEST_INPUT_TOKENS;
    if (fitsOneBatch) {
      if (current.length + family.length > MAX_SYMBOLS_PER_CALL
        || (current.length > 0 && currentTokens + familyTokens > MAX_REQUEST_INPUT_TOKENS)) flush();
      current.push(...family);
      currentTokens += familyTokens;
      continue;
    }
    // A family too big for one call splits like any other run of symbols. The
    // members that land away from their container pay for their own snippet
    // again: correctness of the citation first, dedupe second.
    for (const node of family) {
      if (current.length >= MAX_SYMBOLS_PER_CALL
        || (current.length > 0 && estimateBatchTokens([...current, node]) > MAX_REQUEST_INPUT_TOKENS)) flush();
      current.push(node);
      currentTokens = estimateBatchTokens(current);
    }
  }
  flush();
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
  /** Set only for the top-level attempt at a full batch — halves never hedge. */
  hedge?: HedgeState,
): Promise<Map<string, StoredRecord>> {
  const attempt = hedge ? callBatchHedged(ctx, targets, hedge) : callBatch(ctx, targets);
  const produced = await attempt.catch((err) => {
    if (isControlError(err)) throw err;
    return new Map<string, StoredRecord>();
  });
  const missing = targets.filter((t) => !produced.has(t.node.stableKey));
  if (missing.length === 0) return produced;

  if (missing.length > RETRY_LEAF_SIZE) {
    const mid = Math.ceil(missing.length / 2);
    const halves = [missing.slice(0, mid), missing.slice(mid)];
    // Halves never hedge: from here down this is failure handling, not latency
    // handling. The batch has already proven it answers badly, so a duplicate
    // is likelier to buy a second failure than a faster one.
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

// ── Straggler hedging ────────────────────────────────────────────────────────

/**
 * One batch took 96s of a 181s symbol phase in the 2026-07-28 cold benchmark:
 * the provider occasionally parks a single request far beyond its siblings'
 * latency, and mapLimit holds that slot until it answers. When a top-level
 * batch has not settled by max(20s, 3x the running median of the batches that
 * already finished this run), we send ONE duplicate of the same request and
 * keep whichever answers first, aborting the loser.
 *
 * Accounting: the hedge pays a second BudgetEnforcer.checkBeforeBatch (a
 * headroom check, not a charge), so a run sitting exactly on its cap stops one
 * batch earlier than it otherwise would. It double-CHARGES only when both
 * copies complete before the abort lands — bounded by SYMBOL_HEDGE_MAX, i.e.
 * at most 3 extra cheap-tier calls per run. An aborted loser never reaches
 * recordUsage (AiClient records usage only on success) and its
 * ai_generation_runs row closes through the normal failure path, so the audit
 * shows a failed duplicate rather than a row stuck in 'running'.
 */
const SYMBOL_HEDGE_MIN_DELAY_MS = 20_000;
const SYMBOL_HEDGE_MEDIAN_FACTOR = 3;

interface HedgeState {
  /** Wall-clock ms of every top-level batch that has COMPLETED this run. */
  durations: number[];
  fired: number;
  max: number;
}

/** Test seam (mirrors `__setQueryForTests`): pins the hedge delay, in ms. */
let hedgeDelayOverrideMs: number | null = null;
export function __setHedgeDelayForTests(ms: number | null): void {
  hedgeDelayOverrideMs = ms;
}

function hedgeDelayMs(state: HedgeState): number {
  if (hedgeDelayOverrideMs !== null) return hedgeDelayOverrideMs;
  // Stragglers stay in the sample. The median is robust to a handful of them,
  // and excluding them would drag the threshold DOWN as the phase degrades —
  // precisely when extra duplicate calls help least.
  const sorted = [...state.durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length === 0 ? 0
    : sorted.length % 2 === 1 ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.max(SYMBOL_HEDGE_MIN_DELAY_MS, median * SYMBOL_HEDGE_MEDIAN_FACTOR);
}

/** Race sentinel: the hedge deadline elapsed with the primary still in flight. */
const HEDGE_DEADLINE = Symbol('hedge-deadline');

async function callBatchHedged(
  ctx: SemanticContext,
  targets: SymbolTarget[],
  state: HedgeState,
): Promise<Map<string, StoredRecord>> {
  const startedAt = Date.now();
  const primary = new AbortController();
  const primaryCall = callBatch(ctx, targets, undefined, primary.signal);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let first: Map<string, StoredRecord> | typeof HEDGE_DEADLINE;
  try {
    const delayMs = hedgeDelayMs(state);
    first = await Promise.race([
      primaryCall,
      new Promise<typeof HEDGE_DEADLINE>((resolve) => {
        timer = setTimeout(() => resolve(HEDGE_DEADLINE), delayMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (first !== HEDGE_DEADLINE) {
    state.durations.push(Date.now() - startedAt);
    return first;
  }
  if (state.fired >= state.max) {
    // Cap spent: this batch waits it out, exactly as it did before hedging.
    const produced = await primaryCall;
    state.durations.push(Date.now() - startedAt);
    return produced;
  }

  state.fired += 1;
  const hedged = new AbortController();
  const hedgedCall = callBatch(ctx, targets, undefined, hedged.signal);
  const primaryTagged = primaryCall.then((records) => ({ from: 'primary' as const, records }));
  const hedgedTagged = hedgedCall.then((records) => ({ from: 'hedged' as const, records }));

  let winner: { from: 'primary' | 'hedged'; records: Map<string, StoredRecord> };
  try {
    winner = await Promise.race([primaryTagged, hedgedTagged]);
  } catch (err) {
    // Whichever answered first failed. Cancel both and hand the error to the
    // caller's existing handling — a control error propagates out of
    // runBatchWithSplitting, anything else drops to the halving path. One
    // recovery path for a failing batch, not two.
    primary.abort();
    hedged.abort();
    primaryTagged.catch(() => {});
    hedgedTagged.catch(() => {});
    throw err;
  }

  const loser = winner.from === 'primary' ? { ctl: hedged, call: hedgedTagged } : { ctl: primary, call: primaryTagged };
  loser.ctl.abort();
  // The loser settles in the background. Swallowing its rejection is safe even
  // when it is a control error (pause / kill switch / budget): every following
  // batch re-checks all three at its own checkBeforeBatch, so a pause takes
  // effect one batch later instead of being lost.
  loser.call.catch(() => {});
  state.durations.push(Date.now() - startedAt);
  return winner.records;
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
  // These records are stored, content-addressed, cached across snapshots, and
  // re-fed into later section/capability prompts — so an injection that lands
  // here persists and spreads (finding P3). The boundary rule goes first.
  UNTRUSTED_DATA_RULE,
  OUTPUT_RULES,
  `Set each record's stable_key to the symbol's stable key exactly as given.`,
].join('\n\n');

async function callBatch(
  ctx: SemanticContext,
  targets: SymbolTarget[],
  critiqueNotes?: string,
  signal?: AbortSignal,
): Promise<Map<string, StoredRecord>> {
  const produced = new Map<string, StoredRecord>();
  if (targets.length === 0) return produced;

  const sections: string[] = [];
  const aliasByKey = new Map<string, string>();
  // Symbols whose code already appears inside a container's fence in this very
  // prompt cite it instead of repeating it (co-batching).
  const pointers = planSnippetDedupe(targets.map((t) => t.node));
  targets.forEach((t, i) => {
    const alias = `r${i + 1}`;
    aliasByKey.set(t.node.stableKey, alias);
    sections.push(renderSymbolFacts(ctx, t.node, alias, pointers.get(t.node.stableKey)));
  });

  // The symbol facts are pure repo content — snippets, names, paths, and the
  // comments inside them — so the whole block is fenced as untrusted (§5.4).
  // The critique notes are OUR text and stay outside the fence.
  const fence = makeUntrustedFence();
  const prompt = [
    critiqueNotes ? `A previous attempt was rejected by review. Fix these problems:\n${critiqueNotes}` : null,
    fence.wrap(sections.join('\n\n')),
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
    signal,
  });

  // Hedged loser that answered inside the abort window: the winner has already
  // persisted these records. Writing them again would insert a second set of
  // source_receipts (that INSERT has no conflict key), and the graph node panel
  // reads receipts by record_id — the duplicates would render twice.
  if (signal?.aborted) return produced;

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

function renderSymbolFacts(
  ctx: SemanticContext,
  node: EvidenceNode,
  receiptAlias: string,
  /** Set when this symbol's code is already inside a container's fence above. */
  pointer?: SnippetPointer,
): string {
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
  if (ctx.privacyMode === 'full_ai' && pointer) {
    // Every facts line above is still this symbol's own; only the code copy is
    // dropped, because the container's fence above carries these exact lines.
    lines.push(
      `source: lines ${pointer.fromLine}-${pointer.toLine} of the snippet under `
      + `"### Symbol ${pointer.containerKey}" above (file lines ${node.lineStart}-${node.lineEnd})`,
    );
  } else if (ctx.privacyMode === 'full_ai' && node.snippet) {
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
  // Mechanism, not domain. This read `purposeSignals` — the deleted phrase
  // table that turned `/ast/` inside "toaster" into "repository analysis" —
  // and so a facts-only record, the one record type that is supposed to state
  // only what was observed, carried a guess about what the product was for.
  // `behaviorSignals` are what the code demonstrably calls.
  const signals = Array.isArray(node.metadata.behaviorSignals) ? (node.metadata.behaviorSignals as string[]) : [];
  const purpose = signals.length > 0
    ? `${node.type} '${node.name}' (${signals.map((s) => s.replace(/_/g, ' ')).join(', ')})`
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
