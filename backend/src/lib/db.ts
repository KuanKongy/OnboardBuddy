import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase's session-mode pooler caps the whole user at pool_size (15 by
  // default) and BOTH processes (API + worker) hold clients from that cap, so
  // the per-process default must leave headroom: set PG_POOL_MAX per service
  // (recommended: API=4, worker=8 — see doc/DEVOPS.md "Connection pooling").
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
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
