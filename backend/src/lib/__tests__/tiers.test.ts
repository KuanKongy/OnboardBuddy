import { expect } from 'chai';
import { resolveTier, tierLimits, cadPerUsd, freeMonthlyCredits } from '../tiers.js';

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
});
