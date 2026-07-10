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
