import { supabase } from "./supabase";

const API_URL = import.meta.env.VITE_API_URL;

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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

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
