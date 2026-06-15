import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { saveGithubTokenFromSession } from "@/lib/saveGithubToken";
import { supabase } from "@/lib/supabase";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function finishAuth(session: NonNullable<
      Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]
    >) {
      try {
        await saveGithubTokenFromSession(session);
      } catch (saveError) {
        console.error("Failed to save GitHub token:", saveError);
      }

      if (!cancelled) {
        navigate("/dashboard", { replace: true });
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      if (event === "SIGNED_IN" && session) {
        void finishAuth(session);
        return;
      }

      if (event === "SIGNED_OUT") {
        setError("Could not complete sign in. Please try again.");
      }
    });

    void supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (cancelled) return;
      if (error) {
        setError(error.message);
        return;
      }
      if (session) {
        void finishAuth(session);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="max-w-sm">
          <CardContent className="p-4 text-center">
            <h1 className="text-sm font-semibold text-foreground">Sign in failed</h1>
            <p className="mt-1 text-xs text-destructive">{error}</p>
            <Button variant="link" size="sm" className="mt-2" asChild>
              <Link to="/login">Back to login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
        <p className="mt-3 text-xs text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}
