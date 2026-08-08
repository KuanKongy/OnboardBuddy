import { AlertTriangle, ChevronRight, CornerLeftUp, Maximize2, Minimize2, RefreshCw, Search, Unlink, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { MarkerType, type Edge, type Node, type Viewport } from "reactflow";
import "reactflow/dist/style.css";
import { GraphCanvas, MINIMAP_MIN_NODES } from "@/components/graph/GraphCanvas";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDrillStack } from "@/hooks/useDrillStack";
import { useGraphDrill } from "@/hooks/useGraphDrill";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import {
  ClusterNode,
  ClusterMemberNode,
  type ClusterNodeData,
  type ClusterMemberNodeData,
} from "@/components/graph/ClusterNode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CLUSTER_KIND_LABELS,
  CLUSTER_KIND_PALETTE,
  clusterCountDerivation,
  clusterSize,
  fetchArchitecture,
  type ArchitectureCluster,
  type ArchitectureResponse,
} from "@/lib/architectureData";
import { layoutGraph } from "@/lib/graphLayout";
import { autoDrillEnabled } from "@/lib/graphPrefs";
import { prefersReducedMotion } from "@/lib/motion";
import { ScoreProvenanceDisclosure } from "@/components/ScoreProvenance";
import { SourceMark } from "@/components/reader/SourceMark";
import { cn } from "@/lib/utils";

const nodeTypes = { cluster: ClusterNode, member: ClusterMemberNode };

export function ArchitecturePage() {
  const { id } = useParams<{ id: string }>();
  const packages = useOptionalPackages();
  const selectedPackageId = packages?.selectedPackageId ?? null;
  // A finished analysis publishes a new latest snapshot. Without this the tab
  // only refetched on `[id, selectedPackageId]`, so a run that completed while
  // the user sat on this page never appeared until a manual reload — and the
  // page they were staring at was the "no architecture data" warning.
  const latestSnapshotId = packages?.status?.latestSnapshot?.id ?? null;

  const [data, setData] = useState<ArchitectureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const stack = useDrillStack();
  const openClusterId = stack.current?.kind === "cluster" ? stack.current.id : null;
  const level = data?.level ?? null;
  const insideCluster = openClusterId !== null && level?.clusterId === openClusterId;

  // Filled by GraphCanvas from inside the React Flow provider so the camera can
  // be saved before drilling and restored on the way back.
  const viewportRef = useRef<(() => Viewport) | null>(null);

  /**
   * Loads one level and commits it. Returns a promise so the drill transition
   * can overlap the fetch with its animation and only move the stack once the
   * data is in hand — a failed load then leaves the user on the level they
   * were already on rather than on a blank one.
   */
  const levelKey = (cluster: string | null) =>
    `${id ?? ""}::${selectedPackageId ?? ""}::${cluster ?? ""}`;
  const loadedKeyRef = useRef<string | null>(null);
  // `loadedKeyRef` guards refetching, not staleness: two loads can be in flight and
  // response order is not selection order.
  const loadRunRef = useRef(0);

  const loadLevel = useCallback(
    async (cluster: string | null): Promise<void> => {
      if (!id) return;
      const myRun = ++loadRunRef.current;
      const live = () => loadRunRef.current === myRun;
      setLoading(true);
      setError("");
      setSelectedId(null);
      try {
        const next = await fetchArchitecture(id, selectedPackageId, cluster);
        if (!live()) return;
        setData(next);
        loadedKeyRef.current = levelKey(cluster);
      } catch (err) {
        if (live()) setError(err instanceof Error ? err.message : "Failed to load the architecture map");
        throw err;
      } finally {
        if (live()) setLoading(false);
      }
    },
    [id, selectedPackageId],
  );

  const drill = useGraphDrill({
    stack,
    loadLevel: (frame) => loadLevel(frame?.kind === "cluster" ? frame.id : null),
    readViewport: () => viewportRef.current?.() ?? null,
  });

  const [searchParams] = useSearchParams();

  // The level comes from the URL, so the first render already reflects it —
  // including a cold load on a shared `?drill=` link, and on the legacy
  // `?cluster=` deep link the capabilities hub still emits, which
  // `useDrillStack` decodes into a single cluster frame. A project or package
  // switch invalidates a drill path built from another snapshot's clustering,
  // so it resets to the root rather than carrying a stale one across.
  const prevKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${id ?? ""}::${selectedPackageId ?? ""}`;
    const projectOrPackageChanged = prevKeyRef.current !== null && prevKeyRef.current !== key;
    prevKeyRef.current = key;
    if (projectOrPackageChanged && stack.depth > 0) {
      stack.reset();
      return;
    }
    // A drill already fetched this level before moving the stack; refetching
    // here would double-request and clobber the transition mid-flight.
    if (loadedKeyRef.current === levelKey(openClusterId)) return;
    void loadLevel(openClusterId).catch(() => {});
  }, [id, selectedPackageId, searchParams]);

  // An analysis that finishes while this tab is open publishes a new latest
  // snapshot. Watched separately from the load above rather than folded into
  // its key, because the first status poll resolves `null -> <id>` on a normal
  // page load and would otherwise fetch the same level twice on every visit.
  // Tracked from the first REPORT, not the first id, so a project whose very
  // first analysis completes (null -> id) refetches too — that is the case
  // where the user is staring at "no architecture data available yet".
  const seenSnapshotRef = useRef<{ reported: boolean; id: string | null }>({ reported: false, id: null });
  useEffect(() => {
    if (!packages?.status) return;
    const prev = seenSnapshotRef.current;
    seenSnapshotRef.current = { reported: true, id: latestSnapshotId };
    if (!prev.reported || prev.id === latestSnapshotId) return;
    loadedKeyRef.current = null;
    void loadLevel(openClusterId).catch(() => {});
  }, [packages?.status, latestSnapshotId]);

  // Esc closes the details aside (Escape also cancels a running drill, which
  // `useGraphDrill` owns).
  useHotkeys({ Escape: () => setSelectedId(null) }, selectedId !== null);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const clusterById = useMemo(
    () => new Map((data?.clusters ?? []).map((c) => [c.id, c])),
    [data],
  );
  /** The component you are inside, when drilled. */
  const openCluster: ArchitectureCluster | null =
    insideCluster && openClusterId ? clusterById.get(openClusterId) ?? null : null;

  /**
   * Opens a component's files.
   *
   * Owner I1: "The architecture, doesn't drill down, it doesn't show files.
   * You may add the button, to allow drilling down, it shouldn't by default."
   * The level existed and was reachable, but only by clicking the card — the
   * same gesture that everywhere else in the app means "select", so a reader
   * who clicked once, saw the canvas change, and clicked Back never learned
   * there was a files level at all. Selection and opening are now separate
   * gestures, and opening has a labelled control on the card and in the aside.
   */
  const openComponent = useCallback(
    (clusterId: string, label: string, anchorNodeId?: string) => {
      drill.drillInto({ kind: "cluster", id: clusterId, label }, anchorNodeId ?? clusterId);
    },
    [drill],
  );

  // ── Root level: components ────────────────────────────────────────────────
  const visibleClusters = useMemo(() => {
    if (!data || insideCluster) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.clusters;
    return data.clusters.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.narrative?.summary ?? c.summary).toLowerCase().includes(q) ||
        c.members.some(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            (m.filePath ?? "").toLowerCase().includes(q) ||
            // Searchable now that it is readable: "which component holds the
            // queue consumer" is answerable from the member briefs.
            (m.summary ?? "").toLowerCase().includes(q),
        ),
    );
  }, [data, insideCluster, search]);

  // ── Drilled level: the component's own members ────────────────────────────
  const visibleMembers = useMemo(() => {
    if (!insideCluster || !level) return [];
    const q = search.trim().toLowerCase();
    if (!q) return level.nodes;
    return level.nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        (n.filePath ?? "").toLowerCase().includes(q) ||
        (n.summary ?? "").toLowerCase().includes(q),
    );
  }, [insideCluster, level, search]);

  const visibleEdges = useMemo(() => {
    const source = insideCluster ? level?.edges ?? [] : data?.edges ?? [];
    const ids = new Set(
      insideCluster ? visibleMembers.map((n) => n.id) : visibleClusters.map((c) => c.id),
    );
    return source.filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [insideCluster, level, data, visibleClusters, visibleMembers]);

  const neighborIds = useMemo(() => {
    if (!selectedId) return null;
    const n = new Set([selectedId]);
    for (const e of visibleEdges) {
      if (e.source === selectedId) n.add(e.target);
      if (e.target === selectedId) n.add(e.source);
    }
    return n;
  }, [visibleEdges, selectedId]);

  const positioned = useMemo(() => {
    const nodes = insideCluster
      ? visibleMembers.map((n) => ({ id: n.id, label: n.label, kind: n.kind, metadata: { exportedSymbols: n.exportedSymbols, importCount: n.importCount, dependentCount: n.dependentCount } }))
      : visibleClusters.map((c) => ({ id: c.id, label: c.label, kind: c.kind, metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } }));
    return layoutGraph(nodes, visibleEdges, {
      direction: "LR",
      nodeWidth: insideCluster ? 220 : 240,
      nodeHeight: insideCluster ? 84 : 128,
      ranksep: 110,
      nodesep: 36,
    });
  }, [insideCluster, visibleClusters, visibleMembers, visibleEdges]);

  const flowNodes: Node<ClusterNodeData | ClusterMemberNodeData>[] = useMemo(() => {
    if (insideCluster) {
      const byId = new Map(visibleMembers.map((n) => [n.id, n]));
      return positioned.map((p) => {
        const m = byId.get(p.id)!;
        return {
          id: p.id,
          type: "member",
          position: { x: p.x, y: p.y },
          data: {
            label: m.label,
            filePath: m.filePath,
            summary: m.summary ?? null,
            criticalScore: m.criticalScore,
            importCount: m.importCount,
            dependentCount: m.dependentCount,
            clusterKind: level?.kind ?? "other",
            selected: p.id === selectedId,
            dimmed: neighborIds !== null && !neighborIds.has(p.id),
          } satisfies ClusterMemberNodeData,
        };
      });
    }
    const byId = new Map(visibleClusters.map((c) => [c.id, c]));
    return positioned.map((p) => {
      const c = byId.get(p.id)!;
      return {
        id: p.id,
        type: "cluster",
        position: { x: p.x, y: p.y },
        data: {
          label: c.label,
          kind: c.kind,
          // `members` counts symbols and config nodes too — see clusterSize.
          ...clusterSize(c),
          criticalScore: c.criticalScore,
          degree: c.degree ?? 0,
          // What it is FOR, not what it contains. `summary` is the fallback for
          // a response that predates narratives.
          responsibility: c.narrative?.responsibility ?? c.summary,
          selected: p.id === selectedId,
          dimmed: neighborIds !== null && !neighborIds.has(p.id),
        } satisfies ClusterNodeData,
      };
    });
  }, [insideCluster, positioned, visibleClusters, visibleMembers, level, selectedId, neighborIds]);

  const flowEdges: Edge[] = useMemo(
    () =>
      visibleEdges.map((e) => {
        const active = selectedId !== null && (e.source === selectedId || e.target === selectedId);
        const stroke = active ? "var(--primary)" : "var(--border)";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          animated: active && !prefersReducedMotion(),
          label: active ? e.kind.replace(/_/g, " ") : undefined,
          labelStyle: { fill: "var(--muted-foreground)", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "var(--popover)", fillOpacity: 0.95 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 3,
          // AUDIT C2: direction is the whole semantic of a dependency arrow and
          // was not encoded at all — both ends rendered identically.
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke },
          style: {
            opacity: neighborIds === null || active ? 0.9 : 0.12,
            // 1.25 floor so a weight-0 edge is still visible; see DependencyGraphView.
            strokeWidth: Math.min(4, 1.25 + e.weight / 4),
            stroke,
          },
        };
      }),
    [visibleEdges, selectedId, neighborIds],
  );

  const presentKinds = useMemo(
    () => [...new Set((data?.clusters ?? []).map((c) => c.kind))],
    [data],
  );

  const selectedMember = insideCluster ? visibleMembers.find((n) => n.id === selectedId) ?? null : null;
  // Inside a component the aside describes that component; the member panel
  // takes over once one is picked. At the ROOT there is now an aside too:
  // clicking a component previews it, and opening it is a separate button
  // (owner I1). Before this, a root click drilled immediately and the
  // component's own narrative — responsibility, boundary, why it is separate —
  // was only ever visible on the way past.
  // From `visibleClusters`, not `clusterById`: the sibling `selectedMember`
  // line above already scopes to what the search left drawn, and the root
  // aside must not describe a component the canvas no longer shows.
  const rootSelectedCluster =
    !insideCluster && selectedId ? visibleClusters.find((c) => c.id === selectedId) ?? null : null;
  const asideCluster = insideCluster ? (selectedMember ? null : openCluster) : rootSelectedCluster;
  /**
   * How many of this component's members actually carry a description.
   *
   * Printed under the list because coverage is uneven and unexplained
   * blank rows read as a rendering fault: 156 of OnboardBuddy's 286 members
   * have a file record, 6 of UBCPSS's 30. Saying so is what makes the empty
   * rows a fact about the analysis rather than a bug in the panel.
   */
  const describedMembers = (asideCluster?.members ?? []).filter((m) => m.summary).length;

  // A response can legitimately contain zero components — a snapshot where
  // nothing clustered, or an unparsed stack. The old guard was
  // `error || (!data && !loading)`, so that case fell through to the graph and
  // rendered "0 components · 0 connections" over an empty canvas with no
  // explanation at all. The same hole exists one level down: a component whose
  // member nodes did not persist would draw an empty level just as silently.
  const isEmpty = !!data && (insideCluster ? level!.nodes.length === 0 : data.clusters.length === 0);
  const showWarning = !loading && (!!error || !data || isEmpty);
  const retry = () => {
    // Clear the guard first, or the retry is skipped as already-loaded and the
    // button silently does nothing.
    loadedKeyRef.current = null;
    void loadLevel(openClusterId).catch(() => {});
  };

  /**
   * The header badge, reconciled with the canvas.
   *
   * Owner F1: "It shows a bigger number ... when you click to see details,
   * there are less." Drilled, this said "74 members" over a canvas drawing 60
   * (MasterPokedex · UI). At the root it counted every stored edge, including
   * any whose endpoint did not survive into `clusters`.
   */
  const drawableRootEdges = useMemo(() => {
    const ids = new Set((data?.clusters ?? []).map((c) => c.id));
    return (data?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)).length;
  }, [data]);
  const totals = insideCluster && level
    ? {
        primary:
          level.nodes.length < level.totalNodes
            ? `${level.nodes.length} of ${level.totalNodes} members`
            : `${level.totalNodes} member${level.totalNodes === 1 ? "" : "s"}`,
        secondary: `${level.edges.length} connection${level.edges.length === 1 ? "" : "s"} drawn`,
      }
    : {
        primary: `${data?.clusters.length ?? 0} components`,
        secondary: `${drawableRootEdges} connection${drawableRootEdges === 1 ? "" : "s"}`,
      };

  return (
    <div style={{ "--graph-chrome": fullscreen ? "90px" : "190px" } as React.CSSProperties}>
      <div data-tour="architecture-header">
        <PageHeader
          title={
            // Breadcrumb over the real drill stack — visited levels, not path
            // prefixes. "Architecture" never moves.
            // No crumb tooltips: "Back to <label>" restated the label the
            // crumb already shows (owner H1). No `aria-label` override either
            // — it would make the accessible name differ from the visible one
            // (WCAG 2.5.3); the row itself is what carries the description.
            stack.depth > 0 ? (
              <span
                className="flex flex-wrap items-baseline gap-1.5"
                role="navigation"
                aria-label="Architecture levels"
              >
                <button
                  type="button"
                  className="rounded-sm transition-colors hover:text-primary disabled:opacity-50"
                  onClick={() => drill.jumpTo(-1)}
                  disabled={drill.busy}
                >
                  Architecture
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
                        <span className="text-foreground">{openCluster?.label ?? frame.label}</span>
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
              "Architecture"
            )
          }
          subtitle={
            insideCluster
              ? "Inside one component: the files it is made of, most critical first."
              : "How the codebase is organized into layers. Click a component to read what it is for, then Open in its details panel to list its files."
          }
          actions={
            <>
              {/* Rendered on `stack.depth`, not on `data`: a drilled level whose
                  fetch failed has no data, and gating Back on data would strand
                  the user on a level they cannot leave without the browser. */}
              {stack.depth > 0 && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={drill.drillUp}
                  disabled={drill.busy}
                  aria-label="Back to the level you came from"
                >
                  <CornerLeftUp className="mr-1 h-3 w-3" />
                  Back
                </Button>
              )}
              {data && (
                <>
                  <Badge variant="outline" className="text-[0.6875rem] tabular-nums">
                    {totals.primary} · {totals.secondary}
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
      </div>

      {loading && (
        <Skeleton className="graph-canvas" role="status" aria-label="Loading the architecture map" />
      )}

      {showWarning && (
        <EmptyState
          className="mb-4"
          icon={<AlertTriangle className="h-4 w-4 shrink-0 text-warning" />}
          heading={
            error ||
            (isEmpty
              ? insideCluster
                ? `${level?.label ?? "This component"} has no members to show`
                : "This analysis produced no components"
              : "No architecture data available yet")
          }
          description={
            isEmpty
              ? insideCluster
                ? "The component exists on the map but none of its members survived into the graph, so there is nothing to open. Re-analyzing the project rebuilds them."
                : "The analysis finished but grouped no files into components, usually because nothing in the scope was in a language this parser reads. The Dependencies tab shows whatever files were parsed."
              : "The architecture map comes from analysis. Run an analysis first, or retry if one just finished."
          }
          actions={
            <Button variant="outline" size="xs" onClick={retry}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Retry
            </Button>
          }
        />
      )}

      {drill.error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="flex-1 text-foreground">{drill.error}</span>
        </div>
      )}

      {data && !loading && !isEmpty && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={insideCluster ? "Search files in this component…" : "Search components or files…"}
                aria-label={insideCluster ? "Search files in this component" : "Search components or files"}
                className="h-8 pl-8 text-xs"
              />
            </div>
            {!insideCluster && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {presentKinds.map((kind) => {
                  const palette = CLUSTER_KIND_PALETTE[kind] ?? "shared";
                  return (
                    <span key={kind} className="inline-flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                      <span className="h-2 w-2 rounded-full" style={{ background: `var(--node-${palette})` }} />
                      {CLUSTER_KIND_LABELS[kind] ?? kind}
                    </span>
                  );
                })}
              </div>
            )}
            {search && (
              <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                {insideCluster
                  ? `${visibleMembers.length} / ${level?.nodes.length ?? 0}`
                  : `${visibleClusters.length} / ${data.clusters.length}`}
              </span>
            )}
            {/* Truncation, disclosed. A level that silently drew 60 of a
                component's 200 files would be a graph quietly lying about
                what the component contains. */}
            {insideCluster && (level?.truncated ?? 0) > 0 && (
              <span className="text-[0.6875rem] text-warning">
                Showing the {level!.nodes.length} most critical of {level!.totalNodes} members, {level!.truncated} not drawn.
              </span>
            )}
          </div>

          <div className={cn(asideCluster || selectedMember ? "grid gap-3 lg:grid-cols-[1fr_320px]" : "", fullscreen && "fixed inset-0 z-50 bg-background p-3")}>
            {/* AUDIT C11 / B81: the overlay covers the header holding the exit
                toggle, so Esc was the only way out and nothing said so. */}
            {fullscreen && (
              <Button
                variant="outline"
                size="xs"
                className="absolute right-4 top-4 z-10"
                onClick={() => setFullscreen(false)}
              >
                <Minimize2 className="mr-1 h-3 w-3" />
                Exit fullscreen (Esc)
              </Button>
            )}
            <div className="graph-canvas">
              <GraphCanvas
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                selectedNodeId={selectedId}
                drill={drill}
                fitPadding={0.15}
                minZoom={0.2}
                // Under the threshold the minimap is a shrunken copy of the
                // picture already on screen, drawn over the bottom-right of it.
                showMiniMap={flowNodes.length >= MINIMAP_MIN_NODES}
                // Fullscreen only. `refitSignal` is React Flow's `key`, so
                // changing it on a level change would REMOUNT the canvas
                // mid-drill and throw away the transition DrillCamera is in the
                // middle of animating.
                refitSignal={String(fullscreen)}
                restoreViewport={stack.savedViewport(stack.depth)}
                viewportRef={viewportRef}
                // A click selects — a component opens its aside, a member opens
                // its panel — and opening a component is the labelled button in
                // that aside (owner I1). Readers who want the old one-click
                // drill back turn it on for this project in Project settings →
                // Viewing; a MEMBER still never drills, because there is no
                // level below a file here.
                onDrillInto={(nodeId) => {
                  if (insideCluster || !autoDrillEnabled("architecture", id ?? "")) return false;
                  const cluster = clusterById.get(nodeId);
                  if (!cluster) return false;
                  openComponent(cluster.id, cluster.label, nodeId);
                  return true;
                }}
                onSelectNode={setSelectedId}
              />
            </div>

            {asideCluster && (
              <aside className="graph-canvas overflow-y-auto !bg-card p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-foreground">{asideCluster.label}</h2>
                    <span
                      className="mt-1 inline-block rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-foreground"
                      style={{
                        background: `color-mix(in oklab, var(--node-${CLUSTER_KIND_PALETTE[asideCluster.kind] ?? "shared"}) 14%, transparent)`,
                      }}
                    >
                      {CLUSTER_KIND_LABELS[asideCluster.kind] ?? asideCluster.kind}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={insideCluster ? drill.drillUp : () => setSelectedId(null)}
                    disabled={drill.busy}
                    aria-label={insideCluster ? "Close and return to all components" : "Close component details"}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Owner I1. At the root this is THE way in to the files, and
                    it says how many are behind it so the click is informed. */}
                {!insideCluster && (
                  <Button
                    size="xs"
                    className="mb-3 w-full justify-center"
                    disabled={drill.busy}
                    onClick={() => openComponent(asideCluster.id, asideCluster.label)}
                  >
                    Open {clusterSize(asideCluster).count} {clusterSize(asideCluster).noun}
                    {clusterSize(asideCluster).count === 1 ? "" : "s"}
                    <ChevronRight className="ml-1 h-3 w-3" />
                  </Button>
                )}

                {(asideCluster.degree ?? 0) === 0 && (
                  <p className="mb-3 flex items-start gap-1.5 text-[0.71875rem] text-muted-foreground">
                    <Unlink className="mt-0.5 h-3 w-3 shrink-0" />
                    {/* AUDIT C7 / SC F11: an unexplained island reads as a
                        rendering fault rather than as a finding. */}
                    No architecture links were traced to or from this component, so it is drawn on its
                    own. That can mean genuine isolation, or that its relationships are of a kind this
                    analysis does not model (configuration and deployment links are not edges yet).
                  </p>
                )}

                {/* The narrative, as three labelled answers rather than one
                    inventory sentence. These are the SAME sentences the
                    generated Architecture in Depth section is written from, so
                    the tab and the package can no longer disagree. */}
                {asideCluster.narrative ? (
                  <div className="mb-3 space-y-2">
                    <div>
                      <p className="section-label">Responsible for</p>
                      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{asideCluster.narrative.responsibility}</p>
                    </div>
                    <div>
                      <p className="section-label">What crosses its boundary</p>
                      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{asideCluster.narrative.boundary}</p>
                    </div>
                    <div>
                      <p className="section-label">Why it is separate</p>
                      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{asideCluster.narrative.separation}</p>
                    </div>
                    {asideCluster.narrative.unknowns.length > 0 && (
                      <div>
                        <p className="section-label">Not established</p>
                        <ul className="space-y-0.5">
                          {asideCluster.narrative.unknowns.map((u) => (
                            <li key={u} className="flex items-start gap-1.5 text-[0.75rem] leading-relaxed text-muted-foreground/80">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                              <span>{u}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {/* One mark for the three answers above: they are one
                        block from one derivation, and three identical pills
                        would be the noise the mark exists to remove. */}
                    <SourceMark
                      source="code"
                      tip="Responsibility, boundary and separation are derived from the traced structure of this component, with no AI involved."
                    />
                  </div>
                ) : (
                  asideCluster.summary && (
                    <div className="mb-3">
                      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{asideCluster.summary}</p>
                      <div className="mt-1">
                        {asideCluster.summarySource === "semantic" ? (
                          <SourceMark
                            source="ai"
                            detail={asideCluster.confidence}
                            tip={`AI summary (${asideCluster.confidence ?? "unstated"} confidence).`}
                          />
                        ) : (
                          <SourceMark source="code" tip="Derived from code structure, with no AI involved." />
                        )}
                      </div>
                    </div>
                  )
                )}

                {/* Owner B1 + J1: one explicit control, and staged content
                    behind it. The derivation used to be an always-open block
                    here AND a hover ⓘ saying the same thing. */}
                <ScoreProvenanceDisclosure
                  className="mb-3"
                  data={asideCluster.provenance}
                  sectionLabel="Criticality"
                  buttonLabel={`Explain how the criticality score for ${asideCluster.label} was derived`}
                  // VISUAL QA M4 #7: the amber caveat here is a reconciliation
                  // note written for whoever audits the ranker ("Averaging the
                  // 16 member scores stored here gives 35.9, not 29.6 … only
                  // scores inside the snapshot's top 500 are kept"), and it
                  // fires wherever the cap truncates members — the big repos.
                  // The reader of this panel is told what the score means and
                  // how much of the component the list covers, right below.
                  showCaveat={false}
                  headline={
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full border border-input bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(asideCluster.criticalScore * 100))}%` }} />
                      </div>
                      <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                        {(asideCluster.criticalScore * 100).toFixed(0)}%
                      </span>
                    </div>
                  }
                />

                {/* The count, its derivation printed rather than hovered
                    (owner H1) — "Files" was wrong here too, since `members`
                    holds symbol, config and schema nodes and a Database Schema
                    cluster listed 48 tables under a heading calling them
                    files. */}
                <p className="section-label mb-1">Made of</p>
                <p className="mb-1.5 text-[0.6875rem] leading-snug text-muted-foreground">
                  {clusterCountDerivation(asideCluster)}
                </p>
                {/* Owner I2 + I3: ordered by criticality then path on the
                    server (it arrived in join order, which is neither stable
                    nor meaningful), and bounded with its own scrollbar instead
                    of dumping the first 30 and hiding the rest behind
                    "+ N more". */}
                {/* Every member says what it DOES, not just where it lives.
                    The line is the file's stored record — the same source the
                    Dependencies tab reads — so this list and that tab cannot
                    describe one file two ways. A member with no record shows
                    its path alone and says nothing else: "no description
                    available" on 41% of the rows would be noise, not
                    information (owner H1). */}
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 p-1.5">
                  {asideCluster.members.map((m, i) => (
                    <li key={m.key} className="flex min-w-0 items-baseline gap-1.5">
                      <span className="w-5 shrink-0 text-right text-[0.625rem] tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/projects/${id}/dependencies?focus=${encodeURIComponent(m.filePath ?? m.key)}`}
                          className="block min-w-0 break-all font-mono text-[0.71875rem] text-muted-foreground hover:text-primary hover:underline"
                        >
                          {m.filePath ?? m.key}
                        </Link>
                        {/* Icon, not a pill, on a list that can run to 158
                            rows: the same mark repeated down a scroller reads
                            as decoration long before the reader reaches the
                            bottom. The pill and its confidence are one click
                            away, on the member's own panel. */}
                        {m.summary && (
                          <p className="text-[0.6875rem] leading-snug text-foreground/80">
                            <SourceMark
                              variant="icon"
                              source={m.factsOnly ? "code" : "ai"}
                              tip={
                                m.factsOnly
                                  ? "Derived from the traced structure of this file, with no AI involved."
                                  : `Written by the model from this file's code (${m.summaryConfidence ?? "unstated"} confidence).`
                              }
                              className="mr-1 align-[-1px]"
                            />
                            {m.summary}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[0.625rem] text-muted-foreground">
                  Most critical first, then by path. Each link opens the file on the Dependencies tab.
                  {describedMembers > 0
                    ? ` ${describedMembers} of ${asideCluster.members.length} carry a generated description; the rest were not summarised in this snapshot.`
                    : " No generated descriptions exist for these members in this snapshot."}
                </p>
              </aside>
            )}

            {selectedMember && (
              <aside className="graph-canvas overflow-y-auto !bg-card p-4">
                {/* Wrapped, not truncated behind a tooltip (owner H1). */}
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="break-words text-sm font-semibold text-foreground">
                      {selectedMember.label}
                    </h2>
                    <p className="break-all font-mono text-[0.65625rem] text-muted-foreground">
                      {selectedMember.filePath ?? selectedMember.id}
                    </p>
                  </div>
                  <Button variant="ghost" size="xs" onClick={() => setSelectedId(null)} aria-label="Close details">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* The same line the member list shows — a member panel that
                    opened with a score and an export list still never said
                    what the file was for. */}
                {selectedMember.summary && (
                  <div className="mb-3">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <p className="section-label">What this file does</p>
                      {selectedMember.factsOnly ? (
                        <SourceMark source="code" tip="Deterministic facts only, no AI summary here." />
                      ) : (
                        <SourceMark
                          source="ai"
                          detail={selectedMember.summaryConfidence}
                          tip={`AI summary (${selectedMember.summaryConfidence ?? "unstated"} confidence), written from this file's code.`}
                        />
                      )}
                    </div>
                    <p className="text-[0.8125rem] leading-relaxed text-foreground">{selectedMember.summary}</p>
                    {selectedMember.role && (
                      <p className="mt-1 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                        {selectedMember.role}
                      </p>
                    )}
                  </div>
                )}

                <ScoreProvenanceDisclosure
                  className="mb-3"
                  data={selectedMember.provenance}
                  sectionLabel="Criticality"
                  buttonLabel={`Explain how the criticality score for ${selectedMember.label} was derived`}
                  // Same internal note, same reason (VISUAL QA M4 #7).
                  showCaveat={false}
                  headline={
                    selectedMember.criticalScore === null ? (
                      <p className="text-[0.71875rem] text-muted-foreground">
                        Not ranked in this snapshot: tests and fixtures are excluded, and only the top
                        500 scores per snapshot are kept.
                      </p>
                    ) : (
                      <div className="flex items-baseline gap-2">
                        <span className="text-base font-semibold tabular-nums text-foreground">
                          {Math.round(selectedMember.criticalScore * 100)}
                        </span>
                        <span className="text-[0.65625rem] text-muted-foreground">/ 100</span>
                      </div>
                    )
                  }
                />

                {selectedMember.exportedSymbols.length > 0 && (
                  <>
                    <p className="section-label mb-1.5">Exports</p>
                    <ul className="mb-3 space-y-0.5">
                      {selectedMember.exportedSymbols.slice(0, 20).map((s) => (
                        <li key={s} className="truncate font-mono text-[0.71875rem] text-muted-foreground">{s}</li>
                      ))}
                    </ul>
                  </>
                )}

                <Link
                  to={`/projects/${id}/dependencies?focus=${encodeURIComponent(selectedMember.filePath ?? selectedMember.id)}`}
                  className="text-[0.75rem] text-primary hover:underline"
                >
                  Open in Dependencies →
                </Link>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
