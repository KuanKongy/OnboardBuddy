import { InlineReceiptRef } from "@/components/ReceiptChips";
import { UnverifiedSpan } from "@/components/reader/UnverifiedSpan";
import type { MarkdownComponents } from "@/components/reader/SectionMarkdown";
import { receiptForHref, receiptNumberById, UNVERIFIED_HREF } from "@/lib/receiptMarkers";
import type { SourceReceipt } from "@/types/onboarding";

/**
 * The one `a` override for generated prose: citation markers become inline
 * receipt refs, unverified spans get their marker, everything else is a
 * hardened external link.
 *
 * Shared because every surface that renders `renderReceiptMarkers` output —
 * package sections and Ask answers today — must handle the same three anchor
 * shapes; AskPanel once drifted a copy of this and silently lost the
 * unverified branch.
 */
export function receiptAnchor(
  receipts: SourceReceipt[],
  onReceiptClick: (r: SourceReceipt) => void,
): MarkdownComponents["a"] {
  return ({ href, children }) => {
    if (href === UNVERIFIED_HREF) return <UnverifiedSpan>{children}</UnverifiedSpan>;
    const cited = receiptForHref(href, receipts);
    if (cited) {
      const n = receiptNumberById(receipts).get(cited.bundleReceiptId ?? "") ?? 0;
      return <InlineReceiptRef receipt={cited} index={n} onClick={onReceiptClick} />;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  };
}
