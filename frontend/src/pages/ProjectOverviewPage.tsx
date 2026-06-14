import {
  ArrowRight,
  BookOpen,
  FileText,
  GitBranch,
  Play,
  RefreshCw,
  User,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useProject } from "@/contexts/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { apiFetch } from "@/lib/api";

const rolesList = [
  { key: "backend", label: "Backend" },
  { key: "frontend", label: "Frontend" },
  { key: "devops", label: "DevOps" },
  { key: "qa", label: "QA" },
  { key: "general", label: "General" },
];

export function ProjectOverviewPage() {
  const { project, refetch } = useProject();
  const { id } = useParams<{ id: string }>();
  const [analyzing, setAnalyzing] = useState(false);

  if (!project) return null;

  const statusProgress: Record<string, number> = {
    idle: 0,
    analyzing: 45,
    complete: 100,
    failed: 0,
  };

  async function handleReanalyze() {
    setAnalyzing(true);
    try {
      await apiFetch(`/projects/${id}/analyze`, { method: "POST" });
      refetch();
    } catch { /* ignore */ } finally {
      setAnalyzing(false);
    }
  }

  const canManage = project.permission_tier === "owner" || project.permission_tier === "admin";

  return (
    <div>
      {/* Breadcrumb row */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 overflow-x-auto text-xs text-muted-foreground">
        <span>{project.repo_owner}</span>
        <span>/</span>
        <span className="font-medium text-foreground">{project.repo_name}</span>
        <span className="text-border">|</span>
        <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />{project.branch}</span>
        <span className="text-border">|</span>
        <Badge variant="outline" className="text-[10px] capitalize">{project.developer_role}</Badge>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Overview</h1>
        {canManage && (
          <Button
            variant="outline"
            size="xs"
            onClick={handleReanalyze}
            disabled={analyzing || project.status === "analyzing"}
          >
            <RefreshCw className={`h-3 w-3 ${analyzing ? "animate-spin" : ""}`} />
            Re-scan
          </Button>
        )}
      </div>

      {/* Quick actions */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="p-3">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
              <BookOpen className="h-3.5 w-3.5 text-primary" />
            </div>
            <h3 className="text-[13px] font-medium text-foreground">Continue onboarding</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Pick up where you left off</p>
            <Link to={`/projects/${id}/onboarding`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Resume <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="p-3">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10">
              <Play className="h-3.5 w-3.5 text-blue-400" />
            </div>
            <h3 className="text-[13px] font-medium text-foreground">Continue tutorial</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Walk through key workflows</p>
            <Link to={`/projects/${id}/walkthrough`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Resume <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="p-3">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10">
              <User className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <h3 className="text-[13px] font-medium text-foreground">Your role</h3>
            <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">{project.developer_role}</p>
            <Link to={`/projects/${id}/team`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View team <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Analysis + Role packages */}
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-[13px] font-medium text-foreground">Analysis status</h3>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {project.status === "analyzing"
                  ? "Building code evidence model..."
                  : project.status === "complete"
                    ? "Analysis complete"
                    : project.status === "failed"
                      ? "Analysis failed"
                      : "Not yet analyzed"}
              </span>
              <Badge
                variant={project.status === "complete" ? "default" : project.status === "failed" ? "destructive" : "secondary"}
                className="text-[10px]"
              >
                {project.status}
              </Badge>
            </div>
            <Progress value={statusProgress[project.status] ?? 0} className="mb-3 h-1" />

            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-xl font-bold text-foreground">--</p>
                <p className="text-[11px] text-muted-foreground">Files</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-foreground">--</p>
                <p className="text-[11px] text-muted-foreground">Symbols</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-foreground">--</p>
                <p className="text-[11px] text-muted-foreground">Workflows</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-[13px] font-medium text-foreground">Role packages</h3>
            <div className="space-y-1.5">
              {rolesList.map((role) => (
                <div key={role.key} className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-foreground">{role.label}</span>
                  </div>
                  {role.key === project.developer_role ? (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">Draft</Badge>
                      <Button variant="ghost" size="xs">Open</Button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Missing</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />
    </div>
  );
}
