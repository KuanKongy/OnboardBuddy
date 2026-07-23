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

/**
 * Area = first three path segments of the target's file part
 * ("frontend/src/pages", "backend/src/worker") — the granularity at which
 * ranking bias showed up (a wall of page components).
 */
function areaOf(stableKey: string): string {
  const filePart = stableKey.split('#')[0]!;
  return filePart.split('/').slice(0, 3).join('/');
}

/** Max share of one area in a selection before further picks defer. */
const AREA_SHARE_CAP = 0.4;

/**
 * Top-score-first selection with an area diversity cap: once an area holds
 * ≥40% of the picks (and at least 2), further candidates from it defer to
 * the best-scored targets from other areas. If the cap can't be filled from
 * elsewhere, deferred candidates backfill — the size contract never shrinks.
 * Rationale: signal bias made role=general's top symbols 100% UI pages while
 * the analysis pipeline (the codebase's core) never surfaced; a learning
 * path must span the codebase's areas, not one directory's.
 */
function selectWithAreaCap(targets: ProjectedTarget[], take: number): ProjectedTarget[] {
  const picked: ProjectedTarget[] = [];
  const deferred: ProjectedTarget[] = [];
  const perArea = new Map<string, number>();
  for (const target of targets) {
    if (picked.length >= take) break;
    const area = areaOf(target.stableKey);
    const count = perArea.get(area) ?? 0;
    if (count >= 2 && count + 1 > take * AREA_SHARE_CAP) {
      deferred.push(target);
      continue;
    }
    perArea.set(area, count + 1);
    picked.push(target);
  }
  for (const target of deferred) {
    if (picked.length >= take) break;
    picked.push(target);
  }
  return picked.sort((a, b) => b.score - a.score);
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
    // Diversity applies where areas exist (files/symbols); workflow and
    // cluster keys aren't path-shaped.
    result.set(
      type,
      type === 'file' || type === 'symbol' ? selectWithAreaCap(targets, take) : targets.slice(0, take),
    );
  }
  return result;
}
