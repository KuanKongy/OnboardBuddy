/**
 * Hierarchical synthesis (doc/Pipeline.md "Hierarchical synthesis"):
 * bottom-up strong-tier records — file records from symbol records, module
 * records from file records (architecture clusters are the module
 * grouping), service records from modules + runtime facts, one system
 * record ("the whole picture without a README"), plus narrative records
 * for the top workflows. Every level is content-address cached on its
 * children's evidence hashes.
 */

import { mapLimit } from '../../lib/parallel.js';
import type { EvidenceNode } from '../types/analysis.js';
import type { SemanticContext } from './context.js';
import {
  PROMPT_VERSIONS, OUTPUT_RULES, schemaForLevel, batchedLevelSchema, renderSummary,
  type RecordLevel, type SemanticRecordBody,
} from './recordTypes.js';
import {
  evidenceHashForChildren, lookupRecord, lookupRecords, insertRecord, insertRecordsBulk,
  mapToSnapshot, mapToSnapshotBulk, attachReceipts, attachReceiptsBulk,
  type StoredRecord, type ReceiptDraft, type RecordCacheKey, type InsertRecordInput,
} from './recordStore.js';

export interface SynthesisResult {
  fileRecords: Map<string, StoredRecord>;    // filePath -> record
  moduleRecords: Map<string, StoredRecord>;  // cluster stableKey -> record
  serviceRecords: Map<string, StoredRecord>; // service stableKey -> record
  systemRecord: StoredRecord | null;
  workflowRecords: Map<string, StoredRecord>; // workflow stableKey -> record
  cacheHits: number;
  llmRecords: number;
}

const TOP_WORKFLOWS_FOR_RECORDS = 10;
// 1M-context sizing (Track B): richer child context per record, and file
// records — the second-largest call count — batch several files per call.
const CHILD_SUMMARY_CAP = 400;
const MAX_CHILDREN_IN_PROMPT = 120;
// 6 files ≈ 5-6k output/call — sized for measured ~30-120 tok/s decode.
const FILES_PER_SYNTHESIS_CALL = 6;
const FILE_BATCH_OUTPUT_TOKENS_PER_FILE = 900;

export async function runSynthesisPass(ctx: SemanticContext, symbolRecords: Map<string, StoredRecord>): Promise<SynthesisResult> {
  const result: SynthesisResult = {
    fileRecords: new Map(), moduleRecords: new Map(), serviceRecords: new Map(),
    systemRecord: null, workflowRecords: new Map(), cacheHits: 0, llmRecords: 0,
  };

  // ── workflow records run CONCURRENTLY with the file→module→service→system
  //    chain — they depend only on symbol records (Track B).
  const workflowsDone = runWorkflowRecords(ctx, result, symbolRecords);

  // ── file records (only files with at least one LLM-analyzed symbol) ────────
  // Batched: several files per call + bulk persistence — one file per call
  // pinned the call count to the file count (~155 on mid-size repos).
  const symbolsByFile = new Map<string, StoredRecord[]>();
  for (const [stableKey, record] of symbolRecords) {
    const file = stableKey.split('#')[0]!;
    if (!symbolsByFile.has(file)) symbolsByFile.set(file, []);
    symbolsByFile.get(file)!.push(record);
  }
  const fileNodes = new Map(ctx.graph.nodes.filter((n) => n.type === 'file' || n.type === 'module' || n.type === 'test').map((n) => [n.stableKey, n]));
  const fileEntries = [...symbolsByFile.entries()].filter(([, children]) => children.some((c) => !c.factsOnly));
  await synthesizeFileRecordsBatched(ctx, result, fileEntries, fileNodes);

  // ── module records (architecture clusters are the module grouping) ─────────
  await mapLimit(ctx.architecture.clusters, 8, async (cluster) => {
    const children = cluster.members
      .map((m) => result.fileRecords.get(m.nodeStableKey))
      .filter((r): r is StoredRecord => r !== undefined);
    if (children.length === 0) return;
    const crossEdges = ctx.architecture.edges
      .filter((e) => e.sourceClusterKey === cluster.stableKey || e.targetClusterKey === cluster.stableKey)
      .map((e) => `${e.sourceClusterKey} -[${e.type}]-> ${e.targetClusterKey} (weight ${e.weight})`);
    const record = await synthesizeOne(ctx, result, {
      level: 'module',
      stableKey: cluster.stableKey,
      name: cluster.label,
      children,
      localFacts: { kind: cluster.kind, label: cluster.label, memberCount: cluster.members.length, crossEdges },
      nodeId: null,
      task: `Synthesize a MODULE record for the "${cluster.label}" cluster (${cluster.kind}) from its file records and cross-module edges. Include key_files, internal_structure, and boundary_contracts.`,
      extraFacts: crossEdges.length > 0 ? `Cross-module edges:\n${crossEdges.join('\n')}` : undefined,
    });
    if (record) result.moduleRecords.set(cluster.stableKey, record);
  });

  // ── service records (workspace packages; single-package repos get one) ─────
  const services = groupClustersIntoServices(ctx);
  await mapLimit(services, 4, async (service) => {
    const children = service.clusterKeys
      .map((key) => result.moduleRecords.get(key))
      .filter((r): r is StoredRecord => r !== undefined);
    if (children.length === 0) return;
    const runtimeFacts = {
      entrypointKinds: [...new Set(ctx.entrypoints.map((e) => e.kind))],
      frameworks: ctx.inventory.detectedFrameworks,
      dockerServices: ctx.inventory.dockerServices.map((d) => d.name),
    };
    const record = await synthesizeOne(ctx, result, {
      level: 'service',
      stableKey: service.stableKey,
      name: service.name,
      children,
      localFacts: runtimeFacts,
      nodeId: null,
      task: `Synthesize a SERVICE record for "${service.name}" from its module records and runtime facts (entrypoints: ${runtimeFacts.entrypointKinds.join(', ') || 'none'}; frameworks: ${runtimeFacts.frameworks.join(', ') || 'none'}). Include runtime_shape (api/worker/frontend/library).`,
    });
    if (record) result.serviceRecords.set(service.stableKey, record);
  });

  // ── system record ───────────────────────────────────────────────────────────
  const systemChildren = [...result.serviceRecords.values()];
  if (systemChildren.length > 0) {
    const topWorkflows = ctx.workflows.slice(0, 5).map((w) => `${w.title}: ${w.purpose}`);
    result.systemRecord = await synthesizeOne(ctx, result, {
      level: 'system',
      stableKey: 'system',
      name: 'system',
      children: systemChildren,
      localFacts: { topWorkflows, clusterLabels: ctx.architecture.clusters.map((c) => c.label) },
      nodeId: null,
      task: 'Synthesize the SYSTEM record: what the product does, main_capabilities, architecture_narrative, and request_flow_narrative (how a request flows end to end). This must paint the whole picture even if the repo has no README.',
      extraFacts: topWorkflows.length > 0 ? `Top traced workflows:\n${topWorkflows.join('\n')}` : undefined,
    });
  }

  await workflowsDone;

  return result;
}

/** Workflow records: top N, from steps + participating symbol records. */
async function runWorkflowRecords(
  ctx: SemanticContext,
  result: SynthesisResult,
  symbolRecords: Map<string, StoredRecord>,
): Promise<void> {
  await mapLimit(ctx.workflows.slice(0, TOP_WORKFLOWS_FOR_RECORDS), 10, async (workflow) => {
    const participantRecords = workflow.steps
      .map((s) => symbolRecords.get(s.nodeStableKey))
      .filter((r): r is StoredRecord => r !== undefined);
    const steps = workflow.steps.map(
      (s) => `${s.stepOrder}. [${s.stepKind}] ${s.filePath}${s.symbolName ? `::${s.symbolName}` : ''} — ${s.deterministicDescription}`,
    );
    const record = await synthesizeOne(ctx, result, {
      level: 'workflow',
      stableKey: workflow.stableKey,
      name: workflow.title,
      children: participantRecords,
      localFacts: { steps, triggerType: workflow.triggerType, purpose: workflow.purpose },
      nodeId: null,
      task: `Write a WORKFLOW record for "${workflow.title}" (${workflow.triggerType}). Include step_narrative (one entry per traced step, in order) and failure_modes.`,
      extraFacts: `Traced steps:\n${steps.join('\n')}`,
    });
    if (record) result.workflowRecords.set(workflow.stableKey, record);
  });
}

/** Workspace packages become services; single-package repos get one 'app' service. */
export function groupClustersIntoServices(ctx: Pick<SemanticContext, 'inventory' | 'architecture'>): Array<{ stableKey: string; name: string; clusterKeys: string[] }> {
  const packages = ctx.inventory.packages.filter((p) => p.root !== '' && p.root !== '.');
  if (packages.length === 0) {
    return [{
      stableKey: 'service:app',
      name: 'app',
      clusterKeys: ctx.architecture.clusters.map((c) => c.stableKey),
    }];
  }
  const services = packages.map((p) => ({
    stableKey: `service:${p.root}`,
    name: p.name || p.root,
    clusterKeys: [] as string[],
  }));
  const fallback = { stableKey: 'service:root', name: 'root', clusterKeys: [] as string[] };
  for (const cluster of ctx.architecture.clusters) {
    const firstMember = cluster.members[0]?.nodeStableKey ?? '';
    const owner = services.find((s) => firstMember.startsWith(`${s.stableKey.slice('service:'.length)}/`));
    (owner ?? fallback).clusterKeys.push(cluster.stableKey);
  }
  return fallback.clusterKeys.length > 0 ? [...services, fallback] : services;
}

// ── Batched file records ─────────────────────────────────────────────────────

const FILE_BATCH_SYSTEM = [
  'You are synthesizing FILE records for a codebase onboarding tool. For EACH file below, produce one semantic record from its symbol records. Include key_symbols (most important symbols) and file_role (e.g. route file / service / util / config glue).',
  OUTPUT_RULES,
  "Set each record's stable_key to the file path exactly as given in its heading.",
].join('\n\n');

interface FileTarget {
  filePath: string;
  children: StoredRecord[];
  shown: StoredRecord[];
  localFacts: unknown;
  cacheKey: RecordCacheKey;
  nodeId: string | null;
}

/**
 * File records batched FILES_PER_SYNTHESIS_CALL per LLM call with bulk
 * cache lookup and bulk persistence — one call per file made this the
 * second-largest call count in the pipeline (Track B+C). Files the model
 * skips in a batch fall back to the single-record path.
 */
async function synthesizeFileRecordsBatched(
  ctx: SemanticContext,
  result: SynthesisResult,
  fileEntries: Array<[string, StoredRecord[]]>,
  fileNodes: Map<string, EvidenceNode>,
): Promise<void> {
  if (fileEntries.length === 0) return;
  const promptVersion = PROMPT_VERSIONS.file;
  const base = {
    projectId: ctx.projectId, level: 'file' as const,
    promptVersion, depth: ctx.depth, modelFamily: ctx.modelFamily.cheap,
  };

  const targets: FileTarget[] = fileEntries.map(([filePath, children]) => {
    const fileNode = fileNodes.get(filePath);
    const localFacts = { fileHash: fileNode?.hash ?? null, exported: fileNode?.metadata.exportedSymbols ?? null };
    return {
      filePath,
      children,
      shown: children.slice(0, MAX_CHILDREN_IN_PROMPT),
      localFacts,
      cacheKey: {
        ...base,
        stableKey: filePath,
        evidenceHash: evidenceHashForChildren(
          children.map((c) => ({ id: c.id, evidenceHash: c.evidenceHash })),
          localFacts,
        ),
      },
      nodeId: ctx.nodeIdMap.get(filePath) ?? null,
    };
  });

  const cached = await lookupRecords(
    base,
    targets.map((t) => ({ stableKey: t.filePath, evidenceHash: t.cacheKey.evidenceHash })),
  );
  const cachedEntries: Array<{ record: StoredRecord; nodeId: string | null }> = [];
  const misses: FileTarget[] = [];
  for (const t of targets) {
    const hit = cached.get(t.filePath);
    if (hit) {
      result.fileRecords.set(t.filePath, hit);
      result.cacheHits += 1;
      cachedEntries.push({ record: hit, nodeId: t.nodeId });
    } else {
      misses.push(t);
    }
  }
  if (cachedEntries.length > 0) await mapToSnapshotBulk(ctx.snapshotId, cachedEntries);

  const batches: FileTarget[][] = [];
  for (let i = 0; i < misses.length; i += FILES_PER_SYNTHESIS_CALL) {
    batches.push(misses.slice(i, i + FILES_PER_SYNTHESIS_CALL));
  }
  let batchesDone = 0;
  await mapLimit(batches, 20, async (batch) => {
    const sections = batch.map((t, fi) => {
      const lines = t.shown.map(
        (c, ci) => `- (receipt f${fi + 1}c${ci + 1}) [${c.recordLevel}] ${c.stableKey}: ${c.summary.slice(0, CHILD_SUMMARY_CAP)}${c.factsOnly ? ' [facts-only]' : ''}`,
      );
      return [
        `### File ${t.filePath} (stable_key: ${t.filePath})`,
        `Child records (${t.children.length} total, ${t.shown.length} shown):`,
        lines.join('\n') || '(none)',
      ].join('\n');
    });
    const response = await ctx.ai.call<{ records: Array<SemanticRecordBody & { stable_key: string }> }>({
      tier: 'cheap',
      targetType: 'file_record',
      promptVersion,
      schemaName: 'file_records',
      schema: batchedLevelSchema('file'),
      system: FILE_BATCH_SYSTEM,
      user: sections.join('\n\n'),
      // 4k floor covers deepseek reasoning tokens (counted against max_tokens).
      maxOutputTokens: Math.min(60_000, 4_000 + FILE_BATCH_OUTPUT_TOKENS_PER_FILE * batch.length),
    }).catch((err) => {
      if (isSynthControlError(err)) throw err;
      return { value: null, model: null, usage: { inputTokens: 0, outputTokens: 0 } };
    });

    const byKey = new Map((response.value?.records ?? []).map((r) => [r.stable_key, r]));
    const persist: Array<{ target: FileTarget; batchIndex: number; input: InsertRecordInput }> = [];
    batch.forEach((t, fi) => {
      const raw = byKey.get(t.filePath);
      if (!raw) return;
      const { stable_key: _ignored, ...body } = raw;
      persist.push({
        target: t,
        batchIndex: fi,
        input: {
          key: t.cacheKey,
          record: body,
          summary: renderSummary(t.filePath, body),
          confidence: body.confidence,
          factsOnly: false,
          status: 'pending',
          childRecordIds: t.children.map((c) => c.id),
          model: response.model,
          tokenUsage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
        },
      });
    });

    if (persist.length > 0) {
      const inserted = await insertRecordsBulk(persist.map((p) => p.input));
      const items = persist.map(({ target, batchIndex }) => {
        const record = inserted.get(target.filePath)!;
        const drafts: ReceiptDraft[] = target.shown.map((c, ci) => ({
          alias: `f${batchIndex + 1}c${ci + 1}`,
          kind: 'record_reference',
          trustLevel: c.factsOnly ? 'code' : 'llm_inference',
          referencedRecordId: c.id,
          nodeStableKey: c.stableKey,
        }));
        return { record, drafts, nodeId: target.nodeId };
      });
      await attachReceiptsBulk({
        projectId: ctx.projectId, snapshotId: ctx.snapshotId, commitHash: ctx.commitHash,
        items: items.map(({ record, drafts }) => ({ record, drafts })),
      });
      await mapToSnapshotBulk(ctx.snapshotId, items.map(({ record, nodeId }) => ({ record, nodeId })));
      for (const { record } of items) {
        result.fileRecords.set(record.stableKey, record);
        result.llmRecords += 1;
      }
    }

    // Files the model skipped fall back to the single-record path — never
    // silently dropped.
    const missing = batch.filter((t) => !result.fileRecords.has(t.filePath));
    for (const t of missing) {
      const record = await synthesizeOne(ctx, result, {
        level: 'file',
        stableKey: t.filePath,
        name: t.filePath,
        children: t.children,
        localFacts: t.localFacts,
        nodeId: t.nodeId,
        task: `Synthesize a FILE record for ${t.filePath} from its symbol records. Include key_symbols (most important symbols) and file_role (e.g. route file / service / util / config glue).`,
        tier: 'cheap',
      });
      if (record) result.fileRecords.set(t.filePath, record);
    }
    batchesDone += 1;
    await ctx.onProgress?.({ phase: 'synthesis', done: batchesDone, total: batches.length, detail: `Semantic: file records (${batchesDone}/${batches.length} batches)` });
  });
}

function isSynthControlError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'AiPausedError' || name === 'KillSwitchError' || name === 'AiDisabledError'
    || name === 'BudgetExceededError';
}

// ── One synthesis record ─────────────────────────────────────────────────────

interface SynthesizeInput {
  level: RecordLevel;
  stableKey: string;
  name: string;
  children: StoredRecord[];
  localFacts: unknown;
  nodeId: string | null;
  task: string;
  extraFacts?: string;
  /** Model tier; module/service/system/workflow default to 'strong'. */
  tier?: 'cheap' | 'strong';
}

async function synthesizeOne(ctx: SemanticContext, tally: { cacheHits: number; llmRecords: number }, input: SynthesizeInput): Promise<StoredRecord | null> {
  const tier = input.tier ?? 'strong';
  const promptVersion = PROMPT_VERSIONS[input.level as keyof typeof PROMPT_VERSIONS] ?? PROMPT_VERSIONS.file;
  const cacheKey = {
    projectId: ctx.projectId,
    stableKey: input.stableKey,
    level: input.level,
    evidenceHash: evidenceHashForChildren(
      input.children.map((c) => ({ id: c.id, evidenceHash: c.evidenceHash })),
      input.localFacts,
    ),
    promptVersion,
    depth: ctx.depth,
    modelFamily: tier === 'cheap' ? ctx.modelFamily.cheap : ctx.modelFamily.strong,
  };
  const cached = await lookupRecord(cacheKey);
  if (cached) {
    await mapToSnapshot(ctx.snapshotId, cached, input.nodeId);
    tally.cacheHits += 1;
    return cached;
  }

  const shownChildren = input.children.slice(0, MAX_CHILDREN_IN_PROMPT);
  const drafts: ReceiptDraft[] = shownChildren.map((c, i) => ({
    alias: `c${i + 1}`,
    kind: 'record_reference',
    trustLevel: c.factsOnly ? 'code' : 'llm_inference',
    referencedRecordId: c.id,
    nodeStableKey: c.stableKey,
  }));
  const childLines = shownChildren.map(
    (c, i) => `- (receipt c${i + 1}) [${c.recordLevel}] ${c.stableKey}: ${c.summary.slice(0, CHILD_SUMMARY_CAP)}${c.factsOnly ? ' [facts-only]' : ''}`,
  );

  const prompt = [
    input.task,
    input.extraFacts ?? null,
    `Child records (${input.children.length} total, ${shownChildren.length} shown):`,
    childLines.join('\n') || '(none)',
  ].filter(Boolean).join('\n\n');

  const response = await ctx.ai.call<SemanticRecordBody>({
    tier,
    targetType: `${input.level}_record`,
    promptVersion,
    schemaName: `${input.level}_record`,
    schema: schemaForLevel(input.level),
    // Byte-identical prefix across synthesis calls — provider prompt cache.
    system: OUTPUT_RULES,
    user: prompt,
    maxOutputTokens: 8_000,
  });
  if (!response.value) return null;

  const record = await insertRecord({
    key: cacheKey,
    record: response.value,
    summary: renderSummary(input.name, response.value),
    confidence: response.value.confidence,
    factsOnly: false,
    status: 'pending',
    childRecordIds: input.children.map((c) => c.id),
    model: response.model,
    tokenUsage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
  });
  await attachReceipts({
    projectId: ctx.projectId,
    snapshotId: ctx.snapshotId,
    commitHash: ctx.commitHash,
    record,
    drafts,
  });
  await mapToSnapshot(ctx.snapshotId, record, input.nodeId);
  tally.llmRecords += 1;
  return record;
}
