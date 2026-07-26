/**
 * The Help-page answer to "how is critical code ranked". It is the only place
 * ranking is described in prose now: every score in the product carries its own
 * derivation from the API (see `ScoreProvenance`).
 *
 * This string used to be attached, verbatim, to the Info icon beside FOUR
 * different numbers — architecture criticality, workflow rank, symbol
 * importance and the coverage strip — and it described none of them. It names
 * the seven semantic views, which are Phase B and produce the reading order
 * inside a package; the numbers it was attached to all come from the Phase A
 * candidate ranking, whose nine signals are different signals entirely. A
 * reader who checked one against the other found no relationship, which is
 * exactly what a transparency affordance must never do.
 */
export const RANKING_EXPLANATION =
  "Ranking runs in two passes. Pass A is deterministic and runs before any AI call: nine measured signals — workflow participation, fan-in/out, exported surface, side effects, entry points, route/schema ownership, tests, config reads, and 90-day churn — each normalized against the highest value in the same snapshot, then weighted. That is the number behind every criticality bar on the Architecture, Workflows and Dependencies tabs, and hovering any of them shows its own signal-by-signal breakdown. Pass B re-ranks what survived across seven views (runtime, business, onboarding, role fit, change risk, architecture, workflow) to order the reading path inside an onboarding package; those weights are adjustable per role in Project Settings.";
