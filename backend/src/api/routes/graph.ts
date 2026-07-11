import { Router } from "express";
import { query } from "../../lib/db.js";
import { requireProjectAccess } from "../middleware/project-access.js";

export const graphRouter = Router({ mergeParams: true });

const MAX_GRAPH_NODES = 60;

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
        externalImportCount: (n.metadata?.externalImportCount as number) ?? 0,
        dependentCount: (n.metadata?.dependentCount as number) ?? 0,
      },
    }));

    const edges = allEdges
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

// Architecture map from the server-side deterministic clustering
// (architecture_clusters/-edges, Phase 3), enriched with the semantic module
// record summary where one exists. Replaces the old client-side grouping.
graphRouter.get("/architecture", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    const snapshotId = await latestCompleteSnapshotId(projectId);
    if (!snapshotId) {
      res.status(404).json({ error: "No completed analysis snapshot found" });
      return;
    }

    const [clustersResult, edgesResult, membersResult, recordsResult] = await Promise.all([
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

    const clusters = (clustersResult.rows as Array<{
      id: string; stable_key: string; label: string; kind: string;
      critical_score: string | number; deterministic_summary: string | null;
      metadata: Record<string, unknown>;
    }>).map((c) => ({
      id: c.stable_key,
      label: c.label,
      kind: c.kind,
      criticalScore: Number(c.critical_score),
      summary: recordByCluster.get(c.stable_key)?.summary ?? c.deterministic_summary ?? "",
      summarySource: recordByCluster.has(c.stable_key) ? "semantic" : "deterministic",
      confidence: recordByCluster.get(c.stable_key)?.confidence ?? null,
      members: membersByCluster.get(c.stable_key) ?? [],
      metadata: c.metadata,
    }));

    const edges = (edgesResult.rows as Array<{
      id: string; source_key: string; target_key: string; type: string; weight: string | number;
    }>).map((e) => ({
      id: e.id,
      source: e.source_key,
      target: e.target_key,
      kind: e.type,
      weight: Number(e.weight),
    }));

    res.json({ projectId, snapshotId, clusters, edges });
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

    const ranking = rankingResult.rows[0] as
      | { composite_score: string | number; scores: Record<string, number>; ranking_reasons: string[] }
      | undefined;
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
        ranking_reasons: ranking?.ranking_reasons ?? [],
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
