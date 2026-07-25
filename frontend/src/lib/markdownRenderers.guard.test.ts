/**
 * Structural guard: every markdown renderer in the app must be hardened, and
 * no raw-HTML sink may be added without a deliberate decision
 * (doc/SECURITY_XSS_PROMPT_INJECTION.md §5.2, findings X1/X4).
 *
 * `markdownSafety.test.tsx` proves the policy is correct. This file proves the
 * policy is actually APPLIED everywhere — the failure mode a behavioural test
 * cannot see is someone adding a fourth `<ReactMarkdown>` next year and
 * forgetting the two props. Reading the source is the only way to catch that,
 * so this test reads the source.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// vitest's root is the frontend workspace, so cwd is the stable anchor here —
// `import.meta.url` is rewritten by the transform and does not resolve to a
// real path.
const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Block comments are removed before scanning. These modules DOCUMENT the
 * hardening — this repo's own policy file discusses `<ReactMarkdown>`,
 * `rehype-raw`, and `innerHTML` in prose — and a scan that counted prose would
 * be a scan that punishes writing things down. Only `/* … *\/` blocks are
 * stripped: line comments are left alone so a `//` inside a URL string cannot
 * eat the rest of a line of real code.
 */
function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

const FILES = sourceFiles(SRC).map((f) => {
  const text = readFileSync(f, "utf8");
  return { path: relative(SRC, f), text, code: stripBlockComments(text) };
});

/**
 * Index of the `>` that closes a JSX opening tag, ignoring any `>` nested
 * inside a `{…}` expression. Without the brace tracking, an arrow function or
 * a `<span>` inside a `components={{…}}` prop ends the scan early and the
 * check silently reads only part of the prop list.
 */
function openingTagEnd(chunk: string): number {
  let depth = 0;
  for (let i = 0; i < chunk.length; i += 1) {
    const ch = chunk[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return i;
  }
  return chunk.length;
}

describe("markdown renderer hardening is applied everywhere", () => {
  it("finds the renderers we know about (guards against the scan silently matching nothing)", () => {
    const withRenderer = FILES.filter((f) => f.code.includes("<ReactMarkdown"));
    // If this count changes, a renderer was added or removed — update it
    // deliberately, having checked the new one is hardened.
    expect(withRenderer.length).toBeGreaterThanOrEqual(2);
    const paths = withRenderer.map((f) => f.path).sort();
    expect(paths).toEqual(["components/AskPanel.tsx", "pages/OnboardingPage.tsx"]);
  });

  it("every <ReactMarkdown> passes urlTransform and disallowedElements", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      // Split on the opening tag; each chunk starts inside one element's props.
      const chunks = file.code.split("<ReactMarkdown").slice(1);
      chunks.forEach((chunk, i) => {
        const props = chunk.slice(0, openingTagEnd(chunk));
        if (!props.includes("urlTransform") || !props.includes("disallowedElements")) {
          offenders.push(`${file.path} (renderer #${i + 1})`);
        }
      });
    }
    expect(offenders, "unhardened markdown renderers").toEqual([]);
  });

  it("no rehype-raw / remark-html plugin is wired in — that would re-enable raw HTML", () => {
    // Matched on imports and the plugin props, not on any mention of the name:
    // this very policy module discusses `rehype-raw` in prose, and a test that
    // banned the string would be a test that punishes documentation.
    for (const file of FILES) {
      expect(file.code, `${file.path} imports a raw-HTML plugin`)
        .to.not.match(/from\s+["'](?:rehype-raw|remark-html)["']/);
      expect(file.code, `${file.path} passes rehype/remark plugins to a renderer`)
        .to.not.match(/\b(?:rehypePlugins|remarkPlugins)\s*=/);
    }
  });

  it("dangerouslySetInnerHTML is absent from the whole app", () => {
    const offenders = FILES.filter((f) => f.code.includes("dangerouslySetInnerHTML")).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the only innerHTML write is the mermaid renderer, and mermaid runs in strict mode", () => {
    const offenders = FILES.filter((f) => /\.innerHTML\s*=/.test(f.code)).map((f) => f.path);
    // Finding X4: this sink is safe because of mermaid's strict mode + bundled
    // DOMPurify, and is now also backstopped by script-src 'self'. If a second
    // sink appears here, it needs its own review.
    expect(offenders).toEqual(["components/MermaidDiagram.tsx"]);
    const mermaid = FILES.find((f) => f.path === "components/MermaidDiagram.tsx")!;
    expect(mermaid.code).to.include('securityLevel: "strict"');
  });
});

describe("no inline script in index.html (what lets the CSP stay script-src 'self')", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");

  it("has no <script> element with inline content", () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => (m[1] ?? "").trim())
      .filter((body) => body !== "");
    expect(inline, "inline scripts would require 'unsafe-inline' or a CSP hash").toEqual([]);
  });

  it("loads the theme bootstrap from a same-origin file instead", () => {
    expect(html).to.include('<script src="/bootstrap.js"></script>');
  });
});

describe("the nginx CSP keeps the properties the assessment depends on", () => {
  const conf = readFileSync(join(ROOT, "security-headers.conf"), "utf8");
  const nginx = readFileSync(join(ROOT, "nginx.conf"), "utf8");
  const csp = conf.match(/Content-Security-Policy\s+"([^"]+)"/)?.[1] ?? "";

  it("declares a CSP at all (finding X3 was that none existed)", () => {
    expect(csp).to.not.equal("");
  });

  it("script-src is 'self' with no unsafe-inline and no unsafe-eval", () => {
    const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1]?.trim();
    expect(scriptSrc).to.equal("'self'");
    expect(csp).to.not.include("unsafe-eval");
  });

  it("img-src is host-restricted — this is what stops the beacons (X1/X2)", () => {
    const imgSrc = csp.match(/img-src ([^;]+)/)?.[1]?.trim() ?? "";
    expect(imgSrc).to.include("'self'");
    expect(imgSrc).to.not.include("*");
    expect(imgSrc).to.not.match(/https:(?!\/\/)/, "a bare `https:` source would allow any host");
  });

  it("carries the rest of the header set", () => {
    for (const directive of ["frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'self'"]) {
      expect(csp, directive).to.include(directive);
    }
    for (const header of ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
      expect(conf, header).to.include(header);
    }
  });

  it("marks every header `always` so error responses carry them too", () => {
    const headerLines = conf.split("\n").filter((l) => l.trim().startsWith("add_header"));
    expect(headerLines.length).toBeGreaterThan(0);
    for (const line of headerLines) {
      expect(line.trim().endsWith("always;"), line.trim()).toBe(true);
    }
  });

  it("re-includes the headers in every location block", () => {
    // nginx REPLACES inherited add_header directives when a location declares
    // its own. A location that sets Cache-Control without re-including the
    // snippet would serve that path with no CSP at all — silently.
    const blocks = nginx.split(/location\s/).slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const body = block.slice(0, block.indexOf("}"));
      expect(body, `location ${block.slice(0, 24)}`).to.include("include /etc/nginx/security-headers.conf;");
    }
  });
});
