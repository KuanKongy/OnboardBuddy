/**
 * Supabase reports auth-link failures by redirecting back with error params in the
 * query string and/or URL hash instead of a session — read both, or the receiving
 * page waits forever for a session that is never coming (#37).
 */

function authErrorParams(): { hash: URLSearchParams; query: URLSearchParams } {
  return {
    hash: new URLSearchParams(window.location.hash.replace(/^#/, "")),
    query: new URLSearchParams(window.location.search),
  };
}

/** Human-readable failure text, or "" when the URL carries no error at all. */
export function readOAuthError(): string {
  const { hash, query } = authErrorParams();
  const description = hash.get("error_description") ?? query.get("error_description");
  const code = hash.get("error") ?? query.get("error");
  if (!description && !code) return "";
  return description?.replace(/\+/g, " ") ?? code ?? "";
}

/**
 * GoTrue's machine-readable `error_code` (e.g. `otp_expired` for a recovery
 * link past its TTL), "" when absent. The human `error_description` is not a
 * contract — branch on this instead.
 */
export function readAuthErrorCode(): string {
  const { hash, query } = authErrorParams();
  return hash.get("error_code") ?? query.get("error_code") ?? "";
}
