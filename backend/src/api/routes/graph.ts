import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { resolveForRequest } from "../services/packageResolver.js";
import { buildCandidateProvenance, buildMeanProvenance } from "../services/scoreProvenance.js";
import { loadClusterNarratives } from "../../worker/engine/architectureClusterer.js";

export const graphRouter = Router({ mergeParams: true });

const MAX_GRAPH_NODES = 60;

/**
 * The symbol node types a source file declares. The Dependencies ladder is two
 * rungs — groups → files — so these are no longer a level of their own; the
 * count is carried on a file node as "declares N symbols", which is context
 * about the file rather than a door to another canvas.
 */
const SYMBOL_NODE_TYPES = ["function", "method", "class", "interface", "type", "enum", "variable"];

export interface GraphTruncation {
  shown: number;
  total: number;
  hidden: number;
  limit: number;
  unit: "groups" | "files" | "groups and files" | "classes" | "groups and classes";
  /** The rule that picked the survivors, in the reader's words. */
  keptBy: string;
  /** Where the rest can still be reached, or null when nowhere. */
  seeRest: string | null;
}

/**
 * Every number the header may print, and what each one counts — so the summary
 * and the canvas can be checked against each other instead of describing two
 * different populations.
 *
 * This exists because the header used to print the LEVEL's totals
 * (`227 files · 929 edges`) over a canvas drawing 8 boxes and 2 arrows
 * (owner F1: "It shows a bigger number ... when you click to see details,
 * there are less"; AUDIT C14). Both numbers were true; neither said what it
 * counted, so together they read as a contradiction.
 */
export interface GraphLevelCounts {
  /** Nodes actually in `graph.nodes` — what the canvas draws. */
  nodesShown: number;
  /** Of those, how many are directory groups rather than files. */
  groupsShown: number;
  /** Of those, how many are individual files. */
  filesShown: number;
  /** Arrows in `graph.edges` — group→group arrows are deduplicated pairs. */
  edgesShown: number;
  /** Files this level covers, drawn individually or folded into a group. */
  filesTotal: number;
  /** File-to-file links among those files, before any grouping or capping. */
  linksTotal: number;
  /** Of `linksTotal`, how many have both ends inside one drawn group. */
  linksInsideGroups: number;
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
 * A facts-only record's `purpose` is built deterministically as
 * `interface 'GitHubUser' (github_integration)` (symbolPass.buildFactsOnlyBody)
 * — the kind and the name, both of which the node label and the type badge
 * already print. Owner H1: an explanation must carry information the screen
 * does not already show, so text of that shape is not an explanation and is
 * dropped rather than displayed as one. 2362 of the fleet's 4396 symbol
 * records are facts-only; a handful of LLM records copy the same shape, which
 * is what the pattern (rather than the flag alone) catches.
 */
const LABEL_RESTATEMENT = /^(?:abstract\s+)?(?:interface|class|type|enum|function|method|variable|const)\s+'/i;

/**
 * The one line a stored record actually EXPLAINS, or null when it only
 * restates the label.
 *
 * `renderSummary` prefixes every summary with the thing's own name
 * (`"<name>: <purpose>"`, and `"<path>: <purpose>"` at file level). The panel
 * and the card already print that name, so the prefix is stripped — otherwise
 * the one line available is spent repeating the heading directly above it.
 */
export function explanationFromSummary(
  summary: string | null | undefined,
  opts: { factsOnly?: boolean | null; strip?: Array<string | null | undefined>; firstSentence?: boolean } = {},
): string | null {
  let text = (summary ?? "").trim();
  if (!text) return null;
  for (const prefix of opts.strip ?? []) {
    if (prefix && text.startsWith(`${prefix}:`)) {
      text = text.slice(prefix.length + 1).trim();
      break;
    }
  }
  if (!text) return null;
  if (opts.factsOnly === true) return null;
  if (LABEL_RESTATEMENT.test(text)) return null;
  return opts.firstSentence ? text.split(/(?<=[.!?])\s/)[0]!.trim() : text;
}

/** The declared name inside a symbol stable_key (`src/a.ts#Foo` → `Foo`). */
function symbolNameFromKey(stableKey: string): string {
  return stableKey.includes("#") ? stableKey.slice(stableKey.lastIndexOf("#") + 1) : stableKey;
}

/** What one file does, in the analyzer's own words. */
interface FileBrief {
  /** One line, with the redundant `<path>: ` prefix stripped. */
  summary: string;
  /** "route file", "service", "config glue" — the analyzer's file_role. */
  role: string | null;
  confidence: string;
  /** The symbols the record considers this file's headline names. */
  keySymbols: string[];
}

/**
 * The stored FILE-level semantic record for each of these paths.
 *
 * The Dependencies tab used to name files and nothing else — a canvas of
 * paths, so drilling into a group only ever showed FEWER paths (owner E3/E4:
 * "The dependencies should also have explanation of what file does. Drilling
 * down should give more context"). The records already exist: the synthesis
 * pass writes one per file, keyed by the file path, which is exactly the
 * module node's `stable_key`.
 */
async function fileBriefs(snapshotId: string, filePaths: string[]): Promise<Map<string, FileBrief>> {
  const briefs = new Map<string, FileBrief>();
  if (filePaths.length === 0) return briefs;
  const result = await query(
    `SELECT ssr.stable_key, sr.summary, sr.confidence, sr.facts_only,
            sr.record->>'file_role' AS file_role,
            sr.record->'key_symbols' AS key_symbols
     FROM snapshot_semantic_records ssr
     JOIN semantic_records sr ON sr.id = ssr.record_id
     WHERE ssr.snapshot_id = $1 AND ssr.record_level = 'file' AND ssr.stable_key = ANY($2)`,
    [snapshotId, filePaths],
  );
  type Row = {
    stable_key: string; summary: string | null; confidence: string | null; facts_only: boolean | null;
    file_role: string | null; key_symbols: string[] | null;
  };
  for (const r of result.rows as Row[]) {
    // `renderSummary` stores "<path>: <purpose>"; the node already shows the
    // path, so repeating it would spend the one line on nothing.
    const summary = explanationFromSummary(r.summary, {
      factsOnly: r.facts_only,
      strip: [r.stable_key],
    });
    if (!summary) continue;
    briefs.set(r.stable_key, {
      summary,
      role: r.file_role,
      confidence: r.confidence ?? "medium",
      keySymbols: Array.isArray(r.key_symbols) ? r.key_symbols.slice(0, 8) : [],
    });
  }
  return briefs;
}

/** What one class or interface does, in the analyzer's own words. */
interface SymbolBrief {
  summary: string;
  confidence: string;
}

/**
 * The stored SYMBOL-level record for each of these stable keys, for the
 * class/interface nodes of the Classes view.
 *
 * The records exist for every class on every snapshot, but roughly half are
 * facts-only restatements of the name and kind; `explanationFromSummary` is
 * what keeps those off the screen instead of dressing "interface 'GitHubUser'"
 * up as an explanation (VISUAL QA M4 #3 — the Classes tab explains nothing).
 */
async function symbolBriefs(snapshotId: string, stableKeys: string[]): Promise<Map<string, SymbolBrief>> {
  const briefs = new Map<string, SymbolBrief>();
  if (stableKeys.length === 0) return briefs;
  const result = await query(
    `SELECT ssr.stable_key, sr.summary, sr.confidence, sr.facts_only
     FROM snapshot_semantic_records ssr
     JOIN semantic_records sr ON sr.id = ssr.record_id
     WHERE ssr.snapshot_id = $1 AND ssr.record_level = 'symbol' AND ssr.stable_key = ANY($2)`,
    [snapshotId, stableKeys],
  );
  type Row = { stable_key: string; summary: string | null; confidence: string | null; facts_only: boolean | null };
  for (const r of result.rows as Row[]) {
    const summary = explanationFromSummary(r.summary, {
      factsOnly: r.facts_only,
      strip: [r.stable_key, symbolNameFromKey(r.stable_key)],
    });
    if (!summary) continue;
    briefs.set(r.stable_key, { summary, confidence: r.confidence ?? "medium" });
  }
  return briefs;
}

/**
 * Symbols declared per file. Context on the file card ("declares 14 symbols"),
 * not a drill affordance — the third rung was removed as unhelpful (owner E1).
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
    // NOTE: `?file=` used to open a third rung (the symbols one file declares).
    // The owner removed it as "not useful and annoying" (E1), so the param is
    // deliberately ignored rather than 400'd — a stale bookmark degrades to the
    // level above instead of erroring.

    const ctx = await resolveForRequest(req, res);
    if (ctx === false) return;
    const snapshotId = ctx?.snapshotId ?? null;
    if (!snapshotId) {
      res.status(404).json({ error: "No completed analysis snapshot found" });
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

      const keyToDir = new Map<string, string>();
      for (const [dir, info] of dirMap) {
        for (const key of info.keys) keyToDir.set(key, dir);
      }

      // Cross-boundary link counts per group.
      //
      // AUDIT C1 / SC F7 / UX §9.1 + §17.6: `dependentCount: 0` was hardcoded
      // here, so on 11 of 11 projects every group on the DEFAULT view read
      // "N imports · 0 imported by" while the canvas drew arrows into it. The
      // paired half of the same defect is that `importCount` summed the
      // members' own import counts — 392 for `backend/src`, almost all of it
      // internal — which is the "bigger number of available imports" the owner
      // saw. Both numbers now count the links that CROSS this group's
      // boundary, which is exactly the population the arrows stand for.
      const crossOut = new Map<string, number>();
      const crossIn = new Map<string, number>();
      const internalLinks = new Map<string, number>();
      for (const e of fileEdges) {
        const s = keyToDir.get(nodeIdToKey.get(e.source_node_id)!);
        const t = keyToDir.get(nodeIdToKey.get(e.target_node_id)!);
        if (!s || !t) continue;
        if (s === t) { internalLinks.set(s, (internalLinks.get(s) ?? 0) + 1); continue; }
        crossOut.set(s, (crossOut.get(s) ?? 0) + 1);
        crossIn.set(t, (crossIn.get(t) ?? 0) + 1);
      }

      const clusterNodes = Array.from(dirMap.entries())
        // Ranked by how much importing its files do — the rule `keptBy` states.
        .sort((a, b) => b[1].importCount - a[1].importCount || a[0].localeCompare(b[0]))
        .slice(0, MAX_GRAPH_NODES)
        .map(([dir, info]) => ({
          id: `cluster:${dir}`,
          label: `${dir}/ (${info.count} files)`,
          kind: "cluster" as const,
          metadata: {
            exportedSymbols: [] as string[],
            importCount: crossOut.get(dir) ?? 0,
            dependentCount: crossIn.get(dir) ?? 0,
            internalImportCount: internalLinks.get(dir) ?? 0,
            fileCount: info.count,
            directory: dir,
          },
        }));

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

      const drawnDirs = new Set(clusterNodes.map((n) => n.metadata.directory));
      const counts: GraphLevelCounts = {
        nodesShown: clusterNodes.length,
        groupsShown: clusterNodes.length,
        filesShown: 0,
        edgesShown: filteredClusterEdges.length,
        filesTotal: clusterNodes.reduce((n, c) => n + c.metadata.fileCount, 0),
        linksTotal: fileEdges.filter((e) => {
          const s = keyToDir.get(nodeIdToKey.get(e.source_node_id)!);
          const t = keyToDir.get(nodeIdToKey.get(e.target_node_id)!);
          return !!s && !!t && drawnDirs.has(s) && drawnDirs.has(t);
        }).length,
        linksInsideGroups: clusterNodes.reduce((n, c) => n + c.metadata.internalImportCount, 0),
      };

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
        counts,
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

        // Every file key maps to the node that stands for it here: its group,
        // or itself when it is loose. Built before the nodes so their
        // cross-boundary counts can be derived from it (see the root branch —
        // AUDIT C1 applies identically one level down).
        const keyToNodeId = new Map<string, string>();
        for (const [dir, info] of subMap) for (const key of info.keys) keyToNodeId.set(key, `cluster:${dir}`);
        for (const n of loose) keyToNodeId.set(n.stable_key, n.stable_key);

        const subOut = new Map<string, number>();
        const subIn = new Map<string, number>();
        const subInternal = new Map<string, number>();
        for (const e of levelEdges) {
          const s = keyToNodeId.get(nodeIdToKey.get(e.source_node_id)!);
          const t = keyToNodeId.get(nodeIdToKey.get(e.target_node_id)!);
          if (!s || !t) continue;
          if (s === t) { subInternal.set(s, (subInternal.get(s) ?? 0) + 1); continue; }
          subOut.set(s, (subOut.get(s) ?? 0) + 1);
          subIn.set(t, (subIn.get(t) ?? 0) + 1);
        }

        const subClusters = [...subMap.entries()]
          .sort((a, b) => b[1].importCount - a[1].importCount || a[0].localeCompare(b[0]))
          .map(([dir, info]) => ({
            id: `cluster:${dir}`,
            label: `${dir.split("/").pop()}/ (${info.count} files)`,
            kind: "cluster" as const,
            metadata: {
              exportedSymbols: [] as string[],
              importCount: subOut.get(`cluster:${dir}`) ?? 0,
              dependentCount: subIn.get(`cluster:${dir}`) ?? 0,
              internalImportCount: subInternal.get(`cluster:${dir}`) ?? 0,
              fileCount: info.count,
              directory: dir,
            },
          }));
        // Loose files are real files: they carry the same "what this file
        // does" line every file node on this tab now carries.
        const loosePaths = loose.map((n) => n.file_path);
        const [looseCounts, looseBriefs] = await Promise.all([
          symbolCountsByFile(snapshotId, loosePaths),
          fileBriefs(snapshotId, loose.map((n) => n.stable_key)),
        ]);
        const looseNodes = loose.map((n) => {
          const brief = looseBriefs.get(n.stable_key);
          return {
            id: n.stable_key,
            label: n.name,
            kind: n.type,
            metadata: {
              exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
              importCount: (n.metadata?.importCount as number) ?? 0,
              externalImportCount: (n.metadata?.externalImportCount as number) ?? 0,
              dependentCount: (n.metadata?.dependentCount as number) ?? 0,
              symbolCount: looseCounts.get(n.file_path) ?? 0,
              summary: brief?.summary ?? null,
              role: brief?.role ?? null,
              summaryConfidence: brief?.confidence ?? null,
            },
          };
        });
        const mixed = [...subClusters, ...looseNodes].slice(0, MAX_GRAPH_NODES);
        const keptIds = new Set(mixed.map((n) => n.id));

        const seen = new Set<string>();
        const mixedEdges: Array<{ id: string; source: string; target: string; kind: string; weight: number }> = [];
        let linksInsideGroups = 0;
        let linksTotal = 0;
        for (const e of levelEdges) {
          const s = keyToNodeId.get(nodeIdToKey.get(e.source_node_id)!);
          const t = keyToNodeId.get(nodeIdToKey.get(e.target_node_id)!);
          if (!s || !t || !keptIds.has(s) || !keptIds.has(t)) continue;
          linksTotal += 1;
          if (s === t) { linksInsideGroups += 1; continue; }
          const key = `${s}->${t}`;
          if (seen.has(key)) continue;
          seen.add(key);
          mixedEdges.push({ id: key, source: s, target: t, kind: "dependency", weight: 1 });
        }

        const shownGroups = mixed.filter((n) => n.id.startsWith("cluster:"));
        const counts: GraphLevelCounts = {
          nodesShown: mixed.length,
          groupsShown: shownGroups.length,
          filesShown: mixed.length - shownGroups.length,
          edgesShown: mixedEdges.length,
          filesTotal: mixed.reduce(
            (n, node) => n + ((node.metadata as { fileCount?: number }).fileCount ?? 1),
            0,
          ),
          linksTotal,
          linksInsideGroups,
        };

        const unit: GraphTruncation["unit"] =
          subClusters.length > 0 && looseNodes.length > 0 ? "groups and files" : "groups";
        res.json({
          projectId,
          snapshotId,
          clustered: true,
          level: { kind: "cluster", id: cluster, unit },
          totalNodes: filteredNodes.length,
          totalEdges: levelEdges.length,
          counts,
          describedFiles: looseNodes.filter((n) => n.metadata.summary).length,
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

    // Cap at MAX_GRAPH_NODES sorted by importance (importCount desc). The path
    // tiebreak makes the survivor set deterministic — the same level must not
    // draw a different 60 files on a reload (owner I2, applied here as well as
    // to the Architecture member list).
    filteredNodes.sort((a, b) => {
      const ai = (a.metadata?.importCount as number) ?? 0;
      const bi = (b.metadata?.importCount as number) ?? 0;
      return bi - ai || a.file_path.localeCompare(b.file_path);
    });
    const cappedNodes = filteredNodes.slice(0, MAX_GRAPH_NODES);
    const cappedKeySet = new Set(cappedNodes.map((n) => n.stable_key));

    const [symbolCounts, briefs] = await Promise.all([
      symbolCountsByFile(snapshotId, cappedNodes.map((n) => n.file_path)),
      fileBriefs(snapshotId, cappedNodes.map((n) => n.stable_key)),
    ]);

    const nodes = cappedNodes.map((n) => {
      const brief = briefs.get(n.stable_key);
      return {
        id: n.stable_key,
        label: n.name,
        kind: n.type,
        metadata: {
          exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
          importCount: (n.metadata?.importCount as number) ?? 0,
          externalImportCount: (n.metadata?.externalImportCount as number) ?? 0,
          dependentCount: (n.metadata?.dependentCount as number) ?? 0,
          symbolCount: symbolCounts.get(n.file_path) ?? 0,
          // What the file DOES. Without this the file level was a wall of
          // paths, so drilling into a group only ever removed information
          // (owner E3/E4).
          summary: brief?.summary ?? null,
          role: brief?.role ?? null,
          summaryConfidence: brief?.confidence ?? null,
        },
      };
    });

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

    const counts: GraphLevelCounts = {
      nodesShown: nodes.length,
      groupsShown: 0,
      filesShown: nodes.length,
      edgesShown: edges.length,
      filesTotal: filteredNodes.length,
      linksTotal: levelEdges.length,
      linksInsideGroups: 0,
    };

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
      counts,
      // How many of the drawn files carry an explanation, so the level can say
      // so instead of leaving the reader to guess why some cards are richer.
      describedFiles: nodes.filter((n) => n.metadata.summary).length,
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

    type ClusterMemberRow = { cluster_key: string; member_key: string; name: string; file_path: string | null };
    const memberRows = membersResult.rows as ClusterMemberRow[];

    // Owner I2/H1 follow-up: the member list named files and nothing else, so
    // opening a component told the reader WHICH files it holds and never what
    // any of them does. The file records that answer that are the same ones
    // the Dependencies tab reads — a member's key IS the module node's
    // stable_key, so no new source and no new prose is involved. Members with
    // no record keep the path alone: 59% of the fleet's cluster members carry
    // a file record, and inventing a sentence for the other 41% would be
    // worse than saying nothing.
    const briefsByKey = await fileBriefs(snapshotId, [...new Set(memberRows.map((m) => m.member_key))]);

    const membersByCluster = new Map<string, Array<{
      key: string; name: string; filePath: string | null; summary: string | null; role: string | null;
    }>>();
    for (const m of memberRows) {
      if (!membersByCluster.has(m.cluster_key)) membersByCluster.set(m.cluster_key, []);
      const brief = briefsByKey.get(m.member_key);
      membersByCluster.get(m.cluster_key)!.push({
        key: m.member_key,
        name: m.name,
        filePath: m.file_path,
        summary: brief?.summary ?? null,
        role: brief?.role ?? null,
      });
    }
    const recordByCluster = new Map(
      (recordsResult.rows as Array<{ stable_key: string; summary: string; confidence: string }>)
        .map((r) => [r.stable_key, r]),
    );
    type ScoreRow = { stable_key: string; score: string | number; score_breakdown: unknown; reasons: string[] | null };
    const rowByKey = new Map((memberScoresResult.rows as ScoreRow[]).map((r) => [r.stable_key, r]));
    const scoreByKey = new Map([...rowByKey].map(([key, r]) => [key, Number(r.score)]));

    // Degree per component, so a component drawn as an island can SAY it is
    // one (AUDIT C7 / SC F11: 17 of 76 clusters have degree 0 and nothing on
    // the map explains the isolation).
    const degreeByCluster = new Map<string, number>();
    for (const e of edgesResult.rows as Array<{ source_key: string; target_key: string }>) {
      degreeByCluster.set(e.source_key, (degreeByCluster.get(e.source_key) ?? 0) + 1);
      degreeByCluster.set(e.target_key, (degreeByCluster.get(e.target_key) ?? 0) + 1);
    }

    const clusters = (clustersResult.rows as Array<{
      id: string; stable_key: string; label: string; kind: string;
      critical_score: string | number; deterministic_summary: string | null;
      metadata: Record<string, unknown>;
    }>).map((c) => {
      // Owner I2: the member list arrived in join order, which is neither
      // stable across requests nor meaningful. Most critical first, then path
      // — the same rule the drilled canvas ranks by, so the list beside the
      // graph and the graph agree on what matters.
      const members = (membersByCluster.get(c.stable_key) ?? []).slice().sort((a, b) => {
        const sa = scoreByKey.get(a.key);
        const sb = scoreByKey.get(b.key);
        if (sa !== undefined && sb !== undefined && sa !== sb) return sb - sa;
        if ((sa === undefined) !== (sb === undefined)) return sa === undefined ? 1 : -1;
        return (a.filePath ?? a.name).localeCompare(b.filePath ?? b.name);
      });
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
        /** Architecture edges touching this component; 0 = drawn as an island. */
        degree: degreeByCluster.get(c.stable_key) ?? 0,
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
        const brief = briefsByKey.get(n.stable_key);
        return {
          id: n.stable_key,
          label: n.name,
          kind: n.type,
          filePath: n.file_path,
          // The same line the list in the aside shows, so a member says what
          // it does whether it is read in the list or opened on the canvas.
          summary: brief?.summary ?? null,
          role: brief?.role ?? null,
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
        (b.criticalScore ?? -1) - (a.criticalScore ?? -1)
        || b.dependentCount - a.dependentCount
        // Deterministic last resort (owner I2): equal-scoring members must not
        // reorder between requests.
        || (a.filePath ?? a.label).localeCompare(b.filePath ?? b.label));
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

// Class/interface graph: symbol-level nodes with extends/implements edges.
//
// Two levels, the same ladder the Files view uses (directory groups →
// classes). VISUAL QA M4 #3 measured the old flat version on OnboardBuddy at
// 267 identical chips with ~3px labels and 5 edges — a project-wide grid whose
// only readable fact was its own size. Above the node cap the level is grouped
// by directory; at or below it, the classes themselves are drawn.
graphRouter.get("/classes", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    /** `?dir=<path>` is the drilled level: the classes under one directory. */
    const dir = (req.query.dir as string | undefined) || null;

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

    /** Inheritance links between class nodes, keyed the way the canvas is. */
    const keyEdges = allEdges
      .map((e) => ({
        id: e.id,
        source: nodeIdToKey.get(e.source_node_id) ?? '',
        target: nodeIdToKey.get(e.target_node_id) ?? '',
        kind: e.type,
      }))
      .filter((e) => e.source && e.target);

    // The classes this level covers. Prefix-matching the path is what lets a
    // nested directory resolve to its own classes.
    const scoped = dir
      ? allNodes.filter((n) => n.file_path === dir || n.file_path.startsWith(`${dir}/`))
      : allNodes;
    const scopedKeys = new Set(scoped.map((n) => n.stable_key));
    const scopedEdges = keyEdges.filter((e) => scopedKeys.has(e.source) && scopedKeys.has(e.target));
    const degree = new Map<string, number>();
    for (const e of scopedEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }

    // ── grouped level ────────────────────────────────────────────────────────
    if (scoped.length > MAX_GRAPH_NODES) {
      // Two segments at the root (`backend/src`), one deeper each time a group
      // is opened — the same rule and the same `cluster:` ids the Files ladder
      // uses, so the two views behave identically under the reader's hands.
      const groupDepth = dir ? pathSegments(dir).length + 1 : 2;
      const groups = new Map<string, string[]>();
      const loose: NodeRow[] = [];
      for (const n of scoped) {
        const parts = pathSegments(n.file_path);
        // A class in a file sitting directly in this directory has no deeper
        // group to join; it is drawn alongside the groups.
        if (parts.length <= groupDepth) { loose.push(n); continue; }
        const key = parts.slice(0, groupDepth).join("/");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(n.stable_key);
      }
      // A group holding one class is a click that reveals that one class.
      const nodeByKey = new Map(scoped.map((n) => [n.stable_key, n]));
      for (const [key, members] of [...groups]) {
        if (members.length > 1) continue;
        const only = nodeByKey.get(members[0]!);
        if (only) loose.push(only);
        groups.delete(key);
      }

      // Only worth it when it actually shrinks the level; a directory whose
      // classes are all loose regroups into itself and must fall through to
      // the capped flat list (with the cut disclosed) instead.
      if (groups.size > 0 && groups.size + loose.length < scoped.length) {
        const keyToNodeId = new Map<string, string>();
        for (const [groupDir, members] of groups) for (const k of members) keyToNodeId.set(k, `cluster:${groupDir}`);
        for (const n of loose) keyToNodeId.set(n.stable_key, n.stable_key);

        const out = new Map<string, number>();
        const inn = new Map<string, number>();
        const inside = new Map<string, number>();
        for (const e of scopedEdges) {
          const s = keyToNodeId.get(e.source);
          const t = keyToNodeId.get(e.target);
          if (!s || !t) continue;
          if (s === t) { inside.set(s, (inside.get(s) ?? 0) + 1); continue; }
          out.set(s, (out.get(s) ?? 0) + 1);
          inn.set(t, (inn.get(t) ?? 0) + 1);
        }

        const groupNodes = [...groups.entries()]
          .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
          .map(([groupDir, members]) => ({
            id: `cluster:${groupDir}`,
            label: `${dir ? groupDir.split("/").pop() : groupDir}/ (${members.length} classes)`,
            kind: "cluster" as const,
            filePath: groupDir,
            metadata: {
              exportedSymbols: [] as string[],
              importCount: out.get(`cluster:${groupDir}`) ?? 0,
              dependentCount: inn.get(`cluster:${groupDir}`) ?? 0,
              internalImportCount: inside.get(`cluster:${groupDir}`) ?? 0,
              fileCount: members.length,
              // Without this the group card reads "184 files in this folder"
              // over a box standing for 184 classes.
              groupNoun: "classes",
              directory: groupDir,
            },
          }));

        const looseBriefs = await symbolBriefs(snapshotId, loose.map((n) => n.stable_key));
        const looseNodes = loose
          .sort((a, b) =>
            (degree.get(b.stable_key) ?? 0) - (degree.get(a.stable_key) ?? 0)
            || a.stable_key.localeCompare(b.stable_key))
          .map((n) => ({
            id: n.stable_key,
            label: n.name,
            kind: n.type,
            filePath: n.file_path,
            metadata: {
              exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
              importCount: (n.metadata?.importCount as number) ?? 0,
              dependentCount: (n.metadata?.dependentCount as number) ?? 0,
              summary: looseBriefs.get(n.stable_key)?.summary ?? null,
              summaryConfidence: looseBriefs.get(n.stable_key)?.confidence ?? null,
            },
          }));

        const mixed = [...groupNodes, ...looseNodes].slice(0, MAX_GRAPH_NODES);
        const keptIds = new Set(mixed.map((n) => n.id));
        const seen = new Set<string>();
        const mixedEdges: Array<{ id: string; source: string; target: string; kind: string }> = [];
        for (const e of scopedEdges) {
          const s = keyToNodeId.get(e.source);
          const t = keyToNodeId.get(e.target);
          if (!s || !t || s === t || !keptIds.has(s) || !keptIds.has(t)) continue;
          const id = `${s}->${t}`;
          if (seen.has(id)) continue;
          seen.add(id);
          mixedEdges.push({ id, source: s, target: t, kind: "inheritance" });
        }

        res.json({
          projectId,
          snapshotId,
          clustered: true,
          level: { kind: dir ? "cluster" : "root", id: dir, unit: looseNodes.length > 0 ? "groups and classes" : "groups" },
          totalNodes: scoped.length,
          totalEdges: scopedEdges.length,
          describedNodes: mixed.filter((n) => (n.metadata as { summary?: string | null }).summary).length,
          truncation: truncationNotice({
            shown: mixed.length,
            total: groupNodes.length + looseNodes.length,
            unit: looseNodes.length > 0 ? "groups and classes" : "groups",
            keptBy: "the folders holding the most classes",
            seeRest: null,
          }),
          graph: { nodes: mixed, edges: mixedEdges, entryPoints: [] },
          fileAnalyses: [],
        });
        return;
      }
    }

    // ── flat level: the classes themselves ───────────────────────────────────
    // Ranked before capping so the cut drops the least connected classes, and
    // the cut is reported rather than silently swallowed.
    const ranked = [...scoped].sort((a, b) =>
      (degree.get(b.stable_key) ?? 0) - (degree.get(a.stable_key) ?? 0)
      || a.stable_key.localeCompare(b.stable_key));
    const shown = ranked.slice(0, MAX_GRAPH_NODES);
    const briefs = await symbolBriefs(snapshotId, shown.map((n) => n.stable_key));

    const nodes = shown.map((n) => ({
      id: n.stable_key,
      label: n.name,
      kind: n.type,
      filePath: n.file_path,
      metadata: {
        exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
        importCount: (n.metadata?.importCount as number) ?? 0,
        dependentCount: (n.metadata?.dependentCount as number) ?? 0,
        // What this class or interface DOES. Absent for the roughly half of
        // symbol records that are deterministic facts-only restatements of the
        // name — the card then shows the name alone rather than a filler line.
        summary: briefs.get(n.stable_key)?.summary ?? null,
        summaryConfidence: briefs.get(n.stable_key)?.confidence ?? null,
      },
    }));

    const shownKeys = new Set(nodes.map((n) => n.id));
    const edges = scopedEdges.filter((e) => shownKeys.has(e.source) && shownKeys.has(e.target));

    res.json({
      projectId,
      snapshotId,
      clustered: false,
      level: { kind: dir ? "cluster" : "root", id: dir, unit: "classes" },
      totalNodes: scoped.length,
      totalEdges: scopedEdges.length,
      describedNodes: nodes.filter((n) => n.metadata.summary).length,
      truncation: truncationNotice({
        shown: nodes.length,
        total: scoped.length,
        unit: "classes",
        keptBy: "the classes with the most inheritance links",
        seeRest: null,
      }),
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
    // A module node's explanation lives in the FILE record, not the symbol
    // record — the symbol lookup below never matched for a file, which is why
    // every file on the Dependencies tab opened a panel with no summary at all
    // (owner E3). Same for its receipts.
    const recordLevel = isFileNode ? 'file' : 'symbol';
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
      // Active semantic record for the doc format's one-line summary — the
      // file record for a file node, the symbol record for a symbol.
      query(
        `SELECT sr.summary, sr.confidence, sr.facts_only, sr.record
         FROM snapshot_semantic_records ssr
         JOIN semantic_records sr ON sr.id = ssr.record_id
         WHERE ssr.snapshot_id = $1 AND ssr.stable_key = $2 AND ssr.record_level = $3
         LIMIT 1`,
        [snapshotId, nodeRow.stable_key, recordLevel],
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
      // Receipts attached to the node's active record (file/line links).
      query(
        `SELECT r.id, r.receipt_kind, r.trust_level, r.file_path, r.symbol_name,
                r.line_start, r.line_end, r.snippet
         FROM source_receipts r
         JOIN snapshot_semantic_records ssr ON ssr.record_id = r.record_id
         WHERE ssr.snapshot_id = $1 AND ssr.stable_key = $2 AND ssr.record_level = $3
         ORDER BY array_position(ARRAY['code','config','tests','docs','llm_inference'], r.trust_level)
         LIMIT 6`,
        [snapshotId, nodeRow.stable_key, recordLevel],
      ),
      // Deterministic relationships — every node has these even when it has
      // no LLM record, so the detail panel is never empty.
      //
      // `count(*) OVER ()` is the whole population, computed before LIMIT.
      // Without it the panel contradicted itself 100px apart (UX §17.6): the
      // reasons above said "Imported by 12 files" while the header below said
      // "IMPORTED BY (8)" — the 8 being this LIMIT, undisclosed.
      query(
        `SELECT gn.stable_key, gn.name, gn.file_path, count(*) OVER () AS total
         FROM graph_edges e JOIN graph_nodes gn ON gn.id = e.source_node_id
         WHERE e.snapshot_id = $1 AND e.target_node_id = $2 AND e.type = ANY($3)
         ORDER BY gn.file_path, gn.name LIMIT 8`,
        [snapshotId, node.id, relationEdgeTypes],
      ),
      query(
        `SELECT gn.stable_key, gn.name, gn.file_path, count(*) OVER () AS total
         FROM graph_edges e JOIN graph_nodes gn ON gn.id = e.target_node_id
         WHERE e.snapshot_id = $1 AND e.source_node_id = $2 AND e.type = ANY($3)
         ORDER BY gn.file_path, gn.name LIMIT 8`,
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
    type RelationRow = { stable_key: string; name: string; file_path: string | null; total: string | number };
    const relationTotal = (rows: unknown[]) =>
      rows.length > 0 ? Number((rows[0] as RelationRow).total) : 0;
    // The summary is the record's first sentence. A FILE record renders as
    // "<path>: <purpose>" and a SYMBOL record as "<Name>: <purpose>" — both
    // are already the panel's heading, and the symbol form was never stripped,
    // so a class panel opened with "GitHubUser: interface 'GitHubUser'". That
    // second half is a facts-only record, which says nothing the badge and the
    // title do not; it is dropped rather than dressed up as an explanation
    // (owner H1).
    const summary = explanationFromSummary(record?.summary, {
      factsOnly: record?.facts_only,
      strip: [nodeRow.stable_key, symbolNameFromKey(nodeRow.stable_key)],
      firstSentence: true,
    });
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
        // How many exist, against the ≤8 listed above.
        relation_totals: {
          inbound: relationTotal(callersResult.rows),
          outbound: relationTotal(calleesResult.rows),
        },
        // Panel labels matching the relationship semantics above.
        relation_labels: isFileNode
          ? { inbound: "Imported by", outbound: "Imports" }
          : { inbound: "Called by", outbound: "Calls" },
        side_effects: effectsResult.rows,
        cluster: clusterResult.rows[0] ?? null,
        doc: {
          summary,
          summaryConfidence: record?.confidence ?? null,
          factsOnly: record?.facts_only ?? null,
          /** "route file" / "service" / "config glue" — file records only. */
          role: (record?.record?.file_role as string | null) ?? null,
          /** The names the record calls this file's headline symbols. */
          keySymbols: Array.isArray(record?.record?.key_symbols)
            ? (record!.record.key_symbols as string[]).slice(0, 10)
            : [],
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
