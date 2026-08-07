/**
 * Per-section generation specs — the 12-section Diátaxis architecture
 * (doc/ONBOARDING_QUALITY_LATENCY_PLAN.md "The new architecture"). Four
 * chapters, one documentation mode each; every spec declares its chapter +
 * mode (the generator applies the mode's voice scaffold), its deterministic
 * query, retrieval views, anchor diagrams, and depth budget. CONSULT
 * sections carry a deterministic markdown backbone the model annotates but
 * never edits. Sections are generated one at a time, never in one giant
 * call; diagrams derive from deterministic data only.
 */

import { query } from '../../lib/db.js';
import { roleDescriptor } from '../../lib/roleDisplay.js';
import type { ViewType } from '../semantic/embeddingViews.js';
import type { DeveloperRole } from '../semantic/projections.js';
import { loadRoleProjections, critical25, type ProjectedTarget } from './roleProjection.js';
import {
  architectureDiagram, erDiagram, envExternalServices, topologyDiagram,
  workflowSequenceDiagram, type DiagramSpec, type DiagramStep,
} from './diagrams.js';
import {
  loadConfigFacts, buildRoutesJobsBackbone, buildDataModelBackbone, buildGuardrailsBackbone,
  type ConfigFacts,
} from './referenceBackbones.js';
import { loadDecisionNotes } from './decisionComments.js';
import { loadClusterNarratives } from '../engine/architectureClusterer.js';

/**
 * How many components `architecture_deep` writes a subsection for.
 *
 * One subsection per cluster is what pushed FloowForge's section past its
 * output budget — 9 components × several required elements each, on a repo the
 * `small` size class budgets 6,000 tokens for. Six is what fits at two to four
 * sentences apiece with room for the flow walk, the decisions and the tensions;
 * the rest are named in one line as deliberately not covered, which is honest
 * and costs a sentence instead of a section.
 */
const MAX_NARRATED_CLUSTERS = 6;

/**
 * Countermands the base prompt's TL;DR rule, per section, in the USER turn.
 *
 * `sectionGenerator.ts` SECTION_BASE_PROMPT orders every section to open with
 * `"**TL;DR:** " + 2-3 sentences on what this section covers, ending with one
 * sentence of the form "After reading you can …"`. Measured on the live corpus
 * (104 sections, 38,841 words, 9 repos): that one instruction produces 63
 * `After reading …` sentences in 59 sections, 63 `This section details/covers…`
 * openers, and 51 TL;DR blocks — **2,879 words, 7.4% of the whole corpus**, and
 * ≥25% of the section in 13 sections. Two sections (`FloowForge/code_map` at 36
 * words, `FloowForge/capabilities` at 48) are 100% preamble and zero content.
 *
 * Both phrasings are also `explanationLint` ERRORS (`document_self_reference`,
 * `reader_address`), so the generator lints them, fires a stricter retry whose
 * text says "cut it", and sends that retry with the system turn still demanding
 * the sentence. The model obeys the system turn. ~57 retry calls per fleet run
 * are spent losing that argument.
 *
 * The system turn is not ours to edit here, so every spec restates the rule in
 * the user turn, where it is later and more specific. Prepended to all twelve.
 */
const NO_PREAMBLE = [
  'OPENING RULE — overrides any earlier instruction about a TL;DR:',
  'do NOT open with a "**TL;DR:**" block, a summary of what this section covers, or a sentence of the form "After reading you can …".',
  'NEVER write a sentence whose subject is this write-up ("This section …", "This document …", "This guide …", "This chapter …", "In this section …").',
  'NEVER restate the section\'s own title as a heading — the reader already sees it above your text.',
  'Start with the single most useful FACT about the system and go straight into the content.',
].join(' ');

/**
 * Repetition ban, shared by every spec.
 *
 * The corpus's dominant bloat shape is one sentence written N ways, paraphrased
 * just enough to defeat string dedupe: `OnboardBuddy/capabilities` says "the
 * evidence does not specify the exact tables, services, or extension seams"
 * seven times (19% of the section); `OnboardBuddy/architecture_deep` says
 * "keeping it separate prevents <deps> from spreading into other parts of the
 * codebase" five times. `explanationLint` had no repetition rule at all until
 * `template_repetition` was added alongside this, so seven paraphrases cost
 * exactly what one did.
 */
const NO_REPETITION = [
  'NO TEMPLATE REPETITION: never write the same sentence twice with a different identifier swapped in.',
  'If a statement is true of several items, write it ONCE and name the items in that one sentence ("no table or service binding was found for X, Y and Z").',
  'Two headings must never receive interchangeable prose: if two entries would read alike, say what distinguishes them or merge them into one line.',
].join(' ');

/**
 * The specificity floor — the fix for "it looks awful in other projects".
 *
 * On the small and non-TypeScript-heavy repos (MasterPokedex, UBCPSS,
 * Multiplayer-Tetris, DeepRecall, FloowForge) the model has thinner facts, so
 * it fills the mandated skeleton with apologies instead of dropping the
 * heading: `MasterPokedex/setup_run` spends 5 of its 202 words' worth of blocks
 * on "the evidence does not specify …", including a port-in-use failure box
 * that names no port. Prose that would be true of any repo is the exact
 * "generic, padded, not useful" complaint.
 */
const SPECIFICITY_FLOOR = [
  'SPECIFICITY FLOOR: every sentence must name something only THIS repository has — a real path, symbol, table, route, queue, command, port or domain noun from the evidence.',
  'Delete any sentence that would still be true of a different codebase.',
  'If a heading has no grounded content, OMIT THE HEADING ENTIRELY rather than filling it with what the analysis could not determine — the Known Gaps panel already records that, and a heading followed by an apology is worse than no heading.',
  'Prefer a short section that is all substance over a complete-looking one padded with absence statements. Length is never a goal.',
].join(' ');

/**
 * How to write a citation, shared by every spec.
 *
 * Two shapes were measured shipping to readers, and neither is a taste
 * complaint — both are labels that resolve to nothing.
 *
 *   `FloowForge/traced_flows` cited `(r_evidence)` three times. The pipeline
 *   mints `r1…rN` and nothing else, so that id never existed; it matched no
 *   rewrite rule and shipped verbatim, and no counter recorded it. The section
 *   read as receipted while pointing at a fabrication.
 *
 *   `OnboardBuddy/architecture_deep` cited `(r1:backend/src/worker/semantic/
 *   semanticPipeline.ts:36)` on all three of its decision bullets — the alias
 *   glued to the `where` string the deterministic facts hand it. The rewriter
 *   needs the closing paren right after the id, so all three shipped as dead
 *   `r1:` text and the section recorded `resolved: 0`.
 *
 * Both are now stripped mechanically (`citationMarkers.ts`), which protects the
 * reader but costs the claim its evidence. This says it up front so the claim
 * keeps it.
 */
const CITATION_CONTRACT = [
  'CITATION FORMAT: cite with the bare short id in parentheses, inside the sentence it supports — "(r7)".',
  'ONLY ids that literally appear in the receipt list exist. An id you composed — "(r_evidence)", "(receipt_1)", "(rN)" — is a fabricated citation: it is stripped before the reader sees it and the claim ships bare, which is worse than not citing at all.',
  'NEVER glue the id to a path or a line number: "(r7:src/db.ts:14)" does not resolve. The id alone is enough — the chip shows the reader the file and the line.',
  'Where no receipt supports a sentence, write the locator yourself ("backend/src/lib/db.ts:14") or drop the sentence. Never a bare "r7" at the end of a line.',
].join(' ');

/**
 * Rules about the evidence blob, stated HERE rather than inside the blob.
 *
 * The `deterministic` facts are presented to the model as authoritative content
 * to narrate, so a directive written into one of their string fields is
 * indistinguishable from a sentence to reproduce. `snapshot.coverageNote` used
 * to read "Never describe the codebase as N files" and `snapshot.unreadStacks
 * .sentence` used to read "You MUST say so plainly in your own words" —
 * FloowForge shipped the second one verbatim to a reader. Facts state; only
 * instructions instruct, and instructions live in this channel.
 */
const EVIDENCE_CONTRACT = [
  'The deterministic facts are DATA about the repository, not text to copy: never quote a facts field verbatim, and never repeat any sentence in them that addresses "you" — it was not written for the reader.',
  '`snapshot.filesTheParserRead` is the only file total any claim may rest on. Never describe the codebase by `filesInScopeIncludingNonSource`: that number counts assets, docs and lockfiles nothing was extracted from. If the parsed count is unavailable, give no file total at all.',
].join(' ');

/** Prefix every spec's instructions with the shared contracts. */
const withContracts = (instructions: string[]): string =>
  [NO_PREAMBLE, NO_REPETITION, SPECIFICITY_FLOOR, CITATION_CONTRACT, EVIDENCE_CONTRACT, ...instructions].join(' ');

/**
 * Anything the READER can follow back to the code, in either of the two forms
 * a completeness check sees.
 *
 * `completenessCheck` runs twice over a section's life: on fresh model output,
 * where citations are still `(r7)` aliases, and again on a CACHED row before it
 * is reused, where `rewriteInlineCitations` has already turned them into
 * `[[receipt:uuid]]` markers. A check that knew only one form would reject
 * every cached row on sight and regenerate the whole package on hash luck.
 * `file.ext:line` counts as well — it is what `explanationLint` counts, and a
 * locator a reader can open is a receipt whatever produced it.
 */
const CITATION_IN_PROSE = new RegExp(
  String.raw`\[\[receipt:[0-9a-f-]{8,}\]\]` +
    `|` +
    // `(r7)`, `(receipt r7)`, `(r1, r4)`, and the glued `(r7:path…)` form.
    String.raw`\(\s*(?:[rR]eceipts?\s*:?\s*)?\[?[rR]\d+(?:\s*(?:,|;|/|&|and)\s*[rR]\d+)*\]?\s*[):]` +
    `|` +
    String.raw`[\w@./-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|sql|ya?ml|json|toml):\d+`,
);

/** `## <heading>` slices of a section, fenced code respected. */
function slicesByHeading(markdown: string): Array<{ heading: string; body: string }> {
  const out: Array<{ heading: string; body: string }> = [];
  let heading: string | null = null;
  let body: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = fenced ? null : line.match(/^##\s+(?!#)(.+)$/);
    if (m) {
      if (heading !== null) out.push({ heading, body: body.join('\n') });
      heading = m[1]!.replace(/[`*_]/g, '').trim();
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  if (heading !== null) out.push({ heading, body: body.join('\n') });
  return out;
}

export const SECTION_TYPES = [
  // ORIENT
  'big_picture', 'concepts',
  // UNDERSTAND
  'architecture_deep', 'traced_flows', 'code_map', 'capabilities',
  // DO
  'setup_run', 'first_change', 'common_tasks',
  // CONSULT
  'routes_jobs', 'data_model', 'guardrails_ops',
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export type Chapter = 'orient' | 'understand' | 'do' | 'consult';
export type SectionMode = 'explanation' | 'tutorial' | 'howto' | 'reference';

export const CHAPTERS: Record<Chapter, { title: string; blurb: string }> = {
  orient: {
    title: 'Orient',
    blurb: 'What this system is and the vocabulary it thinks in — read first, ~10 minutes.',
  },
  understand: {
    title: 'Understand',
    blurb: 'The deep middle: subsystems, end-to-end flows, the files that matter, and what the product does.',
  },
  do: {
    title: 'Do',
    blurb: 'Hands on: run it, make your first change, and the recipes for this repo\'s recurring tasks.',
  },
  consult: {
    title: 'Consult',
    blurb: 'Reference tables generated from code facts — routes, jobs, data model, guardrails. Look things up; don\'t read linearly.',
  },
};

/**
 * Canonical display titles. Section titles are standardized — the LLM's
 * title suggestion is ignored so packages always read the same.
 */
export const SECTION_TITLES: Record<SectionType, string> = {
  big_picture: 'The Big Picture',
  concepts: 'Concepts & Vocabulary',
  architecture_deep: 'Architecture in Depth',
  traced_flows: 'Traced Flows: End to End',
  code_map: 'Code Map: Files That Matter',
  capabilities: 'Capabilities: What It Does',
  setup_run: 'Set Up & Run It',
  first_change: 'Your First Change',
  common_tasks: 'Common Tasks',
  routes_jobs: 'Routes, Jobs & Webhooks',
  data_model: 'Data Model',
  guardrails_ops: 'Guardrails & Operations',
};

export interface SectionDeps {
  snapshotId: string;
  projectId: string;
  role: DeveloperRole;
  /** Loaded once per package generation and shared across sections. */
  projections: ProjectedTarget[];
  /** Depth-contract size class, from the snapshot's symbol count. */
  sizeClass: 'small' | 'mid' | 'large';
}

/** Output budgets by repo size class (depth contract — plan rule 7). */
export interface OutputBudget {
  small: number;
  mid: number;
  large: number;
}

export interface SectionSpec {
  chapter: Chapter;
  mode: SectionMode;
  views: ViewType[];
  retrievalTask: (role: DeveloperRole) => string;
  instructions: string;
  deterministic: (deps: SectionDeps) => Promise<Record<string, unknown>>;
  diagrams?: (deps: SectionDeps) => Promise<DiagramSpec[]>;
  /**
   * CONSULT only: deterministic markdown the generator splices in where the
   * model writes [[backbone]] (appended after the intro if the marker is
   * missing). The model annotates around it; the facts stay byte-stable.
   */
  backbone?: (deps: SectionDeps) => Promise<string>;
  /**
   * Deterministic coverage check against the section's own facts — the
   * model intermittently ships a TL;DR and stops (measured ~50% collapse on
   * enumeration-heavy sections). Returned issues trigger the existing
   * stricter retry with a concrete "you covered X of Y" complaint.
   */
  completenessCheck?: (content: string, deterministic: Record<string, unknown>) => string[];
  outputBudget: OutputBudget;
}

/** Items named in the facts that the prose never mentions. */
function missingItems(content: string, wanted: string[], label: string, minShare = 0.7): string[] {
  if (wanted.length === 0) return [];
  const missing = wanted.filter((w) => w && !content.includes(w));
  const covered = wanted.length - missing.length;
  if (covered >= Math.ceil(wanted.length * minShare)) return [];
  return [
    `INCOMPLETE: you covered ${covered} of ${wanted.length} required ${label} — the section must cover them all. Missing: ${missing.slice(0, 12).join(', ')}`,
  ];
}

/**
 * The schema nouns `concepts` must define, ranked by how connected each table is
 * (plan golden checklist: "`concepts` names 9 solid terms but skips
 * 'snapshot'/'receipt' — weight referenced-BY tables into the must-define
 * stems").
 *
 * Referenced-BY degree is weighted double: a table that many others point at is
 * a shared anchor of the domain — "snapshot" ranks top on this repo precisely
 * because half the schema hangs off it. But in-degree alone still missed
 * "receipt", because `source_receipts` mostly points OUTWARD (project, snapshot,
 * section, node, workflow, step, record) and is pointed at by very little. A
 * table with seven foreign keys is a join table at the centre of the model, so
 * out-degree counts too, at half weight.
 *
 * The names are reduced to the stem a human would say — `analysis_snapshots` →
 * `snapshot` — since that is the word the prose will use, and the word the
 * coverage check has to look for.
 */
export function mustDefineStems(tables: Array<{ name?: string; refs?: string[] | null }>, limit = 6): string[] {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const known = new Set(tables.map((t) => t.name ?? '').filter(Boolean));
  for (const table of tables) {
    const name = table.name ?? '';
    const refs = (table.refs ?? []).filter((r) => r && r !== name);
    outDegree.set(name, refs.length);
    for (const ref of refs) inDegree.set(ref, (inDegree.get(ref) ?? 0) + 1);
  }
  const stems = new Map<string, number>();
  for (const name of known) {
    const score = (inDegree.get(name) ?? 0) * 2 + (outDegree.get(name) ?? 0);
    if (score === 0) continue;
    const stem = name
      .replace(/^(?:analysis_|source_|onboarding_|package_|snapshot_)/, '')
      .replace(/e?s$/, '');
    // Very short stems ("id", "run") match too much prose to be a useful
    // coverage signal, and are rarely the load-bearing noun anyway.
    if (stem.length < 4) continue;
    stems.set(stem, Math.max(stems.get(stem) ?? 0, score));
  }
  return [...stems.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([stem]) => stem);
}

/**
 * A projection target as prompt facts.
 *
 * Only ever called for path-keyed targets (files, symbols), where `stableKey` IS
 * the human-readable name. Keep it that way: models copy whatever identifier
 * they see regardless of instructions, and `wf:`/`cluster:` synthesis keys
 * leaked into three different sections before the specs stopped feeding them
 * through here and started querying workflow titles and cluster labels directly.
 * If a synthesis-keyed projection ever needs to reach a prompt, resolve it to
 * its title first rather than passing the key.
 */
const projectionRow = (t: ProjectedTarget) => ({
  targetType: t.targetType, stableKey: t.stableKey, score: Math.round(t.score * 1000) / 1000, reasons: t.reasons.slice(0, 4),
});

/**
 * "Which tests protect you": tested-key -> test-file keys from the graph's
 * `tests` edges. A named test is a mechanical fact, "well tested" is not.
 */
async function testGuardsFor(snapshotId: string): Promise<Record<string, string[]>> {
  const rows = (await query(
    `SELECT tn.stable_key AS target_key, sn.stable_key AS test_key
     FROM graph_edges e
     JOIN graph_nodes sn ON sn.id = e.source_node_id
     JOIN graph_nodes tn ON tn.id = e.target_node_id
     WHERE e.snapshot_id = $1 AND e.type = 'tests'
     LIMIT 80`,
    [snapshotId],
  )).rows as Array<{ target_key: string; test_key: string }>;
  const guards: Record<string, string[]> = {};
  for (const r of rows) {
    (guards[r.target_key] ??= []).push(r.test_key);
  }
  return guards;
}

/**
 * Journeys (composed + config) with their steps — the flow layer above raw
 * workflows, ordered by `importance_score`.
 *
 * `roleOrder` is the role-general precondition fix (§3 of
 * doc/ROLE_DIFFERENTIATION_PLAN.md): `importance_score` is one number for the
 * whole project, so a
 * section that walks "the most important flows" walked the same flows for
 * every role. Passing the package's projections re-ranks the candidates by the
 * role's own workflow projection, falling back to `importance_score` for any
 * journey the semantic pass never scored — deterministic either way, and no
 * role name appears anywhere in the rule.
 *
 * Callers that omit `roleOrder` keep the previous ordering byte-for-byte.
 */
async function loadJourneys(
  snapshotId: string,
  limit = 8,
  roleOrder?: ProjectedTarget[],
): Promise<Array<Record<string, unknown>>> {
  // Widen the candidate pool before re-ranking, otherwise SQL's LIMIT would
  // have already thrown away the journeys the role cares about.
  const fetchLimit = roleOrder ? Math.max(limit * 3, 12) : limit;
  const rows = (await query(
    `SELECT w.stable_key, w.title, w.trigger_type, w.purpose, w.confidence,
            COALESCE((w.metadata->>'importance_score')::float, 0) AS importance_score,
            w.metadata->'journey'->'member_titles' AS member_titles,
            json_agg(json_build_object('order', ws.step_order, 'file', ws.file_path, 'symbol', ws.symbol_name,
                                       'kind', ws.step_kind, 'description', ws.deterministic_description)
                     ORDER BY ws.step_order) AS steps
     FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
     WHERE w.snapshot_id = $1 AND w.trigger_type IN ('journey', 'dev_command', 'ci_pipeline')
     GROUP BY w.id
     ORDER BY (w.metadata->>'importance_score')::float DESC NULLS LAST, w.stable_key
     LIMIT $2`,
    [snapshotId, fetchLimit],
  )).rows as Array<Record<string, unknown>>;
  if (!roleOrder) return rows.slice(0, limit).map(stripJourneyRanking);
  return rankByRoleProjection(rows, roleOrder, (row) => String(row.stable_key))
    .slice(0, limit)
    .map(stripJourneyRanking);
}

/** Ranking columns are selection inputs, not prompt facts ("No scores in prose"). */
function stripJourneyRanking(row: Record<string, unknown>): Record<string, unknown> {
  const { stable_key: _key, importance_score: _score, ...rest } = row;
  return rest;
}

/**
 * Re-ranks workflow-keyed rows by the package role's workflow projection.
 *
 * One rule, shared by the traced-flows facts and its diagrams so the two can
 * never disagree: rows the projection scored come first, best first; rows it
 * never scored keep the order they arrived in (which the callers make
 * deterministic in SQL). Stable throughout — equal scores never reshuffle,
 * because the section cache keys on these facts and a wobbling order would
 * cost a regeneration for nothing. No role name is referenced anywhere; the
 * weights that produced `score` are the only role-specific input.
 */
function rankByRoleProjection<T>(
  rows: T[],
  projections: ProjectedTarget[],
  keyOf: (row: T) => string,
): T[] {
  const roleScore = new Map(
    projections.filter((p) => p.targetType === 'workflow').map((p) => [p.stableKey, p.score]),
  );
  return rows
    .map((row, index) => ({ row, index, score: roleScore.get(keyOf(row)) }))
    .sort((a, b) => {
      if ((a.score === undefined) !== (b.score === undefined)) return a.score === undefined ? 1 : -1;
      if (a.score !== undefined && b.score !== undefined && a.score !== b.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * Coverage counts for the prompt. The whole object is JSON-stringified into
 * the evidence fence, so the KEY NAMES are what the model reads — `file_count`
 * meant "every file in scope, images and lockfiles included", and the model
 * duly narrated it as the size of the codebase it had been shown. These names
 * say exactly which denominator each number is, and `filesTheParserRead` is
 * the one that bounds what any claim can be based on.
 */
const snapshotCounts = async (snapshotId: string) => {
  const row = (await query(
    `SELECT file_count, parsed_file_count, symbol_count, workflow_count, language_inventory
     FROM analysis_snapshots WHERE id = $1`,
    [snapshotId],
  )).rows[0] as
    | {
        file_count: number;
        parsed_file_count: number | null;
        symbol_count: number;
        workflow_count: number;
        language_inventory: { supportedFileCount?: number; unsupportedFileCount?: number; unsupported?: Record<string, number> } | null;
      }
    | undefined;
  if (!row) return undefined;

  const inv = row.language_inventory ?? {};
  return {
    filesTheParserRead: row.parsed_file_count,
    filesInScopeIncludingNonSource: row.file_count,
    filesInASupportedLanguage: inv.supportedFileCount ?? null,
    filesSkippedUnsupportedLanguage: inv.unsupportedFileCount ?? null,
    skippedLanguages: inv.unsupported ?? {},
    symbols: row.symbol_count,
    workflows: row.workflow_count,
    /**
     * Languages present in the repo that no parser reads, largest first, with
     * the share of the repo they represent.
     *
     * Pre-computed as a sentence rather than left as a map for the model to
     * interpret. FloowForge is 100 Python files out of 167 — roughly forty
     * FastAPI route handlers — and its generated package never once said the
     * word "Python": a reader finished it believing FloowForge is a frontend.
     * The facts were present in `skippedLanguages` and simply never surfaced,
     * because `coverageNote` told the model what NOT to claim and never told
     * it what it MUST disclose.
     */
    unreadStacks: unreadStackSummary(inv.unsupported ?? {}, row.file_count),
    // A STATEMENT, not a directive — see `unreadStackSummary` for why the
    // difference is load-bearing. The prohibition this used to carry ("Never
    // describe the codebase as N files") now lives in `COUNTS_CONTRACT`.
    coverageNote:
      row.parsed_file_count === null
        ? 'The number of files the parser actually read is unavailable for this snapshot.'
        : `The parser read ${row.parsed_file_count} files. The ${row.file_count}-file total for this repository also counts assets, docs and lockfiles that nothing was extracted from.`,
  };
};

/**
 * Prose for the languages nothing was extracted from, or null when trivial.
 *
 * EVERY STRING RETURNED HERE IS A STATEMENT OF FACT ABOUT THE REPOSITORY, never
 * an instruction to the model. That distinction is not style — it is the whole
 * mechanism, and getting it wrong shipped to readers.
 *
 * This field is serialised into the deterministic-facts fence, which the prompt
 * presents as authoritative content to narrate. It used to end with
 * "You MUST say so plainly in your own words — a reader who is not told will
 * assume this part of the system does not exist." A model handed a sentence it
 * is told to reproduce, with no other Python evidence to write about, does the
 * obvious thing: FloowForge's `big_picture` shipped that sentence VERBATIM,
 * second person and all, to a reader who had asked what the system does.
 *
 * An instruction phrased as "you MUST say X in your own words" is
 * indistinguishable from content once it sits inside a data blob, so the fix is
 * channel separation rather than wording: the FACT is here, the OBLIGATION is
 * in the section's `instructions` (`big_picture` and `architecture_deep` both
 * already carry it), and `explanationLint`'s `prompt_voice` rule fails any
 * section that ships the instruction voice anyway.
 */
function unreadStackSummary(unsupported: Record<string, number>, filesInScope: number): {
  mustDisclose: boolean;
  sentence: string;
  languages: Array<{ language: string; files: number }>;
} | null {
  // Source-ish languages only: markdown, json and images being unparsed is
  // expected and disclosing it would be noise. A language nobody reads that
  // holds real code is the case a reader must be told about.
  const NON_SOURCE = new Set(['markdown', 'json', 'yaml', 'css', 'html', 'text', 'other', 'unknown', 'svg', 'image']);
  const langs = Object.entries(unsupported)
    .filter(([lang, n]) => n > 0 && !NON_SOURCE.has(lang.toLowerCase()))
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files);
  if (langs.length === 0) return null;

  const total = langs.reduce((n, l) => n + l.files, 0);
  const share = filesInScope > 0 ? Math.round((total / filesInScope) * 100) : 0;
  const list = langs.slice(0, 3).map((l) => `${l.language} (${l.files} files)`).join(', ');
  // 10% of a repo in an unread language is enough that a reader who is not
  // told will form a wrong model of what the system is.
  const mustDisclose = share >= 10 || total >= 20;
  return {
    mustDisclose,
    languages: langs,
    sentence: mustDisclose
      ? `${total} files (${share}% of this repository) are written in ${list}, which OnboardBuddy does not parse. No section of this package describes that code.`
      : `${total} files in ${list} were not parsed.`,
  };
}

export const SECTION_SPECS: Record<SectionType, SectionSpec> = {
  // ═══ ORIENT ═══════════════════════════════════════════════════════════════

  big_picture: {
    chapter: 'orient',
    mode: 'explanation',
    views: ['purpose', 'domain'],
    retrievalTask: () => 'What this system is end to end: its purpose, runtime processes, product journeys, and external services.',
    instructions: withContracts([
      'Explain what this system IS — the reader has never seen it. The anchor diagram (runtime topology) opens the section; refer to it, never contradict it.',
      'Cover, as flowing prose with a few short headers: (1) what the system does end to end and for whom, from the evidence; (2) the runtime shape — each compose service/process and its job, plus the external services (from the topology facts); (3) the product journeys BY NAME (the journeys data is authoritative — walk the 2-4 most important in one paragraph each: what enters, what crosses which boundary, what comes out); (4) why the system is shaped this way — the 2-3 structural decisions visible in the evidence (queues between phases, content-addressing, separate worker), each with its receipt.',
      'No instructions, no tables, no file inventories — link forward: details live in Architecture in Depth, commands in Set Up & Run It, lookup tables in the Consult chapter.',
      // A reader who is not told forms a wrong model of the whole system, and
      // this is the section where that model is formed.
      // Measured: OnboardBuddy (1 CSS + 1 HTML file of 268) shipped "A
      // substantial part of this repository is written in languages that were
      // not parsed" — the phrase is in the instruction, so the model prints it
      // whatever the count is. Demand the number instead of the adjective.
      'IF `snapshot.unreadStacks.mustDisclose` is true you MUST state, in the opening paragraphs, the EXACT counts from `snapshot.unreadStacks` — "N files (P% of this repository) are written in <language>, which nothing here parsed" — and say that no section describes that code. Never write "a substantial part" or any other vague quantifier in place of the number. If `mustDisclose` is false, do not mention unparsed languages at all: stylesheets and markup being unparsed is expected and saying so is noise.',
    ]),
    deterministic: async (deps) => {
      const facts = await loadConfigFacts(deps.snapshotId);
      return {
        snapshot: await snapshotCounts(deps.snapshotId),
        topology: facts.topology,
        externalServices: envExternalServices(facts.envFiles.flatMap((f) => f.vars.map((v) => v.name))),
        journeys: await loadJourneys(deps.snapshotId, 6),
        topClusters: (await query(
          // fileCount from the cluster's own metadata — a row count over
          // architecture_cluster_members counts symbols and config nodes too,
          // so it reported a cluster as several times larger than its file
          // membership and the model narrated that inflated size.
          `SELECT c.label, c.kind,
                  COALESCE((c.metadata->>'fileCount')::int, 0) AS file_count,
                  c.metadata->>'primaryMemberNoun' AS member_noun
           FROM architecture_clusters c WHERE c.snapshot_id = $1 ORDER BY c.critical_score DESC LIMIT 8`,
          [deps.snapshotId],
        )).rows,
      };
    },
    diagrams: async (deps) => {
      const facts = await loadConfigFacts(deps.snapshotId);
      if (facts.topology) {
        const externals = envExternalServices(facts.envFiles.flatMap((f) => f.vars.map((v) => v.name)));
        return [{ kind: 'topology', mermaid: topologyDiagram(facts.topology.services, externals) }];
      }
      // No compose file: fall back to the cluster map so the anchor rule holds.
      const clusters = (await query(
        `SELECT stable_key, label, kind FROM architecture_clusters WHERE snapshot_id = $1`,
        [deps.snapshotId],
      )).rows as Array<{ stable_key: string; label: string; kind: string }>;
      const edges = (await query(
        `SELECT sc.stable_key AS source_key, tc.stable_key AS target_key, e.type, e.weight
         FROM architecture_edges e
         JOIN architecture_clusters sc ON sc.id = e.source_cluster_id
         JOIN architecture_clusters tc ON tc.id = e.target_cluster_id
         WHERE e.snapshot_id = $1`,
        [deps.snapshotId],
      )).rows as Array<{ source_key: string; target_key: string; type: string; weight: number }>;
      return [{
        kind: 'architecture',
        mermaid: architectureDiagram(
          clusters.map((c) => ({ stableKey: c.stable_key, label: c.label, kind: c.kind })),
          edges.map((e) => ({ sourceClusterKey: e.source_key, targetClusterKey: e.target_key, type: e.type, weight: e.weight })),
        ),
      }];
    },
    outputBudget: { small: 4_000, mid: 6_000, large: 8_000 },
  },

  concepts: {
    chapter: 'orient',
    mode: 'explanation',
    views: ['domain', 'purpose'],
    retrievalTask: () => 'The domain vocabulary this codebase thinks in: its core nouns, what each means here, and where each lives.',
    instructions: withContracts([
      'Define the load-bearing vocabulary — the nouns a new joiner must know to follow any conversation about this code. Select 10-14 terms FROM THE EVIDENCE: schema table names, capability names, recurring record/workflow nouns, config concepts. Prefer terms this codebase uses with a SPECIFIC meaning over generic industry words.',
      // Measured on Skribbl (996w, the largest concepts in the corpus): 6 of 15
      // "terms" were filenames (`roomManager.js`, `handlers.js`,
      // `socketService.ts`, `GameRoom.tsx`, `ConnectionStatus`, `useGameSocket`)
      // and one was "UI Components". All four hedges in the section sat on file
      // entries — the model hedges because a file is not a concept and it has
      // nothing conceptual to say about it.
      'A term is a word you could say out loud in a standup ("the room", "the snapshot", "a receipt"). NEVER turn a file path, a module filename, a component filename or a hook name into a term — those belong to Code Map, and repeating them here duplicates a section the same reader will also read. NEVER define a generic industry word ("UI Components", "State Management", "Utilities", "Services", "Helpers"): if the definition would be true of any repo, drop the term.',
      'If the evidence will not support a confident definition, DROP the term — never ship a hedged one. The words "likely", "probably", "suggests", "appears to", "presumably" and "or a related file" must not appear in this section: a definition you have to hedge is not yet a definition. Twelve solid terms beat eighteen padded ones.',
      // The narration fix: `mustDefineTerms` is ranked by how connected each
      // table is in the schema, so the section stops picking readable-but-
      // peripheral nouns over the ones every conversation depends on.
      'START from `mustDefineTerms`. Those are the most connected nouns in this system\'s schema, ranked, and EVERY one of them needs its own "### term" entry — they are the words the rest of the vocabulary is defined in terms of. Add further terms from capabilities, journeys and config to reach 10-18 total.',
      'Format: "### term" then 2-4 sentences: what it means IN THIS SYSTEM (not the dictionary meaning), where it lives (the table and/or module, from the evidence), and how it relates to neighboring terms. Cite a receipt per term.',
      'Order terms so each definition only uses terms already defined. Close with one short paragraph on how the 3-4 most central terms connect end to end.',
    ]),
    deterministic: async (deps) => {
      const schemaTables = (await query(
        `SELECT name, file_path, metadata->'references' AS refs FROM graph_nodes
         WHERE snapshot_id = $1 AND type = 'schema' ORDER BY line_start NULLS LAST LIMIT 45`,
        [deps.snapshotId],
      )).rows as Array<{ name?: string; refs?: string[] | null }>;
      return {
      schemaTables,
      mustDefineTerms: mustDefineStems(schemaTables),
      capabilities: (await query(
        `SELECT name, description FROM capabilities WHERE snapshot_id = $1 LIMIT 12`,
        [deps.snapshotId],
      )).rows,
      clusters: (await query(
        `SELECT label, kind FROM architecture_clusters WHERE snapshot_id = $1 ORDER BY critical_score DESC LIMIT 10`,
        [deps.snapshotId],
      )).rows,
      journeyTitles: (await query(
        `SELECT title, purpose FROM workflows WHERE snapshot_id = $1 AND trigger_type = 'journey'`,
        [deps.snapshotId],
      )).rows,
      envVarNames: (await loadConfigFacts(deps.snapshotId)).envFiles.flatMap((f) => f.vars.map((v) => v.name)).slice(0, 40),
      };
    },
    completenessCheck: (content, det) => {
      const issues: string[] = [];
      const terms = (content.match(/### /g) ?? []).length;
      if (terms < 8) issues.push(`INCOMPLETE: only ${terms} "### term" entries — define 10-14 load-bearing terms from the evidence (domain nouns, not filenames).`);
      // Judged against the SAME ranked list the prompt was given, so the
      // complaint names exactly the terms the model was told to start from.
      const stems = (det.mustDefineTerms as string[] ?? []);
      const lower = content.toLowerCase();
      const missing = stems.filter((stem) => !lower.includes(stem));
      if (stems.length >= 3 && missing.length * 2 > stems.length) {
        issues.push(`INCOMPLETE: the schema's most connected concepts are missing — add a "### term" entry for each of: ${missing.join(', ')}`);
      }
      return issues;
    },
    outputBudget: { small: 5_000, mid: 8_000, large: 11_000 },
  },

  // ═══ UNDERSTAND ═══════════════════════════════════════════════════════════

  architecture_deep: {
    chapter: 'understand',
    mode: 'explanation',
    views: ['purpose', 'dependency'],
    retrievalTask: () => 'System architecture in depth: each subsystem\'s responsibility, boundaries, crossings, and the design decisions behind them.',
    instructions: withContracts([
      // Length is a hard constraint here, not a style preference. This section
      // asked for a subsection per cluster with several required elements each;
      // on FloowForge (9 clusters, `small` size class) the model wrote past
      // `maxOutputTokens` and the structured response was cut mid-array —
      // "Expected ',' or ']' after array element in JSON at position 25336" —
      // which pauses the whole package. The fix is to demand less prose, not to
      // buy more tokens: `clusters` below is already capped at the components
      // worth covering, and the per-component budget is stated in sentences.
      'The anchor diagram (cluster map) opens the section — the prose walks it. Open with "## How a request flows": ONE real end-to-end path across components, naming them in the order it touches them, from `clusterEdges`. One short paragraph.',
      // The measured failure: 0 of 9 live sections contained a single "⇒",
      // even though `loadDecisionNotes` returned 8 notes for OnboardBuddy, 5
      // for Skribbl, 4 for CourseInsights and 3 for FloowForge/MasterPokedex.
      // The old instruction buried "⇒" inside per-cluster subsections the model
      // writes LAST, under a budget it has already spent. Hoisting it into its
      // own named block written SECOND is the difference between 0/9 and a
      // mechanically checkable 9/9.
      'SECOND, before any component subsection, write "## Why it is built this way": one bullet per entry in `decisionNotes`, up to three, each in the literal form "<decision> ⇒ <consequence>" with the "⇒" character present, each citing that note\'s receipt. `decisionNotes` is rationale the repo\'s own authors wrote in their comments, with the file and line it came from — paraphrase it, never quote verbatim, and never invent a decision no note supports. WRITE THIS BLOCK BEFORE THE SUBSECTIONS: a section without it is incomplete no matter how good the subsections are. If `decisionNotes` is empty, the block is the single line "No rationale comments were found in this repository." and nothing more.',
      // Measured on OnboardBuddy: "Fired after the analysis job is accepted, so
      // callers can start polling ⇒ The system initiates analysis jobs and
      // provides a mechanism for callers to monitor their progress." The arrow
      // is present, the gate passes, and the right-hand side is the left-hand
      // side with longer words. The narration check can only count arrows; this
      // is the half of the contract only the instruction can carry.
      'THE RIGHT-HAND SIDE OF "⇒" IS A CONSEQUENCE, NOT A RESTATEMENT. It must tell someone about to change this code something the left-hand side does not already say: what breaks if they undo the decision, what they must change in step with it, what it rules out, what it costs. Restating the comment in more formal words ("… so callers can start polling ⇒ the system provides a mechanism for callers to monitor progress") is the failure mode this rule exists to stop. If a note yields no consequence you can state without repeating it, use a DIFFERENT note from `decisionNotes` — you are given more than three. If none of the remaining notes yield one either, write fewer bullets: one honest decision→consequence bullet is worth more than three that say each thing twice.',
      // Two measured failures fixed here. "Its real file count" invited the
      // count to BE the explanation, producing headings like
      // "Configuration & Deployment — File Count: 0 config files". And
      // direction came from a flat edge list the model had to sort itself,
      // which it did not: the same edge appeared as both In and Out with
      // identical numbers. `clusters[].responsibility` / `.boundary` are the
      // SAME sentences the Architecture tab renders for that component, so the
      // two surfaces can no longer describe one component differently.
      'THEN one "## <label>" subsection for each entry in `clusters` — those only, no subsection for anything else. THREE SENTENCES EACH, hard limit; the limit binds no matter how many facts the entry carries. Sentence 1: what this component is FOR, in this repo\'s own nouns. Sentence 2: the ONE crossing a newcomer would get wrong, and what data rides it. Sentence 3: what the separation means for someone changing code here ("touch X and you must also …"). Each entry gives you `responsibility`, `boundary`, `separation` and `unknowns` — put them in your own words and keep the meaning.',
      // Measured: Skribbl's architecture_deep is an import ledger — "It calls
      // into Shared Utilities, Services, and State, and Modules call into it
      // while State imports it" — and one sentence came out garbled ("It
      // imports `UI`, `State`, and `Services` are imported by it"). The
      // Dependencies tab draws that graph; prose cannot beat it and should not
      // try. Two clusters (UI, Modules) also received interchangeable
      // responsibility sentences.
      'NEVER write a responsibility that is just the label reworded ("API Routes — handles API requests" says nothing) or its cluster kind restated. NEVER list who imports whom or who calls whom: the Dependencies tab draws that graph, an import ledger in prose is unreadable, and it crowds out the explanation. NEVER put a file or symbol count in a sentence; the interface shows counts beside the component already.',
      // Measured: "This component has no unknown runtime interactions or
      // data." / "Its standalone nature in the map might indicate a limitation
      // in tracing." / "its specific responsibilities are inferred solely from
      // its kind." — three sentences about the pipeline's knowledge state, in
      // the section that is supposed to explain the architecture.
      'NEVER write a sentence about what the analysis or the evidence could or could not establish — the reader has the codebase, not our evidence bundle, and the Known Gaps panel already records it. If a component\'s purpose is only inferable from its cluster kind, give it ONE line — "<label> — purpose not established from the code; see the Dependencies tab." — and move on to the next component.',
      // The narration fix: the decisions are handed over as data, and the
      // required sentence shape is stated as a hard format rule rather than an
      // aspiration. Structure-only prose was the measured failure mode.
      // Measured: five verbatim repeats of "keeping it separate prevents
      // <npm deps> from spreading into other parts of the codebase" in one
      // OnboardBuddy section, plus "provides common functionality … avoiding
      // duplication" four times. Every one is a tautology — any module's
      // separation "prevents" its own imports from spreading — and naming npm
      // packages is not a design decision.
      'The `separation` fact is NOT a licence to write "keeping it separate prevents <dependency> from spreading into the rest of the codebase". That sentence is true of every module in every repo, it names libraries rather than decisions, and it must appear AT MOST ONCE in the whole section. Say instead what breaks, or what you must change in step, when someone edits this component.',
      'Close with "## Tensions to know about": exactly three bullets, one line each, on coupling or asymmetry a newcomer will trip on (highest fan-in modules, cycles, wide-blast-radius shared code — from centralNodes). Give the real number from `centralNodes` where you have it ("`db.ts` has 47 dependents"), never "a high fan-in".',
      'If `otherClusters` is non-empty, name those components in ONE sentence at the end and say they are smaller and left out of this walkthrough. Do not give them subsections.',
      'The interactive Architecture tab holds the full drill-down graph — say so once at the end, not per cluster.',
      // The citation desert, and why the general "cite your claims" rule never
      // reached this section. Measured across 11 stored packages: SEVEN
      // architecture_deep sections carry zero citations of any kind — no
      // receipt marker, no alias, no file:line — over 3,000-4,900 characters of
      // claim paragraphs each. The reason is in the base prompt, which tells
      // every section that "a claim grounded in the deterministic facts carries
      // an EMPTY receiptIds array". Every sentence this section is asked for is
      // grounded in `clusters[].responsibility/boundary/separation`, so the
      // model correctly concluded that none of them owed a receipt — and a
      // component map with nothing to open is exactly the section the reviewer
      // said "does not make sense". The evidence was always there: every
      // component has member receipts and every decision note is citable at its
      // comment line. They just were not labelled as belonging to a component,
      // so the model could not tell which of forty file paths went with which
      // heading. They are labelled now ("evidence for: …") — this makes using
      // them the contract.
      'EVERY "## <label>" COMPONENT SUBSECTION MUST CARRY AT LEAST ONE CITATION. The receipt list below labels each receipt with what it is evidence for — "evidence for: Member of the \\"Backend · Workers\\" cluster", "evidence for: Design rationale recorded in the code: …". Match the label to the heading you are writing and cite that receipt as "(r7)". The responsibility and boundary sentences come from the deterministic facts, and that does NOT excuse the subsection from a citation: a reader who cannot open one real file for a component has been given a shape, not an explanation. Every "<decision> ⇒ <consequence>" bullet cites the rationale note it paraphrases, by its short id.',
      'IF `snapshot.unreadStacks.mustDisclose` is true, add a "## Not covered here" subsection of at most three sentences naming the unparsed language(s) and saying plainly that those files form part of this system but no component above describes them. A component map that silently omits an entire stack reads as the complete architecture.',
    ]),
    deterministic: async (deps) => {
      // One component per subsection, and the subsection count is what drove
      // the output past its budget — so the cap lives here, in the data, where
      // the completeness check can read the same list the prompt was given.
      // Ranked by criticality, so what gets cut is what matters least.
      const allClusters = (await query(
        // See the note on topClusters: file_count is the cluster's own
        // metadata, not a member row count over symbols and configs.
        `SELECT c.stable_key, c.label, c.kind, c.critical_score,
                COALESCE((c.metadata->>'fileCount')::int, 0) AS file_count,
                COALESCE((c.metadata->>'memberCount')::int, 0) AS member_count,
                c.metadata->>'primaryMemberNoun' AS member_noun
         FROM architecture_clusters c WHERE c.snapshot_id = $1 ORDER BY c.critical_score DESC`,
        [deps.snapshotId],
      )).rows as Array<{
        stable_key: string; label: string; kind: string;
        critical_score: string; file_count: number; member_count: number; member_noun: string | null;
      }>;
      // The narrative the Architecture tab renders, from the same rows. The
      // section used to compose its own boundary prose out of `workflowCrossings`
      // stable keys (`wf:web/app/page.tsx:Home`) — bookkeeping the output rules
      // forbid printing — while the tab printed a count-only summary. Two
      // renderings, one dataset, one set of sentences.
      const narratives = await loadClusterNarratives(deps.snapshotId);
      // Sized by whichever member type the cluster is actually made of: a
      // Database Schema cluster holds 37 tables and zero files, and filtering
      // on file_count alone dropped it out of the architecture section entirely.
      const major = allClusters.filter((c) => Math.max(c.file_count, c.member_count) > 2);
      // A repo of many tiny components still has an architecture. Falling back
      // to the top few keeps the section from emitting a walk with nothing in it.
      const covered = (major.length > 0 ? major : allClusters).slice(0, MAX_NARRATED_CLUSTERS);

      return {
        // Routed in so the prose has WHY to work with and not only structure
        // (plan golden checklist: "describes structure without
        // decision→consequence language").
        // Coverage reaches this section too, not only big_picture. A component
        // map that silently omits an entire unread backend is the single most
        // misleading thing this product can produce — a reader concludes the
        // component map IS the system.
        snapshot: await snapshotCounts(deps.snapshotId),
        decisionNotes: (await loadDecisionNotes(deps.snapshotId, 8)).map((n) => ({
          where: `${n.filePath ?? n.nodeStableKey}${n.lineStart ? `:${n.lineStart}` : ''}`,
          symbol: n.symbolName,
          rationale: n.note,
        })),
        clusters: covered.map((c) => {
          const n = narratives.get(c.stable_key);
          return {
            label: c.label,
            kind: c.kind,
            responsibility: n?.responsibility ?? null,
            boundary: n?.boundary ?? null,
            separation: n?.separation ?? null,
            unknowns: n?.unknowns ?? [],
          };
        }),
        // Named so the section can say what it left out in one line instead of
        // silently presenting a partial map as the whole architecture.
        otherClusters: allClusters.filter((c) => !covered.includes(c)).map((c) => c.label),
        // Kept flat and compact purely so the opening request-flow walk has a
        // chainable topology; direction and traffic per component already live
        // in `clusters[].boundary`.
        clusterEdges: (await query(
          `SELECT sc.label AS from_cluster, tc.label AS to_cluster, e.type
           FROM architecture_edges e
           JOIN architecture_clusters sc ON sc.id = e.source_cluster_id
           JOIN architecture_clusters tc ON tc.id = e.target_cluster_id
           WHERE e.snapshot_id = $1 ORDER BY e.weight DESC LIMIT 24`,
          [deps.snapshotId],
        )).rows,
        centralNodes: (await query(
          `SELECT stable_key, name, (metadata->>'dependentCount')::int AS dependents
           FROM graph_nodes WHERE snapshot_id = $1 AND (metadata->>'dependentCount')::int > 0
           ORDER BY 3 DESC LIMIT 8`,
          [deps.snapshotId],
        )).rows,
      };
    },
    diagrams: async (deps) => {
      const clusters = (await query(
        `SELECT stable_key, label, kind FROM architecture_clusters WHERE snapshot_id = $1`,
        [deps.snapshotId],
      )).rows as Array<{ stable_key: string; label: string; kind: string }>;
      const edges = (await query(
        `SELECT sc.stable_key AS source_key, tc.stable_key AS target_key, e.type, e.weight
         FROM architecture_edges e
         JOIN architecture_clusters sc ON sc.id = e.source_cluster_id
         JOIN architecture_clusters tc ON tc.id = e.target_cluster_id
         WHERE e.snapshot_id = $1`,
        [deps.snapshotId],
      )).rows as Array<{ source_key: string; target_key: string; type: string; weight: number }>;
      return [{
        kind: 'architecture',
        mermaid: architectureDiagram(
          clusters.map((c) => ({ stableKey: c.stable_key, label: c.label, kind: c.kind })),
          edges.map((e) => ({ sourceClusterKey: e.source_key, targetClusterKey: e.target_key, type: e.type, weight: e.weight })),
        ),
      }];
    },
    completenessCheck: (content, det) => {
      const issues: string[] = [];
      // `det.clusters` IS the bounded list the prompt was handed, so the retry
      // can never demand coverage the instructions did not ask for. It used to
      // re-filter every cluster in the snapshot by file count, which meant a
      // 9-component repo was told to cover nine — and each retry pushed the
      // response further past its output budget until the JSON was cut off.
      const majorClusters = (det.clusters as Array<{ label?: string }> ?? []).map((c) => c.label ?? '');
      issues.push(...missingItems(content, majorClusters, 'components'));

      // The narration gate. "⇒" is required because the instructions name that
      // exact shape, which makes the check mechanical: counting "because" would
      // pass on ordinary descriptive prose and gate nothing. Only demanded when
      // the section was actually GIVEN rationale to work with — otherwise this
      // would force the model to invent decisions, the opposite of the goal.
      // Measured live: 0 of 9 shipped sections contain a single "⇒", although
      // six of those repos had ≥2 decisionNotes available — so the check fired,
      // the retry ran, and nothing changed. Two things were wrong. (1) The gate
      // started at `notes >= 2`, so the three repos with 0-1 notes
      // (DeepRecall, Multiplayer-Tetris, UBCPSS) could ship pure structure with
      // a green check. (2) Nothing asserted the "## Why it is built this way"
      // block exists, so the model could satisfy neither and still pass.
      const notes = (det.decisionNotes as unknown[] ?? []).length;
      const hasWhyBlock = /##\s*Why it is built this way/i.test(content);
      if (notes >= 1) {
        const stated = (content.match(/⇒/g) ?? []).length;
        // The instructions now tell the model to DROP a bullet whose right-hand
        // side would only restate its left, rather than pad the count. A gate
        // demanding one arrow per available note would hand that permission back
        // with the other hand — so a repo with one or two rationale comments
        // owes one honest bullet, not one per comment. Three or more notes still
        // owes three: `loadDecisionNotes` hands over up to eight, so there is
        // room to swap out a note that yields nothing.
        const wanted = notes >= 3 ? 3 : 1;
        if (stated < wanted) {
          issues.push(
            `INCOMPLETE: ${stated} of ${wanted} required decision→consequence statements — write a "## Why it is built this way" block BEFORE the component subsections with one "<decision> ⇒ <consequence>" bullet per decisionNotes entry, using a literal "⇒" and citing that note's receipt. Structure without a stated reason is not an explanation.`,
          );
        }
      } else if (!hasWhyBlock) {
        issues.push(
          'INCOMPLETE: the "## Why it is built this way" block is missing — no rationale comments were found in this repository, so the block must say exactly that in one line rather than being omitted.',
        );
      }
      if (!/##\s*Tensions/i.test(content)) {
        issues.push('INCOMPLETE: the closing "## Tensions to know about" section is missing.');
      }

      // The citation gate — the half of the contract the prompt could only ask
      // for. Measured on the stored corpus: CourseInsights, FloowForge,
      // Multiplayer-Tetris, NationalPokedex, OnboardBuddy, StudyFlow and UBCPSS
      // all shipped architecture_deep with zero citations, and every one of
      // them passed this check, because it only ever counted headings and
      // arrows. Two thresholds, because the two failures are different: a
      // section with nothing citable anywhere is a desert, and a section that
      // cites its decisions but leaves every component bare is a map of things
      // the reader cannot open.
      if (!CITATION_IN_PROSE.test(content)) {
        issues.push(
          'INCOMPLETE: this section cites NOTHING — not one receipt id, not one file:line. Every component subsection has member receipts in the list, each labelled "evidence for: Member of the …" with the component it belongs to. Cite one per subsection as "(r7)", and cite each decision note on the bullet that paraphrases it.',
        );
      } else {
        // Judged only on the components that actually got a subsection, so the
        // complaint can never be about a heading the model was right to omit.
        const componentSlices = slicesByHeading(content).filter((s) =>
          majorClusters.some((label) => label && s.heading.includes(label)),
        );
        const narrated = componentSlices.length;
        const bare = componentSlices
          .filter((s) => {
            const body = s.body.replace(/\s+/g, ' ').trim();
            // The prompt's own escape hatch — "<label> — purpose not established
            // from the code; see the Dependencies tab." — is the honest answer
            // for a component nothing explains. Demanding a receipt for it would
            // force the model to invent evidence for the one thing it just said
            // it has none of. Same for a body too short to be a claim.
            if (body.length < 40) return false;
            if (/purpose not established|not established from the code/i.test(body)) return false;
            return !CITATION_IN_PROSE.test(body);
          })
          .map((s) => s.heading);
        if (narrated >= 2 && bare.length * 2 > narrated) {
          issues.push(
            `INCOMPLETE: ${bare.length} of ${narrated} component subsections cite nothing — ${bare.slice(0, 4).join(', ')}. Each of these has at least one receipt in the list labelled "evidence for: Member of the “<component>” cluster"; cite it as "(r7)" in the sentence it supports. A component the reader cannot open one file of has been described, not explained.`,
          );
        }
      }
      return issues;
    },
    // `small` carries headroom the other classes do not need: FloowForge is 256
    // symbols (small) but NINE components, because two thirds of it is Python
    // this pipeline cannot parse — so the size class understates how much
    // structure the section has to describe. Overrunning here does not truncate
    // the prose, it truncates the JSON mid-array and pauses the whole package,
    // which is worth a little slack against.
    outputBudget: { small: 7_000, mid: 10_000, large: 15_000 },
  },

  traced_flows: {
    chapter: 'understand',
    mode: 'explanation',
    views: ['purpose', 'operations'],
    retrievalTask: () => 'End-to-end flows: what each product journey does step by step across boundaries, and why each hop exists.',
    instructions: withContracts([
      'Walk the provided journeys end to end — journeys are the authoritative flow layer (they already stitch route -> queue -> worker hops; member workflows are the drill-down). One "## <journey title>" per journey, most important first; each journey\'s sequence diagram is attached in order — refer to it.',
      'Per journey: one sentence on what it accomplishes, then the steps IN ORDER. Each step is ONE line: the real `file::symbol`, then what that code DOES to the request or the data, in this repo\'s nouns. When a hop crosses a boundary (queue, redirect, external service) say which boundary and what carries across it.',
      // Measured on OnboardBuddy: "**Data Write:** …:sign persists data." —
      // the kind label said twice. "**Auth Guard:** …verifyInstallationState
      // checks authentication and authorization." Same. "**Transform:** …
      // crosses a boundary within the same integration surface" appeared three
      // times verbatim in one journey, and steps 3+4, 6+7, 9+10, 12+13 were the
      // same route twice — 8 of 14 steps were duplicates.
      'NEVER RESTATE THE STEP KIND. A step labelled Data Write may not say "persists data" or "writes data"; an Auth Guard may not say "checks authentication"; a Trigger may not say "is the entry point"; a Transform may not say "crosses a boundary". Those words are already the label — say what is written, what is checked, or what is transformed. If the only thing known about a hop is its kind, fold it into the neighbouring step instead of giving it a line, and NEVER give two consecutive steps to the same `file::symbol` — collapse them into one.',
      'Use only traced steps — never invent steps. Describe failure handling only from visible evidence; if none is visible for a journey, write "failure handling not visible in the trace".',
      // Measured on FloowForge: the "Why this design" block answered the
      // prompt's own checklist out loud — "Queue between phases: Not
      // applicable as this is a linear CI process. / Auth guard placement: Not
      // applicable as this is an automated CI process." — and those "not
      // applicable" strings also satisfy the lint's gap-disclosure rule, so
      // padding the section earns it a passing grade.
      'Write "Why this design" ONLY where a real structural choice is visible with a receipt. NEVER answer a question with "Not applicable", "N/A", or "this is a linear process": if a journey has no queue and no auth guard, omit the heading entirely rather than printing the checklist back.',
      // Measured: OnboardBuddy's traced_flows walked "Local dev: docker compose
      // up" (Trigger + three "Starts service X") and "Run the test suite"
      // (Trigger + "Runs tests") — setup_run duplicated at lower quality.
      'Journeys whose trigger is a development command (docker compose, a test runner, a CI pipeline) belong to Set Up & Run It. Name them in ONE line and point there; do not walk their steps here.',
      'When a step WRITES data, say so explicitly — do not soften writes into reads.',
    ]),
    deterministic: async (deps) => ({
      // Role-scoped ordering: "most important first" now means most important
      // TO THIS ROLE, with `importance_score` as the deterministic fallback
      // (doc/ROLE_DIFFERENTIATION_PLAN.md §3).
      journeys: await loadJourneys(deps.snapshotId, 5, deps.projections),
      // Members give the model per-hop drill-down steps for the narrative.
      memberWorkflows: (await query(
        `SELECT w.title, w.trigger_type, w.purpose,
                json_agg(json_build_object('order', ws.step_order, 'file', ws.file_path, 'symbol', ws.symbol_name,
                                           'kind', ws.step_kind, 'description', ws.deterministic_description)
                         ORDER BY ws.step_order) AS steps
         FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
         WHERE w.snapshot_id = $1 AND w.stable_key IN (
           SELECT jsonb_array_elements_text(metadata->'journey'->'members')
           FROM workflows WHERE snapshot_id = $1 AND trigger_type = 'journey'
         )
         GROUP BY w.id LIMIT 12`,
        [deps.snapshotId],
      )).rows,
    }),
    completenessCheck: (content, det) => {
      const titles = (det.journeys as Array<{ title?: string }> ?? []).map((j) => j.title ?? '');
      return missingItems(content, titles, 'journeys', 1);
    },
    diagrams: async (deps) => {
      // "each journey's sequence diagram is attached in order" — so the
      // diagrams must be re-ranked by exactly the rule the facts were, or the
      // prose's first journey gets the second journey's diagram.
      const rows = (await query(
        `SELECT w.stable_key, w.title,
                json_agg(json_build_object('stepOrder', ws.step_order, 'filePath', ws.file_path,
                                           'symbolName', ws.symbol_name, 'stepKind', ws.step_kind,
                                           'description', ws.deterministic_description)
                         ORDER BY ws.step_order) AS steps
         FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
         WHERE w.snapshot_id = $1 AND w.trigger_type = 'journey'
         GROUP BY w.id
         ORDER BY (w.metadata->>'importance_score')::float DESC NULLS LAST, w.stable_key
         LIMIT 12`,
        [deps.snapshotId],
      )).rows as Array<{ stable_key: string; title: string; steps: DiagramStep[] }>;
      const journeys = rankByRoleProjection(rows, deps.projections, (r) => r.stable_key).slice(0, 4);
      return journeys.map((j) => ({ kind: 'sequence' as const, mermaid: workflowSequenceDiagram(j.title, j.steps) }));
    },
    outputBudget: { small: 6_000, mid: 10_000, large: 14_000 },
  },

  code_map: {
    chapter: 'understand',
    mode: 'explanation',
    views: ['purpose', 'dependency'],
    retrievalTask: (role) => `The files that matter most and why — what each does, its key functions, and how they connect, for a ${roleDescriptor(role)} developer.`,
    instructions: withContracts([
      'A guided map of the files that matter, GROUPED BY SUBSYSTEM (the groups come from fileGroups — never present a flat ranked list; ranking selected the entries, grouping presents them).',
      'One "## <subsystem>" per group. Per file: `path` as a sub-heading or bold lead, then 1-2 sentences on why it matters HERE (from its record evidence: what it orchestrates, who depends on it — the dependents number is provided), then its key functions in the micro-format: `name(signature)` — one-liner · params worth knowing · returns · gotcha (only when the evidence shows one). Then one line: what calls it / what it calls (from the evidence).',
      // Measured: 44.4× length spread, the widest of any section type.
      // FloowForge shipped 36 words and mapped ZERO files at `confidence:
      // high`; MasterPokedex shipped 1,095 words over 36 files with ZERO
      // function signatures — 30 words per file. The old rule ("cover every
      // file") plus a completeness check that counted PATH MENTIONS actively
      // rewarded the padding: naming 36 paths scored 100%, while ten files
      // documented properly would have failed.
      'DEPTH BEATS BREADTH. Cover the 8-14 files from `fileGroups` a newcomer opens first — NOT all of them. A file entry without at least one `name(signature)` line is not worth its space: drop the file rather than write a blurb about it. Name the files you left out in ONE closing line.',
      // Measured on OnboardBuddy: the file blurbs were the criticality
      // scorer's own `reasons` re-narrated — "its functionality is a direct
      // dependency for application operation", "Compromising this module poses
      // significant security and business risk", "It supports critical
      // business flows". A newcomer opening the file learns nothing from any
      // of them.
      'NEVER narrate WHY a file ranked highly ("central to", "critical for", "a direct dependency for application operation", "compromising this module poses significant risk", "supports critical business flows"). The ranking is why the file is on this page, not a fact about the code — say what the file DOES and what is inside it. No scores in prose.',
      // Measured: 8 prose statements of "This component has 0 direct
      // dependents." — AUDIT_LEDGER C1 leaking out of the graph API into text.
      'Numbers (dependents, counts) come verbatim from the facts, but NEVER state a dependent count of zero — omit the sentence instead; a zero here means the graph did not resolve the edge, not that nothing imports the file.',
      // Measured: 65 unresolved bare aliases survived into the corpus, 46 of
      // them in one Multiplayer-Tetris code_map, as trailing "· r17, r26".
      // rewriteInlineCitations only rewrites "(r3)" and "[r3]".
      'Cite with the short id in parentheses — "(r7)" — inside the sentence it supports. A bare "r17" or a trailing "· r17, r26" at the end of a line is NOT a citation, will not resolve, and ships to the reader as noise.',
    ]),
    deterministic: async (deps) => {
      // Role-general precondition fix (doc/ROLE_DIFFERENTIATION_PLAN.md §1):
      // this is the one section whose retrieval task interpolates the role
      // ("for a ${role} developer"), and it used to pick its files from raw
      // `criticality_scores` — max score per file across ANY view, weights
      // never applied. Every role therefore got a byte-identical map, so
      // tuning role weights could not move it.
      //
      // The role projection ranks first. The raw scan stays as the BACKFILL,
      // not as the ranking: projections are symbol/workflow-heavy and carry
      // only a handful of file targets, which is what starved this section to
      // a 2-file map when the projection was tried alone. Projected files
      // (role-scoped, weighted) take the head of the list; unprojected ones
      // fill the remainder by raw criticality so coverage never shrinks.
      const ranked = (await query(
        `SELECT DISTINCT ON (stable_key) stable_key, score, reasons
         FROM criticality_scores
         WHERE snapshot_id = $1 AND target_type = 'file'
         ORDER BY stable_key, score DESC`,
        [deps.snapshotId],
      )).rows as Array<{ stable_key: string; score: number; reasons: string[] }>;
      const projectedFiles = new Map(
        deps.projections.filter((p) => p.targetType === 'file').map((p) => [p.stableKey, p]),
      );
      const candidates = new Map<string, { stableKey: string; reasons: string[]; roleScore: number | null; rawScore: number }>();
      for (const row of ranked) {
        const projection = projectedFiles.get(row.stable_key);
        candidates.set(row.stable_key, {
          stableKey: row.stable_key,
          // The projection's reasons are the role-weighted ones; the raw row's
          // are view-blind. Prefer the former where it exists.
          reasons: (projection?.reasons.length ? projection.reasons : row.reasons) ?? [],
          roleScore: projection ? projection.score : null,
          rawScore: Number(row.score),
        });
      }
      // A file the role projection ranks but the raw scan missed still belongs
      // on the map — it is exactly the role-relevant pick this fix is for.
      for (const [stableKey, projection] of projectedFiles) {
        if (candidates.has(stableKey)) continue;
        candidates.set(stableKey, {
          stableKey, reasons: projection.reasons, roleScore: projection.score, rawScore: 0,
        });
      }
      const fileTargets = [...candidates.values()]
        .sort((a, b) => {
          // Role-ranked files first, ordered by the role's own score; the rest
          // follow by raw criticality. Ties break on path for run-to-run
          // stability (the section cache keys on these facts).
          if ((a.roleScore === null) !== (b.roleScore === null)) return a.roleScore === null ? 1 : -1;
          if (a.roleScore !== null && b.roleScore !== null && a.roleScore !== b.roleScore) {
            return b.roleScore - a.roleScore;
          }
          if (a.rawScore !== b.rawScore) return b.rawScore - a.rawScore;
          return a.stableKey.localeCompare(b.stableKey);
        })
        .slice(0, 36)
        .map((t) => ({ stableKey: t.stableKey, reasons: t.reasons }));
      const keys = fileTargets.map((t) => t.stableKey);
      const memberships = keys.length > 0 ? (await query(
        `SELECT n.stable_key, c.label
         FROM architecture_cluster_members m
         JOIN architecture_clusters c ON c.id = m.cluster_id
         JOIN graph_nodes n ON n.id = m.node_id
         WHERE c.snapshot_id = $1 AND n.stable_key = ANY($2)`,
        [deps.snapshotId, keys],
      )).rows as Array<{ stable_key: string; label: string }> : [];
      const clusterOf = new Map(memberships.map((m) => [m.stable_key, m.label]));
      const nodeFacts = keys.length > 0 ? (await query(
        `SELECT stable_key, (metadata->>'dependentCount')::int AS dependents,
                (metadata->>'importCount')::int AS imports, metadata->>'lineCount' AS line_count
         FROM graph_nodes WHERE snapshot_id = $1 AND stable_key = ANY($2)`,
        [deps.snapshotId, keys],
      )).rows as Array<{ stable_key: string; dependents: number | null; imports: number | null; line_count: string | null }> : [];
      const factsOf = new Map(nodeFacts.map((n) => [n.stable_key, n]));
      const groups: Record<string, Array<Record<string, unknown>>> = {};
      for (const t of fileTargets) {
        const group = clusterOf.get(t.stableKey) ?? 'Other';
        (groups[group] ??= []).push({
          path: t.stableKey,
          reasons: t.reasons.slice(0, 3),
          dependents: factsOf.get(t.stableKey)?.dependents ?? null,
          imports: factsOf.get(t.stableKey)?.imports ?? null,
        });
      }
      return {
        fileGroups: groups,
        keySymbols: (critical25(deps.projections).get('symbol') ?? []).slice(0, 30).map(projectionRow),
      };
    },
    /**
     * Depth check, not a breadth check.
     *
     * The old body was `missingItems(content, paths, 'mapped files')`, which
     * measured how many PATH STRINGS appeared. That is the metric the model was
     * optimising when it wrote 30 words per file across 36 files with no
     * signatures — and because `missingItems` returns `[]` for an empty `wanted`
     * list, it also passed vacuously on `FloowForge/code_map`, letting a
     * 36-word section of pure preamble ship at `confidence: high`.
     */
    completenessCheck: (content, det) => {
      const groups = det.fileGroups as Record<string, Array<{ path: string }>>;
      const paths = Object.values(groups ?? {}).flat().map((f) => f.path);
      if (paths.length === 0) return [];
      const issues: string[] = [];
      const wanted = Math.min(8, paths.length);
      const covered = paths.filter((p) => content.includes(p)).length;
      if (covered < wanted) {
        issues.push(
          `INCOMPLETE: only ${covered} of the ${paths.length} candidate files are mapped — map at least ${wanted}, each with its key functions.`,
        );
      }
      // One `name(...)` in backticks per mapped file is the floor: the
      // micro-format is the whole value of this section, and 4 of 7 live
      // sections shipped without a single signature.
      const signatures = (content.match(/`[A-Za-z_$][\w.$]*\([^`\n]*\)`/g) ?? []).length;
      if (covered > 0 && signatures < covered) {
        issues.push(
          `INCOMPLETE: ${signatures} function signatures across ${covered} mapped files — every mapped file needs at least one \`name(signature)\` line in the micro-format, or drop that file from the map.`,
        );
      }
      return issues;
    },
    outputBudget: { small: 7_000, mid: 12_000, large: 17_000 },
  },

  capabilities: {
    chapter: 'understand',
    mode: 'explanation',
    views: ['domain'],
    retrievalTask: () => 'The product capabilities: what the system does for its users and where each capability lives in the code.',
    instructions: withContracts([
      'Every capability below was DERIVED from evidence and then named: it exists because a group of traced flows binds to an entry point, a flow that goes somewhere, and the schema table or external service it touches. Write about the ones you are given and invent none.',
      'For each: what a user of the system gets from it, which flows deliver it (by title), which tables or services it touches, and the seam to change when EXTENDING it — take that from `seams`, which are the entry points and effect sites it binds to, never the file the capability happens to be named after.',
      // Measured on OnboardBuddy: "the evidence does not specify the exact
      // tables, services, or extension seams for this capability" appeared in
      // 7 of 8 entries, paraphrased just enough to defeat string dedupe —
      // ~105 of 561 words (19%) — AND was charged to the reader a second time
      // as 13 known-gap chips below the same prose.
      'OMIT ANY OF THOSE FOUR LINES YOU CANNOT FILL FROM THE EVIDENCE. Write a sentence of the shape "the evidence does not specify …" AT MOST ONCE in the whole section, as a single closing line naming every capability it applies to. Repeating it per capability is one finding charged to the reader N times, and the Known Gaps panel already records it.',
      // Measured: OnboardBuddy shipped "Development Environment and Testing"
      // and "Configuration and Settings"; UBCPSS shipped "Navigation Bar" and
      // "Footer" as product capabilities. UX_AUDIT_FINDINGS §17.3 found the
      // same class on CourseInsights ("40% of the answer is about the build").
      'A capability is something a USER of the product would ask for by name. NEVER emit one that is page chrome (navigation bar, footer, layout, theme, styling), a repo toolchain concern (development environment, testing, CI, build, linting, deployment) or a settings screen: if it would not appear on the product\'s pricing page or in a support ticket, leave it out and say in one closing line that it was excluded as infrastructure. Four sharp capabilities beat eight padded ones.',
      'If `capabilities` is empty, that is the finding, not a gap in your writing: say plainly that no capability could be derived from this snapshot, quote `bindingRule` and the counts in `notBound`, and stop. Never describe the repo\'s directories, layers or utilities as capabilities to fill the space.',
      'This is business context anchored in code, not code documentation. If a capability has no user_value in the evidence, omit that line entirely — never print "N/A".',
    ]),
    deterministic: async (deps) => {
      // Members arrive as human-readable titles, not stable keys. The old
      // query passed `cm.stable_key` and relied on the prompt forbidding
      // internal keys in the output — the monorepo package shipped 31 `wf:…`
      // / `cluster:…` occurrences anyway. Facts that contain no internal key
      // cannot leak one.
      const rows = (await query(
        `SELECT c.name, c.description, c.confidence,
                c.metadata->>'user_value' AS user_value,
                COALESCE(c.metadata->>'tier', 'supporting') AS tier,
                c.metadata->'derivation' AS derivation,
                COALESCE(c.metadata->'binding'->'schemas', '[]'::jsonb) AS tables,
                COALESCE(c.metadata->'binding'->'services', '[]'::jsonb) AS services,
                ARRAY(SELECT w.title FROM capability_members cm JOIN workflows w ON w.id = cm.member_id
                       WHERE cm.capability_id = c.id AND cm.member_type = 'workflow'
                       ORDER BY w.title LIMIT 8) AS flows,
                ARRAY(SELECT ac.label FROM capability_members cm JOIN architecture_clusters ac ON ac.id = cm.member_id
                       WHERE cm.capability_id = c.id AND cm.member_type = 'cluster'
                       ORDER BY ac.label LIMIT 6) AS modules,
                ARRAY(SELECT DISTINCT gn.file_path FROM capability_members cm JOIN graph_nodes gn ON gn.id = cm.member_id
                       WHERE cm.capability_id = c.id AND cm.member_type = 'node' AND gn.file_path IS NOT NULL
                       ORDER BY gn.file_path LIMIT 6) AS seams
         FROM capabilities c
         WHERE c.snapshot_id = $1
         ORDER BY CASE COALESCE(c.metadata->>'tier', 'supporting') WHEN 'core' THEN 0 ELSE 1 END,
                  COALESCE((c.metadata->>'score')::numeric, 0) DESC, c.name`,
        [deps.snapshotId],
      )).rows as Array<Record<string, unknown>>;
      const counts = (await query(
        `SELECT (SELECT COUNT(*)::int FROM workflows WHERE snapshot_id = $1) AS traced_flows,
                (SELECT COUNT(DISTINCT cm.member_id)::int FROM capability_members cm
                  WHERE cm.member_type = 'workflow'
                    AND cm.capability_id IN (SELECT id FROM capabilities WHERE snapshot_id = $1)) AS bound_flows,
                (SELECT COUNT(*)::int FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema') AS schema_tables`,
        [deps.snapshotId],
      )).rows[0] as Record<string, unknown>;
      // The rule and the counts are a finding only when there were flows to
      // apply them to. With nothing traced they are boilerplate, and shipping
      // boilerplate as facts would grade an evidence-free section `medium`.
      const tracedFlows = Number(counts?.traced_flows ?? 0);
      return {
        capabilities: rows,
        ...(rows.length > 0 || tracedFlows > 0
          ? {
            bindingRule:
              'A capability is emitted only when a group of traced flows binds to all three: an entry point, a flow that reaches past its trigger, and a schema table or named external service it touches.',
            notBound: counts,
          }
          : {}),
        journeys: (await query(
          `SELECT title, purpose FROM workflows WHERE snapshot_id = $1 AND trigger_type IN ('journey', 'dev_command') LIMIT 10`,
          [deps.snapshotId],
        )).rows,
      };
    },
    completenessCheck: (content, det) => {
      const caps = (det.capabilities as Array<{ name?: string }> ?? []).map((c) => c.name ?? '');
      return missingItems(content, caps, 'capabilities', 1);
    },
    outputBudget: { small: 4_000, mid: 7_000, large: 9_000 },
  },

  // ═══ DO ═══════════════════════════════════════════════════════════════════

  setup_run: {
    chapter: 'do',
    mode: 'tutorial',
    views: ['purpose'],
    retrievalTask: () => 'How to set up and run this project locally: prerequisites, environment, run commands, and how to verify each step.',
    instructions: withContracts([
      'A guaranteed-success first run. Steps come ONLY from evidence: compose files (the topology facts and devJourneys are parsed from them), package scripts, README receipts, and env templates. If evidence contains no run path, say exactly that and stop — never invent a command.',
      'Structure: "## Prerequisites" → "## Configure" → "## Run" → "## Run the tests" → "## If it breaks". OMIT ANY HEADING YOU CANNOT FILL WITH A CONCRETE INSTRUCTION. A heading followed by "the evidence does not specify …" is worse than no heading at all — the Known Gaps panel already records what was missing, and five apologies under five headings is the single most common way this section wastes the reader\'s time.',
      // Measured on our own golden repo: OnboardBuddy/setup_run (149 words)
      // shipped "No explicit configuration files need to be created" for a repo
      // that will not start without backend/.env, frontend/.env and a
      // github-app.pem — every one of those names present in the same package's
      // guardrails_ops env table. AUDIT_LEDGER A6; ONBOARDING_UX_GOALS calls a
      // wrong setup_run a hard fail.
      '"## Configure": if `envFiles` is non-empty you MUST tell the reader to copy each template to its real filename, and you MUST NAME the variables that have no default, from `envFiles[].varNames` — plus any key or certificate file a compose service mounts. A repository that ships an env template ALWAYS needs configuration: never write "no configuration is needed" or "no explicit configuration files need to be created".',
      // Measured: not one setup_run in the corpus named the URL that proves the
      // app is up, though the topology facts carry the ports.
      '"## Run": each step is ONE command in a code block plus a "You should see:" line naming the EXACT URL and port from the topology facts (e.g. "the app at http://localhost:5173 and the API at http://localhost:3000"). A verify line that paraphrases the command ("you should see the services starting") proves nothing — name the port, the URL, or the log string a receipt shows.',
      // Measured on MasterPokedex: a "Port in use" failure box that names no
      // port, a "Missing configuration file" box that names no file.
      '"## If it breaks": write a failure box ONLY when you can name the specific variable, port or file involved. A box that says "a port may already be in use" without naming the port, or "ensure all necessary environment variables are set" without naming them, is filler — drop it. Zero honest boxes beats three generic ones.',
      'Every promised result must be checkable. One unbranching path — no alternatives, no "you could also".',
    ]),
    deterministic: async (deps) => {
      const facts = await loadConfigFacts(deps.snapshotId);
      return {
        topology: facts.topology,
        testTopology: facts.testTopology,
        envFiles: facts.envFiles.map((f) => ({ path: f.path, varNames: f.vars.map((v) => v.name) })),
        packageScripts: facts.packageScripts,
        devJourneys: (await query(
          `SELECT w.title, w.purpose,
                  json_agg(json_build_object('order', ws.step_order, 'description', ws.deterministic_description) ORDER BY ws.step_order) AS steps
           FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id
           WHERE w.snapshot_id = $1 AND w.trigger_type = 'dev_command' GROUP BY w.id`,
          [deps.snapshotId],
        )).rows,
        runSurface: (await query(
          `SELECT file_path, category FROM repository_files
           WHERE snapshot_id = $1 AND (
             file_path ILIKE '%docker-compose%' OR file_path ILIKE '%makefile%'
             OR file_path = 'package.json' OR file_path ILIKE '%/package.json'
             OR file_path ILIKE 'readme%' OR file_path ILIKE '%/readme%'
           )
           ORDER BY length(file_path) LIMIT 12`,
          [deps.snapshotId],
        )).rows,
      };
    },
    /**
     * The day-one section had no completeness check at all, which is how a
     * 14-word `setup_run` (CourseInsights) and a "no configuration is needed"
     * `setup_run` on a three-env-file repo (OnboardBuddy) both shipped.
     *
     * Only two things are asserted, and only when the facts contain them, so
     * this can never demand something the evidence cannot support: name the env
     * templates that exist, and name a port the reader can open.
     */
    completenessCheck: (content, det) => {
      const issues: string[] = [];
      const envFiles = (det.envFiles as Array<{ path: string }> | undefined) ?? [];
      if (envFiles.length > 0 && !envFiles.some((f) => f.path && content.includes(f.path))) {
        issues.push(
          `INCOMPLETE: this repository ships ${envFiles.length} environment template(s) (${envFiles.map((f) => f.path).join(', ')}) and the Configure step names none of them — a repo with an env template always needs configuration.`,
        );
      }
      // Ports come from the compose topology, so a repo without compose is
      // simply not asked for one.
      const ports = [...new Set(JSON.stringify(det.topology ?? null).match(/\b\d{4,5}\b/g) ?? [])];
      if (ports.length > 0 && !ports.some((p) => content.includes(p))) {
        issues.push(
          `INCOMPLETE: no verify line names a port — the topology exposes ${ports.join(', ')}; the reader must be told the URL that proves the run worked.`,
        );
      }
      return issues;
    },
    outputBudget: { small: 4_000, mid: 6_000, large: 8_000 },
  },

  first_change: {
    chapter: 'do',
    mode: 'tutorial',
    views: ['purpose', 'dependency'],
    retrievalTask: (role) => `A safe, real first change a new ${roleDescriptor(role)} developer could make: where, what pattern to follow, and how to verify it.`,
    instructions: withContracts([
      // Measured: OnboardBuddy's first change was "add a tab" by editing
      // `frontend/e2e/fixtures.ts` (a Playwright fixture); UBCPSS's was "add a
      // testimonial to the TESTIMONIALS array" (marketing copy). `safeCandidates`
      // is projections.slice(3, 25) — deliberately mid-rank — with nothing
      // excluding fixtures or static content, so the section is structurally
      // biased toward code that teaches the reader nothing.
      'Design ONE starter exercise — a small, real, safe change in this repo — from the evidence: prefer an area that (a) appears in safeCandidates (moderate rank, low dependents), (b) has a test in testGuards, (c) follows an existing visible pattern (an exemplar snippet in the receipts), and (d) SITS ON A REAL PRODUCT PATH — the file must belong to a journey or capability in the evidence. NEVER pick a test file, an e2e fixture, a mock or stub, a snapshot, or a static content array (testimonials, marketing copy, nav labels): editing those teaches nothing about how the system works, which is the whole point of the exercise. If nothing satisfies (d), choose the lowest-risk file that does sit on a product path and say in one sentence why it carries slightly more risk.',
      'Structure: "## The exercise" (one paragraph: what to add/change and why it is safe) → "## Files you will touch" (the exact files, each with one line on its role) → "## Steps" (numbered, imperative, one action each; point at the exemplar pattern to copy from with its receipt; state the expected diff shape — which file gains roughly how many lines where) → "## Verify" (the EXACT test file/command from the evidence; if testGuards has no test for the area, say plainly that tests are not visible and give the manual check instead) → "## What this teaches" (ONE sentence naming the specific journey or capability the edited file belongs to, and which section of this package walks it).',
      // Measured on UBCPSS: "You have now modified a component's data source
      // and observed its effect on the UI. This exercise demonstrates how to
      // integrate new content into existing sections… You also learned how to
      // identify relevant files for a given feature." Three sentences of
      // learning-objective boilerplate describing skills the exercise did not
      // teach.
      'NEVER describe a generic skill in "What this teaches" ("you learned to identify relevant files", "you learned to follow existing patterns", "you have now modified a component\'s data source", "this demonstrates how to follow established patterns"). Name the journey, or omit the heading.',
      'The reader must succeed: no forks, no optional paths, no invented commands.',
    ]),
    deterministic: async (deps) => {
      const guards = await testGuardsFor(deps.snapshotId);
      const midRank = deps.projections
        .filter((p) => p.targetType === 'file')
        .slice(3, 25)
        .map(projectionRow);
      return {
        safeCandidates: midRank,
        testGuards: guards,
        churnedFiles: (await query(
          `SELECT stable_key, metadata->'churn'->>'commitCount90d' AS commits_90d
           FROM repository_files WHERE snapshot_id = $1
             AND (metadata->'churn'->>'commitCount90d')::int > 0
           ORDER BY (metadata->'churn'->>'commitCount90d')::int DESC LIMIT 12`,
          [deps.snapshotId],
        )).rows,
      };
    },
    outputBudget: { small: 3_500, mid: 5_000, large: 6_500 },
  },

  common_tasks: {
    chapter: 'do',
    mode: 'howto',
    views: ['purpose', 'dependency'],
    retrievalTask: () => 'The recurring engineering tasks in this repo: how to add a route, a table, a job, a page, a test — following existing patterns.',
    instructions: withContracts([
      'How-to recipes for THIS repo\'s recurring tasks. The taskShapes data lists the task patterns detected in this repo with exemplar files — write ONE "## How to <goal>" recipe per shape (skip shapes with no exemplars). Assume competence: no basics, no theory, no motivation paragraphs.',
      // Measured on OnboardBuddy: five recipes, five verifications, every one a
      // tautology — "Send a request to the newly added API endpoint and verify
      // the response", "Run the migration scripts and confirm the table
      // structure", "Run the relevant test command and ensure all tests pass".
      // The real command (`docker compose -f docker-compose.test.yml run --rm
      // test`) was sitting in the same section's last recipe.
      'Per recipe: goal-first title; then numbered steps in conditional-imperative voice ("If the route needs auth, wrap it in …"); each step names the REAL file to touch and points at the exemplar to copy from. End with a one-line verification that is a RUNNABLE COMMAND copied from `taskShapes[].testCommands` or the package scripts. If the evidence holds no command, write "no verification command is defined in this repo" — NEVER "verify the response", "confirm it worked", "ensure all tests pass" or any sentence that restates the step as its own check.',
      // Measured: step 1 of OnboardBuddy's "add an API route" carried 23
      // receipt chips across 6 bullets, up to 6 on a single line, every one
      // pointing at the file the bullet already named. In the reader those
      // render as a run of chips that reads as punctuation (UX §8.5).
      'Cite the exemplar ONCE, with ONE receipt. Never put more than two receipts on a bullet, and never cite a receipt for a file whose path you already printed in that same line — the path IS the citation. Surplus ids belong in usedReceiptIds, not in the prose.',
      'Never write a step the reader cannot act on: "consider using existing modules", "this typically involves updating X", "implement the UI logic" are not steps. Name the file, the symbol and the edit, or drop the step.',
      'Steps are for someone who knows how to code — they need the repo\'s way, not a tutorial. Link to Consult tables for full option lists instead of enumerating them.',
    ]),
    deterministic: async (deps) => {
      // Task shapes detected from repo structure — each with real exemplars.
      const [routes, migrations, consumers, pages, tests] = await Promise.all([
        query(
          `SELECT n.file_path, count(*)::int AS routes FROM entrypoints e
           JOIN graph_nodes n ON n.id = e.node_id
           WHERE e.snapshot_id = $1 AND e.trigger_type = 'http_route'
           GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
          [deps.snapshotId],
        ),
        query(
          `SELECT file_path FROM repository_files WHERE snapshot_id = $1 AND category IN ('migration', 'schema') LIMIT 4`,
          [deps.snapshotId],
        ),
        query(
          `SELECT n.file_path FROM entrypoints e JOIN graph_nodes n ON n.id = e.node_id
           WHERE e.snapshot_id = $1 AND e.trigger_type = 'worker_job' LIMIT 4`,
          [deps.snapshotId],
        ),
        query(
          `SELECT n.file_path FROM entrypoints e JOIN graph_nodes n ON n.id = e.node_id
           WHERE e.snapshot_id = $1 AND e.trigger_type = 'ui_route' LIMIT 5`,
          [deps.snapshotId],
        ),
        query(
          `SELECT file_path FROM repository_files WHERE snapshot_id = $1 AND category = 'test' ORDER BY file_path LIMIT 6`,
          [deps.snapshotId],
        ),
      ]);
      const facts = await loadConfigFacts(deps.snapshotId);
      const taskShapes: Array<Record<string, unknown>> = [];
      if (routes.rows.length > 0) taskShapes.push({ goal: 'add an API route', exemplars: routes.rows });
      if (migrations.rows.length > 0) taskShapes.push({ goal: 'add or change a database table', exemplars: migrations.rows });
      if (consumers.rows.length > 0) taskShapes.push({ goal: 'add a background job', exemplars: consumers.rows });
      if (pages.rows.length > 0) taskShapes.push({ goal: 'add a UI page', exemplars: pages.rows });
      if (tests.rows.length > 0) {
        taskShapes.push({
          goal: 'write and run a test',
          exemplars: tests.rows,
          testCommands: facts.packageScripts.flatMap((p) =>
            Object.entries(p.scripts).filter(([k]) => /test/.test(k)).map(([k, v]) => `${k}: ${v}`)).slice(0, 4),
        });
      }
      return { taskShapes };
    },
    completenessCheck: (content, det) => {
      const goals = (det.taskShapes as Array<{ goal?: string }> ?? []).map((t) => t.goal ?? '');
      return missingItems(content, goals, 'task recipes', 1);
    },
    outputBudget: { small: 5_000, mid: 8_000, large: 10_000 },
  },

  // ═══ CONSULT ══════════════════════════════════════════════════════════════

  routes_jobs: {
    chapter: 'consult',
    mode: 'reference',
    views: ['purpose'],
    retrievalTask: () => 'Every route, queue, job type, and webhook — grouped for lookup.',
    instructions: withContracts([
      'Reference for lookup, not reading. Write: (1) a 2-3 sentence intro stating what the tables cover and how they are grouped, then the marker [[backbone]] on its own line (the deterministic route/queue/webhook tables are inserted there — you never write route tables yourself), then (2) "### Notes per group" — ONE line per route group, using the EXACT group headings from the inserted tables, saying something the table does not already show: which journey the group serves, what it guards, or the one route in the group a newcomer will touch first. A line that rewords the group name ("Authentication: routes for user authentication", "Project Management: routes for managing projects") is FORBIDDEN — omit that group instead. If no group earns a line, omit the "### Notes per group" heading entirely.',
      'Route paths in your prose must be FULL mounted paths copied from the evidence. Never instruct, never opine — describe.',
    ]),
    deterministic: async (deps) => ({
      routeCount: Number(((await query(
        `SELECT count(*)::int AS n FROM entrypoints WHERE snapshot_id = $1 AND trigger_type = 'http_route' AND route_path IS NOT NULL`,
        [deps.snapshotId],
      )).rows[0] as { n: number } | undefined)?.n ?? 0),
      queues: (await query(
        `SELECT route_path AS queue_name FROM entrypoints WHERE snapshot_id = $1 AND trigger_type = 'worker_job'`,
        [deps.snapshotId],
      )).rows,
      groupsPreview: (await query(
        `SELECT e.route_path, e.method, w.title AS workflow FROM entrypoints e
         LEFT JOIN workflows w ON w.entrypoint_id = e.id
         WHERE e.snapshot_id = $1 AND e.trigger_type = 'http_route' AND e.route_path IS NOT NULL
         ORDER BY e.route_path LIMIT 60`,
        [deps.snapshotId],
      )).rows,
    }),
    backbone: (deps) => buildRoutesJobsBackbone(deps.snapshotId),
    outputBudget: { small: 2_500, mid: 3_500, large: 4_500 },
  },

  data_model: {
    chapter: 'consult',
    mode: 'reference',
    views: ['operations', 'dependency'],
    retrievalTask: () => 'The data model: what each table group stores and which invariants matter.',
    instructions: withContracts([
      'Reference for lookup. Write: (1) a 2-3 sentence intro naming the schema source file(s) and the total table count VERBATIM from schemaTableCount (never count yourself), then the marker [[backbone]] on its own line (the deterministic table inventory is inserted there — you never write the table list yourself), then (2) "### Table groups" — group the tables into 3-6 domains by name/relationships and give ONE factual line per group on what it stores and the key relationship, grounded in the refs/access evidence.',
      'The anchor ER diagram is drawn from parsed foreign keys — refer to it; never contradict it. Do NOT add a note that column-level detail is not included: the reader can see the table has no column list, and the Known Gaps panel records it.',
      // Measured: "Semantic and Embedding Data: Stores and manages semantic
      // records, capabilities, and embeddings." — the group name reworded plus
      // a vague purpose, the same failure as routes_jobs' group notes.
      'Each group line must state the INVARIANT or the lifecycle that binds those tables — what is created first, what cascades on delete, what has to stay consistent. Listing the group\'s tables again in prose is forbidden; the table above already does that.',
    ]),
    deterministic: async (deps) => {
      const schemaTableCount = Number(((await query(
        `SELECT count(*)::int AS n FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema'`,
        [deps.snapshotId],
      )).rows[0] as { n: number } | undefined)?.n ?? 0);
      return {
        schemaTableCount,
        tables: (await query(
          `SELECT name, metadata->'references' AS refs FROM graph_nodes
           WHERE snapshot_id = $1 AND type = 'schema' ORDER BY line_start NULLS LAST LIMIT 60`,
          [deps.snapshotId],
        )).rows,
      };
    },
    backbone: (deps) => buildDataModelBackbone(deps.snapshotId),
    diagrams: async (deps) => {
      const tables = (await query(
        `SELECT name, COALESCE(metadata->'references', '[]'::jsonb) AS refs
         FROM graph_nodes WHERE snapshot_id = $1 AND type = 'schema'`,
        [deps.snapshotId],
      )).rows as Array<{ name: string; refs: string[] }>;
      const mermaid = erDiagram(tables.map((t) => ({ name: t.name, references: t.refs ?? [] })));
      return mermaid ? [{ kind: 'er', mermaid }] : [];
    },
    outputBudget: { small: 2_500, mid: 3_500, large: 4_500 },
  },

  guardrails_ops: {
    chapter: 'consult',
    mode: 'reference',
    views: ['operations'],
    retrievalTask: () => 'Operational guardrails: budgets, kill switches, privacy modes, secret handling, env configuration — what each protects and where it is enforced.',
    instructions: withContracts([
      'Reference for lookup. Write: (1) a 2-3 sentence intro on what the tables cover, then the marker [[backbone]] on its own line (the deterministic env-var and guardrail-code tables are inserted there), then (2) "### What each guardrail protects" — for each guardrail SYMBOL in the backbone evidence, one factual line: what it protects and when it fires, ONLY where the record/receipt evidence shows it; omit symbols you cannot ground. Where the evidence shows an operational risk with no guardrail, state it as a gap.',
      // Measured on OnboardBuddy: 13 of 26 backend rows and 3 of 3 frontend
      // rows rendered an empty "—" purpose cell, and `ACTIVITY_LIMIT`
      // (DashboardPage.tsx) / `DEPTH_BUDGET_DEFAULTS` (ProjectSettingsPage.tsx)
      // were listed as guardrails though they are display constants.
      'Env var VALUES are never in the evidence and never in the output — names and documented purposes only. Where the template carries no comment for a variable, do not leave an empty cell: gather those names into ONE line below the table ("No documented purpose in the template: NODE_ENV, PORT, …"). A guardrail is an ENFORCEMENT point — something that refuses, throws, redirects, caps or strips. A constant that is only read for display is not one: name it in the closing line as "matched by name but not an enforcement point" rather than giving it a row.',
    ]),
    deterministic: async (deps) => {
      const facts = await loadConfigFacts(deps.snapshotId);
      return {
        envFiles: facts.envFiles.map((f) => ({ path: f.path, varNames: f.vars.map((v) => v.name) })),
        externalIntegrations: (await query(
          `SELECT DISTINCT s.target FROM side_effects s
           WHERE s.snapshot_id = $1 AND s.type IN ('external_integration', 'auth_check') AND s.target IS NOT NULL LIMIT 15`,
          [deps.snapshotId],
        )).rows,
        ci: facts.ci,
      };
    },
    backbone: async (deps) => buildGuardrailsBackbone(deps.snapshotId, await loadConfigFacts(deps.snapshotId)),
    outputBudget: { small: 2_500, mid: 3_500, large: 4_500 },
  },
};

/** Shared loader so every section reuses one projection pass. */
export async function buildSectionDeps(snapshotId: string, projectId: string, role: DeveloperRole): Promise<SectionDeps> {
  const snap = (await query(
    `SELECT symbol_count FROM analysis_snapshots WHERE id = $1`,
    [snapshotId],
  )).rows[0] as { symbol_count: number | null } | undefined;
  return {
    snapshotId, projectId, role,
    projections: await loadRoleProjections(snapshotId, projectId, role),
    sizeClass: sizeClassFor(snap?.symbol_count),
  };
}

/** Depth-contract size class from the snapshot's symbol count. */
export function sizeClassFor(symbolCount: number | null | undefined): keyof OutputBudget {
  const n = symbolCount ?? 0;
  if (n < 800) return 'small';
  if (n < 3_000) return 'mid';
  return 'large';
}

export type { ConfigFacts };
