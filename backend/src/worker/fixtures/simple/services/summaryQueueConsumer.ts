import { saveSession } from './sessionStore.js';

/** Stand-in for a BullMQ-style Worker (constructor registers a handler). */
class Worker<T> {
  constructor(_queue: string, _handler: (job: T) => Promise<void>, _opts?: Record<string, unknown>) {}
}

const SUMMARY_QUEUE = 'summaries';

/**
 * The handler is passed as a bare reference, not an inline closure — the
 * exact shape that dropped the real SUMMARY consumer's workflow (the const
 * holding the Worker has no outgoing call edges; the referenced function is
 * the true seed). Not exported on purpose: the reference is the only path in.
 */
async function processSummaryJob(job: { id: string }): Promise<void> {
  await saveSession({ token: job.id, userId: job.id });
}

export const summaryWorker = new Worker<{ id: string }>(
  SUMMARY_QUEUE,
  processSummaryJob,
  { concurrency: 2 },
);
