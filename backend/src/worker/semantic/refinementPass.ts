/**
 * Refinement pass (doc/Pipeline.md "refinement-v1"): re-annotates the
 * top-N critical symbols/files with system context ("why this matters to
 * the product"), producing new record versions — new prompt_version, same
 * evidence. The refined record replaces the original in the snapshot
 * mapping; the original is kept (superseded) for audit.
 */

import { query } from '../../lib/db.js';
import type { SemanticContext } from './context.js';
import { PROMPT_VERSIONS, OUTPUT_RULES, schemaForLevel, renderSummary, type SemanticRecordBody } from './recordTypes.js';
import { lookupRecord, insertRecord, mapToSnapshot, attachReceipts, type StoredRecord } from './recordStore.js';
import type { SynthesisResult } from './synthesisPass.js';

const TOP_N_REFINED = 10;

export interface RefinementResult {
  refined: number;
  cacheHits: number;
}

export async function runRefinementPass(
  ctx: SemanticContext,
  symbolRecords: Map<string, StoredRecord>,
  synthesis: SynthesisResult,
): Promise<RefinementResult> {
  const result: RefinementResult = { refined: 0, cacheHits: 0 };
  const system = synthesis.systemRecord;
  if (!system) return result; // no system context to refine against

  // Top-N candidate-ranked symbol/file targets that got a real LLM record.
  const targets: Array<{ stableKey: string; record: StoredRecord }> = [];
  for (const ranking of ctx.rankings) {
    if (targets.length >= TOP_N_REFINED) break;
    const record = ranking.targetType === 'symbol'
      ? symbolRecords.get(ranking.stableKey)
      : ranking.targetType === 'file' ? synthesis.fileRecords.get(ranking.stableKey) : undefined;
    if (record && !record.factsOnly && record.promptVersion !== PROMPT_VERSIONS.refinement) {
      targets.push({ stableKey: ranking.stableKey, record });
    }
  }

  const systemContext = [
    `System purpose: ${system.record.purpose}`,
    system.record.architecture_narrative ? `Architecture: ${system.record.architecture_narrative}` : null,
    system.record.main_capabilities?.length ? `Capabilities: ${system.record.main_capabilities.join(', ')}` : null,
  ].filter(Boolean).join('\n');

  for (const target of targets) {
    const cacheKey = {
      projectId: ctx.projectId,
      stableKey: target.stableKey,
      level: target.record.recordLevel,
      evidenceHash: target.record.evidenceHash, // same evidence, new prompt version (spec)
      promptVersion: PROMPT_VERSIONS.refinement,
      depth: ctx.depth,
      modelFamily: ctx.modelFamily.strong,
    };
    const cached = await lookupRecord(cacheKey);
    if (cached) {
      await mapToSnapshot(ctx.snapshotId, cached, ctx.nodeIdMap.get(target.stableKey) ?? null);
      result.cacheHits += 1;
      continue;
    }

    const prompt = [
      `Refine this ${target.record.recordLevel} record with system-level context: explain why "${target.stableKey}" matters to the product, sharpen risks_invariants, and enrich business_concepts. Keep every field grounded in the original record and the system context; do not invent new behavior.`,
      OUTPUT_RULES,
      `System context:\n${systemContext}`,
      `Original record (receipt c1):\n${JSON.stringify(target.record.record).slice(0, 6000)}`,
    ].join('\n\n');

    const response = await ctx.ai.call<SemanticRecordBody>({
      tier: 'strong',
      targetType: 'refinement',
      promptVersion: PROMPT_VERSIONS.refinement,
      schemaName: `${target.record.recordLevel}_record`,
      schema: schemaForLevel(target.record.recordLevel),
      user: prompt,
    });
    if (!response.value) continue;

    const refined = await insertRecord({
      key: cacheKey,
      record: response.value,
      summary: renderSummary(target.stableKey, response.value),
      confidence: response.value.confidence,
      factsOnly: false,
      status: 'pending',
      childRecordIds: [target.record.id],
      model: response.model,
      tokenUsage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
    });
    await attachReceipts({
      projectId: ctx.projectId, snapshotId: ctx.snapshotId, commitHash: ctx.commitHash,
      record: refined,
      drafts: [
        { alias: 'c1', kind: 'record_reference', trustLevel: 'llm_inference', referencedRecordId: target.record.id, nodeStableKey: target.stableKey },
        { alias: 'c2', kind: 'record_reference', trustLevel: 'llm_inference', referencedRecordId: system.id, nodeStableKey: 'system' },
      ],
    });
    // The refined record replaces the original in retrieval — carry the
    // original's code-level receipts forward so bundles keep real snippets.
    if (target.record.receiptIds.length > 0) {
      refined.receiptIds = [...refined.receiptIds, ...target.record.receiptIds];
      await query(`UPDATE semantic_records SET receipt_ids = $2 WHERE id = $1`, [refined.id, refined.receiptIds]);
    }
    // Replaces the original in this snapshot's mapping (same stable_key + level).
    await mapToSnapshot(ctx.snapshotId, refined, ctx.nodeIdMap.get(target.stableKey) ?? null);
    if (target.record.recordLevel === 'symbol') symbolRecords.set(target.stableKey, refined);
    else synthesis.fileRecords.set(target.stableKey, refined);
    result.refined += 1;
  }
  return result;
}
