import { AlertTriangle, CornerLeftUp, Loader2, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { Viewport } from "reactflow";
import { ClassGraphSection } from "@/components/graph/ClassGraphSection";
import { DependencyGraphView } from "@/components/graph/DependencyGraphView";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { NodeInfoPanel } from "@/components/graph/NodeInfoPanel";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchDependencyGraph,
  fetchNodeDetail,
  type GraphResponse,
  type NodeDetail,
} from "@/lib/graphData";
import { useOptionalProject } from "@/contexts/ProjectContext";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDrillStack } from "@/hooks/useDrillStack";
import { useGraphDrill } from "@/hooks/useGraphDrill";
import { capEdgesPerNode, layoutDependencyGraph } from "@/lib/graphLayout";
import { cn } from "@/lib/utils";
import type { GraphNode, GraphEdge } from "@/types/graph";

type GraphView = "files" | "classes";

const VIEWS: { key: GraphView; label: string }[] = [
  { key: "files", label: "Files" },
  { key: "classes", label: "Classes & interfaces" },
];

export function GraphPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<GraphView>("files");
  // GraphPage renders both inside ProjectLayout (/projects/:id/dependencies,
  // which provides ProjectProvider) and standalone at /dev/graph/:id (no
  // provider) — useOptionalProject returns null in the latter case instead
  // of throwing.
  const projectCtx = useOptionalProject();
  const project = projectCtx?.project ?? null;
  // Same story for the package selection (absent on the standalone route).
  const selectedPackageId = useOptionalPackages()?.selectedPackageId ?? null;
  const githubRepo =
    project?.repo_owner && project?.repo_name && project?.branch
      ? { owner: project.repo_owner, repo: project.repo_name, branch: project.branch }
      : undefined;
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [allEdges, setAllEdges] = useState(false);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(() => new Set());
  const [direction, setDirection] = useState<"LR" | "TB">("LR");
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeDetail, setSelectedNodeDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [focusNotFoundId, setFocusNotFoundId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const stack = useDrillStack();
  const activeCluster = stack.current?.kind === "cluster" ? stack.current.id : null;
  // Suppresses React Flow's own declarative initial fitView on this mount
  // so ViewportFocus is the sole viewport writer while resolving a
  // ?focus= deep link — see DependencyGraphView's suppressInitialFit doc.
  const hasFocusTarget = !!searchParams.get("focus");
  // A deep link has no viewport the user chose, so its target must be framed
  // for them. Every other selection only nudges the camera.
  const [focusIntent, setFocusIntent] = useState<"deeplink" | "user">(
    hasFocusTarget ? "deeplink" : "user",
  );

  /**
   * Fetches one level and commits it. Returns a promise so the drill
   * transition can overlap the fetch with its animation and only move the
   * stack once the data is actually in hand — a failed load then leaves the
   * user on the level they were already on instead of on a blank one.
   */
  const levelKey = (cluster: string | null) => `${id ?? ""}::${selectedPackageId ?? ""}::${cluster ?? ""}`;
  const loadedKeyRef = useRef<string | null>(null);
  const pendingFocusDrillRef = useRef<string | null>(null);

  const loadLevel = useCallback(
    async (cluster: string | null): Promise<void> => {
      if (!id) return;
      setLoading(true);
      setError("");
      setSelectedNodeId(null);
      try {
        const d = await fetchDependencyGraph(id, cluster ?? undefined, selectedPackageId);
        setData(d);
        loadedKeyRef.current = levelKey(cluster);

        // Resolve a pending `?focus=<file>` in the SAME commit as the data
        // that makes it resolvable, rather than in a later effect: mounting
        // with nothing selected races React Flow's own initial fitView, which
        // is why arriving by redirect used to frame inconsistently while a
        // manual click on a settled graph always worked.
        const focus = searchParams.get("focus");
        if (!focus) return;
        if (d.graph.nodes.some((n) => n.id === focus)) {
          setSelectedNodeId(focus);
          setFocusNotFoundId(null);
          return;
        }
        // Large repos render as directory groups at the root, so the target
        // file is never a root-level node — it lives inside a group. Drill to
        // its 2-level prefix (mirroring the backend rule in graph.ts) before
        // calling it missing.
        if (d.clustered && !cluster) {
          const parts = focus.split("/");
          pendingFocusDrillRef.current =
            parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts.length > 1 ? parts[0]! : ".";
          return;
        }
        setFocusNotFoundId(focus);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load graph");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [id, selectedPackageId, searchParams],
  );

  // Filled by GraphCanvas from inside the React Flow provider, so the camera
  // can be captured before navigating away and restored on the way back.
  const viewportRef = useRef<(() => Viewport) | null>(null);

  const drill = useGraphDrill({
    stack,
    loadLevel: (frame) => loadLevel(frame?.kind === "cluster" ? frame.id : null),
    readViewport: () => viewportRef.current?.() ?? null,
  });

  // The level comes straight from the URL, so the first render already
  // reflects it — including a cold load on a shared link. A real
  // project/package switch invalidates a drill path built from another
  // snapshot's directory layout, so it resets to the root rather than
  // carrying a stale one across.
  const prevGraphKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${id ?? ""}::${selectedPackageId ?? ""}`;
    const projectOrPackageChanged = prevGraphKeyRef.current !== null && prevGraphKeyRef.current !== key;
    prevGraphKeyRef.current = key;
    if (projectOrPackageChanged && stack.depth > 0) {
      stack.reset();
      return;
    }
    // A drill already fetched this level before moving the stack; refetching
    // here would double-request and clobber the transition mid-flight.
    if (loadedKeyRef.current === levelKey(activeCluster)) return;
    void loadLevel(activeCluster).catch(() => {});
  }, [id, selectedPackageId, searchParams]);

  // A `?focus=` target that lives inside a directory group needs one drill to
  // become reachable. Done as an effect so it runs after the load that
  // discovered it, and `replace` keeps it out of the Back history — the user
  // never chose this hop.
  useEffect(() => {
    const target = pendingFocusDrillRef.current;
    if (!target) return;
    pendingFocusDrillRef.current = null;
    setFocusIntent("deeplink");
    stack.push({ kind: "cluster", id: target, label: target.split("/").filter(Boolean).pop() ?? target });
  }, [data]);

  // ← / → cycle the selectable (non-cluster) nodes; Esc deselects — paired
  // with ViewportFocus, cycling glides the camera node to node.
  const cycleIds = useMemo(
    () => (data?.graph.nodes ?? []).map((n) => n.id).filter((nid) => !nid.startsWith("cluster:")),
    [data],
  );
  const cycleNode = (delta: number) => {
    if (cycleIds.length === 0) return;
    const idx = selectedNodeId ? cycleIds.indexOf(selectedNodeId) : -1;
    const next = cycleIds[(idx + delta + cycleIds.length) % cycleIds.length];
    setSelectedNodeId(next ?? null);
  };
  useHotkeys(
    {
      ArrowRight: () => cycleNode(1),
      ArrowLeft: () => cycleNode(-1),
      Escape: () => setSelectedNodeId(null),
    },
    view === "files" && !!data && !loading,
  );

  function toggleKind(kind: string) {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  // Enrich the selected node with the symbol doc, critical-path score and
  // connected workflows; best-effort, so a failure just leaves the panel basic.
  useEffect(() => {
    setSelectedNodeDetail(null);
    if (!id || !selectedNodeId || selectedNodeId.startsWith("cluster:")) return;
    setDetailLoading(true);
    let cancelled = false;
    fetchNodeDetail(id, selectedNodeId, selectedPackageId)
      .then((detail) => {
        if (!cancelled) setSelectedNodeDetail(detail);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, selectedNodeId, selectedPackageId]);

  const nodes: GraphNode[] = useMemo(() => {
    if (!data) return [];
    return data.graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      metadata: {
        exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
        importCount: (n.metadata?.importCount as number) ?? 0,
        externalImportCount: (n.metadata?.externalImportCount as number) ?? 0,
        dependentCount: (n.metadata?.dependentCount as number) ?? 0,
      },
    }));
  }, [data]);

  const edges: GraphEdge[] = useMemo(() => {
    if (!data) return [];
    return data.graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      weight: (e as { weight?: number }).weight ?? 1,
    }));
  }, [data]);

  const filteredNodeIds = useMemo(() => {
    const query = search.trim().toLowerCase();
    return new Set(
      nodes
        .filter((node) => {
          if (!query) return true;
          return (
            node.label.toLowerCase().includes(query) ||
            node.id.toLowerCase().includes(query) ||
            node.metadata.exportedSymbols.some((s) => s.toLowerCase().includes(query))
          );
        })
        .map((node) => node.id),
    );
  }, [nodes, search]);

  const visibleNodes = useMemo(
    () => nodes.filter((node) => filteredNodeIds.has(node.id)),
    [nodes, filteredNodeIds],
  );

  const visibleEdges = useMemo(() => {
    const inFilter = edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target));
    // Dense repos mangle: default to each node's strongest 3 edges in each
    // direction — the layout stays readable and "Show all edges" is one click.
    return allEdges ? inFilter : capEdgesPerNode(inFilter);
  }, [edges, filteredNodeIds, allEdges]);

  const positionedNodes = useMemo(
    () => layoutDependencyGraph(visibleNodes, visibleEdges, data?.graph.entryPoints ?? [], direction),
    [visibleNodes, visibleEdges, data, direction],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const showPanel = view === "files" && selectedNode && !data?.clustered;

  return (
    <div style={{ "--graph-chrome": fullscreen ? "90px" : "230px" } as React.CSSProperties}>
      <PageHeader
        title={
          // Breadcrumb over the real drill stack. It used to be built by
          // splitting the current cluster path, which meant each crumb was a
          // path prefix rather than a level the user had visited — so a deep
          // link that auto-drilled two levels showed crumbs for somewhere the
          // user had never been. "Dependencies" never moves.
          stack.depth > 0 ? (
            <span className="flex flex-wrap items-baseline gap-1.5">
              <button
                className="transition-colors hover:text-primary disabled:opacity-50"
                onClick={() => drill.jumpTo(-1)}
                disabled={drill.busy}
                title="Back to all groups"
              >
                Dependencies
              </button>
              {stack.frames.map((frame, i) => {
                const isLast = i === stack.depth - 1;
                return (
                  <span
                    key={`${frame.kind}:${frame.id}`}
                    className="flex items-baseline gap-1.5 text-sm font-normal text-muted-foreground"
                  >
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
            "Dependencies"
          )
        }
        subtitle="Which files depend on which — follow the arrows to see how changes ripple."
        actions={
          <>
            {view === "files" && stack.depth > 0 && (
              <Button
                variant="outline"
                size="xs"
                onClick={drill.drillUp}
                disabled={drill.busy}
                title="Back to the level you came from"
              >
                <CornerLeftUp className="mr-1 h-3 w-3" />
                Back
              </Button>
            )}
            {view === "files" && data && (
              <>
                <Badge variant="outline" className="text-[0.6875rem] tabular-nums">
                  {data.totalNodes} files · {data.totalEdges} edges
                  {data.clustered && " (grouped)"}
                </Badge>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setFullscreen((v) => !v)}
                  title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
                >
                  {fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                </Button>
                <Button
                  variant={allEdges ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => setAllEdges((v) => !v)}
                  title="By default only each file's 3 strongest edges per direction are drawn to keep the layout readable"
                >
                  {allEdges ? "Strongest edges only" : "Show all edges"}
                </Button>
                <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                  {(["LR", "TB"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDirection(d)}
                      aria-pressed={direction === d}
                      title={d === "LR" ? "Left-to-right layout" : "Top-to-bottom layout"}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        direction === d ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </>
            )}
            {/* The view toggle stays rightmost so it never shifts when the
                files-only controls above unmount. */}
            <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  aria-pressed={view === v.key}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    view === v.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </>
        }
      />

      {view === "classes" && id && <ClassGraphSection projectId={id} />}

      {view === "files" && loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {view === "files" && (error || (!data && !loading)) && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {error || "No graph data available yet"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Run an analysis first to generate the dependency graph, or retry if analysis has completed.
            </p>
          </div>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              // Clear the guard first, or the retry is skipped as
              // already-loaded and the button silently does nothing.
              loadedKeyRef.current = null;
              void loadLevel(activeCluster).catch(() => {});
            }}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {view === "files" && data && !loading && (
        <>
          {data.clustered && (
            <p className="mb-2 text-xs text-muted-foreground">
              Large codebase ({data.totalNodes} files) — showing directory groups. Click a group to drill in.
            </p>
          )}

          {focusNotFoundId && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
              <span className="flex-1 text-foreground">
                Could not find <code className="font-mono">{focusNotFoundId}</code> in the current view.
              </span>
              <Button variant="ghost" size="xs" onClick={() => setFocusNotFoundId(null)}>
                Dismiss
              </Button>
            </div>
          )}

          <GraphToolbar
            search={search}
            onSearchChange={setSearch}
            matchCount={visibleNodes.length}
            totalCount={nodes.length}
            noun={data.clustered ? "groups" : "files"}
          />

          <div className={cn(showPanel ? "grid gap-3 lg:grid-cols-[1fr_340px]" : "", fullscreen && "fixed inset-0 z-50 bg-background p-3")}>
            <div className="graph-canvas">
              <DependencyGraphView
                nodes={positionedNodes}
                edges={visibleEdges}
                entryPoints={data.graph.entryPoints}
                selectedNodeId={selectedNodeId}
                suppressInitialFit={hasFocusTarget}
                hiddenKinds={hiddenKinds}
                onToggleKind={toggleKind}
                refitSignal={`${direction}:${fullscreen}`}
                drill={drill}
                focusMode={focusIntent === "deeplink" ? "frame" : "pan-into-view"}
                restoreViewport={stack.savedViewport(stack.depth)}
                viewportRef={viewportRef}
                // A group opens a level below it — that is navigation, and it
                // gets the zoom transition. A file is a leaf: clicking it
                // opens the detail panel and leaves the camera alone.
                onDrillInto={(nodeId) => {
                  if (!nodeId.startsWith("cluster:")) return false;
                  const path = nodeId.replace("cluster:", "");
                  drill.drillInto(
                    { kind: "cluster", id: path, label: path.split("/").filter(Boolean).pop() ?? path },
                    nodeId,
                  );
                  return true;
                }}
                onSelectNode={(nodeId) => {
                  if (nodeId) setFocusIntent("user");
                  setSelectedNodeId(nodeId);
                }}
              />
            </div>

            {showPanel && (
              <aside className="graph-canvas overflow-y-auto !bg-card">
                <NodeInfoPanel
                  node={selectedNode}
                  detail={selectedNodeDetail}
                  loading={detailLoading}
                  githubRepo={githubRepo}
                  onClose={() => setSelectedNodeId(null)}
                />
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
