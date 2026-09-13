import { getDeviceFp, getDeviceId } from "./deviceId";
import { clearGithubReturnTarget } from "./githubReturnTarget";
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

// One signOut on an unrefreshable session, handing the problem to the chain that
// already exists: AuthContext sees SIGNED_OUT, ProtectedRoute redirects to /login.
// Latched because a page load fires several requests that all 401 together, and each
// calling signOut makes the redirect fight itself. Cleared on the next request that
// succeeds rather than on SIGNED_IN — this module has no subscription.
let signedOutOnFinal401 = false;

/**
 * The fingerprint hash is computed ONCE at module load and attached from then
 * on. Deliberately not awaited per request: hashing is fast but asynchronous,
 * and making every call site wait on it would add a microtask hop to reads that
 * used to start immediately. The first few requests of a page load may go out
 * without X-Device-Fp, which costs nothing - it is evidence only, and
 * X-Device-Id (synchronous, the value the server actually gates on) is always
 * there.
 */
let deviceFp: string | null = null;
void getDeviceFp().then((fp) => {
  deviceFp = fp;
});

/** Never let an identifier problem break a request: a dropped header is recoverable. */
function deviceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    headers["X-Device-Id"] = getDeviceId();
  } catch {
    // getDeviceId already swallows storage failures; this is the last net.
  }
  if (deviceFp) headers["X-Device-Fp"] = deviceFp;
  return headers;
}

async function signOutOnce(): Promise<void> {
  if (signedOutOnFinal401) return;
  signedOutOnFinal401 = true;
  // A pending GitHub return target must not outlive the session that set it
  // (a stale one once routed the NEXT sign-in's GitHub return to /settings).
  clearGithubReturnTarget();
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
    // Anti-abuse device signals on every request, including reads: GET
    // /me/credit is where most of the device history comes from, because the
    // meter loads far more often than anything spends. An explicit `headers`
    // entry from the caller still wins.
    ...deviceHeaders(),
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
