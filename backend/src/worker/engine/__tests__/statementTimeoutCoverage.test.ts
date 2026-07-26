import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import { persistCandidateRankings, type CandidateRanking } from '../candidateRanker.js';

/**
 * The 57014 guard used to cover only the semantic record/embedding writes. The
 * 2026-07-26 six-way-concurrency run showed the same cancellation reaching the
 * analysis-side bulk writes, so those are wrapped too (doc: lib/pgRetry.ts).
 * This pins the behaviour at one of the newly covered sites.
 */
describe('statement-timeout retry — analysis-side coverage', () => {
  afterEach(() => __setQueryForTests(null));

  it('persistCandidateRankings retries its upsert once on 57014', async () => {
    let attempts = 0;
    __setQueryForTests(async (text) => {
      if (!text.includes('INSERT INTO criticality_scores')) return { rows: [] } as never;
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
      }
      return { rows: [] } as never;
    });

    const ranking = {
      targetType: 'symbol', stableKey: 'a.ts#fn', score: 0.5,
      breakdown: {}, inapplicableSignals: [], raw: {}, reasons: ['r'],
    } as unknown as CandidateRanking;

    await persistCandidateRankings('snap-1', [ranking], new Map([['a.ts#fn', 'node-1']]), new Map());

    // Two attempts, not one: the cancelled upsert went through on the retry
    // instead of failing the analysis outright.
    expect(attempts).to.equal(2);
  });
});
