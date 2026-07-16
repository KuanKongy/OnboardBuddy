import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  History,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useProject } from "@/contexts/ProjectContext";
import { usePackages } from "@/contexts/PackagesContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiFetch } from "@/lib/api";
import { ROLES } from "@/lib/onboardingData";
import { pipelineProgress } from "@/lib/pipelineProgress";
import { useProgress } from "@/lib/useProgress";
import { AnalyzeDialog } from "@/components/AnalyzeDialog";
import { AnalysisRunPanel } from "@/components/AnalysisRunPanel";
import { PackageCardView } from "@/pages/OnboardingPage";
import type { AnalysisJob, RunHistoryEntry } from "@/types/analysis";

/** Human summary of one run's configuration for the config chips row. */
function runConfigParts(job: AnalysisJob | undefined, defaultBranch: string): string[] {
  if (!job) return [];
  const parts = [
    `branch ${job.branch ?? job.requested_branch ?? defaultBranch}`,
    `commit ${job.commit_hash?.slice(0, 7) ?? job.requested_commit?.slice(0, 7) ?? "head"}`,
  ];
  if (job.scope_path) parts.push(`scope ${job.scope_path}/`);
  if (job.requested_depth) parts.push(`${job.requested_depth} depth`);
  if (job.requested_role) parts.push(`${job.requested_role} role`);
  return parts;
}

function roleLabel(role: string): string {
  return ROLES.find((r) => r.key === role)?.label ?? role;
}

const JOB_TYPE_LABEL: Record<string, string> = {
  analyze_scope: "Analysis",
  incremental_update: "Incremental update",
  generate_package: "Package generation",
  regenerate_section: "Section regeneration",
  preflight: "Preflight preview",
};

/** "Actions taken" line for a history row. */
function runActionLabel(run: RunHistoryEntry): string {
  const commit = run.config.commit ? run.config.commit.slice(0, 7) : "head";
  const scope = run.config.scope_path ? `${run.config.scope_path}/` : "whole repo";
  switch (run.job_type) {
    case "analyze_scope":
      return `Analyzed ${scope} @ ${commit}`;
    case "incremental_update":
      return `Incremental update of ${scope} @ ${commit}`;
    case "generate_package": {
      const role = run.package?.role ?? run.config.role;
      const branch = run.package?.branch ?? run.config.branch;
      return `Generated ${role ? `${roleLabel(role)} ` : ""}package${branch ? ` on ${branch}` : ""}`;
    }
    case "regenerate_section":
      return `Regenerated section ${(run.section_type ?? run.sections.generated[0] ?? "").replace(/_/g, " ")}`.trim();
    case "preflight":
      return `Preflight preview of ${scope}`;
    default:
      return run.job_type.replace(/_/g, " ");
  }
}

function fmtDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return "";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function statusBadgeVariant(status: string): "default" | "destructive" | "secondary" {
  return status === "complete" ? "default" : status === "failed" ? "destructive" : "secondary";
}

// ── One active run ────────────────────────────────────────────────────────────

function RunCard({
  job,
  projectId,
  defaultBranch,
  canManage,
  soloRun,
  onControl,
  controlBusy,
  nowTs,
}: {
  job: AnalysisJob;
  projectId: string;
  defaultBranch: string;
  canManage: boolean;
  /** Single active run → pipeline panel starts expanded (N runs ≠ N metric polls). */
  soloRun: boolean;
  onControl: (jobId: string, action: "pause" | "stop" | "resume") => void;
  controlBusy: boolean;
  nowTs: number;
}) {
  const isActive = job.status === "queued" || job.status === "running";
  const { pct, stageLabel } = pipelineProgress(job);
  const heartbeatAgoSec = job.last_heartbeat_at
    ? Math.max(0, Math.round((nowTs - new Date(job.last_heartbeat_at).getTime()) / 1000))
    : null;
  const [panelOpen, setPanelOpen] = useState(soloRun);

  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 className="text-[13px] font-medium text-foreground">
              {JOB_TYPE_LABEL[job.job_type] ?? job.job_type.replace(/_/g, " ")}
            </h3>
            {runConfigParts(job, defaultBranch).map((part) => (
              <Badge key={part} variant="outline" className="font-mono text-[10px]">{part}</Badge>
            ))}
          </div>
          {canManage && (
            <div className="flex shrink-0 items-center gap-1.5">
              {isActive && (
                <>
                  <Button variant="outline" size="xs" onClick={() => onControl(job.id, "pause")} disabled={controlBusy} title="Worker pauses at the next step — completed work is checkpointed">
                    <PauseCircle className="mr-1 h-3 w-3" />
                    Pause
                  </Button>
                  <Button variant="outline" size="xs" className="text-destructive hover:text-destructive" onClick={() => onControl(job.id, "stop")} disabled={controlBusy} title="Stops the run; completed phases stay cached">
                    <Square className="mr-1 h-3 w-3" />
                    Stop
                  </Button>
                </>
              )}
              {job.status === "paused" && (
                <Button variant="outline" size="xs" onClick={() => onControl(job.id, "resume")} disabled={controlBusy}>
                  <Play className="mr-1 h-3 w-3" />
                  Resume
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {isActive && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            {isActive ? stageLabel : job.current_step ?? job.status}
          </span>
          <span className="flex items-center gap-1.5">
            {job.attempt > 1 && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground" title="The queue re-delivered this run — earlier attempt(s) were interrupted; cached work is not re-paid">
                attempt #{job.attempt}
              </Badge>
            )}
            {job.stalled && (
              <Badge variant="destructive" className="text-[10px]" title="Running but no worker signal for 2+ minutes — it will be auto-marked failed shortly, then you can resume it">
                stalled
              </Badge>
            )}
            <Badge variant={statusBadgeVariant(job.status)} className="text-[11px]">{job.status}</Badge>
          </span>
        </div>
        <Progress value={pct} className="mb-2 h-1.5" />

        {isActive && (
          <p className={`mb-2 text-[11px] tabular-nums ${job.stalled ? "text-destructive" : "text-muted-foreground"}`}>
            {heartbeatAgoSec === null
              ? "Waiting for the worker's first signal…"
              : `Last worker activity ${heartbeatAgoSec < 5 ? "just now" : `${heartbeatAgoSec}s ago`}`}
          </p>
        )}

        {job.status === "failed" && job.error_message && (
          <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="text-xs text-destructive">{job.error_message}</p>
          </div>
        )}

        {/* Pipeline detail: collapsed by default when several runs are live so
            N cards don't mean N parallel metrics polls — the panel only
            mounts (and fetches) once opened. */}
        <details
          open={panelOpen}
          onToggle={(e) => setPanelOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ChevronDown className={`h-3 w-3 transition-transform ${panelOpen ? "" : "-rotate-90"}`} />
            Pipeline steps & spend
          </summary>
          {panelOpen && (
            <div className="mt-2">
              <AnalysisRunPanel
                projectId={projectId}
                snapshotId={job.snapshot_id}
                isActive={isActive}
                currentStep={job.current_step}
                stepLog={job.step_log ?? []}
              />
            </div>
          )}
        </details>
      </CardContent>
    </Card>
  );
}

// ── Run history ───────────────────────────────────────────────────────────────

function RunHistoryRow({ run, projectId }: { run: RunHistoryEntry; projectId: string }) {
  const [open, setOpen] = useState(false);
  const hasCost = run.cost.llm_calls > 0 || run.cost.cached_calls > 0 || run.cost.estimated_cost_usd > 0;

  return (
    <details
      className="rounded-md border border-border/70 bg-card px-3 py-2"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
        <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{runActionLabel(run)}</span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          {hasCost && (
            <span title={`${run.cost.llm_calls} AI calls · ${run.cost.cached_calls} served from cache · ${run.cost.input_tokens.toLocaleString()} in / ${run.cost.output_tokens.toLocaleString()} out tokens`}>
              ${run.cost.estimated_cost_usd.toFixed(4)} · {run.cost.llm_calls} calls
              {run.cost.cached_calls > 0 ? ` · ${run.cost.cached_calls} cached` : ""}
            </span>
          )}
          {run.duration_ms !== null && <span>{fmtDuration(run.duration_ms)}</span>}
          <span>{new Date(run.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <Badge variant={statusBadgeVariant(run.status)} className="text-[10px]">{run.status}</Badge>
        </span>
      </summary>

      <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {run.config.branch && <Badge variant="outline" className="font-mono text-[10px]">branch {run.config.branch}</Badge>}
          {run.config.commit && <Badge variant="outline" className="font-mono text-[10px]">commit {run.config.commit.slice(0, 7)}</Badge>}
          {run.config.scope_path && <Badge variant="outline" className="font-mono text-[10px]">scope {run.config.scope_path}/</Badge>}
          {run.config.depth && <Badge variant="outline" className="font-mono text-[10px]">{run.config.depth} depth</Badge>}
          {run.config.role && <Badge variant="outline" className="font-mono text-[10px]">{run.config.role} role</Badge>}
          {run.requested_by_email && <span>by {run.requested_by_email}</span>}
          {run.attempt > 1 && <span>attempt #{run.attempt}</span>}
        </div>

        {run.error_message && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
            {run.error_message}
          </p>
        )}

        {(run.sections.generated.length > 0 || run.sections.cached.length > 0) && (
          <div className="space-y-1 text-[11px]">
            {run.sections.generated.length > 0 && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Generated:</span>{" "}
                {run.sections.generated.map((s) => s.replace(/_/g, " ")).join(", ")}
              </p>
            )}
            {run.sections.cached.length > 0 && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">From cache:</span>{" "}
                {run.sections.cached.map((s) => s.replace(/_/g, " ")).join(", ")}
              </p>
            )}
          </div>
        )}

        {!hasCost && run.job_type !== "preflight" && (
          <p className="text-[11px] text-muted-foreground/70">
            No per-run cost recorded (run predates cost tracking, or it was fully deterministic).
          </p>
        )}

        {run.step_log.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
            {run.step_log.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5">
                <span className="flex-1 text-[11px] text-muted-foreground">{entry.step}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
                  {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Full pipeline phases + spend for this run's snapshot; mounts (and
            fetches) only while this row is open. */}
        {open && run.snapshot_id && (
          <AnalysisRunPanel
            projectId={projectId}
            snapshotId={run.snapshot_id}
            isActive={false}
            currentStep={null}
            stepLog={[]}
          />
        )}
      </div>
    </details>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ProjectOverviewPage() {
  const { project, refetch } = useProject();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    packages,
    refreshPackages,
    selectPackage,
    selectedPackageId,
    status: analysisStatus,
    refreshStatus,
    activeJobs,
    registerSessionJob,
  } = usePackages();
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

  // Per-user resume markers: the Continue cards deep-link to the exact
  // section/step the user last read (falling back to the plain tabs).
  const { items: progressItems } = useProgress(id);
  const onboardingProgress = progressItems.find((p) => p.kind === "onboarding" && p.still_exists);
  const tutorialProgress = progressItems.find((p) => p.kind === "tutorial" && p.still_exists);
  const onboardingResumeLink = onboardingProgress
    ? `/projects/${id}/onboarding?view=reader&role=${(onboardingProgress.position.role as string) ?? ""}&section=${(onboardingProgress.position.sectionType as string) ?? ""}${onboardingProgress.position.packageId ? `&package=${onboardingProgress.position.packageId as string}` : ""}`
    : `/projects/${id}/onboarding`;
  const tutorialResumeLink = tutorialProgress
    ? `/projects/${id}/walkthrough?tutorial=${tutorialProgress.ref_id}&step=${(tutorialProgress.position.stepOrder as number) ?? 1}`
    : `/projects/${id}/walkthrough`;

  // Run history: refetched when the set of active runs changes (one just
  // started or finished) — not on the hot status poll.
  const [runs, setRuns] = useState<RunHistoryEntry[] | null>(null);
  const [runsError, setRunsError] = useState("");
  const loadRuns = useCallback(() => {
    if (!id) return;
    apiFetch(`/projects/${id}/runs?limit=20`)
      .then((data: { runs: RunHistoryEntry[] }) => { setRuns(data.runs ?? []); setRunsError(""); })
      .catch((err: Error) => setRunsError(err.message));
  }, [id]);
  const activeCount = activeJobs.length;
  const prevActiveCount = useRef<number | null>(null);
  useEffect(() => {
    if (prevActiveCount.current === activeCount) return;
    prevActiveCount.current = activeCount;
    loadRuns();
    refreshPackages();
  }, [activeCount, loadRuns, refreshPackages]);

  // Live "last worker activity" ticker while any run is active.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (activeJobs.length === 0) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, [activeJobs.length]);

  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState("");

  // Package grid filters (same trio as the onboarding page).
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [freshFilter, setFreshFilter] = useState("all");

  if (!project) return null;

  const snap = analysisStatus?.latestSnapshot;
  const canManage = project.permission_tier === "owner" || project.permission_tier === "admin";
  // Paused runs always deserve a resume affordance; failed ones only when
  // it's the most recent thing that happened (older failures live in history).
  const pausedOrFailed = (analysisStatus?.jobs ?? []).filter(
    (j, idx) => j.status === "paused" || (j.status === "failed" && idx === 0),
  );

  async function jobControl(jobId: string, action: "pause" | "stop" | "resume") {
    if (!id) return;
    setControlBusy(true);
    setControlError("");
    try {
      await apiFetch(`/projects/${id}/analysis-jobs/${jobId}/${action}`, { method: "POST" });
      if (action === "resume") registerSessionJob(jobId, { navigateOnDone: true });
      await refreshStatus();
      refetch();
      loadRuns();
    } catch (err: unknown) {
      setControlError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setControlBusy(false);
    }
  }

  function handleAnalysisStarted(jobId: string) {
    registerSessionJob(jobId, { navigateOnDone: true });
    refetch();
    loadRuns();
  }

  const filteredPackages = (packages ?? []).filter(
    (c) =>
      (roleFilter === "all" || c.role === roleFilter) &&
      (statusFilter === "all" || c.status === statusFilter) &&
      (freshFilter === "all" || (freshFilter === "latest" ? c.is_latest_commit : !c.is_latest_commit)),
  );

  const neverAnalyzed = !snap && activeJobs.length === 0 && (runs?.length ?? 0) === 0 && (packages?.length ?? 0) === 0;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-foreground">{project.repo_owner}/{project.repo_name}</span>
            <Badge variant="outline" className="text-[10px] capitalize">{project.developer_role}</Badge>
            {snap && (
              <span className="font-mono text-[11px] text-muted-foreground" title="Latest complete analysis">
                latest: {snap.branch}@{snap.commit_hash.slice(0, 7)} · {snap.file_count} files · {snap.symbol_count} symbols · {snap.workflow_count} workflows
              </span>
            )}
          </span>
        }
        actions={
          canManage && (
            <Button size="sm" onClick={() => setAnalyzeOpen(true)} data-tour="analyze-button">
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

      {controlError && <p className="mb-2 text-xs text-destructive">{controlError}</p>}

      {/* ── Active runs: every queued/running job gets its own card. ── */}
      {activeJobs.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Active runs
            <Badge variant="secondary" className="text-[10px] tabular-nums">{activeJobs.length}</Badge>
          </h2>
          <div className="space-y-2">
            {activeJobs.map((job) => (
              <RunCard
                key={job.id}
                job={job}
                projectId={id!}
                defaultBranch={project.branch}
                canManage={canManage}
                soloRun={activeJobs.length === 1}
                onControl={jobControl}
                controlBusy={controlBusy}
                nowTs={nowTs}
              />
            ))}
          </div>
        </div>
      )}

      {/* Paused / just-failed runs surface here for resume without digging into history. */}
      {activeJobs.length === 0 && pausedOrFailed.length > 0 && (
        <div className="mb-4 space-y-2">
          {pausedOrFailed.map((job) => (
            <Card key={job.id}>
              <CardContent className="flex flex-wrap items-center gap-2 p-3">
                {job.status === "paused"
                  ? <PauseCircle className="h-4 w-4 shrink-0 text-warning" />
                  : <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">
                    {JOB_TYPE_LABEL[job.job_type] ?? job.job_type.replace(/_/g, " ")} {job.status}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      {runConfigParts(job, project.branch).join(" · ")}
                    </span>
                  </p>
                  {job.error_message && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{job.error_message}</p>}
                </div>
                {canManage && ["analyze_scope", "incremental_update", "generate_package"].includes(job.job_type) && (
                  <Button variant="outline" size="xs" onClick={() => jobControl(job.id, "resume")} disabled={controlBusy} title="Re-runs this job — checkpointed phases and cached AI work are skipped">
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Resume run
                  </Button>
                )}
                {canManage && job.status === "failed" && (
                  <Button variant="outline" size="xs" onClick={() => setAnalyzeOpen(true)}>
                    <RefreshCw className="mr-1 h-3 w-3" />
                    New run…
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {neverAnalyzed && (
        <Card className="mb-4">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <h3 className="text-sm font-semibold text-foreground">Not yet analyzed</h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Run the first analysis to build the dependency graph, workflows, and a role-based
              onboarding package — with a cost preview before anything runs.
            </p>
            {canManage && (
              <Button size="sm" className="mt-4" onClick={() => setAnalyzeOpen(true)}>
                <RefreshCw className="h-3.5 w-3.5" />
                Analyze…
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Packages: every (branch, commit, scope, role) package. ── */}
      {(packages?.length ?? 0) > 0 && (
        <div className="mb-4" data-tour="overview-packages">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[13px] font-medium text-foreground">Packages</h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {filteredPackages.length} / {packages!.length}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="h-7 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {ROLES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  {["draft", "approved", "stale", "generating", "failed"].map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={freshFilter} onValueChange={setFreshFilter}>
                <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any commit</SelectItem>
                  <SelectItem value="latest">Latest commit</SelectItem>
                  <SelectItem value="behind">Behind latest</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredPackages.map((card) => (
              <div key={card.id} className={selectedPackageId === card.id ? "rounded-xl ring-2 ring-primary/50" : ""}>
                <PackageCardView
                  card={card}
                  onOpen={() => {
                    // Opening makes it the sidebar selection and pins the
                    // reader to this exact package.
                    selectPackage(card.id);
                    navigate(`/projects/${id}/onboarding?view=reader&package=${card.id}&role=${card.role}`);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Run history: actions taken, sections generated, whole cost. ── */}
      <div className="mb-4" data-tour="run-history">
        <h2 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          Run history
        </h2>
        {runsError && <p className="mb-2 text-xs text-destructive">{runsError}</p>}
        {runs === null ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="space-y-1.5">
            {runs.map((run) => (
              <RunHistoryRow key={run.id} run={run} projectId={id!} />
            ))}
          </div>
        )}
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
