import express from 'express';
import { formatUser, MAX_USERS } from './util.js';

export interface UserRow {
  id: string;
  email: string;
}

export class UserService {
  async listUsers(db: { from: (t: string) => { select: () => Promise<UserRow[]> } }): Promise<UserRow[]> {
    const rows = await db.from('users').select();
    return rows.slice(0, MAX_USERS);
  }

  getLabel(row: UserRow): string {
    return formatUser(row.email);
  }
}

export const app = express();

app.get('/users', async (req, res) => {
  const service = new UserService();
  res.json({ users: formatUser('Demo') });
});
