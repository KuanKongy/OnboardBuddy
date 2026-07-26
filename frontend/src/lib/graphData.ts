import { apiFetch } from "@/lib/api";
import type { ScoreProvenanceData } from "@/components/ScoreProvenance";

/**
 * What a level left out, and why. Sent by the API whenever the node cap bites
 * — which used to happen silently below the root, so a drilled group of 107
 * files drew 60 and told the reader nothing.
 */
export interface GraphTruncation {
  shown: number;
  total: number;
  hidden: number;
  /** The per-view node cap that caused the cut. */
  limit: number;
  unit: "groups" | "files" | "groups and files" | "classes" | "groups and classes";
  /** The rule that chose the survivors. */
  keptBy: string;
  /** Where the rest can still be reached, when anywhere. */
  seeRest: string | null;
}

/**
 * Which rung of the two-level ladder this response is (groups → files).
 * `file` was a third rung — the symbols inside one file — removed as unhelpful;
 * the type is gone so nothing can reintroduce it by accident.
 */
export interface GraphLevel {
  kind: "root" | "cluster";
  id: string | null;
  unit: GraphTruncation["unit"];
}

/**
 * Every number the header may print, and what each one counts.
 *
 * The header used to print the level's totals over a canvas drawing far fewer
 * things ("227 files · 929 edges" above 8 boxes and 2 arrows). Both were true;
 * neither said what it counted. The UI now always shows the drawn number
 * first, and names the population the bigger number belongs to.
 */
export interface GraphLevelCounts {
  nodesShown: number;
  groupsShown: number;
  filesShown: number;
  edgesShown: number;
  filesTotal: number;
  linksTotal: number;
  linksInsideGroups: number;
}

export interface GraphResponse {
  projectId: string;
  snapshotId: string;
  clustered: boolean;
  /** Node count for THIS level before the cap (not the whole snapshot). */
  totalNodes: number;
  totalEdges: number;
  /** Absent on responses from a server predating the ladder. */
  level?: GraphLevel;
  /** Absent on responses from a server predating count reconciliation. */
  counts?: GraphLevelCounts;
  /** Drawn files carrying a "what this file does" line. */
  describedFiles?: number;
  /**
   * Drawn class/interface nodes carrying a "what this does" line. Separate
   * from `describedFiles` because the two views count different populations
   * against different record levels, and roughly half of all symbol records
   * are deterministic restatements that are deliberately not shown.
   */
  describedNodes?: number;
  truncation?: GraphTruncation | null;
  graph: { nodes: Array<{ id: string; label: string; kind: string; metadata: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; kind: string }>; entryPoints: string[] };
  fileAnalyses: unknown[];
}

export interface SymbolDoc {
  summary: string | null;
  summaryConfidence: string | null;
  factsOnly: boolean | null;
  /** File records only: "route file", "service", "config glue". */
  role?: string | null;
  /** File records only: the names the record calls this file's headline symbols. */
  keySymbols?: string[];
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
  /** "file_fallback" = the score is the symbol's file rank (symbol unranked). */
  ranking_scope?: "direct" | "file_fallback" | null;
  ranking_reasons: string[];
  /** The stored signal breakdown behind `composite_score`. Null when unranked. */
  ranking_provenance?: ScoreProvenanceData | null;
  connected_workflows: Array<{ id: string; title: string; trigger_type: string }>;
  /** Deterministic relationships — present even without an AI record.
   * Files relate via imports, symbols via calls; labels come from the API
   * so the panel matches the on-node badge semantics. */
  callers?: Array<{ stable_key: string; name: string; file_path: string | null }>;
  callees?: Array<{ stable_key: string; name: string; file_path: string | null }>;
  /**
   * How many relations EXIST, against the ≤8 listed above. Without it the
   * panel contradicted itself: the reasons said "Imported by 12 files" and the
   * list header below said "Imported by (8)".
   */
  relation_totals?: { inbound: number; outbound: number };
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
  /**
   * How `composite_score` was reached. Comes back unavailable for a flow with
   * no candidate-ranking row, where the number shown is the extractor's own
   * importance score and has no signal breakdown behind it — a real
   * distinction the rail used to hide.
   */
  provenance?: ScoreProvenanceData;
  /**
   * Which band of the list this belongs to. `core` is a flow a person triggers
   * that changes state, `supporting` is background and developer work, and
   * `surface` is an entry point whose flow could not be traced — an endpoint
   * or page that exists but does nothing we could follow. Absent on packages
   * generated before tiering, which fall back to `supporting`.
   */
  tier?: WorkflowTier;
  /** True when a step of this flow belongs to a named business capability. */
  realizes_capability?: boolean;
}

export type WorkflowTier = "core" | "supporting" | "surface";

/** Heading, and the honest qualifier under it. */
export const WORKFLOW_TIERS: Array<{ key: WorkflowTier; label: string; note?: string }> = [
  { key: "core", label: "Core user flows" },
  { key: "supporting", label: "Supporting flows", note: "background jobs, developer commands, admin paths" },
  { key: "surface", label: "Endpoints & pages", note: "no side effects traced from these" },
];

/**
 * Trigger kinds that reach the UI as raw enum values.
 *
 * Most already arrive as prose ("HTTP GET", "UI page"), which is what made the
 * rest look like a leak: one list mixing `message_consumer` with `HTTP POST`
 * reads as two half-finished features. Anything unmapped falls through to
 * underscore-stripping rather than being hidden.
 */
const TRIGGER_LABELS: Record<string, string> = {
  ci_pipeline: "CI pipeline",
  dev_command: "Dev command",
  event_handler: "Event handler",
  export: "Exported function",
  journey: "User journey",
  message_consumer: "Queue consumer",
};

export function triggerLabel(raw: string | null | undefined): string {
  if (!raw) return "flow";
  return TRIGGER_LABELS[raw] ?? raw.replace(/_/g, " ");
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

/**
 * One level of the class ladder. `dir` opens a directory group; without it the
 * response is the root level, which is grouped only when the project has more
 * classes than a canvas can draw.
 */
export async function fetchClassGraph(
  projectId: string,
  packageId?: string | null,
  dir?: string | null,
): Promise<GraphResponse> {
  try {
    return (await apiFetch(
      `/projects/${projectId}/graph/classes${queryString({ package_id: packageId ?? undefined, dir: dir ?? undefined })}`,
    )) as GraphResponse;
  } catch {
    throw new Error("Failed to load class graph data");
  }
}

/**
 * How the rail is ordered, served by the API next to the ORDER BY that does
 * it. "Most critical first" is a claim about tiers before it is a claim about
 * scores, and stating it here rather than in the page keeps the two together.
 */
export interface WorkflowOrdering {
  summary: string;
  steps: string[];
}

export interface WorkflowsListResponse {
  workflows: WorkflowSummary[];
  ordering?: WorkflowOrdering;
}

export async function fetchWorkflowsList(
  projectId: string,
  packageId?: string | null,
): Promise<WorkflowsListResponse> {
  try {
    const res = (await apiFetch(
      `/projects/${projectId}/workflows${queryString({ package_id: packageId ?? undefined })}`,
    )) as WorkflowsListResponse;
    return { workflows: res.workflows ?? [], ordering: res.ordering };
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
