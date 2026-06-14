import type { Session } from "@supabase/supabase-js";
import { apiFetch } from "./api";

export async function saveGithubTokenFromSession(session: Session): Promise<void> {
  const providerToken = session.provider_token;
  const user = session.user;

  if (!providerToken || user.app_metadata.provider !== "github") {
    return;
  }

  const metadata = user.user_metadata as Record<string, unknown>;
  const githubUserId = Number(metadata.provider_id ?? metadata.sub);
  const githubUsername = String(metadata.user_name ?? metadata.preferred_username ?? "");

  if (!githubUserId || !githubUsername) {
    return;
  }

  await apiFetch("/auth/github/save-token", {
    method: "POST",
    body: JSON.stringify({
      github_user_id: githubUserId,
      github_username: githubUsername,
      access_token: providerToken,
      scopes: [],
    }),
  });
}
