import { Router } from "express";
import { requireProjectAccess } from "../middleware/project-access.js";

export const graphRouter = Router({ mergeParams: true });

// GET /api/projects/:id/graph/dependencies?role=<role>
// Returns the file-level import dependency graph for a project, optionally
// filtered to the files most relevant for a given developer role.
graphRouter.get("/dependencies", requireProjectAccess(), async (req, res) => {
  // const projectId = req.params.id;
  // const role = (req.query.role as string) ?? "general";
  //
  // const snapshotResult = await query(
  //   `SELECT s.id FROM analysis_snapshots s
  //    WHERE s.project_id = $1
  //    ORDER BY s.created_at DESC LIMIT 1`,
  //   [projectId],
  // );
  // if (snapshotResult.rows.length === 0) {
  //   res.status(404).json({ error: "No analysis snapshot found for this project" });
  //   return;
  // }
  // const snapshotId = snapshotResult.rows[0].id;
  //
  // const [nodesResult, edgesResult] = await Promise.all([
  //   query(
  //     `SELECT id, label, kind, exported_symbols, import_count, dependent_count, is_entry_point
  //      FROM graph_nodes WHERE snapshot_id = $1`,
  //     [snapshotId],
  //   ),
  //   query(
  //     `SELECT id, source_node_id AS source, target_node_id AS target, kind
  //      FROM graph_edges WHERE snapshot_id = $1`,
  //     [snapshotId],
  //   ),
  // ]);
  //
  // const entryPoints = nodesResult.rows
  //   .filter((n) => n.is_entry_point)
  //   .map((n) => n.id);
  //
  // res.json({
  //   projectId,
  //   snapshotId,
  //   graph: {
  //     nodes: nodesResult.rows.map((n) => ({
  //       id: n.id,
  //       label: n.label,
  //       kind: n.kind,
  //       metadata: {
  //         exportedSymbols: n.exported_symbols ?? [],
  //         importCount: n.import_count,
  //         dependentCount: n.dependent_count,
  //       },
  //     })),
  //     edges: edgesResult.rows,
  //     entryPoints,
  //   },
  //   fileAnalyses: [], // TODO: join file_analyses table once schema is finalised
  // });

  res.status(501).json({ error: "Not implemented — analysis pipeline pending" });
});

// GET /api/projects/:id/graph/classes?role=<role>
// Returns the class and interface inheritance/composition graph.
graphRouter.get("/classes", requireProjectAccess(), async (req, res) => {
  // const projectId = req.params.id;
  // const role = (req.query.role as string) ?? "general";
  // TODO: query class_nodes / class_edges tables once the TypeScript Compiler
  //       API extraction step emits them.

  res.status(501).json({ error: "Not implemented — analysis pipeline pending" });
});

// GET /api/projects/:id/graph/workflows/:workflowId
// Returns a single workflow graph (call-chain or data-flow) by ID.
graphRouter.get("/workflows/:workflowId", requireProjectAccess(), async (req, res) => {
  // const projectId = req.params.id;
  // const workflowId = req.params.workflowId;
  // TODO: query workflow_graphs table.

  res.status(501).json({ error: "Not implemented — analysis pipeline pending" });
});

// GET /api/projects/:id/graph/nodes/:nodeId
// Returns full detail for a single graph node: symbols, imports, git churn, coverage.
graphRouter.get("/nodes/:nodeId", requireProjectAccess(), async (req, res) => {
  // const projectId = req.params.id;
  // const nodeId = req.params.nodeId;
  //
  // const result = await query(
  //   `SELECT gn.*, fa.symbols, fa.imports
  //    FROM graph_nodes gn
  //    LEFT JOIN file_analyses fa ON fa.node_id = gn.id
  //    WHERE gn.id = $1`,
  //   [nodeId],
  // );
  // if (result.rows.length === 0) {
  //   res.status(404).json({ error: "Node not found" });
  //   return;
  // }
  // res.json({ node: result.rows[0] });

  res.status(501).json({ error: "Not implemented — analysis pipeline pending" });
});
