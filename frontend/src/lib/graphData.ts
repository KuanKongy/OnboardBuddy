import { apiFetch } from "@/lib/api";
import { mockGraphData } from "@/lib/mockGraphData";
import type { AnalysisSnapshot } from "@/types/graph";

// Attempts the real dependency-graph endpoint, falling back to mock data while
// the analysis pipeline is still pending (the route currently returns 501).
// Once it ships, GraphPage starts rendering real snapshots with no changes.
export async function fetchDependencyGraph(
  projectId: string,
): Promise<AnalysisSnapshot> {
  try {
    return (await apiFetch(
      `/projects/${projectId}/graph/dependencies`,
    )) as AnalysisSnapshot;
  } catch {
    return { ...mockGraphData, projectId };
  }
}
