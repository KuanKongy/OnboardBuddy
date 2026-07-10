import {
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
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { ProjectProvider, useProject } from "@/contexts/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountCard } from "@/components/AccountCard";
import { BackLink } from "@/components/BackLink";
import { SidebarProvider, SidebarShell, SidebarToggle, useSidebar } from "@/components/SidebarShell";
import { ThemeToggle } from "@/components/ThemeToggle";

const projectNavItems = [
  {
    to: "",
    label: "Project Overview",
    icon: LayoutDashboard,
    end: true,
    description: "Health and analysis summary for this repository.",
  },
  {
    to: "onboarding",
    label: "Your Onboarding",
    icon: BookOpen,
    end: false,
    description: "Your role-based reading path through this codebase.",
  },
  {
    to: "architecture",
    label: "Architecture",
    icon: Map,
    end: false,
    description: "A high-level map of the codebase's structure and layers.",
  },
  {
    to: "dependencies",
    label: "Dependencies",
    icon: Network,
    end: false,
    description: "Which files and modules depend on which — a map for orienting yourself.",
  },
  {
    to: "walkthrough",
    label: "Walkthrough",
    icon: Route,
    end: false,
    description: "A guided step-by-step tour through a real code path.",
  },
  {
    to: "team",
    label: "Team",
    icon: Users,
    end: false,
    description: "Who has access to this project and their permissions.",
  },
  {
    to: "settings",
    label: "Settings",
    icon: Settings,
    end: false,
    description: "Analysis and privacy settings for this project.",
  },
];

function ProjectSidebar() {
  const { project, loading } = useProject();
  const { id } = useParams<{ id: string }>();
  const { setOpen } = useSidebar();
  const { pathname } = useLocation();

  return (
    <SidebarShell>
      <div className="px-3 py-3">
        <BackLink className="mb-2" onClick={() => setOpen(false)} />
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : project ? (
          <div>
            <h2 className="truncate text-sm font-semibold text-foreground" title={project.repo_name}>
              {project.repo_name}
            </h2>
            <Badge variant="outline" className="mt-1 gap-1 text-xs">
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
          const to = `/projects/${id}/${item.to}`;
          // Radix TooltipTrigger's Slot string-joins className, which would
          // stringify NavLink's function form — compute the active state here
          // and pass a plain string instead.
          const isActive = item.end
            ? pathname.replace(/\/$/, "") === to.replace(/\/$/, "")
            : pathname.startsWith(to);
          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">{item.description}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <div className="px-2">
        <Separator />
      </div>
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="min-w-0 flex-1">
          <AccountCard />
        </div>
        <ThemeToggle />
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
