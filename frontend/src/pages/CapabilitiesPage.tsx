import {
  ArrowRight,
  Boxes,
  Circle,
  CornerLeftUp,
  Database,
  FileCode2,
  Info,
  Maximize2,
  Minimize2,
  Plug,
  RefreshCw,
  Route as RouteIcon,
  SearchX,
  Sparkles,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Handle, MarkerType, Position, type Edge, type Node, type NodeProps } from "reactflow";
import "reactflow/dist/style.css";
import { GraphCanvas, MINIMAP_MIN_NODES } from "@/components/graph/GraphCanvas";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import { useDrillStack } from "@/hooks/useDrillStack";
import { useGraphDrill } from "@/hooks/useGraphDrill";
import { apiFetch } from "@/lib/api";
import { CLUSTER_KIND_PALETTE } from "@/lib/architectureData";
import { middleTruncate } from "@/lib/format";
import { triggerLabel } from "@/lib/graphData";
import { layoutGraph, layoutRows } from "@/lib/graphLayout";
import { buildStepChain, layoutSerpentine, shouldSerpentine, type SerpentineLayout } from "@/lib/serpentine";
import { cn } from "@/lib/utils";
import type { GraphEdge, GraphNode } from "@/types/graph";

// ── Response shape ───────────────────────────────────────────────────────────

interface StartHereRef {
  stable_key: string;
  reason?: string;
}

interface CapabilityFlow {
  id: string;
  stableKey: string | null;
  title: string;
  triggerType: string | null;
  purpose: string | null;
  tier: string | null;
  stepCount: number;
  score: number;
  reason: string | null;
  tutorials: Array<{ id: string; title: string }>;
}

interface Capability {
  id: string;
  stableKey: string;
  name: string;
  description: string;
  confidence: string;
  summary: string | null;
  userValue: string | null;
  tier: "core" | "supporting" | null;
  score: number | null;
  realizesUserAction: boolean | null;
  namedBy: "model" | "deterministic" | null;
  derivation: string[];
  binding: {
    key: string | null;
    keySource: string | null;
    entrypoints: Array<{ kind: string; route: string | null; filePath: string; symbol: string | null }>;
    schemas: string[];
    services: string[];
    /**
     * Non-table persistence the flow reaches (filesystem, job queue, network).
     * Binding leg 3 accepts these, so a capability can be fully bound with
     * zero tables — without this the card reported "0 tables, 0 services" for
     * a flow that demonstrably writes to disk.
     */
    surfaces: string[];
  };
  whereToStart: StartHereRef[];
  workflows: CapabilityFlow[];
  nodes: Array<{ stableKey: string; name: string | null; filePath: string | null; reason: string | null }>;
  modules: Array<{ id: string; label: string; stableKey: string | null; kind: string | null; reason: string | null }>;
}

interface Derivation {
  tracedFlows: number;
  consideredFlows: number;
  boundFlows: number;
  entrypoints: number;
  schemaTables: number;
  unbound: Array<{ title: string; missing: string }>;
  reportStored: boolean;
}

interface CapabilitiesResponse {
  capabilities: Capability[];
  ordering?: { summary: string; steps: string[] };
  bindingRule?: { summary: string; legs: string[] };
  derivation?: Derivation | null;
}

/** One row per step of a flow — see `workflows.ts` `/walkthrough`. */
interface WalkthroughStep {
  stepOrder: number;
  filePath: string;
  symbolName: string | null;
  lineStart: number | null;
  stepKind: string;
  explanation: string;
  narrated: boolean;
  syntheticReturn: boolean;
}

interface WalkthroughResponse {
  workflow: { id: string; title: string; trigger_type: string; purpose: string | null };
  steps: Array<Record<string, unknown>>;
}

/**
 * Normalizes a walkthrough row and picks the best sentence available for it.
 *
 * The narration pass writes `explanation` for a small minority of steps; the
 * rest carry a formatter's structural sentence. Both are real, and which one a
 * reader is looking at is marked rather than blurred.
 */
function normalizeStep(raw: Record<string, unknown>, index: number): WalkthroughStep {
  const str = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const num = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === "number") return v;
    }
    return null;
  };
  const filePath = str("filePath", "file_path") ?? "";
  const narrated = str("explanation");
  const deterministic = str("deterministicDescription", "deterministic_description");
  const explanation =
    narrated ??
    (deterministic ? (filePath ? deterministic.replace(` (${filePath})`, "") : deterministic) : null) ??
    (filePath ? `Runs in ${filePath}. No description was recorded for this step.` : "No description was recorded for this step.");
  return {
    stepOrder: num("stepOrder", "step_order") ?? index + 1,
    filePath,
    symbolName: str("symbolName", "symbol_name"),
    lineStart: num("lineStart", "line_start"),
    stepKind: str("stepKind", "step_kind") ?? "transform",
    explanation,
    narrated: narrated !== null,
    syntheticReturn: raw.syntheticReturn === true,
  };
}

/** "backend/src/api/routes/ask.ts" → "ask.ts" */
function stepTitle(step: WalkthroughStep): string {
  const base = step.filePath.split("/").pop() ?? step.filePath;
  const name = step.symbolName ?? base;
  return step.syntheticReturn ? `Response from ${name}` : name;
}

/** Symbol keys look like "path/file.ts#Symbol"; graphs focus the file part. */
function fileOf(stableKey: string): string {
  return stableKey.split("#")[0] ?? stableKey;
}

const TIERS: Array<{ key: "core" | "supporting"; label: string; note?: string }> = [
  { key: "core", label: "Delivered by core user flows" },
  { key: "supporting", label: "Delivered by supporting flows", note: "background jobs, admin and developer paths" },
];

/** Characters of a rail row's capability/flow name that survive the 280px rail. */
const RAIL_TITLE_CHARS = 34;

/**
 * Characters of a flow node's title that survive.
 *
 * The node is 224px over two lines. Straight truncation put FIVE nodes on the
 * capability drill reading the identical string "GET /api/projects/:id/onboar…"
 * — the same capability's flows share a route prefix by definition, so the
 * prefix is precisely the part worth throwing away.
 */
const FLOW_NODE_TITLE_CHARS = 52;

/**
 * One treatment for one fact.
 *
 * Confidence was a `HIGH CONFIDENCE` badge in the drill header and the words
 * "high confidence" in a sentence on the canvas node — two styles for the same
 * stored value, on two levels of the same tab.
 */
function ConfidenceBadge({ confidence, className }: { confidence: string; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("text-[0.625rem] uppercase", className)}>
      {confidence} confidence
    </Badge>
  );
}

// ── Nodes ────────────────────────────────────────────────────────────────────

/** Handle ids match `HandleId` in serpentine.ts. */
const HANDLE_SIDES = [
  { id: "t", position: Position.Top },
  { id: "r", position: Position.Right },
  { id: "b", position: Position.Bottom },
  { id: "l", position: Position.Left },
] as const;

/**
 * All four sides, as source and target.
 *
 * A snaked chain enters and leaves sideways within a row and vertically at the
 * turn, so a fixed Left-target/Right-source pair cannot draw it. React Flow
 * keys handles by (node, type, id), so the same id on a source and a target is
 * fine; unused ones stay mounted but invisible because React Flow has to
 * measure a handle to route to it.
 */
function Ports() {
  return (
    <>
      {HANDLE_SIDES.map(({ id, position }) => (
        <Handle key={`t-${id}`} id={id} type="target" position={position} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-muted-foreground/50 !opacity-0" />
      ))}
      {HANDLE_SIDES.map(({ id, position }) => (
        <Handle key={`s-${id}`} id={id} type="source" position={position} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-muted-foreground/50 !opacity-0" />
      ))}
    </>
  );
}

interface CapNodeData {
  name: string;
  tier: string | null;
  flows: number;
  tables: number;
  services: number;
  confidence: string;
  selected: boolean;
}

/**
 * A capability, as a card in a rail of them.
 *
 * No tooltip: the name is on the node, the numbers are on the node, and the
 * hover layer that used to repeat the name sat over the click target. What is
 * not on the node is one level down, which is what the click is for.
 */
function CapabilityNode({ data }: NodeProps<CapNodeData>) {
  const color = data.tier === "core" ? "var(--node-api)" : "var(--node-shared)";
  return (
    <div
      className={cn(
        "w-60 rounded-lg border bg-card px-3 py-2 shadow-sm transition-all",
        data.selected ? "ring-2 ring-ring" : "hover:shadow-md",
      )}
      // Neutral unless selected. Every node used to carry its tier colour on
      // the border, and on a project whose capabilities are all one tier that
      // rendered the whole canvas in the bright blue the app uses for "this
      // one is selected" — a hierarchy signal spent on no hierarchy. The tier
      // still reads off the icon, which is where a colour means a category.
      style={{ borderColor: data.selected ? color : "var(--border)" }}
    >
      <Ports />
      <div className="flex items-start gap-2">
        <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color }} />
        <span className="min-w-0 flex-1 line-clamp-2 text-[0.8125rem] font-semibold leading-tight text-foreground">
          {data.name}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <ConfidenceBadge confidence={data.confidence} />
        <span className="min-w-0 truncate text-[0.65625rem] text-muted-foreground">
          {data.flows} flow{data.flows === 1 ? "" : "s"}
          {data.tables > 0 && ` · ${data.tables} table${data.tables === 1 ? "" : "s"}`}
          {data.services > 0 && ` · ${data.services} service${data.services === 1 ? "" : "s"}`}
        </span>
      </div>
    </div>
  );
}

interface FlowNodeData {
  title: string;
  trigger: string | null;
  steps: number;
  tier: string | null;
  selected: boolean;
}

function FlowNode({ data }: NodeProps<FlowNodeData>) {
  const color = data.tier === "core" ? "var(--node-api)" : "var(--node-worker)";
  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card px-3 py-2 shadow-sm transition-all",
        data.selected ? "ring-2 ring-ring" : "hover:shadow-md",
      )}
      style={{ borderColor: data.selected ? color : "var(--border)" }}
    >
      <Ports />
      <div className="flex items-start gap-2">
        <Zap className="mt-0.5 h-3 w-3 shrink-0" style={{ color }} />
        {/* Two lines, and the ROUTE TAIL kept. Sibling flows of one capability
            share a route prefix by construction, so clipping from the right
            produced five nodes reading the same string. */}
        <span className="min-w-0 flex-1 line-clamp-2 break-all text-[0.75rem] font-medium leading-tight text-foreground">
          {middleTruncate(data.title, FLOW_NODE_TITLE_CHARS)}
        </span>
      </div>
      <p className="mt-1 text-[0.65625rem] text-muted-foreground">
        {triggerLabel(data.trigger)} · {data.steps} step{data.steps === 1 ? "" : "s"}
      </p>
    </div>
  );
}

interface ResourceNodeData {
  label: string;
  kind: "table" | "service";
  selected: boolean;
}

function ResourceNode({ data }: NodeProps<ResourceNodeData>) {
  const color = data.kind === "table" ? "var(--node-data)" : "var(--node-config)";
  const Icon = data.kind === "table" ? Database : Plug;
  return (
    <div
      className={cn(
        "rounded-full border bg-card px-3 py-1.5 shadow-sm transition-all",
        data.selected ? "ring-2 ring-ring" : "hover:shadow-md",
      )}
      style={{ borderColor: color }}
    >
      <Ports />
      <span className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 shrink-0" style={{ color }} />
        <span className="max-w-[11rem] truncate font-mono text-[0.6875rem] text-foreground">
          {data.label}
        </span>
      </span>
    </div>
  );
}

interface StepNodeData {
  label: string;
  explanation: string;
  narrated: boolean;
  stepKind: string;
  order: number | null;
  selected: boolean;
}

const STEP_KIND_PALETTE: Record<string, string> = {
  trigger: "api", auth_guard: "config", validation: "config",
  data_read: "data", data_write: "data", async_work: "worker",
  side_effect: "worker", transform: "shared", response: "ui",
};

/** Matches the Workflows tab node: same data, same no-tooltip rule. */
function StepNode({ data }: NodeProps<StepNodeData>) {
  const color = `var(--node-${STEP_KIND_PALETTE[data.stepKind] ?? "shared"})`;
  return (
    <div
      className={cn(
        "w-64 rounded-lg border bg-card px-3 py-2 shadow-sm transition-all",
        data.selected ? "ring-2 ring-ring" : "hover:shadow-md",
      )}
      style={{ borderColor: data.selected ? color : "var(--border)" }}
    >
      <Ports />
      <div className="flex items-center gap-2">
        {data.order !== null && (
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[0.59375rem] font-bold"
            style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}
          >
            {data.order}
          </span>
        )}
        <span className="min-w-0 flex-1 line-clamp-2 break-all font-mono text-[0.71875rem] font-medium leading-tight text-foreground">
          {data.label}
        </span>
        <span
          className="shrink-0 rounded px-1 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide"
          style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
        >
          {data.stepKind.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-1 line-clamp-3 text-[0.625rem] leading-snug text-muted-foreground">
        {data.narrated && <Sparkles className="mr-1 inline h-2.5 w-2.5 align-[-1px] text-primary" />}
        {data.explanation}
      </p>
    </div>
  );
}

const nodeTypes = { capability: CapabilityNode, flow: FlowNode, resource: ResourceNode, step: StepNode };

// ── Page ─────────────────────────────────────────────────────────────────────

/**
 * Capabilities as a drillable graph: capability → the flows that deliver it
 * and the tables/services they touch → the code of one flow.
 *
 * It used to be a grid of cards whose every affordance left the tab — the
 * flows linked to Workflows, the modules to Architecture, the files to
 * Dependencies — so the one tab that claims to say what the product does was
 * the only one you could not stay on. The ladder runs on the shared drill
 * engine (`useDrillStack` / `useGraphDrill` / `GraphCanvas`), so the zoom
 * transition, Back, breadcrumbs and reload behave exactly as they do on
 * Dependencies.
 *
 * Frame kinds are the shared `LevelKind` union: a capability level rides on
 * `cluster` (it is a grouping) and a flow level on `workflow`. Inventing new
 * kinds would mean editing the shared drill lib for a label only this page
 * reads.
 */
export function CapabilitiesPage() {
  const { id } = useParams<{ id: string }>();
  const packagesCtx = useOptionalPackages();
  const selectedPackageId = packagesCtx?.selectedPackageId ?? null;
  const packageQuery = packagesCtx?.packageQuery ?? "";

  const [data, setData] = useState<CapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flowGraph, setFlowGraph] = useState<WalkthroughResponse | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const stack = useDrillStack();
  const capabilityFrame = stack.frames.find((f) => f.kind === "cluster") ?? null;
  const flowFrame = stack.frames.find((f) => f.kind === "workflow") ?? null;

  // One in-flight fetch of the capability list, shared by the initial load and
  // by whatever drill level a cold deep link lands on.
  const listRef = useRef<Promise<CapabilitiesResponse> | null>(null);
  const loadList = useCallback(
    (force = false): Promise<CapabilitiesResponse> => {
      if (!force && listRef.current) return listRef.current;
      const promise = apiFetch(`/projects/${id}/capabilities${packageQuery}`).then((raw) => {
        const res = raw as CapabilitiesResponse;
        // Snapshots analysed before a field existed simply lack it; normalize
        // once here so every renderer below can assume the shape.
        const normalized: CapabilitiesResponse = {
          ...res,
          capabilities: (res.capabilities ?? []).map((c) => ({
            ...c,
            derivation: c.derivation ?? [],
            binding: {
              key: c.binding?.key ?? null,
              keySource: c.binding?.keySource ?? null,
              entrypoints: c.binding?.entrypoints ?? [],
              schemas: c.binding?.schemas ?? [],
              services: c.binding?.services ?? [],
              surfaces: c.binding?.surfaces ?? [],
            },
            whereToStart: c.whereToStart ?? [],
            workflows: (c.workflows ?? []).map((w) => ({ ...w, tutorials: w.tutorials ?? [], stepCount: w.stepCount ?? 0 })),
            nodes: c.nodes ?? [],
            modules: c.modules ?? [],
          })),
        };
        setData(normalized);
        return normalized;
      });
      listRef.current = promise;
      return promise;
    },
    [id, packageQuery],
  );

  // Which level the state currently holds. The drill fetches a level BEFORE
  // it moves the stack, so this is stamped inside `loadLevel` — stamping it
  // in the effect instead would make every completed drill look unloaded and
  // fire a second, redundant request for the level just fetched.
  const loadedKeyRef = useRef<string | null>(null);
  const levelKeyOf = (frame: { kind: string; id: string } | null) =>
    `${id ?? ""}::${selectedPackageId ?? ""}::${frame?.kind ?? ""}:${frame?.id ?? ""}`;

  /** Fetches whatever a level needs; resolves only once it can be rendered. */
  const loadLevel = useCallback(
    async (frame: { kind: string; id: string } | null): Promise<void> => {
      if (!id) return;
      setError("");
      setSelectedNodeId(null);
      try {
        await loadList();
        // The walkthrough route, not the folded workflow graph: it serves one
        // row per step, which is the count the flow node above it advertises.
        if (frame?.kind === "workflow") {
          setFlowGraph((await apiFetch(`/projects/${id}/workflows/${encodeURIComponent(frame.id)}/walkthrough`)) as WalkthroughResponse);
        } else setFlowGraph(null);
        loadedKeyRef.current = levelKeyOf(frame);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load capabilities");
        throw err;
      }
    },
    [id, selectedPackageId, loadList],
  );

  const drill = useGraphDrill({ stack, loadLevel });

  /** Invalidates the cached list and reloads whatever level is on screen. */
  const retry = useCallback(() => {
    listRef.current = null;
    loadedKeyRef.current = null;
    setLoading(true);
    void loadLevel(stack.current).catch(() => {}).finally(() => setLoading(false));
  }, [loadLevel, stack.current?.kind, stack.current?.id]);

  // The level comes from the URL, so a shared link renders it on first paint.
  // A project or package switch invalidates a drill path built from another
  // snapshot's ids rather than carrying a stale one across.
  const prevKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${id ?? ""}::${selectedPackageId ?? ""}`;
    const switched = prevKeyRef.current !== null && prevKeyRef.current !== key;
    prevKeyRef.current = key;
    if (switched) {
      listRef.current = null;
      if (stack.depth > 0) {
        stack.reset();
        return;
      }
    }
    if (loadedKeyRef.current === levelKeyOf(stack.current)) return;
    setLoading(true);
    void loadLevel(stack.current)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, selectedPackageId, stack.depth, stack.current?.id]);

  const capabilities = data?.capabilities ?? [];
  const activeCapability = capabilityFrame
    ? capabilities.find((c) => c.stableKey === capabilityFrame.id) ?? null
    : null;
  const activeFlow = activeCapability && flowFrame
    ? activeCapability.workflows.find((w) => w.id === flowFrame.id) ?? null
    : null;

  // ── Graph for the current level ────────────────────────────────────────────

  const level = flowFrame ? "code" : capabilityFrame ? "flows" : "capabilities";

  const steps = useMemo(
    () => (flowGraph?.steps ?? []).map(normalizeStep),
    [flowGraph],
  );

  /**
   * What each level draws.
   *
   * The first two levels are SETS, and they are laid out as rows of nodes for
   * that reason. The capabilities level used to draw an edge between any two
   * capabilities sharing a table, and the flows level drew every flow to every
   * resource — a complete bipartite graph, because which flow reaches which
   * resource is not stored per flow. Both were read as dependency structures
   * that the evidence never claimed. The relationship is still shown, but as a
   * band heading and a count, which is what the data actually supports.
   *
   * Only the deepest level is genuinely a graph: a flow's steps are ordered and
   * connected, so that one keeps its arrows — and its chain snakes, exactly as
   * the Workflows tab does.
   */
  const graph = useMemo((): { nodes: GraphNode[]; edges: GraphEdge[] } => {
    if (level === "capabilities") {
      return {
        nodes: capabilities.map((c) => ({
          id: `cap:${c.stableKey}`,
          label: c.name,
          kind: c.tier ?? "supporting",
          metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 },
        })),
        edges: [],
      };
    }

    if (level === "flows" && activeCapability) {
      const nodes: GraphNode[] = activeCapability.workflows.map((w) => ({
        id: w.id,
        label: w.title,
        kind: w.tier ?? "supporting",
        metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 },
      }));
      // Every table and service, not a slice of them: the node one level up
      // prints `schemas.length`, so drawing eight of twenty here is the
      // headline-bigger-than-the-detail bug in miniature. Rows hold them.
      for (const s of activeCapability.binding.schemas) {
        nodes.push({ id: `res:table:${s}`, label: s, kind: "table", metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } });
      }
      for (const s of activeCapability.binding.services) {
        nodes.push({ id: `res:service:${s}`, label: s, kind: "service", metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } });
      }
      for (const s of activeCapability.binding.surfaces) {
        nodes.push({ id: `res:surface:${s}`, label: s, kind: "service", metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } });
      }
      return { nodes, edges: [] };
    }

    if (level === "code" && steps.length > 0) {
      const chain = buildStepChain(steps, (s) => ({ label: stepTitle(s), kind: s.stepKind }));
      return { nodes: chain.nodes, edges: chain.edges };
    }
    return { nodes: [], edges: [] };
  }, [level, capabilities, activeCapability, steps]);

  const stepByNodeId = useMemo(() => {
    const m = new Map<string, WalkthroughStep>();
    for (const s of steps) m.set(`step:${s.stepOrder}`, s);
    return m;
  }, [steps]);

  const layout = useMemo(() => {
    if (level === "code") {
      if (graph.nodes.length === 0) return { nodes: [], routing: null as SerpentineLayout["edgeRouting"] | null };
      // Same gate as the Workflows tab, trigger type included — a journey
      // opened from a capability must snake for the same reason it does there.
      if (!shouldSerpentine(graph.nodes, graph.edges, { triggerType: flowGraph?.workflow.trigger_type })) {
        return {
          nodes: layoutGraph(graph.nodes, graph.edges, { direction: "TB", nodeWidth: 256, nodeHeight: 84, ranksep: 44, nodesep: 28 }),
          routing: null,
        };
      }
      const out = layoutSerpentine(graph.nodes, graph.edges, { nodeWidth: 256, nodeHeight: 84, rowGap: 80 });
      return { nodes: out.nodes, routing: out.edgeRouting };
    }
    // Rows. Flows first, then the tables and services they reach — two bands,
    // so the level reads as "these, over these" without an edge saying it.
    const bands =
      level === "flows"
        ? [
            { nodes: graph.nodes.filter((n) => !n.id.startsWith("res:")) },
            { nodes: graph.nodes.filter((n) => n.id.startsWith("res:")) },
          ]
        : [{ nodes: graph.nodes }];
    return {
      nodes: layoutRows(bands, {
        nodeWidth: level === "capabilities" ? 248 : 232,
        // Taller than the old 78/70: titles now wrap to a second line rather
        // than clipping, and a row pitch measured against a one-line node
        // would let the tall ones touch the row below.
        nodeHeight: level === "capabilities" ? 96 : 88,
      }),
      routing: null as SerpentineLayout["edgeRouting"] | null,
    };
  }, [graph, level, flowGraph?.workflow.trigger_type]);

  const positioned = layout.nodes;

  const flowNodes: Node[] = useMemo(
    () =>
      positioned.map((p) => {
        if (p.id.startsWith("cap:")) {
          const cap = capabilities.find((c) => `cap:${c.stableKey}` === p.id)!;
          return {
            id: p.id, type: "capability", position: { x: p.x, y: p.y },
            data: {
              name: cap.name, tier: cap.tier, flows: cap.workflows.length,
              tables: cap.binding.schemas.length, services: cap.binding.services.length,
              confidence: cap.confidence, selected: p.id === selectedNodeId,
            } satisfies CapNodeData,
          };
        }
        if (p.id.startsWith("res:")) {
          return {
            id: p.id, type: "resource", position: { x: p.x, y: p.y },
            data: { label: p.label, kind: p.kind === "table" ? "table" : "service", selected: p.id === selectedNodeId } satisfies ResourceNodeData,
          };
        }
        if (level === "code") {
          const step = stepByNodeId.get(p.id);
          return {
            id: p.id, type: "step", position: { x: p.x, y: p.y },
            data: {
              label: p.label, explanation: step?.explanation ?? "", narrated: step?.narrated ?? false,
              stepKind: step?.stepKind ?? p.kind,
              order: step?.stepOrder ?? null, selected: p.id === selectedNodeId,
            } satisfies StepNodeData,
          };
        }
        const wf = activeCapability?.workflows.find((w) => w.id === p.id);
        return {
          id: p.id, type: "flow", position: { x: p.x, y: p.y },
          data: {
            title: p.label, trigger: wf?.triggerType ?? null, steps: wf?.stepCount ?? 0,
            tier: wf?.tier ?? null, selected: p.id === selectedNodeId,
          } satisfies FlowNodeData,
        };
      }),
    [positioned, capabilities, activeCapability, stepByNodeId, level, selectedNodeId],
  );

  /** Only the step chain has edges now; the set levels draw none. */
  const rfEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const route = layout.routing?.get(e.id);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          ...(route ? { sourceHandle: route.sourceHandle, targetHandle: route.targetHandle } : {}),
          type: "smoothstep",
          ...(route ? { pathOptions: { borderRadius: 16 } } : {}),
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--primary)" },
          style: { stroke: "var(--primary)", strokeWidth: 1.4, opacity: 0.6 },
        };
      }),
    [graph.edges, layout.routing],
  );

  const drillInto = (nodeId: string): boolean => {
    if (nodeId.startsWith("res:")) return false;
    if (nodeId.startsWith("cap:")) {
      const cap = capabilities.find((c) => `cap:${c.stableKey}` === nodeId);
      if (!cap) return false;
      drill.drillInto({ kind: "cluster", id: cap.stableKey, label: cap.name }, nodeId);
      return true;
    }
    if (level === "flows") {
      const wf = activeCapability?.workflows.find((w) => w.id === nodeId);
      if (!wf) return false;
      drill.drillInto({ kind: "workflow", id: wf.id, label: wf.title }, nodeId);
      return true;
    }
    return false;
  };

  const selectedStep = level === "code" && selectedNodeId ? stepByNodeId.get(selectedNodeId) ?? null : null;
  const selectedResource = selectedNodeId?.startsWith("res:")
    ? { kind: selectedNodeId.split(":")[1] ?? "table", label: selectedNodeId.split(":").slice(2).join(":") }
    : null;

  const derivation = data?.derivation ?? null;
  const bindingRule = data?.bindingRule ?? null;
  const isEmpty = !loading && !error && capabilities.length === 0;

  /**
   * Why the header's bound-flow count is smaller than the flows you can reach
   * by opening every capability.
   *
   * `boundFlows` counts DISTINCT flows; the drill-downs list one row per
   * (capability, flow) pair. On OnboardBuddy that is 71 against 84. Both
   * numbers are correct and the gap is the interesting part — a flow that
   * delivers two capabilities is a real fact about the system — so it is
   * stated rather than papered over by making one of them match the other.
   */
  const flowListings = useMemo(
    () => capabilities.reduce((n, c) => n + c.workflows.length, 0),
    [capabilities],
  );
  const sharedFlows = derivation ? flowListings - derivation.boundFlows : 0;

  return (
    <div
      style={{
        // Page chrome only. What the capability header costs is no longer
        // guessed here — `graph-shell` below gives the canvas whatever the
        // header leaves, whatever height that turns out to be.
        "--graph-chrome": fullscreen ? "28px" : "230px",
      } as React.CSSProperties}
    >
      <PageHeader
        title={
          stack.depth > 0 ? (
            /* No tooltips on the crumbs. Each one said "Back to <the word you
               are looking at>", which is the definition of a tooltip that
               shows what the user can already see; the Back button beside them
               carries the one explanation worth having. */
            <span className="flex flex-wrap items-baseline gap-1.5">
              <button
                type="button"
                className="rounded-sm transition-colors hover:text-primary disabled:opacity-50"
                onClick={() => drill.jumpTo(-1)}
                disabled={drill.busy}
              >
                Capabilities
              </button>
              {stack.frames.map((frame, i) => {
                const isLast = i === stack.depth - 1;
                return (
                  <span key={`${frame.kind}:${frame.id}`} className="flex items-baseline gap-1.5 text-sm font-normal text-muted-foreground">
                    <span>/</span>
                    {isLast ? (
                      <span className="text-foreground">{frame.label}</span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-sm transition-colors hover:text-primary disabled:opacity-50"
                        onClick={() => drill.jumpTo(i)}
                        disabled={drill.busy}
                      >
                        {frame.label}
                      </button>
                    )}
                  </span>
                );
              })}
            </span>
          ) : (
            "Capabilities"
          )
        }
        subtitle={
          level === "capabilities"
            ? "What this product does, derived from traced flows — click one to see the flows and data behind it."
            : level === "flows"
              ? "The flows that deliver this capability and the tables and services they reach. Click a flow to open its code."
              : "The traced path of one flow, step by step."
        }
        actions={
          <>
            {stack.depth > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="xs" onClick={drill.drillUp} disabled={drill.busy}>
                    <CornerLeftUp className="mr-1 h-3 w-3" />
                    Back
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Back to the level you came from</TooltipContent>
              </Tooltip>
            )}
            {capabilities.length > 0 && (
              <>
                <Badge variant="outline" className="text-[0.6875rem] tabular-nums">
                  {capabilities.length} capabilit{capabilities.length === 1 ? "y" : "ies"}
                  {derivation && ` · ${derivation.boundFlows} of ${derivation.tracedFlows} traced flows bound`}
                </Badge>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setFullscreen((v) => !v)}
                      aria-pressed={fullscreen}
                      aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                    >
                      {fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </>
        }
      />

      {loading && (
        <Skeleton className="graph-canvas" role="status" aria-label="Loading capabilities" />
      )}

      {!loading && error && (
        <EmptyState
          icon={<SearchX className="h-4 w-4 shrink-0 text-warning" />}
          heading={error}
          actions={
            <Button variant="outline" size="xs" onClick={retry}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Retry
            </Button>
          }
        />
      )}

      {isEmpty && <EmptyFinding derivation={derivation} bindingRule={bindingRule} onRetry={retry} />}

      {!loading && !error && capabilities.length > 0 && (
        <div className={cn("grid gap-3 lg:grid-cols-[280px_1fr]", fullscreen && "fixed inset-0 z-50 bg-background p-3")}>
          {/* Ranked rail — the same list the graph draws, usable without a mouse. */}
          <div className="graph-canvas overflow-y-auto !bg-card p-2">
            <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1">
              <p className="section-label">Capabilities ({capabilities.length})</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex cursor-help text-muted-foreground/60 hover:text-muted-foreground">
                    <Info className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm text-left">
                  {data?.ordering ? (
                    <div className="space-y-1 text-[0.6875rem]">
                      <p className="font-medium">{data.ordering.summary}</p>
                      <ol className="list-inside list-decimal space-y-0.5 opacity-80">
                        {data.ordering.steps.map((s) => <li key={s}>{s}</li>)}
                      </ol>
                    </div>
                  ) : (
                    <span className="text-[0.6875rem]">This response did not say how the list was ordered.</span>
                  )}
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="space-y-0.5">
              {TIERS.map(({ key, label, note }) => {
                const inTier = capabilities.filter((c) => (c.tier ?? "supporting") === key);
                if (inTier.length === 0) return null;
                return (
                  <div key={key} className="pt-1.5 first:pt-0">
                    <p className="px-2 pb-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {label} ({inTier.length})
                    </p>
                    {note && <p className="px-2 pb-1 text-[0.625rem] leading-tight text-muted-foreground/50">{note}</p>}
                    {inTier.map((cap) => (
                      <button
                        key={cap.id}
                        onClick={() => {
                          if (drill.busy) return;
                          if (capabilityFrame?.id === cap.stableKey) return;
                          if (stack.depth > 0) stack.jumpTo(-1);
                          drill.drillInto({ kind: "cluster", id: cap.stableKey, label: cap.name }, `cap:${cap.stableKey}`);
                        }}
                        aria-pressed={capabilityFrame?.id === cap.stableKey}
                        disabled={drill.busy}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-60",
                          capabilityFrame?.id === cap.stableKey
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        {cap.realizesUserAction ? (
                          <Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
                        ) : (
                          <Circle className="mt-0.5 h-3 w-3 shrink-0 opacity-40" />
                        )}
                        <span className="min-w-0">
                          {/* The rail row is the tab stop; this tooltip is
                              hover-only overflow relief for a truncated name. */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block truncate text-[0.78125rem] font-medium">
                                {middleTruncate(cap.name, RAIL_TITLE_CHARS)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs text-left">
                              {cap.name}
                            </TooltipContent>
                          </Tooltip>
                          <span className="block text-[0.6875rem] opacity-60">
                            {cap.workflows.length} flow{cap.workflows.length === 1 ? "" : "s"}
                            {cap.binding.schemas.length > 0 && ` · ${cap.binding.schemas.length} table${cap.binding.schemas.length === 1 ? "" : "s"}`}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            {sharedFlows > 0 && (
              <p className="mt-2 border-t border-border px-2 pt-2 text-[0.625rem] leading-relaxed text-muted-foreground/70">
                Opening every capability lists {flowListings} flows, against {derivation!.boundFlows} bound in the header:{" "}
                {sharedFlows} listing{sharedFlows === 1 ? "" : "s"} {sharedFlows === 1 ? "is" : "are"} a flow that delivers
                more than one capability, counted once above and once per capability below.
              </p>
            )}
            {derivation && derivation.unbound.length > 0 && (
              <div className="mt-3 border-t border-border px-2 pt-2">
                <p className="section-label mb-1">Not bound ({derivation.unbound.length})</p>
                <p className="text-[0.625rem] leading-relaxed text-muted-foreground/70">
                  Traced flows that reach no schema table or named service, so no capability was derived from them.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {derivation.unbound.slice(0, 6).map((u) => (
                    <li key={u.title}>
                      {/* Focusable: which binding leg a flow missed exists
                          nowhere else on the page, and the list is capped at 6. */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            tabIndex={0}
                            className="block cursor-help truncate text-[0.625rem] text-muted-foreground"
                          >
                            {u.title}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs text-left">
                          {`${u.title} — ${u.missing}`}
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  ))}
                  {derivation.unbound.length > 6 && (
                    <li className="text-[0.625rem] text-muted-foreground/60">+{derivation.unbound.length - 6} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Detail + graph. `graph-shell` owns the viewport slice and the
              canvas takes what the capability header leaves, so the header's
              real height stops being a magic number that has to be guessed
              (it was 420px) and the graph stays centred in what is visible. */}
          <div className="graph-shell">
            {activeCapability && <CapabilityHeader cap={activeCapability} projectId={id!} />}
            {/* `min-h-80` is the floor: a capability with a long entry-point
                list must not squeeze the canvas out of existence — past that
                the column overflows and the page scrolls, which is right. */}
            <div className={cn("min-h-80 flex-1", (selectedStep || selectedResource) && "grid gap-3 xl:grid-cols-[1fr_300px]")}>
              <div className="graph-canvas relative !h-full">
                {drill.error && (
                  <div className="absolute left-2 top-2 z-10 rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-[0.6875rem] text-foreground">
                    {drill.error}
                  </div>
                )}
                {/* Fullscreen's own exit: the header control that toggles it is
                    outside this overlay, so once it covered the viewport there
                    was nothing visible to click. */}
                {fullscreen && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setFullscreen(false)}
                    className="absolute right-2 top-2 z-10"
                  >
                    <Minimize2 className="mr-1 h-3 w-3" />
                    Exit fullscreen (Esc)
                  </Button>
                )}
                <GraphCanvas
                  nodes={flowNodes}
                  edges={rfEdges}
                  nodeTypes={nodeTypes}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  onDrillInto={drillInto}
                  drill={drill}
                  fitPadding={0.18}
                  fitMinZoom={0.5}
                  minZoom={0.15}
                  // Eight edge-less boxes that all fit on screen do not need a
                  // shrunken copy of themselves in the corner.
                  showMiniMap={flowNodes.length >= MINIMAP_MIN_NODES}
                  refitSignal={`${level}:${capabilityFrame?.id ?? ""}:${flowFrame?.id ?? ""}:${fullscreen}`}
                  restoreViewport={stack.savedViewport(stack.depth)}
                />
              </div>

              {selectedResource && (
                <aside className="graph-canvas !h-full overflow-y-auto !bg-card p-4">
                  <p className="section-label mb-2">{selectedResource.kind === "table" ? "Schema table" : "External service"}</p>
                  <p className="font-mono text-[0.8125rem] font-medium text-foreground">{selectedResource.label}</p>
                  <p className="mt-2 text-[0.75rem] leading-relaxed text-muted-foreground">
                    {selectedResource.kind === "table"
                      ? "This capability exists partly because its flows reach this table. It is one of the three legs of the binding rule."
                      : "A named external service these flows call. Unrecognised packages are deliberately not counted — only named services bind a capability."}
                  </p>
                  <p className="mt-3 text-[0.71875rem] text-muted-foreground">
                    Reached by {activeCapability?.workflows.length ?? 0} flow
                    {(activeCapability?.workflows.length ?? 0) === 1 ? "" : "s"} in this capability.
                  </p>
                </aside>
              )}

              {selectedStep && (
                <aside className="graph-canvas !h-full overflow-y-auto !bg-card p-4">
                  <p className="section-label mb-2">Step {selectedStep.stepOrder} of {steps.length}</p>
                  <p className="font-mono text-[0.8125rem] font-medium text-foreground">
                    {selectedStep.symbolName ?? selectedStep.filePath}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-[0.6875rem] text-muted-foreground">
                    {selectedStep.filePath}
                    {selectedStep.lineStart ? ` · L${selectedStep.lineStart}` : ""}
                  </p>
                  <Badge variant="secondary" className="mt-2 text-[0.625rem] uppercase">
                    {selectedStep.stepKind.replace(/_/g, " ")}
                  </Badge>
                  <p className="mt-3 text-[0.8125rem] leading-relaxed text-foreground">{selectedStep.explanation}</p>
                  <p className="mt-1 flex items-center gap-1 text-[0.625rem] text-muted-foreground/80">
                    {selectedStep.narrated ? (
                      <>
                        <Sparkles className="h-2.5 w-2.5 text-primary" />
                        Written by the narration pass for this step
                      </>
                    ) : (
                      "Deterministic description — derived from the step's kind and target, not written about this code"
                    )}
                  </p>
                  <Link
                    to={`/projects/${id}/dependencies?focus=${encodeURIComponent(selectedStep.filePath)}`}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Open in Dependencies <ArrowRight className="h-3 w-3" />
                  </Link>
                </aside>
              )}
            </div>

            {activeFlow && level === "code" && (
              <div className="mt-2 flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-[0.71875rem]">
                <span className="text-muted-foreground">{activeFlow.purpose || "No purpose recorded for this flow."}</span>
                <Link
                  to={`/projects/${id}/workflows?workflow=${activeFlow.id}`}
                  className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  Open in Workflows <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Capability header ────────────────────────────────────────────────────────

/**
 * What this capability is, and — the part the previous card grid never showed
 * — how it came to exist. `derivation` is the trail from evidence to group:
 * without it "Project workspace" is just a name somebody wrote.
 */
function CapabilityHeader({ cap, projectId }: { cap: Capability; projectId: string }) {
  return (
    <div className="mb-2 shrink-0 rounded-md border border-border bg-card px-3 py-2 text-[0.75rem]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[0.875rem] font-semibold text-foreground">{cap.name}</h2>
        <ConfidenceBadge confidence={cap.confidence} />
        {cap.namedBy === "deterministic" && (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Focusable: "named from evidence" only means something once you
                  can read why, and that reason lives only in the tooltip. */}
              <Badge variant="outline" tabIndex={0} className="text-[0.625rem]">
                named from evidence
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-left">
              No usable name came back from the naming step, so this label is the domain noun the
              grouping was formed on.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {(cap.description || cap.summary) && (
        <p className="mt-1 leading-relaxed text-muted-foreground">{cap.description || cap.summary}</p>
      )}
      {cap.userValue && (
        <p className="mt-1 leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">When you'll touch it:</span> {cap.userValue}
        </p>
      )}

      {cap.derivation.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="section-label mb-1">Why this is a capability</p>
          <ul className="space-y-0.5 text-[0.71875rem] text-muted-foreground">
            {cap.derivation.map((d) => <li key={d}>· {d}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-2">
        {cap.binding.entrypoints.length > 0 && (
          <div className="min-w-[12rem]">
            {/* Headed with the real total, and scrolled rather than sliced.
                This list used to cut silently at four: a capability bound to
                ten entry points printed four and said nothing, which is the
                same headline-bigger-than-the-detail defect reported across the
                tabs, just without a headline to compare against. */}
            <p className="section-label mb-1">Entry points ({cap.binding.entrypoints.length})</p>
            <ul className="max-h-28 space-y-0.5 overflow-y-auto pr-1">
              {cap.binding.entrypoints.map((e) => (
                <li key={`${e.filePath}:${e.route ?? ""}`} className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                  <RouteIcon className="h-3 w-3 shrink-0 opacity-60" />
                  {/* Kept: the row truncates, and this is the only place the
                      full route or path is readable. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate font-mono">{e.route ?? e.filePath}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs break-all text-left">
                      {e.route ?? e.filePath}
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </div>
        )}
        {cap.whereToStart.length > 0 && (
          <div className="min-w-[14rem] flex-1">
            <p className="section-label mb-1">Start here</p>
            <ul className="space-y-1">
              {cap.whereToStart.map((s) => (
                <li key={s.stable_key} className="text-[0.6875rem]">
                  {/* The link is already the tab stop. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        to={`/projects/${projectId}/dependencies?focus=${encodeURIComponent(fileOf(s.stable_key))}`}
                        className="flex min-w-0 items-center gap-1.5 font-mono text-primary hover:underline"
                      >
                        <FileCode2 className="h-3 w-3 shrink-0" />
                        <span className="min-w-0 truncate">{s.stable_key}</span>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs break-all text-left">
                      {s.stable_key}
                    </TooltipContent>
                  </Tooltip>
                  {s.reason && <p className="text-muted-foreground">{s.reason}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {cap.modules.length > 0 && (
          <div className="min-w-[10rem]">
            <p className="section-label mb-1">Where the code lives</p>
            <div className="flex flex-wrap gap-1.5">
              {cap.modules.map((mod) => {
                const chip = (
                  <Link
                    to={`/projects/${projectId}/architecture?cluster=${encodeURIComponent(mod.stableKey ?? "")}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[0.6875rem] text-foreground transition-colors hover:border-primary/50"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: `var(--node-${CLUSTER_KIND_PALETTE[mod.kind ?? ""] ?? "shared"})` }}
                    />
                    {mod.label}
                  </Link>
                );
                if (!mod.reason) return <span key={mod.id}>{chip}</span>;
                return (
                  <Tooltip key={mod.id}>
                    <TooltipTrigger asChild>{chip}</TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-left">
                      {mod.reason}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

/**
 * Zero capabilities is an answer, not a failure.
 *
 * The old copy — "No capabilities extracted yet … they appear after a full
 * analysis" — told the reader to wait for something that had already
 * finished. This states the rule that was applied, the counts it was applied
 * to, and which flows fell short of which leg, so an empty tab is a finding
 * a reader can act on or argue with.
 */
function EmptyFinding({
  derivation,
  bindingRule,
  onRetry,
}: {
  derivation: Derivation | null;
  bindingRule: { summary: string; legs: string[] } | null;
  onRetry: () => void;
}) {
  const noAnalysis = !derivation || derivation.tracedFlows === 0;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex items-start gap-3">
        <SearchX className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {noAnalysis
              ? "No flows have been traced for this snapshot yet"
              : "No business capability could be derived from this repository"}
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
            {noAnalysis
              ? "Capabilities are derived from traced flows. Nothing has been traced here, so there is nothing to derive from — run an analysis, or retry if one has just finished."
              : "This is the honest answer, not a missing step. Capabilities are derived from evidence and then named; nothing is emitted to fill a quota."}
          </p>

          {derivation && derivation.tracedFlows > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[0.75rem] sm:grid-cols-4">
              {[
                ["Entry points", derivation.entrypoints],
                ["Flows traced", derivation.tracedFlows],
                ["Flows with a path to follow", derivation.consideredFlows],
                ["Schema tables found", derivation.schemaTables],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums text-foreground">{value as number}</dd>
                </div>
              ))}
            </dl>
          )}

          {bindingRule && (
            <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="section-label mb-1">The rule that was applied</p>
              <p className="text-[0.75rem] leading-relaxed text-muted-foreground">{bindingRule.summary}</p>
              <ul className="mt-1 space-y-0.5 text-[0.71875rem] text-muted-foreground">
                {bindingRule.legs.map((leg) => <li key={leg}>· {leg}</li>)}
              </ul>
            </div>
          )}

          {derivation && derivation.unbound.length > 0 && (
            <div className="mt-3">
              <p className="section-label mb-1">What fell short, and on which leg</p>
              <ul className="space-y-0.5 text-[0.71875rem] text-muted-foreground">
                {derivation.unbound.slice(0, 8).map((u) => (
                  <li key={u.title} className="truncate">
                    <span className="text-foreground">{u.title}</span> — {u.missing}
                  </li>
                ))}
              </ul>
              {derivation.unbound.length > 8 && (
                <p className="mt-0.5 text-[0.6875rem] text-muted-foreground/70">
                  +{derivation.unbound.length - 8} more traced flows in the same position.
                </p>
              )}
            </div>
          )}

          {derivation && !derivation.reportStored && derivation.tracedFlows > 0 && (
            <p className="mt-3 text-[0.6875rem] text-muted-foreground/70">
              This snapshot was analysed before the derivation report was recorded, so the counts above come from the
              same tables but the per-flow reasons are not available. Re-run the analysis to get them.
            </p>
          )}
        </div>
        <Button variant="outline" size="xs" onClick={onRetry}>
          <RefreshCw className="mr-1 h-3 w-3" />
          Retry
        </Button>
      </div>
    </div>
  );
}
