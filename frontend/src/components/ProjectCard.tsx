import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  MoreVertical,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { pipelineProgress, type PipelineJobLite } from "@/lib/pipelineProgress";

export interface Project {
  id: string;
  repo_owner: string;
  repo_name: string;
  branch: string;
  status: "idle" | "analyzing" | "complete" | "failed";
  permission_tier: string;
  developer_role: string;
  stale_count: number;
  created_at?: string | null;
  last_analyzed_at: string | null;
  /** GitHub repo metadata (fetched at import, refreshed on every analysis run). */
  repo_description?: string | null;
  primary_language?: string | null;
  repo_pushed_at?: string | null;
}

const defaultStatus = {
  label: "Ready",
  progress: 0,
  tone: "text-muted-foreground",
  bar: "bg-muted-foreground/40",
  icon: CircleDashed,
  hint: "This project hasn't been analyzed yet.",
};
const statusConfig = {
  idle: defaultStatus,
  analyzing: {
    label: "In Progress",
    progress: 45,
    tone: "text-primary",
    bar: "bg-primary",
    icon: Loader2,
    hint: "One or more analysis runs are in progress — the repository is being parsed and its onboarding content generated.",
  },
  complete: {
    label: "Complete",
    progress: 100,
    tone: "text-success",
    bar: "bg-success",
    icon: CheckCircle2,
    hint: "The repository has been parsed and its onboarding content generated.",
  },
  failed: {
    label: "Failed",
    progress: 0,
    tone: "text-destructive",
    bar: "bg-destructive",
    icon: XCircle,
    hint: "Analysis hit an error and did not finish.",
  },
};

const tierColors: Record<string, string> = {
  owner: "bg-warning-soft text-warning border-warning/30",
  admin: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  contributor: "bg-muted text-muted-foreground border-border",
  developer: "bg-muted text-muted-foreground border-border",
};

/** GitHub's linguist colors for the languages we're likely to meet. */
const languageColors: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Vue: "#41b883",
  Dart: "#00B4AB",
};

export function ProjectCard({
  project,
  onDeleted,
}: {
  project: Project;
  onDeleted?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const status = statusConfig[project.status] ?? defaultStatus;
  const StatusIcon = status.icon;
  const canManage = project.permission_tier === "owner" || project.permission_tier === "admin";

  // While analyzing, show the SAME combined pipeline % and stage as the
  // project overview page (bug: the card showed a hardcoded 45%). With
  // concurrent runs the card tracks the newest active one and counts the rest.
  const [liveJob, setLiveJob] = useState<PipelineJobLite | null>(null);
  const [extraActiveRuns, setExtraActiveRuns] = useState(0);
  useEffect(() => {
    if (project.status !== "analyzing") {
      setLiveJob(null);
      setExtraActiveRuns(0);
      return;
    }
    let cancelled = false;
    const load = () => {
      apiFetch(`/projects/${project.id}/analysis-status`)
        .then((data: { jobs: Array<PipelineJobLite & { status?: string }> }) => {
          if (cancelled) return;
          const active = (data.jobs ?? []).filter((j) => j.status === "queued" || j.status === "running");
          setLiveJob(active[0] ?? data.jobs?.[0] ?? null);
          setExtraActiveRuns(Math.max(0, active.length - 1));
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 6000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [project.id, project.status]);

  const live = pipelineProgress(liveJob);
  const progressValue = project.status === "analyzing" && liveJob ? live.pct : status.progress;
  const progressText = project.status === "analyzing"
    ? `${live.stageLabel ? `${live.stageLabel.split(" — ")[0]} ${live.pct}%` : `Analyzing ${live.pct}%`}${extraActiveRuns > 0 ? ` (+${extraActiveRuns} more run${extraActiveRuns > 1 ? "s" : ""})` : ""}`
    : "";

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      await apiFetch(`/projects/${project.id}`, { method: "DELETE" });
      onDeleted?.(project.id);
      setDeleteDialogOpen(false);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete the project");
    } finally {
      setDeleting(false);
    }
  }

  const openProject = () => navigate(`/projects/${project.id}`);
  const updatedAt = project.repo_pushed_at ?? project.last_analyzed_at ?? project.created_at ?? null;
  const languageDot = project.primary_language ? languageColors[project.primary_language] : undefined;

  return (
    <>
    {/* The whole card opens the project (like a GitHub repo card); inner
        controls (menu, delete) stop propagation so managing still works. */}
    <Card
      role="link"
      tabIndex={0}
      aria-label={`Open ${project.repo_owner}/${project.repo_name}`}
      onClick={openProject}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          openProject();
        }
      }}
      className="group cursor-pointer transition-colors hover:border-primary/40 focus-visible:border-primary/40 focus-visible:outline-none"
    >
      <CardContent className="p-3">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold text-foreground" title={project.repo_name}>
                {project.repo_name}
              </h3>
              <Badge className={`text-[11px] ${tierColors[project.permission_tier] ?? tierColors.developer}`} variant="outline">
                {project.permission_tier.toUpperCase()}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <StatusIcon
              className={`h-4 w-4 ${status.tone} ${project.status === "analyzing" ? "animate-spin" : ""}`}
            />
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Project actions" onClick={(e) => e.stopPropagation()}>
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteError(""); setDeleteDialogOpen(true); }}>
                    <Trash2 className="h-3 w-3" />
                    Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <p className="mb-2 line-clamp-2 min-h-4 text-xs leading-snug text-muted-foreground" title={project.repo_description ?? undefined}>
          {project.repo_description ?? ""}
        </p>

        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="truncate text-muted-foreground">{progressText}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className={`cursor-help underline decoration-dotted underline-offset-2 ${status.tone}`}
              >
                {status.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{status.hint}</TooltipContent>
          </Tooltip>
        </div>

        <Progress value={progressValue} indicatorClassName={status.bar} className="mb-2.5 h-1" />

        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex min-w-0 items-center gap-3">
            {project.primary_language && (
              <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 rounded-full ${languageDot ? "" : "bg-muted-foreground/60"}`}
                  style={languageDot ? { backgroundColor: languageDot } : undefined}
                />
                {project.primary_language}
              </span>
            )}
            <span className="shrink-0 text-muted-foreground">
              STALE <span className={project.stale_count > 0 ? "font-semibold text-warning" : "font-semibold text-foreground"}>{project.stale_count}</span>
            </span>
          </div>
          {updatedAt && (
            <span className="shrink-0 truncate text-muted-foreground">Updated {timeAgo(updatedAt)}</span>
          )}
        </div>
      </CardContent>
    </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={(open) => !deleting && setDeleteDialogOpen(open)}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="text-sm">Delete project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Delete <strong className="text-foreground">{project.repo_owner}/{project.repo_name}</strong>?
              This removes all analyses and onboarding content and cannot be undone.
            </p>
            {deleteError && <p className="text-[11px] text-destructive">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={confirmDelete} disabled={deleting}>
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
