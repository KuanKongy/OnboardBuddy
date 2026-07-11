import { AlertTriangle, Boxes, Loader2, RefreshCw, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLUSTER_KIND_PALETTE } from "@/lib/architectureData";
import { layoutGraph } from "@/lib/graphLayout";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import { cn } from "@/lib/utils";

interface Capability {
  id: string;
  stableKey: string;
  name: string;
  description: string;
  confidence: string;
  summary: string | null;
  workflows: Array<{ id: string; title: string; triggerType: string | null }>;
  modules: Array<{ id: string; label: string; stableKey: string | null; kind: string | null }>;
}

interface CapNodeData {
  label: string;
  sub: string;
  variant: "capability" | "workflow" | "module";
  moduleKind: string | null;
  selected: boolean;
  dimmed: boolean;
}

function CapNode({ data }: NodeProps<CapNodeData>) {
  const color =
    data.variant === "capability"
      ? "var(--primary)"
      : data.variant === "workflow"
        ? "var(--node-worker)"
        : `var(--node-${CLUSTER_KIND_PALETTE[data.moduleKind ?? ""] ?? "shared"})`;
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2 shadow-sm transition-all",
        data.variant === "capability" ? "w-60" : "w-52",
        data.selected ? "ring-2 ring-ring" : "hover:shadow-md",
        data.dimmed && "opacity-25",
      )}
      style={{ borderColor: data.variant === "capability" ? color : "var(--border)" }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-muted-foreground/60" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-muted-foreground/60" />
      <div className="flex items-center gap-2">
        {data.variant === "capability" ? (
          <Boxes className="h-3.5 w-3.5 shrink-0" style={{ color }} />
        ) : data.variant === "workflow" ? (
          <Zap className="h-3 w-3 shrink-0" style={{ color }} />
        ) : (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium text-foreground",
            data.variant === "capability" ? "text-[13px] font-semibold" : "text-[12px]",
          )}
          title={data.label}
        >
          {data.label}
        </span>
      </div>
      {data.sub && <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">{data.sub}</p>}
    </div>
  );
}

const nodeTypes = { cap: CapNode };

export function CapabilitiesPage() {
  const { id } = useParams<{ id: string }>();
  const isDark = useIsDarkMode();
  const [capabilities, setCapabilities] = useState<Capability[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    setError("");
    apiFetch(`/projects/${id}/capabilities`)
      .then((data: { capabilities: Capability[] }) => setCapabilities(data.capabilities))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  // One graph: capability → its workflows and modules. Shared members link
  // capabilities together naturally.
  const { flowNodes, flowEdges } = useMemo(() => {
    if (!capabilities || capabilities.length === 0) return { flowNodes: [] as Node<CapNodeData>[], flowEdges: [] as Edge[] };

    const nodeMeta = new Map<string, CapNodeData>();
    const edges: Array<{ id: string; source: string; target: string }> = [];
    for (const cap of capabilities) {
      nodeMeta.set(`cap:${cap.id}`, {
        label: cap.name,
        sub: cap.description,
        variant: "capability",
        moduleKind: null,
        selected: false,
        dimmed: false,
      });
      for (const wf of cap.workflows) {
        nodeMeta.set(`wf:${wf.id}`, {
          label: wf.title, sub: wf.triggerType ?? "", variant: "workflow", moduleKind: null, selected: false, dimmed: false,
        });
        edges.push({ id: `e:${cap.id}:${wf.id}`, source: `cap:${cap.id}`, target: `wf:${wf.id}` });
      }
      for (const mod of cap.modules) {
        nodeMeta.set(`mod:${mod.id}`, {
          label: mod.label, sub: "", variant: "module", moduleKind: mod.kind, selected: false, dimmed: false,
        });
        edges.push({ id: `e:${cap.id}:${mod.id}`, source: `cap:${cap.id}`, target: `mod:${mod.id}` });
      }
    }

    const neighbor = selectedId
      ? new Set([selectedId, ...edges.filter((e) => e.source === selectedId || e.target === selectedId).flatMap((e) => [e.source, e.target])])
      : null;

    const positioned = layoutGraph(
      [...nodeMeta.keys()].map((nid) => ({ id: nid, label: "", kind: "", metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } })),
      edges.map((e) => ({ ...e, kind: "member" })),
      { direction: "LR", nodeWidth: 232, nodeHeight: 72, ranksep: 120, nodesep: 24 },
    );

    const flowNodes: Node<CapNodeData>[] = positioned.map((p) => ({
      id: p.id,
      type: "cap",
      position: { x: p.x, y: p.y },
      data: {
        ...nodeMeta.get(p.id)!,
        selected: p.id === selectedId,
        dimmed: neighbor !== null && !neighbor.has(p.id),
      },
    }));
    const flowEdges: Edge[] = edges.map((e) => {
      const active = selectedId !== null && (e.source === selectedId || e.target === selectedId);
      return {
        ...e,
        animated: active,
        style: {
          stroke: active ? "var(--primary)" : "var(--border)",
          strokeWidth: active ? 2 : 1.2,
          opacity: neighbor === null || active ? 0.8 : 0.12,
        },
      };
    });
    return { flowNodes, flowEdges };
  }, [capabilities, selectedId]);

  const selectedCap = capabilities?.find((c) => `cap:${c.id}` === selectedId) ?? null;

  return (
    <div style={{ "--graph-chrome": "170px" } as React.CSSProperties}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Capability map</h1>
          <p className="page-subtitle">
            What the product does in business terms, and which workflows and components deliver each capability.
          </p>
        </div>
        {capabilities && capabilities.length > 0 && (
          <Badge variant="outline" className="text-[11px] tabular-nums">
            {capabilities.length} capabilit{capabilities.length === 1 ? "y" : "ies"}
          </Badge>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {!loading && (error || !capabilities || capabilities.length === 0) && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{error || "No capabilities extracted yet"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Capabilities are extracted by the AI analysis pass. They appear after a full analysis —
              and never for projects with AI disabled.
            </p>
          </div>
          <Button variant="outline" size="xs" onClick={load}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {!loading && capabilities && capabilities.length > 0 && (
        <div className={selectedCap ? "grid gap-3 lg:grid-cols-[1fr_320px]" : ""}>
          <div className="graph-canvas">
            <ReactFlowProvider>
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                onNodeClick={(_, node) => setSelectedId(node.id)}
                onPaneClick={() => setSelectedId(null)}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={isDark ? "oklch(0.28 0.02 264)" : "oklch(0.85 0.008 265)"} />
                <Controls className="!border-border !bg-card [&_button]:!border-border [&_button]:!bg-card [&_button]:!text-muted-foreground [&_button:hover]:!bg-accent [&_button_svg]:!fill-current" />
              </ReactFlow>
            </ReactFlowProvider>
          </div>

          {selectedCap && (
            <aside className="graph-canvas overflow-y-auto !bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">{selectedCap.name}</h2>
              <Badge variant="secondary" className="mt-1 text-[10px] uppercase">{selectedCap.confidence} confidence</Badge>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {selectedCap.summary ?? selectedCap.description}
              </p>

              {selectedCap.workflows.length > 0 && (
                <>
                  <p className="section-label mb-1.5 mt-4">Delivered by workflows</p>
                  <ul className="space-y-1">
                    {selectedCap.workflows.map((wf) => (
                      <li key={wf.id}>
                        <Link
                          to={`/projects/${id}/workflows`}
                          className="inline-flex items-center gap-1.5 text-[12.5px] text-primary hover:underline"
                        >
                          <Zap className="h-3 w-3" /> {wf.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {selectedCap.modules.length > 0 && (
                <>
                  <p className="section-label mb-1.5 mt-4">Implemented in</p>
                  <ul className="space-y-1">
                    {selectedCap.modules.map((mod) => (
                      <li key={mod.id}>
                        <Link
                          to={`/projects/${id}/architecture`}
                          className="inline-flex items-center gap-1.5 text-[12.5px] text-primary hover:underline"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: `var(--node-${CLUSTER_KIND_PALETTE[mod.kind ?? ""] ?? "shared"})` }}
                          />
                          {mod.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
