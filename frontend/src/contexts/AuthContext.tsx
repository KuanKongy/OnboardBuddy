import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<Session | null>;
  signOut: () => Promise<void>;
  signInWithGithub: () => Promise<void>;
  connectGithub: (preserveAfterOAuthFlag?: boolean) => Promise<void>;
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
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data.session;
  }

  async function signOut() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // best-effort server-side session invalidation
    }
    sessionStorage.removeItem("onboardbuddy.github.after_oauth");
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function signInWithGithub() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  }

  async function connectGithub(preserveAfterOAuthFlag = false) {
    // Callers that just set the flag themselves (e.g. ImportPage staging an
    // "install" continuation right before this call) pass true so their
    // flag survives; everyone else gets the defensive clear of any stale
    // flag left behind by a previous, abandoned OAuth attempt.
    if (!preserveAfterOAuthFlag) sessionStorage.removeItem("onboardbuddy.github.after_oauth");
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
