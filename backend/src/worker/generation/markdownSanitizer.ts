/**
 * Write-time markdown sanitizer for model-generated prose
 * (doc/SECURITY_XSS_PROMPT_INJECTION.md findings P2 and X1).
 *
 * `contentMarkdown` is the one free-form field the LLM controls, and it is
 * stored verbatim and later markdown-rendered for every teammate. React and
 * react-markdown already stop script execution, so the residual risk is the
 * part markdown renders *without* script: an external image is a zero-click
 * GET from every reader's browser (a tracking/exfil beacon), and an external
 * link is one click from phishing. A repo that wins the prompt-injection
 * gamble only pays off if it can plant one of those, so we remove them from
 * the text before it is ever stored.
 *
 * Why write-time and not only render-time: the same string is also served by
 * the markdown export endpoint, where our React renderer is not involved at
 * all. Sanitizing at the boundary where the model's output enters our storage
 * covers both readers with one rule.
 *
 * Policy, deliberately narrow:
 *   - images: ALWAYS removed, alt text kept as words. This pipeline never has
 *     a legitimate reason to emit one — diagrams travel in their own mermaid
 *     field, generated deterministically.
 *   - links: destination must be an in-page anchor, a root/dot-relative path,
 *     or https on github.com. Anything else keeps its link TEXT and loses its
 *     destination, so information survives and the click does not.
 *   - raw HTML tags and comments: removed.
 *   - code is never touched: fenced blocks and inline spans pass through
 *     verbatim. A `<script>` quoted inside a code span is the repo's real
 *     content and renders as inert text; corrupting it would be a worse bug
 *     than the non-risk it removes.
 */

export interface MarkdownSanitizeCounts {
  /** Markdown images removed (inline, reference, and shortcut forms). */
  images: number;
  /** Links whose destination failed the allowlist. */
  links: number;
  /** Raw HTML tags and comments removed. */
  html: number;
  /** `<scheme:…>` autolinks defanged to plain text. */
  autolinks: number;
}

export interface MarkdownSanitizeResult {
  markdown: string;
  removed: MarkdownSanitizeCounts;
  /** True when anything at all was stripped — the audit signal we persist. */
  modified: boolean;
}

/** Only github.com (and subdomains) may keep a live destination. */
const ALLOWED_LINK_HOST = /(?:^|\.)github\.com$/i;

/**
 * Is this markdown link destination safe to keep clickable?
 * Fails closed: anything unparseable is unsafe.
 */
export function isSafeDestination(raw: string): boolean {
  let dest = raw.trim();
  if (dest.startsWith('<')) {
    const end = dest.indexOf('>');
    dest = end === -1 ? dest.slice(1) : dest.slice(1, end);
  } else {
    // `(url "title")` — the title is not part of the destination.
    dest = dest.split(/\s+/)[0] ?? '';
  }
  dest = dest.trim();
  if (dest === '') return false;
  // Control characters and spaces are how `java\tscript:` sneaks past naive
  // scheme checks; a legitimate destination never contains them.
  if (/[\u0000-\u0020\u007f]/.test(dest)) return false;
  // In-page anchors: `#receipt:<id>` / `#unverified` are this app's own
  // citation markers, plus ordinary heading anchors.
  if (dest.startsWith('#')) return true;
  // Relative paths, but never protocol-relative `//evil.example`.
  if (/^\.{0,2}\//.test(dest) && !dest.startsWith('//')) return true;
  try {
    const url = new URL(dest);
    return url.protocol === 'https:' && ALLOWED_LINK_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

const IMAGE_INLINE = /!\[([^\]]*)\]\([^)]*\)/g;
const IMAGE_REFERENCE = /!\[([^\]]*)\]\[[^\]]*\]/g;
const IMAGE_SHORTCUT = /!\[([^\]]*)\](?![[(])/g;
const LINK_INLINE = /\[([^\]]*)\]\(([^)]*)\)/g;
/** Leftover destinations the nesting-blind LINK_INLINE pass could not reach. */
const DESTINATION_SWEEP = /\]\(([^)]*)\)/g;
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]*:[^>\s]*)>/g;
/** A URL written as plain text, with no markdown syntax around it. */
const BARE_URL = /\bhttps?:\/\/[^\s<>()[\]"'`]+/gi;
/**
 * Left where a destination was removed. Visible on purpose: a reader seeing
 * this knows something was stripped, rather than silently reading a doc with a
 * hole in it.
 */
const REMOVED_MARKER = '[external link removed]';
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
/**
 * A tag name is letters/digits/hyphens, then either `>`, or whitespace and
 * attributes, or a self-closing slash. The tight name charset is what keeps
 * this from swallowing an autolink: `<https://github.com/o/r>` fails because
 * `:` and `/` cannot appear in a name and there is no whitespace to start an
 * attribute list.
 */
const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\/?>/g;
/** `[label]: <destination>` reference definitions, checked per line. */
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(\S+)/;

/** Alt text becomes plain words; `[`/`]` would let it re-form a link. */
function altToText(alt: string): string {
  return alt.replace(/[[\]]/g, '').trim();
}

function sanitizeProse(text: string, counts: MarkdownSanitizeCounts): string {
  let out = text;

  out = out.replace(IMAGE_INLINE, (_m, alt: string) => {
    counts.images += 1;
    return altToText(alt);
  });
  out = out.replace(IMAGE_REFERENCE, (_m, alt: string) => {
    counts.images += 1;
    return altToText(alt);
  });
  out = out.replace(IMAGE_SHORTCUT, (_m, alt: string) => {
    counts.images += 1;
    return altToText(alt);
  });

  out = out.replace(LINK_INLINE, (whole: string, label: string, dest: string) => {
    if (isSafeDestination(dest)) return whole;
    counts.links += 1;
    return label;
  });
  // Nested brackets in a label (`[a[b]](url)`) defeat the pass above; strip the
  // destination so what is left renders as literal `[a[b]]` text.
  out = out.replace(DESTINATION_SWEEP, (whole: string, dest: string) => {
    if (isSafeDestination(dest)) return whole;
    counts.links += 1;
    return ']';
  });

  out = out.replace(AUTOLINK, (_m, inner: string) => {
    if (isSafeDestination(inner)) return `<${inner}>`;
    counts.autolinks += 1;
    return REMOVED_MARKER;
  });

  // Bare URLs, with no markdown syntax around them at all.
  //
  // These look harmless in THIS app — no `remark-gfm`, so react-markdown leaves
  // them as text. But the same string is served by the markdown export
  // endpoint, and every mainstream renderer of a downloaded `.md` (GitHub
  // included) has GFM autolink-literal ON: it turns the bare text straight back
  // into a live link. So "inert here" is not inert, and an off-allowlist URL is
  // removed rather than left for another renderer to re-arm.
  out = out.replace(BARE_URL, (whole: string) => {
    // Trailing sentence punctuation is not part of the URL.
    const trimmed = whole.replace(/[.,;:!?)\]]+$/, '');
    const suffix = whole.slice(trimmed.length);
    if (isSafeDestination(trimmed)) return whole;
    counts.links += 1;
    return REMOVED_MARKER + suffix;
  });

  out = out.replace(HTML_COMMENT, () => {
    counts.html += 1;
    return '';
  });
  // Fixpoint: removing an inner tag from `<scr<script>ipt>` must not leave a
  // freshly-formed one behind. Bounded so a pathological input cannot spin.
  for (let pass = 0; pass < 5; pass += 1) {
    const next = out.replace(HTML_TAG, () => {
      counts.html += 1;
      return '';
    });
    if (next === out) break;
    out = next;
  }

  return out;
}

/**
 * Splits a line into inline-code spans and prose. A span opened by N backticks
 * closes on the next run of exactly N backticks (CommonMark); an unclosed run
 * is literal text.
 */
function splitInlineCode(line: string): Array<{ code: boolean; text: string }> {
  const parts: Array<{ code: boolean; text: string }> = [];
  let buffer = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let run = 0;
      while (line[i + run] === '`') run += 1;
      const ticks = '`'.repeat(run);
      const close = line.indexOf(ticks, i + run);
      if (close !== -1 && line[close + run] !== '`') {
        if (buffer !== '') {
          parts.push({ code: false, text: buffer });
          buffer = '';
        }
        parts.push({ code: true, text: line.slice(i, close + run) });
        i = close + run;
        continue;
      }
    }
    buffer += line[i];
    i += 1;
  }
  if (buffer !== '') parts.push({ code: false, text: buffer });
  return parts;
}

/**
 * Strips beacon- and phishing-capable markdown from model output. Returns the
 * cleaned text plus what was removed, so the counts can be persisted as
 * evidence rather than silently dropped.
 */
export function sanitizeGeneratedMarkdown(markdown: string | null | undefined): MarkdownSanitizeResult {
  const counts: MarkdownSanitizeCounts = { images: 0, links: 0, html: 0, autolinks: 0 };
  const source = markdown ?? '';
  if (source === '') return { markdown: '', removed: counts, modified: false };

  const out: string[] = [];
  let inFence = false;
  for (const line of source.split('\n')) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    const definition = line.match(REFERENCE_DEFINITION);
    if (definition) {
      // A definition with an unsafe destination is dropped whole: keeping the
      // label would leave a live reference link pointing at it.
      if (isSafeDestination(definition[1]!)) out.push(line);
      else counts.links += 1;
      continue;
    }
    out.push(
      splitInlineCode(line)
        .map((part) => (part.code ? part.text : sanitizeProse(part.text, counts)))
        .join(''),
    );
  }

  const modified = counts.images + counts.links + counts.html + counts.autolinks > 0;
  return { markdown: out.join('\n'), removed: counts, modified };
}
