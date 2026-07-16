import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useProject } from "@/contexts/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { pipelineProgress } from "@/lib/pipelineProgress";
import { useProgress } from "@/lib/useProgress";
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
  /** Worker liveness: stamped every ~15s while the run is genuinely alive. */
  last_heartbeat_at: string | null;
  /** Delivery attempt (>1 = the queue retried this run). */
  attempt: number;
  /** Running but silent for 2+ minutes — presumed dead until reconciled. */
  stalled: boolean;
  /** Per-run configuration as requested (null = project default). */
  requested_branch: string | null;
  requested_commit: string | null;
  requested_depth: string | null;
  requested_role: string | null;
  scope_path: string | null;
  file_count: number | null;
  symbol_count: number | null;
  workflow_count: number | null;
  commit_hash: string | null;
  branch: string | null;
}

interface AnalysisStatus {
  jobs: AnalysisJob[];
  latestSnapshot: {
    id: string;
    file_count: number;
    symbol_count: number;
    workflow_count: number;
    commit_hash: string;
    branch: string;
    semantic_depth: string;
    created_at: string;
  } | null;
}

/** Human summary of one run's configuration for the config chips row. */
function runConfigParts(job: AnalysisJob | undefined, defaultBranch: string): string[] {
  if (!job) return [];
  const parts = [
    `branch ${job.branch ?? job.requested_branch ?? defaultBranch}`,
    `commit ${job.commit_hash?.slice(0, 7) ?? job.requested_commit?.slice(0, 7) ?? "head"}`,
  ];
  if (job.scope_path) parts.push(`scope ${job.scope_path}/`);
  if (job.requested_depth) parts.push(`${job.requested_depth} depth`);
  return parts;
}

export function ProjectOverviewPage() {
  const { project, refetch } = useProject();
  const { id } = useParams<{ id: string }>();
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [rolePackages, setRolePackages] = useState<Array<{ role: string; status: string }>>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasActiveRef = useRef(false);

  // Per-user resume markers: the Continue cards deep-link to the exact
  // section/step the user last read (falling back to the plain tabs).
  const { items: progressItems } = useProgress(id);
  const onboardingProgress = progressItems.find((p) => p.kind === "onboarding" && p.still_exists);
  const tutorialProgress = progressItems.find((p) => p.kind === "tutorial" && p.still_exists);
  const onboardingResumeLink = onboardingProgress
    ? `/projects/${id}/onboarding?view=reader&role=${(onboardingProgress.position.role as string) ?? ""}&section=${(onboardingProgress.position.sectionType as string) ?? ""}`
    : `/projects/${id}/onboarding`;
  const tutorialResumeLink = tutorialProgress
    ? `/projects/${id}/walkthrough?tutorial=${tutorialProgress.ref_id}&step=${(tutorialProgress.position.stepOrder as number) ?? 1}`
    : `/projects/${id}/walkthrough`;

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

  // Live "last worker activity" ticker while a run is active.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const job = analysisStatus?.jobs[0];
    const active = job?.status === "queued" || job?.status === "running";
    if (!active) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, [analysisStatus]);

  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState("");

  if (!project) return null;

  const latestJob = analysisStatus?.jobs[0];
  const snap = analysisStatus?.latestSnapshot;
  const isActive = latestJob?.status === "queued" || latestJob?.status === "running";
  const heartbeatAgoSec = latestJob?.last_heartbeat_at
    ? Math.max(0, Math.round((nowTs - new Date(latestJob.last_heartbeat_at).getTime()) / 1000))
    : null;
  // The worker resumes analyze/generate jobs from their checkpoints; section
  // regenerations and previews restart from their own buttons instead.
  const resumable = latestJob != null &&
    ["analyze_scope", "incremental_update", "generate_package"].includes(latestJob.job_type);

  async function jobControl(action: "pause" | "stop" | "resume") {
    if (!id || !latestJob) return;
    setControlBusy(true);
    setControlError("");
    try {
      await apiFetch(`/projects/${id}/analysis-jobs/${latestJob.id}/${action}`, { method: "POST" });
      if (action === "resume") {
        handleAnalysisStarted();
      } else {
        const data = await apiFetch(`/projects/${id}/analysis-status`) as AnalysisStatus;
        setAnalysisStatus(data);
        refetch();
      }
    } catch (err: unknown) {
      setControlError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setControlBusy(false);
    }
  }

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
      <PageHeader
        title="Overview"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-foreground">{project.repo_owner}/{project.repo_name}</span>
            <Badge variant="outline" className="text-[10px] capitalize">{project.developer_role}</Badge>
          </span>
        }
        actions={
          canManage && (
            <Button
              size="sm"
              onClick={() => setAnalyzeOpen(true)}
              disabled={isActive || project.status === "analyzing"}
              data-tour="analyze-button"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Analyze
            </Button>
          )
        }
      />

      {/* Quick actions: flat rows — icon left, text right */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="flex items-center gap-3 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <BookOpen className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium text-foreground">Continue onboarding</h3>
              <Link to={onboardingResumeLink} className="inline-flex items-center gap-1 truncate text-xs font-medium text-primary hover:underline">
                {onboardingProgress
                  ? `Resume — ${((onboardingProgress.position.sectionType as string) ?? "").replace(/-/g, " ") || "where you left off"}`
                  : "Start reading"}
                <ArrowRight className="h-3 w-3 shrink-0" />
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="flex items-center gap-3 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500/10">
              <Play className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium text-foreground">Continue tutorial</h3>
              <Link to={tutorialResumeLink} className="inline-flex items-center gap-1 truncate text-xs font-medium text-primary hover:underline">
                {tutorialProgress
                  ? `Resume — step ${(tutorialProgress.position.stepOrder as number) ?? 1}${tutorialProgress.title ? ` of ${tutorialProgress.title}` : ""}`
                  : "Start a tutorial"}
                <ArrowRight className="h-3 w-3 shrink-0" />
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-primary/40">
          <CardContent className="flex items-center gap-3 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10">
              <User className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium capitalize text-foreground">{project.developer_role} role</h3>
              <Link to={`/projects/${id}/team`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                View team <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analysis + Role packages */}
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <h3 className="text-[13px] font-medium text-foreground">Analysis status</h3>
                {runConfigParts(latestJob, project.branch).map((part) => (
                  <Badge key={part} variant="outline" className="font-mono text-[10px]">{part}</Badge>
                ))}
              </div>
              {canManage && latestJob && (
                <div className="flex items-center gap-1.5">
                  {isActive && (
                    <>
                      <Button variant="outline" size="xs" onClick={() => jobControl("pause")} disabled={controlBusy} title="Worker pauses at the next step — completed work is checkpointed">
                        <PauseCircle className="mr-1 h-3 w-3" />
                        Pause
                      </Button>
                      <Button variant="outline" size="xs" className="text-destructive hover:text-destructive" onClick={() => jobControl("stop")} disabled={controlBusy} title="Stops the run; completed phases stay cached">
                        <Square className="mr-1 h-3 w-3" />
                        Stop
                      </Button>
                    </>
                  )}
                  {latestJob.status === "paused" && resumable && (
                    <Button variant="outline" size="xs" onClick={() => jobControl("resume")} disabled={controlBusy}>
                      <Play className="mr-1 h-3 w-3" />
                      Resume
                    </Button>
                  )}
                  {latestJob.status === "failed" && resumable && (
                    <Button variant="outline" size="xs" onClick={() => jobControl("resume")} disabled={controlBusy} title="Re-runs this job — checkpointed phases and cached AI work are skipped">
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Resume run
                    </Button>
                  )}
                  {latestJob.status === "failed" && (
                    <Button variant="outline" size="xs" onClick={() => setAnalyzeOpen(true)}>
                      <RefreshCw className="mr-1 h-3 w-3" />
                      New run…
                    </Button>
                  )}
                </div>
              )}
            </div>

            {controlError && (
              <p className="mb-1.5 text-xs text-destructive">{controlError}</p>
            )}

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
              <span className="flex items-center gap-1.5">
                {latestJob && latestJob.attempt > 1 && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground" title="The queue re-delivered this run — earlier attempt(s) were interrupted; cached work is not re-paid">
                    attempt #{latestJob.attempt}
                  </Badge>
                )}
                {latestJob?.stalled && (
                  <Badge variant="destructive" className="text-[10px]" title="Running but no worker signal for 2+ minutes — it will be auto-marked failed shortly, then you can resume it">
                    stalled
                  </Badge>
                )}
                <Badge
                  variant={latestJob?.status === "complete" ? "default" : latestJob?.status === "failed" ? "destructive" : "secondary"}
                  className="text-[11px]"
                >
                  {latestJob?.status ?? project.status}
                </Badge>
              </span>
            </div>
            <Progress value={pipelinePct} className="mb-2 h-1.5" />

            {/* Worker liveness: the honest "is anything actually happening?" signal. */}
            {isActive && (
              <p className={`mb-2 text-[11px] tabular-nums ${latestJob?.stalled ? "text-destructive" : "text-muted-foreground"}`}>
                {heartbeatAgoSec === null
                  ? "Waiting for the worker's first signal…"
                  : `Last worker activity ${heartbeatAgoSec < 5 ? "just now" : `${heartbeatAgoSec}s ago`}`}
              </p>
            )}

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
            <h3 className="mb-1 text-[13px] font-medium text-foreground">Role packages</h3>
            {/* One package per role, all sharing the analyzed snapshot's
                config — the shared repo config lives in the header line. */}
            {snap && (
              <p className="mb-2 font-mono text-[10px] text-muted-foreground">
                {snap.branch} @ {snap.commit_hash.slice(0, 7)} · {snap.semantic_depth}
              </p>
            )}
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

      <AnalyzeDialog
        project={project}
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        onStarted={handleAnalysisStarted}
      />
    </div>
  );
}
