/**
 * Render-time hardening for the app's markdown surfaces
 * (doc/SECURITY_XSS_PROMPT_INJECTION.md §5.2, findings X1/P2).
 *
 * `react-markdown` without `rehype-raw` already escapes raw HTML and strips
 * `javascript:`/`data:` URLs, so script execution is not the gap. What markdown
 * still renders freely is an external image — a zero-click GET from every
 * reader's browser, i.e. a tracking or exfiltration beacon — and an external
 * link, which is one click from a phishing page. On a product whose whole job
 * is to ingest untrusted third-party repos and render prose written from them,
 * those are the payloads worth having.
 *
 * The worker also sanitizes this text before storing it
 * (`backend/src/worker/generation/markdownSanitizer.ts`). This layer is not
 * redundant with that one:
 *   - rows written BEFORE the worker-side sanitizer existed are still in the
 *     database and still render through here;
 *   - the Q&A panel renders an answer that never passes through the section
 *     writer at all;
 *   - two independent layers is the point — either one failing is contained.
 *
 * The two policies are deliberately identical in effect, and a test asserts
 * they agree on the same payload table.
 */

/**
 * Elements the renderer will never emit.
 *
 * `img` is the live one: it is reachable from ordinary markdown (`![](url)`)
 * and is the beacon. The rest are unreachable today — without `rehype-raw`
 * there is no markdown syntax that produces them — and are listed so that
 * adding `rehype-raw` later cannot quietly open the door without also having
 * to delete a line that says why it is here.
 */
export const MARKDOWN_DISALLOWED_ELEMENTS = [
  "img",
  "iframe",
  "script",
  "style",
  "object",
  "embed",
  "form",
  "input",
];

/** Only github.com (and subdomains) may keep a live destination. */
const ALLOWED_LINK_HOST = /(?:^|\.)github\.com$/i;

/**
 * `urlTransform` for `<ReactMarkdown>`: returns the URL when it is safe to
 * render, and `""` (which react-markdown renders as no destination) otherwise.
 * Fails closed — anything unparseable is dropped.
 *
 * Must keep `#receipt:<id>` and `#unverified` working: those are this app's own
 * inline citation markers, rewritten into anchors by `renderReceiptMarkers`
 * and intercepted by the `a` component override.
 */
export function safeUrlTransform(url: string): string {
  const dest = (url ?? "").trim();
  if (dest === "") return "";
  // Control characters and spaces are how `java\tscript:` slips past a naive
  // scheme check; no legitimate destination contains them.
  if (/[\u0000-\u0020\u007f]/.test(dest)) return "";
  // In-page anchors, including our citation markers.
  if (dest.startsWith("#")) return dest;
  // Relative paths, but never protocol-relative `//evil.example`.
  if (/^\.{0,2}\//.test(dest) && !dest.startsWith("//")) return dest;
  try {
    const parsed = new URL(dest);
    return parsed.protocol === "https:" && ALLOWED_LINK_HOST.test(parsed.hostname) ? dest : "";
  } catch {
    return "";
  }
}
