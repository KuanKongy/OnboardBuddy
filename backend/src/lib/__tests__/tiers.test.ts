import { expect } from 'chai';
import { resolveTier, tierLimits, cadPerUsd, freeMonthlyCredits, abuseThresholds } from '../tiers.js';

describe('tiers', () => {
  describe('resolveTier', () => {
    it('DEV_TIER_EMAILS wins over any stored tier, case-insensitively', () => {
      const env = { DEV_TIER_EMAILS: 'dev@x.com, Team@x.com' } as NodeJS.ProcessEnv;
      expect(resolveTier('dev@x.com', 'free', env)).to.equal('dev');
      expect(resolveTier('TEAM@X.COM', 'pro', env)).to.equal('dev');
    });

    it('falls back to the persisted tier, then to free', () => {
      expect(resolveTier('a@b.com', 'pro', {} as NodeJS.ProcessEnv)).to.equal('pro');
      expect(resolveTier('a@b.com', 'max', {} as NodeJS.ProcessEnv)).to.equal('max');
      expect(resolveTier('a@b.com', 'garbage', {} as NodeJS.ProcessEnv)).to.equal('free');
      expect(resolveTier(null, null, {} as NodeJS.ProcessEnv)).to.equal('free');
    });
  });

  describe('tierLimits (monthly budget + rolling rate cap)', () => {
    it('matches the documented per-tier limits', () => {
      expect(tierLimits('free', {} as NodeJS.ProcessEnv)).to.deep.equal({ monthlyCredits: 5, rateCredits: 1, rateWindowHours: 120, maxConcurrent: 1 });
      expect(tierLimits('pro', {} as NodeJS.ProcessEnv)).to.deep.equal({ monthlyCredits: 30, rateCredits: 2, rateWindowHours: 24, maxConcurrent: 1 });
      expect(tierLimits('max', {} as NodeJS.ProcessEnv)).to.deep.equal({ monthlyCredits: 100, rateCredits: 5, rateWindowHours: 12, maxConcurrent: 1 });
      expect(tierLimits('blocked', {} as NodeJS.ProcessEnv)).to.deep.equal({ monthlyCredits: 0, rateCredits: 0, rateWindowHours: 24, maxConcurrent: 0 });
      const dev = tierLimits('dev', {} as NodeJS.ProcessEnv);
      expect(dev.monthlyCredits).to.equal(Infinity);
      expect(dev.rateCredits).to.equal(Infinity);
      expect(dev.maxConcurrent).to.equal(Infinity);
    });

    it('free monthly budget is overridable via FREE_MONTHLY_CREDITS', () => {
      expect(freeMonthlyCredits({ FREE_MONTHLY_CREDITS: '8' } as NodeJS.ProcessEnv)).to.equal(8);
      expect(freeMonthlyCredits({} as NodeJS.ProcessEnv)).to.equal(5);
      expect(tierLimits('free', { FREE_MONTHLY_CREDITS: '10' } as NodeJS.ProcessEnv).monthlyCredits).to.equal(10);
    });

    it('CAD_PER_USD converts USD cost into credits (CA$), default 1.38', () => {
      expect(cadPerUsd({} as NodeJS.ProcessEnv)).to.equal(1.38);
      expect(cadPerUsd({ CAD_PER_USD: '1' } as NodeJS.ProcessEnv)).to.equal(1);
      expect(cadPerUsd({ CAD_PER_USD: 'garbage' } as NodeJS.ProcessEnv)).to.equal(1.38);
    });
  });

  // A typo in one of these must not silently loosen the detector to 0, which
  // would flag every device that presented one account.
  describe('abuseThresholds', () => {
    it('defaults to 3 accounts / 7 days / 2x budget / 30-day window', () => {
      expect(abuseThresholds({} as NodeJS.ProcessEnv)).to.deep.equal({
        minAccounts: 3, creationSpanDays: 7, spendMultiplier: 2, windowDays: 30,
      });
    });

    it('each threshold is env-overridable, and junk falls back to the default', () => {
      const env = { ABUSE_MIN_ACCOUNTS: '5', ABUSE_CREATION_SPAN_DAYS: '3', ABUSE_SPEND_MULTIPLIER: '1.5', ABUSE_WINDOW_DAYS: '90' } as NodeJS.ProcessEnv;
      expect(abuseThresholds(env)).to.deep.equal({
        minAccounts: 5, creationSpanDays: 3, spendMultiplier: 1.5, windowDays: 90,
      });
      expect(abuseThresholds({ ABUSE_MIN_ACCOUNTS: '0', ABUSE_SPEND_MULTIPLIER: 'x' } as NodeJS.ProcessEnv))
        .to.deep.include({ minAccounts: 3, spendMultiplier: 2 });
    });
  });
});
