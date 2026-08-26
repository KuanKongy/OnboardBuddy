/**
 * Dead-consumer watchdog (the "listening but deaf" quirk): after container
 * restarts, a BullMQ Worker occasionally comes up with a dead blocking
 * socket — it logs "listening", `getWorkers()` shows nothing, and queued
 * jobs sit forever. The manual fix was `docker restart`; this module does
 * the same thing in-process, scoped to the Worker object.
 *
 * Mechanics: every `intervalMs` (default `WATCHDOG_INTERVAL_MS`, 5 min),
 * sample the queue — jobs WAITING while the worker has NOTHING active. One
 * such sample can be a race (a job enqueued between polls); two consecutive
 * samples mean the consumer is deaf → close the Worker and construct a fresh
 * one.
 *
 * Cost: one `getJobCounts('wait', 'active')` per queue per tick — 4 Redis
 * commands (EVALSHA + LINDEX + 2 LLEN; Upstash bills every call inside a Lua
 * script), ~2.3k/day for both queues at the 5-minute default. This is the
 * SECOND line of defence: with the drainDelay unit fixed (lib/queue.ts),
 * BullMQ itself replaces a dead blocking socket within ~5 min, so the relaxed
 * cadence only bounds the hypothetical non-socket wedge (≤10 min). No new
 * containers, no deploy-surface change; recreation only fires in the zombie
 * state, so a healthy worker never notices the watchdog exists.
 */

export interface WatchdogSample {
  waiting: number;
  active: number;
}

/** Pure decision: recreate only on two consecutive zombie samples. */
export function shouldRecreate(previous: WatchdogSample | null, current: WatchdogSample): boolean {
  const zombie = (s: WatchdogSample) => s.waiting > 0 && s.active === 0;
  return previous !== null && zombie(previous) && zombie(current);
}

/**
 * Default check cadence. Detection stays "two consecutive zombie samples",
 * so the backstop bound is 2 × this (≤10 min).
 */
export const WATCHDOG_INTERVAL_MS = 300_000;

export interface QueueWatchdogDeps {
  queueName: string;
  sample(): Promise<WatchdogSample>;
  /** Close the old Worker and construct a replacement. */
  recreate(): Promise<void>;
  intervalMs?: number;
  log?: (msg: string) => void;
}

/** Returns a stop function. Errors in sampling/recreation never escape. */
export function startQueueWatchdog(deps: QueueWatchdogDeps): () => void {
  const log = deps.log ?? ((m: string) => console.warn(m));
  let previous: WatchdogSample | null = null;
  let busy = false;

  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const current = await deps.sample();
      if (shouldRecreate(previous, current)) {
        log(`[watchdog] queue "${deps.queueName}": ${current.waiting} waiting, 0 active for 2 checks — recreating consumer`);
        previous = null;
        await deps.recreate();
        log(`[watchdog] queue "${deps.queueName}": consumer recreated`);
      } else {
        previous = current;
      }
    } catch (err) {
      log(`[watchdog] queue "${deps.queueName}": check failed (${err instanceof Error ? err.message : err})`);
    } finally {
      busy = false;
    }
  }, deps.intervalMs ?? WATCHDOG_INTERVAL_MS);
  timer.unref?.();

  return () => clearInterval(timer);
}
