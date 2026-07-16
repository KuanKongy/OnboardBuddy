import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { ViewportFocus } from "@/components/graph/ViewportFocus";
import { useHotkeys } from "@/hooks/useHotkeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchWorkflowGraph,
  fetchWorkflowsList,
  type WorkflowGraphResponse,
  type WorkflowSummary,
} from "@/lib/graphData";
import { layoutGraph } from "@/lib/graphLayout";
import { fetchNodeDetail, type NodeDetail } from "@/lib/graphData";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
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
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-muted-foreground/60" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-muted-foreground/60" />
      <div className="flex items-center gap-2">
        {data.order !== null && (
          <span
            className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
            style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}
          >
            {data.order}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-foreground" title={data.label}>
          {data.label}
        </span>
        <span
          className="shrink-0 rounded px-1 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
          style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
        >
          {data.stepKind.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground" title={data.filePath}>
        {data.filePath}
      </p>
    </div>
  );
}

const nodeTypes = { step: StepNode };

export function WorkflowsPage() {
  const { id } = useParams<{ id: string }>();
  const isDark = useIsDarkMode();
  const selectedPackageId = useOptionalPackages()?.selectedPackageId ?? null;
  // Deep link from the capabilities hub: ?workflow=<id> preselects a flow.
  const [searchParams] = useSearchParams();
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    () => searchParams.get("workflow") ?? "",
  );
  const [detail, setDetail] = useState<WorkflowGraphResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  function loadWorkflows() {
    if (!id) return;
    setLoadingList(true);
    setError("");
    fetchWorkflowsList(id, selectedPackageId)
      .then((list) => {
        setWorkflows(list);
        if (list.length > 0) setSelectedWorkflowId((prev) => prev || list[0]!.id);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingList(false));
  }

  useEffect(() => { loadWorkflows(); }, [id, selectedPackageId]);

  // Esc closes the step details panel (pairs with the animated fit-out).
  useHotkeys({ Escape: () => setSelectedNodeId(null) }, selectedNodeId !== null);

  useEffect(() => {
    if (!id || !selectedWorkflowId) return;
    setLoadingGraph(true);
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

  const positioned = useMemo(() => {
    if (!detail) return [];
    return layoutGraph(
      detail.graph.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } })),
      detail.graph.edges,
      { direction: "TB", nodeWidth: 224, nodeHeight: 64, ranksep: 46, nodesep: 30 },
    );
  }, [detail]);

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
      (detail?.graph.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: true,
        style: { stroke: "var(--primary)", strokeWidth: 1.5, opacity: 0.7 },
      })),
    [detail],
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

  return (
    <div style={{ "--graph-chrome": "170px" } as React.CSSProperties}>
      <PageHeader
        title="Workflows"
        subtitle="Traced request flows — from the entry point through every function to its side effects, ranked by how critical they are."
        actions={
          detail ? (
            <Badge variant="outline" className="text-[11px]">
              {detail.workflow.trigger_type} · {detail.workflow.confidence} confidence
            </Badge>
          ) : undefined
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
        <div className="grid gap-3 lg:grid-cols-[250px_1fr]">
          {/* workflow rail — ranked most-critical first */}
          <div className="graph-canvas overflow-y-auto !bg-card p-2" data-tour="workflow-list">
            <p className="section-label px-2 pb-1.5 pt-1">Traced flows ({workflows.length}) — most critical first</p>
            <div className="space-y-0.5">
              {workflows.map((wf, rank) => (
                <button
                  key={wf.id}
                  onClick={() => setSelectedWorkflowId(wf.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                    selectedWorkflowId === wf.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-right text-[10px] tabular-nums opacity-50">{rank + 1}</span>
                  <Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium" title={wf.title}>{wf.title}</span>
                    <span className="block text-[11px] opacity-60">
                      {wf.trigger_type} · {wf.step_count} steps
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* flow graph + step detail */}
          <div>
            {/* Why this flow matters — plain-language ranking reasons */}
            {selectedSummary && (selectedSummary.purpose || (selectedSummary.reasons?.length ?? 0) > 0) && (
              <div className="mb-2 rounded-md border border-border bg-card px-3 py-2 text-[12px]">
                {selectedSummary.purpose && (
                  <p className="text-foreground">{selectedSummary.purpose}</p>
                )}
                {(selectedSummary.reasons?.length ?? 0) > 0 && (
                  <p className="mt-0.5 text-muted-foreground">
                    <span className="font-medium text-foreground">Why it matters:</span>{" "}
                    {selectedSummary.reasons!.slice(0, 3).join(" · ")}
                  </p>
                )}
              </div>
            )}
          <div className={selectedStep ? "grid gap-3 xl:grid-cols-[1fr_300px]" : ""}>
            <div className="graph-canvas relative">
              {loadingGraph && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              )}
              <ReactFlowProvider>
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                  onPaneClick={() => setSelectedNodeId(null)}
                  fitView
                  fitViewOptions={{ padding: 0.15 }}
                  minZoom={0.2}
                  proOptions={{ hideAttribution: true }}
                >
                  <ViewportFocus selectedNodeId={selectedNodeId} fitPadding={0.15} />
                  <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={isDark ? "oklch(0.28 0.02 264)" : "oklch(0.85 0.008 265)"} />
                  <Controls className="!border-border !bg-card [&_button]:!border-border [&_button]:!bg-card [&_button]:!text-muted-foreground [&_button:hover]:!bg-accent [&_button_svg]:!fill-current" />
                </ReactFlow>
              </ReactFlowProvider>
            </div>

            {selectedStep && (
              <aside className="graph-canvas overflow-y-auto !bg-card p-4">
                <p className="section-label mb-2">Step {selectedStep.stepOrder}</p>
                <p className="font-mono text-[13px] font-medium text-foreground">
                  {selectedStep.symbolName ?? selectedStep.filePath}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {selectedStep.filePath}
                  {selectedStep.lineStart && ` · L${selectedStep.lineStart}${selectedStep.lineEnd ? `–${selectedStep.lineEnd}` : ""}`}
                </p>
                <Badge variant="secondary" className="mt-2 text-[10px] uppercase">{selectedStep.stepKind.replace(/_/g, " ")}</Badge>
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{selectedStep.description}</p>

                {stepDetail?.doc?.summary && (
                  <p className="mt-3 text-[12.5px] leading-relaxed text-foreground">
                    <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
                    {stepDetail.doc.summary}
                  </p>
                )}
                {(stepDetail?.side_effects?.length ?? 0) > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {stepDetail!.side_effects!.map((se, i) => (
                      <Badge key={i} variant="outline" className="h-5 px-1.5 text-[10px]" title={se.target ?? undefined}>
                        {se.type.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                )}
                {stepDetail?.doc?.signature && (
                  <pre className="mt-3 overflow-x-auto rounded-md bg-muted px-2.5 py-2 text-[11px] leading-relaxed text-foreground">
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
