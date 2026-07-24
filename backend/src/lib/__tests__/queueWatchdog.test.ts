import { expect } from 'chai';
import { shouldRecreate, startQueueWatchdog, type WatchdogSample } from '../queueWatchdog';

describe('queueWatchdog (dead-consumer self-heal)', () => {
  it('shouldRecreate only on two consecutive zombie samples', () => {
    const zombie: WatchdogSample = { waiting: 3, active: 0 };
    const healthy: WatchdogSample = { waiting: 0, active: 0 };
    const working: WatchdogSample = { waiting: 5, active: 2 };
    expect(shouldRecreate(null, zombie)).to.equal(false);       // first sighting can be a race
    expect(shouldRecreate(zombie, zombie)).to.equal(true);      // confirmed deaf
    expect(shouldRecreate(zombie, healthy)).to.equal(false);    // drained itself
    expect(shouldRecreate(zombie, working)).to.equal(false);    // picked up work
    expect(shouldRecreate(working, zombie)).to.equal(false);    // needs a second look
  });

  it('recreates once after two zombie polls, then resets its history', async () => {
    let recreations = 0;
    const samples: WatchdogSample[] = [
      { waiting: 2, active: 0 },
      { waiting: 2, active: 0 },
      { waiting: 0, active: 1 }, // healthy after recreation
      { waiting: 0, active: 0 },
    ];
    let i = 0;
    const stop = startQueueWatchdog({
      queueName: 'test-q',
      intervalMs: 20,
      log: () => {},
      sample: async () => samples[Math.min(i++, samples.length - 1)]!,
      recreate: async () => { recreations += 1; },
    });
    await new Promise((r) => setTimeout(r, 130));
    stop();
    expect(recreations).to.equal(1);
  });

  it('sampling errors never escape or stop the loop', async () => {
    let calls = 0;
    const stop = startQueueWatchdog({
      queueName: 'test-q',
      intervalMs: 15,
      log: () => {},
      sample: async () => { calls += 1; throw new Error('redis hiccup'); },
      recreate: async () => {},
    });
    await new Promise((r) => setTimeout(r, 70));
    stop();
    expect(calls).to.be.greaterThan(1);
  });
});
