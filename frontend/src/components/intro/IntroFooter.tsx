import { Link } from "react-router-dom";
import { LogoMark, LogoWordmark } from "@/components/BrandLogo";

export function IntroFooter() {
  return (
    <footer className="border-t border-border/40 px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 text-center sm:flex-row sm:text-left">
        <div className="flex items-center gap-2">
          <LogoMark className="h-5 w-5" />
          <LogoWordmark />
        </div>
        <p className="text-xs text-muted-foreground">Onboarding grounded in code evidence.</p>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
          <Link to="/help" className="text-muted-foreground transition-colors hover:text-foreground">
            Help &amp; FAQ
          </Link>
          <Link to="/help#privacy" className="text-muted-foreground transition-colors hover:text-foreground">
            Privacy &amp; AI transparency
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
