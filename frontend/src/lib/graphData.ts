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
