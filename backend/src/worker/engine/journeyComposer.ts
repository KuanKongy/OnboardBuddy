import type { ExtractedWorkflow, WorkflowStep } from './workflowExtractor.js';
import type { DetectedSideEffect } from './sideEffectDetector.js';
import { normalizeQueueToken } from './sideEffectDetector.js';

/**
 * Journey composition (doc/ONBOARDING_UX_GOALS.md "Data-acquisition rethink"
 * item 3): deterministic stitching of route-level workflows into the product
 * journeys a team lead would whiteboard — across queue boundaries
 * (enqueue -> consumer), OAuth chains, and capability groups. Journeys are
 * persisted as workflow rows (trigger_type 'journey') so ranking, selection,
 * and the workflows tab consume them with zero new machinery; members stay
 * as the drill-down layer.
 *
 * Composition is graph-shaped, never guessed: a queue boundary requires a
 * matching producer hint and consumer entrypoint; groups require route/purpose
 * agreement. When nothing matches, no journey is invented.
 */

export interface JourneyBoundary {
  /** Index into members: the boundary sits AFTER this member. */
  after: number;
  kind: 'queue' | 'redirect' | 'group';
  detail: string;
}

export interface ComposeJourneysInput {
  workflows: ExtractedWorkflow[];
  sideEffects: DetectedSideEffect[];
}

const MAX_JOURNEY_STEPS = 14;

export function composeJourneys(input: ComposeJourneysInput): ExtractedWorkflow[] {
  // Only code-level workflows participate; config journeys (dev_command,
  // ci_pipeline) already ARE journeys, and nesting journeys is meaningless.
  const pool = input.workflows.filter(
    (w) => !['journey', 'dev_command', 'ci_pipeline'].includes(w.triggerType),
  );
  const journeys: ExtractedWorkflow[] = [];
  const claimed = new Set<string>();

  const pipelines = composeQueuePipelines(pool, input.sideEffects);
  for (const j of pipelines) {
    journeys.push(j);
    for (const m of memberKeys(j)) claimed.add(m);
  }

  const auth = composeAuthJourney(pool);
  if (auth) journeys.push(auth);

  const imports = composeImportJourney(pool);
  if (imports) journeys.push(imports);

  void claimed; // members stay listed as drill-downs; nothing is removed.
  return journeys;
}

function memberKeys(j: ExtractedWorkflow): string[] {
  const journey = j.metadata?.journey as { members?: string[] } | undefined;
  return journey?.members ?? [];
}

// ─── R1: queue-boundary pipelines (enqueue -> consumer, multi-hop) ──────────

interface QueueMaps {
  consumersByToken: Map<string, ExtractedWorkflow>;
  hintsByWorkflow: Map<string, Array<{ token: string; jobName?: string }>>;
}

function buildQueueMaps(pool: ExtractedWorkflow[], sideEffects: DetectedSideEffect[]): QueueMaps {
  const consumersByToken = new Map<string, ExtractedWorkflow>();
  for (const wf of pool) {
    if (wf.entrypoint.kind !== 'message_consumer') continue;
    const token = normalizeQueueToken(wf.entrypoint.routePattern ?? '');
    if (token && !consumersByToken.has(token)) consumersByToken.set(token, wf);
  }

  const hintsByNode = new Map<string, Array<{ token: string; jobName?: string }>>();
  const hintsByFile = new Map<string, Array<{ token: string; jobName?: string }>>();
  for (const se of sideEffects) {
    if (se.kind !== 'message_publish' || !se.queueHint) continue;
    const hint = { token: se.queueHint, jobName: se.target };
    const key = se.symbolStableKey ?? se.nodeStableKey;
    hintsByNode.set(key, [...(hintsByNode.get(key) ?? []), hint]);
    hintsByFile.set(se.filePath, [...(hintsByFile.get(se.filePath) ?? []), hint]);
  }

  const hintsByWorkflow = new Map<string, Array<{ token: string; jobName?: string }>>();
  for (const wf of pool) {
    const hints: Array<{ token: string; jobName?: string }> = [];
    const seen = new Set<string>();
    const add = (h: { token: string; jobName?: string }): void => {
      if (seen.has(h.token)) return;
      seen.add(h.token);
      hints.push(h);
    };
    for (const s of wf.steps) {
      for (const h of hintsByNode.get(s.nodeStableKey) ?? []) add(h);
    }
    // Consumer traces can hit the step cap before reaching their own
    // chain-forward enqueue — the consumer's file speaks for it (the auto-
    // chain enqueue in a worker's module IS that consumer's next hop).
    if (wf.entrypoint.kind === 'message_consumer') {
      for (const h of hintsByFile.get(wf.entrypoint.filePath) ?? []) add(h);
    }
    if (hints.length > 0) hintsByWorkflow.set(wf.stableKey, hints);
  }

  return { consumersByToken, hintsByWorkflow };
}

function composeQueuePipelines(
  pool: ExtractedWorkflow[],
  sideEffects: DetectedSideEffect[],
): ExtractedWorkflow[] {
  const { consumersByToken, hintsByWorkflow } = buildQueueMaps(pool, sideEffects);
  if (consumersByToken.size === 0) return [];

  // Starters: non-consumer workflows that enqueue into a known consumer,
  // best-ranked first. One pipeline per starting token.
  const journeys: ExtractedWorkflow[] = [];
  const usedTokens = new Set<string>();
  const starters = pool
    .filter((w) => w.entrypoint.kind !== 'message_consumer' && hintsByWorkflow.has(w.stableKey))
    .sort((a, b) => b.importanceScore - a.importanceScore);

  for (const starter of starters) {
    const firstHint = (hintsByWorkflow.get(starter.stableKey) ?? [])
      .find((h) => consumersByToken.has(h.token) && !usedTokens.has(h.token));
    if (!firstHint) continue;

    const members: ExtractedWorkflow[] = [starter];
    const boundaries: JourneyBoundary[] = [];
    let token: string | undefined = firstHint.token;
    let jobName = firstHint.jobName;
    const visited = new Set<string>();

    while (token && consumersByToken.has(token) && !visited.has(token)) {
      visited.add(token);
      usedTokens.add(token);
      const consumer: ExtractedWorkflow = consumersByToken.get(token)!;
      boundaries.push({
        after: members.length - 1,
        kind: 'queue',
        detail: `job${jobName ? ` '${jobName}'` : ''} crosses queue '${token}' to ${consumer.title}`,
      });
      members.push(consumer);
      const nextHint = (hintsByWorkflow.get(consumer.stableKey) ?? [])
        .find((h) => consumersByToken.has(h.token) && !visited.has(h.token));
      token = nextHint?.token;
      jobName = nextHint?.jobName;
    }

    if (members.length >= 2) {
      journeys.push(buildJourney({
        slug: `pipeline:${firstHint.token}`,
        title: pipelineTitle(members),
        goldenKind: 'pipeline',
        members,
        boundaries,
        confidence: 'high',
      }));
    }
  }

  return journeys;
}

function pipelineTitle(members: ExtractedWorkflow[]): string {
  const purposes = new Set(members.flatMap((m) => purposeSignalsOf(m)));
  if (purposes.has('repository_analysis') && purposes.has('onboarding_generation')) {
    return 'Analysis → onboarding generation pipeline';
  }
  if (purposes.has('repository_analysis')) return 'Repository analysis pipeline';
  if (purposes.has('onboarding_generation')) return 'Onboarding generation pipeline';
  return `${members[0]!.title} → ${members[members.length - 1]!.title}`;
}

/** Purpose signals were folded into the deterministic purpose text; recover the strong ones. */
function purposeSignalsOf(wf: ExtractedWorkflow): string[] {
  const signals: string[] = [];
  const text = `${wf.purpose} ${wf.title}`.toLowerCase();
  if (/\banaly[sz]/.test(text)) signals.push('repository_analysis');
  if (/onboarding|summary|section|package|tutorial/.test(text)) signals.push('onboarding_generation');
  if (/github|oauth|installation/.test(text)) signals.push('github_integration');
  if (/auth|login|signup|session|token/.test(text)) signals.push('authentication');
  if (/project|invitation|member/.test(text)) signals.push('project_management');
  return signals;
}

// ─── R2: auth journey (route group) ─────────────────────────────────────────

const AUTH_ROUTE = /\/(auth|login|logout|signup|signin|signout|session|register)(\/|$)/i;
const AUTH_ORDER: Array<{ pattern: RegExp; rank: number }> = [
  { pattern: /signup|register/i, rank: 0 },
  { pattern: /login|signin/i, rank: 1 },
  { pattern: /oauth|callback/i, rank: 2 },
  { pattern: /token|refresh/i, rank: 3 },
  { pattern: /\bme\b|session|user/i, rank: 4 },
  { pattern: /logout|signout/i, rank: 5 },
];

function composeAuthJourney(pool: ExtractedWorkflow[]): ExtractedWorkflow | null {
  const members = pool
    .filter((w) => w.entrypoint.kind === 'http_route'
      && AUTH_ROUTE.test(w.entrypoint.routePattern ?? ''))
    .sort((a, b) => authRank(a) - authRank(b) || (a.entrypoint.routePattern ?? '').localeCompare(b.entrypoint.routePattern ?? ''));
  if (members.length < 2) return null;

  const boundaries: JourneyBoundary[] = members.slice(0, -1).map((_, i) => ({
    after: i, kind: 'group', detail: 'same auth surface',
  }));
  return buildJourney({
    slug: 'auth',
    title: 'User authentication',
    goldenKind: 'auth',
    members,
    boundaries,
    confidence: 'medium',
  });
}

function authRank(wf: ExtractedWorkflow): number {
  const route = wf.entrypoint.routePattern ?? '';
  for (const { pattern, rank } of AUTH_ORDER) {
    if (pattern.test(route)) return rank;
  }
  return 9;
}

// ─── R3: OAuth / import chain ───────────────────────────────────────────────

const IMPORT_ROUTE = /oauth|installation|\/github(\/|$)/i;
const IMPORT_ORDER: Array<{ pattern: RegExp; rank: number }> = [
  { pattern: /start|begin|authorize/i, rank: 0 },
  { pattern: /callback|complete|exchange/i, rank: 1 },
  { pattern: /link|install/i, rank: 2 },
];

function composeImportJourney(pool: ExtractedWorkflow[]): ExtractedWorkflow | null {
  const chain = pool
    .filter((w) => w.entrypoint.kind === 'http_route'
      && IMPORT_ROUTE.test(w.entrypoint.routePattern ?? '')
      && !AUTH_ROUTE.test(w.entrypoint.routePattern ?? ''))
    .sort((a, b) => importRank(a) - importRank(b) || (a.entrypoint.routePattern ?? '').localeCompare(b.entrypoint.routePattern ?? ''));
  if (chain.length < 2) return null;

  const members = [...chain];
  const boundaries: JourneyBoundary[] = members.slice(0, -1).map((_, i) => ({
    after: i,
    kind: importRank(members[i]!) === 0 && importRank(members[i + 1]!) === 1 ? 'redirect' : 'group',
    detail: importRank(members[i]!) === 0 && importRank(members[i + 1]!) === 1
      ? 'OAuth redirect returns to the callback route'
      : 'same integration surface',
  }));

  // Terminal hop: the resource-create POST this chain exists to reach
  // (deterministic: a POST route workflow that writes data and reads
  // project/repo-shaped). Declared as an inferred group hop, never silent.
  const terminal = pool.find((w) =>
    w.entrypoint.kind === 'http_route'
    && w.entrypoint.method === 'POST'
    && /\/(projects|repos|repositories)$/i.test(w.entrypoint.routePattern ?? '')
    && w.steps.some((s) => s.stepKind === 'data_write'));
  if (terminal) {
    boundaries.push({
      after: members.length - 1,
      kind: 'group',
      detail: `connection complete — ${terminal.title} registers the repository`,
    });
    members.push(terminal);
  }

  return buildJourney({
    slug: 'import',
    title: members.some((m) => purposeSignalsOf(m).includes('github_integration'))
      ? 'Repo import & GitHub connection'
      : 'OAuth connection & import',
    goldenKind: 'import',
    members,
    boundaries,
    confidence: 'medium',
  });
}

function importRank(wf: ExtractedWorkflow): number {
  const route = wf.entrypoint.routePattern ?? '';
  for (const { pattern, rank } of IMPORT_ORDER) {
    if (pattern.test(route)) return rank;
  }
  return 8;
}

// ─── Journey assembly ───────────────────────────────────────────────────────

interface BuildJourneyInput {
  slug: string;
  title: string;
  goldenKind: 'pipeline' | 'auth' | 'import';
  members: ExtractedWorkflow[];
  boundaries: JourneyBoundary[];
  confidence: 'high' | 'medium' | 'low';
}

function buildJourney(input: BuildJourneyInput): ExtractedWorkflow {
  const steps: WorkflowStep[] = [];
  const boundaryAfter = new Map(input.boundaries.map((b) => [b.after, b]));

  for (let i = 0; i < input.members.length && steps.length < MAX_JOURNEY_STEPS; i++) {
    const member = input.members[i]!;
    const trigger = member.steps[0];
    if (trigger) {
      steps.push({
        ...trigger,
        stepOrder: steps.length + 1,
        stepKind: 'trigger',
        deterministicDescription: i === 0
          ? trigger.deterministicDescription
          : `${member.title}: ${trigger.deterministicDescription}`,
        metadata: { journeyMember: member.stableKey },
      });
    }
    const effectStep = member.steps.find((s) =>
      ['data_write', 'async_work', 'auth_guard', 'side_effect'].includes(s.stepKind)
      && !s.metadata?.syntheticReturn);
    if (effectStep && steps.length < MAX_JOURNEY_STEPS) {
      steps.push({
        ...effectStep,
        stepOrder: steps.length + 1,
        metadata: { ...(effectStep.metadata ?? {}), journeyMember: member.stableKey },
      });
    }
    const boundary = boundaryAfter.get(i);
    if (boundary && i < input.members.length - 1 && steps.length < MAX_JOURNEY_STEPS) {
      const nextTrigger = input.members[i + 1]!.steps[0];
      if (nextTrigger) {
        steps.push({
          stepOrder: steps.length + 1,
          nodeStableKey: nextTrigger.nodeStableKey,
          filePath: nextTrigger.filePath,
          symbolName: nextTrigger.symbolName,
          lineStart: nextTrigger.lineStart,
          lineEnd: nextTrigger.lineEnd,
          stepKind: boundary.kind === 'queue' ? 'async_work' : 'transform',
          deterministicDescription: `Boundary: ${boundary.detail}`,
          metadata: { journeyBoundary: boundary.kind },
        });
      }
    }
  }
  steps.forEach((s, i) => { s.stepOrder = i + 1; });

  const maxMemberScore = Math.max(...input.members.map((m) => m.importanceScore));
  return {
    title: input.title,
    triggerType: 'journey',
    purpose: journeyPurpose(input),
    stableKey: `journey:${input.slug}`,
    confidence: input.confidence,
    entrypoint: input.members[0]!.entrypoint,
    steps,
    importanceScore: maxMemberScore + 1.5,
    tier: 'core',
    rankingReasons: ['end-to-end journey composed from several traced flows'],
    externalDependencies: [...new Set(input.members.flatMap((m) => m.externalDependencies))],
    metadata: {
      journey: {
        golden_kind: input.goldenKind,
        members: input.members.map((m) => m.stableKey),
        member_titles: input.members.map((m) => m.title),
        boundaries: input.boundaries,
      },
    },
  };
}

function journeyPurpose(input: BuildJourneyInput): string {
  const chain = input.members.map((m) => m.title).join(' → ');
  const crossings = input.boundaries.filter((b) => b.kind === 'queue').length;
  const suffix = crossings > 0 ? ` (crosses ${crossings} queue boundar${crossings === 1 ? 'y' : 'ies'})` : '';
  return `End-to-end journey: ${chain}${suffix}`;
}
