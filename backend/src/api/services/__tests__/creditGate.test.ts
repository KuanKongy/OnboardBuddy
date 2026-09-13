import { expect } from 'chai';
import {
  checkCredit,
  creditRejection,
  startOfUtcMonth,
  startOfNextUtcMonth,
  type QueryFn,
} from '../creditGate.js';

const NOW = new Date('2026-09-04T15:00:00Z');

/**
 * Fake db keyed by SQL + params. Both spend queries share one SQL string and
 * differ only by $2 (the window start), so route them by comparing $2 to the
 * month start for this fixed `now`.
 */
function fakeDb(world: {
  dbTier?: string | null;
  monthUsd?: number;
  rateUsd?: number;
  inFlight?: number;
  oldest?: string | null;
}): QueryFn {
  const monthStart = startOfUtcMonth(NOW);
  return async (text: string, params?: unknown[]) => {
    if (text.includes('FROM users')) return { rows: world.dbTier === undefined ? [] : [{ tier: world.dbTier }] };
    if (text.includes('SUM(agr.estimated_cost_usd)')) {
      const isMonth = params?.[1] === monthStart;
      return { rows: [{ usd: isMonth ? world.monthUsd ?? 0 : world.rateUsd ?? 0, oldest: world.oldest ?? null }] };
    }
    if (text.includes('COUNT(*)')) return { rows: [{ n: world.inFlight ?? 0 }] };
    throw new Error(`unexpected query: ${text}`);
  };
}

describe('creditGate.checkCredit (monthly budget + rolling rate cap)', () => {
  let savedCad: string | undefined;
  let savedDev: string | undefined;
  beforeEach(() => {
    savedCad = process.env.CAD_PER_USD;
    savedDev = process.env.DEV_TIER_EMAILS;
    process.env.CAD_PER_USD = '1'; // 1 credit = $1 for clean assertions
    process.env.DEV_TIER_EMAILS = '';
  });
  afterEach(() => {
    if (savedCad === undefined) delete process.env.CAD_PER_USD; else process.env.CAD_PER_USD = savedCad;
    if (savedDev === undefined) delete process.env.DEV_TIER_EMAILS; else process.env.DEV_TIER_EMAILS = savedDev;
  });

  it('computes UTC month boundaries', () => {
    expect(startOfUtcMonth(NOW)).to.equal('2026-09-01T00:00:00.000Z');
    expect(startOfNextUtcMonth(NOW)).to.equal('2026-10-01T00:00:00.000Z');
  });

  it('dev is unlimited', async () => {
    const s = await checkCredit('u1', 'x@y.com', fakeDb({ dbTier: 'dev' }), NOW);
    expect(s.tier).to.equal('dev');
    expect(s.allowed).to.equal(true);
    expect(s.monthlyCredits).to.equal(null);
    expect(s.rateCredits).to.equal(null);
  });

  it('free under both caps is allowed with remaining reported', async () => {
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, monthUsd: 2, rateUsd: 0.2, inFlight: 0 }), NOW);
    expect(s.allowed).to.equal(true);
    expect(s.reason).to.equal('ok');
    expect(s.monthlyUsed).to.equal(2);
    expect(s.monthlyRemaining).to.equal(3); // free budget 5
    expect(s.rateUsed).to.equal(0.2);
  });

  it('blocks when the monthly budget is spent', async () => {
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, monthUsd: 5, rateUsd: 0, inFlight: 0 }), NOW);
    expect(s.allowed).to.equal(false);
    expect(s.reason).to.equal('monthly_exhausted');
    expect(s.monthlyRemaining).to.equal(0);
  });

  it('rate-limits within the window and reports when it frees', async () => {
    const oldest = new Date(NOW.getTime() - 100 * 3_600_000).toISOString(); // 100h ago, window 120h
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, monthUsd: 0.5, rateUsd: 1, inFlight: 0, oldest }), NOW);
    expect(s.allowed).to.equal(false);
    expect(s.reason).to.equal('rate_limited');
    expect(s.rateResetAt).to.equal(new Date(new Date(oldest).getTime() + 120 * 3_600_000).toISOString());
  });

  it('serializes: an in-flight analysis blocks a second start', async () => {
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, monthUsd: 0.1, rateUsd: 0.1, inFlight: 1 }), NOW);
    expect(s.allowed).to.equal(false);
    expect(s.reason).to.equal('analysis_in_progress');
  });

  it('a blocked account cannot start anything', async () => {
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: 'blocked' }), NOW);
    expect(s.allowed).to.equal(false);
    expect(s.reason).to.equal('blocked');
  });

  it('creditRejection maps blocked to 403 and quota/rate to 429 with the code', () => {
    const base = { tier: 'free' as const, monthlyCredits: 5, monthlyUsed: 5, monthlyRemaining: 0, monthResetAt: 'M', rateCredits: 1, rateWindowHours: 120, rateUsed: 0, rateResetAt: null, inFlight: 0, allowed: false };
    expect(creditRejection({ ...base, reason: 'monthly_exhausted' }).http).to.equal(429);
    expect(creditRejection({ ...base, reason: 'rate_limited' }).http).to.equal(429);
    expect(creditRejection({ ...base, reason: 'analysis_in_progress' }).http).to.equal(429);
    const blocked = creditRejection({ ...base, reason: 'blocked' });
    expect(blocked.http).to.equal(403);
    expect(blocked.body.code).to.equal('blocked');
  });
});
