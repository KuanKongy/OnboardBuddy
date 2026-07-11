import { apiFetch } from "@/lib/api";

export interface ArchitectureCluster {
  id: string; // stable_key
  label: string;
  kind: string;
  criticalScore: number;
  summary: string;
  summarySource: "semantic" | "deterministic";
  confidence: string | null;
  members: Array<{ key: string; name: string; filePath: string | null }>;
  metadata: Record<string, unknown>;
}

export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  weight: number;
}

export interface ArchitectureResponse {
  projectId: string;
  snapshotId: string;
  clusters: ArchitectureCluster[];
  edges: ArchitectureEdge[];
}

/** Cluster kind → categorical node palette token (see styles.css). */
export const CLUSTER_KIND_PALETTE: Record<string, string> = {
  frontend_ui: "ui",
  frontend_state: "ui",
  api_layer: "api",
  auth_layer: "api",
  database_layer: "data",
  worker_layer: "worker",
  analysis_engine: "worker",
  integration_layer: "config",
  devops_layer: "config",
  test_layer: "test",
  shared_module: "shared",
  other: "shared",
};

export const CLUSTER_KIND_LABELS: Record<string, string> = {
  frontend_ui: "Frontend UI",
  frontend_state: "Frontend state",
  api_layer: "API layer",
  auth_layer: "Auth",
  database_layer: "Database",
  worker_layer: "Worker",
  analysis_engine: "Engine",
  integration_layer: "Integrations",
  devops_layer: "DevOps",
  test_layer: "Tests",
  shared_module: "Shared",
  other: "Other",
};

export async function fetchArchitecture(projectId: string): Promise<ArchitectureResponse> {
  return (await apiFetch(`/projects/${projectId}/graph/architecture`)) as ArchitectureResponse;
}
