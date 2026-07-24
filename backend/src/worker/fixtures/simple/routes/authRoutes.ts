import { AuthService, ICredentials } from '../services/authService.js';
import { saveSession } from '../services/sessionStore.js';
import { formatLabel } from '../utils/textUtil.js';

interface Req {
  body: ICredentials;
}

interface Res {
  json(payload: unknown): void;
}

const service = new AuthService();

export async function loginHandler(req: Req, res: Res): Promise<void> {
  const session = await service.login(req.body);
  await saveSession({ token: session.token, userId: session.userId });
  res.json({ session, label: formatLabel(session.userId) });
}

export function logoutHandler(_req: Req, res: Res): void {
  service.logout('token');
  res.json({ ok: true });
}

const reportQueue = { add: async (_name: string, _payload: unknown): Promise<void> => {} };

async function query(_sql: string, _params?: unknown[]): Promise<void> {}

/** Seed-level effects: the handler itself INSERTs and enqueues (audit §5.4). */
export async function enqueueReportHandler(_req: Req, res: Res): Promise<void> {
  await query(`INSERT INTO report_jobs (status) VALUES ('queued')`, []);
  await reportQueue.add('build_report', { requestedBy: 'fixture' });
  res.json({ queued: true });
}
