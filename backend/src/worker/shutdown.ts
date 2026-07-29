/**
 * Graceful shutdown for the worker process.
 *
 * SIGTERM used to kill the process mid-job: a planned deploy orphaned every
 * in-flight run and left the recovery sweep to clean up after it. BullMQ's
 * `Worker.close()` does the right thing — it stops fetching NEW jobs and
 * resolves once the active ones finish — so a deploy can drain instead.
 *
 * The grace period is bounded, and that bound matters: a cold analysis takes
 * minutes and no orchestrator waits minutes for a container to stop (Docker's
 * default `stop_grace_period` is 10s; Railway sends SIGKILL shortly after
 * SIGTERM too). So draining is a REDUCTION in how often recovery is needed,
 * never a replacement for it: work that is nearly done finishes, and work that
 * is not is handed to the recovery sweep explicitly rather than silently.
 *
 * Note on forcing: BullMQ's `close(force)` returns the in-flight `closing`
 * promise if a close is already running, so a second `close(true)` after a
 * timed-out `close(false)` does NOT force — it just awaits the same pending
 * promise forever. Stopping the wait and exiting the process is therefore the
 * only real timeout, which is what `drainWorkers` reports back.
 */

/** Structural type — anything with BullMQ's `close()` shape, no import needed. */
export interface ClosableWorker {
  close(force?: boolean): Promise<void>;
}

export interface DrainOptions {
  workers: ClosableWorker[];
  /** Hard cap on how long to wait for active jobs to finish. */
  graceMs: number;
}

/**
 * Asks every worker to stop taking new jobs and finish what it holds, waiting
 * at most `graceMs`. Resolves `{ drained: true }` when they all finished on
 * their own, `{ drained: false }` when the grace period expired first — the
 * caller decides what to do about the abandoned work.
 */
export async function drainWorkers(opts: DrainOptions): Promise<{ drained: boolean }> {
  // close(false): stop fetching, finish active jobs. Started for every worker
  // immediately — even if the grace period expires, they have already stopped
  // pulling new work off the queue.
  const closing = Promise.all(opts.workers.map((w) => w.close(false))).then(() => true as const);
  // A close() rejection while we are racing a timer would otherwise surface as
  // an unhandled rejection during shutdown; treat it as "not drained".
  const settled = closing.catch(() => false as const);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), opts.graceMs);
    // Never keep the event loop alive purely for the grace timer.
    (timer as { unref?: () => void }).unref?.();
  });

  const drained = await Promise.race([settled, expiry]);
  if (timer) clearTimeout(timer);
  return { drained };
}
