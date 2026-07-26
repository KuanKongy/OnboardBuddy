import { Component, useState, type ReactNode } from "react";
import { Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Sidebar, dashboardNavItems } from "@/components/Sidebar";
import { SidebarProvider } from "@/components/SidebarShell";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { useHotkeys } from "@/hooks/useHotkeys";
import { ProjectLayout } from "@/components/ProjectLayout";
import { AuthProvider } from "@/contexts/AuthContext";
import { AccountSettingsPage } from "@/pages/AccountSettingsPage";
import { ArchitecturePage } from "@/pages/ArchitecturePage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { GraphPage } from "@/pages/GraphPage";
import { GitHubSetupPage } from "@/pages/GitHubSetupPage";
import { GitHubOAuthCallbackPage } from "@/pages/GitHubOAuthCallbackPage";
import { HelpPage } from "@/pages/HelpPage";
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

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  override state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-lg font-semibold text-foreground">Something went wrong</h1>
            <p className="mb-4 text-sm text-muted-foreground">{this.state.error?.message}</p>
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Shell-wide hotkeys, mirroring the project layout: [ / ] cycle the sidebar
  // pages, 1..4 jump, ? opens the keymap. Pages outside the nav (e.g. /import)
  // count as page 1 so [ / ] still land somewhere sensible.
  const pagePaths = dashboardNavItems.map((item) => item.to);
  const currentPage = Math.max(0, pagePaths.indexOf(pathname));
  const goToPage = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), pagePaths.length - 1);
    const target = pagePaths[clamped];
    if (!target || target === pathname) return;
    navigate(target);
  };
  useHotkeys({
    "[": () => goToPage(currentPage - 1),
    "]": () => goToPage(currentPage + 1),
    "?": () => setShortcutsOpen(true),
    ...Object.fromEntries(pagePaths.map((_, i) => [String(i + 1), () => goToPage(i)])),
  });

  // The dashboard tour lives on DashboardPage (its anchors do too) — from any
  // other shell page the sidebar button first navigates there.
  const startTour = () => navigate("/dashboard", { state: { startTour: Date.now() } });

  return (
    <SidebarProvider>
      <div className="flex h-screen">
        <Sidebar onStartTour={startTour} onShowShortcuts={() => setShortcutsOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-background p-3 sm:p-4 lg:p-5">
          <Outlet />
        </main>
      </div>
      <ShortcutsHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} context="dashboard" />
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <TooltipProvider>
        <Routes>
          <Route path="/" element={<IntroPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

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
              <Route path="/help" element={<HelpPage />} />
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
        </Routes>
      </TooltipProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
