import {
  BookOpen,
  Boxes,
  HelpCircle,
  Keyboard,
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
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { AppTour, type TourStep } from "@/components/AppTour";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectProvider, useProject } from "@/contexts/ProjectContext";
import { PackagesProvider, usePackages } from "@/contexts/PackagesContext";
import { PackageSelector } from "@/components/PackageSelector";
import { pipelineProgress } from "@/lib/pipelineProgress";
import { consumeTourRequest, dismissTour, tourDismissed } from "@/lib/tourState";
import { PageSpinner } from "@/components/ui/page-spinner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountCard } from "@/components/AccountCard";
import { LogoMark, LogoWordmark } from "@/components/BrandLogo";
import { SidebarProvider, SidebarShell, useSidebar } from "@/components/SidebarShell";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { SkipToContent } from "@/components/SkipToContent";
import { MAIN_REGION_ID } from "@/hooks/usePageChrome";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useHotkeys } from "@/hooks/useHotkeys";

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
    to: "capabilities",
    label: "Capabilities",
    icon: Boxes,
    end: false,
    description: "What the product does in business terms, and where to start reading for each part.",
  },
  {
    to: "workflows",
    label: "Workflows",
    icon: Zap,
    end: false,
    description: "Traced request flows from entry point to side effects.",
  },
  {
    // The route used to be `/walkthrough` while the label said "Tutorials",
    // so every link a reader copied said one thing and every tab said another.
    // The path now matches the label; `alias` keeps the old path routed and
    // keeps this item highlighted when someone follows an old link.
    to: "tutorials",
    alias: "walkthrough",
    label: "Tutorials",
    icon: Route,
    end: false,
    description: "Runnable procedures built from this repo: each step is a command or an edit, with what you should see and how to check it.",
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


/**
 * First-timer walkthrough of a project: what each tab is for and where the
 * important controls live. Anchors on the sidebar nav, so every step is
 * available regardless of which tab currently has data.
 */
const PROJECT_TOUR_STEPS: TourStep[] = [
  {
    target: "nav-overview",
    title: "Start at the overview",
    body: "Active runs, your packages across branches and commits, and the full run history with costs. The Analyze… button lets you pick a branch, commit, and scope — and preview cost before anything runs.",
  },
  {
    target: "package-selector",
    title: "Pick which package you're viewing",
    body: "Every tab follows this selection — branch, commit, scope, and role. A generation you start selects its new package automatically when it finishes.",
  },
  {
    target: "nav-onboarding",
    title: "Your onboarding",
    body: "Generated reading paths, one package per scope, role, and commit. Every claim carries receipts — click one to see the code it's based on.",
  },
  {
    target: "nav-onboarding",
    title: "When packages change",
    body: "Regenerating replaces a package's content in place; analyzing a new commit adds a new package and keeps the old one — nothing is silently discarded. Stale badges appear only on sections whose code actually changed. The 'How packages work' tour inside Your Onboarding has the full rules.",
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
    target: "nav-capabilities",
    title: "Capability map",
    body: "What the product does in business terms — each capability links to the workflows, tutorials, and code that deliver it, with a 'start here' pointer.",
  },
  {
    target: "nav-workflows",
    title: "Traced workflows",
    body: "Real request flows traced from entry points to side effects — the fastest way to see how a feature actually executes.",
  },
  {
    target: "nav-tutorials",
    title: "Tutorials",
    body: "Procedures you run against this repo, not essays about it: every step is a command or an edit, with the result you should see and a way to check it. Built only where the evidence supports one.",
  },
  {
    target: "nav-team",
    title: "Team",
    body: "Who has access and their roles. Onboarding content is tailored per role.",
  },
  {
    target: "nav-settings",
    title: "Settings",
    body: "Privacy mode (what, if anything, is sent to AI), analysis depth, budgets, your own API key, and per-role ranking weights. AI & privacy changes apply to the next generation immediately — no re-analysis needed; AI-disabled still produces deterministic packages.",
  },
];

function ProjectSidebar({ onStartTour, onShowShortcuts }: { onStartTour: () => void; onShowShortcuts: () => void }) {
  const { project, loading } = useProject();
  const { activeJobs } = usePackages();
  const { id } = useParams<{ id: string }>();
  const { setOpen } = useSidebar();
  const { pathname } = useLocation();

  return (
    <SidebarShell>
      <div className="px-3 py-3">
        <div className="flex items-center justify-between">
          <Link
            to="/dashboard"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-80"
          >
            <LogoMark className="h-7 w-7" />
            <LogoWordmark />
          </Link>
          <ThemeToggle />
        </div>
        {loading ? (
          <div className="mt-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </div>
        ) : project ? (
          // Owner feedback M2: the repo name and the branch badge that used to
          // sit here are both already stated by the package chooser below
          // (`branch@commit · scope · role`) and by the Overview header, where
          // the repo name is now a real link to GitHub (M1). Two restatements
          // of the same two strings, one of them carrying a tooltip that only
          // repeated the label it was attached to (H1), were redundant chrome.
          <div>
            {activeJobs.length > 0 && (() => {
              const job = activeJobs[0]!;
              const progress = pipelineProgress(job);
              return (
                <Link
                  to={`/projects/${id}`}
                  onClick={() => setOpen(false)}
                  className={`mt-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                    job.stalled
                      ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  <span className="min-w-0 flex-1 truncate">
                    {job.stalled ? "run stalled" : progress.stageLabel ?? "Working…"}
                  </span>
                  {!job.stalled && <span className="shrink-0 tabular-nums">{progress.pct}%</span>}
                </Link>
              );
            })()}
            <PackageSelector />
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
            : pathname.startsWith(to) ||
              ("alias" in item && typeof item.alias === "string"
                ? pathname.startsWith(`/projects/${id}/${item.alias}`)
                : false);
          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  data-tour={`nav-${item.to || "overview"}`}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors ${
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
          type="button"
          onClick={onStartTour}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          Take a tour
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onShowShortcuts}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <Keyboard className="h-3.5 w-3.5" />
              Keyboard shortcuts
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Also opens with /</TooltipContent>
        </Tooltip>
      </div>
      <div className="px-2 py-2">
        <AccountCard />
      </div>
    </SidebarShell>
  );
}

function ProjectLayoutContent() {
  const { loading, error } = useProject();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [tourOpen, setTourOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Project-wide hotkeys: ↑ / ↓ cycle tabs, 1..9 jump, / opens the keymap.
  // Per-page arrows/Esc live in the pages themselves (hooks/useHotkeys.ts).
  const tabPaths = projectNavItems.map((item) => item.to);
  const currentSegment = pathname.replace(/\/+$/, "").split(`/projects/${id}`)[1]?.replace(/^\//, "").split("/")[0] ?? "";
  const currentTab = Math.max(0, tabPaths.indexOf(currentSegment));
  const goToTab = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), tabPaths.length - 1);
    if (clamped === currentTab) return;
    navigate(`/projects/${id}/${tabPaths[clamped]}`);
  };
  useHotkeys({
    ArrowUp: () => goToTab(currentTab - 1),
    ArrowDown: () => goToTab(currentTab + 1),
    "/": () => setShortcutsOpen(true),
    ...Object.fromEntries(tabPaths.slice(0, 9).map((_, i) => [String(i + 1), () => goToTab(i)])),
  });

  // First visit to any project: walk through what each tab is for. Waits for
  // the project to load so the tour never spotlights a spinner.
  useEffect(() => {
    if (loading || error || !user) return;
    if (consumeTourRequest("project")) { setTourOpen(true); return; }
    if (tourDismissed("project", user.id)) return;
    setTourOpen(true);
  }, [loading, error, user]);

  function handleTourDone() {
    setTourOpen(false);
    if (user) dismissTour("project", user.id);
  }

  if (error) {
    return (
      <div className="flex h-screen">
        <SkipToContent />
        <ProjectSidebar onStartTour={() => setTourOpen(true)} onShowShortcuts={() => setShortcutsOpen(true)} />
        <main
          id={MAIN_REGION_ID}
          tabIndex={-1}
          className="flex flex-1 items-center justify-center bg-background p-4 outline-none"
        >
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
    // `relative overflow-hidden`: the shell is exactly one viewport tall and
    // <main> owns the scrolling — without this a tall tab also scrolled the
    // window, moving the fixed sidebar off-screen. `relative` anchors
    // absolutely-positioned strays (e.g. Radix Select's internal aria
    // elements) to THIS clipped box; unanchored, they extended the body below
    // the viewport and scrollIntoView dragged the whole window into the void.
    <div className="relative flex h-screen overflow-hidden">
      <SkipToContent />
      <ProjectSidebar onStartTour={() => setTourOpen(true)} onShowShortcuts={() => setShortcutsOpen(true)} />
      {/* `outline-none`: usePageChrome focuses this on every tab change, and a
          ring around the whole tab would be a new visual on navigation. */}
      <main
        id={MAIN_REGION_ID}
        tabIndex={-1}
        className="flex-1 overflow-y-auto bg-background p-3 outline-none sm:p-4 lg:p-5"
      >
        {loading ? (
          <PageSpinner className="py-16" label="Loading this project" />
        ) : (
          // Bug #24: the feature tabs are the pages that render analysis
          // payloads, so they are where a malformed payload throws. Scoped
          // here, one broken tab leaves the project sidebar, the tab strip
          // and the package selector working — the user switches tab instead
          // of losing the whole app to a full-screen reload prompt.
          <RouteErrorBoundary
            scope="project-tab"
            homeTo={`/projects/${id}`}
            homeLabel="Back to project overview"
          >
            <Outlet />
          </RouteErrorBoundary>
        )}
      </main>
      {tourOpen && <AppTour steps={PROJECT_TOUR_STEPS} onDone={handleTourDone} />}
      <ShortcutsHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

export function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;

  return (
    <ProjectProvider projectId={id}>
      <PackagesProvider projectId={id}>
        <SidebarProvider>
          <ProjectLayoutContent />
        </SidebarProvider>
      </PackagesProvider>
    </ProjectProvider>
  );
}
