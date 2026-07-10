import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DependencyGraphView } from "@/components/graph/DependencyGraphView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchWorkflowGraph,
  fetchWorkflowsList,
  type WorkflowGraphResponse,
  type WorkflowSummary,
} from "@/lib/graphData";
import { layoutDependencyGraph } from "@/lib/graphLayout";
import type { GraphEdge, GraphNode } from "@/types/graph";
import { cn } from "@/lib/utils";

interface WorkflowGraphSectionProps {
  projectId: string;
}

export function WorkflowGraphSection({ projectId }: WorkflowGraphSectionProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [detail, setDetail] = useState<WorkflowGraphResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  function loadWorkflows() {
    setLoadingList(true);
    setError("");
    fetchWorkflowsList(projectId)
      .then((list) => {
        setWorkflows(list);
        if (list.length > 0) setSelectedWorkflowId((prev) => prev || list[0]!.id);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingList(false));
  }

  useEffect(() => { loadWorkflows(); }, [projectId]);

  useEffect(() => {
    if (!selectedWorkflowId) return;
    setLoadingGraph(true);
    setSelectedNodeId(null);
    fetchWorkflowGraph(projectId, selectedWorkflowId)
      .then(setDetail)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingGraph(false));
  }, [projectId, selectedWorkflowId]);

  const nodes: GraphNode[] = useMemo(() => {
    if (!detail) return [];
    return detail.graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      metadata: {
        exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
        importCount: (n.metadata?.importCount as number) ?? 0,
        dependentCount: (n.metadata?.dependentCount as number) ?? 0,
      },
    }));
  }, [detail]);

  const edges: GraphEdge[] = useMemo(() => {
    if (!detail) return [];
    return detail.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, kind: e.kind }));
  }, [detail]);

  const positionedNodes = useMemo(
    () => layoutDependencyGraph(nodes, edges, detail?.graph.entryPoints ?? []),
    [nodes, edges, detail],
  );

  if (loadingList) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !workflows || workflows.length === 0) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            {error || "No workflows extracted yet"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Workflow paths are traced from entrypoints during analysis. Run an analysis first, or
            retry if analysis has completed.
          </p>
        </div>
        <Button variant="outline" size="xs" onClick={loadWorkflows}>
          <RefreshCw className="mr-1 h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedWorkflowId}
          onChange={(e) => setSelectedWorkflowId(e.target.value)}
          className="h-8 min-w-[220px] flex-1 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {workflows.map((wf) => (
            <option key={wf.id} value={wf.id}>
              {wf.title} ({wf.step_count} steps)
            </option>
          ))}
        </select>
        {detail && (
          <Badge variant="outline" className="text-[10px]">
            {detail.workflow.trigger_type} · {detail.workflow.confidence} confidence
          </Badge>
        )}
      </div>

      {loadingGraph && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {detail && !loadingGraph && (
        <>
          <div className="h-[260px] w-full rounded-xl border border-border sm:h-[340px] md:h-[400px]">
            <DependencyGraphView
              nodes={positionedNodes}
              edges={edges}
              entryPoints={detail.graph.entryPoints}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              edgeFilter="imports"
            />
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                Workflow steps
              </h3>
            </div>
            <ol className="divide-y divide-border">
              {detail.steps.map((step) => (
                <li key={step.stepOrder}>
                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(step.nodeId)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-accent/50",
                      selectedNodeId === step.nodeId && "bg-accent",
                    )}
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground">
                      {step.stepOrder}
                    </span>
                    <span className="flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[12px] text-foreground">
                          {step.symbolName ?? step.filePath}
                        </span>
                        <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">
                          {step.stepKind}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {step.description}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </>
  );
}
