import { useMemo, type MutableRefObject } from "react";
import { Handle, Panel, Position, type Edge, type Node, type NodeProps, type Viewport } from "reactflow";
import "reactflow/dist/style.css";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { GraphFirstVisitHint } from "@/components/graph/GraphFirstVisitHint";
import { GraphLegend } from "@/components/graph/GraphLegend";
import type { FocusMode } from "@/components/graph/ViewportFocus";
import { ModuleNode, type ModuleNodeData } from "@/components/graph/ModuleNode";
import { Card } from "@/components/ui/card";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import type { GraphDrill } from "@/hooks/useGraphDrill";
import type { PositionedNode } from "@/lib/graphLayout";
import { inferNodeType } from "@/lib/graphNodeType";
import { cn } from "@/lib/utils";
import type { GraphEdge } from "@/types/graph";

/** Graph node types that are a symbol inside a file, not a file itself. */
const SYMBOL_KINDS = new Set(["function", "method", "class", "interface", "type", "enum", "variable"]);

/** Adds "this node opens a level" to the module data without editing ModuleNode. */
interface DrillableModuleNodeData extends ModuleNodeData {
  /** Symbols this file declares; > 0 means clicking it drills into them. */
  drillableSymbolCount?: number;
}

// Wraps ModuleNode with an entry-point marker rather than editing
// ModuleNode.tsx directly (that file is owned by a parallel change).
function EntryAwareModuleNode(props: NodeProps<DrillableModuleNodeData>) {
  const symbols = props.data.drillableSymbolCount ?? 0;
  return (
    <div className="relative">
      {props.data.isEntryPoint && (
        <span
          title="Entry point"
          className="absolute -left-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[0.5rem] font-bold text-primary-foreground shadow"
        >
          ▶
        </span>
      )}
      <ModuleNode {...props} />
      {symbols > 0 && (
        // Without this the file → symbols rung is invisible: nothing on a file
        // node says it opens anything.
        <span
          title={`Open the ${symbols} symbol${symbols === 1 ? "" : "s"} declared in this file`}
          className="absolute -bottom-2 right-2 z-10 rounded-full border border-border bg-card px-1.5 py-0.5 text-[0.5625rem] font-semibold text-muted-foreground shadow-sm"
        >
          {symbols} symbols ›
        </span>
      )}
    </div>
  );
}

/** Badge + left accent per symbol kind — deliberately not the file-path palette. */
const SYMBOL_KIND_STYLE: Record<string, { badge: string; accent: string }> = {
  class: { badge: "bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/40", accent: "border-l-blue-500" },
  interface: { badge: "bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/40", accent: "border-l-purple-500" },
  type: { badge: "bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/40", accent: "border-l-purple-400" },
  enum: { badge: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40", accent: "border-l-amber-500" },
  method: { badge: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400 border-cyan-500/40", accent: "border-l-cyan-500" },
  variable: { badge: "bg-slate-500/20 text-slate-700 dark:text-slate-400 border-slate-500/40", accent: "border-l-slate-400" },
  function: { badge: "bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/40", accent: "border-l-green-500" },
};
const DEFAULT_SYMBOL_STYLE = SYMBOL_KIND_STYLE.variable!;

interface SymbolNodeData {
  label: string;
  kind: string;
  exported: boolean;
  /** Calls this symbol makes, project-wide — not only the ones drawn here. */
  callCount: number;
  calledByCount: number;
  isEntryPoint: boolean;
  selected: boolean;
  dimmed: boolean;
}

/**
 * A symbol on the file → symbols level. Its own component because ModuleNode's
 * footer counts imports, and a function does not import anything — printing
 * "3 imports" under a function would be a wrong number, not a small one.
 */
function SymbolNode({ data }: NodeProps<SymbolNodeData>) {
  const style = SYMBOL_KIND_STYLE[data.kind] ?? DEFAULT_SYMBOL_STYLE;
  return (
    <div
      className={cn(
        "w-[240px] rounded-lg border border-l-4 bg-card px-3 py-2.5 shadow-md transition-opacity",
        style.accent,
        data.selected ? "border-primary ring-2 ring-ring" : "border-border hover:border-muted-foreground/40",
        data.dimmed && "opacity-20",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />

      <div className="mb-1 flex items-center gap-1.5">
        {data.isEntryPoint && (
          <span title="Entry point" className="shrink-0 text-[0.625rem] text-primary">▶</span>
        )}
        <span className="flex-1 truncate text-[0.8125rem] font-semibold text-foreground" title={data.label}>
          {data.label}
        </span>
        <span
          className={cn(
            "shrink-0 rounded border px-1 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide",
            style.badge,
          )}
        >
          {data.kind}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 text-[0.6875rem] text-muted-foreground">
        <span>{data.exported ? "exported" : "file-local"}</span>
        <span className="text-border">·</span>
        <span title="Calls this symbol makes, anywhere in the project">{data.callCount} calls</span>
        <span className="text-border">·</span>
        <span title="Calls to this symbol, from anywhere in the project">{data.calledByCount} called by</span>
      </div>
    </div>
  );
}

const nodeTypes = { module: EntryAwareModuleNode, symbol: SymbolNode };

/** The file-level legend describes imports between files, which is not what
 * this level draws. */
function SymbolLegend() {
  return (
    <Card className="w-64 max-w-[75vw] gap-2 border-border bg-card/95 px-3 py-2.5 text-xs shadow-md backdrop-blur">
      <span className="font-semibold text-foreground">Legend</span>
      <p className="text-muted-foreground">
        Each node is a symbol declared in this one file. A <span className="font-medium">CALLS</span> arrow
        means the source calls the target; <span className="font-medium">CONTAINS</span> means a class owns
        that method.
      </p>
      <p className="text-muted-foreground">
        Only calls between symbols in this file are drawn — the counts on each node include calls to and
        from the rest of the project. Click a symbol for its detail.
      </p>
    </Card>
  );
}

interface DependencyGraphViewProps {
  nodes: PositionedNode[];
  edges: GraphEdge[];
  entryPoints: string[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  /** Kinds toggled off in the legend — their nodes dim and stop intercepting
   * clicks instead of being removed (removal would relayout and jump the
   * viewport). */
  hiddenKinds?: Set<string>;
  onToggleKind?: (kind: string) => void;
  /** True when the caller already knows a node should be focused on this
   * mount (e.g. a `?focus=` deep link) — suppresses React Flow's own
   * declarative initial `fitView` so `ViewportFocus` is the sole viewport
   * writer on arrival. Without this, both fire around the same
   * measurement-ready moment and whichever lands last wins, which is
   * exactly why a redirect into this graph used to center/zoom
   * inconsistently while a manual node click (on an already-settled
   * graph, nothing else writing the viewport) always worked. */
  suppressInitialFit?: boolean;
  /** Bumped by the caller when node positions or the canvas container
   * change without the selection changing (a layout direction toggle, a
   * fullscreen toggle) — remounts the ReactFlow instance so its own
   * declarative `fitView` (already correct on first mount) reruns, instead
   * of racing an imperative `fitView()` call against React Flow's own
   * internal position-store sync. */
  refitSignal?: string | number;
  /** Returns true when this node opens a level below — see GraphCanvas. */
  onDrillInto?: (nodeId: string) => boolean;
  drill?: GraphDrill;
  /** `frame` only while resolving a `?focus=` deep link. */
  focusMode?: FocusMode;
  restoreViewport?: { x: number; y: number; zoom: number } | null;
  viewportRef?: MutableRefObject<(() => Viewport) | null>;
}

export function DependencyGraphView({
  nodes,
  edges,
  entryPoints,
  selectedNodeId,
  onSelectNode,
  hiddenKinds,
  onToggleKind,
  suppressInitialFit = false,
  refitSignal,
  onDrillInto,
  drill,
  focusMode,
  restoreViewport,
  viewportRef,
}: DependencyGraphViewProps) {
  const isDark = useIsDarkMode();
  const entryPointSet = useMemo(() => new Set(entryPoints), [entryPoints]);

  // The symbols level draws declarations inside one file, so the file-path
  // kind heuristics (and the legend built from them) do not apply: every node
  // shares one path and would collapse to a single meaningless swatch.
  const symbolLevel = useMemo(
    () => nodes.length > 0 && nodes.every((n) => SYMBOL_KINDS.has(n.kind)),
    [nodes],
  );

  // Legend shows only kinds that actually occur on this canvas.
  const nodeKindById = useMemo(
    () =>
      symbolLevel
        ? new Map<string, string>()
        : new Map(nodes.map((n) => [n.id, inferNodeType(n.id, n.metadata.exportedSymbols).type])),
    [nodes, symbolLevel],
  );
  const presentKinds = useMemo(() => [...new Set(nodeKindById.values())], [nodeKindById]);

  const neighborIds = useMemo(() => {
    if (!selectedNodeId) return null;
    const neighbors = new Set<string>([selectedNodeId]);
    for (const edge of edges) {
      if (edge.source === selectedNodeId) neighbors.add(edge.target);
      if (edge.target === selectedNodeId) neighbors.add(edge.source);
    }
    return neighbors;
  }, [edges, selectedNodeId]);

  const flowNodes: Node<DrillableModuleNodeData | SymbolNodeData>[] = useMemo(
    () =>
      nodes.map((node) => {
        const kind = nodeKindById.get(node.id);
        const kindHidden = kind !== undefined && (hiddenKinds?.has(kind) ?? false);
        const position = { x: node.x, y: node.y };
        const shared = {
          isEntryPoint: entryPointSet.has(node.id),
          selected: node.id === selectedNodeId,
          dimmed: neighborIds !== null && !neighborIds.has(node.id),
        };
        if (SYMBOL_KINDS.has(node.kind)) {
          return {
            id: node.id,
            type: "symbol",
            position,
            data: {
              label: node.label,
              kind: node.kind,
              exported: node.metadata.exported ?? false,
              callCount: node.metadata.importCount,
              calledByCount: node.metadata.dependentCount,
              ...shared,
            },
          };
        }
        return {
          id: node.id,
          type: "module",
          position,
          ...(kindHidden ? { style: { opacity: 0.15, pointerEvents: "none" as const } } : {}),
          data: {
            label: node.label,
            kind: node.kind,
            filePath: node.id,
            exportedSymbols: node.metadata.exportedSymbols,
            importCount: node.metadata.importCount,
            externalImportCount: node.metadata.externalImportCount ?? 0,
            dependentCount: node.metadata.dependentCount,
            // The exported-name list double-counts re-exports and misses
            // file-local declarations; the server's count is what the symbols
            // level will actually show.
            symbolCount: node.metadata.symbolCount ?? node.metadata.exportedSymbols.length,
            drillableSymbolCount: node.metadata.symbolCount ?? 0,
            ...shared,
          },
        };
      }),
    [nodes, entryPointSet, selectedNodeId, neighborIds, nodeKindById, hiddenKinds],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((edge) => {
        const isActive =
          neighborIds !== null &&
          (edge.source === selectedNodeId || edge.target === selectedNodeId);
        const endpointHidden =
          (hiddenKinds?.has(nodeKindById.get(edge.source) ?? "") ?? false) ||
          (hiddenKinds?.has(nodeKindById.get(edge.target) ?? "") ?? false);

        let label: string | undefined;
        if (selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId)) {
          if (edge.kind === "imports" || edge.kind === "dependency") {
            label = edge.source === selectedNodeId ? "IMPORTS" : "IMPORTED BY";
          } else {
            label = edge.kind.toUpperCase();
          }
        }

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: isActive,
          label,
          labelStyle: { fill: "var(--muted-foreground)", fontSize: 9, fontWeight: 700 },
          labelBgStyle: { fill: "var(--popover)", fillOpacity: 0.95 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 3,
          style: {
            opacity: endpointHidden ? 0.03 : neighborIds === null || isActive ? 1 : 0.1,
            strokeWidth: isActive ? 2 : 1,
            stroke: isActive ? "var(--primary)" : "var(--border)",
          },
        };
      }),
    [edges, neighborIds, selectedNodeId, isDark, nodeKindById, hiddenKinds],
  );

  return (
    <GraphCanvas
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
      onDrillInto={onDrillInto}
      drill={drill}
      focusMode={focusMode}
      suppressInitialFit={suppressInitialFit}
      refitSignal={refitSignal}
      restoreViewport={restoreViewport}
      viewportRef={viewportRef}
    >
      <Panel position="top-left">
        {symbolLevel ? (
          <SymbolLegend />
        ) : (
          <GraphLegend presentKinds={presentKinds} hiddenKinds={hiddenKinds} onToggleKind={onToggleKind} />
        )}
      </Panel>
      <Panel position="bottom-center">
        <GraphFirstVisitHint hasEntryPoints={entryPoints.length > 0} />
      </Panel>
    </GraphCanvas>
  );
}
