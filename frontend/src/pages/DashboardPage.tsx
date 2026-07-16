import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderGit2,
  Loader2,
  Mail,
  Package,
  Plus,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppTour, type TourStep } from "@/components/AppTour";
import { PageHeader } from "@/components/PageHeader";
import { ProjectCard, type Project } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { dismissTour, resetTour, tourDismissed } from "@/lib/tourState";
import { useProjects } from "@/lib/useProjects";

const RECENT_LIMIT = 6;


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
    body: "A live feed of every analysis run and generated package across your projects — what ran, on which branch, and when.",
  },
];

/** Sort key: most recent activity first, projects never analyzed last. */
function activityTime(p: Project): number {
  return p.last_analyzed_at ? new Date(p.last_analyzed_at).getTime() : 0;
}

/** One event from GET /projects/activity — an analysis run or a package. */
type ActivityItem = {
  kind: "analysis" | "package";
  id: string;
  project_id: string;
  repo_owner: string;
  repo_name: string;
  status: string;
  job_type?: string;
  role?: string | null;
  branch?: string | null;
  scope?: string | null;
  at: string | null;
};

/** Row text + icon for an activity event. */
function presentActivity(item: ActivityItem): { text: string; icon: typeof Activity; tone: string; spin: boolean } {
  const branch = item.branch ? ` · ${item.branch}` : "";
  const scope = item.scope && item.scope !== "Whole repository" ? ` · ${item.scope}` : "";
  const where = `${branch}${scope}`;

  if (item.kind === "package") {
    const role = item.role ? item.role[0]!.toUpperCase() + item.role.slice(1) : "";
    const what = role ? `${role} package` : "Package";
    if (item.status === "generating")
      return { text: `${what} generating${where}`, icon: Loader2, tone: "text-primary", spin: true };
    if (item.status === "failed")
      return { text: `${what} generation failed${where}`, icon: XCircle, tone: "text-destructive", spin: false };
    if (item.status === "stale")
      return { text: `${what} generated${where} — now stale`, icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400", spin: false };
    return { text: `${what} generated${where}`, icon: Package, tone: "text-emerald-600 dark:text-emerald-400", spin: false };
  }

  const what = item.job_type === "incremental_update" ? "Incremental update" : "Analysis";
  if (item.status === "queued")
    return { text: `${what} queued${where}`, icon: Clock, tone: "text-muted-foreground", spin: false };
  if (item.status === "running")
    return { text: `${what} running${where}`, icon: Loader2, tone: "text-primary", spin: true };
  if (item.status === "paused")
    return { text: `${what} paused${where}`, icon: Clock, tone: "text-amber-600 dark:text-amber-400", spin: false };
  if (item.status === "failed")
    return { text: `${what} failed${where}`, icon: XCircle, tone: "text-destructive", spin: false };
  return { text: `${what} completed${where}`, icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400", spin: false };
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
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [inviteCount, setInviteCount] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [pendingTour, setPendingTour] = useState(false);

  useEffect(() => {
    apiFetch("/invitations")
      .then((data: { invitations: unknown[] }) => setInviteCount(data.invitations.length))
      .catch(() => setInviteCount(0));
  }, []);

  // Real event feed (every run + package across projects), kept fresh while
  // the dashboard is open so in-progress runs tick over to completed.
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch("/projects/activity")
        .then((data: { activity: ActivityItem[] }) => {
          if (!cancelled) setActivity(data.activity);
        })
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // First-run tour: auto-start once the dashboard has finished its initial
  // load (never spotlight loading skeletons) and THIS account hasn't seen it.
  useEffect(() => {
    if (loading || !user) return;
    if (tourDismissed("dashboard", user.id)) return;
    setTourOpen(true);
  }, [loading, user]);

  // The sidebar's "Take a tour" navigates here with startTour state (it may be
  // clicked from any shell page). Consume the state immediately so refresh or
  // back never replays it, then wait for the data before spotlighting.
  useEffect(() => {
    const state = location.state as { startTour?: number } | null;
    if (!state?.startTour) return;
    setPendingTour(true);
    navigate("/dashboard", { replace: true, state: null });
  }, [location.state, navigate]);

  useEffect(() => {
    if (!pendingTour || loading) return;
    setPendingTour(false);
    startTour();
  });

  function finishTour() {
    if (user) dismissTour("dashboard", user.id);
    setTourOpen(false);
  }

  function startTour() {
    if (user) resetTour("dashboard", user.id);
    setTourOpen(true);
  }

  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => activityTime(b) - activityTime(a)).slice(0, RECENT_LIMIT),
    [projects],
  );

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
                  <ul className="max-h-[26rem] divide-y divide-border overflow-y-auto">
                    {activity.map((item) => {
                      const pres = presentActivity(item);
                      const Icon = pres.icon;
                      const repo = `${item.repo_owner}/${item.repo_name}`;
                      return (
                        <li key={`${item.kind}-${item.id}`}>
                          <Link
                            to={`/projects/${item.project_id}`}
                            className="flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
                          >
                            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${pres.tone} ${pres.spin ? "animate-spin" : ""}`} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] text-foreground" title={repo}>{repo}</p>
                              <p className="text-xs text-muted-foreground">{pres.text}</p>
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
