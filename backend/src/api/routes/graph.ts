import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { resolveForRequest } from "../services/packageResolver.js";
import { buildCandidateProvenance, buildMeanProvenance } from "../services/scoreProvenance.js";
import { loadClusterNarratives } from "../../worker/engine/architectureClusterer.js";

export const graphRouter = Router({ mergeParams: true });

const MAX_GRAPH_NODES = 60;

/**
 * The symbol node types a source file declares — the bottom rung of the
 * Dependencies ladder (cluster → nested cluster → file → symbols). Method
 * nodes are included so a class-heavy file shows its members rather than one
 * opaque class box.
 */
const SYMBOL_NODE_TYPES = ["function", "method", "class", "interface", "type", "enum", "variable"];

export interface GraphTruncation {
  shown: number;
  total: number;
  hidden: number;
  limit: number;
  unit: "groups" | "files" | "symbols" | "groups and files";
  /** The rule that picked the survivors, in the reader's words. */
  keptBy: string;
  /** Where the rest can still be reached, or null when nowhere. */
  seeRest: string | null;
}

/**
 * Every level of this graph is capped at MAX_GRAPH_NODES, and below the root
 * the cap used to be silent: drilling into a 107-file group drew 60 files and
 * the toolbar said "60 / 60 files", so the reader had no way to know 47 were
 * missing. A level that hides part of itself has to say so — with the real
 * numbers and the rule that chose what stayed.
 */
function truncationNotice(opts: {
  shown: number;
  total: number;
  unit: GraphTruncation["unit"];
  keptBy: string;
  seeRest?: string | null;
}): GraphTruncation | null {
  if (opts.shown >= opts.total) return null;
  return {
    shown: opts.shown,
    total: opts.total,
    hidden: opts.total - opts.shown,
    limit: MAX_GRAPH_NODES,
    unit: opts.unit,
    keptBy: opts.keptBy,
    seeRest: opts.seeRest ?? null,
  };
}

/** Segments of a repo-relative path; `.` is the repo root, which has none. */
function pathSegments(p: string): string[] {
  return p === "." ? [] : p.split("/").filter(Boolean);
}

/**
 * Symbols declared per file. The file → symbols rung must only be offered
 * where there is something below it: a node that opens an empty level is
 * worse than a node that opens nothing.
 */
async function symbolCountsByFile(snapshotId: string, filePaths: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (filePaths.length === 0) return counts;
  const result = await query(
    `SELECT file_path, count(*)::int AS symbols
     FROM graph_nodes
     WHERE snapshot_id = $1 AND type = ANY($2) AND file_path = ANY($3)
     GROUP BY file_path`,
    [snapshotId, SYMBOL_NODE_TYPES, filePaths],
  );
  for (const r of result.rows as Array<{ file_path: string; symbols: number }>) {
    counts.set(r.file_path, r.symbols);
  }
  return counts;
}

graphRouter.get("/dependencies", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const cluster = req.query.cluster as string | undefined;
    const file = req.query.file as string | undefined;

    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    const snapshotId = ctx?.snapshotId ?? null;
    if (!snapshotId) {
      res.status(404).json({ error: "No completed analysis snapshot found" });
      return;
    }

    // ── file → symbols ────────────────────────────────────────────────────
    // The bottom rung. Nothing new is computed: these are the symbol nodes
    // and the `calls` edges the analyzer already stored for this file.
    if (file) {
      const [symbolResult, symbolEdgeResult] = await Promise.all([
        query(
          `SELECT stable_key, type, name, exported, line_start
           FROM graph_nodes
           WHERE snapshot_id = $1 AND file_path = $2 AND type = ANY($3)`,
          [snapshotId, file, SYMBOL_NODE_TYPES],
        ),
        query(
          `SELECT e.id, e.type,
                  s.stable_key AS source_key, t.stable_key AS target_key
           FROM graph_edges e
           JOIN graph_nodes s ON s.id = e.source_node_id
           JOIN graph_nodes t ON t.id = e.target_node_id
           WHERE e.snapshot_id = $1
             AND e.type IN ('calls', 'contains', 'handles_route')
             AND (s.file_path = $2 OR t.file_path = $2)`,
          [snapshotId, file],
        ),
      ]);

      type SymbolRow = { stable_key: string; type: string; name: string; exported: boolean; line_start: number | null };
      type SymbolEdgeRow = { id: string; type: string; source_key: string; target_key: string };
      const symbols = symbolResult.rows as SymbolRow[];
      const symbolEdges = symbolEdgeResult.rows as SymbolEdgeRow[];
      const symbolKeys = new Set(symbols.map((s) => s.stable_key));

      // Call counts are project-wide: a function called from another file is
      // still called, and counting only what fits on this canvas would make
      // the file look more isolated than it is. The DRAWN edges are the
      // intra-file subset, because an edge to a symbol that is not here has
      // nothing to attach to.
      const callsOut = new Map<string, number>();
      const callsIn = new Map<string, number>();
      const entryPoints = new Set<string>();
      for (const e of symbolEdges) {
        if (e.type === "calls") {
          if (symbolKeys.has(e.source_key)) callsOut.set(e.source_key, (callsOut.get(e.source_key) ?? 0) + 1);
          if (symbolKeys.has(e.target_key)) callsIn.set(e.target_key, (callsIn.get(e.target_key) ?? 0) + 1);
        } else if (e.type === "handles_route" && symbolKeys.has(e.target_key)) {
          // file -> handler symbol: the route handlers of this file.
          entryPoints.add(e.target_key);
        }
      }

      const degree = (key: string) => (callsOut.get(key) ?? 0) + (callsIn.get(key) ?? 0);
      symbols.sort(
        (a, b) => degree(b.stable_key) - degree(a.stable_key) || (a.line_start ?? 0) - (b.line_start ?? 0),
      );
      const keptSymbols = symbols.slice(0, MAX_GRAPH_NODES);
      const keptKeys = new Set(keptSymbols.map((s) => s.stable_key));

      // `contains` here is class -> method only; the file -> symbol contains
      // edge has the module node as its source, which is not on this canvas.
      const inFileEdges = symbolEdges.filter(
        (e) => e.type !== "handles_route" && symbolKeys.has(e.source_key) && symbolKeys.has(e.target_key),
      );

      res.json({
        projectId,
        snapshotId,
        clustered: false,
        level: { kind: "file", id: file, unit: "symbols" },
        totalNodes: symbols.length,
        totalEdges: inFileEdges.length,
        truncation: truncationNotice({
          shown: keptSymbols.length,
          total: symbols.length,
          unit: "symbols",
          keptBy: "the symbols with the most calls in and out",
          seeRest: "Open the file on GitHub to read the rest.",
        }),
        graph: {
          nodes: keptSymbols.map((s) => ({
            id: s.stable_key,
            label: s.name,
            kind: s.type,
            metadata: {
              exportedSymbols: [],
              // Symbols relate by CALLS, not imports — the same distinction
              // /nodes/:nodeId draws with `relation_labels`.
              importCount: callsOut.get(s.stable_key) ?? 0,
              externalImportCount: 0,
              dependentCount: callsIn.get(s.stable_key) ?? 0,
              symbolCount: 0,
              exported: s.exported,
              lineStart: s.line_start,
            },
          })),
          edges: inFileEdges
            .filter((e) => keptKeys.has(e.source_key) && keptKeys.has(e.target_key))
            .map((e) => ({ id: e.id, source: e.source_key, target: e.target_key, kind: e.type, weight: 1 })),
          entryPoints: [...entryPoints].filter((k) => keptKeys.has(k)),
        },
        fileAnalyses: [],
      });
      return;
    }

    // File-level view: module nodes and import edges only (class/interface
    // nodes live in /classes)
    const [nodesResult, edgesResult] = await Promise.all([
      query(
        `SELECT id, stable_key, type, name, file_path, metadata
         FROM graph_nodes WHERE snapshot_id = $1 AND type = 'module'`,
        [snapshotId],
      ),
      query(
        `SELECT e.id, e.source_node_id, e.target_node_id, e.type,
                COALESCE((e.metadata->>'weight')::numeric, 1) AS weight
         FROM graph_edges e
         WHERE e.snapshot_id = $1 AND e.type NOT IN ('extends', 'implements')`,
        [snapshotId],
      ),
    ]);

    type NodeRow = { id: string; stable_key: string; type: string; name: string; file_path: string; metadata: Record<string, unknown> };
    type EdgeRow = { id: string; source_node_id: string; target_node_id: string; type: string; weight: string | number };

    const allNodes = nodesResult.rows as NodeRow[];
    const allEdges = edgesResult.rows as EdgeRow[];

    const nodeIdToKey = new Map<string, string>();
    for (const n of allNodes) nodeIdToKey.set(n.id, n.stable_key);

    // File-level edges only. The edge query deliberately keeps symbol-level
    // rows (calls/contains) because the endpoint filter below discards them —
    // but counting them as "edges" is what made the header badge claim
    // thousands of dependencies that were never drawn.
    const fileEdges = allEdges.filter(
      (e) => nodeIdToKey.has(e.source_node_id) && nodeIdToKey.has(e.target_node_id),
    );

    // If too many nodes, cluster by 2-level directory path
    if (allNodes.length > MAX_GRAPH_NODES && !cluster) {
      const dirMap = new Map<string, { count: number; importCount: number; keys: string[] }>();

      for (const n of allNodes) {
        const parts = n.file_path.split('/');
        const dir = parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts.length > 1 ? parts[0]! : '.';
        const existing = dirMap.get(dir) ?? { count: 0, importCount: 0, keys: [] };
        existing.count++;
        existing.importCount += ((n.metadata?.importCount as number) ?? 0);
        existing.keys.push(n.stable_key);
        dirMap.set(dir, existing);
      }

      const clusterNodes = Array.from(dirMap.entries())
        .sort((a, b) => b[1].importCount - a[1].importCount)
        .slice(0, MAX_GRAPH_NODES)
        .map(([dir, info]) => ({
          id: `cluster:${dir}`,
          label: `${dir}/ (${info.count} files)`,
          kind: "cluster" as const,
          metadata: {
            exportedSymbols: [] as string[],
            importCount: info.importCount,
            dependentCount: 0,
            fileCount: info.count,
            directory: dir,
          },
        }));

      // Build cluster-level edges
      const keyToDir = new Map<string, string>();
      for (const [dir, info] of dirMap) {
        for (const key of info.keys) keyToDir.set(key, dir);
      }

      const clusterEdgeSet = new Set<string>();
      const clusterEdges: Array<{ id: string; source: string; target: string; kind: string }> = [];
      for (const e of allEdges) {
        const sourceKey = nodeIdToKey.get(e.source_node_id);
        const targetKey = nodeIdToKey.get(e.target_node_id);
        if (!sourceKey || !targetKey) continue;
        const sourceDir = keyToDir.get(sourceKey);
        const targetDir = keyToDir.get(targetKey);
        if (!sourceDir || !targetDir || sourceDir === targetDir) continue;
        const edgeKey = `${sourceDir}->${targetDir}`;
        if (!clusterEdgeSet.has(edgeKey)) {
          clusterEdgeSet.add(edgeKey);
          clusterEdges.push({
            id: edgeKey,
            source: `cluster:${sourceDir}`,
            target: `cluster:${targetDir}`,
            kind: "dependency",
          });
        }
      }

      const clusterNodeIds = new Set(clusterNodes.map((n) => n.id));
      const filteredClusterEdges = clusterEdges.filter(
        (e) => clusterNodeIds.has(e.source) && clusterNodeIds.has(e.target),
      );

      res.json({
        projectId,
        snapshotId,
        clustered: true,
        level: { kind: "root", id: null, unit: "groups" },
        totalNodes: allNodes.length,
        // File-to-file edges, not every edge in the snapshot. `allEdges`
        // includes calls/contains rows that are dropped before drawing, so
        // this number used to be several times what the canvas showed.
        totalEdges: fileEdges.length,
        truncation: truncationNotice({
          shown: clusterNodes.length,
          total: dirMap.size,
          unit: "groups",
          keptBy: "the groups whose files make the most imports",
          seeRest: null,
        }),
        graph: { nodes: clusterNodes, edges: filteredClusterEdges, entryPoints: [] },
        fileAnalyses: [],
      });
      return;
    }

    // Files at this level. Prefix-matching the PATH (rather than a 2-segment
    // directory key) is what lets a nested group such as `backend/src/worker`
    // inside `backend/src` resolve to its own files at all — the old rule
    // compared against a key that is never longer than two segments, so a
    // deeper group matched nothing.
    let filteredNodes = allNodes;
    if (cluster) {
      filteredNodes = allNodes.filter((n) =>
        cluster === "."
          ? !n.file_path.includes("/")
          : n.file_path === cluster || n.file_path.startsWith(`${cluster}/`),
      );
    }
    const levelKeySet = new Set(filteredNodes.map((n) => n.stable_key));
    const levelEdges = fileEdges.filter(
      (e) =>
        levelKeySet.has(nodeIdToKey.get(e.source_node_id)!) &&
        levelKeySet.has(nodeIdToKey.get(e.target_node_id)!),
    );

    // ── nested cluster ────────────────────────────────────────────────────
    // A drilled group with more files than fit is regrouped one directory
    // level deeper instead of being cut. Cutting is what made 47 of
    // `backend/src`'s 107 files unreachable: the drilled level is flat, so
    // there was no smaller group left to open. Regrouping keeps every file
    // one click away.
    if (cluster && filteredNodes.length > MAX_GRAPH_NODES) {
      const groupDepth = pathSegments(cluster).length + 1;
      const subMap = new Map<string, { count: number; importCount: number; keys: string[] }>();
      const loose: NodeRow[] = [];
      for (const n of filteredNodes) {
        const parts = pathSegments(n.file_path);
        // A file sitting directly in this directory has no deeper group to
        // join; it stays a file node alongside the groups.
        if (parts.length <= groupDepth) { loose.push(n); continue; }
        const dir = parts.slice(0, groupDepth).join("/");
        const info = subMap.get(dir) ?? { count: 0, importCount: 0, keys: [] };
        info.count++;
        info.importCount += (n.metadata?.importCount as number) ?? 0;
        info.keys.push(n.stable_key);
        subMap.set(dir, info);
      }
      // A group holding one file is a click that reveals that one file —
      // promote it back rather than making the reader open it to find out.
      const keyToNode = new Map(filteredNodes.map((n) => [n.stable_key, n]));
      for (const [dir, info] of [...subMap]) {
        if (info.count > 1) continue;
        const only = keyToNode.get(info.keys[0]!);
        if (only) loose.push(only);
        subMap.delete(dir);
      }

      // Only worth it if it actually shrinks the level; a directory whose
      // files are all loose regroups into itself and must fall through to
      // the capped list (with the cut disclosed) instead.
      if (subMap.size > 0 && subMap.size + loose.length < filteredNodes.length) {
        loose.sort(
          (a, b) => ((b.metadata?.importCount as number) ?? 0) - ((a.metadata?.importCount as number) ?? 0),
        );
        const subClusters = [...subMap.entries()]
          .sort((a, b) => b[1].importCount - a[1].importCount)
          .map(([dir, info]) => ({
            id: `cluster:${dir}`,
            label: `${dir.split("/").pop()}/ (${info.count} files)`,
            kind: "cluster" as const,
            metadata: {
              exportedSymbols: [] as string[],
              importCount: info.importCount,
              dependentCount: 0,
              fileCount: info.count,
              directory: dir,
            },
          }));
        // Loose files are real files, so they open their symbols like any
        // other — the count is what decides whether the rung exists.
        const looseCounts = await symbolCountsByFile(snapshotId, loose.map((n) => n.file_path));
        const looseNodes = loose.map((n) => ({
          id: n.stable_key,
          label: n.name,
          kind: n.type,
          metadata: {
            exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
            importCount: (n.metadata?.importCount as number) ?? 0,
            externalImportCount: (n.metadata?.externalImportCount as number) ?? 0,
            dependentCount: (n.metadata?.dependentCount as number) ?? 0,
            symbolCount: looseCounts.get(n.file_path) ?? 0,
          },
        }));
        const mixed = [...subClusters, ...looseNodes].slice(0, MAX_GRAPH_NODES);
        const keptIds = new Set(mixed.map((n) => n.id));

        // Every file key maps to the node that stands for it here: its group,
        // or itself when it is loose.
        const keyToNodeId = new Map<string, string>();
        for (const [dir, info] of subMap) for (const key of info.keys) keyToNodeId.set(key, `cluster:${dir}`);
        for (const n of loose) keyToNodeId.set(n.stable_key, n.stable_key);

        const seen = new Set<string>();
        const mixedEdges: Array<{ id: string; source: string; target: string; kind: string; weight: number }> = [];
        for (const e of levelEdges) {
          const s = keyToNodeId.get(nodeIdToKey.get(e.source_node_id)!);
          const t = keyToNodeId.get(nodeIdToKey.get(e.target_node_id)!);
          if (!s || !t || s === t || !keptIds.has(s) || !keptIds.has(t)) continue;
          const key = `${s}->${t}`;
          if (seen.has(key)) continue;
          seen.add(key);
          mixedEdges.push({ id: key, source: s, target: t, kind: "dependency", weight: 1 });
        }

        const unit: GraphTruncation["unit"] =
          subClusters.length > 0 && looseNodes.length > 0 ? "groups and files" : "groups";
        res.json({
          projectId,
          snapshotId,
          clustered: true,
          level: { kind: "cluster", id: cluster, unit },
          totalNodes: filteredNodes.length,
          totalEdges: levelEdges.length,
          truncation: truncationNotice({
            shown: mixed.length,
            total: subClusters.length + looseNodes.length,
            unit,
            keptBy: "the subfolders and files that make the most imports",
            seeRest: null,
          }),
          graph: { nodes: mixed, edges: mixedEdges, entryPoints: [] },
          fileAnalyses: [],
        });
        return;
      }
    }

    // Cap at MAX_GRAPH_NODES sorted by importance (importCount desc)
    filteredNodes.sort((a, b) => {
      const ai = (a.metadata?.importCount as number) ?? 0;
      const bi = (b.metadata?.importCount as number) ?? 0;
      return bi - ai;
    });
    const cappedNodes = filteredNodes.slice(0, MAX_GRAPH_NODES);
    const cappedKeySet = new Set(cappedNodes.map((n) => n.stable_key));

    const symbolCounts = await symbolCountsByFile(snapshotId, cappedNodes.map((n) => n.file_path));

    const nodes = cappedNodes.map((n) => ({
      id: n.stable_key,
      label: n.name,
      kind: n.type,
      metadata: {
        exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
        importCount: (n.metadata?.importCount as number) ?? 0,
        externalImportCount: (n.metadata?.externalImportCount as number) ?? 0,
        dependentCount: (n.metadata?.dependentCount as number) ?? 0,
        symbolCount: symbolCounts.get(n.file_path) ?? 0,
      },
    }));

    const edges = levelEdges
      .map((e) => ({
        id: e.id,
        source: nodeIdToKey.get(e.source_node_id) ?? '',
        target: nodeIdToKey.get(e.target_node_id) ?? '',
        kind: e.type,
        weight: Number(e.weight ?? 1),
      }))
      .filter((e) => e.source && e.target && cappedKeySet.has(e.source) && cappedKeySet.has(e.target));

    const entryPointSet = new Set<string>();
    for (const n of cappedNodes) {
      if (n.type === 'entrypoint' || n.file_path.includes('index.')) {
        entryPointSet.add(n.stable_key);
      }
    }

    res.json({
      projectId,
      snapshotId,
      clustered: false,
      level: { kind: cluster ? "cluster" : "root", id: cluster ?? null, unit: "files" },
      // Scoped to THIS level. Both numbers used to describe the whole
      // snapshot at every level, so a drilled group of 107 files reported
      // "227 files" in the header while drawing 60 of them.
      totalNodes: filteredNodes.length,
      totalEdges: levelEdges.length,
      truncation: truncationNotice({
        shown: cappedNodes.length,
        total: filteredNodes.length,
        unit: "files",
        keptBy: "the files that import the most other project files",
        seeRest: null,
      }),
      graph: { nodes, edges, entryPoints: Array.from(entryPointSet) },
      fileAnalyses: [],
    });
  } catch (err) {
    console.error("Graph dependencies error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Architecture map from the server-side deterministic clustering
// (architecture_clusters/-edges, Phase 3), enriched with the semantic module
// record summary where one exists. Replaces the old client-side grouping.
graphRouter.get("/architecture", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    // `?cluster=<stable_key>` is the drill level: the same component, opened.
    const drilledClusterKey = (req.query.cluster as string | undefined) || null;

    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    const snapshotId = ctx?.snapshotId ?? null;
    if (!snapshotId) {
      res.status(404).json({ error: "No completed analysis snapshot found" });
      return;
    }

    const [clustersResult, edgesResult, membersResult, recordsResult, memberScoresResult, narratives] = await Promise.all([
      query(
        `SELECT id, stable_key, label, kind, critical_score, deterministic_summary, metadata
         FROM architecture_clusters WHERE snapshot_id = $1
         ORDER BY critical_score DESC`,
        [snapshotId],
      ),
      query(
        `SELECT e.id, sc.stable_key AS source_key, tc.stable_key AS target_key, e.type, e.weight
         FROM architecture_edges e
         JOIN architecture_clusters sc ON sc.id = e.source_cluster_id
         JOIN architecture_clusters tc ON tc.id = e.target_cluster_id
         WHERE e.snapshot_id = $1`,
        [snapshotId],
      ),
      query(
        `SELECT c.stable_key AS cluster_key, gn.stable_key AS member_key, gn.name, gn.file_path
         FROM architecture_cluster_members m
         JOIN architecture_clusters c ON c.id = m.cluster_id
         JOIN graph_nodes gn ON gn.id = m.node_id
         WHERE c.snapshot_id = $1`,
        [snapshotId],
      ),
      query(
        `SELECT ssr.stable_key, sr.summary, sr.confidence
         FROM snapshot_semantic_records ssr
         JOIN semantic_records sr ON sr.id = ssr.record_id
         WHERE ssr.snapshot_id = $1 AND ssr.record_level = 'module'`,
        [snapshotId],
      ),
      // Member scores, so a cluster's criticality can show the average it
      // actually is. The clusterer averages candidate scores over the members
      // it saw; these are the ones still on the table (persistence keeps the
      // top 500 per snapshot), which is why the provenance says so when the
      // two disagree instead of presenting a tidier number than we have.
      query(
        `SELECT stable_key, score, score_breakdown, reasons FROM criticality_scores
         WHERE snapshot_id = $1 AND phase = 'candidate' AND view = 'candidate'
           AND role = 'general' AND target_type IN ('file', 'symbol')`,
        [snapshotId],
      ),
      // What each component is FOR, what crosses its boundary, and why it is
      // separate — derived from the same stored rows the `architecture_deep`
      // section reads, so the tab and the generated prose cannot disagree.
      loadClusterNarratives(snapshotId),
    ]);

    const membersByCluster = new Map<string, Array<{ key: string; name: string; filePath: string | null }>>();
    for (const m of membersResult.rows as Array<{ cluster_key: string; member_key: string; name: string; file_path: string | null }>) {
      if (!membersByCluster.has(m.cluster_key)) membersByCluster.set(m.cluster_key, []);
      membersByCluster.get(m.cluster_key)!.push({ key: m.member_key, name: m.name, filePath: m.file_path });
    }
    const recordByCluster = new Map(
      (recordsResult.rows as Array<{ stable_key: string; summary: string; confidence: string }>)
        .map((r) => [r.stable_key, r]),
    );
    type ScoreRow = { stable_key: string; score: string | number; score_breakdown: unknown; reasons: string[] | null };
    const rowByKey = new Map((memberScoresResult.rows as ScoreRow[]).map((r) => [r.stable_key, r]));
    const scoreByKey = new Map([...rowByKey].map(([key, r]) => [key, Number(r.score)]));

    const clusters = (clustersResult.rows as Array<{
      id: string; stable_key: string; label: string; kind: string;
      critical_score: string | number; deterministic_summary: string | null;
      metadata: Record<string, unknown>;
    }>).map((c) => {
      const members = membersByCluster.get(c.stable_key) ?? [];
      const scoredMembers = members
        .filter((m) => scoreByKey.has(m.key))
        .map((m) => ({ key: m.key, name: m.name, filePath: m.filePath, score: scoreByKey.get(m.key)! }));
      return {
        id: c.stable_key,
        label: c.label,
        kind: c.kind,
        criticalScore: Number(c.critical_score),
        // The bar in the UI is a mean; without this it was a bare percentage
        // whose only explanation was a tooltip describing a different ranking.
        provenance: buildMeanProvenance({
          label: "Criticality",
          score: Number(c.critical_score),
          scoredMembers,
          totalMemberCount: members.length,
          memberNoun: (c.metadata?.primaryMemberNoun as string) ?? "file",
        }),
        summary: recordByCluster.get(c.stable_key)?.summary ?? c.deterministic_summary ?? "",
        summarySource: recordByCluster.has(c.stable_key) ? "semantic" : "deterministic",
        confidence: recordByCluster.get(c.stable_key)?.confidence ?? null,
        // Responsibility / boundary / separation, always derived from stored
        // structure. The AI module summary above can be absent or stale; this
        // never is, and it is what the component card and aside actually read.
        narrative: narratives.get(c.stable_key) ?? null,
        members,
        metadata: c.metadata,
      };
    });

    const edges = (edgesResult.rows as Array<{
      id: string; source_key: string; target_key: string; type: string; weight: string | number;
    }>).map((e) => ({
      id: e.id,
      source: e.source_key,
      target: e.target_key,
      kind: e.type,
      weight: Number(e.weight),
    }));

    // ── The level beneath a component: the members it is actually made of ────
    // Without this a cluster could only be "opened" into a list of links to
    // another tab, so the map had exactly one level and the boxes on it were
    // unopenable. Everything the level needs comes from rows already loaded
    // above except the members' own metadata and the edges between them.
    let level: unknown = undefined;
    if (drilledClusterKey) {
      const target = clusters.find((c) => c.id === drilledClusterKey);
      if (!target) {
        res.status(404).json({ error: "No such component in this analysis" });
        return;
      }

      const memberKeys = target.members.map((m) => m.key);
      const [memberNodesResult, memberEdgesResult] = await Promise.all([
        query(
          `SELECT id, stable_key, type, name, file_path, metadata
           FROM graph_nodes
           WHERE snapshot_id = $1 AND stable_key = ANY($2::text[])
             AND type IN ('module', 'file', 'config', 'schema')`,
          [snapshotId, memberKeys],
        ),
        query(
          `SELECT e.id, s.stable_key AS source_key, t.stable_key AS target_key, e.type,
                  COALESCE((e.metadata->>'weight')::numeric, 1) AS weight
           FROM graph_edges e
           JOIN graph_nodes s ON s.id = e.source_node_id
           JOIN graph_nodes t ON t.id = e.target_node_id
           WHERE e.snapshot_id = $1
             AND s.stable_key = ANY($2::text[]) AND t.stable_key = ANY($2::text[])
             AND e.type NOT IN ('extends', 'implements')`,
          [snapshotId, memberKeys],
        ),
      ]);

      type MemberRow = {
        id: string; stable_key: string; type: string; name: string;
        file_path: string | null; metadata: Record<string, unknown> | null;
      };
      const allMembers = (memberNodesResult.rows as MemberRow[]).map((n) => {
        const row = rowByKey.get(n.stable_key);
        return {
          id: n.stable_key,
          label: n.name,
          kind: n.type,
          filePath: n.file_path,
          criticalScore: row ? Number(row.score) : null,
          // Per-file derivation, not the component's mean: inside a component
          // the question stops being "how critical is this box" and becomes
          // "which of these files is the one that matters".
          provenance: buildCandidateProvenance({
            label: "Criticality",
            score: row ? Number(row.score) : 0,
            breakdown: row?.score_breakdown,
            reasons: row?.reasons ?? [],
            targetType: "file",
            unavailableReason:
              "This file carries no stored criticality score. Tests and fixtures are excluded from ranking by design, and only the top 500 scores per snapshot are kept.",
          }),
          exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
          importCount: (n.metadata?.importCount as number) ?? 0,
          dependentCount: (n.metadata?.dependentCount as number) ?? 0,
        };
      });

      // Ranked before capping so the cap drops the least important members,
      // and the number dropped is reported rather than silently swallowed —
      // a graph that quietly hides 40 of a component's 61 files is worse than
      // one that says it did.
      allMembers.sort((a, b) =>
        (b.criticalScore ?? -1) - (a.criticalScore ?? -1) || b.dependentCount - a.dependentCount);
      const shown = allMembers.slice(0, MAX_GRAPH_NODES);
      const shownKeys = new Set(shown.map((n) => n.id));

      level = {
        clusterId: target.id,
        label: target.label,
        kind: target.kind,
        nodes: shown,
        edges: (memberEdgesResult.rows as Array<{
          id: string; source_key: string; target_key: string; type: string; weight: string | number;
        }>)
          .filter((e) => shownKeys.has(e.source_key) && shownKeys.has(e.target_key))
          .map((e) => ({
            id: e.id,
            source: e.source_key,
            target: e.target_key,
            kind: e.type,
            weight: Number(e.weight ?? 1),
          })),
        totalNodes: allMembers.length,
        truncated: allMembers.length - shown.length,
      };
    }

    res.json({ projectId, snapshotId, clusters, edges, level });
  } catch (err) {
    console.error("Graph architecture error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Class/interface graph: symbol-level nodes with extends/implements edges
graphRouter.get("/classes", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    const snapshotId = ctx?.snapshotId ?? null;
    if (!snapshotId) {
      res.status(404).json({ error: "No completed analysis snapshot found" });
      return;
    }

    const [nodesResult, edgesResult] = await Promise.all([
      query(
        `SELECT id, stable_key, type, name, file_path, metadata
         FROM graph_nodes
         WHERE snapshot_id = $1 AND type IN ('class', 'interface')`,
        [snapshotId],
      ),
      query(
        `SELECT e.id, e.source_node_id, e.target_node_id, e.type
         FROM graph_edges e
         WHERE e.snapshot_id = $1 AND e.type IN ('extends', 'implements')`,
        [snapshotId],
      ),
    ]);

    type NodeRow = { id: string; stable_key: string; type: string; name: string; file_path: string; metadata: Record<string, unknown> };
    type EdgeRow = { id: string; source_node_id: string; target_node_id: string; type: string };

    const allNodes = nodesResult.rows as NodeRow[];
    const allEdges = edgesResult.rows as EdgeRow[];

    const nodeIdToKey = new Map<string, string>();
    for (const n of allNodes) nodeIdToKey.set(n.id, n.stable_key);

    const nodes = allNodes.map((n) => ({
      id: n.stable_key,
      label: n.name,
      kind: n.type,
      filePath: n.file_path,
      metadata: {
        exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
        importCount: (n.metadata?.importCount as number) ?? 0,
        dependentCount: (n.metadata?.dependentCount as number) ?? 0,
      },
    }));

    const edges = allEdges
      .map((e) => ({
        id: e.id,
        source: nodeIdToKey.get(e.source_node_id) ?? '',
        target: nodeIdToKey.get(e.target_node_id) ?? '',
        kind: e.type,
      }))
      .filter((e) => e.source && e.target);

    res.json({
      projectId,
      snapshotId,
      clustered: false,
      totalNodes: allNodes.length,
      totalEdges: edges.length,
      graph: { nodes, edges, entryPoints: [] },
      fileAnalyses: [],
    });
  } catch (err) {
    console.error("Graph classes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Workflow path graph: directed path through the steps of one workflow
graphRouter.get("/workflows/:workflowId", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const workflowId = req.params.workflowId;

    const wfResult = await query(
      `SELECT w.id, w.title, w.trigger_type, w.purpose, w.confidence
       FROM workflows w
       JOIN analysis_snapshots s ON s.id = w.snapshot_id
       WHERE w.id = $1 AND s.project_id = $2`,
      [workflowId, projectId],
    );
    if (wfResult.rows.length === 0) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    const workflow = wfResult.rows[0];

    const stepsResult = await query(
      `SELECT ws.step_order, ws.file_path, ws.symbol_name, ws.line_start, ws.line_end,
              ws.step_kind, ws.deterministic_description, ws.metadata, n.stable_key
       FROM workflow_steps ws
       LEFT JOIN graph_nodes n ON n.id = ws.node_id
       WHERE ws.workflow_id = $1
       ORDER BY ws.step_order ASC`,
      [workflowId],
    );

    type StepRow = {
      step_order: number; file_path: string; symbol_name: string | null;
      line_start: number | null; line_end: number | null;
      step_kind: string; deterministic_description: string;
      metadata: { syntheticReturn?: boolean } | null; stable_key: string | null;
    };
    const steps = stepsResult.rows as StepRow[];

    // One node per distinct file on the path; directed edges between
    // consecutive steps. A syntheticReturn step re-references the trigger
    // symbol, so it gets its own terminal node — otherwise the final edge
    // would loop back to the first node.
    const graphNodeId = (step: StepRow) => {
      const base = step.stable_key ?? step.file_path;
      return step.metadata?.syntheticReturn ? `${base}::return` : base;
    };
    const nodeMap = new Map<string, { id: string; label: string; kind: string; filePath: string; metadata: { exportedSymbols: string[]; importCount: number; dependentCount: number } }>();
    const edges: Array<{ id: string; source: string; target: string; kind: string }> = [];
    const edgeSet = new Set<string>();
    let previousId: string | null = null;

    for (const step of steps) {
      const nodeId = graphNodeId(step);
      if (!nodeMap.has(nodeId)) {
        const base = step.file_path.split('/').pop() ?? step.file_path;
        const label = step.metadata?.syntheticReturn
          ? `Response from ${step.symbol_name ?? base}`
          : step.symbol_name ?? base;
        nodeMap.set(nodeId, {
          id: nodeId,
          label,
          kind: step.step_kind,
          filePath: step.file_path,
          metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 },
        });
      }
      if (previousId && previousId !== nodeId) {
        const edgeId = `${previousId}→${nodeId}`;
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);
          edges.push({ id: edgeId, source: previousId, target: nodeId, kind: "step" });
        }
      }
      previousId = nodeId;
    }

    const nodes = Array.from(nodeMap.values());
    const firstNode = nodes.length > 0 ? [nodes[0]!.id] : [];

    res.json({
      projectId,
      workflow,
      steps: steps.map((s) => ({
        stepOrder: s.step_order,
        filePath: s.file_path,
        symbolName: s.symbol_name,
        lineStart: s.line_start,
        lineEnd: s.line_end,
        stepKind: s.step_kind,
        description: s.deterministic_description,
        nodeId: graphNodeId(s),
      })),
      graph: { nodes, edges, entryPoints: firstNode },
    });
  } catch (err) {
    console.error("Graph workflow path error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Node detail: accepts either the graph_nodes UUID or a stable_key (the id
// the frontend graph views use), scoped to the resolved snapshot (selected
// package → member default → latest complete).
// Enriched with connected workflows and the critical-ranking score.
graphRouter.get("/nodes/:nodeId", requireProjectAccess(), async (req, res) => {
  try {
    const nodeId = req.params.nodeId;

    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    const snapshotId = ctx?.snapshotId ?? null;
    if (!snapshotId) {
      res.status(404).json({ error: "No completed analysis snapshot found" });
      return;
    }

    const result = await query(
      `SELECT id, stable_key, type, name, file_path, line_start, line_end, hash, metadata
       FROM graph_nodes
       WHERE snapshot_id = $1 AND (stable_key = $2 OR id::text = $2)
       LIMIT 1`,
      [snapshotId, nodeId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Node not found" });
      return;
    }
    const node = result.rows[0] as { id: string } & Record<string, unknown>;

    const nodeRow = node as unknown as { id: string; stable_key: string; type: string; metadata: Record<string, unknown> };
    // Relationship semantics match the on-node badges: file/module nodes
    // relate via imports, symbol nodes via calls. Mixing both double-counted
    // dependencies that are imported AND called.
    const isFileNode = nodeRow.type === 'module' || nodeRow.type === 'file';
    const relationEdgeTypes = isFileNode ? ['imports'] : ['calls'];
    const [workflowsResult, rankingResult, recordResult, callerResult, receiptsResult,
           callersResult, calleesResult, effectsResult, clusterResult] = await Promise.all([
      query(
        `SELECT DISTINCT w.id, w.title, w.trigger_type
         FROM workflow_steps ws
         JOIN workflows w ON w.id = ws.workflow_id
         WHERE ws.node_id = $1`,
        [node.id],
      ),
      query(
        `SELECT score AS composite_score, score_breakdown AS scores, reasons AS ranking_reasons
         FROM criticality_scores
         WHERE snapshot_id = $1 AND target_node_id = $2
           AND phase = 'candidate' AND view = 'candidate' AND role = 'general'
         LIMIT 1`,
        [snapshotId, node.id],
      ),
      // Active semantic record for the symbol doc format's one-line summary.
      query(
        `SELECT sr.summary, sr.confidence, sr.facts_only, sr.record
         FROM snapshot_semantic_records ssr
         JOIN semantic_records sr ON sr.id = ssr.record_id
         WHERE ssr.snapshot_id = $1 AND ssr.stable_key = $2 AND ssr.record_level = 'symbol'
         LIMIT 1`,
        [snapshotId, nodeRow.stable_key],
      ),
      // Real example usage: a call-site snippet from one of the callers.
      query(
        `SELECT gn.stable_key, gn.name, gn.file_path, gn.line_start, gn.snippet
         FROM graph_edges e
         JOIN graph_nodes gn ON gn.id = e.source_node_id
         WHERE e.snapshot_id = $1 AND e.target_node_id = $2 AND e.type = 'calls'
           AND gn.snippet IS NOT NULL
         ORDER BY length(gn.snippet) ASC
         LIMIT 1`,
        [snapshotId, node.id],
      ),
      // Receipts attached to the symbol's active record (file/line links).
      query(
        `SELECT r.id, r.receipt_kind, r.trust_level, r.file_path, r.symbol_name,
                r.line_start, r.line_end, r.snippet
         FROM source_receipts r
         JOIN snapshot_semantic_records ssr ON ssr.record_id = r.record_id
         WHERE ssr.snapshot_id = $1 AND ssr.stable_key = $2 AND ssr.record_level = 'symbol'
         ORDER BY array_position(ARRAY['code','config','tests','docs','llm_inference'], r.trust_level)
         LIMIT 6`,
        [snapshotId, nodeRow.stable_key],
      ),
      // Deterministic relationships — every node has these even when it has
      // no LLM record, so the detail panel is never empty.
      query(
        `SELECT gn.stable_key, gn.name, gn.file_path
         FROM graph_edges e JOIN graph_nodes gn ON gn.id = e.source_node_id
         WHERE e.snapshot_id = $1 AND e.target_node_id = $2 AND e.type = ANY($3)
         ORDER BY gn.name LIMIT 8`,
        [snapshotId, node.id, relationEdgeTypes],
      ),
      query(
        `SELECT gn.stable_key, gn.name, gn.file_path
         FROM graph_edges e JOIN graph_nodes gn ON gn.id = e.target_node_id
         WHERE e.snapshot_id = $1 AND e.source_node_id = $2 AND e.type = ANY($3)
         ORDER BY gn.name LIMIT 8`,
        [snapshotId, node.id, relationEdgeTypes],
      ),
      query(
        `SELECT type, target FROM side_effects WHERE snapshot_id = $1 AND node_id = $2 LIMIT 8`,
        [snapshotId, node.id],
      ),
      query(
        `SELECT c.stable_key, c.label
         FROM architecture_cluster_members m JOIN architecture_clusters c ON c.id = m.cluster_id
         WHERE c.snapshot_id = $1 AND m.node_id = $2 LIMIT 1`,
        [snapshotId, node.id],
      ),
    ]);

    let ranking = rankingResult.rows[0] as
      | { composite_score: string | number; scores: Record<string, number>; ranking_reasons: string[] }
      | undefined;
    // "Not ranked in this snapshot" on a clickable symbol reads as a gap in
    // the product (audit §4.1). Symbols outside the ranked set inherit their
    // FILE's rank, labeled as such — file-level ranking covers every file.
    let rankingScope: "direct" | "file_fallback" = "direct";
    if (!ranking && !isFileNode && typeof nodeRow.stable_key === "string") {
      const fileKey = nodeRow.stable_key.split("#")[0];
      ranking = (await query(
        `SELECT score AS composite_score, score_breakdown AS scores, reasons AS ranking_reasons
         FROM criticality_scores
         WHERE snapshot_id = $1 AND stable_key = $2 AND target_type = 'file'
           AND phase = 'candidate' AND view = 'candidate' AND role = 'general'
         LIMIT 1`,
        [snapshotId, fileKey],
      )).rows[0] as typeof ranking;
      if (ranking) rankingScope = "file_fallback";
    }
    const record = recordResult.rows[0] as
      | { summary: string; confidence: string; facts_only: boolean; record: Record<string, unknown> }
      | undefined;
    const caller = callerResult.rows[0] as
      | { stable_key: string; name: string; file_path: string; line_start: number | null; snippet: string }
      | undefined;

    // Symbol doc format (doc/Pipeline.md "Symbol doc format"): one-line
    // summary + deterministic signature/params/returns + example call site.
    const meta = nodeRow.metadata ?? {};
    res.json({
      node: {
        ...node,
        connected_workflows: workflowsResult.rows,
        composite_score: ranking ? Number(ranking.composite_score) : null,
        ranking_scope: ranking ? rankingScope : null,
        ranking_reasons: ranking?.ranking_reasons ?? [],
        // The breakdown has always been selected here and then thrown away at
        // serialisation, leaving the panel with a number and no derivation.
        ranking_provenance: ranking
          ? buildCandidateProvenance({
              label: "Importance",
              score: Number(ranking.composite_score),
              breakdown: ranking.scores,
              reasons: ranking.ranking_reasons,
              targetType: isFileNode || rankingScope === "file_fallback" ? "file" : "symbol",
              caveat:
                rankingScope === "file_fallback"
                  ? "This is the score of the file this symbol lives in. The symbol itself was not ranked in this snapshot, so the signals below describe the file, not the function."
                  : null,
            })
          : null,
        callers: callersResult.rows,
        callees: calleesResult.rows,
        // Panel labels matching the relationship semantics above.
        relation_labels: isFileNode
          ? { inbound: "Imported by", outbound: "Imports" }
          : { inbound: "Called by", outbound: "Calls" },
        side_effects: effectsResult.rows,
        cluster: clusterResult.rows[0] ?? null,
        doc: {
          summary: record ? record.summary.split(/(?<=[.!?])\s/)[0] : null,
          summaryConfidence: record?.confidence ?? null,
          factsOnly: record?.facts_only ?? null,
          signature: (meta.signature as string) ?? null,
          params: (meta.params as unknown[]) ?? [],
          returns: (meta.returnType as string) ?? null,
          exampleUsage: caller
            ? { caller: caller.name, filePath: caller.file_path, lineStart: caller.line_start, snippet: caller.snippet }
            : null,
          receipts: receiptsResult.rows,
        },
      },
    });
  } catch (err) {
    console.error("Graph node detail error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
