/**
 * Explanation lint for generated onboarding prose — the sibling of
 * `voiceLint.ts`, and the same integration contract (`issues` feed the
 * generator's stricter retry, `hits` land in `generation_context`).
 *
 * `voiceLint` catches the wrong REGISTER ("crucial", "seamless"). This catches
 * the wrong THING: prose that is well-mannered, well-formatted, and still not
 * an explanation. The reviewer's complaint was "the architecture part does not
 * make sense to me that much" and "capabilities section also does not make
 * sense based on the project I uploaded" — neither is a tone problem.
 *
 * The contract, one check per rule:
 *
 *   1. LEVEL     — a cluster summary explains THAT cluster, not the repo.
 *   2. GROUNDING — every claim carries a receipt. No receipt, no claim.
 *   3. GAPS      — what could not be determined is part of the explanation.
 *   4. NARRATION — do not describe the artifact the reader is already looking
 *                  at. This is the specific failure behind "does not make
 *                  sense": text that narrates the picture instead of
 *                  explaining the system.
 *
 * ── Where the narration patterns come from ──────────────────────────────────
 *
 * Every pattern below was counted in REAL stored output (the Skribbl package,
 * `package_sections` of snapshot 6da73e74 — 12 sections, ~350 prose
 * sentences), not guessed from a thesaurus. The counts that earned each
 * family its place:
 *
 *   "This section details/covers/outlines …"           5   document_self_reference
 *   "This document outlines …" / "This journey …"      3   artifact_self_reference
 *   "After reading you can …"                          6   reader_address
 *   "…, comprising 7 files and 79 symbols."            7   inventory_narration
 *   "in the provided `testGuards`" / "The evidence …"  3   evidence_narration
 *   "`cluster:server/modules`, `cluster:state`"        8   internal_key_leak
 *
 * The last one is worth its own note: `sectionSpecs.ts` explicitly tells the
 * model "internal keys (wf:…, cluster:…) must never appear in the output", and
 * they appeared eight times in the one section the reviewer singled out. A
 * prompt instruction with no mechanical check is a suggestion.
 *
 * ── Why the checks are shaped the way they are ──────────────────────────────
 *
 * A detector with false positives is worse than no detector, because the
 * generator burns a model call rewriting prose that was already right. Three
 * design rules follow, and the tests pin all of them:
 *
 *   • Narration is discriminated by VERB CLASS, not by subject. "This cluster
 *     manages the frontend state" is a statement about the system and passes;
 *     "This journey outlines the CI pipeline" is a statement about the
 *     document and fails. `describes / details / covers / outlines / explains`
 *     are things you do to a write-up; `manages / validates / enqueues` are
 *     things a component does.
 *
 *   • Counts are not banned — `sectionSpecs.ts` asks architecture_deep for
 *     "its real file count". What is banned is a count STANDING IN for the
 *     explanation. So the inventory check deletes the count clause and asks
 *     what is left: "Modules comprises 6 files and 3 symbols." leaves one word
 *     and fails; "The UI owns the canvas and consists of 61 files." leaves a
 *     real claim and passes.
 *
 *   • Grounding is judged per BLOCK, not per sentence. Models cite once at the
 *     end of a paragraph; per-sentence grounding would report two false
 *     positives for every true one on correctly-cited prose.
 *
 * Pure and side-effect free: text plus the evidence it was generated from in,
 * structured findings out. Wiring lives in the caller.
 *
 * ── How to wire it into sectionGenerator.ts (not done here on purpose) ──────
 *
 * It rides the retry loop `voiceLint` already owns, so it is one import and
 * one term per site — no new control flow. Line numbers are as of 2026-07-25;
 * the anchor is `lintVoice`, so `grep -n lintVoice sectionGenerator.ts` finds
 * every site if they drift:
 *
 *   line  24  import { lintExplanation } from './explanationLint.js';
 *
 *   line 233  let explain = lintExplanation(output.contentMarkdown ?? '', explanationEvidence);
 *   line 236  if (… || voice.issues.length > 0 || explain.issues.length > 0 || coverage.length > 0)
 *   line 238  callModel(params, bundle, [...validation.issues, ...voice.issues, ...explain.issues, ...coverage], …)
 *   line 243  explain = lintExplanation(output.contentMarkdown ?? '', explanationEvidence);   // after the stricter retry
 *   line 272  explain = lintExplanation(output.contentMarkdown ?? '', explanationEvidence);   // after the critique rewrite
 *
 * where `explanationEvidence` is built once beside `deterministicContext`:
 *
 *   const explanationEvidence: ExplanationEvidence = {
 *     scope: { kind: 'section' },
 *     mode: spec.mode,
 *     domainNouns: domainNounsFor(deterministicContext),   // schema stems + cluster labels
 *     mustDisclose: unreadLanguagesOf(snapshotCounts),     // 'Python' when the backend was never parsed
 *   };
 *
 * `explain.hits` belongs in `generation_context` next to `voice.hits`, and
 * `explain.findings` is what a reviewer reads — each one quotes the sentence
 * that earned it.
 */

export type ExplanationRule = 'level' | 'grounding' | 'gaps' | 'narration' | 'repetition';

export interface ExplanationFinding {
  rule: ExplanationRule;
  /** Machine label, stable across releases — safe to count in a report. */
  code: string;
  /**
   * The offending sentence, verbatim (receipt markers stripped for
   * readability) so a human can overrule the machine. Absence findings —
   * "no gap is disclosed anywhere" — carry the text's opening sentence as a
   * locator instead, since there is no offending sentence to quote.
   */
  sentence: string;
  /** What is wrong and what to do instead. This text reaches the model on retry. */
  detail: string;
  severity: 'error' | 'warn';
}

export type ExplanationScopeKind = 'repo' | 'section' | 'cluster' | 'capability' | 'workflow';

export interface ExplanationScope {
  kind: ExplanationScopeKind;
  /** The thing this text is supposed to explain: 'Server · Modules', … */
  subject?: string;
  /** Peer names at the same level — the other clusters/capabilities. */
  siblings?: string[];
}

export interface ExplanationEvidence {
  scope?: ExplanationScope;
  /**
   * Nouns the deterministic facts say this repo is about ('room', 'canvas',
   * 'flow', 'snapshot'). Prose that names none of them is generic — the
   * "does not make sense based on the project I uploaded" signature.
   */
  domainNouns?: string[];
  /**
   * Coverage facts the text MUST admit ('Python', 'FastAPI', 'not parsed').
   * A repo whose backend no parser reads has to say so; silence reads as
   * "this repo does not have a backend".
   */
  mustDisclose?: string[];
  /**
   * Diátaxis mode. `reference` sections carry deterministic backbones spliced
   * in from SQL, so their uncited lines are the contract, not a failure — the
   * same carve-out `citationValidator.ts` makes — and their prompt explicitly
   * asks for a table intro, so table-narration drops to a warning there.
   */
  mode?: 'explanation' | 'tutorial' | 'howto' | 'reference';
  /**
   * Require a gap disclosure even in short text. Off by default: a two-line
   * blurb that admits nothing is not yet a problem.
   */
  requireGapDisclosure?: boolean;
}

export interface ExplanationLintResult {
  /** Everything found, error and warn alike. */
  findings: ExplanationFinding[];
  /**
   * Retry-prompt strings, one per rule that produced an ERROR. Same contract
   * as `VoiceLintResult.issues`: non-empty means the generator should retry.
   * Warn-severity findings stay out so a marginal call never costs a model
   * call; they remain in `findings` for the report.
   */
  issues: string[];
  /** Distinct finding codes, for `generation_context`. */
  hits: string[];
  /** Coarse per-text measurements the golden harness scores repos on. */
  stats: {
    words: number;
    claimBlocks: number;
    citedBlocks: number;
    narrationHits: number;
    /** Distinct sentence templates repeated with only identifiers changed. */
    repetitionHits: number;
    disclosesGaps: boolean;
    /** null when no subject was supplied to judge against. */
    namesSubject: boolean | null;
    domainNounsHit: string[];
  };
}

// ── text preparation ────────────────────────────────────────────────────────

const RECEIPT_MARKER = /\[\[receipt:[^\]]*\]\]/g;
const UNVERIFIED_MARKER = /\[\[\/?unverified\]\]/g;
const ALIAS_CITATION = /\(\s*(?:[rR]eceipts?\s*:?\s*)?\[?[rR]\d+(?:\s*(?:,|;|\/|&|and)\s*[rR]\d+)*\]?\s*\)|\[[rR]\d+\]/g;
/** `server/index.js:22` — a file+line locator IS a receipt a reader can follow. */
const FILE_LOCATOR = /[\w@./-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|sql|ya?ml|json|toml)(?::\d+)/;

/** Fenced code is exempt: identifiers may legitimately contain anything. */
function stripFences(markdown: string): string {
  let fenced = false;
  return markdown
    .split('\n')
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return false;
      }
      return !fenced;
    })
    .join('\n');
}

/**
 * Sentence-ending punctuation inside inline code (`` `server/index.js` ``,
 * `` `sanitize(v)!` ``) is masked before splitting and restored after, so a
 * finding quotes the sentence exactly as the author wrote it.
 */
const MASK: Array<[string, string]> = [
  ['.', '\u0001'],
  ['?', '\u0002'],
  ['!', '\u0003'],
];
const maskInlineCode = (text: string): string =>
  text.replace(/`[^`\n]*`/g, (span) => MASK.reduce((s, [ch, code]) => s.split(ch).join(code), span));
const unmask = (text: string): string => MASK.reduce((s, [ch, code]) => s.split(code).join(ch), text);

const ABBREVIATION = /(?:\b(?:e\.g|i\.e|etc|vs|cf|approx|Fig|No|Dr|Mr|Ms|St|Inc|Ltd|Jr|Sr)|\s[A-Za-z])\.$/;

/**
 * Sentence split that survives file paths, version numbers and `e.g.`. Splits
 * on terminal punctuation + whitespace, then re-joins splits that landed on a
 * known abbreviation or a single-letter initial.
 */
export function splitSentences(text: string): string[] {
  const masked = maskInlineCode(text);
  const out: string[] = [];
  let buffer = '';
  for (const part of masked.split(/(?<=[.!?])\s+/)) {
    buffer = buffer ? `${buffer} ${part}` : part;
    if (ABBREVIATION.test(buffer.trimEnd())) continue;
    out.push(unmask(buffer).trim());
    buffer = '';
  }
  if (buffer.trim()) out.push(unmask(buffer).trim());
  return out.filter(Boolean);
}

/** Markdown scaffolding that is not prose and must never be linted as a claim. */
function isStructuralLine(line: string): boolean {
  const t = line.trim();
  if (t === '') return true;
  if (/^#{1,6}\s/.test(t)) return true; // heading
  if (/^\|/.test(t)) return true; // table row
  if (/^[-*_\s]{3,}$/.test(t)) return true; // horizontal rule
  if (/^\[\[backbone\]\]$/.test(t)) return true;
  return false;
}

interface Block {
  /** Prose text with receipt / unverified markers removed. */
  text: string;
  /** True when the block carried a receipt marker, `rN` alias, or file:line locator. */
  cited: boolean;
  /** True when the block is the mechanical unread-stack disclosure (see below). */
  disclosure: boolean;
  sentences: string[];
}

/**
 * The mechanical unread-stack disclosure, in the two forms the pipeline emits.
 *
 * `sectionSpecs.ts` asks for a `## Not covered here` subsection whenever
 * `snapshot.unreadStacks.mustDisclose` is true, and `repairExplanation` in
 * `sectionGenerator.ts` appends `> **Not covered here.** …` when the model
 * omitted it. Both are rendered from `analysis_snapshots.language_inventory` —
 * a file count per unparsed language — not from anything the model asserted.
 *
 * They must not be counted as UNCITED CLAIMS, for the same reason
 * `isClaimSentence` already drops gap-disclosure sentences: the grounding rule
 * would otherwise fine a section for admitting what was never read, which is
 * precisely what the gaps rule pays it to do. Recognised by the emitted marker
 * and heading rather than by prose shape, so a model paragraph that merely
 * talks about coverage is still held to a receipt.
 */
const DISCLOSURE_HEADING = /^not\s+covered\s+here\b/i;
const DISCLOSURE_MARKER = /^>?\s*\*\*not\s+covered\s+here[.:]?\*\*/i;

/**
 * Paragraph / list-item blocks. Grounding is judged here rather than per
 * sentence: a receipt at the end of a paragraph grounds the paragraph, which
 * is how the model actually cites.
 */
function toBlocks(markdown: string): Block[] {
  const lines = stripFences(markdown).split('\n');
  const blocks: Block[] = [];
  let current: string[] = [];
  /** Nearest preceding heading — carried only to recognise the disclosure block. */
  let heading = '';

  const flush = () => {
    if (current.length === 0) return;
    const raw = current.join(' ');
    current = [];
    const cited =
      new RegExp(RECEIPT_MARKER.source).test(raw) ||
      new RegExp(ALIAS_CITATION.source).test(raw) ||
      FILE_LOCATOR.test(raw);
    const disclosure = DISCLOSURE_HEADING.test(heading) || DISCLOSURE_MARKER.test(raw.trim());
    const text = raw
      .replace(RECEIPT_MARKER, '')
      .replace(ALIAS_CITATION, '')
      .replace(UNVERIFIED_MARKER, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!text) return;
    blocks.push({ text, cited, disclosure, sentences: splitSentences(text) });
  };

  for (const line of lines) {
    const asHeading = line.trim().match(/^#{1,6}\s+(.*)$/);
    if (asHeading) {
      flush();
      heading = asHeading[1]!.replace(/[`*_#]/g, '').trim();
      continue;
    }
    if (isStructuralLine(line)) {
      flush();
      continue;
    }
    // A list item is its own block: five bullets under one paragraph are five
    // claims, and one receipt on the last bullet does not ground the other four.
    if (/^\s*(?:[-*+]|\d+\.)\s/.test(line)) flush();
    // Same `\s` requirement as the detector above — a looser strip ate the
    // first asterisk of "**Responsibility:**" and quoted a mangled sentence.
    current.push(line.trim().replace(/^(?:[-*+]|\d+\.)\s+/, ''));
  }
  flush();
  return blocks;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'this', 'that', 'these', 'those', 'it', 'its', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'as', 'or', 'but',
  'not', 'no', 'also', 'only', 'just', 'which', 'who', 'has', 'have', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'there', 'here', 'then',
  'than', 'so', 'such', 'both', 'each', 'all', 'any', 'some', 'more', 'most', 'other', 'into', 'about',
  'over', 'under', 'between', 'across', 'within', 'via', 'per', 'up', 'down', 'out', 'off', 'again',
  'further', 'total', 'totalling', 'totaling', 'well', 'plus', 'along', 'while', 'when', 'where',
]);

/** Words that carry meaning: no stopwords, no bare numerals. */
function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

// ── rule 4: narration ───────────────────────────────────────────────────────

/**
 * Verbs you apply to a WRITE-UP. The whole narration/explanation distinction
 * rests on this list: a component `manages`, `validates`, `enqueues`; only a
 * document `outlines`, `covers`, or `walks through`.
 *
 * The trailing lookahead disambiguates "details" the verb from "details" the
 * noun — "This section details the routes" fires, "the module details are
 * below" does not.
 */
const DESCRIBING_VERB =
  String.raw`(?:details?|describes?|covers?|outlines?|explains?|discusses?|presents?|introduces?|summari[sz]es?|` +
  String.raw`walks?\s+(?:you\s+)?through|goes?\s+over|lays?\s+out|(?:gives?|provides?)\s+an?\s+overview|` +
  String.raw`aims?\s+to|will\s+(?:cover|describe|explain|show|discuss))\b` +
  // `\b` first: without it `details?` happily matches the "detail" inside
  // "details", and the lookahead then inspects "s are" instead of " are".
  String.raw`(?!\s+(?:are|is|was|were|can|will|would|should|may|live|lives|appear|remain|below|above)\b)`;

/** Nouns that name the artifact rather than the system. */
const DOC_NOUN = String.raw`(?:section|document|documentation|chapter|guide|write-?up|report|summary|article|readme|tl;?dr)`;
const CONTAINER_NOUN = String.raw`(?:journey|cluster|capability|workflow|module|layer|package|component|subsystem|group)`;

interface NarrationPattern {
  code: string;
  re: RegExp;
  detail: string;
  severity: 'error' | 'warn';
  /** Reference sections are told to introduce their tables — soften there. */
  softInReference?: boolean;
}

const NARRATION_PATTERNS: NarrationPattern[] = [
  // ── the text talking about itself ─────────────────────────────────────────
  {
    code: 'document_self_reference',
    re: new RegExp(String.raw`\b(?:this|the|our)\s+${DOC_NOUN}\s+(?:\w+\s+){0,2}?${DESCRIBING_VERB}`, 'i'),
    detail:
      'the sentence describes the write-up instead of the system. Delete the frame and state the fact directly ' +
      '("This section details the routes" → "Every HTTP route is mounted under /api/v1")',
    severity: 'error',
    softInReference: true,
  },
  {
    code: 'document_self_reference',
    re: /\bin\s+this\s+(?:section|document|chapter|guide|write-?up)\b/i,
    detail: 'the sentence positions itself inside the document. The reader already knows where they are',
    severity: 'error',
    softInReference: true,
  },
  {
    code: 'artifact_self_reference',
    re: new RegExp(String.raw`\b(?:this|the)\s+${CONTAINER_NOUN}\s+(?:\w+\s+){0,2}?${DESCRIBING_VERB}`, 'i'),
    detail:
      'the sentence narrates the container ("this journey outlines…") instead of saying what happens. ' +
      'Name the thing and state what it does',
    severity: 'error',
  },
  // ── addressing the reader about the reading ───────────────────────────────
  {
    code: 'reader_address',
    re: /\bafter\s+reading[,\s]+you\s+(?:can|will|should)\b/i,
    detail: 'a promise about the act of reading, not a fact about the system: cut it',
    severity: 'error',
  },
  {
    code: 'reader_address',
    re: /\bas\s+(?:you|we)\s+(?:can\s+see|will\s+see|might\s+expect|can\s+observe|noted\s+above)\b/i,
    detail: 'points at what the reader is already looking at: state the fact instead',
    severity: 'error',
  },
  {
    code: 'reader_address',
    re: /\blet(?:'s|\s+us)\s+(?:take\s+a\s+look|look\s+at|dive|explore|walk\s+through)\b|\bwe\s+will\s+now\b|\byou\s+will\s+notice\b/i,
    detail: 'tour-guide framing: engineering prose states, it does not escort',
    severity: 'error',
  },
  // ── narrating a visual the reader can see ─────────────────────────────────
  {
    code: 'visual_narration',
    re: /\b(?:the|this)\s+(?:diagram|figure|chart|graph|table|screenshot|image|mermaid\s+\w+)\s+(?:above\s+|below\s+)?(?:shows?|illustrates?|depicts?|displays?|lists?|presents?|visuali[sz]es?|contains?|has)\b/i,
    detail:
      'describes the diagram/table rather than the system it draws. The reader can see it. ' +
      'Explain what the shape MEANS, or cut the sentence',
    severity: 'error',
    softInReference: true,
  },
  {
    code: 'visual_narration',
    re: /\bas\s+(?:shown|illustrated|depicted|seen|visible)\s+(?:above|below|in\s+the\s+(?:diagram|figure|chart|table|graph|image|screenshot))\b/i,
    detail: 'a pointer at the picture instead of a claim about the system',
    severity: 'error',
  },
  // ── narrating the evidence apparatus ──────────────────────────────────────
  {
    code: 'evidence_narration',
    re: /\bthe\s+(?:evidence|receipts?|facts?|evidence\s+bundle)\s+(?:shows?|indicates?|suggests?|provides?|contains?|says?|reveals?|does\s+not)\b/i,
    detail:
      'the reader has no evidence bundle. They have the codebase. Attribute the fact to the code ' +
      '("server/src/validate.js:8 rejects empty usernames"), not to the pipeline that read it',
    severity: 'error',
  },
  {
    code: 'evidence_narration',
    re: /\bin\s+the\s+provided\s+`?\w+`?|\bfrom\s+the\s+(?:provided|given)\s+(?:evidence|facts?|context|data)\b|\bbased\s+on\s+the\s+provided\b/i,
    detail:
      'leaks the prompt\'s own variable names to the reader (observed: "not visible in the provided `testGuards`"). ' +
      'Name the repo artifact instead ("no test file covers this handler")',
    severity: 'error',
  },
  {
    code: 'evidence_narration',
    re: /\b(?:refer\s+to|see|per)\s+receipts?\b/i,
    detail: 'receipts render as inline chips; naming them in prose duplicates the UI',
    severity: 'warn',
  },
  // ── the PROMPT's own voice, shipped as prose ──────────────────────────────
  //
  // Measured live: FloowForge's `big_picture` ended with, verbatim,
  //   "You MUST say so plainly in your own words — a reader who is not told
  //    will assume this part of the system does not exist."
  // That is `sectionSpecs.snapshotCounts().unreadStacks.sentence`, a directive
  // that had been written into a DETERMINISTIC FACT. The facts blob is
  // presented to the model as authoritative content to narrate, so a model with
  // no other Python evidence to work from narrated the instruction. The field
  // is a plain statement now, and this rule is the backstop: any prompt-voice
  // sentence that reaches the markdown fails the section and forces a rewrite.
  //
  // NARROW ON PURPOSE, and the discriminator is the VERB, not the pronoun.
  // `howto` and `tutorial` sections address the reader in second person as
  // their normal register — StudyFlow's `setup_run` correctly says "you must
  // configure environment variables for the api and worker services", and a
  // blanket "you must" ban would rewrite that. What no section may do is issue
  // directives about the WRITING: `say`, `state`, `mention`, `disclose`,
  // `describe` are speech acts performed by the author, never tasks a reader
  // performs on the system.
  {
    code: 'prompt_voice',
    re: new RegExp(
      String.raw`\byou\s+(?:must|should|shall|need\s+to|have\s+to|are\s+(?:required|expected)\s+to)\s+(?:\w+\s+){0,3}?` +
        String.raw`(?:say|state|write|mention|describe|explain|disclose|note|report|name|cite|admit|acknowledge|call\s+(?:it\s+)?out)\b`,
      'i',
    ),
    detail:
      'an instruction to the writer reached the reader ("You MUST say so plainly…"). This is prompt text, not a fact ' +
      'about the system. State the fact itself and drop the directive',
    severity: 'error',
  },
  {
    code: 'prompt_voice',
    re: /\bin\s+your\s+own\s+words\b|\b(?:say\s+so|state\s+(?:it|this|that))\s+plainly\b|\bdo\s+not\s+(?:invent|guess|fabricate|speculate)\b|\bnever\s+(?:write|say|claim|invent|describe\s+the\s+codebase)\b/i,
    detail:
      'phrasing that only makes sense as an instruction to the model ("in your own words", "do not invent"). ' +
      'The reader is being handed the prompt',
    severity: 'error',
  },
  {
    code: 'prompt_voice',
    // The reader discussed in the third person, as an audience to be managed.
    // Zero legitimate occurrences across the 143 stored sections; the only hit
    // was the leaked directive itself.
    re: /\b(?:a|the|any)\s+readers?\s+(?:who|that)\b|\b(?:tell|telling|inform)\s+the\s+reader\b|\bthe\s+readers?\s+(?:must|should|needs?\s+to|will\s+assume|would\s+assume)\b/i,
    detail:
      'talks ABOUT the reader instead of to them. That framing belongs in the spec, not in the section. ' +
      'Say the thing the reader is supposed to learn',
    severity: 'error',
  },
];

/**
 * Internal stable-key prefixes. `sectionSpecs.ts` forbids these in output and
 * they shipped anyway — eight `cluster:…` keys in the one section the reviewer
 * called out. An explicit allowlist (not a generic `\w+:` pattern) so that
 * `server/index.js:22`, `http://…` and `Verification:` never match.
 */
const INTERNAL_KEY =
  /\b(?:cluster|wf|workflow|journey|capability|cap|doc|config|schema|external|topology):[a-z0-9][a-z0-9/_.-]*/i;
// `test:`, `ci:` and `env:` are stable-key prefixes too, but they are also how
// every repo names an npm script and a YAML key — `npm run test:node` was
// reported as a leak on the first real run. Extraction keeps them; this lint
// gives them up rather than cry wolf.

/** Prose quoting a raw receipt alias the reader cannot resolve. */
const DANGLING_ALIAS = /\breceipts?\s+r\d+\b/i;

function checkNarration(blocks: Block[], mode: ExplanationEvidence['mode']): ExplanationFinding[] {
  const findings: ExplanationFinding[] = [];
  for (const block of blocks) {
    for (const sentence of block.sentences) {
      for (const p of NARRATION_PATTERNS) {
        if (!p.re.test(sentence)) continue;
        findings.push({
          rule: 'narration',
          code: p.code,
          sentence,
          detail: p.detail,
          severity: p.softInReference && mode === 'reference' ? 'warn' : p.severity,
        });
      }
      if (INTERNAL_KEY.test(sentence)) {
        findings.push({
          rule: 'narration',
          code: 'internal_key_leak',
          sentence,
          detail:
            'an internal stable key (cluster:…, wf:…) reached the reader. These are pipeline identifiers, ' +
            'not names. Use the human-readable label the evidence also carries',
          severity: 'error',
        });
      }
      if (DANGLING_ALIAS.test(sentence)) {
        findings.push({
          rule: 'narration',
          code: 'internal_key_leak',
          sentence,
          detail: 'a raw receipt alias (r7) is a prompt-internal label the reader cannot resolve',
          severity: 'error',
        });
      }
      const inventory = inventoryNarration(sentence);
      if (inventory) findings.push(inventory);
    }
  }
  return findings;
}

/**
 * Counts of the artifact's own members, used AS the explanation.
 *
 * Deliberately not a ban on numbers: `sectionSpecs.ts` asks architecture_deep
 * for "its real file count", and "44 files import it" is a load-bearing
 * dependency fact. The discriminator is what survives deleting the count:
 *
 *   "Modules comprises 6 files and 3 symbols."          → "Modules"      FAIL
 *   "The UI owns the canvas and consists of 61 files."  → a real claim   PASS
 *   "`utils.ts` is imported by 44 files."               → no container
 *                                                         verb, untouched PASS
 */
const CONTAINER_INVENTORY = new RegExp(
  String.raw`\b(?:consists?\s+of|consisting\s+of|compris(?:e|es|ing)|composed\s+of|made\s+up\s+of|` +
    String.raw`contain(?:s|ing)?|hold(?:s|ing)?|has|have|totall?ing|there\s+(?:are|is))\s+` +
    String.raw`(?:only\s+|just\s+|approximately\s+|about\s+|roughly\s+|some\s+)?` +
    String.raw`\d[\d,]*\s+(?:[\w-]+\s+){0,2}?` +
    String.raw`(?:files?|symbols?|functions?|classes?|components?|modules?|tables?|lines?|routes?|endpoints?|entries|items?|records?)` +
    String.raw`(?:\s*(?:,|and)\s*\d[\d,]*\s+(?:[\w-]+\s+){0,2}?` +
    String.raw`(?:files?|symbols?|functions?|classes?|components?|modules?|tables?|lines?|routes?|endpoints?|entries|items?|records?))*`,
  'gi',
);

/** Residue below this many content words means the count WAS the sentence. */
const MIN_RESIDUE_WORDS = 3;

function inventoryNarration(sentence: string): ExplanationFinding | null {
  const inventory = new RegExp(CONTAINER_INVENTORY.source, 'gi');
  if (!inventory.test(sentence)) return null;
  const residue = contentWords(sentence.replace(new RegExp(CONTAINER_INVENTORY.source, 'gi'), ' '));
  if (residue.length >= MIN_RESIDUE_WORDS) return null;
  return {
    rule: 'narration',
    code: 'inventory_narration',
    sentence,
    detail:
      'the sentence is an inventory the reader can already count, and a file/symbol total is not a responsibility. ' +
      'Say what the thing is FOR; the count may then ride along',
    severity: 'error',
  };
}

// ── rule 1: level ───────────────────────────────────────────────────────────

/**
 * Whole-system scope language. Kept to the unambiguous forms: "for the
 * application" is a real observed miss but also a legitimate thing to say
 * about a theme provider, and a wrong flag costs a model call.
 */
const SCOPE_INFLATION =
  /\bthe\s+(?:entire|whole|overall|full)\s+(?:system|application|app|codebase|code\s?base|project|repository|repo|pipeline)\b|\b(?:the\s+)?(?:system|application|codebase|project)\s+as\s+a\s+whole\b|\bacross\s+the\s+(?:entire|whole)\s+\w+\b|\bevery(?:thing)?\s+in\s+the\s+(?:repo|repository|codebase|project)\b/i;

/**
 * Tokens worth matching on: 'Server · Modules' → ['server', 'modules'].
 *
 * Stemmed, because prose inflects and headings do not. "Collaborative Drawing
 * and State Synchronization" was reported as unnamed by a paragraph that said
 * "users draw on a shared canvas … changes are synchronized" — a spelling test,
 * not a level check.
 */
const INFLECTION = /(?:ings?|ed|ions?|ments?|ances?|ences?|ive|ity|ies|es|s)$/;

/**
 * Stem, then keep a prefix — English derivations diverge past the root in ways
 * no suffix list catches ("Repository Analysis" vs "analyze code
 * repositories", where neither stem survives whole). 60% of the word, never
 * below four characters: long enough that "reposi" cannot collide with
 * anything else in a sentence about this system, short enough to survive
 * derivation. Erring lenient is correct here — this check accuses, so a miss
 * is cheaper than a false accusation.
 */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map((t) => {
      const stem = t.replace(INFLECTION, '');
      const root = stem.length >= 4 ? stem : t;
      return root.slice(0, Math.max(4, Math.ceil(root.length * 0.6)));
    });
}

/**
 * Majority of the label's distinctive tokens, not all of them: a summary
 * headed "Room lifecycle" that talks about rooms throughout is about its
 * subject, and demanding the literal word "lifecycle" would be a spelling
 * test rather than a level check.
 */
function mentions(haystack: string, name: string): boolean | null {
  const tokens = nameTokens(name);
  // A label with nothing matchable in it — "UI", "API", "3D" — cannot be
  // looked for. Returning null means "unjudgeable", not "absent": the first
  // version of this check reported every 2-letter cluster as unnamed.
  if (tokens.length === 0) return null;
  const hit = tokens.filter((t) => haystack.includes(t)).length;
  return hit >= Math.ceil(tokens.length / 2);
}

/** Below this, a text is a blurb — too short to owe domain vocabulary. */
const MIN_WORDS_FOR_DOMAIN_CHECK = 18;
/** Below this, too short to fault for not repeating its own heading. */
const MIN_WORDS_FOR_SUBJECT_CHECK = 8;

function checkLevel(
  blocks: Block[],
  evidence: ExplanationEvidence,
): { findings: ExplanationFinding[]; namesSubject: boolean | null; domainNounsHit: string[] } {
  const findings: ExplanationFinding[] = [];
  const fullText = blocks.map((b) => b.text).join(' ');
  const lower = fullText.toLowerCase();
  const words = contentWords(fullText).length;
  const scope = evidence.scope;
  const firstSentence = blocks[0]?.sentences[0] ?? '';

  let namesSubject: boolean | null = null;
  if (scope?.subject && scope.kind !== 'repo') {
    namesSubject = mentions(lower, scope.subject);
    if (namesSubject === false && words >= MIN_WORDS_FOR_SUBJECT_CHECK) {
      findings.push({
        rule: 'level',
        code: 'subject_unnamed',
        sentence: firstSentence,
        detail:
          `this text is filed under "${scope.subject}" and never names it. ` +
          'A summary that could be pasted under any heading is not a summary of this one',
        severity: 'error',
      });
    }
  }

  if (scope && scope.kind !== 'repo') {
    for (const block of blocks) {
      for (const sentence of block.sentences) {
        if (SCOPE_INFLATION.test(sentence)) {
          findings.push({
            rule: 'level',
            code: 'scope_inflation',
            sentence,
            detail:
              `a ${scope.kind}-level explanation is making a whole-repo claim. ` +
              'Hold the altitude: explain this piece, and leave repo-level claims to the repo-level section',
            severity: 'error',
          });
        }
      }
    }
  }

  const domainNouns = (evidence.domainNouns ?? []).filter(Boolean);
  const domainNounsHit = domainNouns.filter((n) => lower.includes(n.toLowerCase()));
  if (domainNouns.length >= 3 && domainNounsHit.length === 0 && words >= MIN_WORDS_FOR_DOMAIN_CHECK) {
    findings.push({
      rule: 'level',
      code: 'domain_nouns_absent',
      sentence: firstSentence,
      detail:
        `${words} words about this system and not one of its own nouns (${domainNouns.slice(0, 8).join(', ')}). ` +
        'This prose would read the same for any repo. Name the things this codebase actually manipulates',
      severity: 'error',
    });
  }

  return { findings, namesSubject, domainNounsHit };
}

// ── rule 3: gaps ────────────────────────────────────────────────────────────

/**
 * Ways real output admits ignorance. Generous on purpose: this check fires on
 * ABSENCE, so an unlisted phrasing produces a false accusation.
 */
const GAP_PHRASE = new RegExp(
  [
    // Present tense alongside the participle: the disclosure `repairExplanation`
    // appends says "which OnboardBuddy does not parse", and only "parsed" was listed.
    String.raw`\bnot\s+(?:visible|provided|detected|detailed|analy[sz]ed|parse|parses|parsed|read|included|shown|covered|documented|captured|extracted|available|determined|explicitly)\b`,
    // "This project does not specify a run command in its package.json" is a
    // disclosure, and was being counted as an uncited claim. `applicable` joins
    // the family for the same reason: `sectionSpecs.ts` asks traced_flows to
    // answer "queue between phases?" and "auth guard placement?" for every
    // journey, and "Not applicable as this is a linear CI process" is the honest
    // answer to a question about something the repo does not have — an absence
    // statement, exactly like "not present" and "not configured" beside it.
    String.raw`\bnot\s+(?:specify|specified|declare|declared|define|defined|configure|configured|expose|exposed|present|exist|exists|found|set|applicable)\b`,
    String.raw`\bno\s+(?:evidence|receipt|test|trace|record|visible)\b`,
    String.raw`\bcould\s+not\s+(?:be\s+)?(?:determine|determined|resolve|resolved|read|parse|parsed|see|find)\b`,
    String.raw`\bcannot\s+be\s+(?:determined|verified|resolved|read)\b`,
    String.raw`\bunverified\b`,
    String.raw`\bunknown\b`,
    String.raw`\bunclear\b`,
    String.raw`\boutside\s+(?:the|this)\s+analysis\b`,
    String.raw`\bbeyond\s+(?:the|this)\s+(?:evidence|analysis|snapshot)\b`,
    String.raw`\bknown\s+gaps?\b`,
    String.raw`\bwe\s+do\s+not\s+know\b`,
    String.raw`\b(?:was|were|are|is)\s+(?:not\s+)?skipped\b`,
    String.raw`\bnot\s+in\s+the\s+evidence\b`,
  ].join('|'),
  'i',
);

function disclosesGap(text: string): boolean {
  return GAP_PHRASE.test(text);
}

/** Below this a text is a blurb, and silence about gaps is not yet a failure. */
const MIN_WORDS_FOR_GAP_CHECK = 120;

function checkGaps(
  markdown: string,
  blocks: Block[],
  evidence: ExplanationEvidence,
): { findings: ExplanationFinding[]; disclosesGaps: boolean } {
  const findings: ExplanationFinding[] = [];
  const fullText = blocks.map((b) => b.text).join(' ');
  const lower = fullText.toLowerCase();
  const words = contentWords(fullText).length;
  const firstSentence = blocks[0]?.sentences[0] ?? '';
  // Tested against the RAW markdown so that `[[unverified]]` markers — which
  // the pipeline injects at the claim after linting — still count as a
  // disclosure when the harness re-scores stored content.
  const disclosed = disclosesGap(stripFences(markdown ?? ''));

  if (!disclosed && (evidence.requireGapDisclosure === true || words >= MIN_WORDS_FOR_GAP_CHECK)) {
    findings.push({
      rule: 'gaps',
      code: 'no_gap_disclosure',
      sentence: firstSentence,
      detail:
        `${words} words, and nothing the analysis could not determine. A complete-looking explanation of a ` +
        'partially-read repo is the most expensive kind of wrong. Name at least one thing you could not see',
      severity: 'error',
    });
  }

  /**
   * The gaps rule is gameable, and the corpus shows it being gamed.
   *
   * `isClaimSentence` drops any sentence that `disclosesGap`, so an apology is
   * exempt from the grounding rule AND satisfies this one. On the small repos
   * the model therefore fills every mandated heading with "the evidence does
   * not specify …" and scores well: `MasterPokedex/setup_run` is 202 words with
   * five of them, including a port-in-use failure box that names no port, and
   * `FloowForge/traced_flows` answers the prompt's own checklist with "Not
   * applicable" twice. That is the "generic, padded, not useful" shape.
   *
   * So disclosure is now bounded on BOTH sides: silence is still a failure, and
   * so is a text that is mostly apology. Only fires once the text is long
   * enough for the share to mean something.
   */
  const absences = blocks.reduce(
    (n, b) => n + b.sentences.filter((s) => disclosesGap(s)).length,
    0,
  );
  const absenceWords = blocks.reduce(
    (n, b) => n + b.sentences.filter((s) => disclosesGap(s)).reduce((m, s) => m + contentWords(s).length, 0),
    0,
  );
  if (words >= 60 && absences >= 3 && absenceWords * 100 >= words * 20) {
    findings.push({
      rule: 'gaps',
      code: 'gap_padding',
      sentence: blocks.flatMap((b) => b.sentences).find((s) => disclosesGap(s)) ?? firstSentence,
      detail:
        `${absences} sentences (${Math.round((absenceWords * 100) / words)}% of this text) say only what could not be determined. ` +
        'A section built out of apologies is padding, and the Known Gaps panel already records them. ' +
        'Drop the headings you cannot fill and keep the ones you can; a short section that is all substance beats a complete-looking one',
      severity: 'error',
    });
  }

  for (const required of evidence.mustDisclose ?? []) {
    if (!required) continue;
    if (!lower.includes(required.toLowerCase())) {
      findings.push({
        rule: 'gaps',
        code: 'undisclosed_gap',
        sentence: firstSentence,
        detail:
          `the coverage facts say "${required}" was not read, and the text never mentions it. ` +
          'Silence about an unread subsystem reads as "this repo does not have one"',
        severity: 'error',
      });
    }
  }

  return { findings, disclosesGaps: disclosed };
}

// ── rule 5: repetition ──────────────────────────────────────────────────────

/**
 * One sentence written N ways — the hole the four original rules left open.
 *
 * Every rule above is per-sentence and severity-only, so seven paraphrases of
 * one sentence cost exactly what one costs. Measured in the live corpus (104
 * sections, 9 repos), that is the dominant bloat shape:
 *
 *   "the evidence does not specify the exact tables, services, or extension
 *    seams for this capability"          ×7 in OnboardBuddy/capabilities
 *                                        (~105 of 561 words = 19% of it)
 *   "keeping it separate prevents <deps> from spreading into other parts of
 *    the codebase"                       ×5 in OnboardBuddy/architecture_deep
 *   "provides common functionality … avoiding duplication"  ×4, same section
 *   "The evidence for <file> does not specify the number of files that import
 *    it."                                ×14 across the corpus's gap lists
 *
 * Exact-string dedupe cannot see any of these: the model reorders and
 * re-words just enough. So compare CONTENT-WORD SETS with identifiers blanked,
 * which is what makes "Keeping it separate prevents `jose` from spreading into
 * other parts of the codebase" and "Its separation prevents `simple-git` and
 * `glob` from spreading into other parts of the codebase" the same sentence.
 *
 * Deliberately conservative — this accuses, and a wrong accusation costs a
 * model call:
 *   • short sentences are exempt (a repeated 5-word line is usually a real
 *     table-ish enumeration, not padding);
 *   • the threshold is a HIGH Jaccard overlap, not a fuzzy match;
 *   • two occurrences are a `warn`, three or more an `error` — a pair can be
 *     deliberate parallelism, a trio is a template.
 */
const MIN_WORDS_FOR_REPETITION = 7;
/** Share of content words two sentences must share to count as one template. */
const REPETITION_OVERLAP = 0.8;
/** Below this many repeats it is parallelism, not padding. */
const REPETITION_ERROR_AT = 3;

/** Content words with identifiers, paths and digits blanked to `<id>`. */
function templateWords(sentence: string): string[] {
  const blanked = sentence
    .replace(/`[^`\n]*`/g, ' <id> ')
    .replace(/[\w@$.-]*[./][\w@$.-]*/g, ' <id> ')
    .replace(/\b\d[\d,._]*\b/g, ' <id> ');
  return contentWords(blanked).filter((w) => w !== 'id');
}

const overlap = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  // Against the SMALLER set: "X prevents A from spreading" fully contained in
  // "Keeping X separate prevents A and B from spreading" is the same template.
  return shared / Math.min(a.size, b.size);
};

function checkRepetition(blocks: Block[]): ExplanationFinding[] {
  const sentences: Array<{ text: string; words: Set<string> }> = [];
  for (const block of blocks) {
    for (const sentence of block.sentences) {
      const words = templateWords(sentence);
      if (words.length < MIN_WORDS_FOR_REPETITION) continue;
      sentences.push({ text: sentence, words: new Set(words) });
    }
  }

  // Greedy clustering: each sentence joins the first template it matches.
  const clusters: Array<{ first: string; members: string[]; words: Set<string> }> = [];
  for (const s of sentences) {
    const hit = clusters.find((c) => overlap(c.words, s.words) >= REPETITION_OVERLAP);
    if (hit) hit.members.push(s.text);
    else clusters.push({ first: s.text, members: [s.text], words: s.words });
  }

  const findings: ExplanationFinding[] = [];
  for (const c of clusters) {
    if (c.members.length < 2) continue;
    findings.push({
      rule: 'repetition',
      code: 'template_repetition',
      sentence: c.first,
      detail:
        `this sentence appears ${c.members.length} times with only the identifiers changed ` +
        `(e.g. "${(c.members[1] ?? '').slice(0, 110)}"). One finding restated N times is padding, not thoroughness. ` +
        'Write it ONCE and name every item it applies to in that one sentence',
      severity: c.members.length >= REPETITION_ERROR_AT ? 'error' : 'warn',
    });
  }
  return findings;
}

// ── rule 2: grounding ───────────────────────────────────────────────────────

/** Too short to be an assertion worth a receipt. */
const MIN_CLAIM_WORDS = 6;

/** Navigation lines that legitimately carry no receipt. */
const NON_CLAIM = /^(?:see|read|consult|the\s+interactive|details?\s+live|jump\s+to|next[,:]|for\s+more)\b/i;

/**
 * Tutorial/how-to steps: the command IS the evidence, so an imperative step
 * owes no receipt. Emphasis is stripped first because the model writes its
 * steps bolded — "**Locate the server entrypoint:** …" was reported as an
 * uncited claim on the first real run.
 */
const IMPERATIVE_STEP =
  /^(?:open|run|add|create|edit|copy|start|stop|install|verify|check|execute|update|replace|delete|set|export|cd|npm|docker|locate|modify|navigate|define|implement|register|wrap|import|write|rename|move|apply)\b/i;

const stripEmphasis = (s: string): string => s.trim().replace(/^[*_`>\s]+/, '');

function isClaimSentence(sentence: string, mode: ExplanationEvidence['mode']): boolean {
  if (contentWords(sentence).length < MIN_CLAIM_WORDS) return false;
  if (NON_CLAIM.test(stripEmphasis(sentence))) return false;
  if (disclosesGap(sentence)) return false;
  if ((mode === 'tutorial' || mode === 'howto') && IMPERATIVE_STEP.test(stripEmphasis(sentence))) return false;
  return true;
}

const MAX_REPORTED_UNCITED = 5;

function checkGrounding(
  blocks: Block[],
  evidence: ExplanationEvidence,
): { findings: ExplanationFinding[]; claimBlocks: number; citedBlocks: number } {
  // Reference sections are graded on their spliced backbone: uncited lines are
  // the design, exactly as `citationValidator.ts` carves out.
  if (evidence.mode === 'reference') return { findings: [], claimBlocks: 0, citedBlocks: 0 };

  const findings: ExplanationFinding[] = [];
  // The mechanical unread-stack disclosure is evidence-backed by construction —
  // it is rendered from the language inventory, not asserted by the model — so
  // it is neither a claim that owes a receipt nor denominator for the ones that do.
  const claimful = blocks.filter(
    (b) => !b.disclosure && b.sentences.some((s) => isClaimSentence(s, evidence.mode)),
  );
  const uncited = claimful.filter((b) => !b.cited);
  const claimBlocks = claimful.length;
  const citedBlocks = claimBlocks - uncited.length;

  for (const block of uncited.slice(0, MAX_REPORTED_UNCITED)) {
    findings.push({
      rule: 'grounding',
      code: 'uncited_claim',
      sentence: block.sentences.find((s) => isClaimSentence(s, evidence.mode)) ?? block.text,
      detail: 'this claim carries no receipt and no file:line locator: cite the evidence it came from, or drop it',
      severity: 'warn',
    });
  }

  if (claimBlocks >= 3 && uncited.length * 2 > claimBlocks) {
    findings.push({
      rule: 'grounding',
      code: 'mostly_uncited',
      sentence: findings[0]?.sentence ?? claimful[0]?.text ?? '',
      detail:
        `${uncited.length} of ${claimBlocks} claim paragraphs cite nothing. ` +
        'A majority of this text is assertion. Every claim needs a receipt; where you have none, say so instead',
      severity: 'error',
    });
  }

  return { findings, claimBlocks, citedBlocks };
}

// ── entry point ─────────────────────────────────────────────────────────────

const RULE_HEADLINE: Record<ExplanationRule, string> = {
  narration: 'SCREEN NARRATION: the text describes the artifact, or repeats the instructions it was given, instead of explaining the system',
  level: 'WRONG ALTITUDE: the explanation is not about the thing it is filed under',
  grounding: 'UNGROUNDED CLAIMS: assertions with no receipt behind them',
  gaps: 'UNDISCLOSED GAPS: the text does not say what it could not determine',
  repetition: 'PADDING: one sentence restated with the identifiers swapped',
};

const RULE_ORDER: ExplanationRule[] = ['repetition', 'narration', 'level', 'grounding', 'gaps'];

/**
 * Lints one generated explanation against the four-rule contract.
 *
 * @param markdown  the generated prose (receipt markers or `rN` aliases both fine)
 * @param evidence  what it was generated from — scope, domain nouns, coverage gaps
 */
export function lintExplanation(markdown: string, evidence: ExplanationEvidence = {}): ExplanationLintResult {
  const source = markdown ?? '';
  const blocks = toBlocks(source);
  const words = contentWords(blocks.map((b) => b.text).join(' ')).length;

  const narration = checkNarration(blocks, evidence.mode);
  const level = checkLevel(blocks, evidence);
  const grounding = checkGrounding(blocks, evidence);
  const gaps = checkGaps(source, blocks, evidence);
  // Reference sections splice deterministic tables whose rows legitimately
  // share a shape; only the prose modes are held to the repetition rule.
  const repetition = evidence.mode === 'reference' ? [] : checkRepetition(blocks);

  const findings = [...repetition, ...narration, ...level.findings, ...grounding.findings, ...gaps.findings];

  // One issue string per rule that produced an error, each quoting a real
  // sentence — a retry prompt that says "you wrote X" beats one that says
  // "avoid narration".
  const issues: string[] = [];
  for (const rule of RULE_ORDER) {
    const errors = findings.filter((f) => f.rule === rule && f.severity === 'error');
    if (errors.length === 0) continue;
    const codes = [...new Set(errors.map((f) => f.code))].join(', ');
    const examples = errors
      .slice(0, 3)
      .map((f) => `  • "${f.sentence.slice(0, 160)}": ${f.detail}`)
      .join('\n');
    issues.push(`${RULE_HEADLINE[rule]} (${errors.length} finding(s): ${codes})\n${examples}`);
  }

  return {
    findings,
    issues,
    hits: [...new Set(findings.map((f) => f.code))],
    stats: {
      words,
      claimBlocks: grounding.claimBlocks,
      citedBlocks: grounding.citedBlocks,
      narrationHits: narration.length,
      repetitionHits: repetition.length,
      disclosesGaps: gaps.disclosesGaps,
      namesSubject: level.namesSubject,
      domainNounsHit: level.domainNounsHit,
    },
  };
}
