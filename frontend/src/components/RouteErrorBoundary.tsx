import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A render-error boundary scoped to ONE routed page (bug #24).
 *
 * ## What this adds that the 404 route does not
 *
 * They catch disjoint failures and the 404 route cannot substitute:
 *
 * - `path="*"` handles a URL **no route matches**. That is a routing decision
 *   made before any page renders, and it is the fix for the blank screen the
 *   M4 sweep saw at `/projects`.
 * - This handles a route that matched and then **threw while rendering** — a
 *   malformed API payload, an undefined field in a `.map`, a bad selector.
 *   React's response to an uncaught render error is to unmount the whole tree,
 *   so before this the *only* net was the app-level boundary in `App.tsx`:
 *   one bad graph payload replaced the entire application, sidebar and all,
 *   with a full-screen "Something went wrong" whose only action was a reload
 *   of the same URL that had just failed.
 *
 * Scoping the boundary to the `<Outlet />` keeps the shell alive: the sidebar,
 * the project header and the package selector stay usable, so the failure is
 * one broken panel rather than a broken product, and the user can navigate to
 * a working tab without a reload. Two recovery paths that the app-level
 * boundary cannot offer: retry just this page, and leave for a route that
 * works.
 *
 * Navigating away clears the error. React never resets a boundary on its own,
 * so a page that threw once would keep showing its error on every subsequent
 * route under the same boundary — `resetKey` (the pathname) does it.
 */
class RouteErrorBoundaryInner extends Component<
  { children: ReactNode; resetKey: string; scope: string; homeTo: string; homeLabel: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept: the boundary is the last place the component stack still exists.
    console.error(`[${this.props.scope}] render error`, error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6" role="alert">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft">
            <AlertTriangle className="h-6 w-6 text-danger" />
          </div>
          <h1 className="mb-1.5 text-sm font-semibold text-foreground">This page failed to render</h1>
          <p className="mb-1.5 text-xs text-muted-foreground">
            The rest of the app is fine — only this panel stopped. Nothing you did was lost, and no
            analysis was started or charged.
          </p>
          <p className="mb-4 break-words text-[0.6875rem] text-muted-foreground/80">{error.message}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => this.setState({ error: null })}>
              <RefreshCw className="h-3.5 w-3.5" /> Try this page again
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to={this.props.homeTo}>{this.props.homeLabel}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Wrap a routed `<Outlet />`. `scope` only labels the console entry; `homeTo`
 * is the escape hatch offered next to the retry.
 */
export function RouteErrorBoundary({
  children,
  scope,
  homeTo = "/dashboard",
  homeLabel = "Back to dashboard",
}: {
  children: ReactNode;
  scope: string;
  homeTo?: string;
  homeLabel?: string;
}) {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundaryInner resetKey={pathname} scope={scope} homeTo={homeTo} homeLabel={homeLabel}>
      {children}
    </RouteErrorBoundaryInner>
  );
}
