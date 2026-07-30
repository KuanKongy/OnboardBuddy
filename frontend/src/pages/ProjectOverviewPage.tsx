import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
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
import { PageSpinner } from "@/components/ui/page-spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { buildGithubRepoUrl } from "@/lib/githubUrl";
import { ROLE_OPTIONS, roleTitle } from "@/lib/roles";
import { pipelineProgress } from "@/lib/pipelineProgress";
import { useProgress } from "@/lib/useProgress";
import { AnalyzeDialog } from "@/components/AnalyzeDialog";
import { AnalysisRunPanel, PHASE_ORDER, StatusIcon } from "@/components/AnalysisRunPanel";
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
      return `Generated ${role ? `${roleTitle(role)} ` : ""}package${branch ? ` on ${branch}` : ""}`;
    }
    case "regenerate_section":
      // Bug #36: a single-tutorial regeneration shares this job type (the
      // enum is CHECK-constrained and M5 freezes the schema), so the label
      // comes from whichever checkpoint key the run carries.
      if (run.tutorial_title) return `Regenerated tutorial "${run.tutorial_title}"`;
      return `Regenerated section ${(run.section_type ?? run.sections.generated[0] ?? "").replace(/_/g, " ")}`.trim();
    case "preflight":
      return `Preflight preview of ${scope}`;
    default:
      return run.job_type.replace(/_/g, " ");
  }
}

// Green for complete, matching the ProjectCard chip. Not the primary/blue variant —
// blue is this app's info/selected tone, so a finished run would read as highlighted.
function statusBadgeVariant(status: string): "success" | "destructive" | "secondary" {
  return status === "complete" ? "success" : status === "failed" ? "destructive" : "secondary";
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
            <h3 className="text-[0.8125rem] font-medium text-foreground">
              {JOB_TYPE_LABEL[job.job_type] ?? job.job_type.replace(/_/g, " ")}
            </h3>
            {runConfigParts(job, defaultBranch).map((part) => (
              <Badge key={part} variant="outline" className="font-mono text-[0.6875rem]">{part}</Badge>
            ))}
          </div>
          {canManage && (
            <div className="flex shrink-0 items-center gap-1.5">
              {isActive && (
                <>
                  <Tooltip>
                    {/* The span keeps hover working while the button is disabled
                        (disabled buttons swallow pointer events). */}
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-flex">
                        <Button variant="outline" size="xs" onClick={() => onControl(job.id, "pause")} disabled={controlBusy}>
                          <PauseCircle className="mr-1 h-3 w-3" />
                          Pause
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Worker pauses at the next step — completed work is checkpointed</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-flex">
                        <Button variant="outline" size="xs" className="text-destructive hover:text-destructive" onClick={() => onControl(job.id, "stop")} disabled={controlBusy}>
                          <Square className="mr-1 h-3 w-3" />
                          Stop
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Stops the run; completed phases stay cached</TooltipContent>
                  </Tooltip>
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
              <Badge variant="outline" className="text-[0.6875rem] text-muted-foreground" title="The queue re-delivered this run — earlier attempt(s) were interrupted; cached work is not re-paid">
                attempt #{job.attempt}
              </Badge>
            )}
            {job.stalled && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex cursor-help">
                    <Badge variant="destructive" className="text-[0.6875rem]">
                      stalled
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">Running but no worker signal for 2+ minutes — it will be auto-marked failed shortly, then you can resume it</TooltipContent>
              </Tooltip>
            )}
            <Badge variant={statusBadgeVariant(job.status)} className="text-[0.6875rem]">{job.status}</Badge>
          </span>
        </div>
        <Progress value={pct} className="mb-2 h-1.5" />

        {isActive && (
          <p className={`mb-2 text-[0.6875rem] tabular-nums ${job.stalled ? "text-destructive" : "text-muted-foreground"}`}>
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
          <summary className="flex cursor-pointer items-center gap-1 text-[0.6875rem] text-muted-foreground hover:text-foreground">
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

/** Section and tutorial regenerations ride one job type (the enum is
 *  CHECK-constrained); both touch a single item rather than the pipeline. */
function isPartialRun(run: RunHistoryEntry): boolean {
  return run.job_type === "regenerate_section";
}

const PHASE_BY_KEY = new Map(PHASE_ORDER.map((p) => [p.key, p]));

/** The two phases only the summary worker writes; everything before them is
 *  the analysis. The split is what lets a standalone row show its own steps. */
const GENERATION_PHASE_KEYS = ["generation", "validation"];
const ANALYSIS_PHASE_KEYS = PHASE_ORDER.map((p) => p.key).filter((k) => !GENERATION_PHASE_KEYS.includes(k));

const ANALYZE_JOB_TYPES = ["analyze_scope", "incremental_update"];

/**
 * Which pipeline phases a history row may claim. Phase rows hang off the
 * SNAPSHOT, so every full run used to be shown all 16 — an analysis credited
 * with generating the package, and a package generation credited with the
 * analysis that built its snapshot. A merged pair genuinely ran both halves,
 * so it keeps the full list; undefined = no filter.
 */
export function runPhaseKeys(jobType: string, merged: boolean): string[] | undefined {
  if (merged) return undefined;
  if (jobType === "generate_package") return GENERATION_PHASE_KEYS;
  if (ANALYZE_JOB_TYPES.includes(jobType)) return ANALYSIS_PHASE_KEYS;
  return undefined;
}

/** The worker stamps citation validation at 93% and everything before it
 *  lower (summaryWorker's `updateJob` calls), so the run row's own
 *  progress_pct is enough to place a partial run inside its step list. */
const VALIDATION_PCT = 93;

/**
 * The steps a regeneration ACTUALLY runs.
 *
 * A section regeneration validates its citations inline (`generateSection` →
 * `validateGeneratedOutput`), so two steps are the truth. A single-tutorial
 * regeneration has no citation pass anywhere on its path — listing one would
 * advertise work that never happens.
 */
export function partialRunSteps(run: Pick<RunHistoryEntry, "tutorial_title">): Array<{ label: string; desc: string }> {
  if (run.tutorial_title) {
    return [{
      label: "Generate tutorial",
      desc: "Rebuilds this one walkthrough from the traced flow — nothing else in the package is touched or paid for",
    }];
  }
  return GENERATION_PHASE_KEYS.map((key) => {
    const phase = PHASE_BY_KEY.get(key)!;
    return { label: phase.label, desc: phase.desc };
  });
}

/** How far a partial run got, from the run row alone — its snapshot's phases
 *  describe the analysis that built it, not this run. */
export function partialStepStatuses(
  run: Pick<RunHistoryEntry, "status" | "progress_pct">,
  stepCount: number,
): string[] {
  if (run.status === "complete") return Array.from({ length: stepCount }, () => "complete");
  // The guards that fail before generating anything still report 100% ("this
  // section is from a previous layout", "this flow can't be rebuilt"), so a
  // failed run at 100 blames the first step rather than crediting a step that
  // never ran.
  const active = run.status === "failed" && run.progress_pct >= 100
    ? 0
    : run.progress_pct >= VALIDATION_PCT
      ? stepCount - 1
      : 0;
  // 'queued' has no icon of its own, and "about to run" reads as the spinner.
  const activeStatus = run.status === "queued" ? "running" : run.status;
  return Array.from({ length: stepCount }, (_, i) =>
    i < active ? "complete" : i === active ? activeStatus : "pending",
  );
}

/** The pipeline panel's phase rows, cut down to the steps this one run
 *  performed — a regeneration's own record instead of the snapshot's. */
function PartialRunSteps({ run }: { run: RunHistoryEntry }) {
  const steps = partialRunSteps(run);
  const statuses = partialStepStatuses(run, steps.length);
  return (
    <div className="rounded-md border border-border bg-muted/25 px-3 py-2">
      <p className="mb-1.5 text-[0.65625rem] text-muted-foreground">
        Steps this run performed — a regeneration replaces one item, so the rest of the pipeline never re-runs.
      </p>
      <ol className="space-y-0.5">
        {steps.map((step, i) => {
          const status = statuses[i] ?? "pending";
          return (
            <li key={step.label} className="flex items-center gap-2.5 py-0.5">
              <StatusIcon status={status} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className={`w-44 shrink-0 cursor-help text-[0.75rem] ${status === "running" ? "font-medium text-foreground" : status === "pending" ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {step.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-left">{step.desc}</TooltipContent>
              </Tooltip>
              <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground">
                {status === "running" ? run.current_step ?? "working…" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A history row: one run, plus the package generation the worker chained onto
 *  it when there was one. */
export interface RunHistoryRowData {
  run: RunHistoryEntry;
  partner: RunHistoryEntry | null;
}

/**
 * How far apart a legacy `generate_package` may sit from the analysis that
 * chained it. Rows written before `chainedFrom` existed carry no link at all,
 * and the worker enqueues the generation within milliseconds of marking the
 * analysis complete — 90s is slack for a queue that is busy, and far below the
 * gap to any package a person asked for afterwards.
 */
const LEGACY_CHAIN_WINDOW_MS = 90_000;

/** The unclaimed analysis this legacy generation most plausibly belongs to. */
function legacyChainPartner(
  gen: RunHistoryEntry,
  runs: RunHistoryEntry[],
  claimed: Set<string>,
): RunHistoryEntry | undefined {
  const genStart = Date.parse(gen.created_at);
  let best: RunHistoryEntry | undefined;
  let bestGap = LEGACY_CHAIN_WINDOW_MS;
  for (const candidate of runs) {
    if (!ANALYZE_JOB_TYPES.includes(candidate.job_type)) continue;
    if (claimed.has(candidate.id)) continue;
    // Same snapshot is the hard requirement — a generation always runs against
    // the snapshot its analysis produced (or reused). Note that a re-analysis
    // of the same commit REUSES the snapshot, so several analyses on this page
    // can share one snapshot id; timing is what separates them.
    if (!candidate.snapshot_id || candidate.snapshot_id !== gen.snapshot_id) continue;
    // The worker only chains off an analysis it has already marked complete,
    // so nothing else can be the other half of a pair.
    if (candidate.status !== "complete" || !candidate.finished_at) continue;
    // Directional, not absolute: the chained row is inserted right AFTER the
    // analysis is marked finished (22–115ms, measured on live rows). Allowing
    // the other direction would swallow a package a user asked for WHILE a
    // re-analysis of that same snapshot was still running.
    const gap = genStart - Date.parse(candidate.finished_at);
    // NaN (unparseable timestamp) fails both comparisons — no merge, which is
    // the safe direction: a wrong merge hides a run, a missed one repeats it.
    if (gap >= 0 && gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Pair each auto-chained package generation with its analysis so the two render
 * as ONE row. Before this, an analyze run and the generation it triggered were
 * two rows expanding to the same 16 phases — indistinguishable from a repo that
 * had been analyzed twice, and from a package that had been paid for twice.
 *
 * A generation whose partner is not on this page (pagination straddle — rare,
 * since a pair sorts adjacently) stays standalone rather than being merged into
 * whatever else is nearby.
 */
export function groupChainedRuns(runs: RunHistoryEntry[]): RunHistoryRowData[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const claimed = new Set<string>();
  const partnerOf = new Map<string, RunHistoryEntry>();
  const mergedAway = new Set<string>();

  const pair = (analyze: RunHistoryEntry, gen: RunHistoryEntry) => {
    claimed.add(analyze.id);
    partnerOf.set(analyze.id, gen);
    mergedAway.add(gen.id);
  };

  const generations = runs.filter((r) => r.job_type === "generate_package");

  // Stored links first, so a guess can never claim the analysis a later row
  // names outright.
  for (const gen of generations) {
    if (!gen.chained_from) continue;
    const linked = byId.get(gen.chained_from);
    if (linked && ANALYZE_JOB_TYPES.includes(linked.job_type) && !claimed.has(linked.id)) pair(linked, gen);
  }
  // Only rows predating the key fall back to adjacency: a row that HAS a link
  // and cannot find it must not be adopted by a different analysis.
  for (const gen of generations) {
    if (gen.chained_from) continue;
    const analyze = legacyChainPartner(gen, runs, claimed);
    if (analyze) pair(analyze, gen);
  }

  // Emitted at the ANALYSIS's position: the merged row is stamped with the
  // analysis's created_at, so the list stays ordered by what it displays.
  return runs
    .filter((run) => !mergedAway.has(run.id))
    .map((run) => ({ run, partner: partnerOf.get(run.id) ?? null }));
}

/** Combined spend of a merged pair — the analysis and its package together are
 *  what the user asked for, so one figure is what they are owed. */
export function sumRunCost(a: RunHistoryEntry["cost"], b: RunHistoryEntry["cost"]): RunHistoryEntry["cost"] {
  return {
    estimated_cost_usd: a.estimated_cost_usd + b.estimated_cost_usd,
    llm_calls: a.llm_calls + b.llm_calls,
    cached_calls: a.cached_calls + b.cached_calls,
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  };
}

/** One badge for the pair: the worst thing that happened to either half. An
 *  analysis whose package generation failed is not a complete run. */
export function mergedRunStatus(a: string, b: string): string {
  const order = ["failed", "paused", "running", "queued", "complete"];
  const rank = (s: string) => {
    const i = order.indexOf(s);
    return i === -1 ? order.length : i;
  };
  return rank(a) <= rank(b) ? a : b;
}

/** Sum of two durations, still null when neither half recorded one. */
function sumDuration(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function RunHistoryRow({ run, partner, projectId }: { run: RunHistoryEntry; partner: RunHistoryEntry | null; projectId: string }) {
  const [open, setOpen] = useState(false);
  // A merged pair speaks as one run: combined spend, combined duration, the
  // analysis's own config and timestamp (it is the action the user took).
  const cost = partner ? sumRunCost(run.cost, partner.cost) : run.cost;
  const status = partner ? mergedRunStatus(run.status, partner.status) : run.status;
  const durationMs = partner ? sumDuration(run.duration_ms, partner.duration_ms) : run.duration_ms;
  const errors = [run.error_message, partner?.error_message ?? null].filter((m): m is string => !!m);
  const sections = partner
    ? {
        generated: [...new Set([...run.sections.generated, ...partner.sections.generated])],
        cached: [...new Set([...run.sections.cached, ...partner.sections.cached])],
      }
    : run.sections;
  const stepLog = partner ? [...run.step_log, ...partner.step_log] : run.step_log;
  const hasCost = cost.llm_calls > 0 || cost.cached_calls > 0 || cost.estimated_cost_usd > 0;

  return (
    <details
      className="rounded-md border border-border/70 bg-card px-3 py-2"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
        <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{runActionLabel(run)}</span>
        <span className="flex shrink-0 items-center gap-2 text-[0.6875rem] tabular-nums text-muted-foreground">
          {hasCost && (
            <span
              title={partner
                ? `This analysis and the package it generated. ${cost.cached_calls} calls were served from cache at $0.`
                : `This run only. ${cost.cached_calls} calls were served from cache at $0.`}
            >
              ${cost.estimated_cost_usd.toFixed(4)} · {cost.llm_calls} calls
              {cost.input_tokens > 0 || cost.output_tokens > 0
                ? ` · ${cost.input_tokens.toLocaleString()} in / ${cost.output_tokens.toLocaleString()} out tok`
                : ""}
              {cost.cached_calls > 0 ? ` · ${cost.cached_calls} cached` : ""}
            </span>
          )}
          {durationMs !== null && <span>{formatDuration(durationMs)}</span>}
          <span>{new Date(run.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <Badge variant={statusBadgeVariant(status)} className="text-[0.6875rem]">{status}</Badge>
        </span>
      </summary>

      <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
          {run.config.branch && <Badge variant="outline" className="font-mono text-[0.6875rem]">branch {run.config.branch}</Badge>}
          {run.config.commit && <Badge variant="outline" className="font-mono text-[0.6875rem]">commit {run.config.commit.slice(0, 7)}</Badge>}
          {run.config.scope_path && <Badge variant="outline" className="font-mono text-[0.6875rem]">scope {run.config.scope_path}/</Badge>}
          {run.config.depth && <Badge variant="outline" className="font-mono text-[0.6875rem]">{run.config.depth} depth</Badge>}
          {run.config.role && <Badge variant="outline" className="font-mono text-[0.6875rem]">{run.config.role} role</Badge>}
          {run.requested_by_email && <span>by {run.requested_by_email}</span>}
          {run.attempt > 1 && <span>attempt #{run.attempt}</span>}
          {/* The package half retrying is its own fact — inside a merged row it
              would otherwise vanish behind the analysis's attempt count. */}
          {partner && partner.attempt > 1 && <span>package attempt #{partner.attempt}</span>}
        </div>

        {errors.map((message, i) => (
          <p key={i} className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[0.6875rem] text-destructive">
            {message}
          </p>
        ))}

        {(sections.generated.length > 0 || sections.cached.length > 0) && (
          <div className="space-y-1 text-[0.6875rem]">
            {sections.generated.length > 0 && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Generated:</span>{" "}
                {sections.generated.map((s) => s.replace(/_/g, " ")).join(", ")}
              </p>
            )}
            {sections.cached.length > 0 && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">From cache:</span>{" "}
                {sections.cached.map((s) => s.replace(/_/g, " ")).join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Budgets cap ONE run, so this row talks about one run only. The
            project-wide total moved to Project Settings — a lifetime figure
            inside a single run's row was read as that run's spend. In a merged
            row the cap is still the ANALYSIS's, named as such: the call count
            above covers both halves, and two numbers that disagree without
            saying why is how a truthful figure gets read as a bug. */}
        {run.job_type !== "preflight" && (
          <p className="text-[0.6875rem] text-muted-foreground">
            {run.budget.usedThisRun === null ? (
              <>
                <span className="font-medium text-foreground">Budget:</span>{" "}
                cap {run.budget.capLlmCalls.toLocaleString()} calls per run · usage not recorded
                {run.budget.note ? ` (${run.budget.note})` : ""}
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">Budget:</span>{" "}
                {run.budget.usedThisRun.toLocaleString()} of {run.budget.capLlmCalls.toLocaleString()} calls used
                {partner ? " by the analysis" : " this run"}
                {run.budget.remaining !== null && ` · ${run.budget.remaining.toLocaleString()} left`}
                {partner && partner.budget.usedThisRun !== null
                  ? ` · package ${partner.budget.usedThisRun.toLocaleString()} of ${partner.budget.capLlmCalls.toLocaleString()}`
                  : ""}
              </>
            )}
          </p>
        )}

        {!hasCost && run.job_type !== "preflight" && (
          <p className="text-[0.6875rem] text-muted-foreground">
            No per-run cost recorded (run predates cost tracking, or it was fully deterministic).
          </p>
        )}

        {stepLog.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
            {stepLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5">
                <span className="flex-1 text-[0.6875rem] text-muted-foreground">{entry.step}</span>
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">
                  {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* A full run gets the pipeline panel (mounting — and fetching — only
            while the row is open), cut down to the phases it is accountable
            for: a merged pair ran all 16, an analysis alone stops before
            generation. A regeneration gets neither — the panel showed it the
            16 phases of the analysis that had built the snapshot, i.e. someone
            else's work billed to a run that rewrote one section. */}
        {open && (isPartialRun(run)
          ? <PartialRunSteps run={run} />
          : (run.snapshot_id ?? partner?.snapshot_id) ? (
            <AnalysisRunPanel
              projectId={projectId}
              snapshotId={run.snapshot_id ?? partner?.snapshot_id ?? null}
              isActive={false}
              currentStep={null}
              stepLog={[]}
              phaseKeys={runPhaseKeys(run.job_type, partner !== null)}
            />
          ) : null)}
      </div>
    </details>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────

/**
 * One overview shortcut — a link when there is somewhere to go, and an inert
 * card carrying the reason when there is not.
 *
 * The three cards used to be three near-identical copies of the same markup
 * that always rendered as links, which is how a failed project came to offer
 * "Start reading" into an empty reader directly under a banner saying the run
 * had failed.
 */
function QuickAction({
  icon: Icon,
  iconTone,
  title,
  cta,
  to,
  unavailableReason,
  pending,
  onNavigate,
}: {
  icon: typeof BookOpen;
  /** Utility classes for the icon tile ("bg-primary/10 text-primary"). */
  iconTone: string;
  title: string;
  cta: string;
  /** Null when the destination holds nothing yet. */
  to: string | null;
  unavailableReason?: string;
  pending?: boolean;
  onNavigate?: () => void;
}) {
  const body = (
    <Card className={`h-full ${to ? "transition-colors group-hover:border-primary/40" : ""}`}>
      <CardContent className="flex items-center gap-3 p-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconTone}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[0.8125rem] font-medium text-foreground">{title}</h2>
          {to ? (
            <span className="inline-flex items-center gap-1 truncate text-xs font-medium text-primary">
              {cta}
              {pending
                ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                : <ArrowRight className="h-3 w-3 shrink-0" />}
            </span>
          ) : (
            <span className="block truncate text-xs text-muted-foreground">{unavailableReason}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (!to) return <div className="rounded-xl opacity-75">{body}</div>;
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-disabled={pending}
      className={`group block rounded-xl ${pending ? "pointer-events-none opacity-70" : ""}`}
    >
      {body}
    </Link>
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
    selectedPackage,
    status: analysisStatus,
    refreshStatus,
    activeJobs,
    registerSessionJob,
    packagesError,
    statusError,
  } = usePackages();
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [pendingQuickAction, setPendingQuickAction] = useState<"onboarding" | "tutorial" | "role" | null>(null);

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

  /**
   * Paused / failed runs that are still the newest word on their kind of work.
   *
   * "Package generation paused" sat above a run history whose newest
   * `generate_package` rows read `complete`, on two projects — the old filter
   * surfaced EVERY paused job regardless of what had happened since, so one
   * abandoned run kept warning about a pipeline that had been re-run and
   * finished twice. A banner is a claim about the current state, so it derives
   * from the newest run of that job type and nothing else. Older pauses and
   * failures are history, and the run history below is where history lives.
   */
  const pausedOrFailed = (() => {
    const jobs = analysisStatus?.jobs ?? [];
    // The API sorts active runs to the front, so re-sort by age to find which
    // job is genuinely the latest of its type.
    const newestOfType = new Map<string, string>();
    for (const job of [...jobs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )) {
      if (!newestOfType.has(job.job_type)) newestOfType.set(job.job_type, job.id);
    }
    return jobs.filter(
      (j) => (j.status === "paused" || j.status === "failed") && newestOfType.get(j.job_type) === j.id,
    );
  })();

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
  const loadError = packagesError || statusError;

  /**
   * What the quick actions are allowed to promise.
   *
   * A failed project still offered "Start reading" into an empty reader and
   * "Start a tutorial" into an empty list, under a banner telling the reader to
   * run the analysis again. An action that lands on nothing is worse than no
   * action: it reads as a broken page rather than as a project without content
   * yet. Both are now derived from what actually exists.
   */
  const hasReadablePackage = (packages ?? []).some((p) => p.status !== "failed" && p.section_count > 0);
  const hasTutorials = (packages ?? []).some((p) => p.tutorial_count > 0);
  const contentPending = activeJobs.length > 0;
  /** Why an action is unavailable, in the reader's terms. */
  const noContentReason = contentPending
    ? "Being generated by the run above"
    : canManage
      ? "Run an analysis to generate it"
      : "No package has been generated yet";

  // What this page is currently describing. The sidebar chooser wins when a
  // package is pinned (M3 — the header used to say "latest: …" no matter what
  // was selected); otherwise it is the newest complete analysis.
  const viewedBranch = selectedPackage?.branch ?? snap?.branch ?? project.branch;
  const viewedCommit = selectedPackage?.analyzed_commit ?? snap?.commit_hash ?? null;
  const viewedRefLabel = viewedCommit ? `${viewedBranch}@${viewedCommit.slice(0, 7)}` : viewedBranch;
  // Counts belong to the snapshot, so only print them when the thing being
  // viewed IS that snapshot — otherwise they would describe a different commit.
  const countsMatchView = !!snap && (!selectedPackage || selectedPackage.analyzed_commit === snap.commit_hash);
  const repoUrl = buildGithubRepoUrl(
    { owner: project.repo_owner, repo: project.repo_name, branch: project.branch },
    { ref: viewedCommit },
  );

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {/* M1: the analysed repository, as a real link, pinned to the
                commit this page is describing rather than to a moving branch. */}
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${project.repo_owner}/${project.repo_name} on GitHub at ${viewedRefLabel}`}
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:underline"
            >
              {project.repo_owner}/{project.repo_name}
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
            <Badge variant="outline" className="text-[0.6875rem] capitalize">{project.developer_role}</Badge>
            {viewedCommit && (
              <span className="font-mono text-[0.6875rem] text-muted-foreground">
                {selectedPackage ? "viewing" : "latest"}: {viewedRefLabel}
                {countsMatchView && ` · ${snap!.file_count} files · ${snap!.symbol_count} symbols · ${snap!.workflow_count} workflows`}
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

      {/* Quick actions: flat rows — icon left, text right. Whole card is a
          Link (not just the inner text) so the hover affordance matches the
          clickable area; a brief pending state covers the click-to-route gap.
          A card whose destination is empty says so instead of linking there. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <QuickAction
          icon={BookOpen}
          iconTone="bg-primary/10 text-primary"
          title={onboardingProgress ? "Continue onboarding" : "Onboarding"}
          cta={
            onboardingProgress
              ? `Resume — ${((onboardingProgress.position.sectionType as string) ?? "").replace(/-/g, " ") || "where you left off"}`
              : "Start reading"
          }
          to={hasReadablePackage ? onboardingResumeLink : null}
          unavailableReason={noContentReason}
          pending={pendingQuickAction === "onboarding"}
          onNavigate={() => setPendingQuickAction("onboarding")}
        />

        <QuickAction
          icon={Play}
          iconTone="bg-info/10 text-info"
          // The heading matched the action it offered on exactly one of the two
          // states: "Continue tutorial" over a link reading "Start a tutorial".
          title={tutorialProgress ? "Continue tutorial" : "Tutorials"}
          cta={
            tutorialProgress
              ? `Resume — step ${(tutorialProgress.position.stepOrder as number) ?? 1}${tutorialProgress.title ? ` of ${tutorialProgress.title}` : ""}`
              : "Start a tutorial"
          }
          to={hasTutorials ? tutorialResumeLink : null}
          unavailableReason={
            contentPending
              ? "Being generated by the run above"
              : hasReadablePackage
                ? "No tutorial was built from this snapshot"
                : noContentReason
          }
          pending={pendingQuickAction === "tutorial"}
          onNavigate={() => setPendingQuickAction("tutorial")}
        />

        <QuickAction
          icon={User}
          iconTone="bg-warning/10 text-warning"
          title={`${roleTitle(project.developer_role)} role`}
          cta="View team"
          to={`/projects/${id}/team`}
          pending={pendingQuickAction === "role"}
          onNavigate={() => setPendingQuickAction("role")}
        />
      </div>

      {controlError && <p className="mb-2 text-xs text-destructive">{controlError}</p>}

      {/* ── Active runs: every queued/running job gets its own card. ── */}
      {activeJobs.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 flex items-center gap-2 text-[0.8125rem] font-medium text-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Active runs
            <Badge variant="secondary" className="text-[0.6875rem] tabular-nums">{activeJobs.length}</Badge>
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
          {pausedOrFailed.map((job) => {
            // A budget pause is only actionable if the banner says how much
            // of the per-run cap was actually spent — the run-history row for
            // this same job already carries those numbers.
            const jobRun = runs?.find((r) => r.id === job.id) ?? null;
            const jobBudget = jobRun?.budget ?? null;
            const jobCost = jobRun?.cost ?? null;
            return (
            <Card key={job.id}>
              <CardContent className="flex flex-wrap items-center gap-2 p-3">
                {job.status === "paused"
                  ? <PauseCircle className="h-4 w-4 shrink-0 text-warning" />
                  : <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">
                    {JOB_TYPE_LABEL[job.job_type] ?? job.job_type.replace(/_/g, " ")} {job.status}
                    <span className="ml-2 font-mono text-[0.6875rem] text-muted-foreground">
                      {runConfigParts(job, project.branch).join(" · ")}
                    </span>
                  </p>
                  {job.error_message && <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">{job.error_message}</p>}
                  {jobBudget && jobBudget.usedThisRun !== null && (
                    <p className="mt-0.5 text-[0.6875rem] tabular-nums text-muted-foreground">
                      {jobBudget.usedThisRun.toLocaleString()} of {jobBudget.capLlmCalls.toLocaleString()} calls used this run
                      {jobBudget.remaining !== null && ` · ${jobBudget.remaining.toLocaleString()} left`}
                      {jobCost && (jobCost.input_tokens > 0 || jobCost.output_tokens > 0)
                        ? ` · ${jobCost.input_tokens.toLocaleString()} in / ${jobCost.output_tokens.toLocaleString()} out tok`
                        : ""}
                    </p>
                  )}
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
            );
          })}
        </div>
      )}

      {/* Outside the neverAnalyzed branch: an analyzed project whose packages fetch
          failed renders an empty grid, indistinguishable from "nothing generated
          yet". Same error-with-retry shape as the run-history card below. */}
      {loadError && (
        <div
          className="mb-4 flex flex-col items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-3"
          role="alert"
        >
          <p className="text-xs text-danger">
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
            Couldn&apos;t load this project&apos;s packages and analysis status — what you see below
            may be incomplete.
          </p>
          <Button
            size="xs"
            variant="outline"
            className="gap-1.5"
            onClick={() => { refreshPackages(); void refreshStatus(); }}
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
      )}

      {neverAnalyzed && !loadError && (
        <Card className="mb-4">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <h2 className="text-sm font-semibold text-foreground">Not yet analyzed</h2>
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
            <h2 className="text-[0.8125rem] font-medium text-foreground">
              {packages!.length === 1 ? "Package" : "Packages"}
            </h2>
            {/* "1 / 1 packages" above three dropdowns and a single card is
                furniture describing itself. The count appears once there is
                something to count, and the filters once there is something to
                filter. */}
            {packages!.length > 1 && (
              <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                {filteredPackages.length} / {packages!.length}
              </span>
            )}
            <div className={`ml-auto flex-wrap items-center gap-1.5 ${packages!.length > 1 ? "flex" : "hidden"}`}>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger aria-label="Filter packages by role" className="h-7 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.title}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label="Filter packages by status" className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  {["draft", "approved", "stale", "generating", "failed"].map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={freshFilter} onValueChange={setFreshFilter}>
                <SelectTrigger aria-label="Filter packages by commit" className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any commit</SelectItem>
                  <SelectItem value="latest">Latest commit</SelectItem>
                  <SelectItem value="behind">Behind latest</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* A lone package gets a readable column rather than a third of a
              wide row with two empty columns beside it. */}
          <div className={packages!.length === 1 ? "max-w-md" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"}>
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
        <h2 className="mb-2 flex items-center gap-2 text-[0.8125rem] font-medium text-foreground">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          Run history
        </h2>
        {/* Bug #68: the error line rendered ABOVE a spinner that never
            resolved, because a failed fetch leaves `runs` at null forever.
            The failure is now the whole state, with a retry — a spinner that
            spins after the request already lost is worse than no spinner. */}
        {runsError ? (
          <div
            className="flex flex-col items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-3"
            role="alert"
          >
            <p className="text-xs text-danger">
              <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
              Couldn&apos;t load run history — {runsError}
            </p>
            <Button size="xs" variant="outline" className="gap-1.5" onClick={loadRuns}>
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        ) : runs === null ? (
          <PageSpinner className="py-8" iconClassName="h-4 w-4" label="Loading run history" />
        ) : runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="space-y-1.5">
            {groupChainedRuns(runs).map(({ run, partner }) => (
              <RunHistoryRow key={run.id} run={run} partner={partner} projectId={id!} />
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
