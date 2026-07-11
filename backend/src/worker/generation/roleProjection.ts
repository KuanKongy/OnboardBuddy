/**
 * Role projections over stored Phase B view scores (doc/Pipeline.md
 * "Weight configs and projections"): a role's ranking is a weighted sum
 * computed at read time. "Critical 25%" = top 25% of targets per
 * target_type by the role projection.
 */

import { query } from '../../lib/db.js';
import {
  resolveRoleWeights, projectRoleScore,
  type DeveloperRole, type SemanticView,
} from '../semantic/projections.js';

export interface ProjectedTarget {
  targetType: string;
  stableKey: string;
  score: number;
  reasons: string[];
  viewScores: Partial<Record<SemanticView, number>>;
}

/** Projects every semantically-ranked target for `role`, best first. */
export async function loadRoleProjections(
  snapshotId: string,
  projectId: string,
  role: DeveloperRole,
): Promise<ProjectedTarget[]> {
  const weights = await resolveRoleWeights(projectId, role);
  const rows = (await query(
    `SELECT target_type, stable_key, view, score, reasons FROM criticality_scores
     WHERE snapshot_id = $1 AND phase = 'semantic' AND (role IS NULL OR role = $2)`,
    [snapshotId, role],
  )).rows as Array<{ target_type: string; stable_key: string; view: SemanticView; score: string; reasons: string[] }>;

  const byTarget = new Map<string, ProjectedTarget>();
  for (const row of rows) {
    const key = `${row.target_type}:${row.stable_key}`;
    let target = byTarget.get(key);
    if (!target) {
      target = { targetType: row.target_type, stableKey: row.stable_key, score: 0, reasons: [], viewScores: {} };
      byTarget.set(key, target);
    }
    target.viewScores[row.view] = Number(row.score);
    for (const reason of row.reasons ?? []) {
      if (!target.reasons.includes(reason)) target.reasons.push(reason);
    }
  }
  const projected = [...byTarget.values()];
  for (const target of projected) {
    target.score = projectRoleScore(target.viewScores, weights);
  }
  return projected.sort((a, b) => b.score - a.score);
}

/** Top 25% (at least `minPerType`) per target_type — the "Critical 25%". */
export function critical25(
  projected: ProjectedTarget[],
  minPerType = 3,
): Map<string, ProjectedTarget[]> {
  const byType = new Map<string, ProjectedTarget[]>();
  for (const target of projected) {
    if (!byType.has(target.targetType)) byType.set(target.targetType, []);
    byType.get(target.targetType)!.push(target);
  }
  const result = new Map<string, ProjectedTarget[]>();
  for (const [type, targets] of byType) {
    const take = Math.max(minPerType, Math.ceil(targets.length * 0.25));
    result.set(type, targets.slice(0, take));
  }
  return result;
}
