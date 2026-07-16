import { apiFetch } from "@/lib/api";

export interface GraphResponse {
  projectId: string;
  snapshotId: string;
  clustered: boolean;
  totalNodes: number;
  totalEdges: number;
  graph: { nodes: Array<{ id: string; label: string; kind: string; metadata: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; kind: string }>; entryPoints: string[] };
  fileAnalyses: unknown[];
}

export interface SymbolDoc {
  summary: string | null;
  summaryConfidence: string | null;
  factsOnly: boolean | null;
  signature: string | null;
  params: Array<{ name?: string; type?: string }>;
  returns: string | null;
  exampleUsage: { caller: string; filePath: string; lineStart: number | null; snippet: string } | null;
  receipts: Array<{
    id: string;
    receipt_kind: string;
    trust_level: string;
    file_path: string | null;
    symbol_name: string | null;
    line_start: number | null;
    line_end: number | null;
    snippet: string | null;
  }>;
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
  /** Deterministic relationships — present even without an AI record.
   * Files relate via imports, symbols via calls; labels come from the API
   * so the panel matches the on-node badge semantics. */
  callers?: Array<{ stable_key: string; name: string; file_path: string | null }>;
  callees?: Array<{ stable_key: string; name: string; file_path: string | null }>;
  relation_labels?: { inbound: string; outbound: string };
  side_effects?: Array<{ type: string; target: string | null }>;
  cluster?: { stable_key: string; label: string } | null;
  /** Standard symbol doc (doc/Pipeline.md "Symbol doc format"). */
  doc?: SymbolDoc;
}

export interface WorkflowSummary {
  id: string;
  title: string;
  trigger_type: string;
  purpose?: string | null;
  confidence: string;
  step_count: number;
  composite_score?: number | string;
  /** Deterministic ranking reasons — the "why this matters" line. */
  reasons?: string[];
  score_breakdown?: Record<string, number>;
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

/** Builds "?a=1&b=2" from present params — feature tabs pass the selected package through this. */
function queryString(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as Array<[string, string]>;
  if (entries.length === 0) return "";
  return `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

export async function fetchDependencyGraph(
  projectId: string,
  cluster?: string,
  packageId?: string | null,
): Promise<GraphResponse> {
  const url = `/projects/${projectId}/graph/dependencies${queryString({ cluster, package_id: packageId ?? undefined })}`;
  try {
    return (await apiFetch(url)) as GraphResponse;
  } catch {
    // No mock fallback: a failed load shows the honest empty/error state.
    throw new Error("Failed to load dependency graph data");
  }
}

export async function fetchClassGraph(projectId: string, packageId?: string | null): Promise<GraphResponse> {
  try {
    return (await apiFetch(
      `/projects/${projectId}/graph/classes${queryString({ package_id: packageId ?? undefined })}`,
    )) as GraphResponse;
  } catch {
    throw new Error("Failed to load class graph data");
  }
}

export async function fetchWorkflowsList(projectId: string, packageId?: string | null): Promise<WorkflowSummary[]> {
  try {
    const res = (await apiFetch(
      `/projects/${projectId}/workflows${queryString({ package_id: packageId ?? undefined })}`,
    )) as { workflows: WorkflowSummary[] };
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
  packageId?: string | null,
): Promise<NodeDetail | null> {
  try {
    const res = (await apiFetch(
      `/projects/${projectId}/graph/nodes/${encodeURIComponent(nodeKey)}${queryString({ package_id: packageId ?? undefined })}`,
    )) as { node: NodeDetail };
    return res.node ?? null;
  } catch {
    return null;
  }
}
