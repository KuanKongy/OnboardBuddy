import { AlertTriangle, GitBranch, MoreVertical, Trash2 } from "lucide-react";
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
import { apiFetch } from "@/lib/api";

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

const defaultStatus = { label: "Ready", progress: 0 };
const statusConfig = {
  idle: defaultStatus,
  analyzing: { label: "In Progress", progress: 45 },
  complete: { label: "Complete", progress: 100 },
  failed: { label: "Failed", progress: 0 },
};

const tierColors: Record<string, string> = {
  owner: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  admin: "bg-blue-500/15 text-blue-400 border-blue-500/30",
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
  const canManage = project.permission_tier === "owner" || project.permission_tier === "admin";

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
            <h3 className="truncate text-sm font-semibold text-foreground">
              {project.repo_name}
            </h3>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              {project.branch}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge className={`text-[10px] ${tierColors[project.permission_tier] ?? tierColors.developer}`} variant="outline">
              {project.permission_tier.toUpperCase()}
            </Badge>
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

        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">
            {project.status === "analyzing" ? `Analyzing ${status.progress}%` : status.label}
          </span>
          <span className={project.status === "complete" ? "text-emerald-400" : project.status === "analyzing" ? "text-primary" : "text-muted-foreground"}>
            {status.label}
          </span>
        </div>

        <Progress value={status.progress} className="mb-2.5 h-1" />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-muted-foreground">
              STALE <span className={project.stale_count > 0 ? "font-semibold text-amber-400" : "font-semibold text-foreground"}>{project.stale_count}</span>
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
