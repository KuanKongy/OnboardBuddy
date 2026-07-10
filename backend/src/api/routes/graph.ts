import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";

export const graphRouter = Router({ mergeParams: true });

const MAX_GRAPH_NODES = 20;

async function latestCompleteSnapshotId(projectId: string | string[] | undefined): Promise<string | null> {
  const result = await query(
    `SELECT id FROM analysis_snapshots
     WHERE project_id = $1 AND status = 'complete'
     ORDER BY created_at DESC LIMIT 1`,
    [projectId],
  );
  return result.rows.length > 0 ? (result.rows[0].id as string) : null;
}

graphRouter.get("/dependencies", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const cluster = req.query.cluster as string | undefined;

    const snapshotId = await latestCompleteSnapshotId(projectId);
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
        `SELECT e.id, e.source_node_id, e.target_node_id, e.type
         FROM graph_edges e
         WHERE e.snapshot_id = $1 AND e.type NOT IN ('extends', 'implements')`,
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

// Full uncapped file-level graph for the latest snapshot. The frontend
// derives the high-level architecture map (component grouping + aggregated
// edges) from this, so no clustering or node cap is applied here.
graphRouter.get("/architecture", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    const snapshotId = await latestCompleteSnapshotId(projectId);
    if (!snapshotId) {
      res.status(404).json({ error: "No completed analysis snapshot found" });
      return;
    }

    const [nodesResult, edgesResult] = await Promise.all([
      query(
        `SELECT id, stable_key, type, name, file_path, metadata
         FROM graph_nodes WHERE snapshot_id = $1 AND type = 'module'`,
        [snapshotId],
      ),
      query(
        `SELECT e.id, e.source_node_id, e.target_node_id, e.type
         FROM graph_edges e
         WHERE e.snapshot_id = $1 AND e.type NOT IN ('extends', 'implements')`,
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

    const entryPointSet = new Set<string>();
    for (const n of allNodes) {
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
    console.error("Graph architecture error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Class/interface graph: symbol-level nodes with extends/implements edges
graphRouter.get("/classes", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    const snapshotId = await latestCompleteSnapshotId(projectId);
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
              ws.step_kind, ws.deterministic_description, n.stable_key
       FROM workflow_steps ws
       LEFT JOIN graph_nodes n ON n.id = ws.node_id
       WHERE ws.workflow_id = $1
       ORDER BY ws.step_order ASC`,
      [workflowId],
    );

    type StepRow = {
      step_order: number; file_path: string; symbol_name: string | null;
      line_start: number | null; line_end: number | null;
      step_kind: string; deterministic_description: string; stable_key: string | null;
    };
    const steps = stepsResult.rows as StepRow[];

    // One node per distinct file on the path; directed edges between
    // consecutive steps
    const nodeMap = new Map<string, { id: string; label: string; kind: string; filePath: string; metadata: { exportedSymbols: string[]; importCount: number; dependentCount: number } }>();
    const edges: Array<{ id: string; source: string; target: string; kind: string }> = [];
    const edgeSet = new Set<string>();
    let previousId: string | null = null;

    for (const step of steps) {
      const nodeId = step.stable_key ?? step.file_path;
      if (!nodeMap.has(nodeId)) {
        const base = step.file_path.split('/').pop() ?? step.file_path;
        nodeMap.set(nodeId, {
          id: nodeId,
          label: step.symbol_name ?? base,
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
        nodeId: s.stable_key ?? s.file_path,
      })),
      graph: { nodes, edges, entryPoints: firstNode },
    });
  } catch (err) {
    console.error("Graph workflow path error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Node detail: accepts either the graph_nodes UUID or a stable_key (the id
// the frontend graph views use), scoped to the latest complete snapshot.
// Enriched with connected workflows and the critical-ranking score.
graphRouter.get("/nodes/:nodeId", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;
    const nodeId = req.params.nodeId;

    const snapshotId = await latestCompleteSnapshotId(projectId);
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

    const [workflowsResult, rankingResult] = await Promise.all([
      query(
        `SELECT DISTINCT w.id, w.title, w.trigger_type
         FROM workflow_steps ws
         JOIN workflows w ON w.id = ws.workflow_id
         WHERE ws.node_id = $1`,
        [node.id],
      ),
      query(
        `SELECT composite_score, scores, ranking_reasons
         FROM critical_rankings
         WHERE snapshot_id = $1 AND target_id = $2 AND role = 'general'
         LIMIT 1`,
        [snapshotId, node.id],
      ),
    ]);

    const ranking = rankingResult.rows[0] as
      | { composite_score: string | number; scores: Record<string, number>; ranking_reasons: string[] }
      | undefined;

    res.json({
      node: {
        ...node,
        connected_workflows: workflowsResult.rows,
        composite_score: ranking ? Number(ranking.composite_score) : null,
        ranking_reasons: ranking?.ranking_reasons ?? [],
      },
    });
  } catch (err) {
    console.error("Graph node detail error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
