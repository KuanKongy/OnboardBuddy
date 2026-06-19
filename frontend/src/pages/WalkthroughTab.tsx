import {
  ArrowRight,
  GitBranch,
  Loader2,
  Lock,
  RefreshCw,
  Route as RouteIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useProject } from "@/contexts/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";

const roles = [
  { key: "backend", label: "Backend" },
  { key: "frontend", label: "Frontend" },
  { key: "devops", label: "DevOps" },
  { key: "qa", label: "QA" },
  { key: "general", label: "General" },
];

function roleLabel(key: string): string {
  return roles.find((r) => r.key === key)?.label ?? key;
}

export function WalkthroughTab() {
  const { project, refetch } = useProject();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [analyzing, setAnalyzing] = useState(false);

  if (!project) return null;

  const canManage =
    project.permission_tier === "owner" || project.permission_tier === "admin";

  // Walkthroughs are derived from a role's onboarding package, which is
  // generated after analysis. No workflow endpoint exists yet, so we render the
  // missing/generating state from the real analysis status.
  const role = searchParams.get("role") ?? project.developer_role;
  const generating = project.status === "analyzing";

  function setRole(next: string) {
    setSearchParams(
      (prev) => {
        prev.set("role", next);
        return prev;
      },
      { replace: true },
    );
  }

  async function handleReanalyze() {
    setAnalyzing(true);
    try {
      await apiFetch(`/projects/${id}/analyze`, { method: "POST" });
      refetch();
    } catch {
      /* surfaced via project status on refetch */
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div>
      {/* Breadcrumb row */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 overflow-x-auto text-xs text-muted-foreground">
        <span>{project.repo_owner}</span>
        <span>/</span>
        <span className="font-medium text-foreground">{project.repo_name}</span>
        <span className="text-border">|</span>
        <span className="inline-flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {project.branch}
        </span>
      </div>

      {/* Header */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Walkthrough</h1>
          <p className="text-xs text-muted-foreground">
            Step-by-step tour of the workflows in your role package.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="h-8 w-[150px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label} Developer
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <Button
              variant="outline"
              size="xs"
              onClick={handleReanalyze}
              disabled={analyzing || generating}
            >
              <RefreshCw className={`h-3 w-3 ${analyzing ? "animate-spin" : ""}`} />
              Re-scan
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr]">
        {/* Workflow picker — locked until a package is generated */}
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-foreground">Workflows</h3>
              <Badge variant={generating ? "secondary" : "outline"} className="text-[10px]">
                {generating ? "Generating" : "Missing"}
              </Badge>
            </div>
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 opacity-50" />
              No workflows yet
            </div>
          </CardContent>
        </Card>

        {/* Walkthrough state */}
        <Card>
          <CardContent className="flex min-h-[280px] flex-col items-center justify-center p-6 text-center">
            {generating ? (
              <>
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">
                  Generating {roleLabel(role)} walkthroughs
                </h2>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Analysis is running. Workflow tours for the {roleLabel(role)} role
                  will appear here once the codebase has been processed.
                </p>
              </>
            ) : (
              <>
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                  <RouteIcon className="h-5 w-5 text-muted-foreground" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">
                  No {roleLabel(role)} walkthroughs yet
                </h2>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Walkthroughs are created from the {roleLabel(role)} onboarding package.
                  Generate that package first and its workflow tours will show up here.
                </p>
                <Button variant="outline" size="sm" className="mt-4" asChild>
                  <Link to={`/projects/${id}/onboarding?role=${role}`}>
                    Go to onboarding
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                {!canManage && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Ask an Owner or Admin to run analysis to generate onboarding.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
