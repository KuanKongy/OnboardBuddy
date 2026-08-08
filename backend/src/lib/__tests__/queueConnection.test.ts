import { expect } from 'chai';
import { buildConnection } from '../queue.js';

/**
 * The production Redis guard, which exists because its absence is invisible.
 * With RESILIENCE's infinite reconnect, a production container that fell back
 * to localhost:6379 booted clean, passed /api/health, accepted every enqueue,
 * and ran nothing — the same class of silent misconfiguration as the CORS
 * default that became bug #15. A unit test is the only place this is cheap to
 * see: reproducing it live means deploying a broken deployment.
 */
describe('buildConnection', () => {
  it('refuses the localhost fallback in production, naming both variables', () => {
    const boot = () => buildConnection({ NODE_ENV: 'production' });
    // Both names, because either one fixes it and the deployer has to be told
    // which they have.
    expect(boot).to.throw(/REDIS_URL/);
    expect(boot).to.throw(/REDIS_HOST/);
  });

  it('accepts production when either variable is set', () => {
    expect(buildConnection({ NODE_ENV: 'production', REDIS_URL: 'rediss://:pw@redis.example:6380' }))
      .to.include({ host: 'redis.example', port: 6380, password: 'pw' });
    expect(buildConnection({ NODE_ENV: 'production', REDIS_HOST: 'redis.internal' }))
      .to.include({ host: 'redis.internal', port: 6379 });
  });

  it('still falls back to localhost outside production', () => {
    // Local dev and the test suite import this module with nothing set; a
    // guard that fired there would break every developer's first run.
    for (const NODE_ENV of ['development', 'test', undefined]) {
      expect(buildConnection({ NODE_ENV }), NODE_ENV ?? 'unset').to.include({
        host: 'localhost',
        port: 6379,
      });
    }
  });
});
