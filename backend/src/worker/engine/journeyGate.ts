import type { ExtractedWorkflow } from './workflowExtractor.js';
import type { DetectedEntrypoint } from './entrypointDetector.js';
import type { DetectedSideEffect } from './sideEffectDetector.js';
import { normalizeQueueToken } from './sideEffectDetector.js';
import { detectableBoundaryKinds, type JourneySnippetNode } from './journeyComposer.js';

/**
 * Golden-journey validation gate (doc/ONBOARDING_UX_GOALS.md item 7): where
 * the repo's shape makes a journey DETECTABLE, its absence is an extraction
 * failure — recorded as a snapshot unknown (trust panel), never silent. The
 * checks are shape-conditional, so repos without the signals are never
 * penalized for not having them.
 *
 * Reframed with doc/TUTORIAL_REDESIGN.md §1.3: checks 2 and 3 used to re-run
 * the composer's auth/import ROUTE-NAME regexes, which was the same hardcoding
 * one layer down. They are now one check over the composer's own boundary
 * detectors — "a boundary kind this repo demonstrably has must be spanned by a
 * journey" — so a repo whose multi-step story is a socket protocol or a
 * resource lifecycle is held to the same standard as one with an HTTP login.
 */

export interface JourneyGateInput {
  /** Full persisted set: code workflows + config journeys + composed journeys. */
  workflows: ExtractedWorkflow[];
  entrypoints: DetectedEntrypoint[];
  sideEffects: DetectedSideEffect[];
  /** Verified snippet bytes; without them the literal-scanning kinds stay undetectable. */
  nodes?: JourneySnippetNode[];
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
  const spannedBoundaries: Array<{ kind: string; token?: string; detail: string }> = [];
  for (const j of journeys) {
    const boundaries = (j.metadata?.journey as {
      boundaries?: Array<{ kind: string; token?: string; detail: string }>;
    } | undefined)?.boundaries ?? [];
    spannedBoundaries.push(...boundaries);
  }

  // 1. Hand-off pipelines: a consumer whose token some workflow demonstrably
  //    publishes into must be spanned by a journey. Unchanged in spirit.
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
  for (const b of spannedBoundaries) {
    // `token` is the current contract; the detail regex keeps pre-v4 rows
    // ('queue' boundaries, token only in the prose) readable.
    if (b.kind === 'async_token' && b.token) { spannedTokens.add(b.token); continue; }
    if (b.kind !== 'queue' && b.kind !== 'async_token') continue;
    const m = b.detail.match(/queue '([^']+)'/);
    if (m) spannedTokens.add(m[1]!);
  }
  for (const token of consumerTokens) {
    if (!producedTokens.has(token)) continue; // producer side undetectable — not a gate case
    if (spannedTokens.has(token)) passes.push(`queue_pipeline:${token}`);
    else gaps.push({ kind: 'journey_gap', expected: 'queue_pipeline', queue: token });
  }

  // 2. Every other boundary kind the repo demonstrably has must be spanned by
  //    a journey. This replaces the auth-route and oauth-route regexes: the
  //    predicate is now "the composer's detectors found this signal at a
  //    confidence that could start a journey", so no product vocabulary is
  //    involved and a repo without the signal is never asked for it.
  const detectable = detectableBoundaryKinds({
    workflows: input.workflows,
    sideEffects: input.sideEffects,
    ...(input.nodes ? { nodes: input.nodes } : {}),
  });
  const spannedKinds = new Set(spannedBoundaries.map((b) => b.kind));
  for (const kind of detectable) {
    if (kind === 'async_token') continue; // covered by check 1, with its token
    if (spannedKinds.has(kind)) passes.push(`boundary:${kind}`);
    else gaps.push({ kind: 'journey_gap', expected: 'boundary_chain', boundary_kind: kind });
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
