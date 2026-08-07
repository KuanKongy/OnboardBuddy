import type { ExtractedWorkflow, WorkflowStep } from './workflowExtractor.js';
import type { DetectedSideEffect } from './sideEffectDetector.js';
import { normalizeQueueToken } from './sideEffectDetector.js';

/**
 * Journey composition — boundary detection, not recipes
 * (doc/TUTORIAL_REDESIGN.md §1; answers doc/OWNER_FEEDBACK_M4.md A1
 * "how did you find it? It seems like it is hard coded").
 *
 * A journey is NOT a kind of product feature. It is a chain of traced
 * workflows connected by CONTINUATION BOUNDARIES: structural signals that
 * execution or state provably continues from one traced flow into another.
 * Four boundary kinds, each defined purely by graph evidence, each requiring a
 * receipt on BOTH ends:
 *
 *   async_token         a publish token (queue name, job name, socket event,
 *                       channel) matches a consumer registration's token.
 *   external_roundtrip  a flow redirects to an external origin AND the return
 *                       route's path appears as a literal in the redirecting
 *                       flow's own traced files; the return route reads a
 *                       request parameter the redirect did not send.
 *   capability_unlock   a credential-ISSUING call (sign/create-session, matched
 *                       on the recorded call expression) feeds the same auth
 *                       symbol that another flow's opening guard step consults.
 *   resource_lifecycle  a flow with no id-shaped path parameter writes a named
 *                       target T; another flow whose route carries an id-shaped
 *                       parameter reads or writes the same T.
 *
 * No boundary kind names a domain. "Auth" falls out of capability_unlock where
 * a repo has one; a realtime app's room protocol falls out of async_token over
 * socket events; a create→operate story falls out of resource_lifecycle. A repo
 * with none of these signals gets ZERO journeys, which is the honest answer, not
 * a failure — padding a repo with a journey it does not have is the failure.
 *
 * DELETED with the recipes (they were the hardcoding the owner spotted):
 * `goldenKind: 'pipeline' | 'auth' | 'import'`, `AUTH_ROUTE`/`AUTH_ORDER`,
 * `IMPORT_ROUTE`/`IMPORT_ORDER`, the terminal project-create POST rule, and
 * `pipelineTitle`/`purposeSignalsOf` (which grepped titles for `analy[sz]`,
 * `onboarding`, `github`, …). Nothing here matches a product noun: every word
 * that reaches a title comes from the repo's own route patterns, symbol names
 * and resource targets.
 *
 * Anti-hallucination guards (§1.1) — a wrong journey is worse than no journey:
 *   • a hand-off token must be ≥3 chars, off the stoplist, and unique among
 *     consumers; an ambiguous token forms no edge and is recorded as an unknown;
 *   • resource_lifecycle needs the target written by ≤3 distinct flows and the
 *     operator route to actually carry an id-shaped parameter;
 *   • an edge below `medium` never starts a journey — it may only extend a chain
 *     that already crossed a `high` boundary, and it drags the journey down;
 *   • every edge carries two receipts; an edge that cannot produce both is
 *     dropped. A journey is exactly as verifiable as its worst boundary.
 */

export type BoundaryKind =
  | 'async_token' | 'external_roundtrip' | 'capability_unlock' | 'resource_lifecycle';

export type BoundaryConfidence = 'high' | 'medium' | 'low';

/** Byte-level proof for one side of a boundary. Both sides are required. */
export interface BoundaryReceipt {
  /** 'from' = the producing/issuing/creating side; 'to' = the continuation side. */
  side: 'from' | 'to';
  file_path: string;
  symbol?: string;
  line_start?: number;
  line_end?: number;
  /** The matched bytes: a call expression, a route literal, a registration. */
  evidence: string;
}

export interface JourneyBoundary {
  /** Index into members: the boundary sits AFTER this member. */
  after: number;
  kind: BoundaryKind;
  /** Machine-readable hand-off token for `async_token` (the gate reads it). */
  token?: string;
  /**
   * The same token as the publishing code spells it (`analysisQueue`,
   * `draw-ops`). `token` is normalized for matching and is frequently not a
   * string any file contains, so anything that quotes it at a reader — or
   * searches a snippet for it — wants this one.
   */
  tokenRaw?: string;
  detail: string;
  confidence: BoundaryConfidence;
  receipts: BoundaryReceipt[];
}

/**
 * Verified snippet bytes, keyed by symbol. Shape-compatible with
 * `EvidenceNode`, declared structurally so this module does not depend on the
 * graph builder. Optional everywhere: without snippets the literal-scanning
 * detectors produce no receipts, and no receipt means no edge.
 */
export interface JourneySnippetNode {
  stableKey: string;
  filePath: string | null;
  snippet?: string | null;
}

export interface ComposeJourneysInput {
  workflows: ExtractedWorkflow[];
  sideEffects: DetectedSideEffect[];
  nodes?: JourneySnippetNode[];
}

export interface ComposeJourneysResult {
  journeys: ExtractedWorkflow[];
  /** Honesty rule: signals that were detectable but too ambiguous to use. */
  unknowns: Array<Record<string, unknown>>;
}

const MAX_JOURNEY_STEPS = 14;
/** A chain longer than this is a graph artifact, not a story someone reads. */
const MAX_JOURNEY_MEMBERS = 6;

const CONFIDENCE_RANK: Record<BoundaryConfidence, number> = { high: 0, medium: 1, low: 2 };
/** Kind precedence when two kinds explain the same pair — strongest evidence wins. */
const KIND_RANK: Record<BoundaryKind, number> = {
  async_token: 0, external_roundtrip: 1, capability_unlock: 2, resource_lifecycle: 3,
};

export function composeJourneys(input: ComposeJourneysInput): ExtractedWorkflow[] {
  return composeJourneysDetailed(input).journeys;
}

export function composeJourneysDetailed(input: ComposeJourneysInput): ComposeJourneysResult {
  const pool = composablePool(input.workflows);
  const idx = buildIndex(pool, input.sideEffects, input.nodes);
  const { edges, unknowns } = detectBoundaries(pool, idx);
  return { journeys: assembleChains(pool, edges, idx), unknowns };
}

/**
 * Which boundary kinds this snapshot's shape makes DETECTABLE, at a confidence
 * that could start a journey. `journeyGate.ts` asserts that each one is
 * actually spanned — the shape-conditional check of §1.3, with the route-name
 * regexes it used to run replaced by the same detectors the composer uses.
 */
export function detectableBoundaryKinds(input: ComposeJourneysInput): BoundaryKind[] {
  const pool = composablePool(input.workflows);
  const idx = buildIndex(pool, input.sideEffects, input.nodes);
  const { edges } = detectBoundaries(pool, idx);
  return unique(edges.filter((e) => e.confidence !== 'low').map((e) => e.kind));
}

/**
 * Only code-level workflows participate; config journeys (dev_command,
 * ci_pipeline) already ARE journeys, and nesting journeys is meaningless.
 */
function composablePool(workflows: ExtractedWorkflow[]): ExtractedWorkflow[] {
  return workflows.filter((w) => !['journey', 'dev_command', 'ci_pipeline'].includes(w.triggerType));
}

// ─── Index over the inputs ──────────────────────────────────────────────────

interface ComposerIndex {
  byKey: Map<string, ExtractedWorkflow>;
  /** Effects reachable from a workflow's own traced steps. */
  effectsOf: Map<string, DetectedSideEffect[]>;
  /** Effects declared anywhere in a file, for the chain-forward fallback. */
  effectsByFile: Map<string, DetectedSideEffect[]>;
  /** Verified bytes per symbol key. */
  snippetBySymbol: Map<string, string>;
  /** Verified bytes per file (every symbol in it, concatenated). */
  textByFile: Map<string, string>;
  hasSnippets: boolean;
}

function buildIndex(
  pool: ExtractedWorkflow[],
  sideEffects: DetectedSideEffect[],
  nodes: JourneySnippetNode[] | undefined,
): ComposerIndex {
  const effectsBySymbol = new Map<string, DetectedSideEffect[]>();
  const effectsByFile = new Map<string, DetectedSideEffect[]>();
  for (const se of sideEffects) {
    const key = se.symbolStableKey ?? se.nodeStableKey;
    push(effectsBySymbol, key, se);
    push(effectsByFile, se.filePath, se);
  }

  const effectsOf = new Map<string, DetectedSideEffect[]>();
  for (const wf of pool) {
    const mine: DetectedSideEffect[] = [];
    for (const s of wf.steps) {
      for (const se of effectsBySymbol.get(s.nodeStableKey) ?? []) mine.push(se);
    }
    effectsOf.set(wf.stableKey, mine);
  }

  const snippetBySymbol = new Map<string, string>();
  const textByFile = new Map<string, string>();
  for (const n of nodes ?? []) {
    if (!n.snippet) continue;
    snippetBySymbol.set(n.stableKey, n.snippet);
    if (!n.filePath) continue;
    textByFile.set(n.filePath, `${textByFile.get(n.filePath) ?? ''}\n${n.snippet}`);
  }

  return {
    byKey: new Map(pool.map((w) => [w.stableKey, w])),
    effectsOf, effectsByFile, snippetBySymbol, textByFile,
    hasSnippets: snippetBySymbol.size > 0,
  };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Bytes the trace actually covers: every symbol it stepped through. */
function tracedText(wf: ExtractedWorkflow, idx: ComposerIndex): string {
  const parts: string[] = [];
  for (const s of wf.steps) {
    const snippet = idx.snippetBySymbol.get(s.nodeStableKey);
    if (snippet) parts.push(snippet);
  }
  return parts.join('\n');
}

/**
 * Bytes of every file the trace touched, kept per file (§1.1 says "inside A's
 * traced files"). Per file rather than concatenated so the caller can exclude
 * the file it is asking about without rebuilding the haystack for every pair.
 */
function tracedFileEntries(wf: ExtractedWorkflow, idx: ComposerIndex): Array<{ filePath: string; text: string }> {
  const out: Array<{ filePath: string; text: string }> = [];
  const seen = new Set<string>();
  for (const s of wf.steps) {
    if (seen.has(s.filePath)) continue;
    seen.add(s.filePath);
    const text = idx.textByFile.get(s.filePath);
    if (text) out.push({ filePath: s.filePath, text });
  }
  return out;
}

function receiptFor(
  wf: ExtractedWorkflow, symbolKey: string | undefined, side: 'from' | 'to',
  fallbackFile: string, evidence: string,
): BoundaryReceipt {
  const anchor = (symbolKey ? wf.steps.find((s) => s.nodeStableKey === symbolKey) : undefined)
    ?? wf.steps[0];
  return {
    side,
    file_path: anchor?.filePath ?? fallbackFile,
    ...(anchor?.symbolName ? { symbol: anchor.symbolName } : {}),
    ...(anchor?.lineStart ? { line_start: anchor.lineStart } : {}),
    ...(anchor?.lineEnd ? { line_end: anchor.lineEnd } : {}),
    evidence,
  };
}

/** The registration receipt for the receiving end of any boundary. */
function entryReceipt(wf: ExtractedWorkflow): BoundaryReceipt {
  const step = wf.steps[0];
  const ep = wf.entrypoint;
  return {
    side: 'to',
    file_path: step?.filePath ?? ep.filePath,
    ...(step?.symbolName ?? ep.symbolName ? { symbol: step?.symbolName ?? ep.symbolName } : {}),
    ...(step?.lineStart ? { line_start: step.lineStart } : {}),
    ...(step?.lineEnd ? { line_end: step.lineEnd } : {}),
    evidence: `${ep.kind}${ep.method ? ` ${ep.method}` : ''}${ep.routePattern ? ` ${ep.routePattern}` : ''}`,
  };
}

// ─── Boundary detection ─────────────────────────────────────────────────────

interface BoundaryEdge {
  from: string;
  to: string;
  kind: BoundaryKind;
  token?: string;
  /** The publisher's own spelling of `token`; see `JourneyBoundary.tokenRaw`. */
  tokenRaw?: string;
  detail: string;
  confidence: BoundaryConfidence;
  receipts: BoundaryReceipt[];
  /** Tie-break within a kind — how direct the evidence is. */
  score: number;
}

function detectBoundaries(
  pool: ExtractedWorkflow[], idx: ComposerIndex,
): { edges: BoundaryEdge[]; unknowns: Array<Record<string, unknown>> } {
  const raw: Array<Record<string, unknown>> = [];
  const all = [
    ...detectAsyncTokenEdges(pool, idx, raw),
    ...detectExternalRoundtripEdges(pool, idx),
    ...detectCapabilityUnlockEdges(pool, idx),
    ...detectResourceLifecycleEdges(pool, idx, raw),
  ];
  // One unknown per distinct signal — the same shared target reported once per
  // flow that writes it is noise in the trust panel, not extra honesty.
  const unknowns = [...new Map(raw.map((u) => [JSON.stringify(u), u])).values()];

  // Dedupe: one edge per ordered pair, strongest evidence wins.
  const best = new Map<string, BoundaryEdge>();
  for (const e of all) {
    if (e.from === e.to || e.receipts.length < 2) continue;
    const key = `${e.from} -> ${e.to}`;
    const prior = best.get(key);
    if (!prior || edgeRank(e) < edgeRank(prior)) best.set(key, e);
  }
  return { edges: [...best.values()], unknowns };
}

function edgeRank(e: BoundaryEdge): number {
  return CONFIDENCE_RANK[e.confidence] * 100 + KIND_RANK[e.kind] * 10 - e.score;
}

// ── async_token ─────────────────────────────────────────────────────────────

/**
 * §1.1 renames `normalizeQueueToken` to `normalizeHandoffToken` because the
 * token universe is no longer queues: BullMQ queue names, job names, socket
 * event names and pub/sub channels all normalize under the identical contract.
 * The implementation lives in sideEffectDetector.ts; this is the rename at the
 * call site.
 */
const normalizeHandoffToken = normalizeQueueToken;

/** §1.1 stoplist — tokens that carry no identity. Stored normalized. */
const TOKEN_STOPLIST = new Set([
  'main', 'default', 'message', 'data', 'error', 'connect', 'disconnect',
]);

const MIN_TOKEN_LENGTH = 3;

function admissibleToken(token: string): boolean {
  return token.length >= MIN_TOKEN_LENGTH && !TOKEN_STOPLIST.has(token);
}

/**
 * Tokens a consumer registration answers to, each paired with the identifier
 * it was normalized from. A registration may namespace itself
 * (`socket:draw-ops`, `jobs:resize`); the producing side writes the bare name,
 * so both forms are admitted and uniqueness is enforced per token.
 *
 * `raw` never matches anything — matching is what the normalized token is for.
 * It exists so a message about a registration can name it as the code spells
 * it ('ANALYSIS_QUEUE') instead of as the matcher spells it ('analysi').
 */
function registrationTokens(routePattern: string): Array<{ token: string; raw: string }> {
  if (!routePattern) return [];
  const forms = [routePattern];
  const colon = routePattern.indexOf(':');
  if (colon > 0) forms.push(routePattern.slice(colon + 1));
  const out: Array<{ token: string; raw: string }> = [];
  for (const form of forms) {
    const token = normalizeHandoffToken(form);
    if (!admissibleToken(token) || out.some((t) => t.token === token)) continue;
    out.push({ token, raw: form });
  }
  return out;
}

/** First string-literal argument of a publish-shaped call, from verified bytes. */
const PUBLISH_LITERAL_RE =
  /\.(?:emit|publish|send|add|xAdd|xadd|lPush|rPush|lpush|rpush)\s*\(\s*['"`]([\w:.\-/]{2,64})['"`]/g;

interface TokenSource {
  token: string;
  /** The literal the code actually contains, for prose. Never matched on. */
  raw: string;
  evidence: string;
  symbolKey: string;
  score: number;
}

/**
 * Every hand-off token a workflow publishes, with the bytes that prove it.
 * Three sources, most direct first: the detector's normalized queue hint, the
 * job name it captured, and — for publishers whose event name only exists in
 * the call arguments (`socket.emit('room-created', …)`, where the recorded
 * evidence is just `.emit(`) — a scan of the emitting symbol's verified bytes.
 */
function publishedTokens(wf: ExtractedWorkflow, idx: ComposerIndex): TokenSource[] {
  const effects = [...(idx.effectsOf.get(wf.stableKey) ?? [])];
  // Consumer traces can hit the step cap before reaching their own
  // chain-forward publish — the consumer's file speaks for it (an auto-chain
  // publish in a worker's module IS that consumer's next hop).
  if (wf.entrypoint.kind === 'message_consumer' || wf.entrypoint.kind === 'event_handler') {
    effects.push(...(idx.effectsByFile.get(wf.entrypoint.filePath) ?? []));
  }

  const out: TokenSource[] = [];
  const seen = new Set<string>();
  const add = (token: string, raw: string, evidence: string, symbolKey: string, score: number): void => {
    if (!admissibleToken(token) || seen.has(token)) return;
    seen.add(token);
    out.push({ token, raw: raw || token, evidence, symbolKey, score });
  };

  for (const se of effects) {
    if (se.kind !== 'message_publish') continue;
    const symbolKey = se.symbolStableKey ?? se.nodeStableKey;
    const bytes = idx.snippetBySymbol.get(symbolKey);
    const evidence = se.evidence ?? `${se.kind} in ${se.filePath}`;
    if (se.queueHint) {
      const token = normalizeHandoffToken(se.queueHint);
      // `queueRaw` is the enqueue receiver as written (`analysisQueue`); rows
      // detected before it existed have only the normalized hint to offer.
      add(token, se.queueRaw ?? se.queueHint, callSiteFor(token, bytes) ?? evidence, symbolKey, 3);
    }
    if (se.target) {
      const token = normalizeHandoffToken(se.target);
      add(token, se.target, callSiteFor(token, bytes) ?? `${evidence} '${se.target}'`, symbolKey, 2);
    }
    if (!bytes) continue;
    for (const m of bytes.matchAll(PUBLISH_LITERAL_RE)) {
      add(normalizeHandoffToken(m[1]!), m[1]!, m[0]!.trim(), symbolKey, 1);
    }
  }
  return out;
}

/**
 * The publish call site that actually carries this token, from the verified
 * bytes. A symbol that publishes onto two destinations gets ONE side-effect row
 * whose `evidence` is whichever pattern matched first, so quoting it verbatim
 * can attach `getSummaryQueue().add` to a boundary about a different token. A
 * receipt that does not contain its own claim is worse than no quote, so the
 * call site is re-found and the effect's text is only the fallback.
 */
function callSiteFor(token: string, bytes: string | undefined): string | null {
  if (!bytes || !token) return null;
  for (const m of bytes.matchAll(PUBLISH_CALL_RE)) {
    const text = m[0]!.trim();
    if (normalizeHandoffToken(m[1] ?? '') === token || normalizeHandoffToken(m[2] ?? '') === token) {
      return text;
    }
  }
  return null;
}

/** `getSummaryQueue().add('generate_summary'` / `socket.emit('draw-ops'` — receiver and first literal. */
const PUBLISH_CALL_RE =
  /([A-Za-z_$][\w$]*)\s*(?:\(\s*\))?\s*\.\s*(?:add|emit|publish|send|xAdd|xadd|lPush|rPush|lpush|rpush)\s*\(\s*(?:['"`]([\w:.\-/]{2,64})['"`])?/g;

function detectAsyncTokenEdges(
  pool: ExtractedWorkflow[], idx: ComposerIndex, unknowns: Array<Record<string, unknown>>,
): BoundaryEdge[] {
  const consumersByToken = new Map<string, ExtractedWorkflow[]>();
  const registrationByToken = new Map<string, string>();
  for (const wf of pool) {
    if (wf.entrypoint.kind !== 'message_consumer' && wf.entrypoint.kind !== 'event_handler') continue;
    for (const { token, raw } of registrationTokens(wf.entrypoint.routePattern ?? '')) {
      push(consumersByToken, token, wf);
      if (!registrationByToken.has(token)) registrationByToken.set(token, raw);
    }
  }

  // Uniqueness guard: a token two consumers answer to cannot say which one
  // continues the flow. No edge — recorded as an unknown, never guessed.
  const consumerByToken = new Map<string, ExtractedWorkflow>();
  for (const [token, list] of consumersByToken) {
    const distinct = unique(list.map((w) => w.stableKey));
    if (distinct.length === 1) consumerByToken.set(token, list[0]!);
    else {
      unknowns.push({
        kind: 'ambiguous_handoff_token', token,
        // `token` is the matcher's spelling and stays as the key; this is the
        // registration as the code writes it, so the gap names something a
        // reader can grep for.
        registration: registrationByToken.get(token) ?? token,
        consumers: distinct.length,
        detail: 'token matches more than one consumer registration; no boundary formed',
      });
    }
  }
  if (consumerByToken.size === 0) return [];

  const edges: BoundaryEdge[] = [];
  for (const wf of pool) {
    for (const src of publishedTokens(wf, idx)) {
      const consumer = consumerByToken.get(src.token);
      if (!consumer || consumer.stableKey === wf.stableKey) continue;
      // A publish and a registration in the SAME file match on the token but do
      // not establish which side of the wire each end is on: `emit('x')` next to
      // `on('x')` is as often a broadcast back out as it is a hand-off inward.
      // Across files (an API enqueuing into a worker's queue) there is a real
      // producer/consumer split. The token match is still exact either way —
      // this only stops the composer from over-claiming causality.
      const sameFile = src.symbolKey.split('#')[0] === consumer.entrypoint.filePath;
      edges.push({
        from: wf.stableKey,
        to: consumer.stableKey,
        kind: 'async_token',
        token: src.token,
        tokenRaw: src.raw,
        // The reader is told to go find this token in the code, so it is the
        // publisher's own literal — `src.token` is the normalized join key and
        // 'analysi' appears in no file.
        detail: `token '${src.raw}' published by ${wf.title} is consumed by ${consumer.title}`
          + (sameFile ? ' (both ends are registered in the same file; the direction of the hand-off is not recorded)' : ''),
        confidence: sameFile ? 'medium' : 'high',
        score: src.score,
        receipts: [
          receiptFor(wf, src.symbolKey, 'from', wf.entrypoint.filePath, src.evidence),
          entryReceipt(consumer),
        ],
      });
    }
  }
  return edges;
}

// ── external_roundtrip ──────────────────────────────────────────────────────

/** Control leaves the process: a redirect emission. */
const REDIRECT_CALL_RE =
  /(?:\.redirect\s*\(|Response\s*\.\s*redirect\s*\(|location\s*\.\s*(?:href|assign|replace)\s*[=(]|setHeader\s*\(\s*['"`][Ll]ocation)/;
/** …to somewhere this repo does not serve: an absolute origin or a configured one. */
const EXTERNAL_ORIGIN_RE =
  /https?:\/\/(?!localhost|127\.0\.0\.1)[\w.-]+|process\.env\.[A-Z0-9_]+|import\.meta\.env\.[\w]+/;
/** The return side reads something the redirect did not send. */
const REQUEST_QUERY_RE =
  /\breq(?:uest)?\s*\.\s*query\b|\bsearchParams\s*\.\s*get\s*\(|\bURLSearchParams\b|\bgetQuery\s*\(/;

function findExternalRedirect(
  wf: ExtractedWorkflow, idx: ComposerIndex,
): { symbolKey: string; evidence: string } | null {
  for (const s of wf.steps) {
    const bytes = idx.snippetBySymbol.get(s.nodeStableKey);
    if (!bytes) continue;
    const m = bytes.match(REDIRECT_CALL_RE);
    if (!m) continue;
    // The origin must appear in the same symbol as the redirect, otherwise
    // "this file mentions a URL somewhere" would pass for evidence.
    const window = bytes.slice(Math.max(0, m.index! - 120), m.index! + 320);
    const origin = window.match(EXTERNAL_ORIGIN_RE);
    if (!origin) continue;
    return { symbolKey: s.nodeStableKey, evidence: `${m[0]} … ${origin[0]}` };
  }
  return null;
}

/**
 * The longest parameter-free prefix of a route, which is the form that can
 * appear as a literal. `/api/x/y/return` stays whole; `/api/x/:id/y`
 * contributes `/api/x`. Two segments and 8 characters minimum: a one-segment
 * prefix like `/api` matches everything and proves nothing.
 */
function literalPrefixOf(routePattern: string): string | null {
  const segments: string[] = [];
  for (const seg of routePattern.split('/')) {
    if (!seg) continue;
    if (/^[:*{[]/.test(seg)) break;
    segments.push(seg);
  }
  if (segments.length < 2) return null;
  const prefix = `/${segments.join('/')}`;
  return prefix.length >= 8 ? prefix : null;
}

/** The path must sit inside a string/template literal, not in a comment or a URL we built. */
function findRouteLiteral(text: string, path: string): string | null {
  const re = new RegExp(`['"\`][^'"\`\\n]{0,200}${escapeRe(path)}[^'"\`\\n]{0,80}['"\`]?`);
  const m = text.match(re);
  return m ? m[0].slice(0, 160) : null;
}

function detectExternalRoundtripEdges(
  pool: ExtractedWorkflow[], idx: ComposerIndex,
): BoundaryEdge[] {
  if (!idx.hasSnippets) return [];
  // Both addressable-path kinds can be the return leg: a server route the third
  // party calls back, and a client page the browser is sent back to. Excluding
  // pages would have made this kind detect only half of the shape it exists for.
  const returnRoutes = pool.filter((w) =>
    (w.entrypoint.kind === 'http_route' || w.entrypoint.kind === 'ui_route')
    && literalPrefixOf(w.entrypoint.routePattern ?? '') !== null
    && REQUEST_QUERY_RE.test(tracedText(w, idx)));
  if (returnRoutes.length === 0) return [];

  const edges: BoundaryEdge[] = [];
  for (const from of pool) {
    const redirect = findExternalRedirect(from, idx);
    if (!redirect) continue;
    const haystack = tracedFileEntries(from, idx);
    if (haystack.length === 0) continue;
    for (const to of returnRoutes) {
      if (to.stableKey === from.stableKey) continue;
      // Search everything the redirecting flow touched EXCEPT the return
      // route's own file — otherwise its registration line matches itself.
      const own = new Set(to.steps.map((s) => s.filePath));
      const path = literalPrefixOf(to.entrypoint.routePattern ?? '')!;
      const literal = haystack
        .filter((h) => !own.has(h.filePath))
        .map((h) => findRouteLiteral(h.text, path))
        .find((m) => m !== null);
      if (!literal) continue;
      edges.push({
        from: from.stableKey,
        to: to.stableKey,
        kind: 'external_roundtrip',
        detail: `control leaves for an external origin and returns to ${to.title}, whose path is written as a literal in ${from.title}`,
        confidence: 'medium',
        score: path.length,
        receipts: [
          receiptFor(from, redirect.symbolKey, 'from', from.entrypoint.filePath,
            `${redirect.evidence} | return path literal: ${literal}`),
          entryReceipt(to),
        ],
      });
    }
  }
  return edges;
}

// ── capability_unlock ───────────────────────────────────────────────────────

/**
 * Credential ISSUANCE, matched against the recorded call expression of an
 * `auth_call` side effect — a receipt, never a route name or a title.
 * Case-sensitive and closed: `signOut(`, `getUser(`, `verify(` and `compare(`
 * are consultations or revocations, not issuance, and must not match.
 */
const CREDENTIAL_ISSUANCE_RE =
  /\b(?:sign|sign[Uu]p|sign[Ii]n[A-Za-z]*|createUserWith[A-Za-z]*|createSession|setSession|exchangeCodeForSession|refreshSession)\s*\(/;
/**
 * A call that mints a NEW credential outranks one that renews an existing one:
 * where several flows touch the same identity SDK, the chain should start at
 * the one a person actually goes through, and `refreshSession(` is something a
 * client wrapper does on every request.
 */
const FIRST_ISSUANCE_RE =
  /\b(?:sign|sign[Uu]p|sign[Ii]n[A-Za-z]*|createUserWith[A-Za-z]*|createSession|exchangeCodeForSession)\s*\(/;

/** How far into a trace a guard still counts as "the flow begins with a guard". */
const GUARD_STEP_WINDOW = 3;

function issuanceTargets(wf: ExtractedWorkflow, idx: ComposerIndex): Array<{ target: string; se: DetectedSideEffect }> {
  const out: Array<{ target: string; se: DetectedSideEffect }> = [];
  for (const se of idx.effectsOf.get(wf.stableKey) ?? []) {
    if (se.kind !== 'auth_call' || !se.target || !se.evidence) continue;
    if (!CREDENTIAL_ISSUANCE_RE.test(se.evidence)) continue;
    out.push({ target: se.target, se });
  }
  return out;
}

/** The guard the flow opens with, and the auth symbol it consults. */
function openingGuard(
  wf: ExtractedWorkflow, idx: ComposerIndex,
): { step: WorkflowStep; targets: DetectedSideEffect[] } | null {
  const step = wf.steps.slice(0, GUARD_STEP_WINDOW).find((s) => s.stepKind === 'auth_guard');
  if (!step) return null;
  const targets = (idx.effectsOf.get(wf.stableKey) ?? []).filter((se) =>
    se.kind === 'auth_call' && se.target
    && (se.symbolStableKey ?? se.nodeStableKey) === step.nodeStableKey);
  if (targets.length === 0) return null;
  return { step, targets };
}

function detectCapabilityUnlockEdges(
  pool: ExtractedWorkflow[], idx: ComposerIndex,
): BoundaryEdge[] {
  const issuers = pool
    .map((wf) => ({ wf, issued: issuanceTargets(wf, idx) }))
    .filter((x) => x.issued.length > 0);
  if (issuers.length === 0) return [];

  const guarded = pool
    .map((wf) => ({ wf, guard: openingGuard(wf, idx) }))
    .filter((x): x is { wf: ExtractedWorkflow; guard: NonNullable<ReturnType<typeof openingGuard>> } =>
      x.guard !== null);
  if (guarded.length === 0) return [];

  const edges: BoundaryEdge[] = [];
  for (const { wf: issuer, issued } of issuers) {
    const targets = new Set(issued.map((i) => i.target));
    const matches = guarded.filter(({ wf, guard }) =>
      wf.stableKey !== issuer.stableKey
      && guard.targets.some((t) => targets.has(t.target!)));
    if (matches.length === 0) continue;
    // Fan-out is the hallucination risk here: one issuer unlocks every guarded
    // flow in the repo. Take the strongest single continuation and STATE how
    // many others share the guard rather than inventing a chain per route.
    const ranked = [...matches].sort((a, b) =>
      b.wf.importanceScore - a.wf.importanceScore || a.wf.stableKey.localeCompare(b.wf.stableKey));
    const winner = ranked[0]!;
    const shared = winner.guard.targets.find((t) => targets.has(t.target!))!;
    const issuance = issued.find((i) => i.target === shared.target)!;
    const others = ranked.length - 1;
    edges.push({
      from: issuer.stableKey,
      to: winner.wf.stableKey,
      kind: 'capability_unlock',
      detail: `${issuer.title} issues credentials through ${shared.target}; ${winner.wf.title} opens with a guard that consults the same symbol`
        + (others > 0 ? ` (${others} other traced flow${others === 1 ? '' : 's'} share this guard)` : ''),
      confidence: 'medium',
      score: (FIRST_ISSUANCE_RE.test(issuance.se.evidence ?? '') ? 4 : 0) + (ranked.length === 1 ? 2 : 1),
      receipts: [
        receiptFor(issuer, issuance.se.symbolStableKey ?? issuance.se.nodeStableKey, 'from',
          issuer.entrypoint.filePath, issuance.se.evidence ?? shared.target!),
        receiptFor(winner.wf, winner.guard.step.nodeStableKey, 'to',
          winner.wf.entrypoint.filePath, shared.evidence ?? `guard consults ${shared.target}`),
      ],
    });
  }
  return edges;
}

// ── resource_lifecycle ──────────────────────────────────────────────────────

const PATH_PARAM_RE = /[:*]([A-Za-z_][\w]*)|\{([A-Za-z_][\w]*)\}|\[\.{0,3}([A-Za-z_][\w]*)\]/g;
/** "id-shaped": the parameter names an identity, not a category or a page. */
const ID_PARAM_RE = /^(?:id|uuid|guid)$|(?:^|[_-])id$|[a-z]Id$/;
const MIN_TARGET_LENGTH = 3;
/** §1.1: a target written by more than this many flows is not a lifecycle. */
const MAX_LIFECYCLE_WRITERS = 3;

function pathParams(routePattern: string): string[] {
  const out: string[] = [];
  for (const m of routePattern.matchAll(PATH_PARAM_RE)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

function idShapedParams(routePattern: string): string[] {
  return pathParams(routePattern).filter((p) => ID_PARAM_RE.test(p));
}

/**
 * The named resource an effect touches. `DetectedSideEffect.target` carries it
 * for client-SDK and ORM shapes; for raw SQL the resource is only in the matched
 * bytes (`INSERT INTO projects (…)`), so it is read back out of the recorded
 * evidence — the same receipt the boundary will quote. Without this, every
 * repo whose persistence is hand-written SQL had no named targets at all and
 * `resource_lifecycle` could not fire on the most common backend shape there is.
 */
const SQL_WRITE_TARGET_RE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+["'`]?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)/i;
const SQL_READ_TARGET_RE = /\bFROM\s+["'`]?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)/i;

interface NamedEffect { se: DetectedSideEffect; target: string; evidence: string }

function targetOf(se: DetectedSideEffect, bytes: string | undefined): NamedEffect | null {
  const fallback = se.evidence ?? `${se.kind} in ${se.filePath}`;
  if (se.target && se.target.length >= MIN_TARGET_LENGTH) {
    return { se, target: se.target, evidence: fallback };
  }
  const re = se.kind === 'database_read' ? SQL_READ_TARGET_RE : SQL_WRITE_TARGET_RE;
  for (const text of [se.evidence, bytes]) {
    const m = text?.match(re);
    const name = m?.[1]?.replace(/^public\./i, '');
    if (!name || name.length < MIN_TARGET_LENGTH) continue;
    return { se, target: name, evidence: m![0].replace(/\s+/g, ' ').trim() };
  }
  return null;
}

function namedEffects(
  wf: ExtractedWorkflow, idx: ComposerIndex, kinds: ReadonlySet<DetectedSideEffect['kind']>,
): NamedEffect[] {
  const out: NamedEffect[] = [];
  for (const se of idx.effectsOf.get(wf.stableKey) ?? []) {
    if (!kinds.has(se.kind)) continue;
    const named = targetOf(se, idx.snippetBySymbol.get(se.symbolStableKey ?? se.nodeStableKey));
    if (named) out.push(named);
  }
  return out;
}

const WRITE_KINDS: ReadonlySet<DetectedSideEffect['kind']> = new Set(['database_write', 'file_write']);
const TOUCH_KINDS: ReadonlySet<DetectedSideEffect['kind']> = new Set(['database_write', 'database_read', 'file_write']);

function detectResourceLifecycleEdges(
  pool: ExtractedWorkflow[], idx: ComposerIndex, unknowns: Array<Record<string, unknown>>,
): BoundaryEdge[] {
  // Who writes what, so the "written by everything" guard can be applied.
  const writersByTarget = new Map<string, Set<string>>();
  for (const wf of pool) {
    for (const { target } of namedEffects(wf, idx, WRITE_KINDS)) {
      const set = writersByTarget.get(target) ?? new Set<string>();
      set.add(wf.stableKey);
      writersByTarget.set(target, set);
    }
  }

  const operators = pool.filter((w) => idShapedParams(w.entrypoint.routePattern ?? '').length > 0);
  if (operators.length === 0) return [];

  const edges: BoundaryEdge[] = [];
  for (const creator of pool) {
    // A creator is a flow that is not itself addressed by an identity: it makes
    // the thing the operator later addresses. This is structural, not a name.
    if (idShapedParams(creator.entrypoint.routePattern ?? '').length > 0) continue;
    for (const { se: write, target, evidence: writeEvidence } of namedEffects(creator, idx, WRITE_KINDS)) {
      const writers = writersByTarget.get(target)?.size ?? 0;
      if (writers > MAX_LIFECYCLE_WRITERS) {
        unknowns.push({
          kind: 'shared_write_target', target, writers,
          detail: 'written by too many flows to identify a lifecycle; no boundary formed',
        });
        continue;
      }
      const matches = operators
        .filter((op) => op.stableKey !== creator.stableKey)
        .map((op) => ({ op, touch: namedEffects(op, idx, TOUCH_KINDS).find((n) => n.target === target) }))
        .filter((m): m is { op: ExtractedWorkflow; touch: NamedEffect } => m.touch !== undefined);
      if (matches.length === 0) continue;
      // Prefer an operator on the same route surface — a create and an operate
      // that share their first path segment are the same resource's lifecycle
      // far more often than two routes that merely touch the same table.
      const surface = firstSegment(creator.entrypoint.routePattern ?? '');
      const ranked = [...matches].sort((a, b) =>
        sameSurface(b, surface) - sameSurface(a, surface)
        || b.op.importanceScore - a.op.importanceScore
        || a.op.stableKey.localeCompare(b.op.stableKey));
      const winner = ranked[0]!;
      const others = ranked.length - 1;
      edges.push({
        from: creator.stableKey,
        to: winner.op.stableKey,
        kind: 'resource_lifecycle',
        detail: `${creator.title} writes '${target}'; ${winner.op.title} addresses one by id and ${winner.touch.se.kind === 'database_read' ? 'reads' : 'writes'} the same target`
          + (others > 0 ? ` (${others} other id-addressed flow${others === 1 ? '' : 's'} touch it)` : ''),
        confidence: writers <= 1 ? 'medium' : 'low',
        score: sameSurface(winner, surface),
        receipts: [
          receiptFor(creator, write.symbolStableKey ?? write.nodeStableKey, 'from',
            creator.entrypoint.filePath, writeEvidence),
          receiptFor(winner.op, winner.touch.se.symbolStableKey ?? winner.touch.se.nodeStableKey, 'to',
            winner.op.entrypoint.filePath, winner.touch.evidence),
        ],
      });
    }
  }
  return edges;

  function firstSegment(routePattern: string): string {
    return routePattern.split('/').filter(Boolean).find((s) => !/^[:*{[]/.test(s)) ?? '';
  }
  function sameSurface(m: { op: ExtractedWorkflow }, surface: string): number {
    if (!surface) return 0;
    return firstSegment(m.op.entrypoint.routePattern ?? '') === surface ? 1 : 0;
  }
}

// ─── Chain assembly (§1.2) ──────────────────────────────────────────────────

function assembleChains(
  pool: ExtractedWorkflow[], edges: BoundaryEdge[], idx: ComposerIndex,
): ExtractedWorkflow[] {
  if (edges.length === 0) return [];
  const outgoing = new Map<string, BoundaryEdge[]>();
  const incoming = new Set<string>();
  for (const e of edges) {
    push(outgoing, e.from, e);
    incoming.add(e.to);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => edgeRank(a) - edgeRank(b));
  }

  // NOTE (measured, unresolved — TUTORIAL_REDESIGN.md §1.2): whichever chain
  // head sorts first becomes the flow a reader is pointed at first. On this
  // product that used to be `POST /:id/analysis-jobs/:jobId/resume`, whose
  // `:jobId` names a job that only exists after the flow it is meant to start
  // has already run. Sorting by fewest path parameters instead was tried and
  // measured worse. Nothing in the graph carries "a person can send this", so
  // this is NOT fixed here. Two mitigations, both structural:
  //   (a) a head is only a head if nothing hands off INTO it — a flow that
  //       merely re-enters an existing resource now sits mid-chain behind the
  //       flow that created it (`resource_lifecycle`), instead of leading;
  //   (b) every journey records `alternate_entries`, the other traced flows
  //       that cross the same first boundary, so the reader is told "N other
  //       flows enter here" instead of being shown one door as if it were the
  //       only one.
  const sources = pool.filter((w) => outgoing.has(w.stableKey) && !incoming.has(w.stableKey));

  /** Greedy forward walk from one head; `claimed` truncates, it never reorders. */
  const walk = (source: ExtractedWorkflow, claimed: Set<string>) => {
    const members: ExtractedWorkflow[] = [source];
    const chainEdges: BoundaryEdge[] = [];
    const visited = new Set<string>([source.stableKey]);
    while (members.length < MAX_JOURNEY_MEMBERS) {
      const current = members[members.length - 1]!;
      const next = (outgoing.get(current.stableKey) ?? []).find((e) =>
        !visited.has(e.to) && !claimed.has(e.to) && idx.byKey.has(e.to)
        && admissibleEdge(e, chainEdges));
      if (!next) break;
      chainEdges.push(next);
      members.push(idx.byKey.get(next.to)!);
      visited.add(next.to);
    }
    return { members, chainEdges };
  };

  // Longest chain first, and only THEN by confidence and rank. A greedy pass in
  // head order lets a two-member chain claim the consumer that a longer chain
  // needed and split a real multi-hop pipeline into two half-stories — which is
  // exactly the "the pipeline is just 2 steps" complaint (OWNER_FEEDBACK_M4 A2).
  // Members are still claimed at most once; the heads that lost their hop are
  // preserved as `alternate_entries` on the journey that won it.
  const none = new Set<string>();
  const planned = sources
    .map((source) => ({ source, ...walk(source, none) }))
    .filter((p) => p.members.length >= 2)
    .sort((a, b) =>
      b.members.length - a.members.length
      || edgeRank(a.chainEdges[0]!) - edgeRank(b.chainEdges[0]!)
      || b.source.importanceScore - a.source.importanceScore
      || a.source.stableKey.localeCompare(b.source.stableKey));

  const journeys: ExtractedWorkflow[] = [];
  const claimed = new Set<string>();
  for (const plan of planned) {
    if (claimed.has(plan.source.stableKey)) continue;
    const { members, chainEdges } = walk(plan.source, claimed);
    if (members.length < 2) continue;
    for (const m of members) claimed.add(m.stableKey);
    journeys.push(buildJourney({
      slug: slugOf(plan.source),
      title: journeyTitle(members, idx),
      members,
      boundaries: chainEdges.map((e, i) => ({
        after: i,
        kind: e.kind,
        ...(e.token ? { token: e.token } : {}),
        ...(e.tokenRaw ? { tokenRaw: e.tokenRaw } : {}),
        detail: e.detail,
        confidence: e.confidence,
        receipts: e.receipts,
      })),
      alternateEntries: alternateEntries(chainEdges[0]!, edges, idx),
      confidence: worstConfidence(chainEdges.map((e) => e.confidence)),
    }));
  }
  return journeys;
}

/**
 * §1.1 confidence floor: a `low` edge never forms a journey on its own. It may
 * only extend a chain that has already crossed a `high` boundary — and it drags
 * the journey's confidence down when it does.
 */
function admissibleEdge(edge: BoundaryEdge, chain: BoundaryEdge[]): boolean {
  if (edge.confidence !== 'low') return true;
  return chain.some((e) => e.confidence === 'high');
}

function worstConfidence(confidences: BoundaryConfidence[]): BoundaryConfidence {
  return confidences.reduce<BoundaryConfidence>(
    (worst, c) => (CONFIDENCE_RANK[c] > CONFIDENCE_RANK[worst] ? c : worst),
    'high',
  );
}

/** The other traced flows that cross this journey's first boundary. */
function alternateEntries(
  first: BoundaryEdge, edges: BoundaryEdge[], idx: ComposerIndex,
): Array<{ stable_key: string; title: string }> {
  return edges
    .filter((e) => e.to === first.to && e.from !== first.from && e.kind === first.kind
      && (first.token === undefined || e.token === first.token))
    .map((e) => ({ stable_key: e.from, title: idx.byKey.get(e.from)?.title ?? e.from }))
    .sort((a, b) => a.stable_key.localeCompare(b.stable_key));
}

function slugOf(head: ExtractedWorkflow): string {
  return head.stableKey.replace(/^wf:/, '');
}

// ─── Titles derived from the chain's own structure ──────────────────────────

/** Strongest-first: what a reader would call the end of this chain. */
const TERMINAL_EFFECT_ORDER: Array<DetectedSideEffect['kind']> = [
  'database_write', 'file_write', 'message_publish', 'email_send',
  'external_service', 'http_call', 'process_exec', 'auth_call', 'database_read',
];

/**
 * "{entry workflow title} → {terminal effect noun}" (§1.2). The noun is built
 * from the last member's strongest recorded effect and names the repo's own
 * resource — never a category from a list in this file.
 */
function journeyTitle(members: ExtractedWorkflow[], idx: ComposerIndex): string {
  return `${members[0]!.title} → ${terminalNoun(members[members.length - 1]!, idx)}`;
}

/** Kind alone, for effects the detector could not name a resource for. */
const UNNAMED_EFFECT_NOUN: Partial<Record<DetectedSideEffect['kind'], string>> = {
  database_write: 'the rows it writes',
  file_write: 'the file it writes',
  message_publish: 'the message it publishes',
  email_send: 'the mail it sends',
  external_service: 'the service call it makes',
  http_call: 'the call it makes out',
  process_exec: 'the process it starts',
  auth_call: 'the credential it issues',
  database_read: 'what it reads',
};

function terminalNoun(wf: ExtractedWorkflow, idx: ComposerIndex): string {
  const effects = idx.effectsOf.get(wf.stableKey) ?? [];
  // A named resource first — "rows in analysis_snapshots" is the sentence a
  // reader can check. Only when nothing names one does the kind speak alone.
  for (const kind of TERMINAL_EFFECT_ORDER) {
    const named = effects
      .filter((e) => e.kind === kind)
      .map((e) => targetOf(e, idx.snippetBySymbol.get(e.symbolStableKey ?? e.nodeStableKey)))
      .find((n) => n !== null);
    if (!named) continue;
    const target = named.target;
    switch (kind) {
      case 'database_write': return `rows in ${target}`;
      case 'file_write': return `the ${target} it writes`;
      case 'message_publish': return `the '${normalizeHandoffToken(target) || target}' hand-off`;
      case 'database_read': return `what it reads from ${target}`;
      case 'auth_call': return `the ${target} credential`;
      default: return `the ${target} call`;
    }
  }
  for (const kind of TERMINAL_EFFECT_ORDER) {
    if (effects.some((e) => e.kind === kind)) return UNNAMED_EFFECT_NOUN[kind]!;
  }
  const last = [...wf.steps].reverse().find((s) => s.symbolName && !s.metadata?.syntheticReturn);
  return last?.symbolName ? `${last.symbolName}` : wf.title;
}

// ─── Journey assembly ───────────────────────────────────────────────────────

interface BuildJourneyInput {
  slug: string;
  title: string;
  members: ExtractedWorkflow[];
  boundaries: JourneyBoundary[];
  alternateEntries: Array<{ stable_key: string; title: string }>;
  confidence: BoundaryConfidence;
}

/**
 * Whether ONE trigger's execution continues across this boundary by itself.
 * `async_token` is carried by the job/event; the other three need their own
 * trigger on the far side. Persisted on the boundary STEP as the continuation
 * class (`WorkflowStep.metadata` is a closed type owned by workflowExtractor.ts,
 * so the typed kind + receipts ride on `metadata.journey.boundaries` instead).
 */
function continuationClass(kind: BoundaryKind): 'queue' | 'separate_trigger' {
  return kind === 'async_token' ? 'queue' : 'separate_trigger';
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
          stepKind: boundary.kind === 'async_token' ? 'async_work' : 'transform',
          deterministicDescription: `Boundary (${boundary.kind}): ${boundary.detail}`,
          metadata: { journeyBoundary: continuationClass(boundary.kind) },
        });
      }
    }
  }
  steps.forEach((s, i) => { s.stepOrder = i + 1; });

  const maxMemberScore = Math.max(...input.members.map((m) => m.importanceScore));
  const kinds = unique(input.boundaries.map((b) => b.kind));
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
    rankingReasons: [
      `end-to-end journey composed from ${input.members.length} traced flows across ${input.boundaries.length} ${kinds.join('/')} boundar${input.boundaries.length === 1 ? 'y' : 'ies'}`,
    ],
    externalDependencies: [...new Set(input.members.flatMap((m) => m.externalDependencies))],
    metadata: {
      journey: {
        members: input.members.map((m) => m.stableKey),
        member_titles: input.members.map((m) => m.title),
        boundaries: input.boundaries,
        confidence: input.confidence,
        alternate_entries: input.alternateEntries,
      },
    },
  };
}

function journeyPurpose(input: BuildJourneyInput): string {
  const chain = input.members.map((m) => m.title).join(' → ');
  const kinds = unique(input.boundaries.map((b) => b.kind)).join(', ');
  return `End-to-end journey: ${chain} (crosses ${input.boundaries.length} boundar${input.boundaries.length === 1 ? 'y' : 'ies'}: ${kinds})`;
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
