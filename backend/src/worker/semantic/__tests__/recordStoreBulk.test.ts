import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import {
  attachReceiptsBulk,
  insertRecordsBulk,
  lookupRecords,
  mapToSnapshotBulk,
  type InsertRecordInput,
  type StoredRecord,
} from '../recordStore.js';

interface QueryLogEntry { text: string; params?: unknown[] }

function record(id: string, stableKey: string, claims: Array<{ claim: string; receiptIds: string[] }> = []): StoredRecord {
  return {
    id, stableKey, recordLevel: 'symbol', semanticDepth: 'standard',
    evidenceHash: `eh-${stableKey}`, promptVersion: 'symbol-record-v2',
    record: { claims } as StoredRecord['record'],
    summary: 's', confidence: 'high', factsOnly: false, status: 'pending', receiptIds: [],
  };
}

const BASE = {
  projectId: 'proj-1', level: 'symbol' as const, promptVersion: 'symbol-record-v2',
  depth: 'standard' as const, modelFamily: 'deepseek/deepseek-v4-flash',
};

describe('recordStore bulk primitives (latency overhaul Track C)', () => {
  afterEach(() => __setQueryForTests(null));

  it('lookupRecords: one statement, paired unnest arrays, depth-layered ordering', async () => {
    const log: QueryLogEntry[] = [];
    __setQueryForTests(async (text, params) => {
      log.push({ text, params });
      return {
        rows: [{
          id: 'r-1', stable_key: 'a.ts#fn', record_level: 'symbol', semantic_depth: 'full',
          evidence_hash: 'eh-a.ts#fn', prompt_version: 'symbol-record-v2', record: { claims: [] },
          summary: 'sum', confidence: 'high', facts_only: false, status: 'usable', receipt_ids: ['x'],
        }],
      } as never;
    });

    const found = await lookupRecords(BASE, [
      { stableKey: 'a.ts#fn', evidenceHash: 'eh-a.ts#fn' },
      { stableKey: 'b.ts#g', evidenceHash: 'eh-b.ts#g' },
    ]);

    expect(log).to.have.length(1);
    expect(log[0]!.text).to.include('unnest($2::text[], $3::text[])');
    expect(log[0]!.text).to.include('array_position($7, sr.semantic_depth)');
    expect(log[0]!.params?.[1]).to.deep.equal(['a.ts#fn', 'b.ts#g']);
    expect(log[0]!.params?.[2]).to.deep.equal(['eh-a.ts#fn', 'eh-b.ts#g']);
    // standard depth accepts full-then-standard, mirroring lookupRecord.
    expect(log[0]!.params?.[6]).to.deep.equal(['full', 'standard']);
    expect(found.get('a.ts#fn')?.semanticDepth).to.equal('full');
    expect(found.has('b.ts#g')).to.equal(false);
  });

  it('insertRecordsBulk: vectorized supersede + one multi-VALUES upsert, ids mapped back', async () => {
    const log: QueryLogEntry[] = [];
    __setQueryForTests(async (text, params) => {
      log.push({ text, params });
      if (text.includes('INSERT INTO semantic_records')) {
        return { rows: [{ id: 'id-b', stable_key: 'b.ts#g' }, { id: 'id-a', stable_key: 'a.ts#fn' }] } as never;
      }
      return { rows: [] } as never;
    });

    const input = (stableKey: string): InsertRecordInput => ({
      key: { ...BASE, stableKey, evidenceHash: `eh-${stableKey}` },
      record: { claims: [] } as InsertRecordInput['record'],
      summary: 'sum', confidence: 'high', factsOnly: false, status: 'pending',
    });
    const out = await insertRecordsBulk([input('a.ts#fn'), input('b.ts#g')]);

    expect(log).to.have.length(2);
    expect(log[0]!.text).to.include("SET status = 'superseded'");
    expect(log[0]!.text).to.include('unnest($4::text[], $5::text[])');
    expect(log[1]!.text).to.include('ON CONFLICT (project_id, stable_key, evidence_hash, prompt_version, semantic_depth, model_family)');
    // RETURNING rows arrive in arbitrary order — mapping is by stable_key.
    expect(out.get('a.ts#fn')?.id).to.equal('id-a');
    expect(out.get('b.ts#g')?.id).to.equal('id-b');
  });

  it('insertRecordsBulk rejects mixed base keys', async () => {
    __setQueryForTests(async () => ({ rows: [] }) as never);
    const a: InsertRecordInput = {
      key: { ...BASE, stableKey: 'a', evidenceHash: 'e1' },
      record: { claims: [] } as InsertRecordInput['record'],
      summary: '', confidence: 'high', factsOnly: false, status: 'pending',
    };
    const b: InsertRecordInput = { ...a, key: { ...a.key, promptVersion: 'other-v1', stableKey: 'b' } };
    try {
      await insertRecordsBulk([a, b]);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).to.include('shared base key');
    }
  });

  it('attachReceiptsBulk: one receipts INSERT + one vectorized claims stamp, aliases rewritten like attachReceipts', async () => {
    const log: QueryLogEntry[] = [];
    __setQueryForTests(async (text, _params) => {
      log.push({ text, params: _params });
      if (text.includes('INSERT INTO source_receipts')) {
        return {
          rows: [
            { id: '11111111-1111-1111-1111-111111111111', record_id: 'rec-1' },
            { id: '22222222-2222-2222-2222-222222222222', record_id: 'rec-1' },
            { id: '33333333-3333-3333-3333-333333333333', record_id: 'rec-2' },
          ],
        } as never;
      }
      return { rows: [] } as never;
    });

    const r1 = record('rec-1', 'a.ts#fn', [
      { claim: 'cited', receiptIds: ['r1', 'r2'] },
      { claim: 'hallucinated alias dropped', receiptIds: ['r9'] },
    ]);
    const r2 = record('rec-2', 'b.ts#g', [{ claim: 'other', receiptIds: ['r1'] }]);

    await attachReceiptsBulk({
      projectId: 'proj-1', snapshotId: 'snap-1', commitHash: 'c1',
      items: [
        { record: r1, drafts: [
          { alias: 'r1', kind: 'code_snippet', trustLevel: 'code' },
          { alias: 'r2', kind: 'code_snippet', trustLevel: 'code' },
        ]},
        { record: r2, drafts: [{ alias: 'r1', kind: 'code_snippet', trustLevel: 'code' }] },
      ],
    });

    expect(log).to.have.length(2);
    expect(log[1]!.text).to.include('jsonb_to_recordset');
    expect(r1.receiptIds).to.deep.equal([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    expect(r1.record.claims![0]!.receiptIds).to.deep.equal([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    // Unknown alias r9 dropped, not kept as junk — same rule as attachReceipts.
    expect(r1.record.claims![1]!.receiptIds).to.deep.equal([]);
    // Per-record alias scoping: r2's "r1" maps to ITS receipt, not rec-1's.
    expect(r2.record.claims![0]!.receiptIds).to.deep.equal(['33333333-3333-3333-3333-333333333333']);
  });

  it('mapToSnapshotBulk: vectorized DELETE then one multi-VALUES INSERT', async () => {
    const log: QueryLogEntry[] = [];
    __setQueryForTests(async (text, params) => {
      log.push({ text, params });
      return { rows: [] } as never;
    });

    await mapToSnapshotBulk('snap-1', [
      { record: record('rec-1', 'a.ts#fn'), nodeId: 'n-1' },
      { record: record('rec-2', 'b.ts#g'), nodeId: null },
    ]);

    expect(log).to.have.length(2);
    expect(log[0]!.text).to.include('DELETE FROM snapshot_semantic_records');
    expect(log[0]!.text).to.include('unnest($2::text[], $3::text[])');
    expect(log[0]!.params?.[1]).to.deep.equal(['a.ts#fn', 'b.ts#g']);
    expect(log[1]!.text).to.include('INSERT INTO snapshot_semantic_records');
    expect(log[1]!.text).to.include('ON CONFLICT (snapshot_id, record_id) DO NOTHING');
    expect(log[1]!.params).to.deep.equal(['snap-1', 'rec-1', 'n-1', 'a.ts#fn', 'symbol', 'snap-1', 'rec-2', null, 'b.ts#g', 'symbol']);
  });
});

/**
 * Bug #76: two of nine live analyses died at 98% on SQLSTATE 57014
 * ("canceling statement due to statement timeout") in the bulk writes, and
 * both succeeded on a plain re-run — the transaction-mode pooler cut the
 * statement under load, nothing was wrong with the write.
 */
describe('recordStore — statement-timeout retry (bug #76)', () => {
  afterEach(() => __setQueryForTests(null));

  function timeoutError(): Error & { code: string } {
    return Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  }

  it('retries once on 57014 and succeeds, and never retries any other error', async () => {
    let attempts = 0;
    __setQueryForTests(async (text) => {
      if (!text.includes('INSERT INTO snapshot_semantic_records')) return { rows: [] } as never;
      attempts += 1;
      if (attempts === 1) throw timeoutError();
      return { rows: [] } as never;
    });

    // The write that timed out goes through on the second attempt, so the run
    // survives instead of failing the whole analysis at 98%.
    await mapToSnapshotBulk('snap-1', [{ record: record('rec-1', 'a.ts#fn'), nodeId: 'n-1' }]);
    expect(attempts).to.equal(2);

    // Bounded at two attempts: a pooler that stays busy fails honestly rather
    // than looping.
    let persistent = 0;
    __setQueryForTests(async (text) => {
      if (!text.includes('INSERT INTO snapshot_semantic_records')) return { rows: [] } as never;
      persistent += 1;
      throw timeoutError();
    });
    try {
      await mapToSnapshotBulk('snap-1', [{ record: record('rec-1', 'a.ts#fn'), nodeId: 'n-1' }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).to.equal('57014');
    }
    expect(persistent).to.equal(2);

    // Never a blanket retry: a constraint violation must surface on the first
    // attempt, not be doubled and hidden behind extra latency.
    let other = 0;
    __setQueryForTests(async (text) => {
      if (!text.includes('INSERT INTO snapshot_semantic_records')) return { rows: [] } as never;
      other += 1;
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    });
    try {
      await mapToSnapshotBulk('snap-1', [{ record: record('rec-1', 'a.ts#fn'), nodeId: 'n-1' }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).to.equal('23505');
    }
    expect(other).to.equal(1);
  });
});
