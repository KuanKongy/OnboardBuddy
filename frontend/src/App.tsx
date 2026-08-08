import { Component, useState, type ReactNode } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { LogoMark } from "@/components/BrandLogo";
import { PageSpinner } from "@/components/ui/page-spinner";
import { Button } from "@/components/ui/button";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SkipToContent } from "@/components/SkipToContent";
import { usePageChrome } from "@/hooks/usePageChrome";
import { MainChromeProvider, MainRegion } from "@/components/MainRegion";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Sidebar, dashboardNavItems } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/SidebarShell";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { useHotkeys } from "@/hooks/useHotkeys";
import { ProjectLayout } from "@/components/ProjectLayout";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AccountSettingsPage } from "@/pages/AccountSettingsPage";
import { ArchitecturePage } from "@/pages/ArchitecturePage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { GraphPage } from "@/pages/GraphPage";
import { GitHubSetupPage } from "@/pages/GitHubSetupPage";
import { GitHubOAuthCallbackPage } from "@/pages/GitHubOAuthCallbackPage";
import { FaqPage } from "@/pages/FaqPage";
import { HelpPage } from "@/pages/HelpPage";
import { PrivacyPage } from "@/pages/PrivacyPage";
import { TermsPage } from "@/pages/TermsPage";
import { ImportPage } from "@/pages/ImportPage";
import { IntroPage } from "@/pages/IntroPage";
import { InvitationsPage } from "@/pages/InvitationsPage";
import { LoginPage } from "@/pages/LoginPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { ProjectOverviewPage } from "@/pages/ProjectOverviewPage";
import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import { SignupPage } from "@/pages/SignupPage";
import { TeamPage } from "@/pages/TeamPage";
import { WalkthroughTab } from "@/pages/WalkthroughTab";
import { WorkflowsPage } from "@/pages/WorkflowsPage";
import { CapabilitiesPage } from "@/pages/CapabilitiesPage";
import { TooltipProvider } from "@/components/ui/tooltip";

interface ErrorBoundaryProps { children: ReactNode; location: string }

class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean; error: Error | null }> {
  override state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  // In-app escape from a tripped boundary: this one wraps the public routes
  // (RouteErrorBoundary only covers the signed-in shells), and its fallback
  // replaces <Routes>, so without a reset no navigation could ever clear it
  // and "Reload page" was the only exit. Reset on the location PROP, not via
  // key={pathname}: a key would remount AuthProvider on every navigation.
  override componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.location !== this.props.location) {
      this.setState({ hasError: false, error: null });
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-lg font-semibold text-foreground">Something went wrong</h1>
            <p className="mb-4 text-sm text-muted-foreground">{this.state.error?.message}</p>
            <div className="flex items-center justify-center gap-3">
              <button
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
                onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              >
                Reload page
              </button>
              <Link
                to="/dashboard"
                className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
              >
                Go to dashboard
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Catch-all for a URL no route matches.
 *
 * VISUAL QA M4 #12: there was no `path="*"`, so an unknown URL (`/projects`,
 * whose real route is `/list`) painted a completely blank page whose only
 * trace was a `No routes matched location` warning in the console — a reader
 * who mistypes or follows an old link gets nothing at all, not even the shell.
 * Deliberately outside `ProtectedRoute`: a wrong URL is not a reason to bounce
 * someone to the login screen, and a signed-out visitor should see the same
 * explanation.
 */
function NotFoundPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <LogoMark className="mx-auto mb-4 h-10 w-10" />
        <p className="section-label mb-1">404</p>
        <h1 className="mb-2 text-lg font-semibold text-foreground">This page does not exist</h1>
        <p className="mb-1 text-sm text-muted-foreground">
          Nothing is served at{" "}
          <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            {pathname}
          </code>
          .
        </p>
        <p className="mb-5 text-sm text-muted-foreground">
          The link may be out of date, or the project may have been removed.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild size="sm">
            <Link to="/list">
              <Compass className="mr-1.5 h-3.5 w-3.5" />
              Your projects
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            Go back
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/help">Help &amp; FAQ</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuthenticatedLayout({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Shell-wide hotkeys, mirroring the project layout: ↑ / ↓ cycle the sidebar
  // pages, 1..5 jump, ? opens the keymap. Pages outside the nav (e.g. /import)
  // count as page 1 so ↑ / ↓ still land somewhere sensible. `/` stays bound
  // beside `?`: it is the key the app advertised until now, and dropping it
  // would break the habit of anyone who already learned it.
  const pagePaths = dashboardNavItems.map((item) => item.to);
  const currentPage = Math.max(0, pagePaths.indexOf(pathname));
  const goToPage = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), pagePaths.length - 1);
    const target = pagePaths[clamped];
    if (!target || target === pathname) return;
    navigate(target);
  };
  useHotkeys({
    ArrowUp: () => goToPage(currentPage - 1),
    ArrowDown: () => goToPage(currentPage + 1),
    "/": () => setShortcutsOpen(true),
    "?": () => setShortcutsOpen(true),
    ...Object.fromEntries(pagePaths.map((_, i) => [String(i + 1), () => goToPage(i)])),
  });

  // The dashboard tour lives on DashboardPage (its anchors do too) — from any
  // other shell page the sidebar button first navigates there.
  const startTour = () => navigate("/dashboard", { state: { startTour: Date.now() } });

  return (
    <SidebarProvider>
      {/* `overflow-hidden`: the shell is exactly one viewport tall and <main>
          owns the scrolling — without this a tall page also scrolled the
          window, moving the fixed sidebar off-screen. */}
      {/* relative + overflow-hidden: absolutely-positioned strays (e.g. Radix
          Select's internal aria elements) must position against THIS clipped
          box, not the document. Unanchored, they extended the body below the
          viewport and scrollIntoView dragged the whole window into the void. */}
      <MainChromeProvider>
        <div className="relative flex h-screen overflow-hidden">
          <SkipToContent />
          <Sidebar onStartTour={startTour} onShowShortcuts={() => setShortcutsOpen(true)} />
          <MainRegion>
            {/* Bug #24: a render error in one shell page used to unmount the
                whole app via the top-level boundary. Scoped here, the sidebar
                survives and the user can navigate out without a reload. */}
            <RouteErrorBoundary scope="dashboard-shell">
              {/* Normally a layout route (Outlet); `children` is for /help, which
                  needs this same chrome from outside ProtectedRoute. */}
              {children ?? <Outlet />}
            </RouteErrorBoundary>
          </MainRegion>
        </div>
      </MainChromeProvider>
      <ShortcutsHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} context="dashboard" />
    </SidebarProvider>
  );
}

/**
 * /help is picked by session, not by route. A signed-in reader gets the usual
 * sidebar shell (nothing about /help changes for them); everyone else is sent
 * to /faq, which carries the same answers on the public shell without the tour
 * launcher and the project fetch, neither of which works without an account.
 *
 * The redirect rather than a bounce to /login: /help answers "what does this
 * thing send to an AI?", and hiding that behind a login hides it from exactly
 * the person asking. Waiting out `loading` first stops a signed-in reader who
 * deep-links here from being redirected before their session resolves.
 */
export function HelpRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <PageSpinner className="h-screen w-full bg-background" iconClassName="h-8 w-8" label="Checking your session" />
    );
  }

  if (user) {
    return (
      <AuthenticatedLayout>
        <HelpPage />
      </AuthenticatedLayout>
    );
  }

  return <Navigate to="/faq" replace />;
}

export default function App() {
  // Above <Routes> so one effect covers every route: the shells come and go, the
  // title and the focus reset must not.
  usePageChrome();
  const { pathname } = useLocation();

  return (
    <ErrorBoundary location={pathname}>
    <AuthProvider>
      <TooltipProvider>
        <Routes>
          <Route path="/" element={<IntroPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/help" element={<HelpRoute />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />

          {import.meta.env.DEV && <Route path="/dev/graph/:id" element={<GraphPage />} />}

          <Route element={<ProtectedRoute />}>
            <Route element={<AuthenticatedLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/github/oauth/callback" element={<GitHubOAuthCallbackPage />} />
              <Route path="/github/setup" element={<GitHubSetupPage />} />
              <Route path="/list" element={<ProjectListPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/invitations" element={<InvitationsPage />} />
              <Route path="/settings" element={<AccountSettingsPage />} />
            </Route>

            <Route path="/projects/:id" element={<ProjectLayout />}>
              <Route index element={<ProjectOverviewPage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
              <Route path="architecture" element={<ArchitecturePage />} />
              <Route path="dependencies" element={<GraphPage />} />
              <Route path="workflows" element={<WorkflowsPage />} />
              <Route path="capabilities" element={<CapabilitiesPage />} />
              <Route path="tutorials" element={<WalkthroughTab />} />
              {/* The tab has always been labelled "Tutorials"; the path said
                  "walkthrough". Both resolve so links shared before the
                  rename keep working. */}
              <Route path="walkthrough" element={<WalkthroughTab />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="settings" element={<ProjectSettingsPage />} />
            </Route>
          </Route>

          {/* Last, so it only matches what nothing above did. */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </TooltipProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
