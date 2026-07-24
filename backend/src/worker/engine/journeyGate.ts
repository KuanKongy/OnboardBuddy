import type { ExtractedWorkflow } from './workflowExtractor.js';
import type { DetectedEntrypoint } from './entrypointDetector.js';
import type { DetectedSideEffect } from './sideEffectDetector.js';
import { normalizeQueueToken } from './sideEffectDetector.js';

/**
 * Golden-journey validation gate (doc/ONBOARDING_UX_GOALS.md item 7): where
 * the repo's shape makes a journey DETECTABLE, its absence is an extraction
 * failure — recorded as a snapshot unknown (trust panel), never silent. The
 * checks are shape-conditional, so repos without queues/auth/compose are
 * never penalized for not having them.
 */

export interface JourneyGateInput {
  /** Full persisted set: code workflows + config journeys + composed journeys. */
  workflows: ExtractedWorkflow[];
  entrypoints: DetectedEntrypoint[];
  sideEffects: DetectedSideEffect[];
  hasCompose: boolean;
}

export interface JourneyGateResult {
  /** Which detectable golden shapes were satisfied (metrics). */
  passes: string[];
  /** Unknowns-shaped gap records for the snapshot. */
  gaps: Array<Record<string, unknown>>;
}

export function validateGoldenJourneys(input: JourneyGateInput): JourneyGateResult {
  const passes: string[] = [];
  const gaps: Array<Record<string, unknown>> = [];
  const journeys = input.workflows.filter((w) => w.triggerType === 'journey');
  const goldenKinds = new Set(journeys.map((w) =>
    (w.metadata?.journey as { golden_kind?: string } | undefined)?.golden_kind));

  // 1. Queue pipelines: a consumer whose queue some workflow demonstrably
  //    enqueues into must be spanned by a pipeline journey.
  const consumerTokens = new Set(
    input.entrypoints
      .filter((e) => e.kind === 'message_consumer')
      .map((e) => normalizeQueueToken(e.routePattern ?? ''))
      .filter(Boolean),
  );
  const producedTokens = new Set(
    input.sideEffects
      .filter((e) => e.kind === 'message_publish' && e.queueHint)
      .map((e) => e.queueHint!),
  );
  const spannedTokens = new Set<string>();
  for (const j of journeys) {
    const boundaries = (j.metadata?.journey as { boundaries?: Array<{ kind: string; detail: string }> } | undefined)?.boundaries ?? [];
    for (const b of boundaries) {
      if (b.kind !== 'queue') continue;
      const m = b.detail.match(/queue '([^']+)'/);
      if (m) spannedTokens.add(m[1]!);
    }
  }
  for (const token of consumerTokens) {
    if (!producedTokens.has(token)) continue; // producer side undetectable — not a gate case
    if (spannedTokens.has(token)) passes.push(`queue_pipeline:${token}`);
    else gaps.push({ kind: 'journey_gap', expected: 'queue_pipeline', queue: token });
  }

  // 2. Auth: ≥2 auth-shaped route workflows -> an auth journey must exist.
  const authRoutes = input.workflows.filter((w) =>
    w.triggerType !== 'journey'
    && w.entrypoint.kind === 'http_route'
    && /\/(auth|login|logout|signup|signin|session|register)(\/|$)/i.test(w.entrypoint.routePattern ?? ''));
  if (authRoutes.length >= 2) {
    if (goldenKinds.has('auth')) passes.push('auth');
    else gaps.push({ kind: 'journey_gap', expected: 'auth', detected_routes: authRoutes.length });
  }

  // 3. Import/OAuth chain: ≥2 oauth/installation route workflows -> import journey.
  const importRoutes = input.workflows.filter((w) =>
    w.triggerType !== 'journey'
    && w.entrypoint.kind === 'http_route'
    && /oauth|installation/i.test(w.entrypoint.routePattern ?? ''));
  if (importRoutes.length >= 2) {
    if (goldenKinds.has('import')) passes.push('import');
    else gaps.push({ kind: 'journey_gap', expected: 'import', detected_routes: importRoutes.length });
  }

  // 4. Local dev: a compose file was parsed -> the dev journey must exist.
  if (input.hasCompose) {
    const devJourney = input.workflows.some((w) =>
      w.triggerType === 'dev_command' && w.metadata?.config_flow === 'compose_up');
    if (devJourney) passes.push('local_dev');
    else gaps.push({ kind: 'journey_gap', expected: 'local_dev' });
  }

  return { passes, gaps };
}
