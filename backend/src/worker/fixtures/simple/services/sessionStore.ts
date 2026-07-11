export interface SessionRow {
  token: string;
  userId: string;
}

export interface Db {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

const db: Db = {
  query: async () => undefined,
};

export async function saveSession(session: SessionRow): Promise<void> {
  await db.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [
    session.token,
    session.userId,
  ]);
}

export async function deleteSession(token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}
