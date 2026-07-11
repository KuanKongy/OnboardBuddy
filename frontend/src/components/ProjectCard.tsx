import {
  CheckCircle2,
  CircleDashed,
  GitBranch,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
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
  last_analyzed_at: string | null;
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
    hint: "The repository is being parsed and its onboarding content generated.",
  },
  complete: {
    label: "Complete",
    progress: 100,
    tone: "text-emerald-700 dark:text-emerald-400",
    bar: "bg-emerald-500",
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
  owner: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  admin: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  contributor: "bg-muted text-muted-foreground border-border",
  developer: "bg-muted text-muted-foreground border-border",
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
  // project overview page (bug: the card showed a hardcoded 45%).
  const [liveJob, setLiveJob] = useState<PipelineJobLite | null>(null);
  useEffect(() => {
    if (project.status !== "analyzing") {
      setLiveJob(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      apiFetch(`/projects/${project.id}/analysis-status`)
        .then((data: { jobs: PipelineJobLite[] }) => { if (!cancelled) setLiveJob(data.jobs?.[0] ?? null); })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 6000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [project.id, project.status]);

  const live = pipelineProgress(liveJob);
  const progressValue = project.status === "analyzing" && liveJob ? live.pct : status.progress;
  const progressText = project.status === "analyzing"
    ? (live.stageLabel ? `${live.stageLabel.split(" — ")[0]} ${live.pct}%` : `Analyzing ${live.pct}%`)
    : "";

  async function handleDelete() {
    if (!confirm(`Delete ${project.repo_owner}/${project.repo_name}? This cannot be undone.`)) return;
    try {
      await apiFetch(`/projects/${project.id}`, { method: "DELETE" });
      onDeleted?.(project.id);
    } catch { /* noop */ }
  }

  return (
    <Card className="group transition-colors hover:border-primary/40">
      <CardContent className="p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold text-foreground" title={project.repo_name}>
                {project.repo_name}
              </h3>
              <Badge className={`text-[11px] ${tierColors[project.permission_tier] ?? tierColors.developer}`} variant="outline">
                {project.permission_tier.toUpperCase()}
              </Badge>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              {project.branch}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <StatusIcon
              className={`h-4 w-4 ${status.tone} ${project.status === "analyzing" ? "animate-spin" : ""}`}
            />
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(); }}>
                    <Trash2 className="h-3 w-3" />
                    Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

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

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">
              STALE <span className={project.stale_count > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : "font-semibold text-foreground"}>{project.stale_count}</span>
            </span>
          </div>
          <Button variant="outline" size="xs" onClick={() => navigate(`/projects/${project.id}`)}>
            Open Project
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
