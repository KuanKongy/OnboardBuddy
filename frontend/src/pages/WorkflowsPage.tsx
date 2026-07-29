import { AlertTriangle, ArrowRight, ChevronDown, Circle, Info, Loader2, Maximize2, Minimize2, RefreshCw, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import {
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { GraphCanvas, MINIMAP_MIN_NODES } from "@/components/graph/GraphCanvas";
import { useHotkeys } from "@/hooks/useHotkeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import {
  fetchWorkflowsList,
  triggerLabel,
  WORKFLOW_TIERS,
  type WorkflowOrdering,
  type WorkflowSummary,
} from "@/lib/graphData";
import { middleTruncate } from "@/lib/format";
import { layoutGraph } from "@/lib/graphLayout";
import { buildStepChain, layoutSerpentine, shouldSerpentine, type SerpentineLayout } from "@/lib/serpentine";
import { ScoreProvenance } from "@/components/ScoreProvenance";
import { fetchNodeDetail, type NodeDetail } from "@/lib/graphData";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import { cn } from "@/lib/utils";

/** Step kind → palette token: what each stage of the flow *does*. */
const STEP_KIND_PALETTE: Record<string, string> = {
  trigger: "api",
  auth_guard: "config",
  validation: "config",
  data_read: "data",
  data_write: "data",
  async_work: "worker",
  side_effect: "worker",
  transform: "shared",
  response: "ui",
};

/** Handle ids match `HandleId` in serpentine.ts. */
const HANDLE_SIDES = [
  { id: "t", position: Position.Top },
  { id: "r", position: Position.Right },
  { id: "b", position: Position.Bottom },
  { id: "l", position: Position.Left },
] as const;

// ── Step data ────────────────────────────────────────────────────────────────

/**
 * One row per step, from `/workflows/:id/walkthrough`.
 *
 * Snake_case duplicates of the same fields are also served, and the e2e
 * fixtures only carry those, so every read below goes through `normalizeStep`.
 */
interface WalkthroughStepRaw {
  stepOrder?: number;
  step_order?: number;
  filePath?: string;
  file_path?: string;
  symbolName?: string | null;
  symbol_name?: string | null;
  lineStart?: number | null;
  line_start?: number | null;
  lineEnd?: number | null;
  line_end?: number | null;
  stepKind?: string;
  step_kind?: string;
  deterministicDescription?: string | null;
  deterministic_description?: string | null;
  explanation?: string | null;
  explanationSource?: "narrated" | "deterministic";
  nodeKey?: string | null;
  syntheticReturn?: boolean;
}

interface WalkthroughStep {
  stepOrder: number;
  filePath: string;
  symbolName: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  stepKind: string;
  /** What this step does. Never empty — see `describeStep`. */
  explanation: string;
  /** True when a narration pass wrote it; false when a formatter did. */
  narrated: boolean;
  nodeKey: string | null;
  syntheticReturn: boolean;
}

interface WalkthroughResponse {
  workflow: { id: string; title: string; trigger_type: string; purpose: string | null; confidence: string };
  steps: WalkthroughStepRaw[];
  counts?: { stepCount: number; narratedSteps: number; distinctFiles: number; distinctSymbols: number };
}

/**
 * What the step does, in the best words we actually have.
 *
 * `explanation` is written by the narration pass and covers a small minority of
 * steps — 37 of OnboardBuddy's 774. The rest carry a formatter's sentence, and
 * that sentence is a real structural statement ("Touches database table
 * \"sessions\"", "Persists data (database write) in processSummaryJob"), so it
 * is shown rather than replaced with a placeholder. Nothing is invented for a
 * step that has neither; it says which file the step is in, which is the one
 * thing that is always true.
 *
 * The trailing "(path/to/file.ts)" is dropped when it repeats the path already
 * rendered under the step — the node has room for behaviour, not for the same
 * path twice.
 */
function describeStep(raw: WalkthroughStepRaw): { explanation: string; narrated: boolean } {
  const narratedText = (raw.explanation ?? "").trim();
  if (narratedText) return { explanation: narratedText, narrated: true };

  const filePath = raw.filePath ?? raw.file_path ?? "";
  const deterministic = (raw.deterministicDescription ?? raw.deterministic_description ?? "").trim();
  if (deterministic) {
    const trimmed = filePath ? deterministic.replace(` (${filePath})`, "") : deterministic;
    return { explanation: trimmed, narrated: false };
  }
  return {
    explanation: filePath ? `Runs in ${filePath}. No description was recorded for this step.` : "No description was recorded for this step.",
    narrated: false,
  };
}

function normalizeStep(raw: WalkthroughStepRaw, index: number): WalkthroughStep {
  const { explanation, narrated } = describeStep(raw);
  return {
    stepOrder: raw.stepOrder ?? raw.step_order ?? index + 1,
    filePath: raw.filePath ?? raw.file_path ?? "",
    symbolName: raw.symbolName ?? raw.symbol_name ?? null,
    lineStart: raw.lineStart ?? raw.line_start ?? null,
    lineEnd: raw.lineEnd ?? raw.line_end ?? null,
    stepKind: raw.stepKind ?? raw.step_kind ?? "transform",
    explanation,
    narrated,
    nodeKey: raw.nodeKey ?? null,
    syntheticReturn: raw.syntheticReturn === true,
  };
}

/** "backend/src/api/routes/ask.ts" → "ask.ts" */
function stepTitle(step: WalkthroughStep): string {
  const base = step.filePath.split("/").pop() ?? step.filePath;
  const name = step.symbolName ?? base;
  return step.syntheticReturn ? `Response from ${name}` : name;
}

/**
 * How many characters of a rail row's title survive.
 *
 * Sized for the 280px rail at 0.78125rem. Rows 7, 8, 9 and 12 of OnboardBuddy's
 * rail all read "POST /api/projects/:id/…" — four rows, one string, nothing to
 * choose between them. Middle truncation keeps the segment that differs.
 */
const RAIL_TITLE_CHARS = 34;

// ── Node ─────────────────────────────────────────────────────────────────────

interface StepNodeData {
  order: number;
  title: string;
  stepKind: string;
  explanation: string;
  narrated: boolean;
  selected: boolean;
}

/**
 * A step, with what it does written on it.
 *
 * There is deliberately no tooltip anywhere in here. The three that used to be
 * — on the label, and on the file path — repeated text already on the node,
 * and their hover layer sat over the node and made it harder to click. What
 * they showed in full is in the panel a click opens.
 */
function StepNode({ data }: NodeProps<StepNodeData>) {
  const palette = STEP_KIND_PALETTE[data.stepKind] ?? "shared";
  const color = `var(--node-${palette})`;
  return (
    <div
      className={cn(
        "w-64 rounded-lg border bg-card px-3 py-2 shadow-sm transition-all",
        data.selected ? "ring-2 ring-ring" : "hover:shadow-md",
      )}
      style={{ borderColor: data.selected ? color : "var(--border)" }}
    >
      {/* All four sides, as source and target. A serpentine chain enters and
          leaves sideways within a row and vertically at the turn, so a
          Top-target/Bottom-source pair cannot draw it — edges would loop back
          around the node instead of connecting straight through. React Flow
          keys handles by (node, type, id), so the same id on a source and a
          target is fine. Unused ones stay mounted but invisible: React Flow
          has to measure a handle to route to it. */}
      {HANDLE_SIDES.map(({ id, position }) => (
        <Handle
          key={`t-${id}`}
          id={id}
          type="target"
          position={position}
          isConnectable={false}
          className="!h-2 !w-2 !border-0 !bg-muted-foreground/60 !opacity-0"
        />
      ))}
      {HANDLE_SIDES.map(({ id, position }) => (
        <Handle
          key={`s-${id}`}
          id={id}
          type="source"
          position={position}
          isConnectable={false}
          className="!h-2 !w-2 !border-0 !bg-muted-foreground/60 !opacity-0"
        />
      ))}
      <div className="flex items-center gap-2">
        <span
          className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold"
          style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}
        >
          {data.order}
        </span>
        {/* Two lines, wrapped, and broken on the path separators — not
            `truncate`. A 256px node had empty width below a title clipped at
            one line, and route-shaped titles clipped to the same prefix as
            their siblings. */}
        <span className="min-w-0 flex-1 line-clamp-2 break-all font-mono text-[0.75rem] font-medium leading-tight text-foreground">
          {data.title}
        </span>
        <span
          className="shrink-0 rounded px-1 py-0.5 text-[0.59375rem] font-semibold uppercase tracking-wide"
          style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
        >
          {data.stepKind.replace(/_/g, " ")}
        </span>
      </div>
      {/* What the step does. The marker is the audit's ask: a reader can see
          which steps were understood by the narration pass and which carry a
          formatter's sentence, without opening anything. */}
      <p className="mt-1 line-clamp-3 text-[0.65625rem] leading-snug text-muted-foreground">
        {data.narrated && <Sparkles className="mr-1 inline h-2.5 w-2.5 align-[-1px] text-primary" />}
        {data.explanation}
      </p>
    </div>
  );
}

const nodeTypes = { step: StepNode };

const NODE_WIDTH = 256;
const NODE_HEIGHT = 88;

export function WorkflowsPage() {
  const { id } = useParams<{ id: string }>();
  const selectedPackageId = useOptionalPackages()?.selectedPackageId ?? null;
  // Deep link from the capabilities hub: ?workflow=<id> preselects a flow.
  const [searchParams] = useSearchParams();
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [ordering, setOrdering] = useState<WorkflowOrdering | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    () => searchParams.get("workflow") ?? "",
  );
  const [detail, setDetail] = useState<WalkthroughResponse | null>(null);
  /**
   * Bug #68 / UI_VERIFY_M4 #13: the steps fetch used to write the SAME
   * `error` state as the list fetch. Two consequences, both reproduced live:
   * the rail is gated on `!error`, so one failed steps call deleted the whole
   * workflow list from the page; and the banner it left behind read "The
   * workflow list could not be loaded" — blaming the request that had
   * succeeded. The steps failure is now scoped to the canvas that failed.
   */
  const [stepsError, setStepsError] = useState("");
  /** Bumped by the canvas Retry — re-running the effect needs a changed dep. */
  const [stepsReload, setStepsReload] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // `auto` picks per workflow; the explicit modes let a reader override a
  // choice they disagree with rather than being stuck with it.
  const [layoutMode, setLayoutMode] = useState<"auto" | "snake" | "column">("auto");
  const [fullscreen, setFullscreen] = useState(false);
  const [search, setSearch] = useState("");
  const [showScoring, setShowScoring] = useState(false);

  function loadWorkflows() {
    if (!id) return;
    setLoadingList(true);
    setError("");
    fetchWorkflowsList(id, selectedPackageId)
      .then((res) => {
        setWorkflows(res.workflows);
        setOrdering(res.ordering ?? null);
        if (res.workflows.length > 0) setSelectedWorkflowId((prev) => prev || res.workflows[0]!.id);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingList(false));
  }

  useEffect(() => { loadWorkflows(); }, [id, selectedPackageId]);

  // Esc closes the step details panel (pairs with the animated fit-out).
  useHotkeys({ Escape: () => setSelectedNodeId(null) }, selectedNodeId !== null);

  // Esc also leaves fullscreen, matching the other graph tabs. Registered
  // separately so it still works with no step selected.
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  useEffect(() => {
    if (!id || !selectedWorkflowId) return;
    setLoadingGraph(true);
    // Clears any lingering list-level error too — a successful graph load
    // means the list is in a working state, so a stale banner shouldn't
    // keep showing above it.
    setError("");
    setStepsError("");
    setSelectedNodeId(null);
    // The walkthrough route, not the folded workflow graph: it serves one row
    // per step, which is the number the rail beside this canvas advertises.
    apiFetch(`/projects/${id}/workflows/${encodeURIComponent(selectedWorkflowId)}/walkthrough`)
      .then((res) => { setDetail(res as WalkthroughResponse); setStepsError(""); })
      .catch((err: unknown) => {
        setDetail(null);
        setStepsError(err instanceof Error ? err.message : "Failed to load this workflow's steps");
      })
      .finally(() => setLoadingGraph(false));
  }, [id, selectedWorkflowId, stepsReload]);

  const steps = useMemo(
    () => (detail?.steps ?? []).map(normalizeStep),
    [detail],
  );

  /**
   * A workflow is a chain, so it snakes: left to right, drop a row, right to
   * left. Laid out as one dagre column a 20-step flow was ~20 nodes tall and
   * one wide, so at any readable zoom you saw about three steps and scrolled
   * to follow a single trace.
   *
   * Short flows still go through dagre — snaking three steps adds turns for
   * nothing. Branch-heavy graphs used to be excluded too; a chain built one
   * node per step has no branches to weigh, and the gate keeps the test only
   * because `shouldSerpentine` is shared.
   */
  const chain = useMemo(
    () => buildStepChain(steps, (s) => ({ label: stepTitle(s), kind: s.stepKind })),
    [steps],
  );

  const triggerType = detail?.workflow.trigger_type ?? null;

  const layout = useMemo(() => {
    if (chain.nodes.length === 0) return { nodes: [], routing: null as SerpentineLayout["edgeRouting"] | null };
    // The trigger type is part of the gate: a journey is a chain by
    // construction, and the owner's flagship pipeline was the case Auto lost on.
    const snake =
      layoutMode === "snake" ||
      (layoutMode === "auto" && shouldSerpentine(chain.nodes, chain.edges, { triggerType }));
    if (!snake) {
      return {
        nodes: layoutGraph(chain.nodes, chain.edges, {
          direction: "TB", nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT, ranksep: 46, nodesep: 30,
        }),
        routing: null,
      };
    }
    const out = layoutSerpentine(chain.nodes, chain.edges, {
      nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT, rowGap: 84,
    });
    return { nodes: out.nodes, routing: out.edgeRouting };
  }, [chain, layoutMode, triggerType]);

  const stepByNodeId = useMemo(() => {
    const m = new Map<string, WalkthroughStep>();
    for (const s of steps) m.set(`step:${s.stepOrder}`, s);
    return m;
  }, [steps]);

  const flowNodes: Node<StepNodeData>[] = useMemo(
    () =>
      layout.nodes.map((p) => {
        const step = stepByNodeId.get(p.id);
        return {
          id: p.id,
          type: "step",
          position: { x: p.x, y: p.y },
          data: {
            order: step?.stepOrder ?? 0,
            title: p.label,
            stepKind: step?.stepKind ?? p.kind,
            explanation: step?.explanation ?? "",
            narrated: step?.narrated ?? false,
            selected: p.id === selectedNodeId,
          },
        };
      }),
    [layout.nodes, stepByNodeId, selectedNodeId],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      chain.edges.map((e) => {
        const route = layout.routing?.get(e.id);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          // Without explicit handles a snaked edge picks whichever side React
          // Flow guesses and loops back around the node.
          ...(route ? { sourceHandle: route.sourceHandle, targetHandle: route.targetHandle } : {}),
          // Rounded orthogonal segments follow the snake.
          type: route ? "smoothstep" : "default",
          ...(route ? { pathOptions: { borderRadius: 16 } } : {}),
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--primary)" },
          style: { stroke: "var(--primary)", strokeWidth: 1.5, opacity: 0.7 },
        };
      }),
    [chain.edges, layout.routing],
  );

  const selectedStep = selectedNodeId ? stepByNodeId.get(selectedNodeId) ?? null : null;

  // Enrich the selected step with its symbol doc (AI summary, snippet,
  // side effects) — the deterministic description alone is thin.
  const [stepDetail, setStepDetail] = useState<NodeDetail | null>(null);
  useEffect(() => {
    setStepDetail(null);
    const key = selectedStep?.nodeKey;
    if (!id || !key) return;
    let cancelled = false;
    fetchNodeDetail(id, key, selectedPackageId).then((d) => {
      if (!cancelled) setStepDetail(d);
    });
    return () => { cancelled = true; };
  }, [id, selectedStep?.nodeKey, selectedPackageId]);

  const selectedSummary = workflows?.find((w) => w.id === selectedWorkflowId) ?? null;

  const visibleWorkflows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !workflows) return workflows ?? [];
    return workflows.filter(
      (w) =>
        w.title.toLowerCase().includes(q) ||
        (w.purpose ?? "").toLowerCase().includes(q) ||
        (w.trigger_type ?? "").toLowerCase().includes(q),
    );
  }, [workflows, search]);

  /**
   * A flow whose every step is the same file with no symbols is not a traced
   * path — it is one file counted N times. Saying that is more useful than
   * drawing N identical boxes joined by arrows, which is what FloowForge's
   * "ci_pipeline, 3 steps, high confidence" screen was.
   */
  const untraceable = useMemo(() => {
    if (steps.length < 2) return null;
    const files = new Set(steps.map((s) => s.filePath));
    if (files.size > 1 || steps.some((s) => s.symbolName)) return null;
    return steps[0]!.filePath;
  }, [steps]);

  return (
    <div
      style={{
        // Fullscreen leaves only the overlay's own p-3 above and below.
        "--graph-chrome": fullscreen ? "28px" : "170px",
      } as React.CSSProperties}
    >
      <PageHeader
        title="Workflows"
        subtitle="Traced request flows — from the entry point through every function to its side effects, ranked by how critical they are."
        actions={
          <>
            {detail && (
              <Badge variant="outline" className="text-[0.6875rem]">
                {triggerLabel(detail.workflow.trigger_type)} · {steps.length} step{steps.length === 1 ? "" : "s"} · {detail.workflow.confidence} confidence
              </Badge>
            )}
            {detail && (
              <>
                {/* Parity with the other graph tabs, which have had these all
                    along — Workflows shipped without a minimap, search or
                    fullscreen, on the tab whose graphs are the longest. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setFullscreen((v) => !v)}
                      aria-pressed={fullscreen}
                      aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                    >
                      {fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
                  </TooltipContent>
                </Tooltip>
                <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                  {(["auto", "snake", "column"] as const).map((m) => (
                    <Tooltip key={m}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setLayoutMode(m)}
                          aria-pressed={layoutMode === m}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                            layoutMode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {m}
                        </button>
                      </TooltipTrigger>
                      {/* Kept: these say what the mode DOES, which the
                          one-word label cannot. */}
                      <TooltipContent side="bottom">
                        {m === "auto"
                          ? "Snake long chains, column for short ones"
                          : m === "snake"
                            ? "Always snake left-right, wrapping down"
                            : "Always one top-to-bottom column"}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </>
            )}
          </>
        }
      />

      {loadingList && (
        <Skeleton className="graph-canvas" role="status" aria-label="Loading traced workflows" />
      )}

      {/* Two different situations that used to share one message. A failed
          request is ours; an empty list is a finding about the repository, and
          only the first is worth a Retry button. */}
      {!loadingList && error && (
        <EmptyState
          icon={<AlertTriangle className="h-4 w-4 shrink-0 text-warning" />}
          heading={error}
          description="The workflow list could not be loaded. This is a request failure, not a statement about the repository."
          actions={
            <Button variant="outline" size="xs" onClick={loadWorkflows}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Retry
            </Button>
          }
        />
      )}

      {!loadingList && !error && (!workflows || workflows.length === 0) && (
        <EmptyState
          icon={<Info className="h-4 w-4 shrink-0 text-muted-foreground" />}
          heading="No workflows were traced in this snapshot"
          description="A workflow is traced from an entry point — an HTTP route, page, event handler, queue consumer, command or CI pipeline — and kept when the trace reaches a side effect. Zero can mean none of those were detected, or that every trace stopped before reaching one. Both are findings about what the analyzer could see, not proof that the repository does nothing."
        />
      )}

      {!loadingList && !error && workflows && workflows.length > 0 && (
        <div
          className={cn(
            // 280px, not 250: at 250 the rail clipped four sibling routes to
            // the identical string. Widening it is half the fix; the other
            // half is middle-truncating what still does not fit.
            "grid gap-3 lg:grid-cols-[280px_1fr]",
            fullscreen && "fixed inset-0 z-50 bg-background p-3",
          )}
        >
          {/* workflow rail — ranked most-critical first */}
          <div className="graph-canvas overflow-y-auto !bg-card p-2" data-tour="workflow-list">
            <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1">
              {/* Ranking language is suppressed for a list of one: "most
                  critical first" over a single row claims a comparison that
                  was never made. */}
              <p className="section-label">
                {search
                  ? `${visibleWorkflows.length} of ${workflows.length} flows`
                  : workflows.length === 1
                    ? "1 traced flow"
                    : `Traced flows (${workflows.length}) — most critical first`}
              </p>
              {/* What "most critical first" actually means here is the rail's
                  sort order, not any one flow's score — tier decides before a
                  score is compared. The sequence is served by the API beside
                  the ORDER BY that implements it; each flow's own criticality
                  is derived under the flow, where that number is shown. */}
              {workflows.length > 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="inline-flex cursor-help text-muted-foreground/60 hover:text-muted-foreground">
                      <Info className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm text-left">
                    {ordering ? (
                      <div className="space-y-1 text-[0.6875rem]">
                        <p className="font-medium">{ordering.summary}</p>
                        <ol className="list-inside list-decimal space-y-0.5 opacity-80">
                          {ordering.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                        <p className="opacity-70">
                          Select a flow to see how its own criticality score was derived.
                        </p>
                      </div>
                    ) : (
                      <span className="text-[0.6875rem]">
                        This response did not say how the list was ordered.
                      </span>
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {/* Searching the rail, not the canvas: on this tab the thing you
                are hunting for is a flow, and a repo can trace dozens. */}
            <div className="px-2 pb-1.5">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter flows…"
                aria-label="Filter workflows"
                className="h-7 text-xs"
              />
            </div>
            {/* One continuous ranked list under tier headings, so scrolling
                down slides from user flows to raw surface rather than
                switching between separate views. Endpoints with no traced
                effects used to be dropped entirely — a repo with forty routes
                reported "1 workflow" and read as though it did nothing. */}
            <div className="space-y-0.5">
              {visibleWorkflows.length === 0 && (
                <p className="px-2 py-3 text-[0.6875rem] text-muted-foreground">
                  No flow matches “{search}”.
                </p>
              )}
              {WORKFLOW_TIERS.map(({ key, label, note }) => {
                const inTier = visibleWorkflows.filter((w) => (w.tier ?? "supporting") === key);
                if (inTier.length === 0) return null;
                return (
                  <div key={key} className="pt-1.5 first:pt-0">
                    <p className="px-2 pb-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {label} ({inTier.length})
                    </p>
                    {note && (
                      <p className="px-2 pb-1 text-[0.625rem] leading-tight text-muted-foreground/50">{note}</p>
                    )}
                    {inTier.map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => setSelectedWorkflowId(wf.id)}
                  aria-pressed={selectedWorkflowId === wf.id}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                    selectedWorkflowId === wf.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-right text-[0.625rem] tabular-nums opacity-50">
                    {visibleWorkflows.indexOf(wf) + 1}
                  </span>
                  {key === "surface" ? (
                    // Not a lightning bolt: this is an entry point we could not
                    // follow, and it should not look like a traced flow.
                    <Circle className="mt-0.5 h-3 w-3 shrink-0 opacity-40" />
                  ) : (
                    <Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
                  )}
                  <span className="min-w-0">
                    {/* The row is the tab stop; this tooltip is hover-only
                        overflow relief. It shows what the truncation hides,
                        which is the one thing a tooltip is for. */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block truncate text-[0.78125rem] font-medium">
                          {middleTruncate(wf.title, RAIL_TITLE_CHARS)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs text-left">
                        {wf.title}
                      </TooltipContent>
                    </Tooltip>
                    <span className="block text-[0.6875rem] opacity-60">
                      {triggerLabel(wf.trigger_type)}
                      {key === "surface" ? "" : ` · ${wf.step_count} steps`}
                      {wf.realizes_capability ? " · capability" : ""}
                    </span>
                  </span>
                </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* flow graph + step detail. `graph-shell` makes this column own the
              same viewport slice the canvas used to claim on its own, so the
              summary block below eats into the canvas instead of pushing it
              past the bottom of the window — which is what left the first node
              at y≈670 with a void band above it. */}
          <div className="graph-shell">
            {/* Why this flow matters — plain-language ranking reasons, and the
                derivation of the score that ranked it. The derivation is behind
                a toggle: it is detail a reader asks for, not a wall they have
                to read past to reach the diagram. */}
            {selectedSummary && (
              <div className="mb-2 shrink-0 rounded-md border border-border bg-card px-3 py-2 text-[0.75rem]">
                {selectedSummary.purpose && (
                  <p className="text-foreground">{selectedSummary.purpose}</p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                  <span className="font-medium text-foreground">Criticality</span>
                  <span className="tabular-nums">
                    {Math.round(Number(selectedSummary.composite_score ?? 0) * 100)} / 100
                  </span>
                  {(selectedSummary.reasons?.length ?? 0) > 0 && (
                    <span className="min-w-0">· {selectedSummary.reasons![0]}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowScoring((v) => !v)}
                    aria-expanded={showScoring}
                    className="ml-auto inline-flex items-center gap-1 rounded-sm text-[0.6875rem] font-medium text-primary hover:underline"
                  >
                    {showScoring ? "Hide" : "How this was scored"}
                    <ChevronDown className={cn("h-3 w-3 transition-transform", showScoring && "rotate-180")} />
                  </button>
                </div>
                {showScoring && (
                  <div className="mt-2 border-t border-border pt-2">
                    {(selectedSummary.reasons?.length ?? 0) > 1 && (
                      <p className="mb-1.5 text-muted-foreground">
                        {selectedSummary.reasons!.slice(1).join(" · ")}
                      </p>
                    )}
                    {/* No amber caveat: the one this payload carries is the
                        signal-exclusion note ("2 of the 9 signals describe a
                        file's position in the import graph…"), which is a
                        reconciliation note for whoever audits the ranker, not
                        something a reader of this flow needs above the diagram.
                        It is still in the response, and still shown where a
                        derivation is the subject rather than the aside. */}
                    <ScoreProvenance
                      data={selectedSummary.provenance}
                      showReasons={false}
                      showCaveat={false}
                    />
                  </div>
                )}
              </div>
            )}
          {/* Flex, not grid, and `!h-auto` on the canvases: their own
              `100dvh - chrome` height is what overflowed the window in the
              first place, and a flex child sized by the row needs no
              percentage to resolve against. `min-h-80` is the floor — an open
              derivation must not squeeze the canvas out of existence; past
              that the column overflows and the page scrolls, which is right. */}
          <div className="flex min-h-80 flex-1 flex-col gap-3 xl:flex-row">
            <div className="graph-canvas relative !h-auto min-h-0 flex-1">
              {loadingGraph && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              )}
              {/* Scoped to this canvas: the rail beside it keeps working, so
                  the reader can pick another flow instead of losing the tab. */}
              {!loadingGraph && stepsError && (
                <div
                  className="absolute inset-0 z-10 flex items-center justify-center bg-background/90 p-6"
                  role="alert"
                >
                  <div className="max-w-sm text-center">
                    <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-danger" />
                    <p className="text-sm font-medium text-foreground">Couldn&apos;t load this flow&apos;s steps</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The request failed — this flow&apos;s steps were not fetched. It is not a flow
                      without steps.
                    </p>
                    <p className="mt-1 break-words text-[0.6875rem] text-muted-foreground/80">{stepsError}</p>
                    <Button
                      variant="outline"
                      size="xs"
                      className="mt-3"
                      onClick={() => setStepsReload((n) => n + 1)}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Retry
                    </Button>
                  </div>
                </div>
              )}
              {untraceable && (
                <div className="absolute left-2 top-2 z-10 max-w-md rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-[0.6875rem] leading-snug text-foreground">
                  All {steps.length} steps of this flow are in <span className="font-mono">{untraceable}</span> with no
                  symbols resolved — there is one file here, counted {steps.length} times, not a traced path between
                  {" "}{steps.length} places.
                </div>
              )}
              {/* Fullscreen's own exit: the header control that toggles it is
                  outside this overlay, so once it covers the viewport there was
                  nothing visible to click. Esc still works and says so. */}
              {fullscreen && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setFullscreen(false)}
                  className="absolute right-2 top-2 z-10"
                >
                  <Minimize2 className="mr-1 h-3 w-3" />
                  Exit fullscreen (Esc)
                </Button>
              )}
              {/* Shared canvas: selection no longer moves the camera here
                  either. The minimap appears only once the flow is longer than
                  the viewport can hold — over a six-step chain it was a second,
                  smaller copy of the picture already on screen. */}
              <GraphCanvas
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                fitPadding={0.15}
                fitMinZoom={0.5}
                minZoom={0.2}
                showMiniMap={flowNodes.length >= MINIMAP_MIN_NODES}
                // `showScoring` too: opening the derivation shortens the
                // canvas, and a fit computed against the taller box leaves the
                // graph hanging below the fold.
                refitSignal={`${layoutMode}:${fullscreen}:${selectedWorkflowId}:${showScoring}`}
              />
            </div>

            {selectedStep && (
              <aside className="graph-canvas !h-auto min-h-0 flex-1 overflow-y-auto !bg-card p-4 xl:flex-none xl:basis-[300px]">
                <p className="section-label mb-2">
                  Step {selectedStep.stepOrder} of {steps.length}
                </p>
                <p className="font-mono text-[0.8125rem] font-medium text-foreground">
                  {selectedStep.symbolName ?? selectedStep.filePath}
                </p>
                <p className="mt-0.5 break-all font-mono text-[0.6875rem] text-muted-foreground">
                  {selectedStep.filePath}
                  {selectedStep.lineStart && ` · L${selectedStep.lineStart}${selectedStep.lineEnd ? `–${selectedStep.lineEnd}` : ""}`}
                </p>
                <Badge variant="secondary" className="mt-2 text-[0.625rem] uppercase">{selectedStep.stepKind.replace(/_/g, " ")}</Badge>

                {/* What the step does, and where the sentence came from. The
                    audit's finding was not that the deterministic text is
                    wrong — it is that 95% of steps carry it with nothing
                    distinguishing them from the 5% a model actually read. */}
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-foreground">{selectedStep.explanation}</p>
                <p className="mt-1 flex items-center gap-1 text-[0.625rem] text-muted-foreground/80">
                  {selectedStep.narrated ? (
                    <>
                      <Sparkles className="h-2.5 w-2.5 text-primary" />
                      Written by the narration pass for this step
                    </>
                  ) : (
                    "Deterministic description — derived from the step's kind and target, not written about this code"
                  )}
                </p>

                {stepDetail?.doc?.summary && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="section-label mb-1">What this symbol is</p>
                    <p className="text-[0.78125rem] leading-relaxed text-foreground">
                      {stepDetail.doc.summary}
                    </p>
                  </div>
                )}
                {(stepDetail?.side_effects?.length ?? 0) > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {stepDetail!.side_effects!.map((se, i) =>
                      se.target ? (
                        // Focusable, and kept: the target is the one thing the
                        // chip does not show.
                        <Tooltip key={i}>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" tabIndex={0} className="h-5 px-1.5 text-[0.625rem]">
                              {se.type.replace(/_/g, " ")}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs break-all text-left">
                            {se.target}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Badge key={i} variant="outline" className="h-5 px-1.5 text-[0.625rem]">
                          {se.type.replace(/_/g, " ")}
                        </Badge>
                      ),
                    )}
                  </div>
                )}
                {stepDetail?.doc?.signature && (
                  <pre className="mt-3 overflow-x-auto rounded-md bg-muted px-2.5 py-2 text-[0.6875rem] leading-relaxed text-foreground">
                    {stepDetail.doc.signature}
                  </pre>
                )}
                <Link
                  to={`/projects/${id}/dependencies?focus=${encodeURIComponent(selectedStep.filePath)}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Open in Dependencies <ArrowRight className="h-3 w-3" />
                </Link>
              </aside>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
