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
import { ImportPage } from "@/pages/ImportPage";
import { IntroPage } from "@/pages/IntroPage";
import { InvitationsPage } from "@/pages/InvitationsPage";
import { LoginPage } from "@/pages/LoginPage";
import { ProjectOverviewPage } from "@/pages/ProjectOverviewPage";
import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import { SignupPage } from "@/pages/SignupPage";
import { TeamPage } from "@/pages/TeamPage";
import { TooltipProvider } from "@/components/ui/tooltip";

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
    <AuthProvider>
      <TooltipProvider>
        <Routes>
          <Route path="/" element={<IntroPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AuthenticatedLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/invitations" element={<InvitationsPage />} />
              <Route path="/settings" element={<AccountSettingsPage />} />
            </Route>

            <Route path="/projects/:id" element={<ProjectLayout />}>
              <Route index element={<ProjectOverviewPage />} />
              <Route path="onboarding" element={<EmptyStubPage title="Your Onboarding" />} />
              <Route path="architecture" element={<EmptyStubPage title="Architecture" />} />
              <Route path="dependencies" element={<EmptyStubPage title="Dependencies" />} />
              <Route path="walkthrough" element={<EmptyStubPage title="Walkthrough" />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="settings" element={<ProjectSettingsPage />} />
            </Route>
          </Route>
        </Routes>
      </TooltipProvider>
    </AuthProvider>
  );
}
