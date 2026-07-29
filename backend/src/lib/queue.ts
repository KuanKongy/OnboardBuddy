import { Queue, QueueOptions } from 'bullmq';

// Resilience against cloud Redis (Upstash) dropping idle/blocking sockets: a
// worker whose blocking connection dies silently sits "listening" forever
// while jobs pile up in 'waiting' (observed live — regenerations that never
// started until the worker restarted). Reconnect forever with capped backoff
// and keep the TCP socket warm.
const RESILIENCE = {
  maxRetriesPerRequest: null,     // required by BullMQ for blocking connections
  enableReadyCheck: false,
  retryStrategy: (times: number) => Math.min(times * 1_000, 15_000),
  keepAlive: 15_000,
  reconnectOnError: () => true,   // e.g. Upstash READONLY/connection-reset errors
};

export function buildConnection() {
  const url = process.env.REDIS_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      ...RESILIENCE,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
    ...RESILIENCE,
  };
}

export const connection = buildConnection();

const queueOpts: QueueOptions = { connection };

// Dev isolation: teammates share one cloud Redis, so a stale worker on
// another machine can steal (and 401-fail) jobs enqueued here. Setting
// QUEUE_SUFFIX (e.g. "-alice") gives this machine's producers AND consumers
// their own queue names. Default '' = shared team queues.
const QUEUE_SUFFIX = process.env.QUEUE_SUFFIX ?? '';
export const ANALYSIS_QUEUE = `analysis${QUEUE_SUFFIX}`;
export const SUMMARY_QUEUE = `summary${QUEUE_SUFFIX}`;

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
  /** Branch to analyze — omitted = the project's default branch. */
  branch?: string;
  /** Per-run depth override — omitted = project_settings.analysis_depth. */
  depth?: 'cheap' | 'standard' | 'full';
  /** Role for the auto-generated package — omitted = project default role. */
  role?: string;
  /**
   * Re-analyze even when a complete snapshot for the resolved (scope, commit)
   * already exists. Default false = reuse it and jump straight to generation.
   */
  force?: boolean;
  /**
   * Whether a snapshot-reuse short-circuit may enqueue package generation
   * (default true — a user who clicked Analyze wants a package). Webhook runs
   * set false: they only stale-flag, never spend on generation.
   */
  autoGenerate?: boolean;
}

export interface SummaryJobData {
  jobId: string;
  snapshotId: string;
  projectId: string;
  triggeredBy: string;
  role?: string;
  /**
   * Branch this package belongs to. Part of package identity (a snapshot is
   * content-addressed per (scope, commit) and may serve several branches).
   * Omitted = the snapshot's provenance branch.
   */
  branch?: string;
  /** Set for regenerate_section jobs: regenerate only this section type. */
  sectionType?: string;
  /**
   * Bug #36: set for a single-tutorial regeneration — the `tutorials.stable_key`
   * to rebuild (`tut:<workflow key>`). Rides the SAME `regenerate_section` job
   * type: `analysis_jobs.job_type` is a CHECK-constrained enum and M5 freezes
   * the schema (doc/DEVOPS.md), so the distinction lives in the job's
   * `checkpoint` jsonb and in this field rather than in a new enum value.
   * Mutually exclusive with `sectionType`.
   */
  tutorialStableKey?: string;
  /**
   * Set for regenerate_section jobs: the existing package to regenerate
   * into. Lets a stale section be rebuilt against a newer snapshot without
   * spawning a new package for the new commit.
   */
  packageId?: string;
}
