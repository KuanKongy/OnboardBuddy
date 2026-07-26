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

/**
 * `(r1:backend/src/worker/semantic/semanticPipeline.ts:36)` — a REAL alias
 * glued to the locator it points at.
 *
 * Measured live on `OnboardBuddy/architecture_deep`: all three
 * decision→consequence bullets cite this way, because the prompt hands the
 * model `decisionNotes[].where` as `"<file>:<line>"` right next to the alias
 * and the model concatenates the two. `PAREN_GROUP` needs the closing paren
 * immediately after the ref, so every one of them shipped verbatim — three
 * dead `r1:`/`r5:` labels pointing at a numbering the reader never sees, with
 * `resolved: 0, dropped: []` recorded as if the section had cited nothing at
 * all.
 *
 * Resolved: the marker replaces the whole thing (the chip already resolves to
 * that file and line). Unresolved: the alias goes and the locator STAYS —
 * `path.ts:36` is something a reader can follow, and deleting it would turn a
 * followable claim into a bare assertion.
 *
 * Runs AFTER `PAREN_GROUP` so `(r1, r3)` is consumed as a ref list first and
 * never reaches this as "alias r1 plus the text r3".
 */
const ALIAS_WITH_LOCATOR = new RegExp(
  String.raw`\(\s*(?:[rR]eceipts?\s*:?\s*)?\[?([rR]\d+)\]?\s*:\s*([^)\n]{2,160}?)\s*\)`,
  'g',
);

/**
 * Alias shapes the pipeline NEVER mints, in citation position.
 *
 * `sectionGenerator.ts` issues `r1…rN` and nothing else, so `(r_evidence)` —
 * cited three times by `FloowForge/traced_flows` — is a hallucinated label.
 * It matched no rewrite rule, so it shipped, and nothing counted it: the
 * section read as though it carried receipts while pointing at an id that
 * never existed.
 *
 * Deliberately narrow, because this DELETES text and a wrong deletion mangles
 * a sentence. Only `r`/`receipt` followed by `_`/`:` and a word, or by `-` and
 * a DIGIT, qualifies. That is enough for every hallucination shape seen
 * (`r_evidence`, `receipt_1`, `r:2`, `r-3`) and cannot reach the English and
 * code parentheticals that live in this corpus — `(r squared)`, `(r1cm)`,
 * `(runId)`, `(req.body)`, `(r-value)`, `(read-only)` all fail it.
 */
const UNKNOWN_REF = String.raw`[rR](?:eceipt)?(?:[_:][A-Za-z0-9][\w:.-]{0,39}|-\d[\w.-]{0,39})`;
const UNKNOWN_ALIAS_GROUP = new RegExp(
  String.raw`\(\s*(?:[rR]eceipts?\s*:?\s*)?\[?(${UNKNOWN_REF})\]?\s*\)` + `|` + String.raw`\[(${UNKNOWN_REF})\]`,
  'g',
);

/** A whole bullet/line that is ONLY a receipt reference ("- Receipt: [r3]"). */
const REF_ONLY_LINE = new RegExp(
  String.raw`^\s*[-*]?\s*[rR]eceipts?\s*:?\s*\[?(${REF_LIST})\]?\s*$`,
);

/**
 * Citations the model wrapped in inline code — `` ` (r2)` `` — would carry
 * their markers into a code span, where the reader renders them as raw
 * text instead of chips. Unwrap the backticks before rewriting.
 */
const CODE_WRAPPED_REF = new RegExp(
  '`\\s*(\\(?\\s*(?:[rR]eceipts?\\s*:?\\s*)?\\[?(?:' + REF_LIST + ')\\]?\\s*\\)?)\\s*`',
  'g',
);

/** Bookkeeping the model sometimes appends as user-facing markdown. */
const BOOKKEEPING_HEADING = /^#{1,6}\s*(?:used\s+receipt\s+ids?|claims)\s*:?\s*$/i;

export interface RewriteResult {
  content: string;
  /** Aliases that resolved to a persisted (used) receipt. */
  resolved: string[];
  /** Aliases dropped: unknown alias, or receipt not used/persisted. */
  dropped: string[];
  /**
   * Alias-shaped labels the pipeline could never have minted (`r_evidence`),
   * removed from the prose. Distinct from `dropped`, which is a well-formed
   * `rN` whose receipt was simply not used: a non-zero count here means the
   * model INVENTED a citation, which is a grounding failure rather than a
   * bookkeeping one, and it belongs in `generation_context` where the audit
   * can find it.
   */
  unknownAliases: string[];
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
  const unknownAliases: string[] = [];

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
  for (let line of lines) {
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

    // Inline-code-wrapped citations lose their backticks so the markers
    // land in prose, not in a code span the reader can't make clickable.
    line = line.replace(CODE_WRAPPED_REF, ' $1');

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

    const replaced = line
      .replace(
        PAREN_GROUP,
        (_m, parenList: string | undefined, bracketList: string | undefined) => {
          const markers = markersFor((parenList ?? bracketList)!);
          return markers ? ` ${markers}` : '';
        },
      )
      // `(r1:path.ts:36)` — resolve to the chip, or keep the locator alone.
      .replace(ALIAS_WITH_LOCATOR, (_m, alias: string, locator: string) => {
        const markers = markersFor(alias);
        return markers ? ` ${markers}` : ` (${locator})`;
      })
      // Whatever still looks like a citation cannot be one: the alias space is
      // exactly r1…rN and everything in it has been consumed above.
      .replace(UNKNOWN_ALIAS_GROUP, (_m, paren: string | undefined, bracket: string | undefined) => {
        unknownAliases.push((paren ?? bracket)!.toLowerCase());
        return '';
      });
    // Tidy doubled spaces left by removals — inside the line only, never
    // touching leading indentation (nested lists depend on it).
    const indent = replaced.match(/^[ \t]*/)![0];
    const tidied =
      indent +
      replaced
        .slice(indent.length)
        // Dropped citations inside inline code leave empty `` husks.
        .replace(/`\s*`/g, '')
        .replace(/[ \t]+([.,;:)])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trimEnd();
    // A bullet whose only content WAS the invented alias ("- Receipt: [r_x]")
    // is now a label with nothing behind it — drop the line, same as the
    // resolvable form does above.
    if (/^\s*[-*]?\s*[rR]eceipts?\s*:?\s*$/.test(tidied)) continue;
    kept.push(tidied);
  }

  return { content: kept.join('\n').trim(), resolved, dropped, unknownAliases };
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
  // Q&A cites raw UUIDs, so there is no alias namespace to hallucinate inside.
  return { content: rewritten.join('\n').trim(), resolved, dropped, unknownAliases: [] };
}
