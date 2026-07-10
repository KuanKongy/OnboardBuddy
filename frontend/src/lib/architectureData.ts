import { apiFetch } from "@/lib/api";
import { mockGraphData } from "@/lib/mockGraphData";
import type { GraphResponse } from "@/lib/graphData";

/**
 * Fetches the full (uncapped) file-level graph for the latest snapshot.
 * The architecture map is derived client-side from this response via
 * deriveArchitectureGraph, so the same code path works for mock data.
 */
export async function fetchArchitectureSource(projectId: string): Promise<GraphResponse> {
  try {
    return (await apiFetch(`/projects/${projectId}/graph/architecture`)) as GraphResponse;
  } catch {
    if (import.meta.env.DEV) {
      return {
        projectId,
        snapshotId: "",
        clustered: false,
        totalNodes: mockGraphData.graph.nodes.length,
        totalEdges: mockGraphData.graph.edges.length,
        graph: mockGraphData.graph,
        fileAnalyses: mockGraphData.fileAnalyses,
      } as unknown as GraphResponse;
    }
    throw new Error("Failed to load architecture map data");
  }
}
