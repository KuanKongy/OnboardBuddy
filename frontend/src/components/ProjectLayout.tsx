import {
  ArrowLeft,
  BookOpen,
  GitBranch,
  LayoutDashboard,
  Loader2,
  Map,
  Network,
  Route,
  Settings,
  Users,
} from "lucide-react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectProvider, useProject } from "@/contexts/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarShell, SidebarToggle, useSidebar } from "@/components/SidebarShell";

const projectNavItems = [
  { to: "", label: "Project Overview", icon: LayoutDashboard, end: true },
  { to: "onboarding", label: "Your Onboarding", icon: BookOpen, end: false },
  { to: "architecture", label: "Architecture", icon: Map, end: false },
  { to: "dependencies", label: "Dependencies", icon: Network, end: false },
  { to: "walkthrough", label: "Walkthrough", icon: Route, end: false },
  { to: "team", label: "Team", icon: Users, end: false },
];

function ProjectSidebar() {
  const { project, loading } = useProject();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const { setOpen } = useSidebar();

  return (
    <SidebarShell>
      <div className="px-3 py-3">
        <Button variant="ghost" size="xs" className="mb-2 gap-1.5 text-muted-foreground" asChild>
          <Link to="/dashboard" onClick={() => setOpen(false)}>
            <ArrowLeft className="h-3 w-3" />
            Back
          </Link>
        </Button>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : project ? (
          <div>
            <h2 className="truncate text-sm font-semibold text-foreground">
              {project.repo_name}
            </h2>
            <Badge variant="outline" className="mt-1 gap-1 text-[11px]">
              <GitBranch className="h-2.5 w-2.5" />
              {project.branch}
            </Badge>
          </div>
        ) : null}
      </div>

      <Separator />

      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {projectNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={`/projects/${id}/${item.to}`}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <Separator />

      <div className="px-2 py-2">
        <NavLink
          to={`/projects/${id}/settings`}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`
          }
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </NavLink>
      </div>

      <Separator />

      <div className="px-3 py-2">
        <div className="truncate text-[11px] text-muted-foreground">
          {user?.email}
        </div>
      </div>
    </SidebarShell>
  );
}

function ProjectLayoutContent() {
  const { loading, error } = useProject();

  if (error) {
    return (
      <div className="flex h-screen">
        <ProjectSidebar />
        <main className="flex flex-1 items-center justify-center bg-background p-4">
          <div className="text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <Link to="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <ProjectSidebar />
      <main className="flex-1 overflow-y-auto bg-background p-3 sm:p-4 lg:p-5">
        <div className="mb-2 lg:hidden">
          <SidebarToggle />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

export function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;

  return (
    <ProjectProvider projectId={id}>
      <SidebarProvider>
        <ProjectLayoutContent />
      </SidebarProvider>
    </ProjectProvider>
  );
}
