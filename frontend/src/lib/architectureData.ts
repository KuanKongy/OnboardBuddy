import { apiFetch } from "@/lib/api";
import type { ScoreProvenanceData } from "@/components/ScoreProvenance";

/**
 * What a component is FOR, what crosses its boundary, and why it is separate —
 * three sentences derived on the server from the same stored rows the
 * `architecture_deep` section reads, so the tab and the generated prose cannot
 * describe one component two different ways.
 *
 * This replaces reading `summary` as the explanation. `summary` was
 * "Auth services: 9 files, 40 symbols" — an inventory, printed under a heading
 * that already said the label and beside a chip that already said the count.
 */
export interface ClusterNarrative {
  responsibility: string;
  boundary: string;
  separation: string;
  /** What the evidence could not establish. Shown, not swallowed. */
  unknowns: string[];
  summary: string;
}

export interface ArchitectureCluster {
  id: string; // stable_key
  label: string;
  kind: string;
  criticalScore: number;
  /** Null on a response from before narratives existed (or an e2e fixture). */
  narrative?: ClusterNarrative | null;
  /**
   * How `criticalScore` was reached — it is the MEAN of the members' own
   * criticality scores, which is the single fact that makes the number make
   * sense. Optional because a response from before this existed (or an e2e
   * fixture) has none, and the UI must then say the derivation is unavailable
   * rather than invent one.
   */
  provenance?: ScoreProvenanceData;
  summary: string;
  summarySource: "semantic" | "deterministic";
  confidence: string | null;
  /**
   * Ordered by the server: most critical first, then by path. It used to
   * arrive in join order, which is neither stable across requests nor
   * meaningful to read.
   *
   * `summary` is the file's stored one-line record — the same source the
   * Dependencies tab reads — and is null for members the analyzer wrote no
   * record for (59% of the fleet's members have one). A member without a
   * record shows its path alone; a filler sentence would be worse than
   * silence.
   */
  members: Array<{
    key: string;
    name: string;
    filePath: string | null;
    summary?: string | null;
    role?: string | null;
  }>;
  /**
   * Architecture edges touching this component. 0 means it is drawn as an
   * island, which the UI has to explain rather than leave looking broken
   * (AUDIT C7 / SC F11). Absent on a response predating this field.
   */
  degree?: number;
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

/**
 * Where a component's count came from and what it leaves out — the number
 * contract applied to the one number on the component card.
 *
 * A bare "9 files" cannot be checked. This names the denominator, lists the
 * member types that are NOT in it, and says what would move it, so a reader can
 * tell "small component" from "large component counted with the wrong noun" —
 * which is exactly how a Database Schema cluster holding 48 tables came to
 * report "0 files".
 */
export function clusterCountDerivation(c: {
  members: unknown[];
  metadata: ClusterMetadata;
}): string {
  const { count, noun } = clusterSize(c);
  const byType = c.metadata.memberCountsByType ?? {};
  const NOUN_TYPE: Record<string, string> = { file: "module", table: "schema", "config file": "config" };
  const counted = NOUN_TYPE[noun] ?? "module";
  const others = Object.entries(byType)
    .filter(([type, n]) => type !== counted && n > 0)
    .map(([type, n]) => `${n} ${type}`);

  const lines = [
    `${count} ${noun}${count === 1 ? "" : "s"} — counted over this component's ${counted} members only.`,
  ];
  if (others.length > 0) {
    lines.push(`It also holds ${others.join(", ")} node${others.length === 1 && !others[0]!.startsWith("1 ") ? "s" : ""}, which are not in this number.`);
  }
  if (c.metadata.memberCount != null && c.metadata.memberCount !== count) {
    lines.push(`${c.metadata.memberCount} members in total.`);
  }
  lines.push("The number changes when files move between directories — grouping is by path, so a rename can move a file to another component without any behaviour changing.");
  return lines.join(" ");
}

export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  weight: number;
}

/** One member of a component, at the level below it. */
export interface ArchitectureMember {
  id: string;
  label: string;
  /** Node type: module/file, or config/schema for the evidence-only clusters. */
  kind: string;
  filePath: string | null;
  /** What this file does, from its stored file record. Null when none exists. */
  summary?: string | null;
  /** The record's own classification: "route file", "service", "config glue". */
  role?: string | null;
  /** Null when this member carries no stored criticality score. */
  criticalScore: number | null;
  provenance?: ScoreProvenanceData;
  exportedSymbols: string[];
  importCount: number;
  dependentCount: number;
}

/**
 * The level beneath one component. Present only when the request carried
 * `?cluster=`; a root response leaves it null.
 */
export interface ArchitectureLevel {
  clusterId: string;
  label: string;
  kind: string;
  nodes: ArchitectureMember[];
  edges: ArchitectureEdge[];
  /** Members before the node cap — `truncated` of them are not drawn. */
  totalNodes: number;
  truncated: number;
}

export interface ArchitectureResponse {
  projectId: string;
  snapshotId: string;
  clusters: ArchitectureCluster[];
  edges: ArchitectureEdge[];
  level?: ArchitectureLevel | null;
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

/**
 * One level of the architecture map. `clusterKey` opens a component and the
 * response then also carries `level` — its members and the edges between them.
 *
 * The root clusters ride along on every response so the aside can keep
 * describing the component you are inside without a second request.
 */
export async function fetchArchitecture(
  projectId: string,
  packageId?: string | null,
  clusterKey?: string | null,
): Promise<ArchitectureResponse> {
  const params = new URLSearchParams();
  if (packageId) params.set("package_id", packageId);
  if (clusterKey) params.set("cluster", clusterKey);
  const qs = params.toString() ? `?${params}` : "";
  const data = (await apiFetch(`/projects/${projectId}/graph/architecture${qs}`)) as ArchitectureResponse;

  // An API (or an e2e fixture) that ignores `?cluster=` would otherwise commit
  // the ROOT graph as the drilled level, silently showing every component again
  // one level down. Falling back to the members we already hold keeps the level
  // honest: the right files, and no edges we cannot prove.
  if (clusterKey && !data.level) {
    const cluster = data.clusters.find((c) => c.id === clusterKey);
    if (!cluster) throw new Error("That component is not in this analysis");
    const nodes: ArchitectureMember[] = cluster.members.map((m) => ({
      id: m.key,
      label: m.name,
      kind: "module",
      filePath: m.filePath,
      summary: m.summary ?? null,
      role: m.role ?? null,
      criticalScore: null,
      exportedSymbols: [],
      importCount: 0,
      dependentCount: 0,
    }));
    data.level = {
      clusterId: cluster.id,
      label: cluster.label,
      kind: cluster.kind,
      nodes,
      edges: [],
      totalNodes: nodes.length,
      truncated: 0,
    };
  }
  return data;
}
