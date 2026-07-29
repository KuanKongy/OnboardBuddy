import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { LogoMark, LogoWordmark } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Header for the two pages a signed-out visitor can reach: the landing page
 * and the public /help. Shared so /help can't drift from the landing chrome —
 * they are the same surface to someone who hasn't signed up yet.
 *
 * Like IntroPage, a signed-in visitor is NOT redirected: the header just
 * swaps the auth buttons for a way back into the app.
 */
export function PublicPageHeader() {
  const { user, loading } = useAuth();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <LogoMark className="h-7 w-7" />
          <LogoWordmark />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {!loading && user ? (
            <Button size="sm" asChild>
              <Link to="/dashboard">
                Go to Dashboard
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/login">Log In</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/signup">Sign Up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
