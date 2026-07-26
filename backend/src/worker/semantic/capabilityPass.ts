/**
 * Capability derivation (doc/Pipeline.md "capability-extraction"; prompt v5).
 *
 * v4 asked a model to "extract 2-8 business capabilities" from a list of
 * workflow titles and module summaries. A count is a quota: the model always
 * returned some, and where the evidence was thin it invented them to fill the
 * range. MasterPokedex's first capability was "Core Application Structure and
 * Utilities" — the repo's directory listing wearing a capability name — bound
 * to three architecture clusters and zero flows, with a "start here" pointing
 * at the same file the capability had been named after.
 *
 * v5 inverts the order: capabilities are DERIVED from evidence and then named,
 * never named and then justified. `deriveCapabilities` is deterministic and
 * runs before any model is involved. It groups traced flows by the domain
 * noun their own evidence names, and emits a group only when it binds to all
 * three legs of the rule below. The LLM is then handed fixed groups and asked
 * for nothing but a name, a sentence and a "when you'd touch it" — it cannot
 * add a group, drop one, or move a flow between them.
 *
 * Zero capabilities is a valid answer. A repo whose flows reach no persistence
 * and no external surface at all has nothing to bind, and the honest output is
 * an empty list plus the derivation report saying which flows were considered
 * and which leg each one was missing.
 */

import { query } from '../../lib/db.js';
import { makeUntrustedFence, UNTRUSTED_DATA_RULE } from '../ai/untrustedData.js';
import { TIER_RANK, type ExtractedWorkflow, type WorkflowStep, type WorkflowTier } from '../engine/workflowExtractor.js';
import type { DetectedSideEffect } from '../engine/sideEffectDetector.js';
import type { ArchitectureMap } from '../engine/architectureClusterer.js';
import type { EvidenceGraph, EvidenceNode } from '../types/analysis.js';
import type { SemanticContext } from './context.js';
import { PROMPT_VERSIONS, OUTPUT_RULES, renderSummary, type SemanticRecordBody } from './recordTypes.js';
import { evidenceHashForChildren, insertRecord, lookupRecord, mapToSnapshot, attachReceipts, type StoredRecord } from './recordStore.js';
import type { SynthesisResult } from './synthesisPass.js';

export interface CapabilityPassResult {
  capabilities: number;
  cacheHit: boolean;
}

/**
 * The rule, in one place, so the pass, the API and the empty state cannot
 * drift apart on what a capability is.
 */
export const CAPABILITY_BINDING_RULE = {
  summary:
    'A capability is derived from evidence and then named. It is emitted only when a group of flows binds to all three legs below; nothing else is emitted.',
  legs: [
    'At least one entry point — an HTTP route, page, event handler, job or command that something outside the code can trigger.',
    'At least one traced flow that reaches past its own trigger, so there is a path to follow.',
    'At least one persistence or external surface those flows actually reach — a schema table, a named data resource or service, the filesystem, a queue, or the network.',
  ],
} as const;

/** Entry points a person triggers — the same set `rankWorkflow` uses. */
const USER_TRIGGERED = new Set(['http_route', 'ui_route', 'ui_action', 'event_handler']);

/** Steps that mean the flow changed something outside itself. */
const EFFECT_STEP_KINDS = new Set<WorkflowStep['stepKind']>(['data_write', 'async_work', 'side_effect']);

/**
 * Side-effect kinds that count as "reaches a real resource". `unknown_external`
 * is deliberately absent: it is the honesty fallback for a call into any
 * unrecognized package, so counting it would let `class-variance-authority`
 * bind a capability — which is how a design system became a business
 * capability in the first place.
 */
const BINDING_EFFECT_KINDS = new Set<DetectedSideEffect['kind']>([
  // `database_read` is here because the third leg asks whether the flow reaches
  // a real resource, not whether it changes one. Excluding reads meant every
  // read-only view in the fleet — a whole half of most products — could never
  // bind, so repos built entirely of views reported zero capabilities.
  'database_write', 'database_read', 'http_call', 'message_publish', 'email_send',
  'file_write', 'cache_write', 'auth_call', 'external_service', 'process_exec',
]);

/**
 * Persistence and IO surfaces named by a step node's own behaviour signals.
 *
 * The third leg used to accept only two shapes of evidence: a schema node, or
 * a `DetectedSideEffect` from the pattern detector. Both are ORM/driver-shaped,
 * so a project that persists to disk, to a queue, or across the network
 * through a client the detector has no pattern for reached "nothing" — and
 * every one of its flows was rejected. That is how a repo with four working
 * REST routes over a disk-backed store shipped ZERO capabilities while its
 * chart components, which happened to match `.save(`, shipped eight.
 *
 * These signals are not a second guess: `workflowExtractor` already treats the
 * same set as first-class effect evidence (`EFFECT_SIGNALS`), and it is what
 * tiered those flows `core` and labelled their steps `data_write` in the first
 * place. Reading them here is what stops Workflows saying "this flow writes
 * data" while Capabilities says the same flow reaches nothing.
 *
 * Deliberately absent, and why:
 * - `database_read` / `database_write` — the weakest regexes in the set
 *   (`.save(`, `.create(`, `.delete(` match arrays, Sets and DOM nodes as
 *   readily as data clients). Where they are right the effect detector has
 *   already emitted a `database_*` effect, which binds above. Accepting the
 *   bare signal gave a static personal site one capability built on `.delete(`.
 * - `response_output`, `auth_check`, `env_read`, `crypto` — a response is the
 *   flow's own output, config is not a surface, and neither names a resource.
 * - `unknown_external` stays out of BINDING_EFFECT_KINDS for the same honesty
 *   reason as before: it is the fallback for any unmodeled package, so it
 *   would let a design-system import bind a capability.
 */
const SURFACE_BY_SIGNAL: Record<string, string> = {
  filesystem: 'filesystem',
  queue_enqueue: 'job queue',
  queue_consume: 'job queue',
  http_request: 'network',
};

/**
 * URL segments that are routing scaffolding rather than domain nouns. Every
 * route in a repo shares them, so keying on one collapses the whole product
 * into a single "api" capability.
 */
const SCAFFOLD_SEGMENTS = new Set([
  'api', 'app', 'rest', 'graphql', 'public', 'index', 'src', 'pages', 'routes',
  'v1', 'v2', 'v3', '_next',
]);

/** Suffixes a page component carries that say nothing about the domain. */
const COMPONENT_SUFFIX = /(Page|View|Screen|Handler|Route|Controller|Component|Container)$/;

export type CapabilityTier = 'core' | 'supporting';

/** Where the grouping noun came from — shown to the reader as the derivation. */
export type KeySource = 'schema' | 'route' | 'symbol' | 'service';

export interface CapabilityFlow {
  stableKey: string;
  title: string;
  triggerType: string;
  tier: WorkflowTier;
  score: number;
  stepCount: number;
  entrypointKind: string;
  routePattern: string | null;
  userTriggered: boolean;
  /** What THIS flow reaches — the capability's totals are the union. */
  schemas: string[];
  services: string[];
  /**
   * Persistence/IO surfaces with no nameable resource behind them
   * ("filesystem", "job queue", "network"). Third-leg evidence, never a
   * grouping key: every flow in a repo shares them.
   */
  surfaces: string[];
}

export interface CapabilityEntrypoint {
  kind: string;
  route: string | null;
  filePath: string;
  symbol: string | null;
}

export interface DerivedCapability {
  /** Domain noun the group was formed on. Internal; never displayed raw. */
  key: string;
  keySource: KeySource;
  /** Used verbatim when no model name survives validation. */
  fallbackName: string;
  flows: CapabilityFlow[];
  entrypoints: CapabilityEntrypoint[];
  schemas: string[];
  services: string[];
  surfaces: string[];
  tier: CapabilityTier;
  score: number;
  realizesUserAction: boolean;
  whereToStart: Array<{ stable_key: string; reason: string }>;
  /** Graph node keys this capability binds to — entry points and effect sites. */
  nodeKeys: string[];
  /** Architecture clusters the member code lives in, most members first. */
  clusterKeys: string[];
  /** Plain-language trail from evidence to group, shown in the UI. */
  derivation: string[];
}

export interface UnboundFlow {
  stableKey: string;
  title: string;
  /** Which leg of the rule this flow could not supply. */
  missing: string;
}

export interface CapabilityDerivation {
  capabilities: DerivedCapability[];
  /** Flows considered and rejected, with the reason — the honest gap list. */
  unbound: UnboundFlow[];
  totals: {
    tracedFlows: number;
    consideredFlows: number;
    boundFlows: number;
    schemaTables: number;
  };
}

export interface DeriveCapabilitiesInput {
  workflows: ExtractedWorkflow[];
  sideEffects: DetectedSideEffect[];
  graph: EvidenceGraph;
  architecture: ArchitectureMap;
}

// ── Derivation (deterministic; no model involved) ────────────────────────────

function singularize(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y');
  if (/(ss|us|is)$/.test(word)) return word;
  if (/ses$/.test(word)) return word.replace(/es$/, '');
  return word.replace(/([^s])s$/, '$1');
}

function kebab(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** First path segment that names something, ignoring params and scaffolding. */
export function routeResource(route: string | null | undefined): string | null {
  if (!route) return null;
  for (const segment of route.split('/')) {
    if (!segment || segment.startsWith(':') || segment.includes('*') || segment.includes('{')) continue;
    const lowered = segment.toLowerCase();
    if (SCAFFOLD_SEGMENTS.has(lowered)) continue;
    return singularize(kebab(lowered));
  }
  return null;
}

/** `project_members` -> `member`: the entity, not the scope it hangs off. */
function tableResource(table: string): string {
  const parts = table.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return singularize(parts[parts.length - 1] ?? table.toLowerCase());
}

function titleCase(key: string): string {
  const words = key.split(/[-_.]/).filter(Boolean);
  if (words.length === 0) return 'Unnamed';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface FlowEvidence {
  workflow: ExtractedWorkflow;
  schemas: string[];
  /** Table written by the flow, if any — the strongest identity signal. */
  primaryTable: string | null;
  services: string[];
  surfaces: string[];
  bindingEffects: string[];
  effectStep: WorkflowStep | null;
  key: string;
  keySource: KeySource;
}

/**
 * Rejected, so it is not re-tried: inheriting a method's effects from its
 * declaring class, the way `workflowExtractor.effectsFor` does. The detector
 * records a class symbol's effects from the WHOLE class body, so the fallback
 * hands every handler in a route class the union of its siblings' matches. It
 * was measured: it bound a demo `GET /echo/:msg` endpoint and a keyboard
 * controller on a `.delete(`/`.save(` match belonging to another method
 * entirely. Binding here stays on evidence recorded against the flow's own
 * step nodes.
 */

function collectFlowEvidence(
  wf: ExtractedWorkflow,
  nodesByKey: Map<string, EvidenceNode>,
  effectsByKey: Map<string, DetectedSideEffect[]>,
): FlowEvidence {
  const schemas: string[] = [];
  let primaryTable: string | null = null;
  const services = new Set<string>();
  const surfaces = new Set<string>();
  const bindingEffects = new Set<string>();
  const seamCandidates: WorkflowStep[] = [];

  // A data resource the flow's own effects name — the client-SDK equivalent of
  // a schema node. An app that talks to its store through a driver or a managed
  // backend has no `touches_schema` edge to reach, so before this the flow
  // reached "no table", was keyed on its component name, and grouped with
  // nothing. The write is preferred over the read for the same reason a written
  // schema table is.
  let writtenResource: string | null = null;
  let readResource: string | null = null;
  for (const step of wf.steps) {
    const node = nodesByKey.get(step.nodeStableKey);
    if (node?.type === 'schema') {
      if (!schemas.includes(node.name)) schemas.push(node.name);
      // A written table identifies the flow better than one it merely reads:
      // half the read tables in a JOIN belong to somebody else's capability.
      if (step.stepKind === 'data_write' && !primaryTable) primaryTable = node.name;
    }
    const signals = Array.isArray(node?.metadata.behaviorSignals)
      ? (node.metadata.behaviorSignals as string[]) : [];
    for (const signal of signals) {
      const surface = SURFACE_BY_SIGNAL[signal];
      if (surface) surfaces.add(surface);
    }
    for (const effect of effectsByKey.get(step.nodeStableKey) ?? []) {
      if (!BINDING_EFFECT_KINDS.has(effect.kind)) continue;
      bindingEffects.add(effect.kind);
      if (!effect.target) continue;
      if (effect.kind === 'database_write' || effect.kind === 'database_read') {
        if (!schemas.includes(effect.target)) schemas.push(effect.target);
        if (effect.kind === 'database_write') writtenResource ??= effect.target;
        else readResource ??= effect.target;
      } else {
        services.add(effect.target);
      }
    }
    // An `external` node is a boundary crossing into code we did not read, and
    // a schema node is the table, not the code that writes it — neither is a
    // file anyone can edit, so neither can be the seam.
    if (EFFECT_STEP_KINDS.has(step.stepKind) && node?.type !== 'schema' && node?.type !== 'external') {
      seamCandidates.push(step);
    }
  }
  // A write beats a hand-off beats a generic effect: the first `side_effect`
  // step in a page trace is usually a component render, which is not where
  // the capability's behaviour is decided.
  const seamRank = (s: WorkflowStep) => (s.stepKind === 'data_write' ? 0 : s.stepKind === 'async_work' ? 1 : 2);
  const effectStep = seamCandidates.length === 0
    ? null
    : seamCandidates.reduce((best, s) =>
        seamRank(s) < seamRank(best) || (seamRank(s) === seamRank(best) && s.stepOrder < best.stepOrder) ? s : best);
  primaryTable ??= writtenResource ?? readResource ?? schemas[0] ?? null;

  // Key precedence: the entity the flow writes, then the noun its URL names,
  // then the component it is, then the service it talks to. Service is last
  // because one identity provider is shared by every authenticated page —
  // keying on it would merge the whole product into "supabase.auth".
  let key: string;
  let keySource: KeySource;
  const fromRoute = routeResource(wf.entrypoint.routePattern);
  if (primaryTable) {
    key = tableResource(primaryTable);
    keySource = 'schema';
  } else if (fromRoute) {
    key = fromRoute;
    keySource = 'route';
  } else {
    const symbol = wf.entrypoint.symbolName?.replace(COMPONENT_SUFFIX, '');
    const fallback = symbol || (wf.entrypoint.filePath.split('/').pop() ?? '').replace(/\.[jt]sx?$/, '');
    if (fallback) {
      key = singularize(kebab(fallback));
      keySource = 'symbol';
    } else {
      key = [...services][0]?.toLowerCase() ?? 'unnamed';
      keySource = 'service';
    }
  }

  return {
    workflow: wf, schemas, primaryTable,
    services: [...services], surfaces: [...surfaces],
    bindingEffects: [...bindingEffects], effectStep,
    key, keySource,
  };
}

/**
 * A compound URL noun folds into a plain one when the plain one is already a
 * group: `pokemon-filter` belongs with `pokemon`, and `llm-key` with the
 * `key` table. Table-derived keys are exempt — `project_members` is its own
 * entity, not a sub-view of `project`.
 */
function foldCompoundKeys(evidence: FlowEvidence[]): void {
  const keys = new Set(evidence.map((e) => e.key));
  for (const e of evidence) {
    if (e.keySource === 'schema' || e.keySource === 'service') continue;
    const tokens = e.key.split('-');
    if (tokens.length < 2) continue;
    const head = tokens[0]!;
    const tail = tokens[tokens.length - 1]!;
    if (keys.has(head) && head !== e.key) e.key = head;
    else if (keys.has(tail) && tail !== e.key) e.key = tail;
  }
}

function describeTrigger(kind: string): string {
  switch (kind) {
    case 'http_route': return 'HTTP request';
    case 'ui_route': return 'page visit';
    case 'ui_action': return 'user action';
    case 'event_handler': return 'event';
    case 'cron_job': return 'schedule';
    case 'message_consumer': return 'queued message';
    case 'cli_command': return 'command';
    default: return kind.replace(/_/g, ' ');
  }
}

export function deriveCapabilities(input: DeriveCapabilitiesInput): CapabilityDerivation {
  const nodesByKey = new Map(input.graph.nodes.map((n) => [n.stableKey, n]));
  const effectsByKey = new Map<string, DetectedSideEffect[]>();
  for (const effect of input.sideEffects) {
    for (const key of [effect.symbolStableKey, effect.nodeStableKey]) {
      if (!key) continue;
      const list = effectsByKey.get(key);
      if (list) list.push(effect);
      else effectsByKey.set(key, [effect]);
    }
  }
  const clusterOfNode = new Map<string, string>();
  for (const cluster of input.architecture.clusters) {
    for (const member of cluster.members) clusterOfNode.set(member.nodeStableKey, cluster.stableKey);
  }

  const unbound: UnboundFlow[] = [];
  const considered: FlowEvidence[] = [];
  for (const wf of input.workflows) {
    // `surface` means the trace never got past the trigger. It is a real entry
    // point and Workflows lists it as one, but there is no flow to bind.
    if (wf.tier === 'surface' || wf.steps.length < 2) {
      unbound.push({ stableKey: wf.stableKey, title: wf.title, missing: 'no traced flow past its trigger' });
      continue;
    }
    considered.push(collectFlowEvidence(wf, nodesByKey, effectsByKey));
  }
  foldCompoundKeys(considered);

  const groups = new Map<string, FlowEvidence[]>();
  for (const e of considered) {
    const list = groups.get(e.key);
    if (list) list.push(e);
    else groups.set(e.key, [e]);
  }

  const capabilities: DerivedCapability[] = [];
  for (const [key, members] of groups) {
    const schemas = [...new Set(members.flatMap((m) => m.schemas))];
    const services = [...new Set(members.flatMap((m) => m.services))];
    const surfaces = [...new Set(members.flatMap((m) => m.surfaces))];
    const effects = [...new Set(members.flatMap((m) => m.bindingEffects))];

    // The third leg. No schema, no named service, no effect that leaves the
    // process, no persistence or IO surface — there is nothing for a
    // capability to be about. Widened from "schema table or named service" so
    // that persisting to disk, a queue or the network counts; the honesty rule
    // is unchanged, because every branch here still requires evidence the
    // pipeline actually recorded against this flow's own steps.
    if (schemas.length === 0 && services.length === 0 && surfaces.length === 0 && effects.length === 0) {
      for (const m of members) {
        unbound.push({
          stableKey: m.workflow.stableKey,
          title: m.workflow.title,
          missing: 'no persistence or external surface reached',
        });
      }
      continue;
    }

    const ordered = [...members].sort((a, b) =>
      TIER_RANK[a.workflow.tier] - TIER_RANK[b.workflow.tier] ||
      b.workflow.importanceScore - a.workflow.importanceScore ||
      a.workflow.title.localeCompare(b.workflow.title));
    const top = ordered[0]!;
    const realizesUserAction = ordered.some((m) => USER_TRIGGERED.has(m.workflow.entrypoint.kind));
    const tier: CapabilityTier = ordered.some((m) => m.workflow.tier === 'core') ? 'core' : 'supporting';

    // Where to start reading. Deterministic and, deliberately, not the file
    // the capability was named after: the entry point is where the flow
    // begins, the effect site is where its behaviour is decided, and those
    // are different files whenever the trace went anywhere at all.
    const whereToStart: Array<{ stable_key: string; reason: string }> = [];
    const pushStart = (stableKey: string | undefined, reason: string) => {
      if (!stableKey || whereToStart.length >= 3) return;
      if (whereToStart.some((w) => w.stable_key === stableKey)) return;
      whereToStart.push({ stable_key: stableKey, reason });
    };
    pushStart(
      top.workflow.entrypoint.symbolStableKey ?? top.workflow.entrypoint.nodeStableKey,
      `Entry point of "${top.workflow.title}" — the ${describeTrigger(top.workflow.entrypoint.kind)} that starts this capability.`,
    );
    const seam = ordered.find((m) => m.effectStep)?.effectStep;
    if (seam) {
      pushStart(
        seam.nodeStableKey,
        `Where the flow ${seam.stepKind === 'data_write' ? 'writes its data' : seam.stepKind === 'async_work' ? 'hands work off' : 'reaches outside the process'} — the seam to change when extending this capability.`,
      );
    }
    if (ordered[1]) {
      pushStart(
        ordered[1].workflow.entrypoint.symbolStableKey ?? ordered[1].workflow.entrypoint.nodeStableKey,
        `Entry point of "${ordered[1].workflow.title}", the next flow in this capability.`,
      );
    }

    const nodeKeys = [...new Set([
      ...ordered.map((m) => m.workflow.entrypoint.symbolStableKey ?? m.workflow.entrypoint.nodeStableKey),
      ...ordered.flatMap((m) => (m.effectStep ? [m.effectStep.nodeStableKey] : [])),
    ])].slice(0, 8);

    const clusterCounts = new Map<string, number>();
    for (const m of ordered) {
      for (const step of m.workflow.steps) {
        const cluster = clusterOfNode.get(step.nodeStableKey) ?? clusterOfNode.get(step.filePath);
        if (cluster) clusterCounts.set(cluster, (clusterCounts.get(cluster) ?? 0) + 1);
      }
    }
    const clusterKeys = [...clusterCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([k]) => k);

    const derivation: string[] = [
      top.keySource === 'schema'
        ? `Grouped on the \`${top.primaryTable}\` table these ${members.length === 1 ? 'flow writes' : 'flows write'}.`
        : top.keySource === 'route'
          ? `Grouped on the \`${key}\` segment of ${members.length === 1 ? 'its route' : 'their routes'}.`
          : top.keySource === 'symbol'
            ? `Grouped on the entry point \`${top.workflow.entrypoint.symbolName ?? key}\` — no route pattern or schema table was resolved.`
            : `Grouped on the \`${key}\` service these flows call.`,
      `${members.length} traced flow${members.length === 1 ? '' : 's'} from ${new Set(ordered.map((m) => m.workflow.entrypoint.nodeStableKey)).size} entry point${new Set(ordered.map((m) => m.workflow.entrypoint.nodeStableKey)).size === 1 ? '' : 's'}.`,
      schemas.length > 0
        ? `Touches ${schemas.length} schema table${schemas.length === 1 ? '' : 's'}: ${schemas.slice(0, 5).join(', ')}${schemas.length > 5 ? ', …' : ''}.`
        : services.length > 0
          ? `Reaches ${services.length === 1 ? 'the service' : 'services'} ${services.slice(0, 4).join(', ')} — no schema table was traced.`
          : effects.length > 0
            ? `Reaches ${effects.map((e) => e.replace(/_/g, ' ')).join(', ')}${surfaces.length > 0 ? ` via the ${surfaces.join(', ')}` : ''} — no schema table or named service was traced.`
            : `Reaches the ${surfaces.join(', ')} — no schema table, named service or detected effect was traced, so this binds on the persistence surface its own steps carry.`,
    ];

    capabilities.push({
      key, keySource: top.keySource,
      fallbackName: titleCase(key),
      flows: ordered.map((m) => ({
        stableKey: m.workflow.stableKey,
        title: m.workflow.title,
        triggerType: m.workflow.triggerType,
        tier: m.workflow.tier,
        score: m.workflow.importanceScore,
        stepCount: m.workflow.steps.length,
        entrypointKind: m.workflow.entrypoint.kind,
        routePattern: m.workflow.entrypoint.routePattern ?? null,
        userTriggered: USER_TRIGGERED.has(m.workflow.entrypoint.kind),
        schemas: m.schemas,
        services: m.services,
        surfaces: m.surfaces,
      })),
      entrypoints: [...new Map(ordered.map((m) => [
        m.workflow.entrypoint.nodeStableKey + (m.workflow.entrypoint.routePattern ?? ''),
        {
          kind: m.workflow.entrypoint.kind,
          route: m.workflow.entrypoint.routePattern ?? null,
          filePath: m.workflow.entrypoint.filePath,
          symbol: m.workflow.entrypoint.symbolName ?? null,
        },
      ])).values()],
      schemas, services, surfaces,
      tier,
      score: Math.max(...ordered.map((m) => m.workflow.importanceScore)),
      realizesUserAction,
      whereToStart, nodeKeys, clusterKeys, derivation,
    });
  }

  // Same ordering model as Workflows: tier decides before any score is
  // compared, then whether the thing is something a person triggers.
  capabilities.sort((a, b) =>
    (a.tier === b.tier ? 0 : a.tier === 'core' ? -1 : 1) ||
    Number(b.realizesUserAction) - Number(a.realizesUserAction) ||
    b.score - a.score ||
    b.flows.length - a.flows.length ||
    a.key.localeCompare(b.key));

  return {
    capabilities,
    unbound,
    totals: {
      tracedFlows: input.workflows.length,
      consideredFlows: considered.length,
      boundFlows: capabilities.reduce((n, c) => n + c.flows.length, 0),
      schemaTables: input.graph.nodes.filter((n) => n.type === 'schema').length,
    },
  };
}

// ── Naming (the model's only job) ────────────────────────────────────────────

interface CapabilityName {
  id: string;
  name: string;
  description: string;
  user_value: string;
}

const NAMES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['names'],
  properties: {
    names: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'description', 'user_value'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          user_value: { type: 'string' },
        },
      },
    },
  },
};

/** A model name that smuggles a path, a key or an inventory word is dropped. */
const BAD_NAME = /[/#\\]|\.(ts|tsx|js|jsx|py|go|rb)\b|^(wf|cluster|capability):|\b(utilit|structure|infrastructure|boilerplate|miscellaneous|helper)/i;

export function acceptName(raw: string | undefined | null): string | null {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 60) return null;
  if (BAD_NAME.test(name)) return null;
  return name;
}

/** Naming is bounded so a 40-key monorepo cannot blow the prompt budget. */
const MAX_NAMED = 24;

// ── Pass ─────────────────────────────────────────────────────────────────────

export async function runCapabilityPass(ctx: SemanticContext, synthesis: SynthesisResult): Promise<CapabilityPassResult> {
  const derivation = deriveCapabilities({
    workflows: ctx.workflows,
    sideEffects: ctx.sideEffects,
    graph: ctx.graph,
    architecture: ctx.architecture,
  });

  const children = [...synthesis.moduleRecords.values(), ...synthesis.workflowRecords.values()]
    .map((r) => ({ id: r.id, evidenceHash: r.evidenceHash, stableKey: r.stableKey }));

  // The cache key is the derivation itself, not the child records: names are a
  // function of the groups, so identical groups must not pay for a second
  // naming call, and changed groups must never serve the old names.
  const cacheKey = {
    projectId: ctx.projectId,
    stableKey: 'capabilities',
    level: 'capability' as const,
    evidenceHash: evidenceHashForChildren([], derivation.capabilities.map((c) => ({
      key: c.key, flows: c.flows.map((f) => f.stableKey).sort(),
      schemas: [...c.schemas].sort(), services: [...c.services].sort(),
      surfaces: [...c.surfaces].sort(),
    }))),
    promptVersion: PROMPT_VERSIONS.capability,
    depth: ctx.depth,
    modelFamily: ctx.modelFamily.strong,
  };

  const cached = await lookupRecord(cacheKey);
  let names = new Map<string, CapabilityName>();
  let aggregate: StoredRecord;

  if (cached) {
    const stored = (cached.record as unknown as { names?: CapabilityName[] }).names ?? [];
    names = new Map(stored.map((n) => [n.id, n]));
    aggregate = cached;
  } else {
    if (derivation.capabilities.length > 0) {
      names = await nameCapabilities(ctx, derivation.capabilities.slice(0, MAX_NAMED));
    }
    aggregate = await persistAggregate(ctx, cacheKey, derivation, [...names.values()], children);
  }
  await mapToSnapshot(ctx.snapshotId, aggregate, null);

  const written = await persistCapabilities(ctx, derivation, names, aggregate.id);
  return { capabilities: written, cacheHit: cached !== null };
}

async function nameCapabilities(
  ctx: SemanticContext,
  capabilities: DerivedCapability[],
): Promise<Map<string, CapabilityName>> {
  const system = [
    'You are naming business capabilities that have ALREADY been derived from code evidence. The groups are fixed. You may not add a group, remove one, merge two, or move a flow between them. Return exactly one entry per id you are given, and no other ids.',
    [
      'For each group produce:',
      '- name: 2-4 words naming the product feature a user of this system would recognise, from the routes, tables and services listed for THAT group. Title case. Never a file name, path fragment, internal key, layer name ("utilities", "shared", "core structure") or the word "management" on its own.',
      '- description: ONE sentence in plain product language saying what a user gets from it. No file names, no jargon.',
      '- user_value: ONE sentence naming the kind of task or bug that leads a developer to this capability.',
    ].join('\n'),
    'If the evidence for a group does not support a user-facing name, return an empty string for name — a deterministic label is used instead. That is a correct answer, not a failure.',
    UNTRUSTED_DATA_RULE,
    OUTPUT_RULES,
  ].join('\n\n');

  const fence = makeUntrustedFence();
  const prompt = fence.wrap(capabilities.map((c) => [
    `## group id: ${c.key}`,
    `entry points: ${c.entrypoints.slice(0, 6).map((e) => `${describeTrigger(e.kind)}${e.route ? ` ${e.route}` : ` ${e.filePath}`}`).join(' · ')}`,
    `traced flows: ${c.flows.slice(0, 8).map((f) => f.title).join(' · ')}`,
    `schema tables: ${c.schemas.length > 0 ? c.schemas.slice(0, 8).join(', ') : '(none traced)'}`,
    `external services: ${c.services.length > 0 ? c.services.slice(0, 6).join(', ') : '(none named)'}`,
    `persistence surfaces: ${c.surfaces.length > 0 ? c.surfaces.join(', ') : '(none traced)'}`,
  ].join('\n')).join('\n\n'));

  const response = await ctx.ai.call<{ names: CapabilityName[] }>({
    // One shot per run, structured. The cheap tier is JSON-reliable here; the
    // strong tier's long-JSON flakiness paused a live run when this single
    // call failed validation twice.
    tier: 'cheap',
    targetType: 'capability_record',
    promptVersion: PROMPT_VERSIONS.capability,
    schemaName: 'capability_names',
    schema: NAMES_SCHEMA,
    system,
    user: prompt,
    maxOutputTokens: 6_000,
  });

  const valid = new Set(capabilities.map((c) => c.key));
  const out = new Map<string, CapabilityName>();
  for (const entry of response.value?.names ?? []) {
    if (!valid.has(entry.id) || out.has(entry.id)) continue;
    const name = acceptName(entry.name);
    if (!name) continue;
    out.set(entry.id, {
      id: entry.id,
      name,
      description: (entry.description ?? '').trim(),
      user_value: (entry.user_value ?? '').trim(),
    });
  }
  return out;
}

async function persistAggregate(
  ctx: SemanticContext,
  cacheKey: Parameters<typeof lookupRecord>[0],
  derivation: CapabilityDerivation,
  names: CapabilityName[],
  children: Array<{ id: string; evidenceHash: string; stableKey: string }>,
): Promise<StoredRecord> {
  const body: SemanticRecordBody & {
    names: CapabilityName[];
    derivation: CapabilityDerivation;
    bindingRule: typeof CAPABILITY_BINDING_RULE;
  } = {
    purpose: derivation.capabilities.length === 0
      ? `No business capability could be derived: ${derivation.totals.tracedFlows} flows were traced and none reached a persistence or external surface.`
      : `Business capabilities derived from traced flows (${derivation.capabilities.length}).`,
    behavior: derivation.capabilities
      .map((c) => `${names.find((n) => n.id === c.key)?.name ?? c.fallbackName}: ${c.flows.length} flows, ${c.schemas.length} tables`)
      .join('; '),
    responsibilities: derivation.capabilities.map((c) => names.find((n) => n.id === c.key)?.name ?? c.fallbackName),
    business_concepts: [...new Set(derivation.capabilities.flatMap((c) => [...c.schemas, ...c.services, ...c.surfaces]))].slice(0, 20),
    side_effects: [], inputs_outputs: null,
    dependencies_narrative: '', design_patterns: [],
    risks_invariants: derivation.unbound.slice(0, 10).map((u) => `${u.title}: ${u.missing}`),
    confidence: 'medium', claims: [],
    names,
    derivation,
    bindingRule: CAPABILITY_BINDING_RULE,
  };
  const aggregate = await insertRecord({
    key: cacheKey,
    record: body,
    summary: renderSummary('capabilities', body),
    confidence: 'medium',
    // With nothing to name there is no model call at all, so the record is
    // deterministic and says so rather than claiming an AI derivation.
    factsOnly: names.length === 0,
    status: 'pending',
    childRecordIds: children.map((c) => c.id),
    model: null,
    tokenUsage: {},
  });
  await attachReceipts({
    projectId: ctx.projectId, snapshotId: ctx.snapshotId, commitHash: ctx.commitHash,
    record: aggregate,
    drafts: children.slice(0, 40).map((c, i) => ({
      alias: `c${i + 1}`, kind: 'record_reference', trustLevel: 'llm_inference',
      referencedRecordId: c.id, nodeStableKey: c.stableKey,
    })),
  });
  return aggregate;
}

async function persistCapabilities(
  ctx: SemanticContext,
  derivation: CapabilityDerivation,
  names: Map<string, CapabilityName>,
  recordId: string,
): Promise<number> {
  const stableKeys = derivation.capabilities.map((c) => `capability:${slugify(c.key)}`);
  // A re-run that derives fewer capabilities must not leave the old ones
  // standing — that is how a repo ends up showing a capability the current
  // evidence no longer supports.
  await query(
    `DELETE FROM capabilities WHERE snapshot_id = $1 AND NOT (stable_key = ANY($2))`,
    [ctx.snapshotId, stableKeys],
  );

  let written = 0;
  for (const [index, cap] of derivation.capabilities.entries()) {
    const named = names.get(cap.key);
    const name = named?.name ?? cap.fallbackName;
    const description = named?.description
      || `${cap.flows.length} traced flow${cap.flows.length === 1 ? '' : 's'} reaching ${cap.schemas.length > 0 ? cap.schemas.slice(0, 3).join(', ') : cap.services.slice(0, 3).join(', ') || cap.surfaces.slice(0, 3).join(', ') || 'external effects'}. Named from its evidence, not described — the naming step produced nothing usable for this group.`;
    const capResult = await query(
      `INSERT INTO capabilities (snapshot_id, stable_key, name, description, record_id, confidence, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (snapshot_id, stable_key) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description,
             record_id = EXCLUDED.record_id, confidence = EXCLUDED.confidence,
             metadata = EXCLUDED.metadata
       RETURNING id`,
      [ctx.snapshotId, stableKeys[index], name, description, recordId,
       // Confidence tracks the evidence, not the prose: a schema-bound
       // capability is a stronger claim than one held up by an http call.
       cap.schemas.length > 0 && cap.flows.length > 1 ? 'high' : cap.schemas.length > 0 || cap.flows.length > 1 ? 'medium' : 'low',
       JSON.stringify({
         user_value: named?.user_value ?? null,
         where_to_start: cap.whereToStart,
         tier: cap.tier,
         rank: index,
         score: cap.score,
         realizes_user_action: cap.realizesUserAction,
         named_by: named ? 'model' : 'deterministic',
         binding: {
           key: cap.key,
           key_source: cap.keySource,
           entrypoints: cap.entrypoints,
           schemas: cap.schemas,
           services: cap.services,
           surfaces: cap.surfaces,
           flows: cap.flows,
         },
         derivation: cap.derivation,
       })],
    );
    const capabilityId = (capResult.rows[0] as { id: string }).id;
    await query(`DELETE FROM capability_members WHERE capability_id = $1`, [capabilityId]);

    for (const flow of cap.flows) {
      const workflowId = ctx.workflowIdMap.get(flow.stableKey);
      if (!workflowId) continue;
      await query(
        `INSERT INTO capability_members (capability_id, member_type, member_id, stable_key, membership_reason)
         VALUES ($1, 'workflow', $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [capabilityId, workflowId, flow.stableKey,
         `${flow.tier === 'core' ? 'Core' : 'Supporting'} flow, ${flow.stepCount} traced steps from ${flow.routePattern ?? flow.entrypointKind}`],
      );
    }
    for (const clusterKey of cap.clusterKeys) {
      const clusterRow = await query(
        `SELECT id FROM architecture_clusters WHERE snapshot_id = $1 AND stable_key = $2`,
        [ctx.snapshotId, clusterKey],
      );
      const clusterId = (clusterRow.rows[0] as { id: string } | undefined)?.id;
      if (!clusterId) continue;
      await query(
        `INSERT INTO capability_members (capability_id, member_type, member_id, stable_key, membership_reason)
         VALUES ($1, 'cluster', $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [capabilityId, clusterId, clusterKey, 'holds code these flows run through'],
      );
    }
    // Node members are what makes `capability_members` answer "is this file
    // part of a capability" — the entry points and effect sites, not every
    // file a trace wandered through.
    for (const nodeKey of cap.nodeKeys) {
      const nodeId = ctx.nodeIdMap.get(nodeKey);
      if (!nodeId) continue;
      await query(
        `INSERT INTO capability_members (capability_id, member_type, member_id, stable_key, membership_reason)
         VALUES ($1, 'node', $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [capabilityId, nodeId, nodeKey, 'entry point or effect site this capability binds to'],
      );
    }
    written += 1;
  }
  return written;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unnamed';
}
