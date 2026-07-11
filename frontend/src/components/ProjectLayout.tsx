import {
  BookOpen,
  Boxes,
  GitBranch,
  HelpCircle,
  LayoutDashboard,
  Loader2,
  Map,
  Network,
  Route,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { AppTour, type TourStep } from "@/components/AppTour";
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
    to: "workflows",
    label: "Workflows",
    icon: Zap,
    end: false,
    description: "Traced request flows from entry point to side effects.",
  },
  {
    to: "capabilities",
    label: "Capabilities",
    icon: Boxes,
    end: false,
    description: "What the product does in business terms, and which code delivers it.",
  },
  {
    to: "walkthrough",
    label: "Tutorials",
    icon: Route,
    end: false,
    description: "Step-by-step code walkthroughs of real flows, with snippets and explanations.",
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

const PROJECT_TOUR_DISMISSED_KEY = "onboardbuddy:project-tour-dismissed";

function readProjectTourDismissed(): boolean {
  try {
    return localStorage.getItem(PROJECT_TOUR_DISMISSED_KEY) === "1";
  } catch {
    // localStorage unavailable — never auto-run so it can't loop every visit.
    return true;
  }
}

/**
 * First-timer walkthrough of a project: what each tab is for and where the
 * important controls live. Anchors on the sidebar nav, so every step is
 * available regardless of which tab currently has data.
 */
const PROJECT_TOUR_STEPS: TourStep[] = [
  {
    target: "nav-overview",
    title: "Start at the overview",
    body: "Analysis status, live pipeline metrics, and what changed. The Analyze… button here lets you pick a scope and preview cost before anything runs.",
  },
  {
    target: "nav-onboarding",
    title: "Your onboarding",
    body: "Generated reading paths, one package per scope, role, and commit. Every claim carries receipts — click one to see the code it's based on.",
  },
  {
    target: "nav-architecture",
    title: "Architecture map",
    body: "How the codebase groups into layers. Click a component for its summary, its files, and how critical it is.",
  },
  {
    target: "nav-dependencies",
    title: "Dependency graph",
    body: "Which files depend on which. Select a node to get the standard symbol doc: summary, signature, and a real usage example from a call site.",
  },
  {
    target: "nav-workflows",
    title: "Traced workflows",
    body: "Real request flows traced from entry points to side effects — the fastest way to see how a feature actually executes.",
  },
  {
    target: "nav-capabilities",
    title: "Capability map",
    body: "What the product does in business terms, connected to the workflows and components that deliver it.",
  },
  {
    target: "nav-walkthrough",
    title: "Tutorials",
    body: "Step-by-step walkthroughs of real flows: the actual code at each step with an explanation. No slides, no invented examples.",
  },
  {
    target: "nav-team",
    title: "Team",
    body: "Who has access and their roles. Onboarding content is tailored per role.",
  },
  {
    target: "nav-settings",
    title: "Settings",
    body: "Privacy mode (what, if anything, is sent to AI), analysis depth, budgets, your own API key, and per-role ranking weights.",
  },
];

function ProjectSidebar({ onStartTour }: { onStartTour: () => void }) {
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
                  data-tour={`nav-${item.to || "overview"}`}
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
      <div className="px-2 pt-1.5">
        <button
          onClick={onStartTour}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          Take a tour
        </button>
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
  const [tourOpen, setTourOpen] = useState(false);

  // First visit to any project: walk through what each tab is for. Waits for
  // the project to load so the tour never spotlights a spinner.
  useEffect(() => {
    if (loading || error) return;
    if (readProjectTourDismissed()) return;
    setTourOpen(true);
  }, [loading, error]);

  function dismissTour() {
    setTourOpen(false);
    try {
      localStorage.setItem(PROJECT_TOUR_DISMISSED_KEY, "1");
    } catch { /* storage unavailable */ }
  }

  if (error) {
    return (
      <div className="flex h-screen">
        <ProjectSidebar onStartTour={() => setTourOpen(true)} />
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
      <ProjectSidebar onStartTour={() => setTourOpen(true)} />
      <main className="flex-1 overflow-y-auto bg-background p-3 sm:p-4 lg:p-5">
        <div className="mb-2">
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
      {tourOpen && <AppTour steps={PROJECT_TOUR_STEPS} onDone={dismissTour} />}
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
