import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  FileCode2,
  HelpCircle,
  Loader2,
  Route as RouteIcon,
  Sparkles,
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

interface TutorialSummary {
  id: string;
  title: string;
  summary: string;
  /** "After this tutorial, you can …" — the concrete skill it teaches. */
  goal: string | null;
  status: string;
  confidence: string;
  trigger_type: string | null;
  package_role: string | null;
  step_count: number;
}

interface TutorialStep {
  id: string;
  step_order: number;
  file_path: string;
  symbol_name: string | null;
  line_start: number | null;
  line_end: number | null;
  snippet: string | null;
  explanation: string;
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

function StepPager({
  current,
  total,
  onPrev,
  onNext,
  onJump,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Badge variant="outline" className="text-xs tabular-nums">
        Step {current + 1} of {total}
      </Badge>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              onClick={() => onJump(i)}
              aria-label={`Go to step ${i + 1}`}
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

export function WalkthroughTab() {
  const { project } = useProject();
  const githubRepo: GithubRepoRef | undefined = project
    ? { owner: project.repo_owner, repo: project.repo_name, branch: project.branch }
    : undefined;
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const [tutorials, setTutorials] = useState<TutorialSummary[] | null>(null);
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

  // ← / → page through whichever walkthrough is open (AI tutorial or the
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

  return (
    <div>
      <div data-tour="tutorials-header">
        <PageHeader
          title="Tutorials"
          subtitle="Real traced flows, step by step — the actual code at each step, with an explanation of what it does. Follows the package selected in the sidebar."
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : hasTutorials ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr]">
          {/* tutorial picker */}
          <div className="h-fit rounded-xl border border-border bg-card p-2">
            <p className="section-label px-2 pb-1.5 pt-1">Tutorials ({tutorials!.length})</p>
            <div className="space-y-0.5">
              {tutorials!.map((t) => (
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
                  <Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium" title={t.title}>{t.title}</span>
                    <span className="mt-0.5 block truncate text-[0.6875rem] opacity-60">
                      {t.step_count} steps · {t.confidence} confidence
                      {t.status === "stale" && " · stale"}
                    </span>
                  </span>
                  {t.status === "stale" && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />}
                </button>
              ))}
            </div>
          </div>

          {/* tutorial step viewer */}
          <div className="min-h-[380px] rounded-xl border border-border bg-card p-4">
            {!detail && !loadingDetail ? (
              <div className="flex h-full min-h-[320px] items-center justify-center text-center">
                <div>
                  <RouteIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Pick a tutorial to walk through a real flow</p>
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
                      <Sparkles className="h-2.5 w-2.5" /> AI explanations · {detail.tutorial.confidence} confidence
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
                  onPrev={() => setCurrentStep((s) => s - 1)}
                  onNext={() => setCurrentStep((s) => s + 1)}
                  onJump={setCurrentStep}
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StepLocation step={tStep} repo={githubRepo} />
                  <Link
                    to={`/projects/${id}/dependencies?focus=${encodeURIComponent(tStep.file_path)}`}
                    className="inline-flex items-center gap-1 text-[0.71875rem] font-medium text-primary hover:underline"
                  >
                    Open in Dependencies <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>

                {/* Code and explanation side by side — the tutorial's whole
                    point is reading real code with the note next to it.
                    Hovering a "Backed by" receipt highlights its exact lines
                    in the snippet when they fall inside this step's range. */}
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
                    {tStep.receipts.length > 0 && (
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.65625rem] text-muted-foreground/70">
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
                  </div>
                </div>

                {detail.tutorial.unknowns?.length > 0 && currentStep === detail.steps.length - 1 && (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="section-label mb-1 flex items-center gap-1.5">
                      <HelpCircle className="h-3 w-3" /> Known gaps
                    </p>
                    {detail.tutorial.unknowns.map((u, i) => (
                      <p key={i} className="text-[0.71875rem] text-muted-foreground">
                        {u.kind.replace(/_/g, " ")}{u.detail ? ` — ${u.detail}` : ""}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : workflows.length > 0 ? (
        /* ── deterministic fallback: traced workflow steps, no AI ── */
        <>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-info/40 bg-info-soft px-3 py-2 text-xs text-info">
            <HelpCircle className="h-3.5 w-3.5 shrink-0" />
            No AI tutorials for this role yet — showing the deterministic traced workflows instead.
            Generate an onboarding package to get explained, snippet-by-snippet tutorials.
          </div>
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
                    <p className="text-sm text-muted-foreground">Select a workflow to begin</p>
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
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
            <RouteIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">No tutorials yet</h2>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Tutorials are built from real traced flows during onboarding generation. Analyze the
            repository first — if no flows can be traced, that's reported honestly instead of invented.
          </p>
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <Link to={`/projects/${id}/onboarding`}>
              Go to onboarding
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
