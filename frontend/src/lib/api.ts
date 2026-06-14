import { supabase } from "./supabase";

const API_URL = import.meta.env.VITE_API_URL;

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
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}
