/**
 * Role projections over multi-view criticality scores (doc/Pipeline.md
 * "Weight configs and projections"). Raw view scores are stored once;
 * a role's ranking is a weighted sum computed at read time, so
 * re-weighting is instant and never re-runs analysis.
 */

import { query } from '../../lib/db.js';

export type SemanticView =
  | 'critical_for_runtime' | 'critical_for_business' | 'critical_for_onboarding'
  | 'critical_for_role' | 'critical_for_change_risk' | 'critical_for_architecture'
  | 'critical_for_workflow';

export type DeveloperRole = 'backend' | 'frontend' | 'devops' | 'qa' | 'general';

export const SEMANTIC_VIEWS: SemanticView[] = [
  'critical_for_runtime', 'critical_for_business', 'critical_for_onboarding',
  'critical_for_role', 'critical_for_change_risk', 'critical_for_architecture',
  'critical_for_workflow',
];

/** Spec default weight table (each role's column sums to 1.0). */
export const DEFAULT_ROLE_WEIGHTS: Record<DeveloperRole, Record<SemanticView, number>> = {
  backend: {
    critical_for_runtime: 0.20, critical_for_business: 0.10, critical_for_onboarding: 0.15,
    critical_for_role: 0.25, critical_for_change_risk: 0.10, critical_for_architecture: 0.10,
    critical_for_workflow: 0.10,
  },
  frontend: {
    critical_for_runtime: 0.10, critical_for_business: 0.15, critical_for_onboarding: 0.20,
    critical_for_role: 0.25, critical_for_change_risk: 0.05, critical_for_architecture: 0.15,
    critical_for_workflow: 0.10,
  },
  devops: {
    critical_for_runtime: 0.20, critical_for_business: 0.05, critical_for_onboarding: 0.10,
    critical_for_role: 0.25, critical_for_change_risk: 0.20, critical_for_architecture: 0.15,
    critical_for_workflow: 0.05,
  },
  qa: {
    critical_for_runtime: 0.10, critical_for_business: 0.10, critical_for_onboarding: 0.15,
    critical_for_role: 0.25, critical_for_change_risk: 0.20, critical_for_architecture: 0.05,
    critical_for_workflow: 0.15,
  },
  general: {
    critical_for_runtime: 0.15, critical_for_business: 0.20, critical_for_onboarding: 0.25,
    critical_for_role: 0.10, critical_for_change_risk: 0.10, critical_for_architecture: 0.15,
    critical_for_workflow: 0.05,
  },
};

/**
 * Loads a project's custom weights for a role, falling back to code
 * defaults; a ranking_weight_configs row exists only when customized.
 */
export async function resolveRoleWeights(projectId: string, role: DeveloperRole): Promise<Record<SemanticView, number>> {
  const result = await query(
    `SELECT weights FROM ranking_weight_configs WHERE project_id = $1 AND role = $2`,
    [projectId, role],
  );
  const custom = (result.rows[0] as { weights?: Record<string, unknown> } | undefined)?.weights;
  if (!custom || typeof custom !== 'object') return DEFAULT_ROLE_WEIGHTS[role];
  const merged = { ...DEFAULT_ROLE_WEIGHTS[role] };
  for (const view of SEMANTIC_VIEWS) {
    const value = custom[view];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) merged[view] = value;
  }
  return merged;
}

/** viewScores: view -> [0,1]; critical_for_role must already be the role's own row. */
export function projectRoleScore(
  viewScores: Partial<Record<SemanticView, number>>,
  weights: Record<SemanticView, number>,
): number {
  let score = 0;
  for (const view of SEMANTIC_VIEWS) {
    score += (viewScores[view] ?? 0) * weights[view];
  }
  return score;
}
