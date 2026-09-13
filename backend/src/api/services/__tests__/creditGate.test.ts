import { expect } from 'chai';
import {
  checkCredit,
  creditRejection,
  maxAccountsCreatedWithin,
  startOfUtcMonth,
  startOfNextUtcMonth,
  type QueryFn,
} from '../creditGate.js';
import { __resetAbuseAlerts } from '../signals.js';

const NOW = new Date('2026-09-04T15:00:00Z');

/**
 * Fake db keyed by SQL + params. Both spend queries share one SQL string and
 * differ only by $2 (the window start), so route them by comparing $2 to the
 * month start for this fixed `now`.
 */
interface World {
  dbTier?: string | null;
  monthUsd?: number;
  rateUsd?: number;
  inFlight?: number;
  oldest?: string | null;
  /** Accounts the device query returns (already filtered by the window in SQL). */
  deviceAccounts?: Array<{ id: string; created_at: string }>;
  /** Combined month spend (USD) of those accounts. */
  deviceUsd?: number;
}

function fakeDb(world: World, seen: string[] = []): QueryFn {
  const monthStart = startOfUtcMonth(NOW);
  return async (text: string, params?: unknown[]) => {
    seen.push(text);
    // Order matters: the device-accounts query joins `users` and the combined
    // spend query shares the SPEND_SINCE aggregate, so the narrower matches
    // have to come first.
    if (text.includes('FROM user_signals')) return { rows: world.deviceAccounts ?? [] };
    if (text.includes('ANY($1::uuid[])')) return { rows: [{ usd: world.deviceUsd ?? 0 }] };
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

  // Nothing frees up by waiting for either of these, so they must not look like
  // a quota the client should retry on a schedule.
  it('creditRejection maps abuse_detected and client_required to 403 with their codes', () => {
    const base = { tier: 'free' as const, monthlyCredits: 5, monthlyUsed: 0, monthlyRemaining: 5, monthResetAt: 'M', rateCredits: 1, rateWindowHours: 120, rateUsed: 0, rateResetAt: null, inFlight: 0, allowed: false };
    const abuse = creditRejection({ ...base, reason: 'abuse_detected' });
    expect(abuse.http).to.equal(403);
    expect(abuse.body.code).to.equal('abuse_detected');
    expect(String(abuse.body.error)).to.match(/contact/i);
    const client = creditRejection({ ...base, reason: 'client_required' });
    expect(client.http).to.equal(403);
    expect(client.body.code).to.equal('client_required');
    expect(String(client.body.error)).to.match(/reload/i);
  });
});

/**
 * The multi-account detector. Limits stay per-account everywhere; this only
 * refuses free-tier spend when one device shows several freshly created
 * accounts whose COMBINED month spend has already passed a multiple of one free
 * budget. Each condition alone is an honest shape, so each "not flagged" case
 * below is a false positive this code is required not to produce.
 */
describe('creditGate multi-account abuse detector', () => {
  const DEVICE = { deviceHash: 'dh-abc' };
  const saved: Record<string, string | undefined> = {};
  const KEYS = ['CAD_PER_USD', 'DEV_TIER_EMAILS', 'ALERT_EMAIL_TO', 'ABUSE_MIN_ACCOUNTS', 'ABUSE_CREATION_SPAN_DAYS', 'ABUSE_SPEND_MULTIPLIER', 'ABUSE_WINDOW_DAYS'];

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.CAD_PER_USD = '1';
    process.env.DEV_TIER_EMAILS = '';
    // No recipient = the first-flag alert is a no-op, so these cases never try
    // to send mail.
    delete process.env.ALERT_EMAIL_TO;
    for (const k of KEYS.filter((k) => k.startsWith('ABUSE_'))) delete process.env[k];
    __resetAbuseAlerts();
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  /** `daysBeforeNow` days before NOW, as the DB would return created_at. */
  function created(daysBeforeNow: number): string {
    return new Date(NOW.getTime() - daysBeforeNow * 86_400_000).toISOString();
  }

  function accounts(...days: number[]): Array<{ id: string; created_at: string }> {
    return days.map((d, i) => ({ id: `u${i + 1}`, created_at: created(d) }));
  }

  it('counts the largest cluster of creation dates inside the span', () => {
    expect(maxAccountsCreatedWithin([], 7)).to.equal(0);
    const dates = [0, 1, 2, 200, 400].map((d) => new Date(NOW.getTime() - d * 86_400_000));
    expect(maxAccountsCreatedWithin(dates, 7)).to.equal(3);
    expect(maxAccountsCreatedWithin(dates, 400)).to.equal(5);
  });

  it('a shared laptop with two accounts is not flagged, however much they spent', async () => {
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, deviceAccounts: accounts(1, 2), deviceUsd: 99 }), NOW, DEVICE);
    expect(s.allowed).to.equal(true);
    expect(s.reason).to.equal('ok');
  });

  it('many accounts created far apart (a genuinely shared machine) are not flagged', async () => {
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, deviceAccounts: accounts(1, 120, 300, 600), deviceUsd: 99 }), NOW, DEVICE);
    expect(s.allowed).to.equal(true);
  });

  it('many accounts created together but barely spending (a workshop) are not flagged', async () => {
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, deviceAccounts: accounts(0, 1, 2, 3), deviceUsd: 1.5 }), NOW, DEVICE);
    expect(s.allowed).to.equal(true);
  });

  it('flags only when all three conditions trip at once', async () => {
    // 4 accounts, all born inside 7 days, CA$10 combined = 2 x the free budget.
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, deviceAccounts: accounts(0, 1, 2, 5), deviceUsd: 10 }), NOW, DEVICE);
    expect(s.allowed).to.equal(false);
    expect(s.reason).to.equal('abuse_detected');
    // The caller's OWN budget is untouched by the flag: it is still reported as
    // available, so nothing here is a per-device limit.
    expect(s.monthlyRemaining).to.equal(5);
  });

  it('stops at the first query when the device shows too few accounts (no spend query)', async () => {
    const seen: string[] = [];
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, deviceAccounts: accounts(1) }, seen), NOW, DEVICE);
    expect(s.allowed).to.equal(true);
    expect(seen.filter((t) => t.includes('ANY($1::uuid[])'))).to.have.length(0);
  });

  it('a device with no rows in the window (activity aged out) is not flagged', async () => {
    // The window lives in SQL (last_seen >= window start), so an aged-out
    // device returns no rows at all.
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, deviceAccounts: [], deviceUsd: 99 }), NOW, DEVICE);
    expect(s.allowed).to.equal(true);
    expect(s.reason).to.equal('ok');
  });

  it('paid and dev tiers are never touched by a hot device', async () => {
    const hot = { deviceAccounts: accounts(0, 1, 2, 3), deviceUsd: 999 };
    for (const tier of ['pro', 'max']) {
      const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: tier, ...hot }), NOW, DEVICE);
      expect(s.allowed, tier).to.equal(true);
      expect(s.tier, tier).to.equal(tier);
    }
    const dev = await checkCredit('u1', 'dev@x.com', fakeDb({ dbTier: 'dev', ...hot }), NOW, DEVICE);
    expect(dev.allowed).to.equal(true);
  });

  it('without a device header the detector never runs, so /me/credit stays readable', async () => {
    const seen: string[] = [];
    const world = { dbTier: null, deviceAccounts: accounts(0, 1, 2, 3), deviceUsd: 999 };
    const noSignals = await checkCredit('u1', 'a@b.com', fakeDb(world, seen), NOW);
    expect(noSignals.allowed).to.equal(true);
    const nullHash = await checkCredit('u1', 'a@b.com', fakeDb(world, seen), NOW, { deviceHash: null });
    expect(nullHash.allowed).to.equal(true);
    expect(seen.filter((t) => t.includes('FROM user_signals'))).to.have.length(0);
  });

  it('an exhausted budget still reports its own reason, not the device one', async () => {
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, monthUsd: 5, deviceAccounts: accounts(0, 1, 2), deviceUsd: 99 }), NOW, DEVICE);
    expect(s.reason).to.equal('monthly_exhausted');
  });

  it('thresholds are env-overridable (tightened to 2 accounts / 1x budget)', async () => {
    process.env.ABUSE_MIN_ACCOUNTS = '2';
    process.env.ABUSE_SPEND_MULTIPLIER = '1';
    const s = await checkCredit('u1', 'a@b.com', fakeDb({ dbTier: null, deviceAccounts: accounts(0, 1), deviceUsd: 5 }), NOW, DEVICE);
    expect(s.allowed).to.equal(false);
    expect(s.reason).to.equal('abuse_detected');
  });
});
