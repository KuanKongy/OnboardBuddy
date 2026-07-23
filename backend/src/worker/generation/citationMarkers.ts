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
