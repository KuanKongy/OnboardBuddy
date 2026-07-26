/**
 * Derivations for every score the API hands to the UI.
 *
 * The ranker already computes and stores WHY a score is what it is
 * (`criticality_scores.score_breakdown` = per-signal normalized values plus the
 * raw counts behind them, `criticality_scores.reasons` = the plain-language
 * version). Until now all of that stopped at the API boundary: the routes
 * selected the breakdown and then serialised only the bare number, so the UI
 * had nothing to show but a percentage and one hand-written sentence that
 * described a completely different ranking phase.
 *
 * Everything below is assembled from stored rows. When a row has no stored
 * breakdown — snapshots older than breakdown storage, targets the ranker
 * skips, clusters whose members all fell outside the persisted top 500 — the
 * result is an explicit `available: false` with the reason. A plausible-looking
 * reconstruction would be worse than no explanation at all: the entire point of
 * this payload is that a reader can decide when to trust the number.
 */

import { CANDIDATE_WEIGHTS, INAPPLICABLE_SIGNALS, type CandidateSignal } from '../../worker/engine/candidateRanker.js';

/** One term of a score: what it is, what it was worth, what it measured. */
export interface ScoreProvenanceInput {
  key: string;
  label: string;
  /** Share of the formula, 0–1. Null when terms are equally weighted (a mean). */
  weight: number | null;
  /** This term's own value, 0–1. Null when the payload is the weight table itself. */
  value: number | null;
  /** Points of the final score this term supplied (value × weight). */
  contribution: number | null;
  /** The real measurement behind `value`, in words ("3 workflows"). */
  measured: string | null;
}

export interface ScoreProvenanceAvailable {
  available: true;
  /** How the number was produced — the UI words the two cases differently. */
  method: 'weighted_signals' | 'member_mean' | 'weight_table';
  /** What the number is called where it is displayed. */
  label: string;
  /** The score being explained, 0–1. Null for a weight table (no target). */
  score: number | null;
  formula: string;
  /** Biggest contribution first, so a tooltip can truncate honestly. */
  inputs: ScoreProvenanceInput[];
  /** Deterministic reasons stored beside the score. */
  reasons: string[];
  /** One line: what would actually move this number. */
  lever: string;
  /** What the 0–100 scale means — these scores are relative to the snapshot. */
  scaleNote: string;
  /** Set when the derivation is real but incomplete, and says how. */
  caveat: string | null;
}

export interface ScoreProvenanceUnavailable {
  available: false;
  label: string;
  score: number | null;
  /** Why there is no derivation. Never a guess at what it would have been. */
  reason: string;
}

export type ScoreProvenanceResult = ScoreProvenanceAvailable | ScoreProvenanceUnavailable;

/**
 * The shape `persistCandidateRankings` writes into `score_breakdown`:
 * `normalized` drives the score, `raw` is kept purely so a number can be
 * traced back to the count it came from.
 */
interface StoredBreakdown {
  normalized: Partial<Record<CandidateSignal, number>>;
  raw: Partial<Record<CandidateSignal, number>>;
}

/** Display names for the ranker's signals — served so the UI never restates weights. */
const SIGNAL_LABELS: Record<CandidateSignal, string> = {
  workflowParticipation: 'Workflow participation',
  fanCentrality: 'Fan-in / fan-out centrality',
  exportedSurface: 'Exported surface',
  sideEffects: 'Side-effect breadth',
  entrypointParticipation: 'Entry point',
  routeSchemaOwnership: 'Route / schema ownership',
  testProximity: 'Test coverage',
  configRelevance: 'Config & environment',
  churn: 'Churn (last 90 days)',
};

/**
 * A workflow row reuses the signal slots for different quantities — the
 * ranker packs the flow's own tier-aware importance into
 * `workflowParticipation` rather than a participation count. Labelling that
 * "Workflow participation" on a workflow would be a lie in the one place a
 * reader is most likely to check it.
 */
const WORKFLOW_SIGNAL_LABELS: Partial<Record<CandidateSignal, string>> = {
  workflowParticipation: 'Flow importance (tier + trigger)',
  entrypointParticipation: 'Starts at an entry point',
  routeSchemaOwnership: 'Reads or writes data',
};

/**
 * Signals with nothing to measure on a traced flow: a workflow is a path
 * through the graph, so it has no importers and exports nothing.
 *
 * Imported from the ranker rather than restated, because the ranker now
 * excludes exactly these from the score's denominator — if the two lists drift,
 * the explanation stops matching the arithmetic it claims to explain.
 *
 * Note this used to also list testProximity, configRelevance and churn, and
 * those five unreachable weights capped every flow at 55/100 with nothing on
 * screen accounting for the missing 45. Those three are measurable on a flow
 * (is its code tested, does any step read config, how much do its files churn)
 * and the ranker now computes them, so each target type spans the full range.
 */
const WORKFLOW_INAPPLICABLE: ReadonlySet<CandidateSignal> = new Set(
  INAPPLICABLE_SIGNALS.workflow ?? [],
);

export type ProvenanceTargetType = 'file' | 'symbol' | 'workflow';

function labelForSignal(signal: CandidateSignal, targetType: ProvenanceTargetType): string {
  if (targetType === 'workflow') return WORKFLOW_SIGNAL_LABELS[signal] ?? SIGNAL_LABELS[signal];
  return SIGNAL_LABELS[signal];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Trims float noise so "0.30000000000000004 workflows" never reaches a reader. */
const trim = (n: number) => Math.round(n * 100) / 100;

/**
 * The raw signal value in the words of whatever it counted. Without this the
 * breakdown is nine normalized decimals, which explains the arithmetic but not
 * the code — "0.33" answers nothing, "2 of 6 side-effect kinds" answers the
 * question the reader actually has.
 */
function measuredText(
  signal: CandidateSignal,
  raw: number | undefined,
  targetType: ProvenanceTargetType,
): string | null {
  if (targetType === 'workflow' && WORKFLOW_INAPPLICABLE.has(signal)) {
    return 'not measured for flows';
  }
  if (raw === undefined || !Number.isFinite(raw)) return null;
  switch (signal) {
    case 'workflowParticipation':
      return targetType === 'workflow'
        ? `importance ${trim(raw)}`
        : raw === 0 ? 'in no traced workflow' : `in ${plural(raw, 'traced workflow')}`;
    case 'fanCentrality':
      return raw === 0
        ? 'nothing imports or calls it'
        : `${trim(raw)} weighted call/import edges`;
    case 'exportedSurface':
      if (targetType === 'symbol') return raw >= 1 ? 'exported' : 'not exported';
      return raw === 0 ? 'exports nothing' : `exports ${plural(raw, 'symbol')}`;
    case 'sideEffects':
      return raw === 0 ? 'no side effects detected' : `${plural(raw, 'kind')} of side effect`;
    case 'entrypointParticipation':
      // 0.5 is the deliberate half-credit for pages that are ONLY UI routes.
      return raw >= 1 ? 'entry point' : raw > 0 ? 'UI page entry point (half credit)' : 'not an entry point';
    case 'routeSchemaOwnership':
      return targetType === 'workflow'
        ? (raw > 0 ? 'reads or writes data' : 'no data step traced')
        : (raw > 0 ? 'owns a route or database table' : 'owns no route or table');
    case 'testProximity':
      return raw > 0 ? 'covered by a test' : 'no test references it';
    case 'configRelevance':
      return raw > 0 ? 'reads configuration or env' : 'reads no configuration';
    case 'churn':
      return raw === 0 ? 'no commits in 90 days' : `${plural(raw, 'commit')} in 90 days`;
  }
}

/**
 * A 0–1 score on the 0–100 scale the UI shows, to one decimal. Whole-number
 * rounding printed "0" for a real member scoring 0.004, which reads as a bug
 * in the derivation rather than as a very low score.
 */
function outOf100(value: number): string {
  const p = Math.round(value * 1000) / 10;
  return p % 1 === 0 ? p.toFixed(0) : p.toFixed(1);
}

/** Points out of 100, worded for a sentence ("20 points", "7.5 points"). */
function points(share: number): string {
  const p = Math.round(share * 1000) / 10;
  return `${outOf100(share)} point${p === 1 ? '' : 's'}`;
}

/**
 * The single change that would move this score the most: the signal with the
 * largest unclaimed share (weight × how far it is from the snapshot maximum).
 * A generic "adjust the weights" line was useless — this names the actual
 * missing evidence, which is also the honest answer to "why is this low".
 */
function leverFor(inputs: ScoreProvenanceInput[], targetType: ProvenanceTargetType): string {
  let best: { input: ScoreProvenanceInput; headroom: number } | null = null;
  for (const input of inputs) {
    if (input.weight === null || input.value === null) continue;
    // A signal nothing about this target could ever move is not a lever. The
    // rule that picks the largest gap otherwise told readers to raise a
    // workflow's fan-in centrality, which no change to the repo can do.
    if (targetType === 'workflow' && WORKFLOW_INAPPLICABLE.has(input.key as CandidateSignal)) continue;
    const headroom = input.weight * (1 - input.value);
    if (!best || headroom > best.headroom) best = { input, headroom };
  }
  if (!best || best.headroom < 0.005) {
    return targetType === 'workflow'
      ? "Every signal a flow can earn is already at this snapshot's maximum — nothing in the ranking can raise it further."
      : "Every signal is already at this snapshot's maximum — nothing in the ranking can raise it further.";
  }
  const noun = targetType === 'workflow' ? 'flow' : targetType;
  return `Biggest lever: ${best.input.label.toLowerCase()} is at ${Math.round((best.input.value ?? 0) * 100)}% of the snapshot's highest ${noun}; closing that gap is worth up to ${points(best.headroom)}.`;
}

function scaleNoteFor(targetType: ProvenanceTargetType): string {
  const noun = targetType === 'workflow' ? 'flow' : targetType;
  const earnable = targetType === 'workflow'
    ? 'every signal a flow can earn (fan-in and exported surface do not apply to a path through the graph, so they are left out of the total rather than counted as zero)'
    : 'every signal at once';
  return `Every signal is divided by the highest value any ${noun} reaches in THIS snapshot, so 100 would mean leading ${earnable}. The scale is relative to this repository — it is not comparable across projects.`;
}

/** Parses `score_breakdown` as written by `persistCandidateRankings`. */
export function parseStoredBreakdown(value: unknown): StoredBreakdown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const normalized = record.normalized;
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  const hasSignal = (Object.keys(CANDIDATE_WEIGHTS) as CandidateSignal[]).some(
    (signal) => typeof (normalized as Record<string, unknown>)[signal] === 'number',
  );
  if (!hasSignal) return null;
  const raw = record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
    ? (record.raw as Partial<Record<CandidateSignal, number>>)
    : {};
  return { normalized: normalized as Partial<Record<CandidateSignal, number>>, raw };
}

export interface CandidateProvenanceOptions {
  label: string;
  score: number;
  /** The raw `score_breakdown` column value. */
  breakdown: unknown;
  reasons?: string[] | null;
  targetType: ProvenanceTargetType;
  /** Why the derivation is real but qualified (e.g. a symbol showing its file's rank). */
  caveat?: string | null;
  /** Replaces the default "no stored breakdown" wording where the route knows better. */
  unavailableReason?: string;
}

/**
 * Derivation for a Phase A candidate score — the weighted blend the ranker
 * actually computes. Every number here comes from the stored row; nothing is
 * recomputed from the graph, because a recomputation could silently disagree
 * with the score being explained.
 */
export function buildCandidateProvenance(opts: CandidateProvenanceOptions): ScoreProvenanceResult {
  const parsed = parseStoredBreakdown(opts.breakdown);
  if (!parsed) {
    return {
      available: false,
      label: opts.label,
      score: Number.isFinite(opts.score) ? opts.score : null,
      reason:
        opts.unavailableReason ??
        'This snapshot stored no signal breakdown for this target, so the number cannot be broken down. Re-analyze the project to record one.',
    };
  }

  const inputs: ScoreProvenanceInput[] = (Object.entries(CANDIDATE_WEIGHTS) as Array<[CandidateSignal, number]>)
    .map(([signal, weight]) => {
      const value = parsed.normalized[signal] ?? 0;
      return {
        key: signal,
        label: labelForSignal(signal, opts.targetType),
        weight,
        value,
        contribution: value * weight,
        measured: measuredText(signal, parsed.raw[signal], opts.targetType),
      };
    })
    .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));

  return {
    available: true,
    method: 'weighted_signals',
    label: opts.label,
    score: opts.score,
    formula: 'score = Σ (signal ÷ snapshot maximum) × weight, over 9 signals',
    inputs,
    reasons: opts.reasons ?? [],
    lever: leverFor(inputs, opts.targetType),
    scaleNote: scaleNoteFor(opts.targetType),
    caveat:
      opts.caveat ??
      (opts.targetType === 'workflow'
        ? `${WORKFLOW_INAPPLICABLE.size} of the 9 signals describe a file's position in the import graph and cannot apply to a path through it, so they are excluded from the total rather than counted against the flow. Flows and files both span 0–100, but they are scored over different signal sets — compare flows with flows.`
        : null),
  };
}

export interface MeanMember {
  key: string;
  name: string;
  filePath: string | null;
  score: number;
}

export interface MeanProvenanceOptions {
  label: string;
  /** The stored score, computed at analysis time over every member. */
  score: number;
  /** Members whose own score survived into `criticality_scores`. */
  scoredMembers: MeanMember[];
  /** Every persisted member, scored or not. */
  totalMemberCount: number;
  /** What the members are ("file", "table", "config file"). */
  memberNoun: string;
  /** How many members to list; the rest are summarised by the count. */
  topN?: number;
}

/**
 * Derivation for an architecture cluster's criticality, which is the MEAN of
 * its members' candidate scores.
 *
 * The mean is the whole reason the number reads as arbitrary on a real repo: a
 * component holding one critical route and thirty ordinary helpers averages
 * out low, and nothing on screen said so. Naming the arithmetic and the top
 * member turns "0.42" into a claim a reader can check.
 */
export function buildMeanProvenance(opts: MeanProvenanceOptions): ScoreProvenanceResult {
  const members = [...opts.scoredMembers].sort((a, b) => b.score - a.score);
  if (members.length === 0) {
    return {
      available: false,
      label: opts.label,
      score: Number.isFinite(opts.score) ? opts.score : null,
      reason:
        `None of this component's ${opts.totalMemberCount} members has a stored criticality score, so the number ` +
        'has no derivation. Test and fixture files are excluded from ranking by design, and only the ' +
        'top 500 scores per snapshot are kept — a component built from either has nothing to average.',
    };
  }

  const listedMean = members.reduce((sum, m) => sum + m.score, 0) / members.length;
  const topN = opts.topN ?? 5;
  const inputs: ScoreProvenanceInput[] = members.slice(0, topN).map((m) => ({
    key: m.key,
    label: m.name,
    // Members are averaged, so every one carries the same weight; expressing
    // it as 1/n keeps "contribution" meaning the same thing it does for
    // signals — points of the final number.
    weight: null,
    value: m.score,
    contribution: m.score / members.length,
    measured: m.filePath,
  }));

  // The stored score was averaged over every member the clusterer saw. What we
  // can list is every member whose score is still in the table, which is not
  // always the same set — say so rather than let the two quietly disagree.
  const diverges = Math.abs(listedMean - opts.score) > 0.005;
  const caveat = diverges
    ? `Averaging the ${members.length} member scores stored here gives ${outOf100(listedMean)}, not ${outOf100(opts.score)}. ` +
      `The stored number was averaged over all ${opts.totalMemberCount} members at analysis time; only scores inside the snapshot's top 500 are kept, so the list below is the surviving part of that average.`
    : members.length < opts.totalMemberCount
      ? `${members.length} of ${opts.totalMemberCount} members carry a score; the rest (tests, fixtures, config and schema evidence) are not ranked and were not part of the average.`
      : null;

  return {
    available: true,
    method: 'member_mean',
    label: opts.label,
    score: opts.score,
    formula: `component score = mean of its ${members.length} scored ${opts.memberNoun}${members.length === 1 ? '' : 's'}`,
    inputs,
    reasons: [
      `Averages ${plural(members.length, `member ${opts.memberNoun}`, `member ${opts.memberNoun}s`)}`,
      `Top member ${members[0]!.name} scores ${outOf100(members[0]!.score)}`,
      ...(members.length > 1
        ? [`Lowest scored member ${members[members.length - 1]!.name} scores ${outOf100(members[members.length - 1]!.score)}`]
        : []),
    ],
    lever:
      'It is a mean, not a maximum: one critical file cannot lift a large component, and splitting or merging components moves the number without any code changing. Judge a component by its top members, listed above.',
    scaleNote:
      `Each member's own score comes from the 9-signal candidate ranking. ${scaleNoteFor('file')}`,
    caveat,
  };
}

/**
 * The ranker's weight table with no target attached — what the coverage strip
 * is describing when it says a package was "ranked by 9 signals". Served
 * instead of being restated in the frontend so the weights cannot drift out of
 * sync with `CANDIDATE_WEIGHTS`.
 */
export function buildWeightTableProvenance(): ScoreProvenanceAvailable {
  const entries = (Object.entries(CANDIDATE_WEIGHTS) as Array<[CandidateSignal, number]>)
    .sort((a, b) => b[1] - a[1]);
  const topThree = entries.slice(0, 3);
  const topThreeShare = topThree.reduce((sum, [, weight]) => sum + weight, 0);

  return {
    available: true,
    method: 'weight_table',
    label: 'Candidate ranking signals',
    score: null,
    formula: 'score = Σ (signal ÷ snapshot maximum) × weight, over 9 signals',
    inputs: entries.map(([signal, weight]) => ({
      key: signal,
      label: SIGNAL_LABELS[signal],
      weight,
      value: null,
      contribution: null,
      measured: null,
    })),
    reasons: [],
    lever: `The three heaviest signals — ${topThree.map(([s]) => SIGNAL_LABELS[s].toLowerCase()).join(', ')} — are worth ${points(topThreeShare)} of 100 between them.`,
    scaleNote:
      'This is the deterministic Phase A ranking: no model is involved, and it decides which symbols are worth a full AI record. Reading order inside a package is re-ranked afterwards against the per-role weights in Project Settings.',
    caveat: null,
  };
}
