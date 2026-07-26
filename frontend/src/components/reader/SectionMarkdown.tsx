import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MARKDOWN_DISALLOWED_ELEMENTS, safeUrlTransform } from "@/lib/markdownSafety";

export type MarkdownComponents = Components;

/**
 * The reader's single hardened markdown renderer.
 *
 * GitHub-flavoured tables are the CONSULT chapter's whole payload — routes,
 * data model, env vars are generated as `| a | b |` tables — and CommonMark
 * alone renders them as literal pipe characters: the audit's "pipe soup"
 * (doc/READER_REDESIGN.md N1, live on all three audited repos). `remark-gfm`
 * is a syntax extension only: it introduces no raw-HTML path, so the two
 * hardening props (`urlTransform`, `disallowedElements`) and the write-time
 * sanitizer keep exactly the guarantees documented in
 * doc/SECURITY_XSS_PROMPT_INJECTION.md. The renderer-hardening guard test
 * pins this module as the ONLY place a remark plugin may be wired, and pins
 * the plugin list to exactly [remarkGfm].
 */
const REMARK_PLUGINS = [remarkGfm];

/**
 * Tables escape the prose measure onto a scrollable stage of their own: wide
 * reference tables scroll inside this container instead of stretching the
 * page (READER_REDESIGN.md §2 "prose column, artifact stage").
 */
const BASE_COMPONENTS: Components = {
  table: ({ children }) => (
    <div className="not-prose my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[0.8125rem]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60 text-left">{children}</thead>,
  th: ({ children }) => (
    <th className="whitespace-nowrap border-b border-border px-3 py-1.5 text-[0.71875rem] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border/60 px-3 py-1.5 align-top text-[0.8125rem] leading-relaxed text-foreground/90">
      {children}
    </td>
  ),
};

/**
 * All section prose (TL;DR callouts, block bodies, walkthrough notes) renders
 * through here so the safety props and the table treatment cannot drift apart
 * between call sites.
 */
export function SectionMarkdown({
  children,
  components,
}: {
  children: string;
  components?: Components;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      disallowedElements={MARKDOWN_DISALLOWED_ELEMENTS}
      urlTransform={safeUrlTransform}
      components={{ ...BASE_COMPONENTS, ...components }}
    >
      {children}
    </ReactMarkdown>
  );
}
