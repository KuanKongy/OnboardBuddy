/**
 * Decision-bearing comment extraction — the narration fix for
 * `architecture_deep` (doc/ONBOARDING_QUALITY_LATENCY_PLAN.md golden checklist:
 * "describes structure without decision→consequence language").
 *
 * The diagnosis was extraction-layer-clean: the data was already right, the
 * prose under-used it. `architecture_deep` got cluster labels, file counts and
 * boundary crossings — all *structure* — so it wrote structure. The one thing it
 * was never handed is the repo's own reasoning, which in this codebase lives in
 * comments: "transaction-mode pooler: clients multiplex, so each process sizes
 * its pool for its own fan-out", "queue suffix so a stale worker cannot eat this
 * run's jobs". Those sentences ARE the decision→consequence content; they were
 * sitting in `graph_nodes.snippet` unread.
 *
 * So this module routes them in: it finds comment lines that explain WHY rather
 * than WHAT, and turns each into a citable receipt with an exact file and line.
 * The section can then state a decision and cite the comment that records it,
 * instead of inventing a rationale — which is the rule the spec already has
 * ("Admitting trade-offs is correct here; inventing them is not").
 */

import { query } from '../../lib/db.js';

/**
 * Words that mark a sentence as reasoning rather than description.
 *
 * Tuned for precision over recall: a missed rationale costs one weaker
 * paragraph, while a false positive spends a receipt slot on a comment that
 * says nothing, and receipt slots are capped. "so that"/"because" look generic
 * but a comment containing them is almost always explaining a choice — which is
 * exactly the target.
 */
const DECISION_MARKERS = [
  'so that', 'because', 'instead of', 'rather than', 'trade-off', 'tradeoff',
  'deliberate', 'on purpose', 'consequence', 'otherwise', 'must never',
  'the reason', 'we chose', 'chosen', 'avoids', 'prevents', 'would break',
  'would cost', 'accepted', 'caveat', 'deviation', 'by design', 'note:',
];

/**
 * Case-insensitive marker test: the phrase list, the explicit arrows, and `, so`
 * — a comma followed by "so" introduces a consequence
 * ("clients multiplex, so each process sizes its own pool"). That turned out to
 * be the single most common rationale form in this codebase, and matching only
 * "so that" missed it: the compose file's pooler comment, which is one of the
 * two examples the checklist named, has a bare `, so`.
 */
const MARKER_RE = new RegExp(
  `(?:${DECISION_MARKERS.map((m) => m.replace(/-/g, '\\-')).join('|')})|,\\s+so\\b|⇒|=>`,
  'gi',
);

/** Comment-line prefixes we understand (JS/TS, SQL, YAML/shell, JSX blocks). */
const COMMENT_LINE = /^\s*(?:\/\/+|\/\*+|\*+\/?|#+|--+)\s?(.*)$/;

/** A minimum that skips `// TODO` and `// eslint-disable` without much thought. */
const MIN_NOTE_CHARS = 45;
const MAX_NOTE_CHARS = 320;

export interface DecisionNote {
  /** The rationale text, comment markers stripped, whitespace collapsed. */
  text: string;
  /** 0-based line offset of the note's first line within the snippet. */
  lineOffset: number;
  /** How many distinct reasoning markers it carries — the ranking signal. */
  markerCount: number;
}

/**
 * Pulls decision-bearing notes out of one snippet.
 *
 * Consecutive comment lines are joined first: rationale in this codebase is
 * usually a wrapped paragraph, and judging each physical line alone both splits
 * the sentence and hides the marker on whichever line does not contain it.
 */
export function extractDecisionNotes(snippet: string | null | undefined): DecisionNote[] {
  if (!snippet) return [];
  const lines = snippet.split('\n');
  const notes: DecisionNote[] = [];

  let buffer: string[] = [];
  let bufferStart = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    buffer = [];
    if (text.length < MIN_NOTE_CHARS) return;
    const markers = text.match(MARKER_RE);
    if (!markers) return;
    notes.push({
      text: text.slice(0, MAX_NOTE_CHARS),
      lineOffset: bufferStart,
      // Distinct markers: "because … because …" is one idea stated twice, not
      // twice the rationale.
      markerCount: new Set(markers.map((m) => m.toLowerCase())).size,
    });
  };

  lines.forEach((line, i) => {
    const match = COMMENT_LINE.exec(line);
    if (match) {
      const body = (match[1] ?? '').trim();
      // A bare `*` or `//` is a paragraph break inside a block comment.
      if (body === '') {
        flush();
        return;
      }
      if (buffer.length === 0) bufferStart = i;
      buffer.push(body);
      return;
    }
    flush();
  });
  flush();

  return notes;
}

export interface DecisionReceiptRow {
  nodeId: string;
  nodeStableKey: string;
  filePath: string | null;
  symbolName: string;
  /** 1-based line of the note in the file, when the node's start is known. */
  lineStart: number | null;
  lineEnd: number | null;
  trustLevel: 'code' | 'config' | 'tests' | 'docs' | 'llm_inference';
  note: string;
  markerCount: number;
  dependents: number;
}

/**
 * The repo's own recorded decisions, ranked, one per file.
 *
 * Ranking is `markerCount` then fan-in: a comment on a module 30 files depend on
 * is a decision with blast radius, which is what a newcomer needs to know about.
 * One note per file keeps a single heavily-commented module from taking every
 * slot.
 */
export async function loadDecisionNotes(snapshotId: string, cap = 10): Promise<DecisionReceiptRow[]> {
  // Candidate pool is filtered in SQL to nodes whose snippet even contains a
  // comment marker; the precise work happens in JS where the snippet can be
  // parsed line by line.
  const rows = (await query(
    `SELECT n.id, n.stable_key, n.name, n.file_path, n.line_start, n.line_end, n.snippet, n.trust_level,
            COALESCE((n.metadata->>'dependentCount')::int, 0) AS dependents
     FROM graph_nodes n
     WHERE n.snapshot_id = $1
       AND n.snippet IS NOT NULL
       AND (n.snippet ~ '(--|//|/\\*|#)' )
       AND length(n.snippet) > 80
     ORDER BY COALESCE((n.metadata->>'dependentCount')::int, 0) DESC
     LIMIT 400`,
    [snapshotId],
  )).rows as Array<{
    id: string; stable_key: string; name: string; file_path: string | null;
    line_start: number | null; line_end: number | null; snippet: string | null;
    trust_level: DecisionReceiptRow['trustLevel']; dependents: number;
  }>;

  const best = new Map<string, DecisionReceiptRow>();
  for (const row of rows) {
    for (const note of extractDecisionNotes(row.snippet)) {
      const fileKey = row.file_path ?? row.stable_key;
      const candidate: DecisionReceiptRow = {
        nodeId: row.id,
        nodeStableKey: row.stable_key,
        filePath: row.file_path,
        symbolName: row.name,
        // Point at the comment itself, not the top of the symbol — a receipt a
        // reader cannot find is not a receipt.
        lineStart: row.line_start != null ? row.line_start + note.lineOffset : null,
        lineEnd: row.line_start != null ? row.line_start + note.lineOffset : row.line_end,
        trustLevel: row.trust_level,
        note: note.text,
        markerCount: note.markerCount,
        dependents: Number(row.dependents) || 0,
      };
      const existing = best.get(fileKey);
      if (!existing || rank(candidate) > rank(existing)) best.set(fileKey, candidate);
    }
  }

  return [...best.values()].sort((a, b) => rank(b) - rank(a)).slice(0, cap);
}

function rank(row: DecisionReceiptRow): number {
  return row.markerCount * 100 + Math.min(row.dependents, 99);
}
