import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileText,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useProject } from "@/contexts/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { pipelineProgress } from "@/lib/pipelineProgress";
import { AnalyzeDialog } from "@/components/AnalyzeDialog";
import { AnalysisRunPanel } from "@/components/AnalysisRunPanel";

const rolesList = [
  { key: "backend", label: "Backend" },
  { key: "frontend", label: "Frontend" },
  { key: "devops", label: "DevOps" },
  { key: "qa", label: "QA" },
  { key: "general", label: "General" },
];

interface StepLogEntry {
  step: string;
  pct: number;
  ts: string;
}

interface AnalysisJob {
  id: string;
  job_type: string;
  status: string;
  progress_pct: number;
  current_step: string | null;
  snapshot_id: string | null;
  checkpoint: Record<string, unknown>;
  step_log: StepLogEntry[];
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  file_count: number | null;
  symbol_count: number | null;
  workflow_count: number | null;
  commit_hash: string | null;
}

interface AnalysisStatus {
  jobs: AnalysisJob[];
  latestSnapshot: {
    id: string;
    file_count: number;
    symbol_count: number;
    workflow_count: number;
    commit_hash: string;
    created_at: string;
  } | null;
}

export function ProjectOverviewPage() {
  const { project, refetch } = useProject();
  const { id } = useParams<{ id: string }>();
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [rolePackages, setRolePackages] = useState<Array<{ role: string; status: string }>>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function poll() {
      try {
        const data = await apiFetch(`/projects/${id}/analysis-status`) as AnalysisStatus;
        if (cancelled) return;
        setAnalysisStatus(data);

        const job = data.jobs[0];
        const active = job?.status === "queued" || job?.status === "running";

        if (active) {
          wasActiveRef.current = true;
        } else if (wasActiveRef.current) {
          // Job just finished — stop polling and refresh project
          wasActiveRef.current = false;
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          refetch();
        } else {
          // Job was already done on first load — just stop polling
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch { /* ignore */ }
    }

    poll();
    pollRef.current = setInterval(poll, 5000);
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  // Real per-role package status for the "Role packages" card (latest
  // package per role wins — the list endpoint is sorted newest first).
  useEffect(() => {
    if (!id) return;
    apiFetch(`/projects/${id}/onboarding/packages`)
      .then((data: { packages: Array<{ role: string; status: string }> }) => {
        const seen = new Set<string>();
        setRolePackages((data.packages ?? []).filter((p) => {
          if (seen.has(p.role)) return false;
          seen.add(p.role);
          return true;
        }));
      })
      .catch(() => setRolePackages([]));
  }, [id, project?.status]);

  if (!project) return null;

  const latestJob = analysisStatus?.jobs[0];
  const snap = analysisStatus?.latestSnapshot;
  const isActive = latestJob?.status === "queued" || latestJob?.status === "running";

  // Shared combined pipeline bar (analysis 0-70%, generation 70-100%) —
  // the dashboard project cards use the same helper, so both surfaces
  // always show the same number and stage.
  const { pct: pipelinePct, stageLabel } = pipelineProgress(latestJob);

  // Called when the AnalyzeDialog has accepted a job: resume status polling.
  function handleAnalysisStarted() {
    refetch();
    wasActiveRef.current = true;
    if (!pollRef.current) {
      pollRef.current = setInterval(async () => {
        try {
          const data = await apiFetch(`/projects/${id}/analysis-status`) as AnalysisStatus;
          setAnalysisStatus(data);
          const job = data.jobs[0];
          if (job?.status !== "queued" && job?.status !== "running") {
            wasActiveRef.current = false;
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            refetch();
          }
        } catch { /* ignore */ }
      }, 5000);
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
        <Badge variant="outline" className="text-[11px] capitalize">{project.developer_role}</Badge>
      </div>

      <div className="mb-3 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Overview</h1>
          <p className="text-xs text-muted-foreground">
            Health and analysis summary for this repository.
          </p>
        </div>
        {canManage && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => setAnalyzeOpen(true)}
            disabled={isActive || project.status === "analyzing"}
            data-tour="analyze-button"
          >
            <RefreshCw className="h-3 w-3" />
            Analyze…
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
            <p className="mt-0.5 text-xs text-muted-foreground">Pick up where you left off</p>
            <Link to={`/projects/${id}/onboarding`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Resume <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="p-3">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10">
              <Play className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-[13px] font-medium text-foreground">Continue tutorial</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Walk through key workflows</p>
            <Link to={`/projects/${id}/walkthrough`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Resume <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="p-3">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10">
              <User className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="text-[13px] font-medium text-foreground">Your role</h3>
            <p className="mt-0.5 text-xs capitalize text-muted-foreground">{project.developer_role}</p>
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
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-foreground">Analysis status</h3>
              {latestJob?.status === "failed" && canManage && (
                <Button variant="outline" size="xs" onClick={() => setAnalyzeOpen(true)}>
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Retry
                </Button>
              )}
            </div>

            {/* Live step display */}
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="flex cursor-help items-center gap-1.5 text-muted-foreground underline decoration-dotted underline-offset-2">
                    {isActive && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                    {latestJob?.status === "complete" && <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
                    {latestJob?.status === "failed" && <AlertTriangle className="h-3 w-3 text-destructive" />}
                    {isActive
                      ? stageLabel
                      : latestJob?.status === "complete"
                        ? "Analysis complete"
                        : latestJob?.status === "failed"
                          ? "Analysis failed"
                          : "Not yet analyzed"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isActive
                    ? "The repository is being parsed and its onboarding content generated."
                    : latestJob?.status === "complete"
                      ? "The repository has been parsed and its onboarding content generated."
                      : latestJob?.status === "failed"
                        ? "Analysis hit an error and did not finish — see the message below, or retry."
                        : "This repository hasn't been analyzed yet."}
                </TooltipContent>
              </Tooltip>
              <Badge
                variant={latestJob?.status === "complete" ? "default" : latestJob?.status === "failed" ? "destructive" : "secondary"}
                className="text-[11px]"
              >
                {latestJob?.status ?? project.status}
              </Badge>
            </div>
            <Progress value={pipelinePct} className="mb-2 h-1.5" />

            {/* Error message */}
            {latestJob?.status === "failed" && latestJob.error_message && (
              <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="text-xs text-destructive">{latestJob.error_message}</p>
                {latestJob.checkpoint && Object.keys(latestJob.checkpoint).length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Last checkpoint: step {(latestJob.checkpoint as { lastCompletedStep?: number }).lastCompletedStep ?? "unknown"}
                  </p>
                )}
              </div>
            )}

            {/* Stats from latest snapshot */}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-xl font-bold text-foreground">{snap?.file_count ?? "--"}</p>
                <p className="text-xs text-muted-foreground">Files</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-foreground">{snap?.symbol_count ?? "--"}</p>
                <p className="text-xs text-muted-foreground">Symbols</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-foreground">{snap?.workflow_count ?? "--"}</p>
                <p className="text-xs text-muted-foreground">Workflows</p>
              </div>
            </div>

            {/* The run, in one panel: every pipeline step with status,
                start/finish times and key numbers, plus the spend line. */}
            {(latestJob || snap) && (
              <div className="mt-3">
                <AnalysisRunPanel
                  projectId={id!}
                  snapshotId={latestJob?.snapshot_id ?? snap?.id ?? null}
                  isActive={isActive}
                  currentStep={latestJob?.current_step ?? null}
                  stepLog={latestJob?.step_log ?? []}
                />
              </div>
            )}

            {/* Previous jobs */}
            {analysisStatus && analysisStatus.jobs.length > 1 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Previous jobs ({analysisStatus.jobs.length - 1})
                </summary>
                <div className="mt-1.5 space-y-2">
                  {analysisStatus.jobs.slice(1).map((job) => (
                    <div key={job.id}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {job.job_type.replace(/_/g, " ")} — {job.current_step ?? job.status}
                        </span>
                        <Badge
                          variant={job.status === "complete" ? "default" : job.status === "failed" ? "destructive" : "secondary"}
                          className="text-[9px]"
                        >
                          {job.status}
                        </Badge>
                      </div>
                      {job.step_log && job.step_log.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-muted-foreground/60 hover:text-muted-foreground">
                            {job.step_log.length} steps
                          </summary>
                          <div className="mt-1 border-l border-border/50 pl-2">
                            {job.step_log.map((entry, i) => (
                              <div key={i} className="text-[11px] text-muted-foreground/60">
                                {entry.step} <span className="tabular-nums">({new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-[13px] font-medium text-foreground">Role packages</h3>
            <div className="space-y-1.5">
              {rolesList.map((role) => {
                const pkg = rolePackages.find((p) => p.role === role.key);
                return (
                  <div key={role.key} className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-foreground">{role.label}</span>
                    </div>
                    {pkg ? (
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-[11px] capitalize">{pkg.status}</Badge>
                        <Button variant="ghost" size="xs" asChild>
                          <Link to={`/projects/${id}/onboarding?view=reader&role=${role.key}`}>Open</Link>
                        </Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="xs" className="text-muted-foreground" asChild>
                        <Link to={`/projects/${id}/onboarding?view=reader&role=${role.key}`}>Generate…</Link>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {id && (
        <AnalyzeDialog
          projectId={id}
          open={analyzeOpen}
          onOpenChange={setAnalyzeOpen}
          onStarted={handleAnalysisStarted}
        />
      )}
    </div>
  );
}
