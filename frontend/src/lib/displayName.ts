import type { User } from "@supabase/supabase-js";

/**
 * The one fallback chain for a user's visible name. GitHub accounts without a
 * public profile name arrive with no full_name/name in user_metadata (GoTrue
 * only copies what GitHub returns), so displays fall through to the GitHub
 * username, then the email local part. Without this, the settings profile
 * card printed "No name set" while the sidebar showed the email prefix.
 */
export function displayName(
  user: Pick<User, "user_metadata" | "identities" | "email"> | null | undefined,
): string {
  if (!user) return "Account";
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const github = user.identities?.find((identity) => identity.provider === "github");
  const githubUsername = (github?.identity_data as Record<string, unknown> | undefined)?.user_name;
  return (
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (typeof githubUsername === "string" && githubUsername) ||
    user.email?.split("@")[0] ||
    "Account"
  );
}
