/**
 * Dead-consumer watchdog (the "listening but deaf" quirk): after container
 * restarts, a BullMQ Worker occasionally comes up with a dead blocking
 * socket — it logs "listening", `getWorkers()` shows nothing, and queued
 * jobs sit forever. The manual fix was `docker restart`; this module does
 * the same thing in-process, scoped to the Worker object.
 *
 * Mechanics: every `intervalMs` (default 60s), sample the queue — jobs
 * WAITING while the worker has NOTHING active. One such sample can be a
 * race (a job enqueued between polls); two consecutive samples mean the
 * consumer is deaf → close the Worker and construct a fresh one.
 *
 * Cost: two Redis commands per queue per minute (~6k/day for both queues) —
 * noise next to BullMQ's own polling traffic. No new containers, no
 * deploy-surface change; recreation only fires in the zombie state, so a
 * healthy worker never notices the watchdog exists.
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
  }, deps.intervalMs ?? 60_000);
  timer.unref?.();

  return () => clearInterval(timer);
}
