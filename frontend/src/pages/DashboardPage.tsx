import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderGit2,
  HelpCircle,
  Loader2,
  Mail,
  Plus,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppTour, type TourStep } from "@/components/AppTour";
import { PageHeader } from "@/components/PageHeader";
import { ProjectCard, type Project } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useProjects } from "@/lib/useProjects";

const RECENT_LIMIT = 6;
const ACTIVITY_LIMIT = 8;

const TOUR_DISMISSED_KEY = "onboardbuddy:tour-dismissed";

function readTourDismissed(): boolean {
  try {
    return localStorage.getItem(TOUR_DISMISSED_KEY) === "1";
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — never
    // auto-start in that case rather than crash or loop.
    return true;
  }
}

function persistTourDismissed(): void {
  try {
    localStorage.setItem(TOUR_DISMISSED_KEY, "1");
  } catch {
    // Best-effort only; nothing to fall back to.
  }
}

function clearTourDismissed(): void {
  try {
    localStorage.removeItem(TOUR_DISMISSED_KEY);
  } catch {
    // Best-effort only.
  }
}

const TOUR_STEPS: TourStep[] = [
  {
    target: "sidebar-nav",
    title: "Get around",
    body: "Use the sidebar to jump between your dashboard, the full project list, pending invitations, and account settings.",
  },
  {
    target: "stats-row",
    title: "Your stats at a glance",
    body: "These counts track how many projects you have, which ones are still analyzing, and which need a review because their docs went stale.",
  },
  {
    target: "projects-grid",
    title: "Your projects",
    body: "Each card is a repository OnboardBuddy has analyzed. Click one to open its onboarding package — README, dependency graph, and walkthrough.",
  },
  {
    target: "import-repo",
    title: "Bring in a repository",
    body: "Connect a GitHub repo here any time to kick off a fresh analysis and generate its onboarding package.",
  },
  {
    target: "recent-activity",
    title: "What's changed recently",
    body: "A quick feed of analysis runs and stale-doc alerts across your projects, so you know what needs attention first.",
  },
];

/** Sort key: most recent activity first, projects never analyzed last. */
function activityTime(p: Project): number {
  return p.last_analyzed_at ? new Date(p.last_analyzed_at).getTime() : 0;
}

type ActivityItem = {
  id: string;
  projectId: string;
  repo: string;
  text: string;
  at: string | null;
  icon: typeof Activity;
  tone: string;
};

/** Derive an activity feed from project state (no dedicated activity endpoint yet). */
function buildActivity(projects: Project[]): ActivityItem[] {
  return [...projects]
    .sort((a, b) => activityTime(b) - activityTime(a))
    .map((p): ActivityItem => {
      const repo = `${p.repo_owner}/${p.repo_name}`;
      const base = { id: p.id, projectId: p.id, repo, at: p.last_analyzed_at };
      if (p.status === "failed")
        return { ...base, text: "Analysis failed", icon: XCircle, tone: "text-destructive" };
      if (p.status === "analyzing")
        return { ...base, text: "Analysis in progress", icon: Loader2, tone: "text-primary" };
      if (p.stale_count > 0)
        return {
          ...base,
          text: `${p.stale_count} section${p.stale_count === 1 ? "" : "s"} need review`,
          icon: AlertTriangle,
          tone: "text-amber-600 dark:text-amber-400",
        };
      if (p.status === "complete")
        return { ...base, text: "Analysis completed", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" };
      return { ...base, text: "Created — not analyzed yet", icon: Clock, tone: "text-muted-foreground" };
    })
    .slice(0, ACTIVITY_LIMIT);
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-muted ${tone}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-lg font-semibold leading-none text-foreground">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { projects, setProjects, loading, error } = useProjects();
  const [inviteCount, setInviteCount] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    apiFetch("/invitations")
      .then((data: { invitations: unknown[] }) => setInviteCount(data.invitations.length))
      .catch(() => setInviteCount(0));
  }, []);

  // First-run tour: auto-start once the dashboard has finished its initial
  // load (never spotlight loading skeletons) and the user hasn't seen it yet.
  useEffect(() => {
    if (loading) return;
    if (readTourDismissed()) return;
    setTourOpen(true);
  }, [loading]);

  function finishTour() {
    persistTourDismissed();
    setTourOpen(false);
  }

  function startTour() {
    clearTourDismissed();
    setTourOpen(true);
  }

  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => activityTime(b) - activityTime(a)).slice(0, RECENT_LIMIT),
    [projects],
  );
  const activity = useMemo(() => buildActivity(projects), [projects]);

  const stats = useMemo(
    () => ({
      total: projects.length,
      analyzing: projects.filter((p) => p.status === "analyzing").length,
      stale: projects.filter((p) => p.stale_count > 0).length,
    }),
    [projects],
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="All your connected repositories and their analysis status in one place."
        actions={
          <>
            <Button variant="ghost" size="xs" onClick={startTour}>
              <HelpCircle className="h-3.5 w-3.5" />
              Take a tour
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/invitations">
                <Mail className="h-3.5 w-3.5" />
                Join Project
                {inviteCount > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                    {inviteCount}
                  </span>
                )}
              </Link>
            </Button>
            <Button size="sm" data-tour="import-repo" asChild>
              <Link to="/import">
                <Plus className="h-3.5 w-3.5" />
                Add Project
              </Link>
            </Button>
          </>
        }
      />

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </div>
      )}

      {/* The empty dashboard keeps the exact same frame as a populated one —
          stats at 0, an import CTA where the project grid goes — so nothing
          jumps when the first project arrives and the tour anchors exist
          from the very first visit. */}
      {!loading && !error && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="stats-row">
            <StatCard icon={FolderGit2} label="Projects" value={stats.total} tone="text-foreground" />
            <StatCard icon={Loader2} label="Analyzing" value={stats.analyzing} tone="text-primary" />
            {/* "Stale content" only matters when nonzero — otherwise show
                something informative instead of a permanent 0. */}
            {stats.stale > 0 ? (
              <StatCard icon={AlertTriangle} label="Stale content" value={stats.stale} tone="text-amber-600 dark:text-amber-400" />
            ) : (
              <StatCard icon={CheckCircle2} label="Up to date" value={stats.total - stats.analyzing} tone="text-emerald-600 dark:text-emerald-400" />
            )}
            <StatCard icon={Mail} label="Pending invites" value={inviteCount} tone="text-foreground" />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2" data-tour="projects-grid">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Recent projects</h2>
                <Link to="/list" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </div>
              {recentProjects.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-12 text-center">
                  <p className="text-sm text-foreground">No projects yet.</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Import a repository to get started.
                  </p>
                  <Button size="sm" className="mt-3" asChild>
                    <Link to="/import">
                      <Plus className="h-3.5 w-3.5" />
                      Import Repository
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {recentProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onDeleted={(id) =>
                        setProjects((prev) => prev.filter((p) => p.id !== id))
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            <div data-tour="recent-activity">
              <h2 className="mb-2 text-sm font-semibold text-foreground">Recent activity</h2>
              <Card>
                <CardContent className="p-2">
                  {activity.length === 0 && (
                    <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                      No activity yet — it appears once your first repository is imported and analyzed.
                    </p>
                  )}
                  <ul className="divide-y divide-border">
                    {activity.map((item) => {
                      const Icon = item.icon;
                      return (
                        <li key={item.id}>
                          <Link
                            to={`/projects/${item.projectId}`}
                            className="flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
                          >
                            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${item.tone}`} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] text-foreground" title={item.repo}>{item.repo}</p>
                              <p className="text-xs text-muted-foreground">{item.text}</p>
                            </div>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {timeAgo(item.at)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {tourOpen && <AppTour steps={TOUR_STEPS} onDone={finishTour} />}
    </div>
  );
}
