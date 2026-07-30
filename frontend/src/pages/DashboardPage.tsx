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
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppTour, type TourStep } from "@/components/AppTour";
import { PageHeader } from "@/components/PageHeader";
import { ProjectCard, type Project } from "@/components/ProjectCard";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageSpinner } from "@/components/ui/page-spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { consumeTourRequest, dismissTour, resetTour, tourDismissed } from "@/lib/tourState";
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
export function activityTime(p: Project): number {
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
      return { text: `${what} generated${where} — now stale`, icon: AlertTriangle, tone: "text-warning", spin: false };
    return { text: `${what} generated${where}`, icon: Package, tone: "text-success", spin: false };
  }

  const what = item.job_type === "incremental_update" ? "Incremental update" : "Analysis";
  if (item.status === "queued")
    return { text: `${what} queued${where}`, icon: Clock, tone: "text-muted-foreground", spin: false };
  if (item.status === "running")
    return { text: `${what} running${where}`, icon: Loader2, tone: "text-primary", spin: true };
  if (item.status === "paused")
    return { text: `${what} paused${where}`, icon: Clock, tone: "text-warning", spin: false };
  if (item.status === "failed")
    return { text: `${what} failed${where}`, icon: XCircle, tone: "text-destructive", spin: false };
  return { text: `${what} completed${where}`, icon: CheckCircle2, tone: "text-success", spin: false };
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  spin = false,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  tone: string;
  /** Only ever true when the count is non-zero: a spinner over "0" claims work
      that is not happening. */
  spin?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-muted ${tone}`}>
          <Icon className={`h-4 w-4 ${spin ? "animate-spin" : ""}`} />
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
  const [inviteCount, setInviteCount] = useState<number | null>(null);
  const [inviteCountError, setInviteCountError] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [pendingTour, setPendingTour] = useState(false);

  useEffect(() => {
    apiFetch("/invitations")
      .then((data: { invitations: unknown[] }) => {
        setInviteCount(data.invitations.length);
        setInviteCountError(false);
      })
      .catch(() => setInviteCountError(true));
  }, []);

  // Real event feed (every run + package across projects), kept fresh while
  // the dashboard is open so in-progress runs tick over to completed.
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  // Bug #68: a rejected fetch left `activity` at `[]` and the feed said "No
  // activity yet — it appears once your first repository is imported and
  // analyzed", telling an established user their whole history was empty.
  // The empty copy now requires a load that actually succeeded
  // (`activityLoaded`); a failed refresh of an already-populated feed leaves
  // what is on screen alone rather than replacing it with a banner.
  const [activityError, setActivityError] = useState(false);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const loadActivity = useCallback(
    (signal?: { cancelled: boolean }) =>
      apiFetch("/projects/activity")
        .then((data: { activity: ActivityItem[] }) => {
          if (signal?.cancelled) return;
          setActivity(data.activity);
          setActivityError(false);
          setActivityLoaded(true);
        })
        .catch(() => {
          if (!signal?.cancelled) setActivityError(true);
        }),
    [],
  );
  useEffect(() => {
    const signal = { cancelled: false };
    void loadActivity(signal);
    const timer = window.setInterval(() => void loadActivity(signal), 30_000);
    return () => {
      signal.cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadActivity]);

  // First-run tour: auto-start once the dashboard has finished its initial
  // load (never spotlight loading skeletons) and THIS account hasn't seen it.
  useEffect(() => {
    if (loading || !user) return;
    if (consumeTourRequest("dashboard")) { setTourOpen(true); return; }
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

  function finishTour() {
    if (user) dismissTour("dashboard", user.id);
    setTourOpen(false);
  }

  // Memoized so the effect below can name it as a dependency.
  const startTour = useCallback(() => {
    if (user) resetTour("dashboard", user.id);
    setTourOpen(true);
  }, [user]);

  useEffect(() => {
    if (!pendingTour || loading) return;
    setPendingTour(false);
    startTour();
  }, [pendingTour, loading, startTour]);

  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => activityTime(b) - activityTime(a)).slice(0, RECENT_LIMIT),
    [projects],
  );

  const stats = useMemo(
    () => ({
      total: projects.length,
      analyzing: projects.filter((p) => p.status === "analyzing").length,
      complete: projects.filter((p) => p.status === "complete").length,
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
                Invitations
                {inviteCount !== null && inviteCount > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-semibold text-primary-foreground">
                    {inviteCount}
                  </span>
                )}
              </Link>
            </Button>
            <Button size="sm" data-tour="import-repo" asChild>
              <Link to="/import">
                <Plus className="h-3.5 w-3.5" />
                Import repository
              </Link>
            </Button>
          </>
        }
      />

      {loading && (
        <PageSpinner className="py-16" label="Loading your dashboard" />
      )}

      {error && (
        <ErrorBanner className="text-[0.8125rem]">{error}</ErrorBanner>
      )}

      {/* The empty dashboard keeps the exact same frame as a populated one —
          stats at 0, an import CTA where the project grid goes — so nothing
          jumps when the first project arrives and the tour anchors exist
          from the very first visit. */}
      {!loading && !error && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="stats-row">
            <StatCard icon={FolderGit2} label="Projects" value={stats.total} tone="text-foreground" />
            <StatCard icon={Loader2} label="Analyzing" value={stats.analyzing} tone="text-primary" spin={stats.analyzing > 0} />
            {/* "Stale content" only matters when nonzero — otherwise show
                something informative instead of a permanent 0. */}
            {stats.stale > 0 ? (
              <StatCard icon={AlertTriangle} label="Stale content" value={stats.stale} tone="text-warning" />
            ) : (
              <StatCard icon={CheckCircle2} label="Up to date" value={stats.complete} tone="text-success" />
            )}
            {inviteCountError ? (
              <Card>
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold leading-none text-muted-foreground">—</div>
                    <div className="mt-1 text-xs text-muted-foreground">Pending invitations unavailable</div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <StatCard icon={Mail} label="Pending invitations" value={inviteCount ?? 0} tone="text-foreground" />
            )}
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
                      Import repository
                    </Link>
                  </Button>
                </div>
              ) : (
                <div
                  // Track count follows the available width, so cards keep an 18rem
                  // measure at every window size rather than only at sm/xl.
                  className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3"
                >
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
                  {activity.length === 0 && activityError && (
                    <div className="px-2 py-8 text-center" role="alert">
                      <AlertTriangle className="mx-auto mb-2 h-4 w-4 text-danger" />
                      <p className="text-xs text-muted-foreground">
                        Couldn't load recent activity. This is a failed request, not an empty history.
                      </p>
                      <Button
                        size="xs"
                        variant="outline"
                        className="mt-2 gap-1.5"
                        onClick={() => void loadActivity()}
                      >
                        <RefreshCw className="h-3 w-3" /> Retry
                      </Button>
                    </div>
                  )}
                  {activity.length === 0 && !activityError && activityLoaded && (
                    <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                      No activity yet — it appears once your first repository is imported and analyzed.
                    </p>
                  )}
                  {activity.length === 0 && !activityError && !activityLoaded && (
                    <PageSpinner className="px-2 py-8" iconClassName="h-4 w-4 text-muted-foreground" label="Loading recent activity" />
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
                              <p className="truncate text-[0.8125rem] text-foreground" title={repo}>{repo}</p>
                              <p className="text-xs text-muted-foreground">{pres.text}</p>
                            </div>
                            <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
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
