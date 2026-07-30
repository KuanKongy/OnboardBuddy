import { runtimeConfig } from "./runtimeConfig";
import { supabase } from "./supabase";

/** Error carrying the HTTP status + response body so callers can branch
 * on conflicts (e.g. 409 "analysis already running" with active_job_id). */
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * #74/H3: a session that could not be refreshed left every page half-alive —
 * each request threw its own 401 into whatever error state the caller happened
 * to have, and the user sat on a shell of a page with no idea they were signed
 * out. One signOut converts that into the state the app already handles:
 * AuthContext's onAuthStateChange sees SIGNED_OUT and clears `user`,
 * ProtectedRoute redirects to /login carrying the location to come back to.
 *
 * Latched because a page load fires several requests at once and they all get
 * the same 401 — without it, each one calls signOut and the redirect fights
 * itself. Cleared on the next request that succeeds (not on SIGNED_IN: this
 * module deliberately has no subscription to unsubscribe, and a successful
 * request is the stronger proof that the credentials work again).
 */
let signedOutOnFinal401 = false;

async function signOutOnce(): Promise<void> {
  if (signedOutOnFinal401) return;
  signedOutOnFinal401 = true;
  await supabase.auth.signOut().catch(() => {
    // Best effort: the throw below is what the caller acts on either way.
  });
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  retried = false,
) {
  const token = await getAccessToken();
  // Bug #7: `Content-Type` describes the REQUEST body, so sending it on a GET
  // (which has none) is a lie about a payload that isn't there. Harmless
  // against our own Express server, but it is the header that makes a
  // cross-origin GET non-simple, so it forces a CORS preflight on every read —
  // and any proxy or gateway that validates the header against an absent body
  // is entitled to reject it. Set it only when there is a body to describe;
  // an explicit `headers` entry from the caller still wins.
  const headers: Record<string, string> = {
    ...(options.body != null ? { "Content-Type": "application/json" } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  // Read per call, not captured in a module const: the origin comes from
  // runtime configuration (see runtimeConfig.ts), so nothing about it is a
  // build-time constant any more.
  const res = await fetch(`${runtimeConfig.apiUrl}${path}`, { ...options, headers });

  if (res.status === 401 && token) {
    if (!retried) {
      const { error } = await supabase.auth.refreshSession();
      if (!error) {
        return apiFetch(path, options, true);
      }
    }
    // Either the refresh failed or the retry came back 401 anyway: the session
    // is gone, not stale.
    await signOutOnce();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `API error ${res.status}`, res.status, body);
  }
  signedOutOnFinal401 = false;
  return res.json();
}
