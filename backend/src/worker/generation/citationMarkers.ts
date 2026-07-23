/**
 * Inline citation markers.
 *
 * The prompt gives evidence-bundle receipts short aliases (r1…rN). Models
 * cite them not only in the structured `claims` (which ARE translated back
 * to UUIDs) but also inside `contentMarkdown` — "(receipt r14)", "[r3]" —
 * where they used to ship verbatim: dead labels pointing at a numbering the
 * reader never sees.
 *
 * This module rewrites prose aliases into stable markers
 * `[[receipt:<bundle-receipt-uuid>]]` for receipts that were actually used
 * (and therefore persisted with metadata.copiedFromReceiptId), and strips
 * the rest. The frontend renders markers as numbered inline chips.
 */

/** `r3` / `r3, r7` / `r3 and r7` / `r3; r7` — nothing but receipt refs. */
const REF_LIST = String.raw`[rR]\d+(?:\s*(?:,|;|/|&|and)\s*[rR]\d+)*`;

/** `(receipt r3)`, `(Receipts r1, r4)`, `(r3)`, `[r3]`, `(Receipt: [r3])` */
const PAREN_GROUP = new RegExp(
  String.raw`\(\s*(?:[rR]eceipts?\s*:?\s*)?\[?(${REF_LIST})\]?\s*\)` + `|` + String.raw`\[(${REF_LIST})\]`,
  'g',
);

/** A whole bullet/line that is ONLY a receipt reference ("- Receipt: [r3]"). */
const REF_ONLY_LINE = new RegExp(
  String.raw`^\s*[-*]?\s*[rR]eceipts?\s*:?\s*\[?(${REF_LIST})\]?\s*$`,
);

/** Bookkeeping the model sometimes appends as user-facing markdown. */
const BOOKKEEPING_HEADING = /^#{1,6}\s*(?:used\s+receipt\s+ids?|claims)\s*:?\s*$/i;

export interface RewriteResult {
  content: string;
  /** Aliases that resolved to a persisted (used) receipt. */
  resolved: string[];
  /** Aliases dropped: unknown alias, or receipt not used/persisted. */
  dropped: string[];
}

function splitRefs(list: string): string[] {
  return list.split(/\s*(?:,|;|\/|&|and)\s*/).filter(Boolean).map((r) => r.toLowerCase());
}

/**
 * Rewrites inline rN aliases to `[[receipt:<uuid>]]` markers (used receipts
 * only), removes reference-only bullets that don't resolve, and deletes
 * trailing "## Claims" / "## Used Receipt IDs" bookkeeping blocks.
 */
export function rewriteInlineCitations(
  markdown: string,
  aliasToId: Map<string, string>,
  usedReceiptIds: Set<string>,
): RewriteResult {
  const resolved: string[] = [];
  const dropped: string[] = [];

  const markersFor = (refList: string): string =>
    splitRefs(refList)
      .map((alias) => {
        const id = aliasToId.get(alias);
        if (id && usedReceiptIds.has(id)) {
          resolved.push(alias);
          return `[[receipt:${id}]]`;
        }
        dropped.push(alias);
        return '';
      })
      .filter(Boolean)
      .join('');

  const lines = markdown.split('\n');
  const kept: string[] = [];
  let skippingBookkeeping = false;
  let inCodeFence = false;
  for (const line of lines) {
    // Never rewrite inside fenced code — a literal "(r1)" in an example is code.
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      kept.push(line);
      continue;
    }
    if (inCodeFence) {
      kept.push(line);
      continue;
    }
    if (BOOKKEEPING_HEADING.test(line.trim())) {
      skippingBookkeeping = true;
      continue;
    }
    if (skippingBookkeeping) {
      // Skip the block body until the next heading, which is processed normally.
      if (/^#{1,6}\s/.test(line)) skippingBookkeeping = false;
      else continue;
    }

    const refOnly = line.match(REF_ONLY_LINE);
    if (refOnly) {
      const markers = markersFor(refOnly[1]!);
      // Keep the bullet shape when it resolves; drop the bullet entirely when
      // it doesn't — "- Receipt: [r13]" with no r13 is pure noise.
      if (markers) {
        const bullet = line.match(/^\s*[-*]\s*/)?.[0] ?? '';
        kept.push(`${bullet}Backed by: ${markers}`);
      }
      continue;
    }

    const replaced = line.replace(
      PAREN_GROUP,
      (_m, parenList: string | undefined, bracketList: string | undefined) => {
        const markers = markersFor((parenList ?? bracketList)!);
        return markers ? ` ${markers}` : '';
      },
    );
    // Tidy doubled spaces left by removals — inside the line only, never
    // touching leading indentation (nested lists depend on it).
    const indent = replaced.match(/^[ \t]*/)![0];
    kept.push(
      indent +
        replaced
          .slice(indent.length)
          .replace(/[ \t]+([.,;:)])/g, '$1')
          .replace(/[ \t]{2,}/g, ' ')
          .trimEnd(),
    );
  }

  return { content: kept.join('\n').trim(), resolved, dropped };
}

/**
 * Legacy cleanup: content generated before markers existed has aliases with
 * no surviving alias map — every alias is unresolvable by construction.
 */
export function stripLegacyCitationAliases(markdown: string): RewriteResult {
  return rewriteInlineCitations(markdown, new Map(), new Set());
}

export interface UnverifiedMarkResult {
  content: string;
  /** Downgraded claims wrapped in inline [[unverified]] markers. */
  marked: number;
  /** Downgraded claims whose text was not found in the prose (footer-only). */
  unmatched: number;
}

/** Lowercased, markdown-decoration-free, whitespace-collapsed comparison form. */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。]$/, '');
}

const MIN_MATCH_CHARS = 20;

/**
 * Inline unverified-claim markers (audit §8: "Known Gaps disconnected from
 * the claims they refer to"). Claims the validator downgraded to low with
 * zero receipts are wrapped `[[unverified]]…[[/unverified]]` on the prose
 * line where their text appears, so the flag sits at the point of doubt
 * instead of only in a footer list.
 *
 * Matching is deliberately conservative — a wrong underline is worse than a
 * missing one: normalized containment either way (claim text is truncated
 * at 160 chars, so a prose line may extend past it), never inside code
 * fences, headings, tables, or lines that already carry links/markers, and
 * a fragment-line only counts when it covers most of the claim. Unmatched
 * claims stay footer-only.
 */
export function markUnverifiedClaims(markdown: string, downgradedClaims: string[]): UnverifiedMarkResult {
  const claims = downgradedClaims
    .map((c) => normalizeForMatch(c))
    .filter((c) => c.length >= MIN_MATCH_CHARS);
  if (claims.length === 0) {
    return { content: markdown, marked: 0, unmatched: downgradedClaims.length - claims.length };
  }

  const lines = markdown.split('\n');
  const usedLines = new Set<number>();
  let inCodeFence = false;
  const normalized: Array<string | null> = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      return null;
    }
    if (inCodeFence) return null;
    // Headings render as block titles, tables break when wrapped, and lines
    // with links/markers would nest links (invalid markdown).
    if (/^\s*#/.test(line) || line.includes('|') || line.includes('[')) return null;
    const norm = normalizeForMatch(line);
    return norm.length >= MIN_MATCH_CHARS ? norm : null;
  });

  let marked = 0;
  for (const claim of claims) {
    const lineIdx = normalized.findIndex((norm, i) => {
      if (norm === null || usedLines.has(i)) return false;
      if (norm.includes(claim)) return true;
      // Truncated-claim case: the line is a fragment of the claim — only
      // when it covers most of it, so short generic lines never match.
      return claim.includes(norm) && norm.length >= 0.6 * claim.length;
    });
    if (lineIdx === -1) continue;
    usedLines.add(lineIdx);
    const m = lines[lineIdx]!.match(/^(\s*(?:(?:[-*+]|\d+\.)\s+)?)(.*?)(\s*)$/)!;
    lines[lineIdx] = `${m[1]}[[unverified]]${m[2]}[[/unverified]]${m[3]}`;
    marked += 1;
  }

  return {
    content: lines.join('\n'),
    marked,
    unmatched: downgradedClaims.length - marked,
  };
}

const UUID_CITATION = new RegExp(
  String.raw`\(\s*(?:[rR]eceipts?\s*:?\s*)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\)` +
    `|` +
    String.raw`\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]`,
  'gi',
);

/**
 * Q&A answers cite receipts by raw UUID (no alias map); prose like
 * "(receipt 3f2a…)" becomes a numbered marker for used receipts and is
 * dropped otherwise — same contract as section content, same renderer.
 */
export function rewriteQaUuidCitations(markdown: string, usedReceiptIds: Set<string>): RewriteResult {
  const resolved: string[] = [];
  const dropped: string[] = [];
  const lines = markdown.split('\n');
  let inCodeFence = false;
  const rewritten = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      return line;
    }
    if (inCodeFence) return line;
    const replaced = line.replace(UUID_CITATION, (_m, paren: string | undefined, bracket: string | undefined) => {
      const id = (paren ?? bracket)!.toLowerCase();
      if (usedReceiptIds.has(id)) {
        resolved.push(id);
        return ` [[receipt:${id}]]`;
      }
      dropped.push(id);
      return '';
    });
    const indent = replaced.match(/^[ \t]*/)![0];
    return (
      indent +
      replaced
        .slice(indent.length)
        .replace(/[ \t]+([.,;:)])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trimEnd()
    );
  });
  return { content: rewritten.join('\n').trim(), resolved, dropped };
}
