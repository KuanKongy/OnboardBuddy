import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
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
