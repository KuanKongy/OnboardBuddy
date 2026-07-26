import { AlertTriangle, ArrowRight, Circle, Info, Loader2, Maximize2, Minimize2, RefreshCw, Sparkles, Zap } from "lucide-react";
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
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { useHotkeys } from "@/hooks/useHotkeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  fetchWorkflowGraph,
  fetchWorkflowsList,
  WORKFLOW_TIERS,
  type WorkflowGraphResponse,
  type WorkflowOrdering,
  type WorkflowSummary,
} from "@/lib/graphData";
import { layoutGraph } from "@/lib/graphLayout";
import { layoutSerpentine, shouldSerpentine, type SerpentineLayout } from "@/lib/serpentine";
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

interface StepNodeData {
  label: string;
  filePath: string;
  stepKind: string;
  order: number | null;
  selected: boolean;
}

function StepNode({ data }: NodeProps<StepNodeData>) {
  const palette = STEP_KIND_PALETTE[data.stepKind] ?? "shared";
  const color = `var(--node-${palette})`;
  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card px-3 py-2 shadow-sm transition-all",
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
        {data.order !== null && (
          <span
            className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold"
            style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}
          >
            {data.order}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[0.75rem] font-medium text-foreground" title={data.label}>
          {data.label}
        </span>
        <span
          className="shrink-0 rounded px-1 py-0.5 text-[0.59375rem] font-semibold uppercase tracking-wide"
          style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
        >
          {data.stepKind.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[0.65625rem] text-muted-foreground" title={data.filePath}>
        {data.filePath}
      </p>
    </div>
  );
}

const nodeTypes = { step: StepNode };

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
  const [detail, setDetail] = useState<WorkflowGraphResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // `auto` picks per workflow; the explicit modes let a reader override a
  // choice they disagree with rather than being stuck with it.
  const [layoutMode, setLayoutMode] = useState<"auto" | "snake" | "column">("auto");
  const [fullscreen, setFullscreen] = useState(false);
  const [search, setSearch] = useState("");

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
    setSelectedNodeId(null);
    fetchWorkflowGraph(id, selectedWorkflowId)
      .then(setDetail)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingGraph(false));
  }, [id, selectedWorkflowId]);

  const stepByNodeId = useMemo(() => {
    const m = new Map<string, { order: number; kind: string; filePath: string }>();
    for (const s of detail?.steps ?? []) {
      if (!m.has(s.nodeId)) m.set(s.nodeId, { order: s.stepOrder, kind: s.stepKind, filePath: s.filePath });
    }
    return m;
  }, [detail]);

  /**
   * A workflow is a chain, so it snakes: left to right, drop a row, right to
   * left. Laid out as one dagre column a 20-step flow was ~20 nodes tall and
   * one wide, so at any readable zoom you saw about three steps and scrolled
   * to follow a single trace.
   *
   * Short flows and branch-heavy graphs still go through dagre — snaking three
   * steps adds turns for nothing, and a hub-and-spoke shape is not a chain.
   */
  const layout = useMemo(() => {
    if (!detail) return { nodes: [], routing: null as SerpentineLayout["edgeRouting"] | null };
    const graphNodes = detail.graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 },
    }));
    const snake = layoutMode === "snake" || (layoutMode === "auto" && shouldSerpentine(graphNodes, detail.graph.edges));
    if (!snake) {
      return {
        nodes: layoutGraph(graphNodes, detail.graph.edges, {
          direction: "TB", nodeWidth: 224, nodeHeight: 64, ranksep: 46, nodesep: 30,
        }),
        routing: null,
      };
    }
    const out = layoutSerpentine(graphNodes, detail.graph.edges, { nodeWidth: 224, nodeHeight: 64 });
    return { nodes: out.nodes, routing: out.edgeRouting };
  }, [detail, layoutMode]);

  const positioned = layout.nodes;

  const flowNodes: Node<StepNodeData>[] = useMemo(
    () =>
      positioned.map((p) => {
        const step = stepByNodeId.get(p.id);
        return {
          id: p.id,
          type: "step",
          position: { x: p.x, y: p.y },
          data: {
            label: p.label,
            filePath: step?.filePath ?? p.id,
            stepKind: step?.kind ?? p.kind,
            order: step?.order ?? null,
            selected: p.id === selectedNodeId,
          },
        };
      }),
    [positioned, stepByNodeId, selectedNodeId],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      (detail?.graph.edges ?? []).map((e) => {
        const route = layout.routing?.get(e.id);
        const isBranch = route?.kind === "branch";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          // Without explicit handles a snaked edge picks whichever side React
          // Flow guesses and loops back around the node.
          ...(route ? { sourceHandle: route.sourceHandle, targetHandle: route.targetHandle } : {}),
          // Rounded orthogonal segments follow the snake; a fork off the main
          // line is dashed so it reads as leaving the chain.
          type: route ? (isBranch ? "default" : "smoothstep") : "default",
          ...(route && !isBranch ? { pathOptions: { borderRadius: 16 } } : {}),
          animated: !isBranch,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--primary)" },
          style: {
            stroke: "var(--primary)",
            strokeWidth: 1.5,
            opacity: isBranch ? 0.45 : 0.7,
            ...(isBranch ? { strokeDasharray: "4 3" } : {}),
          },
        };
      }),
    [detail, layout.routing],
  );

  const selectedStep = detail?.steps.find((s) => s.nodeId === selectedNodeId) ?? null;

  // Enrich the selected step with its symbol doc (AI summary, snippet,
  // side effects) — the deterministic description alone is thin.
  const [stepDetail, setStepDetail] = useState<NodeDetail | null>(null);
  useEffect(() => {
    setStepDetail(null);
    if (!id || !selectedStep?.nodeId) return;
    let cancelled = false;
    fetchNodeDetail(id, selectedStep.nodeId, selectedPackageId).then((d) => {
      if (!cancelled) setStepDetail(d);
    });
    return () => { cancelled = true; };
  }, [id, selectedStep?.nodeId, selectedPackageId]);

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

  return (
    <div style={{ "--graph-chrome": "170px" } as React.CSSProperties}>
      <PageHeader
        title="Workflows"
        subtitle="Traced request flows — from the entry point through every function to its side effects, ranked by how critical they are."
        actions={
          <>
            {detail && (
              <Badge variant="outline" className="text-[0.6875rem]">
                {detail.workflow.trigger_type} · {detail.workflow.confidence} confidence
              </Badge>
            )}
            {detail && (
              <>
                {/* Parity with the other graph tabs, which have had these all
                    along — Workflows shipped without a minimap, search or
                    fullscreen, on the tab whose graphs are the longest. */}
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setFullscreen((v) => !v)}
                  title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
                >
                  {fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                </Button>
                <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                  {(["auto", "snake", "column"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setLayoutMode(m)}
                      aria-pressed={layoutMode === m}
                      title={
                        m === "auto" ? "Snake long chains, column for short ones"
                        : m === "snake" ? "Always snake left-right, wrapping down"
                        : "Always one top-to-bottom column"
                      }
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                        layoutMode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        }
      />

      {loadingList && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {!loadingList && (error || !workflows || workflows.length === 0) && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{error || "No workflows traced yet"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Workflows are traced from entry points during analysis. If the repo has no detectable
              entry points, none can be traced — that's reported honestly, not invented.
            </p>
          </div>
          <Button variant="outline" size="xs" onClick={loadWorkflows}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {!loadingList && workflows && workflows.length > 0 && (
        <div
          className={cn(
            "grid gap-3 lg:grid-cols-[250px_1fr]",
            fullscreen && "fixed inset-0 z-50 bg-background p-3",
          )}
        >
          {/* workflow rail — ranked most-critical first */}
          <div className="graph-canvas overflow-y-auto !bg-card p-2" data-tour="workflow-list">
            <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1">
              <p className="section-label">
                {search
                  ? `${visibleWorkflows.length} of ${workflows.length} flows`
                  : `Traced flows (${workflows.length}) — most critical first`}
              </p>
              {/* What "most critical first" actually means here is the rail's
                  sort order, not any one flow's score — tier decides before a
                  score is compared. The sequence is served by the API beside
                  the ORDER BY that implements it; each flow's own criticality
                  is derived under the flow, where that number is shown. */}
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
                    <span className="block truncate text-[0.78125rem] font-medium" title={wf.title}>{wf.title}</span>
                    <span className="block text-[0.6875rem] opacity-60">
                      {wf.trigger_type}
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

          {/* flow graph + step detail */}
          <div>
            {/* Why this flow matters — plain-language ranking reasons, and the
                derivation of the score that ranked it. Shown for any selected
                flow now: the criticality block is always meaningful, where the
                purpose/reasons text is not always present. */}
            {selectedSummary && (
              <div className="mb-2 rounded-md border border-border bg-card px-3 py-2 text-[0.75rem]">
                {selectedSummary.purpose && (
                  <p className="text-foreground">{selectedSummary.purpose}</p>
                )}
                {(selectedSummary.reasons?.length ?? 0) > 0 && (
                  <p className="mt-0.5 text-muted-foreground">
                    <span className="font-medium text-foreground">Why it matters:</span>{" "}
                    {selectedSummary.reasons!.slice(0, 3).join(" · ")}
                  </p>
                )}
                {/* The score behind the rail's "most critical" claim, with the
                    signals that produced it. Reasons are suppressed here
                    because the line above already prints the same stored
                    strings. */}
                <div className="mt-2 border-t border-border pt-2">
                  <div className="mb-1 flex items-center gap-1.5">
                    <p className="section-label">Criticality</p>
                    <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                      {Math.round(Number(selectedSummary.composite_score ?? 0) * 100)} / 100
                    </span>
                  </div>
                  <ScoreProvenance data={selectedSummary.provenance} showReasons={false} />
                </div>
              </div>
            )}
          <div className={selectedStep ? "grid gap-3 xl:grid-cols-[1fr_300px]" : ""}>
            <div className="graph-canvas relative">
              {loadingGraph && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              )}
              {/* Shared canvas: selection no longer moves the camera here
                  either, and this tab finally gets a minimap. */}
              <GraphCanvas
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                fitPadding={0.15}
                fitMinZoom={0.5}
                minZoom={0.2}
                refitSignal={`${layoutMode}:${fullscreen}:${selectedWorkflowId}`}
              />
            </div>

            {selectedStep && (
              <aside className="graph-canvas overflow-y-auto !bg-card p-4">
                <p className="section-label mb-2">Step {selectedStep.stepOrder}</p>
                <p className="font-mono text-[0.8125rem] font-medium text-foreground">
                  {selectedStep.symbolName ?? selectedStep.filePath}
                </p>
                <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                  {selectedStep.filePath}
                  {selectedStep.lineStart && ` · L${selectedStep.lineStart}${selectedStep.lineEnd ? `–${selectedStep.lineEnd}` : ""}`}
                </p>
                <Badge variant="secondary" className="mt-2 text-[0.625rem] uppercase">{selectedStep.stepKind.replace(/_/g, " ")}</Badge>
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">{selectedStep.description}</p>

                {stepDetail?.doc?.summary && (
                  <p className="mt-3 text-[0.78125rem] leading-relaxed text-foreground">
                    <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
                    {stepDetail.doc.summary}
                  </p>
                )}
                {(stepDetail?.side_effects?.length ?? 0) > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {stepDetail!.side_effects!.map((se, i) => (
                      <Badge key={i} variant="outline" className="h-5 px-1.5 text-[0.625rem]" title={se.target ?? undefined}>
                        {se.type.replace(/_/g, " ")}
                      </Badge>
                    ))}
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
