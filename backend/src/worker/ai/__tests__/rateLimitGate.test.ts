/**
 * The process-global 429 cooldown window.
 *
 * The properties here are the ones a future edit could break without any
 * suite going red on its own: the gate is shared across AiClient instances
 * (one OPENROUTER_API_KEY, WORKER_CONCURRENCY jobs), an open window is only
 * ever extended, a waiter already asleep still notices an extension a sibling
 * caused, and a hedged loser's abort gets out immediately instead of sitting
 * out a minute of someone else's cooldown.
 *
 * Everything runs on the injected clock — no test here waits real seconds.
 */

import { expect } from 'chai';
import {
  rateLimitGate,
  __resetRateLimitGatesForTests,
  __setRateLimitGateHooksForTests,
} from '../rateLimitGate.js';

/**
 * Fake clock. `sleep` records the requested duration and advances `now` by it,
 * so fake time only moves when somebody actually waits. `onSleep` fires at the
 * START of a sleep — the seam for "a sibling 429s while this waiter is parked".
 */
function fakeClock(): { sleeps: number[]; nowMs: () => number; onSleep: (fn: ((ms: number) => void) | null) => void } {
  let now = 0;
  const sleeps: number[] = [];
  let hook: ((ms: number) => void) | null = null;
  __setRateLimitGateHooksForTests({
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      hook?.(ms);
      now += ms;
    },
  });
  return { sleeps, nowMs: () => now, onSleep: (fn) => { hook = fn; } };
}

describe('ai — process-global rate-limit gate', () => {
  const logs: string[] = [];
  const realWarn = console.warn;

  beforeEach(() => {
    logs.length = 0;
    console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  });
  afterEach(() => {
    console.warn = realWarn;
    __setRateLimitGateHooksForTests(null);
    __resetRateLimitGatesForTests();
  });

  it('lets calls through untouched while no window is open', async () => {
    const clock = fakeClock();
    const gate = rateLimitGate('untripped');

    await gate.wait();

    expect(clock.sleeps, 'nothing slept').to.deep.equal([]);
    expect(gate.remainingMs()).to.equal(0);
  });

  it('sleeps out the window, and a waiter already parked picks up an extension', async () => {
    const clock = fakeClock();
    const gate = rateLimitGate('extend');
    gate.trip(10_000, 'HTTP 429 (cheap)');

    // A sibling call 429s while this waiter is asleep and asks for 30s.
    let extended = false;
    clock.onSleep(() => {
      if (extended) return;
      extended = true;
      gate.trip(30_000, 'HTTP 429 (embedding)');
    });

    await gate.wait();

    // 10s of the original window, then the 20s the extension added — not 10s
    // followed by an immediate dispatch into a window that is still shut.
    expect(clock.sleeps).to.deep.equal([10_000, 20_000]);
    expect(clock.nowMs(), 'total fake time waited').to.equal(30_000);
    expect(gate.remainingMs()).to.equal(0);
  });

  it('never shortens an open window', () => {
    fakeClock();
    const gate = rateLimitGate('no-shorten');
    gate.trip(60_000, 'HTTP 429 (strong)');
    // A second 429 answered from inside the window, with a smaller hint.
    gate.trip(5_000, 'HTTP 429 (cheap)');
    expect(gate.remainingMs()).to.equal(60_000);
  });

  it('rejects a waiting call as soon as its signal aborts', async () => {
    // A sleep that never resolves: the abort is the only way out, which is the
    // point — a hedged loser must not sit out the whole window.
    __setRateLimitGateHooksForTests({ now: () => 0, sleep: () => new Promise<void>(() => {}) });
    const gate = rateLimitGate('abortable');
    gate.trip(60_000, 'HTTP 429 (cheap)');

    const controller = new AbortController();
    const waiting = gate.wait(controller.signal);
    controller.abort(new Error('hedge winner already landed'));

    const err = await waiting.then(() => null, (e: unknown) => e);
    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.equal('hedge winner already landed');

    // An already-aborted signal never even reaches the sleep.
    await gate.wait(controller.signal).then(
      () => expect.fail('should have thrown'),
      (e: unknown) => expect((e as Error).message).to.equal('hedge winner already landed'),
    );
  });

  it('is one gate per provider id, and the test reset clears the registry', () => {
    fakeClock();
    expect(rateLimitGate('openrouter'), 'same id = same gate').to.equal(rateLimitGate('openrouter'));
    rateLimitGate('openrouter').trip(60_000, 'HTTP 429 (cheap)');
    expect(rateLimitGate('openrouter').remainingMs()).to.equal(60_000);
    expect(rateLimitGate('other').remainingMs(), 'a different provider is unaffected').to.equal(0);

    __resetRateLimitGatesForTests();
    expect(rateLimitGate('openrouter').remainingMs(), 'reset drops the window').to.equal(0);
  });

  it('logs once per extension, not once per caller', () => {
    fakeClock();
    const gate = rateLimitGate('logging');
    // The fan-out case: every in-flight call sees the same 429 in the same tick.
    for (let i = 0; i < 28; i++) gate.trip(30_000, 'HTTP 429 (embedding)');
    expect(logs, 'one line for 28 concurrent 429s').to.have.length(1);
    expect(logs[0]).to.equal('[ai] rate limited (HTTP 429 (embedding)) — pausing all logging dispatch ~30s');

    gate.trip(5_000, 'HTTP 429 (cheap)'); // inside the window — no new line
    expect(logs).to.have.length(1);

    gate.trip(60_000, 'HTTP 429 (cheap)'); // a real extension — worth saying
    expect(logs).to.have.length(2);
    expect(logs[1]).to.contain('~60s');
  });
});
