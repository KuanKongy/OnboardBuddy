import { Component, type ReactNode } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider, SidebarToggle } from "@/components/SidebarShell";
import { ProjectLayout } from "@/components/ProjectLayout";
import { AuthProvider } from "@/contexts/AuthContext";
import { AccountSettingsPage } from "@/pages/AccountSettingsPage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { EmptyStubPage } from "@/pages/EmptyStubPage";
import { GraphPage } from "@/pages/GraphPage";
import { GitHubSetupPage } from "@/pages/GitHubSetupPage";
import { GitHubOAuthCallbackPage } from "@/pages/GitHubOAuthCallbackPage";
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
  return (
    <SidebarProvider>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-background p-3 sm:p-4 lg:p-5">
          <div className="mb-2 lg:hidden">
            <SidebarToggle />
          </div>
          <Outlet />
        </main>
      </div>
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
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          <Route path="/dev/graph/:id" element={<GraphPage />} />

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
              <Route path="architecture" element={<EmptyStubPage title="Architecture" />} />
              <Route path="dependencies" element={<GraphPage />} />
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
