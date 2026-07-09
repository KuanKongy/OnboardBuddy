import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderGit2,
  Loader2,
  Mail,
  Plus,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ProjectCard, type Project } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useProjects } from "@/lib/useProjects";

const RECENT_LIMIT = 6;
const ACTIVITY_LIMIT = 8;

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
          tone: "text-amber-400",
        };
      if (p.status === "complete")
        return { ...base, text: "Analysis completed", icon: CheckCircle2, tone: "text-emerald-400" };
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

  useEffect(() => {
    apiFetch("/invitations")
      .then((data: { invitations: unknown[] }) => setInviteCount(data.invitations.length))
      .catch(() => setInviteCount(0));
  }, []);

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
      <div className="mb-0.5 text-xs text-muted-foreground">Overview &gt; Dashboard</div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            All your connected repositories and their analysis status in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button size="sm" asChild>
            <Link to="/import">
              <Plus className="h-3.5 w-3.5" />
              Add Project
            </Link>
          </Button>
        </div>
      </div>

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

      {!loading && !error && projects.length === 0 && (
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
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={FolderGit2} label="Projects" value={stats.total} tone="text-foreground" />
            <StatCard icon={Loader2} label="Analyzing" value={stats.analyzing} tone="text-primary" />
            <StatCard icon={AlertTriangle} label="Need review" value={stats.stale} tone="text-amber-400" />
            <StatCard icon={Mail} label="Pending invites" value={inviteCount} tone="text-foreground" />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Recent projects</h2>
                <Link to="/list" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </div>
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
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-foreground">Recent activity</h2>
              <Card>
                <CardContent className="p-2">
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
                              <p className="truncate text-[12px] text-foreground">{item.repo}</p>
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
    </div>
  );
}
