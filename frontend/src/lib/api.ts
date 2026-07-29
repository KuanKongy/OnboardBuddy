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

  if (res.status === 401 && !retried && token) {
    const { error } = await supabase.auth.refreshSession();
    if (!error) {
      return apiFetch(path, options, true);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `API error ${res.status}`, res.status, body);
  }
  return res.json();
}
