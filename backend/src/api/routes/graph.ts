import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";

export const graphRouter = Router({ mergeParams: true });

const MAX_GRAPH_NODES = 20;

graphRouter.get("/dependencies", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const cluster = req.query.cluster as string | undefined;

    const snapshotResult = await query(
      `SELECT id FROM analysis_snapshots
       WHERE project_id = $1 AND status = 'complete'
       ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    );
    if (snapshotResult.rows.length === 0) {
      res.status(404).json({ error: "No completed analysis snapshot found" });
      return;
    }
    const snapshotId = snapshotResult.rows[0].id as string;

    const [nodesResult, edgesResult] = await Promise.all([
      query(
        `SELECT id, stable_key, type, name, file_path, metadata
         FROM graph_nodes WHERE snapshot_id = $1`,
        [snapshotId],
      ),
      query(
        `SELECT e.id, e.source_node_id, e.target_node_id, e.type
         FROM graph_edges e WHERE e.snapshot_id = $1`,
        [snapshotId],
      ),
    ]);

    type NodeRow = { id: string; stable_key: string; type: string; name: string; file_path: string; metadata: Record<string, unknown> };
    type EdgeRow = { id: string; source_node_id: string; target_node_id: string; type: string };

    const allNodes = nodesResult.rows as NodeRow[];
    const allEdges = edgesResult.rows as EdgeRow[];

    const nodeIdToKey = new Map<string, string>();
    for (const n of allNodes) nodeIdToKey.set(n.id, n.stable_key);

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
        totalNodes: allNodes.length,
        totalEdges: allEdges.length,
        graph: { nodes: clusterNodes, edges: filteredClusterEdges, entryPoints: [] },
        fileAnalyses: [],
      });
      return;
    }

    // Filter to a single cluster if requested (matches 2-level directory logic)
    let filteredNodes = allNodes;
    if (cluster) {
      filteredNodes = allNodes.filter((n) => {
        const parts = n.file_path.split('/');
        const dir = parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts.length > 1 ? parts[0]! : '.';
        return dir === cluster;
      });
    }

    // Cap at MAX_GRAPH_NODES sorted by importance (importCount desc)
    filteredNodes.sort((a, b) => {
      const ai = (a.metadata?.importCount as number) ?? 0;
      const bi = (b.metadata?.importCount as number) ?? 0;
      return bi - ai;
    });
    const cappedNodes = filteredNodes.slice(0, MAX_GRAPH_NODES);
    const cappedKeySet = new Set(cappedNodes.map((n) => n.stable_key));

    const nodes = cappedNodes.map((n) => ({
      id: n.stable_key,
      label: n.name,
      kind: n.type,
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
      totalNodes: allNodes.length,
      totalEdges: allEdges.length,
      graph: { nodes, edges, entryPoints: Array.from(entryPointSet) },
      fileAnalyses: [],
    });
  } catch (err) {
    console.error("Graph dependencies error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

graphRouter.get("/nodes/:nodeId", requireProjectAccess(), async (req, res) => {
  try {
    const nodeId = req.params.nodeId;

    const result = await query(
      `SELECT id, stable_key, type, name, file_path, line_start, line_end, hash, metadata
       FROM graph_nodes WHERE id = $1`,
      [nodeId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Node not found" });
      return;
    }
    res.json({ node: result.rows[0] });
  } catch (err) {
    console.error("Graph node detail error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
