import { apiFetch } from "@/lib/api";
import { mockGraphData } from "@/lib/mockGraphData";

export interface GraphResponse {
  projectId: string;
  snapshotId: string;
  clustered: boolean;
  totalNodes: number;
  totalEdges: number;
  graph: { nodes: Array<{ id: string; label: string; kind: string; metadata: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; kind: string }>; entryPoints: string[] };
  fileAnalyses: unknown[];
}

export interface NodeDetail {
  id: string;
  stable_key: string;
  type: string;
  name: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  composite_score: number | null;
  ranking_reasons: string[];
  connected_workflows: Array<{ id: string; title: string; trigger_type: string }>;
}

export interface WorkflowSummary {
  id: string;
  title: string;
  trigger_type: string;
  confidence: string;
  step_count: number;
}

export interface WorkflowGraphStep {
  stepOrder: number;
  filePath: string;
  symbolName: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  stepKind: string;
  description: string;
  nodeId: string;
}

export interface WorkflowGraphResponse {
  projectId: string;
  workflow: { id: string; title: string; trigger_type: string; purpose: string; confidence: string };
  steps: WorkflowGraphStep[];
  graph: GraphResponse["graph"];
}

export async function fetchDependencyGraph(
  projectId: string,
  cluster?: string,
): Promise<GraphResponse> {
  const url = cluster
    ? `/projects/${projectId}/graph/dependencies?cluster=${encodeURIComponent(cluster)}`
    : `/projects/${projectId}/graph/dependencies`;
  try {
    return (await apiFetch(url)) as GraphResponse;
  } catch {
    if (import.meta.env.DEV) {
      return { ...mockGraphData, projectId, snapshotId: "", clustered: false, totalNodes: 0, totalEdges: 0 } as unknown as GraphResponse;
    }
    throw new Error("Failed to load dependency graph data");
  }
}

export async function fetchClassGraph(projectId: string): Promise<GraphResponse> {
  try {
    return (await apiFetch(`/projects/${projectId}/graph/classes`)) as GraphResponse;
  } catch {
    throw new Error("Failed to load class graph data");
  }
}

export async function fetchWorkflowsList(projectId: string): Promise<WorkflowSummary[]> {
  try {
    const res = (await apiFetch(`/projects/${projectId}/workflows`)) as { workflows: WorkflowSummary[] };
    return res.workflows ?? [];
  } catch {
    throw new Error("Failed to load workflows");
  }
}

export async function fetchWorkflowGraph(
  projectId: string,
  workflowId: string,
): Promise<WorkflowGraphResponse> {
  try {
    return (await apiFetch(
      `/projects/${projectId}/graph/workflows/${encodeURIComponent(workflowId)}`,
    )) as WorkflowGraphResponse;
  } catch {
    throw new Error("Failed to load workflow graph");
  }
}

/** Best-effort node enrichment; returns null instead of throwing so a
 * missing ranking/workflow link never breaks the info panel. */
export async function fetchNodeDetail(
  projectId: string,
  nodeKey: string,
): Promise<NodeDetail | null> {
  try {
    const res = (await apiFetch(
      `/projects/${projectId}/graph/nodes/${encodeURIComponent(nodeKey)}`,
    )) as { node: NodeDetail };
    return res.node ?? null;
  } catch {
    return null;
  }
}
