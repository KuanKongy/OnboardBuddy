interface Req {
  body: { email: string; password: string };
}

interface Res {
  json(payload: unknown): void;
}

/** Stand-in for a Supabase client — only the auth surface matters here. */
const supabase = {
  auth: {
    async signInWithPassword(_c: { email: string; password: string }): Promise<{ token: string }> {
      return { token: 'fixture' };
    },
    async signOut(): Promise<void> {},
  },
};

/**
 * Auth handler whose ONLY side effects are identity-SDK calls — the shape
 * that used to trace to "no effects" and drop the whole User Auth journey
 * (doc/DETECTION_COVERAGE.md §2). The auth sink detection must keep it.
 */
export async function supabaseLoginHandler(req: Req, res: Res): Promise<void> {
  const session = await supabase.auth.signInWithPassword(req.body);
  res.json({ session });
}

export async function supabaseLogoutHandler(_req: Req, res: Res): Promise<void> {
  await supabase.auth.signOut();
  res.json({ ok: true });
}
