import { expect } from 'chai';
import { resolveIdleBlockSeconds } from '../queue.js';

/**
 * BullMQ's `drainDelay` is in SECONDS; both workers used to pass ms-sized
 * values, blocking idle for hours and disabling BullMQ's dead-socket guard.
 * These cases pin the replacement knob: its default, its floor (a ms-sized
 * value here would hot-poll the shared pay-per-command Redis), and that the
 * retired name is ignored loudly rather than reinterpreted.
 */
describe('resolveIdleBlockSeconds (BullMQ drainDelay, seconds)', () => {
  const warnings: string[] = [];
  const warn = (msg: string) => { warnings.push(msg); };
  beforeEach(() => { warnings.length = 0; });

  it('defaults to 300s with no warning', () => {
    expect(resolveIdleBlockSeconds({}, warn)).to.equal(300);
    expect(warnings).to.deep.equal([]);
  });

  it('honours an explicit value', () => {
    expect(resolveIdleBlockSeconds({ WORKER_IDLE_BLOCK_SECONDS: '120' }, warn)).to.equal(120);
  });

  it('floors at 30s', () => {
    expect(resolveIdleBlockSeconds({ WORKER_IDLE_BLOCK_SECONDS: '5' }, warn)).to.equal(30);
  });

  it('falls back to the default on a non-integer', () => {
    expect(resolveIdleBlockSeconds({ WORKER_IDLE_BLOCK_SECONDS: '2.5' }, warn)).to.equal(300);
  });

  it('ignores the retired WORKER_POLL_INTERVAL_MS, warning once and naming the replacement', () => {
    const got = resolveIdleBlockSeconds({ WORKER_POLL_INTERVAL_MS: '30000' }, warn);
    expect(got).to.equal(300);
    expect(warnings).to.have.length(1);
    expect(warnings[0]).to.include('WORKER_IDLE_BLOCK_SECONDS');
  });
});
