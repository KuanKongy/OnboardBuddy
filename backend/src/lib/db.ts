import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}
