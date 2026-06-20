import type { Session } from "@supabase/supabase-js";

export async function saveGithubTokenFromSession(session: Session): Promise<void> {
  void session;
  // Supabase GitHub login authenticates the OnboardBuddy account. Repository
  // import uses a separate GitHub App user token saved by /github/oauth/complete.
}
