import { mockGraphData } from "@/lib/mockGraphData";
import type { AnalysisSnapshot } from "@/types/graph";

export async function fetchDependencyGraph(
  projectId: string,
): Promise<AnalysisSnapshot> {
  // TODO: once the analysis pipeline ships a real endpoint, swap this for:
  // return apiFetch(`/projects/${projectId}/graph`);
  return { ...mockGraphData, projectId };
}
