/**
 * Avatar-URL allowlist (doc/SECURITY_XSS_PROMPT_INJECTION.md §5.3, finding X2).
 *
 * The avatar URL is free text stored in Supabase `user_metadata` and rendered
 * straight into `<img src>`. That is an unvalidated outbound fetch the user's
 * browser performs on every page load: pointing it at
 * `https://attacker/track.png?u=…` turns the profile into a beacon. It is
 * currently self-scoped (only your own avatar renders for you), which is why
 * the assessment rated it low — but the moment an avatar is shown to a
 * teammate it becomes a beacon aimed at them, so the input is validated now
 * rather than after that change.
 *
 * Validation happens on save AND on render: values written before this check
 * existed are already in Supabase, and only the render guard protects against
 * those.
 */

/** Hosts that legitimately serve profile pictures for this app. */
const ALLOWED_AVATAR_HOST = /(?:^|\.)(?:githubusercontent\.com|gravatar\.com|supabase\.co)$/i;

export function isSafeAvatarUrl(url: string | null | undefined): boolean {
  const value = (url ?? "").trim();
  if (value === "") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && ALLOWED_AVATAR_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** The URL when it is safe to fetch, else `undefined` so no request is made. */
export function safeAvatarSrc(url: string | null | undefined): string | undefined {
  return isSafeAvatarUrl(url) ? (url ?? "").trim() : undefined;
}

export const AVATAR_URL_HELP =
  "Avatar URL must be an https link on githubusercontent.com, gravatar.com, or supabase.co.";
