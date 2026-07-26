import pg from "pg";
import { envInt } from "./env.js";

/**
 * Per-process pool sizing — the arithmetic, for the WORKER process (the
 * heaviest consumer; the API is pinned to 10 in docker-compose.yml).
 *
 * Both workers live in ONE process: src/worker/index.ts line 15 does
 * `import './summaryWorker.js'`, so WORKER_CONCURRENCY analysis jobs and
 * SUMMARY_CONCURRENCY package jobs share this single pool.
 *
 * Per concurrent ANALYSIS job, sustained connection demand:
 *     1  heartbeat writer            (worker/index.ts, every 15s)
 *   + 1  step/progress writer        (updateStep; semantic pass throttles to ~1/1.5s)
 *   + 1  persist client held across BEGIN…COMMIT ("Persisting results") —
 *        exclusive: no semantic fan-out is running during that transaction
 *   + ~4 statements out of the widest in-phase fan-out. That fan-out is
 *        `mapLimit(batches, 28)` (semantic/symbolPass.ts, semantic/critiquePass.ts),
 *        but each unit is LLM-bound: 3 short bulk statements, issued one at a
 *        time, per multi-second provider call. Sustained overlap is a handful;
 *        28 is the instantaneous burst ceiling.
 *   ≈ 6 connections/job
 *
 * 4 concurrent runs × 6 = 24, + 6 for the co-hosted summary worker's
 * heartbeats/checkpoint writes, the orphan reconciler and the queue watchdog
 * = 30. Demand above that now QUEUES instead of dying (see the timeout below).
 *
 * Safe ceiling: DATABASE_URL is Supabase's TRANSACTION-mode pooler (port 6543).
 * A "connection" here is a multiplexed pooler client slot (Supavisor
 * `max_client_conn`, 200 by default), while genuine statement parallelism is
 * capped by the pooler's own server-side pool (`default_pool_size`, 15–20 by
 * default and shared with the API). Sizing much past ~2× that server pool only
 * relocates the queue from this process to the pooler, so 30/worker + 10/API is
 * deliberate: ~40 of 200 client slots, leaving headroom for 3–4 worker replicas
 * plus psql/Studio/migrations. Raise Supabase's `default_pool_size` before
 * raising this further.
 */
const POOL_MAX = envInt("PG_POOL_MAX", 30);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // DATABASE_URL points at Supabase's TRANSACTION-mode pooler (port 6543):
  // clients multiplex over the pooler's backend pool, so per-process caps can
  // be sized for the process's own fan-out rather than a shared user-wide
  // session cap. DDL/migrations go through DIRECT_DATABASE_URL instead — see
  // doc/DEVOPS.md "Connection pooling". No session state may be assumed here
  // (no advisory locks, LISTEN/NOTIFY, SET SESSION, named prepared statements).
  max: POOL_MAX,
  idleTimeoutMillis: 30_000,
  // Wait for a free client, don't die on contention. At 5s, two concurrent
  // analyses against max:10 both failed outright with "timeout exceeded when
  // trying to connect": the 28-wide semantic fan-out saturated the pool and a
  // 5s acquire cap converted normal queueing into a killed run. Statements
  // here are short (bulk multi-VALUES / unnest writes), so 30s is slack for a
  // burst to drain, not cover for a leak — no code path holds a client while
  // awaiting another acquisition, so there is nothing to deadlock on.
  connectionTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error on idle client:", err.message);
});

type QueryResult = ReturnType<typeof pool.query> extends Promise<infer R> ? R : never;
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>;

let queryOverride: QueryFn | null = null;

export function query(text: string, params?: unknown[]) {
  if (queryOverride) return queryOverride(text, params);
  return pool.query(text, params);
}

/** @internal Used by tests to stub database responses without a live Postgres connection. */
export function __setQueryForTests(fn: QueryFn | null): void {
  queryOverride = fn;
}
