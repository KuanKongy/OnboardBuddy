import { expect } from 'chai';
import { maybeSendAnalysisAlert, __resetAlertThrottle, type AlertContext } from '../analysisAlert.js';
import type { EmailMessage } from '../../../lib/mailer.js';
import type { CreditStatus } from '../creditGate.js';

function status(tier: CreditStatus['tier']): CreditStatus {
  const dev = tier === 'dev';
  return {
    tier,
    monthlyCredits: dev ? null : 5,
    monthlyUsed: 1.2,
    monthlyRemaining: dev ? null : 3.8,
    monthResetAt: '2026-10-01T00:00:00.000Z',
    rateCredits: dev ? null : 1,
    rateWindowHours: dev ? null : 120,
    rateUsed: 0.2,
    rateResetAt: null,
    inFlight: 0,
    allowed: true,
    reason: 'ok',
  };
}

function ctx(tier: CreditStatus['tier']): AlertContext {
  return { userId: 'u1', email: 'user@x.com', projectName: 'owner/repo', status: status(tier) };
}

describe('analysisAlert.maybeSendAnalysisAlert', () => {
  beforeEach(() => __resetAlertThrottle());

  it('sends once for a non-dev user, then throttles within the window', async () => {
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => { sent.push(m); return true; };
    const env = { ALERT_EMAIL_TO: 'owner@x.com', ALERT_THROTTLE_MINUTES: '60' } as NodeJS.ProcessEnv;

    const first = await maybeSendAnalysisAlert(ctx('free'), { env, send, now: () => 0 });
    const second = await maybeSendAnalysisAlert(ctx('free'), { env, send, now: () => 60_000 }); // +1 min
    expect(first).to.equal('sent');
    expect(second).to.equal('skipped_throttled');
    expect(sent).to.have.length(1);
    expect(sent[0]!.to).to.equal('owner@x.com');
    expect(sent[0]!.subject).to.contain('user@x.com');
  });

  it('sends again once the throttle window has passed', async () => {
    const send = async () => true;
    const env = { ALERT_EMAIL_TO: 'owner@x.com', ALERT_THROTTLE_MINUTES: '60' } as NodeJS.ProcessEnv;
    expect(await maybeSendAnalysisAlert(ctx('free'), { env, send, now: () => 0 })).to.equal('sent');
    expect(await maybeSendAnalysisAlert(ctx('free'), { env, send, now: () => 61 * 60_000 })).to.equal('sent');
  });

  it('never alerts for the dev tier', async () => {
    let called = 0;
    const send = async () => { called += 1; return true; };
    const env = { ALERT_EMAIL_TO: 'owner@x.com' } as NodeJS.ProcessEnv;
    expect(await maybeSendAnalysisAlert(ctx('dev'), { env, send })).to.equal('skipped_dev');
    expect(called).to.equal(0);
  });

  it('is a no-op when no recipient is configured', async () => {
    let called = 0;
    const send = async () => { called += 1; return true; };
    expect(await maybeSendAnalysisAlert(ctx('free'), { env: {} as NodeJS.ProcessEnv, send })).to.equal('skipped_no_recipient');
    expect(called).to.equal(0);
  });
});
