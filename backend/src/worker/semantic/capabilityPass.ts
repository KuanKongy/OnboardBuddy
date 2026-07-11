/**
 * Capability extraction (doc/Pipeline.md "capability-extraction-v1"):
 * groups workflows/modules into business capabilities ("repo analysis",
 * "team management"), stored as first-class capabilities rows with member
 * links plus a capability-level semantic record each.
 */

import { query } from '../../lib/db.js';
import type { SemanticContext } from './context.js';
import { PROMPT_VERSIONS, OUTPUT_RULES, renderSummary, type SemanticRecordBody, type RecordConfidence } from './recordTypes.js';
import { evidenceHashForChildren, insertRecord, lookupRecord, mapToSnapshot, attachReceipts, type StoredRecord } from './recordStore.js';
import type { SynthesisResult } from './synthesisPass.js';

export interface CapabilityPassResult {
  capabilities: number;
  cacheHit: boolean;
}

interface RawCapability {
  name: string;
  description: string;
  user_value: string;
  involved_workflow_keys: string[];
  involved_module_keys: string[];
  confidence: RecordConfidence;
}

const CAPABILITIES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['capabilities'],
  properties: {
    capabilities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'user_value', 'involved_workflow_keys', 'involved_module_keys', 'confidence'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          user_value: { type: 'string' },
          involved_workflow_keys: { type: 'array', items: { type: 'string' } },
          involved_module_keys: { type: 'array', items: { type: 'string' } },
          confidence: { enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

export async function runCapabilityPass(ctx: SemanticContext, synthesis: SynthesisResult): Promise<CapabilityPassResult> {
  const moduleRecords = [...synthesis.moduleRecords.values()];
  const workflowRecords = [...synthesis.workflowRecords.values()];
  if (moduleRecords.length === 0 && ctx.workflows.length === 0) return { capabilities: 0, cacheHit: false };

  // business_concepts aggregation across all module/workflow records
  const concepts = new Map<string, number>();
  for (const r of [...moduleRecords, ...workflowRecords]) {
    for (const c of r.record.business_concepts ?? []) {
      concepts.set(c, (concepts.get(c) ?? 0) + 1);
    }
  }

  const prompt = [
    'Extract the business capabilities of this system: user-meaningful groups of functionality (e.g. "repo analysis", "team management"). Group the workflows and modules below into 2-8 capabilities. Use involved_workflow_keys / involved_module_keys with the exact stable keys given.',
    OUTPUT_RULES,
    `Workflows:\n${ctx.workflows.map((w) => `- ${w.stableKey}: ${w.title} — ${w.purpose}`).join('\n') || '(none traced)'}`,
    `Modules:\n${moduleRecords.map((m) => `- ${m.stableKey}: ${m.summary.slice(0, 200)}`).join('\n') || '(none)'}`,
    `Aggregated business concepts: ${[...concepts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c, n]) => `${c} (${n})`).join(', ') || '(none)'}`,
  ].join('\n\n');

  const children = [...moduleRecords, ...workflowRecords].map((r) => ({ id: r.id, evidenceHash: r.evidenceHash }));
  const cacheKey = {
    projectId: ctx.projectId,
    stableKey: 'capabilities',
    level: 'capability' as const,
    evidenceHash: evidenceHashForChildren(children, { workflowKeys: ctx.workflows.map((w) => w.stableKey).sort() }),
    promptVersion: PROMPT_VERSIONS.capability,
    depth: ctx.depth,
    modelFamily: ctx.modelFamily.strong,
  };

  // The extraction call itself is cached via the records it produced last
  // time: if the aggregate record exists, rebuild rows from it without an
  // LLM call (capabilities/capability_members are snapshot-scoped rows).
  const cachedAggregate = await lookupRecord(cacheKey);
  let rawCapabilities: RawCapability[];
  let aggregate: StoredRecord;
  if (cachedAggregate) {
    aggregate = cachedAggregate;
    rawCapabilities = ((cachedAggregate.record as unknown as { capabilities?: RawCapability[] }).capabilities) ?? [];
  } else {
    const response = await ctx.ai.call<{ capabilities: RawCapability[] }>({
      tier: 'strong',
      targetType: 'capability_record',
      promptVersion: PROMPT_VERSIONS.capability,
      schemaName: 'capabilities',
      schema: CAPABILITIES_SCHEMA,
      user: prompt,
    });
    rawCapabilities = response.value?.capabilities ?? [];
    const body: SemanticRecordBody & { capabilities: RawCapability[] } = {
      purpose: `Business capabilities of the system (${rawCapabilities.length}).`,
      behavior: rawCapabilities.map((c) => `${c.name}: ${c.description}`).join(' '),
      responsibilities: rawCapabilities.map((c) => c.name),
      business_concepts: [...concepts.keys()].slice(0, 20),
      side_effects: [], inputs_outputs: null,
      dependencies_narrative: '', design_patterns: [], risks_invariants: [],
      confidence: 'medium', claims: [],
      capabilities: rawCapabilities,
    };
    aggregate = await insertRecord({
      key: cacheKey,
      record: body,
      summary: renderSummary('capabilities', body),
      confidence: 'medium',
      factsOnly: false,
      status: 'pending',
      childRecordIds: children.map((c) => c.id),
      model: response.model,
      tokenUsage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
    });
    await attachReceipts({
      projectId: ctx.projectId, snapshotId: ctx.snapshotId, commitHash: ctx.commitHash,
      record: aggregate,
      drafts: [...moduleRecords, ...workflowRecords].slice(0, 40).map((r, i) => ({
        alias: `c${i + 1}`, kind: 'record_reference', trustLevel: 'llm_inference',
        referencedRecordId: r.id, nodeStableKey: r.stableKey,
      })),
    });
  }
  await mapToSnapshot(ctx.snapshotId, aggregate, null);

  // Persist snapshot-scoped capability rows + members.
  let written = 0;
  for (const cap of rawCapabilities) {
    const stableKey = `capability:${slugify(cap.name)}`;
    const capResult = await query(
      `INSERT INTO capabilities (snapshot_id, stable_key, name, description, record_id, confidence, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (snapshot_id, stable_key) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description,
             record_id = EXCLUDED.record_id, confidence = EXCLUDED.confidence
       RETURNING id`,
      [ctx.snapshotId, stableKey, cap.name, cap.description, aggregate.id, cap.confidence,
       JSON.stringify({ userValue: cap.user_value })],
    );
    const capabilityId = (capResult.rows[0] as { id: string }).id;
    for (const wfKey of cap.involved_workflow_keys) {
      const workflowId = ctx.workflowIdMap.get(wfKey);
      if (!workflowId) continue;
      await query(
        `INSERT INTO capability_members (capability_id, member_type, member_id, stable_key, membership_reason)
         VALUES ($1, 'workflow', $2, $3, 'named by capability extraction')
         ON CONFLICT DO NOTHING`,
        [capabilityId, workflowId, wfKey],
      );
    }
    for (const moduleKey of cap.involved_module_keys) {
      if (!synthesis.moduleRecords.has(moduleKey)) continue;
      const clusterRow = await query(
        `SELECT id FROM architecture_clusters WHERE snapshot_id = $1 AND stable_key = $2`,
        [ctx.snapshotId, moduleKey],
      );
      const clusterId = (clusterRow.rows[0] as { id: string } | undefined)?.id;
      if (!clusterId) continue;
      await query(
        `INSERT INTO capability_members (capability_id, member_type, member_id, stable_key, membership_reason)
         VALUES ($1, 'cluster', $2, $3, 'named by capability extraction')
         ON CONFLICT DO NOTHING`,
        [capabilityId, clusterId, moduleKey],
      );
    }
    written += 1;
  }
  return { capabilities: written, cacheHit: cachedAggregate !== null };
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unnamed';
}
