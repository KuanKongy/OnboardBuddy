import { Queue, QueueOptions } from 'bullmq';
import { envInt } from './env.js';

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

export function buildConnection(env: NodeJS.ProcessEnv = process.env) {
  const url = env.REDIS_URL;
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

  // Same shape as the CORS guard in api/app.ts (bug #15): a production process
  // must not boot on a development default. The failure this prevents is
  // silent rather than loud — RESILIENCE above reconnects forever with capped
  // backoff, so a container with no Redis configured comes up healthy, answers
  // /api/health, accepts every enqueue, and never runs a job. There is no
  // error to find because nothing has failed yet.
  if (!env.REDIS_HOST && env.NODE_ENV === 'production') {
    throw new Error(
      'REDIS_URL is required in production: set it to the Upstash TCP/TLS connection string ' +
        '(or set REDIS_HOST, plus REDIS_PORT/REDIS_PASSWORD, if you have the parts rather than ' +
        'a URL). Refusing to start on the localhost:6379 default, where BullMQ would retry the ' +
        'connection forever and every enqueued job would sit in "waiting" with nothing consuming it.',
    );
  }

  return {
    host: env.REDIS_HOST ?? 'localhost',
    port: Number(env.REDIS_PORT ?? 6379),
    password: env.REDIS_PASSWORD,
    ...RESILIENCE,
  };
}

export const connection = buildConnection();

const queueOpts: QueueOptions = { connection };

// Dev isolation: teammates share one cloud Redis, so a stale worker on
// another machine can steal (and 401-fail) jobs enqueued here. Setting
// QUEUE_SUFFIX (e.g. "-alice") gives this machine's producers AND consumers
// their own queue names. Default '' = shared team queues. The api and worker
// processes must be given the SAME value: they resolve their queue names
// independently, so a mismatch enqueues into a queue nobody is consuming and
// jobs sit in 'waiting' with no error anywhere.
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

// BullMQ's Worker `drainDelay` is in SECONDS (constructor default 5), not
// milliseconds. Both workers used to pass ms-sized values (30000 / 5000)
// believing otherwise, so an idle worker blocked for hours between wake-ups
// and BullMQ's own dead-socket guard — reconnect when a blocking call gets no
// response within drainDelay + 1s — effectively never fired. That is the
// "listening but deaf" state described in RESILIENCE above; with the unit
// fixed, BullMQ replaces a dead blocking socket within one idle block,
// proactively, and the watchdog (lib/queueWatchdog.ts) becomes the backstop
// rather than the only defence. Job pickup stays instant regardless:
// Queue.add writes a marker that interrupts the block.
//
// New env name on purpose: WORKER_POLL_INTERVAL_MS is 30000/5000 in existing
// deployments, and a value meant as milliseconds silently becoming a 30s/5s
// hot poll against the shared pay-per-command database is exactly the mistake
// to guard against. Hence the fresh name and the 30s floor.
export function resolveIdleBlockSeconds(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = console.warn,
): number {
  if (env.WORKER_POLL_INTERVAL_MS !== undefined) {
    warn(
      '[queue] WORKER_POLL_INTERVAL_MS is no longer read (BullMQ drainDelay is in seconds, ' +
        'not milliseconds) — remove it and set WORKER_IDLE_BLOCK_SECONDS (seconds, default 300) instead.',
    );
  }
  return Math.max(30, envInt('WORKER_IDLE_BLOCK_SECONDS', 300, env));
}

let idleBlockSecondsMemo: number | undefined;

/**
 * Memoised so the two worker modules share one resolution and one warning;
 * the API (which also imports this module) never calls it and so never warns.
 */
export function idleBlockSeconds(): number {
  return (idleBlockSecondsMemo ??= resolveIdleBlockSeconds());
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
  /**
   * Rebuild ONLY the stale sections and tutorials of `packageId` (which is
   * then required), leaving everything else in the package untouched and
   * unpaid for. Rides the `generate_package` job type for the same reason the
   * tutorial regeneration rides `regenerate_section`: `analysis_jobs.job_type`
   * is a CHECK-constrained enum and M5 freezes the schema (doc/DEVOPS.md), so
   * the distinction lives here and — authoritatively, because Resume rebuilds
   * this payload from the row — in the job's `checkpoint` jsonb.
   */
  onlyStale?: boolean;
}
