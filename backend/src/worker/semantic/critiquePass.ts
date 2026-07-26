/**
 * Critique pass (doc/Pipeline.md "critique-v1"): verifies each pending
 * record's claims against its receipts before the record may be used by
 * retrieval/generation. Rejected symbol records are regenerated once with
 * the critique attached, then kept rejected if they fail again — an
 * honest unknown, not a silent pass.
 */

import { query } from '../../lib/db.js';
import { mapLimit } from '../../lib/parallel.js';
import type { SemanticContext } from './context.js';
import { PROMPT_VERSIONS, OUTPUT_RULES } from './recordTypes.js';
import { setRecordStatus, setRecordStatusBulk } from './recordStore.js';
import { regenerateSymbolRecord } from './symbolPass.js';

// Sized for MEASURED OpenRouter decode (~30-120 tok/s): verdicts are
// ~100-200 output tokens each, so 12/call keeps a batch under ~2.5k output
// (≤60-90s even on a slow upstream) — throughput comes from concurrency.
const RECORDS_PER_CRITIQUE_CALL = 12;
const RECEIPT_SNIPPET_CAP = 1_200;

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

  const batches: PendingRecord[][] = [];
  for (let i = 0; i < pending.length; i += RECORDS_PER_CRITIQUE_CALL) {
    batches.push(pending.slice(i, i + RECORDS_PER_CRITIQUE_CALL));
  }
  let batchesDone = 0;
  await mapLimit(batches, 28, async (batch) => {
    const verdicts = await critiqueBatch(ctx, batch);
    // Straightforward outcomes collect into ONE vectorized status write per
    // batch (Track C); only the rare regenerate path stays per-record.
    const statusUpdates: Array<{ id: string; status: 'usable' | 'rejected'; flags?: Array<Record<string, unknown>> }> = [];
    for (const record of batch) {
      result.reviewed += 1;
      const verdict = verdicts.get(record.stable_key);
      if (!verdict || verdict.verdict === 'usable') {
        // Missing verdict = reviewer did not flag it; do not reject on silence.
        statusUpdates.push({ id: record.id, status: 'usable' });
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
      statusUpdates.push({ id: record.id, status: 'rejected', flags: [{ kind: 'record_rejected', notes: verdict.notes }] });
      result.rejected += 1;
    }
    await setRecordStatusBulk(statusUpdates);
    batchesDone += 1;
    await ctx.onProgress?.({ phase: 'critique', done: batchesDone, total: batches.length, detail: `Verifying records (${batchesDone}/${batches.length} batches)` });
  });
  return result;
}

interface ReceiptRow {
  id: string; receipt_kind: string; trust_level: string;
  file_path: string | null; symbol_name: string | null; snippet: string | null; node_stable_key: string | null;
}

async function critiqueBatch(ctx: SemanticContext, batch: PendingRecord[]): Promise<Map<string, Verdict>> {
  // One receipts query for the whole batch instead of one per record —
  // the DB is remote, round trips dominate.
  const allReceiptIds = [...new Set(batch.flatMap((r) => r.receipt_ids))];
  const receiptById = new Map<string, ReceiptRow>();
  if (allReceiptIds.length > 0) {
    const rows = (await query(
      `SELECT id, receipt_kind, trust_level, file_path, symbol_name, snippet, node_stable_key
       FROM source_receipts WHERE id = ANY($1)`,
      [allReceiptIds],
    )).rows as ReceiptRow[];
    for (const row of rows) receiptById.set(row.id, row);
  }

  // Receipts are stored WITH their snippets (the reader needs them), so the
  // privacy filter has to happen here, at the prompt boundary. Without this
  // check facts_only_ai leaked code anyway: symbolPass withheld snippets from
  // its own prompt, then critique re-read the same receipts straight from the
  // DB and pasted 1.2k characters of source per receipt into a provider call.
  const withSnippets = ctx.privacyMode === 'full_ai';
  const sections: string[] = [];
  for (const record of batch) {
    const receipts = record.receipt_ids.map((id) => receiptById.get(id)).filter((r): r is ReceiptRow => r !== undefined);
    const receiptLines = receipts.map((r) => {
      const evidence = withSnippets && r.snippet
        ? `\n    ${r.snippet.slice(0, RECEIPT_SNIPPET_CAP).replace(/\n/g, '\n    ')}`
        : '\n    (code snippet withheld by privacy settings — judge from the file/symbol identity above)';
      return `  - [${r.id}] ${r.receipt_kind} (${r.trust_level}) ${r.file_path ?? r.node_stable_key ?? ''}${evidence}`;
    });
    const claims = (record.record.claims ?? []).map((c) => `  - "${c.claim}" cites [${c.receiptIds.join(', ') || 'nothing'}]`);
    sections.push([
      `### Record ${record.stable_key} (${record.record_level})`,
      `Summary: ${record.summary.slice(0, 300)}`,
      `Claims:\n${claims.join('\n') || '  (no claims listed)'}`,
      `Receipts:\n${receiptLines.join('\n') || '  (none)'}`,
    ].join('\n'));
  }

  const response = await ctx.ai.call<{ verdicts: Verdict[] }>({
    // Claim-vs-receipt verification is a constrained judgment task the cheap
    // tier handles; critique reviews EVERY pending record, so tier matters.
    tier: 'cheap',
    targetType: 'critique',
    promptVersion: PROMPT_VERSIONS.critique,
    schemaName: 'critique_verdicts',
    schema: CRITIQUE_SCHEMA,
    // Static reviewer contract lives in the system prefix (prompt cache).
    system: [
      'You are reviewing generated documentation records against their evidence receipts. For EACH record: verdict "usable" when its substantive claims are supported by the receipts, "rejected" when claims contradict the receipts or assert specifics with no receipt support. List failed claims verbatim. Vague-but-harmless wording is not grounds for rejection; fabricated specifics are.',
      OUTPUT_RULES,
    ].join('\n\n'),
    user: sections.join('\n\n'),
    // 4k floor: deepseek's reasoning tokens count against max_tokens; a
    // tight cap made it burn the whole budget reasoning and return EMPTY
    // content (observed live — 'provider returned an empty completion').
    maxOutputTokens: 4_000 + 300 * batch.length,
  });
  return new Map((response.value?.verdicts ?? []).map((v) => [v.stable_key, v]));
}
