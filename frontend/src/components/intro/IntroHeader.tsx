import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { LogoMark, LogoWordmark } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const SECTION_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#privacy", label: "Privacy" },
  { href: "#pipeline", label: "Pipeline" },
];

/**
 * Landing-local header. PublicPageHeader stays as /help's chrome; the landing
 * needs section anchors and a sticky translucent bar it shouldn't impose on
 * every public page. A signed-in visitor is offered the way back into the
 * app, never bounced (bug #59's no-redirect decision) and never invited to
 * sign up for an account they already have.
 */
export function IntroHeader() {
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <LogoMark className="h-7 w-7" />
          <LogoWordmark className="text-[0.9375rem]" />
        </Link>
        <nav aria-label="Landing sections" className="hidden items-center gap-1 md:flex">
          {SECTION_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {!loading &&
            (user ? (
              <Button size="sm" asChild>
                <Link to="/dashboard">
                  Go to dashboard
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/signup">Get started</Link>
                </Button>
              </>
            ))}
        </div>
      </div>
    </header>
  );
}
