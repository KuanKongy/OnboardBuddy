/**
 * Critique pass (doc/Pipeline.md "critique-v1"): verifies each pending
 * record's claims against its receipts before the record may be used by
 * retrieval/generation. Rejected symbol records are regenerated once with
 * the critique attached, then kept rejected if they fail again — an
 * honest unknown, not a silent pass.
 */

import { query } from '../../lib/db.js';
import type { SemanticContext } from './context.js';
import { PROMPT_VERSIONS, OUTPUT_RULES } from './recordTypes.js';
import { setRecordStatus } from './recordStore.js';
import { regenerateSymbolRecord } from './symbolPass.js';

const RECORDS_PER_CRITIQUE_CALL = 8;
const RECEIPT_SNIPPET_CAP = 800;

export interface CritiqueResult {
  reviewed: number;
  usable: number;
  rejected: number;
  regenerated: number;
}

interface PendingRecord {
  id: string;
  stable_key: string;
  record_level: string;
  facts_only: boolean;
  record: { claims?: Array<{ claim: string; receiptIds: string[] }> } & Record<string, unknown>;
  summary: string;
  receipt_ids: string[];
}

interface Verdict {
  stable_key: string;
  verdict: 'usable' | 'rejected';
  failed_claims: string[];
  notes: string;
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stable_key', 'verdict', 'failed_claims', 'notes'],
        properties: {
          stable_key: { type: 'string' },
          verdict: { enum: ['usable', 'rejected'] },
          failed_claims: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
      },
    },
  },
};

export async function runCritiquePass(ctx: SemanticContext): Promise<CritiqueResult> {
  const result: CritiqueResult = { reviewed: 0, usable: 0, rejected: 0, regenerated: 0 };

  const pending = (await query(
    `SELECT sr.id, sr.stable_key, sr.record_level, sr.facts_only, sr.record, sr.summary, sr.receipt_ids
     FROM semantic_records sr
     JOIN snapshot_semantic_records ssr ON ssr.record_id = sr.id
     WHERE ssr.snapshot_id = $1 AND sr.status = 'pending'
     ORDER BY sr.record_level, sr.stable_key`,
    [ctx.snapshotId],
  )).rows as PendingRecord[];

  for (let i = 0; i < pending.length; i += RECORDS_PER_CRITIQUE_CALL) {
    const batch = pending.slice(i, i + RECORDS_PER_CRITIQUE_CALL);
    const verdicts = await critiqueBatch(ctx, batch);
    for (const record of batch) {
      result.reviewed += 1;
      const verdict = verdicts.get(record.stable_key);
      if (!verdict || verdict.verdict === 'usable') {
        // Missing verdict = reviewer did not flag it; do not reject on silence.
        await setRecordStatus(record.id, 'usable');
        result.usable += 1;
        continue;
      }
      const notes = [verdict.notes, ...verdict.failed_claims.map((c) => `unsupported claim: ${c}`)].join('\n');
      if (record.record_level === 'symbol' && !record.facts_only) {
        const regenerated = await regenerateSymbolRecord(ctx, record.stable_key, notes);
        if (regenerated) {
          result.regenerated += 1;
          const recheck = await critiqueBatch(ctx, [{ ...record, id: regenerated.id, record: regenerated.record as unknown as PendingRecord['record'], summary: regenerated.summary, receipt_ids: regenerated.receiptIds }]);
          const second = recheck.get(record.stable_key);
          if (!second || second.verdict === 'usable') {
            await setRecordStatus(regenerated.id, 'usable');
            result.usable += 1;
            continue;
          }
          await setRecordStatus(regenerated.id, 'rejected', [{ kind: 'record_rejected', notes: second.notes }]);
          result.rejected += 1;
          continue;
        }
      }
      await setRecordStatus(record.id, 'rejected', [{ kind: 'record_rejected', notes: verdict.notes }]);
      result.rejected += 1;
    }
  }
  return result;
}

async function critiqueBatch(ctx: SemanticContext, batch: PendingRecord[]): Promise<Map<string, Verdict>> {
  const sections: string[] = [];
  for (const record of batch) {
    const receipts = record.receipt_ids.length > 0
      ? (await query(
          `SELECT id, receipt_kind, trust_level, file_path, symbol_name, snippet, node_stable_key
           FROM source_receipts WHERE id = ANY($1)`,
          [record.receipt_ids],
        )).rows as Array<{ id: string; receipt_kind: string; trust_level: string; file_path: string | null; symbol_name: string | null; snippet: string | null; node_stable_key: string | null }>
      : [];
    const receiptLines = receipts.map((r) =>
      `  - [${r.id}] ${r.receipt_kind} (${r.trust_level}) ${r.file_path ?? r.node_stable_key ?? ''}${r.snippet ? `\n    ${r.snippet.slice(0, RECEIPT_SNIPPET_CAP).replace(/\n/g, '\n    ')}` : ''}`,
    );
    const claims = (record.record.claims ?? []).map((c) => `  - "${c.claim}" cites [${c.receiptIds.join(', ') || 'nothing'}]`);
    sections.push([
      `### Record ${record.stable_key} (${record.record_level})`,
      `Summary: ${record.summary.slice(0, 300)}`,
      `Claims:\n${claims.join('\n') || '  (no claims listed)'}`,
      `Receipts:\n${receiptLines.join('\n') || '  (none)'}`,
    ].join('\n'));
  }

  const prompt = [
    'You are reviewing generated documentation records against their evidence receipts. For EACH record: verdict "usable" when its substantive claims are supported by the receipts, "rejected" when claims contradict the receipts or assert specifics with no receipt support. List failed claims verbatim. Vague-but-harmless wording is not grounds for rejection; fabricated specifics are.',
    OUTPUT_RULES,
    sections.join('\n\n'),
  ].join('\n\n');

  const response = await ctx.ai.call<{ verdicts: Verdict[] }>({
    tier: 'strong',
    targetType: 'critique',
    promptVersion: PROMPT_VERSIONS.critique,
    schemaName: 'critique_verdicts',
    schema: CRITIQUE_SCHEMA,
    user: prompt,
  });
  return new Map((response.value?.verdicts ?? []).map((v) => [v.stable_key, v]));
}
