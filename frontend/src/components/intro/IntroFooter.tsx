import { Link } from "react-router-dom";
import { LogoMark, LogoWordmark } from "@/components/BrandLogo";

export function IntroFooter() {
  return (
    <footer className="border-t border-border/40 px-4 py-10 sm:px-6">
      {/* Three equal grid tracks, not justify-between: with unequal neighbors
          (narrow logo, wide nav) the between-gaps centered the tagline between
          its neighbors instead of on the page's own axis. */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-6 text-center sm:grid-cols-3">
        <div className="flex items-center justify-center gap-2 sm:justify-self-start">
          <LogoMark className="h-5 w-5" />
          <LogoWordmark />
        </div>
        <p className="text-xs text-muted-foreground sm:justify-self-center">
          Onboarding grounded in code evidence.
        </p>
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs sm:justify-self-end"
        >
          <Link to="/faq" className="text-muted-foreground transition-colors hover:text-foreground">
            FAQ
          </Link>
          <Link to="/privacy" className="text-muted-foreground transition-colors hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="text-muted-foreground transition-colors hover:text-foreground">
            Terms
          </Link>
          <Link to="/login" className="text-muted-foreground transition-colors hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </div>
      <p className="mt-8 text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} OnboardBuddy. All rights reserved.
      </p>
    </footer>
  );
}
