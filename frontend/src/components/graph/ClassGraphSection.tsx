import { AlertTriangle, ChevronRight, CornerLeftUp, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Viewport } from "reactflow";
import { DependencyGraphView } from "@/components/graph/DependencyGraphView";
import { MINIMAP_MIN_NODES } from "@/components/graph/GraphCanvas";
import { GraphToolbar, SEARCH_DEBOUNCE_MS } from "@/components/graph/GraphToolbar";
import { NodeInfoPanel } from "@/components/graph/NodeInfoPanel";
import { PageSpinner } from "@/components/ui/page-spinner";
import { Button } from "@/components/ui/button";
import { fetchClassGraph, fetchNodeDetail, type GraphResponse, type NodeDetail } from "@/lib/graphData";
import { capEdgesPerNode, layoutDependencyGraph } from "@/lib/graphLayout";
import { autoDrillEnabled } from "@/lib/graphPrefs";
import { cn } from "@/lib/utils";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useLocalDrillStack } from "@/hooks/useDrillStack";
import { useGraphDrill } from "@/hooks/useGraphDrill";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useOptionalPackages } from "@/contexts/PackagesContext";
import { useOptionalProject } from "@/contexts/ProjectContext";
import type { DrillFrame } from "@/lib/drillStack";
import type { GraphEdge, GraphNode } from "@/types/graph";

interface ClassGraphSectionProps {
  projectId: string;
  /**
   * Stable key of a class/interface to open focused, handed over from the
   * Files view's "See inheritance". This graph is project-wide, so the
   * hand-off is a view switch, not a drill — but the reader still has to land
   * on the symbol they clicked rather than on the whole graph.
   */
  focusNodeId?: string | null;
}

/** The directory a group node stands for (`cluster:backend/src` → `backend/src`). */
function groupDirectory(nodeId: string): string {
  return nodeId.slice("cluster:".length);
}

/** True when `stableKey` (`<path>#<Name>`) lives under the group's directory. */
function groupContains(nodeId: string, stableKey: string): boolean {
  const dir = groupDirectory(nodeId);
  const path = stableKey.split("#")[0] ?? stableKey;
  return path === dir || path.startsWith(`${dir}/`);
}

/**
 * Classes and interfaces, as a two-level ladder rather than one flat grid.
 *
 * VISUAL QA M4 #3 measured the flat version on OnboardBuddy: 267 chips, ~3px
 * labels, 5 edges and a legend sitting on top of the first two columns — a
 * canvas that draws everything and can be read nowhere, and where nothing said
 * what any class DOES. Above the node cap the server now groups by directory
 * (the same rule, ids and gestures as the Files view) and every class card
 * carries its stored one-line summary where one exists.
 */
export function ClassGraphSection({ projectId, focusNodeId = null }: ClassGraphSectionProps) {
  const selectedPackageId = useOptionalPackages()?.selectedPackageId ?? null;
  const project = useOptionalProject()?.project ?? null;
  const githubRepo =
    project?.repo_owner && project?.repo_name && project?.branch
      ? { owner: project.repo_owner, repo: project.repo_name, branch: project.branch }
      : undefined;
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The raw box value feeds the union-find/layout memo, so it has to settle first.
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS, "");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeDetail, setSelectedNodeDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** True when the handed-over symbol is not in this graph — say so rather
   * than silently showing the unfocused graph as if nothing was asked. */
  const [focusMissing, setFocusMissing] = useState(false);

  // Local rather than URL-backed: the Files ladder on this same page already
  // owns `?drill=` and the history state that carries drill depth and saved
  // viewports, and a second URL-backed stack would overwrite both (see
  // useLocalDrillStack).
  const stack = useLocalDrillStack();
  const currentFrame: DrillFrame | null = stack.current;
  const viewportRef = useRef<(() => Viewport) | null>(null);
  const pendingFocusDrillRef = useRef<string | null>(null);
  const levelKey = (frame: DrillFrame | null) =>
    `${projectId}::${selectedPackageId ?? ""}::${frame?.id ?? ""}::${focusNodeId ?? ""}`;
  const loadedKeyRef = useRef<string | null>(null);
  // `loadedKeyRef` guards refetching, not staleness: two loads can be in flight and
  // response order is not selection order.
  const loadRunRef = useRef(0);

  const loadLevel = useCallback(
    async (frame: DrillFrame | null): Promise<void> => {
      const myRun = ++loadRunRef.current;
      const live = () => loadRunRef.current === myRun;
      setLoading(true);
      setError("");
      setSelectedNodeId(null);
      setFocusMissing(false);
      try {
        const d = await fetchClassGraph(projectId, selectedPackageId, frame?.id ?? null);
        if (!live()) return;
        setData(d);
        loadedKeyRef.current = levelKey(frame);
        if (!focusNodeId) return;
        if (d.graph.nodes.some((n) => n.id === focusNodeId)) {
          setSelectedNodeId(focusNodeId);
          return;
        }
        // Not on this canvas: if a group here covers it, that group is the
        // next hop. Asking the returned nodes rather than recomputing the
        // server's directory rule keeps this working however deep it regroups.
        const owning = d.graph.nodes.find((n) => n.id.startsWith("cluster:") && groupContains(n.id, focusNodeId));
        if (owning) {
          pendingFocusDrillRef.current = groupDirectory(owning.id);
          return;
        }
        setFocusMissing(true);
      } catch (err) {
        if (live()) setError(err instanceof Error ? err.message : "Failed to load class graph data");
        throw err;
      } finally {
        if (live()) setLoading(false);
      }
    },
    [projectId, selectedPackageId, focusNodeId],
  );

  const drill = useGraphDrill({
    stack,
    loadLevel,
    readViewport: () => viewportRef.current?.() ?? null,
  });

  // A project or package switch invalidates a directory path built from
  // another snapshot's layout, so it resets to the root rather than carrying
  // a stale one across.
  const prevKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${projectId}::${selectedPackageId ?? ""}`;
    const changed = prevKeyRef.current !== null && prevKeyRef.current !== key;
    prevKeyRef.current = key;
    if (changed && stack.depth > 0) {
      stack.reset();
      return;
    }
    // A drill already fetched this level before moving the stack; refetching
    // here would double-request and clobber the transition mid-flight.
    if (loadedKeyRef.current === levelKey(currentFrame)) return;
    void loadLevel(currentFrame).catch(() => {});
  }, [projectId, selectedPackageId, focusNodeId, currentFrame?.id]);

  // A handed-over symbol that lives inside a group needs one drill to become
  // reachable. Done as an effect so it runs after the load that discovered it.
  useEffect(() => {
    const target = pendingFocusDrillRef.current;
    if (!target) return;
    pendingFocusDrillRef.current = null;
    stack.push({ kind: "cluster", id: target, label: target.split("/").filter(Boolean).pop() ?? target });
  }, [data]);

  const nodes: GraphNode[] = useMemo(() => {
    if (!data) return [];
    return data.graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      // A class id is `<path>#<Name>`, so the path is recoverable even from a
      // response that predates the explicit field.
      filePath: n.filePath ?? (n.id.includes("#") ? n.id.slice(0, n.id.indexOf("#")) : undefined),
      metadata: {
        exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
        importCount: (n.metadata?.importCount as number) ?? 0,
        dependentCount: (n.metadata?.dependentCount as number) ?? 0,
        // What this class does, from its stored symbol record.
        summary: (n.metadata?.summary as string | null) ?? null,
        summaryConfidence: (n.metadata?.summaryConfidence as string | null) ?? null,
        // Most class records are facts-only restatements, so the card's
        // fallback line is the common case here — see ModuleNode.
        factsOnly: (n.metadata?.factsOnly as boolean | null) ?? null,
        fileCount: (n.metadata?.fileCount as number) ?? undefined,
        groupNoun: (n.metadata?.groupNoun as string) ?? undefined,
        internalImportCount: (n.metadata?.internalImportCount as number) ?? undefined,
      },
    }));
  }, [data]);

  const edges: GraphEdge[] = useMemo(() => {
    if (!data) return [];
    return data.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, kind: e.kind }));
  }, [data]);

  /**
   * What the panel's Called by / Calls rows can actually reach. This canvas
   * draws classes and interfaces only, so most of a class's callees are plain
   * functions with no node here at all, and a grouped level folds the rest into
   * folder boxes. Rows outside the set stay plain text (with the full key on
   * hover) rather than turning into buttons that would do nothing — unlike the
   * Files ladder, which drills to reach anything it is asked for.
   */
  const drawnNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  // The panel's own content: the class's summary, score, receipts and the
  // symbols that call it. This view never fetched it, which is why selecting a
  // class produced a panel reading "No additional details available".
  useEffect(() => {
    setSelectedNodeDetail(null);
    if (!selectedNodeId || selectedNodeId.startsWith("cluster:")) return;
    setDetailLoading(true);
    let cancelled = false;
    fetchNodeDetail(projectId, selectedNodeId, selectedPackageId)
      .then((detail) => { if (!cancelled) setSelectedNodeDetail(detail); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, selectedNodeId, selectedPackageId]);

  const filteredNodeIds = useMemo(() => {
    const query = search.trim().toLowerCase();
    return new Set(
      nodes
        .filter((node) => {
          if (!query) return true;
          return (
            node.label.toLowerCase().includes(query) ||
            node.id.toLowerCase().includes(query) ||
            (node.metadata.summary ?? "").toLowerCase().includes(query) ||
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
  const visibleEdges = useMemo(
    () => capEdgesPerNode(edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target))),
    [edges, filteredNodeIds],
  );
  const positionedNodes = useMemo(
    () => layoutDependencyGraph(visibleNodes, visibleEdges, []),
    [visibleNodes, visibleEdges],
  );

  /**
   * ← / → cycle what is drawn, Esc deselects. Folder boxes included: this
   * canvas selects them like the Files tab does, and excluding them left the
   * shortcut dead on any grouped level — which is every level of a repo with
   * more classes than fit. Drawn nodes, not all of them, so a search cannot
   * cycle into a box that is not on screen.
   */
  const cycleIds = useMemo(() => positionedNodes.map((n) => n.id), [positionedNodes]);
  useHotkeys(
    {
      ArrowRight: () => cycleIds.length > 0 && setSelectedNodeId((prev) => cycleIds[(cycleIds.indexOf(prev ?? "") + 1 + cycleIds.length) % cycleIds.length] ?? null),
      ArrowLeft: () => cycleIds.length > 0 && setSelectedNodeId((prev) => cycleIds[(cycleIds.indexOf(prev ?? "") - 1 + cycleIds.length) % cycleIds.length] ?? null),
      Escape: () => setSelectedNodeId(null),
    },
    !!data && !loading,
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const truncation = data?.truncation ?? null;
  const groupNodes = useMemo(() => nodes.filter((n) => n.id.startsWith("cluster:")), [nodes]);
  const groupCount = groupNodes.length;
  const classCount = nodes.length - groupCount;
  const describedNodes = data?.describedNodes ?? 0;
  const levelUnit = data?.level?.unit ?? (data?.clustered ? "groups" : "classes");

  /**
   * Open a folder. One entry point for the canvas gesture and the explicit
   * buttons below it, so both can never drift apart.
   */
  const openFolder = useCallback(
    (nodeId: string) => {
      const path = groupDirectory(nodeId);
      drill.drillInto(
        { kind: "cluster", id: path, label: path.split("/").filter(Boolean).pop() ?? path },
        nodeId,
      );
    },
    [drill],
  );

  // Only the FIRST load blanks the section. A drill used to run
  // `setLoading(true)` and swap the whole subtree for a spinner, which tears
  // down the React Flow instance (and DrillCamera, and the viewport probe)
  // in the middle of the transition it is supposed to be animating, then
  // mounts a fresh one that re-applies node selection — re-entering
  // `activate()` and re-triggering the drill. Keeping the previous level on
  // screen while the child loads makes the transition what it claims to be.
  if (loading && !data) {
    return (
      <PageSpinner className="py-20" label="Loading classes and interfaces" />
    );
  }

  if (error || !data || nodes.length === 0) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            {error ||
              (currentFrame
                ? `No classes or interfaces in ${currentFrame.label}`
                : "No class or interface data available")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {currentFrame && !error
              ? "This folder came back empty. It may have been renamed or removed since this link was made."
              : "The class graph is built from classes and interfaces found during analysis. Run a (re-)analysis first: snapshots from before this feature have no class data."}
          </p>
        </div>
        {currentFrame && !error && (
          <Button variant="outline" size="xs" onClick={drill.drillUp} disabled={drill.busy}>
            <CornerLeftUp className="mr-1 h-3 w-3" />
            Back
          </Button>
        )}
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            loadedKeyRef.current = null;
            void loadLevel(currentFrame).catch(() => {});
          }}
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Where in the class ladder this level is. The page header's breadcrumb
          tracks the FILES drill, so without this the only path shown on screen
          belonged to another view (VISUAL QA M4 #3: "breadcrumb still claims a
          file context"). */}
      <div className="mb-2 flex flex-wrap items-baseline gap-1.5 text-xs text-muted-foreground">
        <nav aria-label="Class graph levels" className="flex flex-wrap items-baseline gap-1.5">
          <button
            type="button"
            className="rounded-sm transition-colors hover:text-primary disabled:opacity-50"
            onClick={() => drill.jumpTo(-1)}
            disabled={drill.busy || stack.depth === 0}
          >
            All classes
          </button>
          {stack.frames.map((frame, i) => {
            const isLast = i === stack.frames.length - 1;
            return (
              <span key={`${frame.kind}:${frame.id}`} className="flex items-baseline gap-1.5">
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
        </nav>
        {stack.depth > 0 && (
          <Button variant="outline" size="xs" onClick={drill.drillUp} disabled={drill.busy} className="ml-1">
            <CornerLeftUp className="mr-1 h-3 w-3" />
            Back
          </Button>
        )}
      </div>

      {focusNodeId && !focusMissing && (
        <p className="mb-2 text-xs text-muted-foreground">
          Focused on <code className="font-mono">{focusNodeId.split("#").pop()}</code>. This graph is
          project-wide: extends/implements relationships cross files, so it is a separate view rather than a
          level inside the file you came from.
        </p>
      )}
      {focusMissing && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="flex-1 text-foreground">
            <code className="font-mono">{focusNodeId}</code> is not in the class graph for this snapshot.
            Showing the whole graph instead.
          </span>
        </div>
      )}

      {/* What this level is, and what a click will give you. */}
      <p className="mb-2 text-xs text-muted-foreground">
        {data.clustered ? (
          <>
            {currentFrame
              ? `${currentFrame.label} holds ${data.totalNodes} classes, showing ${groupCount} subfolder${groupCount === 1 ? "" : "s"}${classCount > 0 ? ` and ${classCount} class${classCount === 1 ? "" : "es"}` : ""}. `
              : `${data.totalNodes} classes and interfaces, too many to draw at once, so this shows ${groupCount} folder${groupCount === 1 ? "" : "s"}. `}
            {groupCount > 0
              ? "Open a folder below, or select its box and use the Open button in its details panel, to see its classes, each with a line saying what it does. "
              : "Each class card carries a line saying what it does. "}
            Arrows are extends/implements links crossing a folder boundary.
          </>
        ) : (
          <>
            {currentFrame ? `Classes and interfaces in ${currentFrame.label}` : "Classes and interfaces in this project"}
            : arrows are extends/implements links, so a class with none stands alone.{" "}
            {describedNodes > 0
              ? `${describedNodes} of ${classCount} carry a generated description; the rest were recorded by name and kind only, which the card already shows.`
              : "None of them carry a generated description in this snapshot; the cards show where each one is declared."}{" "}
            Click one for its score, callers and receipts.
          </>
        )}
      </p>

      {/* Every folder on this level as a real, focusable control.
          VISUAL QA M4 #8 measured the canvas-only version on OnboardBuddy:
          267 classes collapse to two folder boxes, and a React Flow node is
          only ever a `<div>` with a click handler — it carries no control of
          its own, it is unreachable by keyboard whenever the canvas freezes
          input, and nothing on screen looks pressable. Since the ladder is
          the only route to a class on a big repo, the route cannot depend on
          the canvas behaving: the same drill is also spelled out here.
          Mirrors Architecture's "Open N files ›" (owner I1). */}
      {data.clustered && groupNodes.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {groupNodes.map((group) => {
            const path = groupDirectory(group.id);
            const count = group.metadata.fileCount ?? 0;
            const noun = group.metadata.groupNoun ?? "classes";
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => openFolder(group.id)}
                disabled={drill.busy}
                aria-label={`Open ${path} and list its ${count} ${noun}`}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[0.6875rem] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <span className="font-mono">{path}/</span>
                <span className="tabular-nums text-muted-foreground">
                  {count} {noun}
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}

      {/* A drill that failed used to do so in complete silence: the hook
          recorded the reason and nobody rendered it, so a dead level and an
          ignored click looked identical. */}
      {drill.error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="flex-1 text-foreground">{drill.error}</span>
        </div>
      )}

      {/* The cap, disclosed (AUDIT C14) rather than left as a silent cut. */}
      {truncation && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="flex-1 text-foreground">
            Showing {truncation.shown} of {truncation.total} {truncation.unit}
            {currentFrame ? ` in ${currentFrame.label}` : ""}, {truncation.hidden} not drawn. A single view is
            capped at {truncation.limit} nodes, so this kept {truncation.keptBy}. Search to reach the rest.
          </span>
        </div>
      )}

      <GraphToolbar
        search={searchInput}
        onSearchChange={setSearchInput}
        matchCount={visibleNodes.length}
        totalCount={nodes.length}
        noun={levelUnit}
        extra={
          truncation
            ? `${truncation.hidden} more not drawn`
            : `${data.totalEdges} inheritance link${data.totalEdges === 1 ? "" : "s"}`
        }
      />

      <div className={selectedNode ? "grid gap-3 lg:grid-cols-[1fr_340px]" : ""}>
        {/* Dimmed rather than blanked while the next level loads — see the
            first-load guard above. */}
        <div
          className={cn("graph-canvas transition-opacity", (loading || drill.busy) && "opacity-70")}
          aria-busy={loading || drill.busy}
        >
          <DependencyGraphView
            nodes={positionedNodes}
            edges={visibleEdges}
            entryPoints={[]}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            // Arriving from "See inheritance" is like a deep link: the reader
            // chose no viewport here, so the handed-over symbol is framed.
            suppressInitialFit={!!focusNodeId}
            focusMode={focusNodeId ? "frame" : "pan-into-view"}
            drill={drill}
            restoreViewport={stack.savedViewport(stack.depth)}
            viewportRef={viewportRef}
            hintVariant="classes"
            // Never fit below a readable label (VISUAL QA M4 #3 measured 3px).
            minZoom={0.35}
            // Two folder boxes do not need a map of themselves in the corner
            // they are drawn next to.
            showMiniMap={positionedNodes.length >= MINIMAP_MIN_NODES}
            // Same click model as the Files tab it shares a page with: a click
            // selects the folder box and the panel explains it, the Open button
            // (in that panel, or in the chip row above) navigates. The
            // Dependencies preference governs both — one page, one gesture.
            onDrillInto={(nodeId) => {
              if (!nodeId.startsWith("cluster:") || !autoDrillEnabled("dependencies", projectId)) return false;
              openFolder(nodeId);
              return true;
            }}
          />
        </div>

        {selectedNode && (
          <aside className="graph-canvas overflow-y-auto !bg-card">
            <NodeInfoPanel
              node={selectedNode}
              detail={selectedNodeDetail}
              loading={detailLoading}
              githubRepo={githubRepo}
              onClose={() => setSelectedNodeId(null)}
              onFocusNode={(target) => setSelectedNodeId(target.stableKey)}
              canFocusNode={(target) => drawnNodeIds.has(target.stableKey)}
              onOpenGroup={
                selectedNode.id.startsWith("cluster:") ? () => openFolder(selectedNode.id) : undefined
              }
            />
          </aside>
        )}
      </div>
    </>
  );
}
