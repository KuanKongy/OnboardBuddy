import type { DependencyGraph, FileAnalysis } from '../types/analysis.js';
import { query } from '../../lib/db.js';

export interface CriticalRanking {
  targetType: string;
  targetId: string;
  nodeStableKey: string;
  role: string;
  compositeScore: number;
  scores: {
    fanIn: number;
    fanOut: number;
    exportCount: number;
    isEntrypoint: number;
    hasSideEffects: number;
  };
  reasons: string[];
}

const ROLES = ['backend', 'frontend', 'devops', 'qa', 'general'] as const;

const ROLE_FILE_PATTERNS: Record<string, RegExp[]> = {
  backend: [/api|route|controller|service|middleware|db|model|query/i],
  frontend: [/component|page|view|hook|store|style|layout/i],
  devops: [/docker|ci|deploy|infra|terraform|k8s|helm|config/i],
  qa: [/test|spec|mock|fixture|e2e|cypress|jest/i],
  general: [/.*/],
};

export function rankCriticalFiles(
  fileAnalyses: FileAnalysis[],
  graph: DependencyGraph,
  entrypointKeys: Set<string>,
  sideEffectKeys: Set<string>,
): CriticalRanking[] {
  const rankings: CriticalRanking[] = [];

  const fanInMap = new Map<string, number>();
  const fanOutMap = new Map<string, number>();
  for (const edge of graph.edges) {
    fanInMap.set(edge.target, (fanInMap.get(edge.target) ?? 0) + 1);
    fanOutMap.set(edge.source, (fanOutMap.get(edge.source) ?? 0) + 1);
  }

  for (const fa of fileAnalyses) {
    const key = fa.relativePath;
    const exportedCount = fa.symbols.filter((s) => s.exported).length;
    const fanIn = fanInMap.get(key) ?? 0;
    const fanOut = fanOutMap.get(key) ?? 0;
    const isEntry = entrypointKeys.has(key) ? 1 : 0;
    const hasSideEffects = sideEffectKeys.has(key) ? 1 : 0;

    for (const role of ROLES) {
      const patterns = ROLE_FILE_PATTERNS[role]!;
      const roleRelevance = patterns.some((p) => p.test(key)) ? 1.0 : 0.3;

      const scores = {
        fanIn: Math.min(fanIn / 10, 1.0),
        fanOut: Math.min(fanOut / 15, 1.0),
        exportCount: Math.min(exportedCount / 10, 1.0),
        isEntrypoint: isEntry,
        hasSideEffects,
      };

      const composite =
        (scores.fanIn * 0.25 +
          scores.fanOut * 0.15 +
          scores.exportCount * 0.2 +
          scores.isEntrypoint * 0.25 +
          scores.hasSideEffects * 0.15) * roleRelevance;

      const reasons: string[] = [];
      if (fanIn >= 5) reasons.push(`High fan-in: ${fanIn} dependents`);
      if (exportedCount >= 5) reasons.push(`Exports ${exportedCount} symbols`);
      if (isEntry) reasons.push('Entry point');
      if (hasSideEffects) reasons.push('Has side effects');

      if (composite > 0.15) {
        rankings.push({
          targetType: 'file',
          targetId: key,
          nodeStableKey: key,
          role,
          compositeScore: Math.round(composite * 1000) / 1000,
          scores,
          reasons,
        });
      }
    }
  }

  return rankings
    .sort((a, b) => b.compositeScore - a.compositeScore);
}

// Writes Phase A deterministic candidate scores (criticality_scores with
// phase='candidate', view='candidate'). Phase B semantic views land later.
export async function persistRankings(
  snapshotId: string,
  rankings: CriticalRanking[],
  nodeIdMap: Map<string, string>,
): Promise<void> {
  const top = rankings.slice(0, 200);

  for (const r of top) {
    const nodeId = nodeIdMap.get(r.nodeStableKey);
    if (!nodeId) continue;

    await query(
      `INSERT INTO criticality_scores
         (snapshot_id, phase, view, target_type, target_node_id, stable_key, role, score, score_breakdown, reasons)
       VALUES ($1, 'candidate', 'candidate', $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (snapshot_id, phase, view, target_type, stable_key, COALESCE(role, ''))
       DO UPDATE SET score = EXCLUDED.score, score_breakdown = EXCLUDED.score_breakdown,
                     reasons = EXCLUDED.reasons, target_node_id = EXCLUDED.target_node_id`,
      [
        snapshotId,
        r.targetType,
        nodeId,
        r.nodeStableKey,
        r.role,
        r.compositeScore,
        JSON.stringify(r.scores),
        r.reasons,
      ],
    );
  }
}
