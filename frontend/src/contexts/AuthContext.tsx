import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { GITHUB_NEXT_KEY } from "../hooks/useGitHubReturn";
import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<Session | null>;
  signOut: () => Promise<void>;
  /** `next` = in-app path to land on after the OAuth hop (deep-link preservation). */
  signInWithGithub: (next?: string) => Promise<void>;
  /** `next` = in-app path the GitHub return leg lands on (default /import). */
  connectGithub: (next?: string) => Promise<void>;
  disconnectGithub: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  }

  async function signUp(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // The confirmation link signs the user in and continues to import,
      // instead of stranding them on the landing page to log in a second
      // time (the callback validates the next param and it survives Supabase's
      // round trip).
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/import`,
      },
    });
    if (error) throw error;
    return data.session;
  }

  async function signOut() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // best-effort server-side session invalidation
    }
    sessionStorage.removeItem(GITHUB_NEXT_KEY);
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  // The callback already honors `?next=` (and rejects anything that isn't a local
  // path), so the destination only has to survive the round trip through GitHub.
  async function signInWithGithub(next?: string) {
    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: callback.toString() },
    });
    if (error) throw error;
  }

  async function connectGithub(next?: string) {
    // Record where the return leg should land BEFORE leaving; clearing first
    // drops any stale target from an abandoned earlier attempt. Only local
    // paths are stored — the return handler validates again on read.
    sessionStorage.removeItem(GITHUB_NEXT_KEY);
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      sessionStorage.setItem(GITHUB_NEXT_KEY, next);
    }
    const { authorization_url } = await apiFetch("/github/oauth/start") as {
      authorization_url: string;
    };
    window.location.href = authorization_url;
  }

  async function disconnectGithub() {
    await apiFetch("/github/connection", { method: "DELETE" });
  }

  return (
    <AuthContext.Provider
      value={{ user, session, loading, signIn, signUp, signOut, signInWithGithub, connectGithub, disconnectGithub }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
