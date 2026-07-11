import { Queue, QueueOptions } from 'bullmq';

export function buildConnection() {
  const url = process.env.REDIS_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
  };
}

export const connection = buildConnection();

const queueOpts: QueueOptions = { connection };

export const ANALYSIS_QUEUE = 'analysis';
export const SUMMARY_QUEUE = 'summary';

// Queues are created lazily on first use rather than at module load. BullMQ opens
// a Redis connection as soon as a Queue is constructed, so eager top-level
// creation would connect to Redis just by importing this module — e.g. when the
// API routes are loaded during tests, producing noisy ECONNREFUSED errors. With
// memoized getters, nothing connects until something actually enqueues a job.
let analysisQueueInstance: Queue | undefined;
let summaryQueueInstance: Queue | undefined;

export function getAnalysisQueue(): Queue {
  return (analysisQueueInstance ??= new Queue(ANALYSIS_QUEUE, queueOpts));
}

export function getSummaryQueue(): Queue {
  return (summaryQueueInstance ??= new Queue(SUMMARY_QUEUE, queueOpts));
}

export interface AnalysisJobData {
  jobId: string;
  projectId: string;
  /** 'analyze' (default) runs the full pipeline; 'preflight' only builds the analysis preview. */
  task?: 'analyze' | 'preflight';
  /** analysis_scopes.id — omitted = whole-repo scope. */
  scopeId?: string;
  /** Exact commit SHA to analyze — omitted = branch head. */
  commit?: string;
}

export interface SummaryJobData {
  jobId: string;
  snapshotId: string;
  projectId: string;
  triggeredBy: string;
  role?: string;
  /** Set for regenerate_section jobs: regenerate only this section type. */
  sectionType?: string;
  /**
   * Set for regenerate_section jobs: the existing package to regenerate
   * into. Lets a stale section be rebuilt against a newer snapshot without
   * spawning a new package for the new commit.
   */
  packageId?: string;
}
