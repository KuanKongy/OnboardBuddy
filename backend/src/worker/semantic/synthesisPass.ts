/**
 * Hierarchical synthesis (doc/Pipeline.md "Hierarchical synthesis"):
 * bottom-up strong-tier records — file records from symbol records, module
 * records from file records (architecture clusters are the module
 * grouping), service records from modules + runtime facts, one system
 * record ("the whole picture without a README"), plus narrative records
 * for the top workflows. Every level is content-address cached on its
 * children's evidence hashes.
 */

import type { SemanticContext } from './context.js';
import {
  PROMPT_VERSIONS, OUTPUT_RULES, schemaForLevel, renderSummary,
  type RecordLevel, type SemanticRecordBody,
} from './recordTypes.js';
import {
  evidenceHashForChildren, lookupRecord, insertRecord, mapToSnapshot, attachReceipts,
  type StoredRecord, type ReceiptDraft,
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
const CHILD_SUMMARY_CAP = 300;
const MAX_CHILDREN_IN_PROMPT = 40;

export async function runSynthesisPass(ctx: SemanticContext, symbolRecords: Map<string, StoredRecord>): Promise<SynthesisResult> {
  const result: SynthesisResult = {
    fileRecords: new Map(), moduleRecords: new Map(), serviceRecords: new Map(),
    systemRecord: null, workflowRecords: new Map(), cacheHits: 0, llmRecords: 0,
  };

  // ── file records (only files with at least one LLM-analyzed symbol) ────────
  const symbolsByFile = new Map<string, StoredRecord[]>();
  for (const [stableKey, record] of symbolRecords) {
    const file = stableKey.split('#')[0]!;
    if (!symbolsByFile.has(file)) symbolsByFile.set(file, []);
    symbolsByFile.get(file)!.push(record);
  }
  const fileNodes = new Map(ctx.graph.nodes.filter((n) => n.type === 'file' || n.type === 'module' || n.type === 'test').map((n) => [n.stableKey, n]));
  for (const [filePath, children] of symbolsByFile) {
    if (!children.some((c) => !c.factsOnly)) continue; // facts-only files add no synthesis value
    const fileNode = fileNodes.get(filePath);
    const record = await synthesizeOne(ctx, result, {
      level: 'file',
      stableKey: filePath,
      name: filePath,
      children,
      localFacts: { fileHash: fileNode?.hash ?? null, exported: fileNode?.metadata.exportedSymbols ?? null },
      nodeId: ctx.nodeIdMap.get(filePath) ?? null,
      task: `Synthesize a FILE record for ${filePath} from its symbol records. Include key_symbols (most important symbols) and file_role (e.g. route file / service / util / config glue).`,
    });
    if (record) result.fileRecords.set(filePath, record);
  }

  // ── module records (architecture clusters are the module grouping) ─────────
  for (const cluster of ctx.architecture.clusters) {
    const children = cluster.members
      .map((m) => result.fileRecords.get(m.nodeStableKey))
      .filter((r): r is StoredRecord => r !== undefined);
    if (children.length === 0) continue;
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
  }

  // ── service records (workspace packages; single-package repos get one) ─────
  const services = groupClustersIntoServices(ctx);
  for (const service of services) {
    const children = service.clusterKeys
      .map((key) => result.moduleRecords.get(key))
      .filter((r): r is StoredRecord => r !== undefined);
    if (children.length === 0) continue;
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
  }

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

  // ── workflow records (top N, from steps + participating symbol records) ────
  for (const workflow of ctx.workflows.slice(0, TOP_WORKFLOWS_FOR_RECORDS)) {
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
  }

  return result;
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
}

async function synthesizeOne(ctx: SemanticContext, tally: { cacheHits: number; llmRecords: number }, input: SynthesizeInput): Promise<StoredRecord | null> {
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
    modelFamily: ctx.modelFamily.strong,
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
    OUTPUT_RULES,
    input.extraFacts ?? null,
    `Child records (${input.children.length} total, ${shownChildren.length} shown):`,
    childLines.join('\n') || '(none)',
  ].filter(Boolean).join('\n\n');

  const response = await ctx.ai.call<SemanticRecordBody>({
    tier: 'strong',
    targetType: `${input.level}_record`,
    promptVersion,
    schemaName: `${input.level}_record`,
    schema: schemaForLevel(input.level),
    user: prompt,
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
