import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  ExternalLink,
  FileCode2,
  FlaskConical,
  HelpCircle,
  Loader2,
  PlayCircle,
  Route as RouteIcon,
  Terminal,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { CodeSnippet, type HighlightRange } from "@/components/CodeSnippet";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useProject } from "@/contexts/ProjectContext";
import { usePackages } from "@/contexts/PackagesContext";
import { apiFetch } from "@/lib/api";
import { useProgress } from "@/lib/useProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildGithubBlobUrl, type GithubRepoRef } from "@/lib/githubUrl";

/**
 * Tutorials — procedures, not prose.
 *
 * The graded complaint was that a tutorial had "no difference with writing
 * sections", and the rendering was half the reason: a step was a paragraph
 * beside a snippet, which is exactly what a section looks like. A step here is
 * three separate, differently-shaped things — DO / YOU SHOULD SEE / CHECK IT
 * WORKED — because a reader has to be able to stop at any step and answer "did
 * that work?" without reading anything twice.
 *
 * Steps generated before the procedural rewrite carry only `explanation`, so
 * every procedural field is nullable and the old rendering is the fallback.
 */

type ProcedureKind = "run_it" | "run_tests" | "trace_flow";

interface TutorialSummary {
  id: string;
  title: string;
  summary: string;
  /** "After this, you can …" — the concrete thing the reader can then do. */
  goal: string | null;
  status: string;
  confidence: string;
  trigger_type: string | null;
  tier?: string | null;
  package_role: string | null;
  step_count: number;
  procedure_kind?: ProcedureKind | string | null;
}

interface TutorialStep {
  id: string;
  step_order: number;
  file_path: string;
  symbol_name: string | null;
  line_start: number | null;
  line_end: number | null;
  snippet: string | null;
  /** The model's one-sentence note on why this step is here. Often empty. */
  explanation: string;
  /** Procedural fields — null on tutorials generated before the rewrite. */
  kind?: string | null;
  action?: string | null;
  command?: string | null;
  expected?: string | null;
  verify?: string | null;
  verify_command?: string | null;
  evidence?: string | null;
  receipts: Array<{
    id: string;
    trust_level: string;
    file_path: string | null;
    line_start: number | null;
    line_end: number | null;
  }>;
}

interface TutorialDetail {
  tutorial: TutorialSummary & { unknowns: Array<{ kind: string; detail?: string | null }> };
  steps: TutorialStep[];
}

/** Why the tab is showing what it is showing — including nothing. */
interface Coverage {
  cap: number | null;
  capBinding: boolean;
  considered: number;
  eligible: number | null;
  emitted: number;
  byTier: { core: number; supporting: number; surface: number };
  runnable: { start: boolean; tests: boolean; compose: string | null };
  skipped: Array<{ title: string; reason: string; detail: string }>;
  overflow: Array<{ title: string; kind: string }>;
  reasons: string[];
}

type StepReceipt = TutorialStep["receipts"][number];

/** The receipt's absolute line range, when it points into this step's snippet. */
function hoverRangeFor(step: TutorialStep, receipt: StepReceipt | null): HighlightRange[] | undefined {
  if (!receipt || receipt.file_path !== step.file_path || receipt.line_start == null) return undefined;
  const start = receipt.line_start;
  const end = receipt.line_end ?? receipt.line_start;
  const stepStart = step.line_start ?? 1;
  const stepEnd = step.line_end ?? Number.MAX_SAFE_INTEGER;
  if (end < stepStart || start > stepEnd) return undefined;
  return [{ start, end }];
}

/** Deterministic workflow steps: the AI-free fallback walkthrough. */
interface WorkflowSummary {
  id: string;
  title: string;
  trigger_type: string;
  purpose: string;
  step_count: number;
}
interface WorkflowStep {
  id: string;
  step_order: number;
  file_path: string;
  symbol_name: string | null;
  line_start: number | null;
  line_end: number | null;
  explanation: string | null;
  step_kind: string | null;
  deterministic_description: string | null;
}

/** "worker/engine/repoIngester.ts" -> "repoIngester.ts" */
function stepName(step: { symbol_name?: string | null; file_path: string }): string {
  return step.symbol_name ?? step.file_path.split("/").pop() ?? step.file_path;
}

/** The rail label: what you DO at this step, not what file it lives in. */
function stepLabel(step: TutorialStep): string {
  if (!step.action) return stepName(step);
  const words = step.action.replace(/`/g, "").split(/\s+/);
  return words.slice(0, 5).join(" ") + (words.length > 5 ? "…" : "");
}

const PROCEDURE_META: Record<ProcedureKind, { label: string; icon: typeof PlayCircle; blurb: string }> = {
  run_it: { label: "Run it", icon: PlayCircle, blurb: "Bring the stack up and confirm it answers." },
  run_tests: { label: "Tests", icon: FlaskConical, blurb: "Run the suite and see which test guards what." },
  trace_flow: { label: "Trace", icon: Eye, blurb: "Watch one real flow execute and prove where it goes." },
};

const STEP_KIND_LABEL: Record<string, string> = {
  setup: "Set up",
  run: "Run",
  inspect: "Read",
  edit: "Edit",
  trigger: "Trigger",
  observe: "Observe",
  revert: "Undo",
};

/** A command the reader is meant to run, with a real copy button. */
function CommandLine({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context / denied) — the text is selectable */
    }
  };

  return (
    <div className="flex items-stretch gap-1 rounded-md border border-border bg-muted/50">
      <Terminal className="ml-2 mt-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-1 py-1.5 font-mono text-[0.75rem] text-foreground">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="shrink-0 rounded-r-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function StepLocation({
  step,
  repo,
}: {
  step: { file_path: string; symbol_name: string | null; line_start: number | null; line_end: number | null; step_kind?: string | null };
  repo?: GithubRepoRef;
}) {
  const githubUrl = repo
    ? buildGithubBlobUrl(repo, step.file_path, { lineStart: step.line_start, lineEnd: step.line_end })
    : null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
      <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {githubUrl ? (
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={step.file_path}
            className="inline-flex max-w-full items-center gap-1 truncate font-mono text-[0.8125rem] text-foreground hover:underline"
          >
            <span className="min-w-0 truncate">{step.file_path}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
          </a>
        ) : (
          <p className="truncate font-mono text-[0.8125rem] text-foreground" title={step.file_path}>{step.file_path}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {step.symbol_name && (
            <span className="flex items-center gap-1">
              <Code2 className="h-3 w-3" />
              {step.symbol_name}
            </span>
          )}
          {step.line_start && (
            <span className="tabular-nums">
              Lines {step.line_start}{step.line_end ? `–${step.line_end}` : ""}
            </span>
          )}
          {step.step_kind && <Badge variant="secondary" className="text-[0.625rem] uppercase">{step.step_kind.replace(/_/g, " ")}</Badge>}
        </div>
      </div>
    </div>
  );
}

function StepPager({
  current,
  total,
  labels,
  onPrev,
  onNext,
  onJump,
}: {
  current: number;
  total: number;
  /** Per-step names — the rail was 21 anonymous dots. */
  labels?: string[];
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline" className="shrink-0 text-xs tabular-nums">
          Step {current + 1} of {total}
        </Badge>
        {labels?.[current] && (
          <span className="truncate text-xs text-muted-foreground" title={labels[current]}>
            {labels[current]}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              onClick={() => onJump(i)}
              aria-label={labels?.[i] ? `Go to step ${i + 1}: ${labels[i]}` : `Go to step ${i + 1}`}
              title={labels?.[i] ? `${i + 1}. ${labels[i]}` : undefined}
              className="flex h-6 w-6 items-center justify-center"
            >
              <span
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === current ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60",
                )}
              />
            </button>
          ))}
        </div>
        <Button variant="outline" size="xs" disabled={current === 0} onClick={onPrev} aria-label="Previous step">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="xs" disabled={current >= total - 1} onClick={onNext} aria-label="Next step">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * One step of a procedure. The three blocks are visually distinct on purpose:
 * an action you perform, a result you compare against, and a check you can
 * run. Collapsing them into one paragraph is what made the old tutorials
 * indistinguishable from a section.
 */
function ProcedureStepCard({ step, repo }: { step: TutorialStep; repo?: GithubRepoRef }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-3">
        <p className="section-label mb-1 flex items-center gap-1.5 text-primary">
          <Terminal className="h-3 w-3" /> Do this
          {step.kind && STEP_KIND_LABEL[step.kind] && (
            <Badge variant="outline" className="ml-1 text-[0.625rem] uppercase">{STEP_KIND_LABEL[step.kind]}</Badge>
          )}
        </p>
        <p className="text-[0.8125rem] leading-relaxed text-foreground">{step.action}</p>
        {step.command && (
          <div className="mt-2">
            <CommandLine command={step.command} label="command" />
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border px-4 py-3">
          <p className="section-label mb-1 flex items-center gap-1.5">
            <Eye className="h-3 w-3" /> You should see
          </p>
          <p className="text-[0.78125rem] leading-relaxed text-muted-foreground">
            {step.expected || "No observable result was recorded for this step."}
          </p>
        </div>
        <div className="rounded-lg border border-success/40 bg-success-soft px-4 py-3">
          <p className="section-label mb-1 flex items-center gap-1.5 text-success">
            <CheckCircle2 className="h-3 w-3" /> Check it worked
          </p>
          <p className="text-[0.78125rem] leading-relaxed text-muted-foreground">
            {step.verify || "No verification was recorded for this step."}
          </p>
          {step.verify_command && (
            <div className="mt-2">
              <CommandLine command={step.verify_command} label="verification command" />
            </div>
          )}
        </div>
      </div>

      <StepLocation step={{ ...step, step_kind: null }} repo={repo} />
      {step.explanation && (
        <p className="border-l-2 border-border pl-3 text-[0.78125rem] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Why: </span>{step.explanation}
        </p>
      )}
    </div>
  );
}

/** The cap, the skips and the overflow — what this tab is NOT showing, and why. */
function CoverageNote({ coverage }: { coverage: Coverage }) {
  const [open, setOpen] = useState(false);
  const hasDetail = coverage.skipped.length > 0 || coverage.overflow.length > 0;
  if (!coverage.capBinding && !hasDetail) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.71875rem] text-muted-foreground">
        <HelpCircle className="h-3.5 w-3.5 shrink-0" />
        {coverage.capBinding && coverage.eligible != null ? (
          <span>
            <strong className="text-foreground">{coverage.eligible}</strong> procedures could be built from this
            repository; the <strong className="text-foreground">{coverage.emitted}</strong> strongest are shown
            {coverage.cap != null ? ` (the cap is ${coverage.cap})` : ""}.
          </span>
        ) : (
          <span>
            {coverage.emitted} of {coverage.considered} traced flows could become a runnable procedure.
          </span>
        )}
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="font-medium text-primary hover:underline"
          >
            {open ? "Hide the rest" : "Show what was left out"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {coverage.overflow.map((o, i) => (
            <p key={`o-${i}`} className="text-[0.6875rem] text-muted-foreground">
              <span className="text-foreground">{o.title}</span> — a valid {o.kind.replace(/_/g, " ")} procedure, dropped by the cap.
            </p>
          ))}
          {coverage.skipped.map((s, i) => (
            <p key={`s-${i}`} className="text-[0.6875rem] text-muted-foreground">
              <span className="text-foreground">{s.title}</span> — {s.detail}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function WalkthroughTab() {
  const { project } = useProject();
  const githubRepo: GithubRepoRef | undefined = project
    ? { owner: project.repo_owner, repo: project.repo_name, branch: project.branch }
    : undefined;
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const [tutorials, setTutorials] = useState<TutorialSummary[] | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detail, setDetail] = useState<TutorialDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  // Hovered "Backed by" receipt → highlighted lines in the step snippet.
  const [hoveredReceipt, setHoveredReceipt] = useState<StepReceipt | null>(null);
  useEffect(() => { setHoveredReceipt(null); }, [currentStep, detail?.tutorial.id]);
  const { save: saveProgress } = useProgress(id);

  // Remember the reader's step so "Continue tutorial" resumes here.
  useEffect(() => {
    if (!detail?.tutorial.id) return;
    saveProgress("tutorial", detail.tutorial.id, { stepOrder: currentStep + 1 });
  }, [detail?.tutorial.id, currentStep, saveProgress]);

  // Deterministic fallback state (no tutorials generated / AI disabled).
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [wfSteps, setWfSteps] = useState<WorkflowStep[]>([]);
  const [wfMeta, setWfMeta] = useState<{ title: string; purpose: string } | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ← / → page through whichever procedure is open (tutorial or the
  // deterministic workflow fallback share the same step cursor).
  const stepTotal = detail ? detail.steps.length : selectedWorkflow ? wfSteps.length : 0;
  useHotkeys(
    {
      ArrowRight: () => setCurrentStep((s) => Math.min(s + 1, Math.max(stepTotal - 1, 0))),
      ArrowLeft: () => setCurrentStep((s) => Math.max(s - 1, 0)),
    },
    stepTotal > 1,
  );

  // Tutorials follow the sidebar package selection (a package implies its
  // role); with nothing selected the server resolves member default → latest.
  const { packageQuery, selectedPackageId } = usePackages();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setDetail(null);
    setCurrentStep(0);
    setLoadError(false);
    try {
      const data = await apiFetch(`/projects/${id}/tutorials${packageQuery}`);
      const list: TutorialSummary[] = data.tutorials ?? [];
      setTutorials(list);
      setCoverage((data.coverage as Coverage | null) ?? null);
      if (list.length === 0) {
        try {
          const wf = await apiFetch(`/projects/${id}/workflows`);
          setWorkflows(wf.workflows ?? []);
        } catch {
          setWorkflows([]);
          setLoadError(true);
        }
      } else {
        // Deep link / resume: ?tutorial=<id>&step=<n> opens at that step.
        const requested = searchParams.get("tutorial");
        const target = requested && list.some((t) => t.id === requested) ? requested : list[0]!.id;
        const step = Number(searchParams.get("step"));
        void openTutorial(target, Number.isFinite(step) && step > 0 ? step - 1 : 0);
      }
    } catch {
      setTutorials([]);
      setWorkflows([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id, packageQuery, selectedPackageId]);

  useEffect(() => { load(); }, [load]);

  async function openTutorial(tutorialId: string, startStep = 0) {
    if (!id) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadingDetail(true);
    setCurrentStep(0);
    try {
      const data = await apiFetch(`/projects/${id}/tutorials/${tutorialId}`, { signal: controller.signal });
      if (!controller.signal.aborted) {
        const loaded = data as TutorialDetail;
        setDetail(loaded);
        if (startStep > 0) setCurrentStep(Math.min(startStep, loaded.steps.length - 1));
      }
    } catch { /* list stays */ }
    finally {
      if (!controller.signal.aborted) setLoadingDetail(false);
    }
  }

  async function openWorkflow(workflowId: string) {
    if (!id) return;
    setSelectedWorkflow(workflowId);
    setLoadingDetail(true);
    setCurrentStep(0);
    try {
      const data = await apiFetch(`/projects/${id}/workflows/${workflowId}/walkthrough`);
      setWfSteps(data.steps ?? []);
      setWfMeta(data.workflow ?? null);
    } catch {
      setWfSteps([]);
    } finally {
      setLoadingDetail(false);
    }
  }

  if (!project) return null;

  const hasTutorials = (tutorials?.length ?? 0) > 0;
  const tStep = detail?.steps[currentStep];
  const wStep = wfSteps[currentStep];
  const isProcedural = Boolean(tStep?.action);

  return (
    <div>
      <div data-tour="tutorials-header">
        <PageHeader
          title="Tutorials"
          subtitle="Procedures you run against this repository — every step is a command or an edit, with the result you should see and a way to check it. Built only where the evidence supports one. Follows the package selected in the sidebar."
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : hasTutorials ? (
        <div className="space-y-3">
          {coverage && <CoverageNote coverage={coverage} />}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr]">
            {/* tutorial picker */}
            <div className="h-fit rounded-xl border border-border bg-card p-2">
              <p className="section-label px-2 pb-1.5 pt-1">Procedures ({tutorials!.length})</p>
              <div className="space-y-0.5">
                {tutorials!.map((t) => {
                  const meta = PROCEDURE_META[t.procedure_kind as ProcedureKind];
                  const Icon = meta?.icon ?? Zap;
                  return (
                    <button
                      key={t.id}
                      onClick={() => openTutorial(t.id)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-[0.78125rem] transition-colors",
                        detail?.tutorial.id === t.id
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <Icon className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium" title={t.title}>{t.title}</span>
                        <span className="mt-0.5 block truncate text-[0.6875rem] opacity-60">
                          {meta ? `${meta.label} · ` : ""}{t.step_count} steps · {t.confidence} confidence
                          {t.status === "stale" && " · stale"}
                        </span>
                      </span>
                      {t.status === "stale" && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* procedure step viewer */}
            <div className="min-h-[380px] rounded-xl border border-border bg-card p-4">
              {!detail && !loadingDetail ? (
                <div className="flex h-full min-h-[320px] items-center justify-center text-center">
                  <div>
                    <RouteIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">Pick a procedure to run against this repository</p>
                  </div>
                </div>
              ) : loadingDetail ? (
                <div className="flex h-full min-h-[320px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : detail && tStep ? (
                <div className="space-y-4">
                  <div className="border-b pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">{detail.tutorial.title}</h2>
                      {detail.tutorial.status === "stale" && (
                        <Badge variant="outline" className="border-warning/40 bg-warning-soft text-[0.625rem] text-warning">stale</Badge>
                      )}
                      <span className="ml-auto inline-flex items-center gap-1 text-[0.65625rem] text-muted-foreground/70">
                        {isProcedural
                          ? "Steps built from repo evidence · notes written by AI"
                          : "AI explanations"} · {detail.tutorial.confidence} confidence
                      </span>
                    </div>
                    {detail.tutorial.goal && (
                      <p className="mt-1 text-[0.78125rem] font-medium text-foreground">{detail.tutorial.goal}</p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">{detail.tutorial.summary}</p>
                  </div>

                  <StepPager
                    current={currentStep}
                    total={detail.steps.length}
                    labels={detail.steps.map(stepLabel)}
                    onPrev={() => setCurrentStep((s) => s - 1)}
                    onNext={() => setCurrentStep((s) => s + 1)}
                    onJump={setCurrentStep}
                  />

                  {isProcedural ? (
                    <>
                      <ProcedureStepCard step={tStep} repo={githubRepo} />
                      {tStep.snippet && (
                        <details className="rounded-md border border-border">
                          <summary className="cursor-pointer px-3 py-2 text-[0.71875rem] text-muted-foreground hover:text-foreground">
                            Show the code at {tStep.file_path.split("/").pop()}
                            {tStep.line_start ? `:${tStep.line_start}` : ""}
                          </summary>
                          <div className="px-2 pb-2">
                            <CodeSnippet
                              code={tStep.snippet}
                              startLine={tStep.line_start ?? 1}
                              maxHeightClass="max-h-80"
                              highlightRanges={hoverRangeFor(tStep, hoveredReceipt)}
                            />
                          </div>
                        </details>
                      )}
                    </>
                  ) : (
                    /* Pre-rewrite tutorial: an explanation beside a snippet. */
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StepLocation step={tStep} repo={githubRepo} />
                        <Link
                          to={`/projects/${id}/dependencies?focus=${encodeURIComponent(tStep.file_path)}`}
                          className="inline-flex items-center gap-1 text-[0.71875rem] font-medium text-primary hover:underline"
                        >
                          Open in Dependencies <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                      <div className={cn("grid gap-3", tStep.snippet && "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
                        {tStep.snippet ? (
                          <CodeSnippet
                            code={tStep.snippet}
                            startLine={tStep.line_start ?? 1}
                            maxHeightClass="max-h-80"
                            highlightRanges={hoverRangeFor(tStep, hoveredReceipt)}
                          />
                        ) : (
                          <p className="rounded-md border border-dashed border-border px-3 py-2 text-[0.71875rem] text-muted-foreground">
                            No snippet was captured for this step — open it in Dependencies to read the code.
                          </p>
                        )}
                        <div className="h-fit rounded-md border border-border px-4 py-3">
                          <p className="text-[0.8125rem] leading-relaxed text-foreground">
                            {tStep.explanation || "No explanation could be grounded in the evidence for this step."}
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  {tStep.receipts.length > 0 && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.65625rem] text-muted-foreground/70">
                      Backed by:
                      {tStep.receipts.map((r) => {
                        const highlightable = hoverRangeFor(tStep, r) !== undefined;
                        const receiptUrl =
                          githubRepo && r.file_path
                            ? buildGithubBlobUrl(githubRepo, r.file_path, { lineStart: r.line_start, lineEnd: r.line_end })
                            : null;
                        const spanProps = {
                          tabIndex: 0,
                          onMouseEnter: () => setHoveredReceipt(r),
                          onMouseLeave: () => setHoveredReceipt(null),
                          onFocus: () => setHoveredReceipt(r),
                          onBlur: () => setHoveredReceipt(null),
                          title: highlightable ? "Highlights these lines in the snippet" : undefined,
                          className: cn(
                            "cursor-default rounded bg-muted/60 px-1 font-mono",
                            highlightable && "underline decoration-dotted underline-offset-2 hover:text-foreground",
                          ),
                        };
                        const label = (
                          <>
                            {r.file_path}
                            {r.line_start ? `:${r.line_start}` : ""}
                          </>
                        );
                        return receiptUrl ? (
                          <a
                            key={r.id}
                            {...spanProps}
                            href={receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(spanProps.className, "inline-flex items-center gap-0.5")}
                          >
                            {label}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span key={r.id} {...spanProps}>{label}</span>
                        );
                      })}
                    </p>
                  )}

                  {detail.tutorial.unknowns?.length > 0 && currentStep === detail.steps.length - 1 && (
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                      <p className="section-label mb-1 flex items-center gap-1.5">
                        <HelpCircle className="h-3 w-3" /> What this procedure could not determine
                      </p>
                      {detail.tutorial.unknowns.map((u, i) => (
                        <p key={i} className="text-[0.71875rem] text-muted-foreground">
                          {u.detail || u.kind.replace(/_/g, " ")}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : workflows.length > 0 ? (
        /* ── no procedure was possible: the traced flows, stated as such ── */
        <>
          {coverage && coverage.reasons.length > 0 ? (
            <div className="mb-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> No runnable procedure could be built from this repository
              </p>
              {coverage.reasons.map((r, i) => (
                <p key={i} className="mt-1 text-[0.71875rem] text-muted-foreground">{r}</p>
              ))}
              <p className="mt-1.5 text-[0.71875rem] text-muted-foreground">
                A tutorial here is a procedure: a command to run, a result to see, a way to check it. Rather than
                print prose that looks like one, the traced flows are listed below as what they are — a reading
                aid, not something you can run.
              </p>
            </div>
          ) : (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-info/40 bg-info-soft px-3 py-2 text-xs text-info">
              <HelpCircle className="h-3.5 w-3.5 shrink-0" />
              No generated procedures for this package yet — showing the deterministic traced workflows instead.
              Generate an onboarding package to get runnable, verifiable procedures.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr]">
            <div className="h-fit rounded-xl border border-border bg-card p-2">
              <p className="section-label px-2 pb-1.5 pt-1">Traced workflows ({workflows.length})</p>
              <div className="space-y-0.5">
                {workflows.map((wf) => (
                  <button
                    key={wf.id}
                    onClick={() => openWorkflow(wf.id)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-[0.78125rem] transition-colors",
                      selectedWorkflow === wf.id
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Zap className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium" title={wf.title}>{wf.title}</span>
                      <span className="mt-0.5 block truncate text-[0.6875rem] opacity-60">
                        {wf.trigger_type} · {wf.step_count} steps
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-[320px] rounded-xl border border-border bg-card p-4">
              {!selectedWorkflow ? (
                <div className="flex h-full min-h-[260px] items-center justify-center text-center">
                  <div>
                    <RouteIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">Select a workflow to read its traced steps</p>
                  </div>
                </div>
              ) : loadingDetail ? (
                <div className="flex h-full min-h-[260px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : wStep ? (
                <div className="space-y-4">
                  {wfMeta && (
                    <div className="border-b pb-3">
                      <h2 className="text-sm font-semibold text-foreground">{wfMeta.title}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">{wfMeta.purpose}</p>
                    </div>
                  )}
                  <StepPager
                    current={currentStep}
                    total={wfSteps.length}
                    labels={wfSteps.map(stepName)}
                    onPrev={() => setCurrentStep((s) => s - 1)}
                    onNext={() => setCurrentStep((s) => s + 1)}
                    onJump={setCurrentStep}
                  />
                  <StepLocation step={wStep} repo={githubRepo} />
                  <div className="rounded-md border border-border px-4 py-3">
                    <p className="text-[0.8125rem] leading-relaxed text-foreground">
                      {wStep.explanation || wStep.deterministic_description || "No description available for this step."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[260px] items-center justify-center text-center">
                  <p className="text-sm text-muted-foreground">No steps found for this workflow</p>
                </div>
              )}
            </div>
          </div>
        </>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-danger/40 bg-danger-soft py-20 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft">
            <AlertTriangle className="h-5 w-5 text-danger" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Couldn't load tutorials</h2>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Something went wrong fetching tutorials and workflows for this project. Check your
            connection and try again.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => load()}>
            Retry
          </Button>
        </div>
      ) : (
        /* Nothing at all: say which of the two reasons it is. */
        <div className="rounded-xl border border-dashed border-border px-6 py-12">
          <div className="mx-auto max-w-xl text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
              <RouteIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">No procedure could be built for this repository</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              A tutorial here is a procedure — a command to run, a result you should see, and a way to check it.
              Where the evidence cannot support one, this tab says so instead of printing prose that looks like a
              section.
            </p>
            {coverage && coverage.reasons.length > 0 && (
              <ul className="mx-auto mt-3 max-w-lg space-y-1.5 text-left">
                {coverage.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2 text-[0.71875rem] text-muted-foreground">
                    <span aria-hidden className="text-muted-foreground/50">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {coverage && (
              <p className="mt-3 text-[0.6875rem] text-muted-foreground/80">
                Traced flows: {coverage.byTier.core} core · {coverage.byTier.supporting} supporting ·{" "}
                {coverage.byTier.surface} with no traced effects. Runnable commands found:{" "}
                {coverage.runnable.start || coverage.runnable.tests
                  ? [coverage.runnable.start && "a start command", coverage.runnable.tests && "a test command"]
                      .filter(Boolean)
                      .join(" and ")
                  : "none"}
                {coverage.runnable.compose ? ` (${coverage.runnable.compose})` : ""}.
              </p>
            )}
            <Button variant="outline" size="sm" className="mt-4" asChild>
              <Link to={`/projects/${id}/onboarding`}>
                Go to onboarding
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
