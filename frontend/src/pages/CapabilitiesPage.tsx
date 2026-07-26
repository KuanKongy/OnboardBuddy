import {
  ArrowRight,
  Boxes,
  Circle,
  CornerLeftUp,
  Database,
  FileCode2,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  Plug,
  RefreshCw,
  Route as RouteIcon,
  SearchX,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Handle, Position, type Edge, type Node, type NodeProps } from "reactflow";
import "reactflow/dist/style.css";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import { useDrillStack } from "@/hooks/useDrillStack";
import { useGraphDrill } from "@/hooks/useGraphDrill";
import { apiFetch } from "@/lib/api";
import { CLUSTER_KIND_PALETTE } from "@/lib/architectureData";
import { fetchWorkflowGraph, type WorkflowGraphResponse } from "@/lib/graphData";
import { layoutGraph } from "@/lib/graphLayout";
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

/** Symbol keys look like "path/file.ts#Symbol"; graphs focus the file part. */
function fileOf(stableKey: string): string {
  return stableKey.split("#")[0] ?? stableKey;
}

const TIERS: Array<{ key: "core" | "supporting"; label: string; note?: string }> = [
  { key: "core", label: "Delivered by core user flows" },
  { key: "supporting", label: "Delivered by supporting flows", note: "background jobs, admin and developer paths" },
];

// ── Nodes ────────────────────────────────────────────────────────────────────

function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-muted-foreground/50 !opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-muted-foreground/50 !opacity-0" />
      <Handle id="t" type="target" position={Position.Top} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-muted-foreground/50 !opacity-0" />
      <Handle id="b" type="source" position={Position.Bottom} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-muted-foreground/50 !opacity-0" />
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

function CapabilityNode({ data }: NodeProps<CapNodeData>) {
  const color = data.tier === "core" ? "var(--node-api)" : "var(--node-shared)";
  return (
    <div
      className={cn(
        "w-60 rounded-lg border bg-card px-3 py-2 shadow-sm transition-all",
        data.selected ? "ring-2 ring-ring" : "hover:shadow-md",
      )}
      style={{ borderColor: color }}
    >
      <Ports />
      <div className="flex items-center gap-2">
        <Boxes className="h-3.5 w-3.5 shrink-0" style={{ color }} />
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-foreground" title={data.name}>
          {data.name}
        </span>
      </div>
      <p className="mt-1 text-[0.65625rem] text-muted-foreground">
        {data.flows} flow{data.flows === 1 ? "" : "s"}
        {data.tables > 0 && ` · ${data.tables} table${data.tables === 1 ? "" : "s"}`}
        {data.services > 0 && ` · ${data.services} service${data.services === 1 ? "" : "s"}`}
        {` · ${data.confidence} confidence`}
      </p>
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
      <div className="flex items-center gap-2">
        <Zap className="h-3 w-3 shrink-0" style={{ color }} />
        <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium text-foreground" title={data.title}>
          {data.title}
        </span>
      </div>
      <p className="mt-0.5 text-[0.65625rem] text-muted-foreground">
        {data.trigger ?? "flow"} · {data.steps} step{data.steps === 1 ? "" : "s"}
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
        <span className="max-w-[11rem] truncate font-mono text-[0.6875rem] text-foreground" title={data.label}>
          {data.label}
        </span>
      </span>
    </div>
  );
}

interface StepNodeData {
  label: string;
  filePath: string;
  stepKind: string;
  order: number | null;
  selected: boolean;
}

const STEP_KIND_PALETTE: Record<string, string> = {
  trigger: "api", auth_guard: "config", validation: "config",
  data_read: "data", data_write: "data", async_work: "worker",
  side_effect: "worker", transform: "shared", response: "ui",
};

function StepNode({ data }: NodeProps<StepNodeData>) {
  const color = `var(--node-${STEP_KIND_PALETTE[data.stepKind] ?? "shared"})`;
  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card px-3 py-2 shadow-sm transition-all",
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
        <span className="min-w-0 flex-1 truncate font-mono text-[0.71875rem] font-medium text-foreground" title={data.label}>
          {data.label}
        </span>
        <span
          className="shrink-0 rounded px-1 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide"
          style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
        >
          {data.stepKind.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[0.625rem] text-muted-foreground" title={data.filePath}>
        {data.filePath}
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
  const [flowGraph, setFlowGraph] = useState<WorkflowGraphResponse | null>(null);
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
        if (frame?.kind === "workflow") setFlowGraph(await fetchWorkflowGraph(id, frame.id));
        else setFlowGraph(null);
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

  const graph = useMemo((): { nodes: GraphNode[]; edges: GraphEdge[] } => {
    if (level === "capabilities") {
      const nodes: GraphNode[] = capabilities.map((c) => ({
        id: `cap:${c.stableKey}`,
        label: c.name,
        kind: c.tier ?? "supporting",
        metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 },
      }));
      // Two capabilities are connected when they operate on the same table or
      // call the same service — the only relationship the evidence actually
      // supports between them, and the one that tells a reader where a change
      // will be felt twice.
      const edges: GraphEdge[] = [];
      for (let i = 0; i < capabilities.length && edges.length < 40; i += 1) {
        for (let j = i + 1; j < capabilities.length && edges.length < 40; j += 1) {
          const a = capabilities[i]!;
          const b = capabilities[j]!;
          const shared = [
            ...a.binding.schemas.filter((s) => b.binding.schemas.includes(s)),
            ...a.binding.services.filter((s) => b.binding.services.includes(s)),
          ];
          if (shared.length === 0) continue;
          edges.push({
            id: `share:${a.stableKey}:${b.stableKey}`,
            source: `cap:${a.stableKey}`,
            target: `cap:${b.stableKey}`,
            kind: shared.join(", "),
          });
        }
      }
      return { nodes, edges };
    }

    if (level === "flows" && activeCapability) {
      const nodes: GraphNode[] = activeCapability.workflows.map((w) => ({
        id: w.id,
        label: w.title,
        kind: w.tier ?? "supporting",
        metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 },
      }));
      const edges: GraphEdge[] = [];
      const resources = [
        ...activeCapability.binding.schemas.slice(0, 8).map((s) => ({ key: `res:table:${s}`, label: s, kind: "table" })),
        ...activeCapability.binding.services.slice(0, 6).map((s) => ({ key: `res:service:${s}`, label: s, kind: "service" })),
      ];
      for (const r of resources) {
        nodes.push({ id: r.key, label: r.label, kind: r.kind, metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } });
        // Which flow reaches which resource is not stored per flow on older
        // snapshots, so every flow is drawn to every resource of its own
        // capability — the honest granularity of what we know here.
        for (const w of activeCapability.workflows) {
          edges.push({ id: `${w.id}->${r.key}`, source: w.id, target: r.key, kind: "touches" });
        }
      }
      return { nodes, edges };
    }

    if (level === "code" && flowGraph) {
      return {
        nodes: flowGraph.graph.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          kind: n.kind,
          metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 },
        })),
        edges: flowGraph.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, kind: e.kind })),
      };
    }
    return { nodes: [], edges: [] };
  }, [level, capabilities, activeCapability, flowGraph]);

  const stepByNodeId = useMemo(() => {
    const m = new Map<string, { order: number; kind: string; filePath: string; symbolName: string | null; description: string; lineStart: number | null }>();
    for (const s of flowGraph?.steps ?? []) {
      if (!m.has(s.nodeId)) {
        m.set(s.nodeId, {
          order: s.stepOrder, kind: s.stepKind, filePath: s.filePath,
          symbolName: s.symbolName, description: s.description, lineStart: s.lineStart,
        });
      }
    }
    return m;
  }, [flowGraph]);

  const positioned = useMemo(
    () => layoutGraph(graph.nodes, graph.edges, {
      direction: level === "code" ? "TB" : "LR",
      nodeWidth: level === "capabilities" ? 248 : 232,
      nodeHeight: level === "code" ? 62 : 74,
      ranksep: level === "code" ? 48 : 110,
      nodesep: 28,
    }),
    [graph, level],
  );

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
              label: p.label, filePath: step?.filePath ?? p.id, stepKind: step?.kind ?? p.kind,
              order: step?.order ?? null, selected: p.id === selectedNodeId,
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

  const rfEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: level === "code" ? "smoothstep" : "default",
        animated: level === "code",
        label: level === "capabilities" ? e.kind : undefined,
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
        labelBgStyle: { fill: "var(--card)" },
        style: {
          stroke: "var(--primary)",
          strokeWidth: 1.4,
          opacity: level === "flows" ? 0.35 : 0.6,
          ...(level === "flows" ? { strokeDasharray: "4 3" } : {}),
        },
      })),
    [graph.edges, level],
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

  return (
    <div
      style={{
        // The capability header sits above the canvas and is worth roughly
        // 190px; without accounting for it the graph runs off the bottom of
        // the viewport on every drilled level.
        "--graph-chrome": fullscreen ? "90px" : activeCapability ? "420px" : "230px",
      } as React.CSSProperties}
    >
      <PageHeader
        title={
          stack.depth > 0 ? (
            <span className="flex flex-wrap items-baseline gap-1.5">
              <button
                className="transition-colors hover:text-primary disabled:opacity-50"
                onClick={() => drill.jumpTo(-1)}
                disabled={drill.busy}
                title="Back to all capabilities"
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
                        className="transition-colors hover:text-primary disabled:opacity-50"
                        onClick={() => drill.jumpTo(i)}
                        disabled={drill.busy}
                        title={`Back to ${frame.label}`}
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
              <Button variant="outline" size="xs" onClick={drill.drillUp} disabled={drill.busy} title="Back to the level you came from">
                <CornerLeftUp className="mr-1 h-3 w-3" />
                Back
              </Button>
            )}
            {capabilities.length > 0 && (
              <>
                <Badge variant="outline" className="text-[0.6875rem] tabular-nums">
                  {capabilities.length} capabilit{capabilities.length === 1 ? "y" : "ies"}
                  {derivation && ` · ${derivation.boundFlows}/${derivation.tracedFlows} flows bound`}
                </Badge>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setFullscreen((v) => !v)}
                  title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
                >
                  {fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                </Button>
              </>
            )}
          </>
        }
      />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
          <SearchX className="h-4 w-4 shrink-0 text-warning" />
          <p className="flex-1 text-sm text-foreground">{error}</p>
          <Button variant="outline" size="xs" onClick={retry}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {isEmpty && <EmptyFinding derivation={derivation} bindingRule={bindingRule} onRetry={retry} />}

      {!loading && !error && capabilities.length > 0 && (
        <div className={cn("grid gap-3 lg:grid-cols-[250px_1fr]", fullscreen && "fixed inset-0 z-50 bg-background p-3")}>
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
                          <span className="block truncate text-[0.78125rem] font-medium" title={cap.name}>{cap.name}</span>
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
            {derivation && derivation.unbound.length > 0 && (
              <div className="mt-3 border-t border-border px-2 pt-2">
                <p className="section-label mb-1">Not bound ({derivation.unbound.length})</p>
                <p className="text-[0.625rem] leading-relaxed text-muted-foreground/70">
                  Traced flows that reach no schema table or named service, so no capability was derived from them.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {derivation.unbound.slice(0, 6).map((u) => (
                    <li key={u.title} className="truncate text-[0.625rem] text-muted-foreground" title={`${u.title} — ${u.missing}`}>
                      {u.title}
                    </li>
                  ))}
                  {derivation.unbound.length > 6 && (
                    <li className="text-[0.625rem] text-muted-foreground/60">+{derivation.unbound.length - 6} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Detail + graph */}
          <div>
            {activeCapability && <CapabilityHeader cap={activeCapability} projectId={id!} />}
            <div className={cn(selectedStep || selectedResource ? "grid gap-3 xl:grid-cols-[1fr_300px]" : "")}>
              <div className="graph-canvas relative">
                {drill.error && (
                  <div className="absolute left-2 top-2 z-10 rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-[0.6875rem] text-foreground">
                    {drill.error}
                  </div>
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
                  refitSignal={`${level}:${capabilityFrame?.id ?? ""}:${flowFrame?.id ?? ""}:${fullscreen}`}
                  restoreViewport={stack.savedViewport(stack.depth)}
                />
              </div>

              {selectedResource && (
                <aside className="graph-canvas overflow-y-auto !bg-card p-4">
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
                <aside className="graph-canvas overflow-y-auto !bg-card p-4">
                  <p className="section-label mb-2">Step {selectedStep.order}</p>
                  <p className="font-mono text-[0.8125rem] font-medium text-foreground">
                    {selectedStep.symbolName ?? selectedStep.filePath}
                  </p>
                  <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                    {selectedStep.filePath}
                    {selectedStep.lineStart ? ` · L${selectedStep.lineStart}` : ""}
                  </p>
                  <Badge variant="secondary" className="mt-2 text-[0.625rem] uppercase">
                    {selectedStep.kind.replace(/_/g, " ")}
                  </Badge>
                  <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">{selectedStep.description}</p>
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
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-[0.71875rem]">
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
    <div className="mb-2 rounded-md border border-border bg-card px-3 py-2 text-[0.75rem]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[0.875rem] font-semibold text-foreground">{cap.name}</h2>
        <Badge variant="secondary" className="text-[0.625rem] uppercase">{cap.confidence} confidence</Badge>
        {cap.namedBy === "deterministic" && (
          <Badge variant="outline" className="text-[0.625rem]" title="No usable name came back from the naming step, so this label is the domain noun the grouping was formed on.">
            named from evidence
          </Badge>
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
            <p className="section-label mb-1">Entry points</p>
            <ul className="space-y-0.5">
              {cap.binding.entrypoints.slice(0, 4).map((e) => (
                <li key={`${e.filePath}:${e.route ?? ""}`} className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                  <RouteIcon className="h-3 w-3 shrink-0 opacity-60" />
                  <span className="truncate font-mono" title={e.route ?? e.filePath}>{e.route ?? e.filePath}</span>
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
                  <Link
                    to={`/projects/${projectId}/dependencies?focus=${encodeURIComponent(fileOf(s.stable_key))}`}
                    className="flex min-w-0 items-center gap-1.5 font-mono text-primary hover:underline"
                    title={s.stable_key}
                  >
                    <FileCode2 className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 truncate">{s.stable_key}</span>
                  </Link>
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
              {cap.modules.map((mod) => (
                <Link
                  key={mod.id}
                  to={`/projects/${projectId}/architecture?cluster=${encodeURIComponent(mod.stableKey ?? "")}`}
                  title={mod.reason ?? undefined}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[0.6875rem] text-foreground transition-colors hover:border-primary/50"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: `var(--node-${CLUSTER_KIND_PALETTE[mod.kind ?? ""] ?? "shared"})` }}
                  />
                  {mod.label}
                </Link>
              ))}
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
