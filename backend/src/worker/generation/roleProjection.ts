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
  /**
   * Whether the target has behavioural content (Phase A
   * `CandidateRanking.behavioral`). Only `false` demotes: a target with no
   * stored candidate row, and every snapshot analysed before the flag existed,
   * reads as behavioural rather than being demoted on missing data.
   */
  behavioral?: boolean;
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

  // Phase A recorded, per target, whether it has behavioural content. Only
  // the non-behavioural ones are fetched — the set is small (declarations),
  // and absence then correctly means "behavioural, or never ranked".
  const declarationOnly = new Set(
    ((await query(
      `SELECT target_type, stable_key FROM criticality_scores
       WHERE snapshot_id = $1 AND phase = 'candidate' AND view = 'candidate'
         AND score_breakdown->>'behavioral' = 'false'`,
      [snapshotId],
    )).rows as Array<{ target_type: string; stable_key: string }>)
      .map((r) => `${r.target_type}:${r.stable_key}`),
  );

  const byTarget = new Map<string, ProjectedTarget>();
  for (const row of rows) {
    const key = `${row.target_type}:${row.stable_key}`;
    let target = byTarget.get(key);
    if (!target) {
      target = {
        targetType: row.target_type, stableKey: row.stable_key, score: 0,
        reasons: [], viewScores: {}, behavioral: !declarationOnly.has(key),
      };
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
  // Behaviour before score: re-sorting on score alone would undo the quality
  // floor in the emitted order, putting a high-scoring type declaration above
  // the code that runs.
  return picked.sort((a, b) =>
    Number(b.behavioral !== false) - Number(a.behavioral !== false) || b.score - a.score);
}

/**
 * Structural quality floor: everything that runs is offered before anything
 * that only declares.
 *
 * Critical 25% answers "what should I read first", and a bare `interface`, a
 * type alias or a const literal is not an answer to it — on a thin repo where
 * `exportedSurface` was the only signal anything scored on, half the slice came
 * back as one types file's declarations while the components that render the
 * product sat below them.
 *
 * RELATIVE, never an exclusion. Declarations are not dropped, they are
 * deferred: if the behavioural targets run out, they fill the rest of the
 * quota, so the size contract holds and a types-only package — where the
 * interfaces ARE the content — is selected exactly as before.
 */
function behaviourFirst(targets: ProjectedTarget[]): ProjectedTarget[] {
  const behavioural = targets.filter((t) => t.behavioral !== false);
  if (behavioural.length === targets.length) return targets;
  return [...behavioural, ...targets.filter((t) => t.behavioral === false)];
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
    // The quota is a share of ALL targets of this type, computed before the
    // floor reorders them: the floor decides who fills the slice, never how
    // big it is.
    const ordered = behaviourFirst(targets);
    // Diversity applies where areas exist (files/symbols); workflow and
    // cluster keys aren't path-shaped.
    result.set(
      type,
      type === 'file' || type === 'symbol' ? selectWithAreaCap(ordered, take) : ordered.slice(0, take),
    );
  }
  return result;
}
