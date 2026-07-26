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
  metadata: ClusterMetadata;
}

/**
 * Counts computed once by the clusterer. `members` includes symbol, config and
 * schema nodes, so `members.length` is NOT a file count — rendering it as one
 * reported a cluster as several times bigger than it is, and printed
 * "0 files" over a Database Schema cluster holding 48 tables.
 */
export interface ClusterMetadata {
  /** File/module members only. The single definition of a cluster's size. */
  fileCount?: number;
  memberCount?: number;
  memberCountsByType?: Record<string, number>;
  /** Noun to count with — "table" and "config file" clusters have no files. */
  primaryMemberNoun?: "file" | "table" | "config file";
}

/** The count and noun to display for a cluster, honest about what it holds. */
export function clusterSize(c: {
  members: unknown[];
  metadata: ClusterMetadata;
}): { count: number; noun: string } {
  const noun = c.metadata.primaryMemberNoun ?? "file";
  const byType = c.metadata.memberCountsByType ?? {};
  const count =
    noun === "table" ? (byType.schema ?? 0)
    : noun === "config file" ? (byType.config ?? 0)
    // Pre-rework snapshots have no fileCount; members.length is the only thing
    // available and is at least an upper bound rather than a wrong noun.
    : (c.metadata.fileCount ?? c.members.length);
  return { count, noun };
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

export async function fetchArchitecture(projectId: string, packageId?: string | null): Promise<ArchitectureResponse> {
  const qs = packageId ? `?package_id=${encodeURIComponent(packageId)}` : "";
  return (await apiFetch(`/projects/${projectId}/graph/architecture${qs}`)) as ArchitectureResponse;
}
