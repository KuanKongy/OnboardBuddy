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

/**
 * Default weight table (each role's column sums to 1.0 — asserted in
 * `phase5.test.ts` and again by `npm run role-census`, because a column that
 * does not sum to 1 makes every cross-role score comparison meaningless).
 *
 * The tuning below is the weights half of doc/ROLE_DIFFERENTIATION_PLAN.md:
 * where that plan says a surface is differentiated "by weights", this is the
 * whole mechanism, so each move names the view it shifts and the signature it
 * is meant to produce. `general` is the calibrated baseline and is deliberately
 * untouched — every role census is measured as a delta from it, so moving it
 * would move the yardstick and the diffs at the same time.
 *
 * Every move is ±0.05 and paid for by another view in the same column. Larger
 * jumps were rejected: `critical_for_role` is already the single heaviest term
 * for all four specialist roles, and stacking more on top of it collapses the
 * ranking onto one LLM-scored view.
 */
export const DEFAULT_ROLE_WEIGHTS: Record<DeveloperRole, Record<SemanticView, number>> = {
  backend: {
    // runtime 0.20 → 0.25: "what breaks the app when wrong" is the view that
    // separates request handling, workers and queues from page rendering, and
    // it pays for the plan's backend signature — top-10 files under 50%
    // frontend/*. onboarding 0.15 → 0.10 funds it: that view up-ranks READMEs
    // and entry pages (it is general's heaviest column at 0.25), which is a
    // reading-order need backend already gets from ROLE_READING_ORDER.
    critical_for_runtime: 0.25, critical_for_business: 0.10, critical_for_onboarding: 0.10,
    critical_for_role: 0.25, critical_for_change_risk: 0.10, critical_for_architecture: 0.10,
    critical_for_workflow: 0.10,
  },
  frontend: {
    // business 0.15 → 0.20: user-facing capability is where a UI surface earns
    // its rank, and the plan's frontend signature (≥2 of the top-10 symbols
    // from ui clusters) has to come from a view that scores product value, not
    // coupling. architecture 0.15 → 0.10 funds it: boundary and coupling
    // importance is dominated by server clusters, so it was quietly pulling
    // frontend's ranking back toward the backend.
    critical_for_runtime: 0.10, critical_for_business: 0.20, critical_for_onboarding: 0.20,
    critical_for_role: 0.25, critical_for_change_risk: 0.05, critical_for_architecture: 0.10,
    critical_for_workflow: 0.10,
  },
  devops: {
    // change_risk 0.20 → 0.25: operational risk and invariants — env handling,
    // secrets, budgets, kill switches, deploy config — is the devops reading,
    // and it becomes this column's second-heaviest view behind role fit.
    // onboarding 0.10 → 0.05 funds it: a newcomer-first ordering is the one
    // thing an operator does not need from the ranking.
    critical_for_runtime: 0.20, critical_for_business: 0.05, critical_for_onboarding: 0.05,
    critical_for_role: 0.25, critical_for_change_risk: 0.25, critical_for_architecture: 0.15,
    critical_for_workflow: 0.05,
  },
  qa: {
    // workflow 0.15 → 0.20: the plan gives qa a workflow floor in the Critical
    // 25%, and a floor that is only structural would leave the flows it admits
    // ordered by someone else's priorities. `critical_for_workflow` is the view
    // that ranks flows, so qa earns the emphasis by weight and the floor only
    // has to guarantee presence. onboarding 0.15 → 0.10 funds it, for the same
    // reason as backend: reading order already carries that need.
    critical_for_runtime: 0.10, critical_for_business: 0.10, critical_for_onboarding: 0.10,
    critical_for_role: 0.25, critical_for_change_risk: 0.20, critical_for_architecture: 0.05,
    critical_for_workflow: 0.20,
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
