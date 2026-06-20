import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileCode2,
  GitBranch,
  Loader2,
  RefreshCw,
  Route as RouteIcon,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useProject } from "@/contexts/ProjectContext";
import { apiFetch } from "@/lib/api";
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

interface Workflow {
  id: string;
  title: string;
  trigger_type: string;
  purpose: string;
  importance_score: number;
  confidence: string;
  composite_score: number;
  step_count: number;
}

interface WalkthroughStep {
  id: string;
  step_order: number;
  file_path: string;
  symbol_name: string | null;
  line_start: number | null;
  line_end: number | null;
  explanation: string | null;
  step_kind: string | null;
  deterministic_description: string | null;
  role_relevance: Record<string, unknown>;
}

export function WalkthroughTab() {
  const { project, refetch } = useProject();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [analyzing, setAnalyzing] = useState(false);

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [steps, setSteps] = useState<WalkthroughStep[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [workflowMeta, setWorkflowMeta] = useState<{ title: string; purpose: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!project) return null;

  const canManage =
    project.permission_tier === "owner" || project.permission_tier === "admin";
  const role = searchParams.get("role") ?? project.developer_role;
  const generating = project.status === "analyzing";

  function setRole(next: string) {
    setSearchParams(
      (prev) => { prev.set("role", next); return prev; },
      { replace: true },
    );
  }

  const fetchWorkflows = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/projects/${id}/workflows`);
      setWorkflows(data.workflows ?? []);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  async function loadWalkthrough(workflowId: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSelectedWorkflow(workflowId);
    setLoadingSteps(true);
    setCurrentStep(0);

    try {
      const data = await apiFetch(`/projects/${id}/workflows/${workflowId}/walkthrough`, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setSteps(data.steps ?? []);
        setWorkflowMeta(data.workflow ?? null);
      }
    } catch {
      if (!controller.signal.aborted) setSteps([]);
    } finally {
      if (!controller.signal.aborted) setLoadingSteps(false);
    }
  }

  async function handleReanalyze() {
    setAnalyzing(true);
    try {
      await apiFetch(`/projects/${id}/analyze`, { method: "POST" });
      refetch();
    } catch { /* surfaced via project status on refetch */ }
    finally { setAnalyzing(false); }
  }

  const step = steps[currentStep];
  const hasWorkflows = workflows.length > 0;

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
            Step-by-step tours of workflows in your codebase.
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

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !hasWorkflows ? (
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
                  Analysis is running. Workflow tours will appear here once the codebase has been processed.
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
                  Walkthroughs are created from the analysis pipeline. Generate an onboarding package first.
                </p>
                <Button variant="outline" size="sm" className="mt-4" asChild>
                  <Link to={`/projects/${id}/onboarding?role=${role}`}>
                    Go to onboarding
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[240px_1fr]">
          {/* Workflow picker */}
          <Card className="h-fit">
            <CardContent className="p-3">
              <h3 className="mb-2 text-[13px] font-medium text-foreground">Workflows</h3>
              <div className="space-y-1">
                {workflows.map((wf) => (
                  <button
                    key={wf.id}
                    onClick={() => loadWalkthrough(wf.id)}
                    className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors ${
                      selectedWorkflow === wf.id
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                  >
                    <Zap className="mt-0.5 h-3 w-3 shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{wf.title}</p>
                      <p className="mt-0.5 truncate text-[11px] opacity-60">
                        {wf.trigger_type} · {wf.step_count} steps
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Step viewer */}
          <Card className="min-h-[320px]">
            <CardContent className="p-4">
              {!selectedWorkflow ? (
                <div className="flex h-full min-h-[260px] items-center justify-center text-center">
                  <div>
                    <RouteIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">Select a workflow to begin the walkthrough</p>
                  </div>
                </div>
              ) : loadingSteps ? (
                <div className="flex h-full min-h-[260px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : steps.length === 0 ? (
                <div className="flex h-full min-h-[260px] items-center justify-center text-center">
                  <p className="text-sm text-muted-foreground">No steps found for this workflow</p>
                </div>
              ) : step ? (
                <div className="space-y-4">
                  {/* Workflow title */}
                  {workflowMeta && (
                    <div className="border-b pb-3">
                      <h2 className="text-sm font-semibold text-foreground">{workflowMeta.title}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">{workflowMeta.purpose}</p>
                    </div>
                  )}

                  {/* Step navigation */}
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[11px]">
                      Step {currentStep + 1} of {steps.length}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={currentStep === 0}
                        onClick={() => setCurrentStep((s) => s - 1)}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={currentStep >= steps.length - 1}
                        onClick={() => setCurrentStep((s) => s + 1)}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Step content */}
                  <div className="space-y-3">
                    {/* File info */}
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                      <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-mono text-foreground">{step.file_path}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          {step.symbol_name && (
                            <span className="flex items-center gap-1">
                              <Code2 className="h-3 w-3" />
                              {step.symbol_name}
                            </span>
                          )}
                          {step.line_start && (
                            <span>
                              Lines {step.line_start}{step.line_end ? `–${step.line_end}` : ""}
                            </span>
                          )}
                          {step.step_kind && (
                            <Badge variant="secondary" className="text-[10px]">{step.step_kind}</Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Explanation */}
                    <div className="rounded-md border px-4 py-3">
                      <p className="text-[13px] leading-relaxed text-foreground">
                        {step.deterministic_description || step.explanation || "No description available for this step."}
                      </p>
                    </div>
                  </div>

                  {/* Step dots */}
                  <div className="flex items-center justify-center gap-1 pt-2">
                    {steps.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentStep(i)}
                        className={`h-1.5 rounded-full transition-all ${
                          i === currentStep ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
