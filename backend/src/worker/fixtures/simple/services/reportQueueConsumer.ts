import { saveSession } from './sessionStore.js';

/** Stand-in for a BullMQ-style Worker (constructor registers a handler). */
class Worker<T> {
  constructor(_queue: string, _handler: (job: T) => Promise<void>) {}
}

/**
 * Queue-consumer registration with an inline closure — the shape the
 * entrypoint detector must turn into a worker_job entrypoint and the
 * workflow extractor must trace through the closure's calls (audit P2 §15).
 */
export const reportsWorker = new Worker<{ id: string }>('reports', async (job) => {
  await saveSession({ token: job.id, userId: job.id });
});
