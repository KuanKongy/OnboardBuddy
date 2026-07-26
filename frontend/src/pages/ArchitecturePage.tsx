import { AlertTriangle, CornerLeftUp, Loader2, Maximize2, Minimize2, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import type { Edge, Node, Viewport } from "reactflow";
import "reactflow/dist/style.css";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
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
import { Input } from "@/components/ui/input";
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
import { ScoreProvenance, ScoreProvenanceInfo } from "@/components/ScoreProvenance";
import { cn } from "@/lib/utils";

const nodeTypes = { cluster: ClusterNode, member: ClusterMemberNode };

/** Members listed in the aside before the rest are summarised by a count. */
const MAX_LISTED_MEMBERS = 30;

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

  const loadLevel = useCallback(
    async (cluster: string | null): Promise<void> => {
      if (!id) return;
      setLoading(true);
      setError("");
      setSelectedId(null);
      try {
        const next = await fetchArchitecture(id, selectedPackageId, cluster);
        setData(next);
        loadedKeyRef.current = levelKey(cluster);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load the architecture map");
        throw err;
      } finally {
        setLoading(false);
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

  // ── Root level: components ────────────────────────────────────────────────
  const visibleClusters = useMemo(() => {
    if (!data || insideCluster) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.clusters;
    return data.clusters.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.narrative?.summary ?? c.summary).toLowerCase().includes(q) ||
        c.members.some((m) => m.name.toLowerCase().includes(q) || (m.filePath ?? "").toLowerCase().includes(q)),
    );
  }, [data, insideCluster, search]);

  // ── Drilled level: the component's own members ────────────────────────────
  const visibleMembers = useMemo(() => {
    if (!insideCluster || !level) return [];
    const q = search.trim().toLowerCase();
    if (!q) return level.nodes;
    return level.nodes.filter(
      (n) => n.label.toLowerCase().includes(q) || (n.filePath ?? "").toLowerCase().includes(q),
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
          countDerivation: clusterCountDerivation(c),
          criticalScore: c.criticalScore,
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
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          animated: active,
          label: active ? e.kind.replace(/_/g, " ") : undefined,
          labelStyle: { fill: "var(--muted-foreground)", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "var(--popover)", fillOpacity: 0.95 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 3,
          style: {
            opacity: neighborIds === null || active ? 0.9 : 0.12,
            strokeWidth: Math.min(4, 1 + e.weight / 4),
            stroke: active ? "var(--primary)" : "var(--border)",
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
  // takes over once one is picked. At the root there is no aside — clicking a
  // component opens it rather than previewing it.
  const asideCluster = insideCluster && !selectedMember ? openCluster : null;

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

  const totals = insideCluster && level
    ? { primary: `${level.totalNodes} member${level.totalNodes === 1 ? "" : "s"}`, secondary: `${level.edges.length} connections` }
    : { primary: `${data?.clusters.length ?? 0} components`, secondary: `${data?.edges.length ?? 0} connections` };

  return (
    <div style={{ "--graph-chrome": fullscreen ? "90px" : "190px" } as React.CSSProperties}>
      <div data-tour="architecture-header">
        <PageHeader
          title={
            // Breadcrumb over the real drill stack — visited levels, not path
            // prefixes. "Architecture" never moves.
            stack.depth > 0 ? (
              <span className="flex flex-wrap items-baseline gap-1.5">
                <button
                  className="transition-colors hover:text-primary disabled:opacity-50"
                  onClick={() => drill.jumpTo(-1)}
                  disabled={drill.busy}
                  title="Back to all components"
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
              "Architecture"
            )
          }
          subtitle={
            insideCluster
              ? "Inside one component — the files it is made of, ranked by how critical each one is."
              : "How the codebase is organized into layers — click a component to open it and see what it is made of."
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
                  title="Back to the level you came from"
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
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {showWarning && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {error ||
                (isEmpty
                  ? insideCluster
                    ? `${level?.label ?? "This component"} has no members to show`
                    : "This analysis produced no components"
                  : "No architecture data available yet")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isEmpty
                ? insideCluster
                  ? "The component exists on the map but none of its members survived into the graph, so there is nothing to open. Re-analyzing the project rebuilds them."
                  : "The analysis finished but grouped no files into components — usually because nothing in the scope was in a language this parser reads. The Dependencies tab shows whatever files were parsed."
                : "The architecture map comes from analysis. Run an analysis first, or retry if one just finished."}
            </p>
          </div>
          <Button variant="outline" size="xs" onClick={retry}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
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
                Showing the {level!.nodes.length} most critical of {level!.totalNodes} members — {level!.truncated} not drawn.
              </span>
            )}
          </div>

          <div className={cn(asideCluster || selectedMember ? "grid gap-3 lg:grid-cols-[1fr_320px]" : "", fullscreen && "fixed inset-0 z-50 bg-background p-3")}>
            <div className="graph-canvas">
              <GraphCanvas
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                selectedNodeId={selectedId}
                drill={drill}
                fitPadding={0.15}
                minZoom={0.2}
                // Fullscreen only. `refitSignal` is React Flow's `key`, so
                // changing it on a level change would REMOUNT the canvas
                // mid-drill and throw away the transition DrillCamera is in the
                // middle of animating.
                refitSignal={String(fullscreen)}
                restoreViewport={stack.savedViewport(stack.depth)}
                viewportRef={viewportRef}
                // A component has a level beneath it, so clicking it is
                // navigation and gets the zoom transition. A member is a leaf:
                // clicking it opens the panel and leaves the camera alone.
                onDrillInto={(nodeId) => {
                  if (insideCluster) return false;
                  const cluster = clusterById.get(nodeId);
                  if (!cluster) return false;
                  drill.drillInto({ kind: "cluster", id: cluster.id, label: cluster.label }, nodeId);
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
                      className="mt-1 inline-block rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide"
                      style={{
                        color: `var(--node-${CLUSTER_KIND_PALETTE[asideCluster.kind] ?? "shared"})`,
                        background: `color-mix(in oklab, var(--node-${CLUSTER_KIND_PALETTE[asideCluster.kind] ?? "shared"}) 14%, transparent)`,
                      }}
                    >
                      {CLUSTER_KIND_LABELS[asideCluster.kind] ?? asideCluster.kind}
                    </span>
                  </div>
                  <Button variant="ghost" size="xs" onClick={drill.drillUp} disabled={drill.busy} aria-label="Back to all components">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

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
                    <p className="text-[0.65625rem] text-muted-foreground/70">
                      Derived from the traced structure — no AI involved.
                    </p>
                  </div>
                ) : (
                  asideCluster.summary && (
                    <div className="mb-3">
                      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{asideCluster.summary}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[0.65625rem] text-muted-foreground/70">
                        {asideCluster.summarySource === "semantic" ? (
                          <>
                            <Sparkles className="h-2.5 w-2.5" /> AI summary ({asideCluster.confidence} confidence)
                          </>
                        ) : (
                          "Derived from code structure — no AI involved"
                        )}
                      </p>
                    </div>
                  )
                )}

                <div className="mb-1.5 flex items-center gap-1.5">
                  <p className="section-label">Criticality</p>
                  <ScoreProvenanceInfo data={asideCluster.provenance} label="How this criticality score was derived" />
                </div>
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(asideCluster.criticalScore * 100))}%` }} />
                  </div>
                  <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                    {(asideCluster.criticalScore * 100).toFixed(0)}%
                  </span>
                </div>
                {/* The full derivation, inline rather than only in the tooltip:
                    this is the number the bar draws, and "average of 9 members,
                    top contributor at 71" is the difference between a reader
                    trusting it and a reader guessing at it. */}
                <div className="mb-3 rounded-md border border-border bg-muted/30 px-2.5 py-2">
                  <ScoreProvenance data={asideCluster.provenance} />
                </div>

                {/* Counts belong in a chip, with their derivation on hover —
                    "Files" was wrong here too, since `members` holds symbol,
                    config and schema nodes and a Database Schema cluster listed
                    48 tables under a heading calling them files. */}
                <div className="mb-1.5 flex items-center gap-1.5">
                  <p className="section-label">Made of</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className="cursor-help rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-muted-foreground"
                      >
                        {(() => {
                          const { count, noun } = clusterSize(asideCluster);
                          return `${count} ${noun}${count === 1 ? "" : "s"}`;
                        })()}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-left">
                      {clusterCountDerivation(asideCluster)}
                    </TooltipContent>
                  </Tooltip>
                </div>
                {/* The graph beside this is the same list, opened. These links
                    stay as the cross-tab escape hatch into Dependencies. */}
                <ul className="space-y-0.5">
                  {asideCluster.members.slice(0, MAX_LISTED_MEMBERS).map((m) => (
                    <li key={m.key} className="truncate font-mono text-[0.71875rem]" title={m.filePath ?? m.key}>
                      <Link
                        to={`/projects/${id}/dependencies?focus=${encodeURIComponent(m.filePath ?? m.key)}`}
                        className="text-muted-foreground hover:text-primary hover:underline"
                      >
                        {m.filePath ?? m.key}
                      </Link>
                    </li>
                  ))}
                  {asideCluster.members.length > MAX_LISTED_MEMBERS && (
                    <li className="text-[0.6875rem] text-muted-foreground/70">
                      + {asideCluster.members.length - MAX_LISTED_MEMBERS} more
                    </li>
                  )}
                </ul>
              </aside>
            )}

            {selectedMember && (
              <aside className="graph-canvas overflow-y-auto !bg-card p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-foreground" title={selectedMember.label}>
                      {selectedMember.label}
                    </h2>
                    <p className="truncate font-mono text-[0.65625rem] text-muted-foreground" title={selectedMember.filePath ?? undefined}>
                      {selectedMember.filePath ?? selectedMember.id}
                    </p>
                  </div>
                  <Button variant="ghost" size="xs" onClick={() => setSelectedId(null)} aria-label="Close details">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="mb-1.5 flex items-center gap-1.5">
                  <p className="section-label">Criticality</p>
                  <ScoreProvenanceInfo data={selectedMember.provenance} label="How this criticality score was derived" />
                </div>
                <div className="mb-3 rounded-md border border-border bg-muted/30 px-2.5 py-2">
                  <ScoreProvenance data={selectedMember.provenance} />
                </div>

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
