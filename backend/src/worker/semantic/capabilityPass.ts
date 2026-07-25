/**
 * Capability extraction (doc/Pipeline.md "capability-extraction"; prompt v2):
 * groups workflows/modules into business capabilities ("repo analysis",
 * "team management"), stored as first-class capabilities rows with member
 * links plus a capability-level semantic record each. v2 adds the feature-map
 * hub fields: user_value, per-member reasons, and grounded where_to_start
 * entry points picked from the deterministic candidate ranking.
 */

import { query } from '../../lib/db.js';
import { makeUntrustedFence, UNTRUSTED_DATA_RULE } from '../ai/untrustedData.js';
import type { SemanticContext } from './context.js';
import { PROMPT_VERSIONS, OUTPUT_RULES, renderSummary, type SemanticRecordBody, type RecordConfidence } from './recordTypes.js';
import { evidenceHashForChildren, insertRecord, lookupRecord, mapToSnapshot, attachReceipts, type StoredRecord } from './recordStore.js';
import type { SynthesisResult } from './synthesisPass.js';

export interface CapabilityPassResult {
  capabilities: number;
  cacheHit: boolean;
}

interface MemberRef {
  key: string;
  reason: string;
}

interface RawCapability {
  name: string;
  description: string;
  user_value: string;
  involved_workflows: MemberRef[];
  involved_modules: MemberRef[];
  where_to_start: MemberRef[];
  confidence: RecordConfidence;
}

const MEMBER_REF_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'reason'],
    properties: {
      key: { type: 'string' },
      reason: { type: 'string' },
    },
  },
};

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
        required: ['name', 'description', 'user_value', 'involved_workflows', 'involved_modules', 'where_to_start', 'confidence'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          user_value: { type: 'string' },
          involved_workflows: MEMBER_REF_SCHEMA,
          involved_modules: MEMBER_REF_SCHEMA,
          where_to_start: MEMBER_REF_SCHEMA,
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

  // Grounded "start here" candidates: top-ranked files/symbols from the
  // deterministic candidate ranking (never let the model invent paths).
  const startCandidates = ctx.rankings
    .filter((r) => r.targetType === 'file' || r.targetType === 'symbol')
    .slice(0, 25);

  // Instructions move to the `system` turn so the boundary is a real turn
  // boundary, not just a paragraph break (§5.4). The evidence below is
  // second-order untrusted: workflow titles and module summaries are already
  // model output written FROM repo snippets, so an injection that survived the
  // symbol pass arrives here as ordinary-looking prose (finding P3).
  const system = [
    'Extract the business capabilities of this system: user-meaningful groups of functionality (e.g. "repo analysis", "team management"). Group the workflows and modules given by the user into 2-8 capabilities. This feeds an onboarding hub a new developer uses to decide what to read first, so write for someone who has never seen the codebase.',
    [
      'For each capability produce:',
      '- description: 1-2 sentences in plain product language — what a user of the system gets from it. No file names, no jargon.',
      '- user_value: one sentence on when a developer would need to touch this capability (what kind of task or bug leads here).',
      '- involved_workflows / involved_modules: the exact stable keys given below, each with a one-line reason saying what that member does FOR this capability.',
      '- where_to_start: 1-3 entries chosen ONLY from the "Start-here candidates" list, each with a one-line reason why reading it first pays off.',
    ].join('\n'),
    UNTRUSTED_DATA_RULE,
    OUTPUT_RULES,
  ].join('\n\n');

  const fence = makeUntrustedFence();
  const prompt = fence.wrap([
    `Workflows:\n${ctx.workflows.map((w) => `- ${w.stableKey}: ${w.title} — ${w.purpose}`).join('\n') || '(none traced)'}`,
    `Modules:\n${moduleRecords.map((m) => `- ${m.stableKey}: ${m.summary.slice(0, 200)}`).join('\n') || '(none)'}`,
    `Start-here candidates (files/symbols, most critical first):\n${startCandidates.map((r) => `- ${r.stableKey}`).join('\n') || '(none)'}`,
    `Aggregated business concepts: ${[...concepts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c, n]) => `${c} (${n})`).join(', ') || '(none)'}`,
  ].join('\n\n'));

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
      // Structured extraction, one shot per run: the cheap tier (scout) is
      // JSON-reliable here; the strong tier's long-JSON flakiness paused a
      // live run when this single call failed validation twice.
      tier: 'cheap',
      targetType: 'capability_record',
      promptVersion: PROMPT_VERSIONS.capability,
      schemaName: 'capabilities',
      schema: CAPABILITIES_SCHEMA,
      system,
      user: prompt,
      maxOutputTokens: 8_000,
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
  const validStartKeys = new Set(startCandidates.map((r) => r.stableKey));
  let written = 0;
  for (const cap of rawCapabilities) {
    const stableKey = `capability:${slugify(cap.name)}`;
    // Honest links only: drop where_to_start entries the model invented.
    const whereToStart = (cap.where_to_start ?? [])
      .filter((s) => validStartKeys.has(s.key))
      .slice(0, 3)
      .map((s) => ({ stable_key: s.key, reason: s.reason }));
    const capResult = await query(
      `INSERT INTO capabilities (snapshot_id, stable_key, name, description, record_id, confidence, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (snapshot_id, stable_key) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description,
             record_id = EXCLUDED.record_id, confidence = EXCLUDED.confidence,
             metadata = EXCLUDED.metadata
       RETURNING id`,
      [ctx.snapshotId, stableKey, cap.name, cap.description, aggregate.id, cap.confidence,
       JSON.stringify({ user_value: cap.user_value, where_to_start: whereToStart })],
    );
    const capabilityId = (capResult.rows[0] as { id: string }).id;
    for (const wf of cap.involved_workflows ?? []) {
      const workflowId = ctx.workflowIdMap.get(wf.key);
      if (!workflowId) continue;
      await query(
        `INSERT INTO capability_members (capability_id, member_type, member_id, stable_key, membership_reason)
         VALUES ($1, 'workflow', $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [capabilityId, workflowId, wf.key, wf.reason || 'named by capability extraction'],
      );
    }
    for (const mod of cap.involved_modules ?? []) {
      if (!synthesis.moduleRecords.has(mod.key)) continue;
      const clusterRow = await query(
        `SELECT id FROM architecture_clusters WHERE snapshot_id = $1 AND stable_key = $2`,
        [ctx.snapshotId, mod.key],
      );
      const clusterId = (clusterRow.rows[0] as { id: string } | undefined)?.id;
      if (!clusterId) continue;
      await query(
        `INSERT INTO capability_members (capability_id, member_type, member_id, stable_key, membership_reason)
         VALUES ($1, 'cluster', $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [capabilityId, clusterId, mod.key, mod.reason || 'named by capability extraction'],
      );
    }
    written += 1;
  }
  return { capabilities: written, cacheHit: cachedAggregate !== null };
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unnamed';
}
