import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import { isCarryForwardEligible } from '../symbolPass.js';
import { capturePriorSymbolRecords, type PriorSymbolRecord } from '../recordStore.js';

function prior(overrides: Partial<PriorSymbolRecord> = {}): PriorSymbolRecord {
  return {
    id: 'rec-1', stableKey: 'a.ts#fn', recordLevel: 'symbol', semanticDepth: 'standard',
    evidenceHash: 'eh-1', promptVersion: 'symbol-record-v2',
    record: { claims: [] } as PriorSymbolRecord['record'],
    summary: 's', confidence: 'high', factsOnly: false, status: 'usable',
    receiptIds: [], modelFamily: 'deepseek/deepseek-v4-flash',
    ...overrides,
  };
}

const EXPECTED = {
  evidenceHash: 'eh-1',
  promptVersion: 'symbol-record-v2',
  modelFamily: 'deepseek/deepseek-v4-flash',
  depth: 'standard' as const,
};

describe('Track E — carry-forward gate', () => {
  it('eligible exactly when a fresh lookup would have been a cache hit', () => {
    expect(isCarryForwardEligible(prior(), EXPECTED)).to.equal(true);
    // A higher-depth prior satisfies a lower-depth run (depth layering).
    expect(isCarryForwardEligible(prior({ semanticDepth: 'full' }), EXPECTED)).to.equal(true);
    // Rejected records carry forward — an honest unknown stays an unknown
    // instead of being re-paid every rescan (same rule as lookupRecord).
    expect(isCarryForwardEligible(prior({ status: 'rejected' }), EXPECTED)).to.equal(true);
  });

  it('any identity mismatch forces the normal path', () => {
    expect(isCarryForwardEligible(undefined, EXPECTED)).to.equal(false);
    expect(isCarryForwardEligible(prior({ evidenceHash: 'eh-CHANGED' }), EXPECTED)).to.equal(false);
    expect(isCarryForwardEligible(prior({ promptVersion: 'symbol-record-v1' }), EXPECTED)).to.equal(false);
    // Model swap auto-forces re-keying: family is part of the identity.
    expect(isCarryForwardEligible(prior({ modelFamily: 'openai/gpt-4o-mini' }), EXPECTED)).to.equal(false);
    // A lower-depth prior never satisfies a higher-depth run.
    expect(isCarryForwardEligible(prior({ semanticDepth: 'cheap' }), EXPECTED)).to.equal(false);
    expect(isCarryForwardEligible(prior({ status: 'superseded' }), EXPECTED)).to.equal(false);
  });
});

describe('Track E — capturePriorSymbolRecords', () => {
  afterEach(() => __setQueryForTests(null));

  it('prefers the snapshot\'s own mappings and falls back to the previous snapshot', async () => {
    const asked: string[] = [];
    __setQueryForTests(async (_text, params) => {
      const snap = params?.[0] as string;
      asked.push(snap);
      if (snap === 'snap-own-empty') return { rows: [] } as never;
      return {
        rows: [{
          stable_key: 'a.ts#fn', id: 'rec-1', record_level: 'symbol', semantic_depth: 'standard',
          evidence_hash: 'eh-1', prompt_version: 'symbol-record-v2', model_family: 'deepseek/deepseek-v4-flash',
          record: { claims: [] }, summary: 's', confidence: 'high', facts_only: false,
          status: 'usable', receipt_ids: [],
        }],
      } as never;
    });

    // Own snapshot has rows -> previous never queried.
    const own = await capturePriorSymbolRecords('snap-own', 'snap-prev');
    expect(own.get('a.ts#fn')?.modelFamily).to.equal('deepseek/deepseek-v4-flash');
    expect(asked).to.deep.equal(['snap-own']);

    // Own snapshot empty -> previous is the source.
    asked.length = 0;
    const fromPrev = await capturePriorSymbolRecords('snap-own-empty', 'snap-prev');
    expect(fromPrev.size).to.equal(1);
    expect(asked).to.deep.equal(['snap-own-empty', 'snap-prev']);
  });
});
