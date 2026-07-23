import { CornerDownLeft, HelpCircle, Loader2, MessageSquare } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ReceiptChip, InlineReceiptRef } from "@/components/ReceiptChips";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError } from "@/lib/api";
import { receiptForHref, receiptNumberById, renderReceiptMarkers } from "@/lib/receiptMarkers";
import type { AskAnswer, SourceReceipt } from "@/types/onboarding";
import { cn } from "@/lib/utils";

function confidenceStyle(c: string) {
  return c === "high"
    ? "border-success/40 bg-success-soft text-success"
    : c === "medium"
      ? "border-warning/40 bg-warning-soft text-warning"
      : "border-danger/40 bg-danger-soft text-danger";
}

/**
 * Grounded Q&A inside the reader (audit P2 §14): the same retrieval,
 * validation, and receipt machinery that builds sections, pointed at a
 * free-form question. Answers cite numbered receipts; unsupported parts
 * are stated as unknowns — never guessed.
 */
export function AskPanel({
  projectId,
  packageId,
  open,
  onClose,
  onReceiptClick,
}: {
  projectId: string;
  packageId?: string | null;
  open: boolean;
  onClose: () => void;
  onReceiptClick: (r: SourceReceipt) => void;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [asked, setAsked] = useState("");

  async function submit() {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      const data = (await apiFetch(`/projects/${projectId}/ask`, {
        method: "POST",
        body: JSON.stringify({ question: q, package_id: packageId ?? undefined }),
      })) as { answer: AskAnswer };
      setAnswer(data.answer);
      setAsked(q);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("AI is disabled for this project (privacy settings), so questions can't be answered.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("The analysis budget for this snapshot is exhausted — try again after raising it in Settings.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to get an answer");
      }
    } finally {
      setBusy(false);
    }
  }

  // Q&A receipts carry no staleness/summary — the viewer shows them as
  // point-in-time evidence ("Not re-verifiable" stays honest).
  const receipts: SourceReceipt[] =
    answer?.receipts.map((r) => ({
      bundleReceiptId: r.receiptId,
      filePath: r.filePath ?? "",
      lineStart: r.lineStart,
      lineEnd: r.lineEnd,
      symbolName: r.symbolName,
      snippet: r.snippet,
      trustLevel: r.trustLevel ?? null,
      staleness: "unknown",
    })) ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 pr-10 text-left">
          <DialogTitle className="flex items-center gap-2 text-[0.875rem] font-semibold">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            Ask about this codebase
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Answers come from the analyzed evidence with numbered receipts — gaps are stated, not guessed.
          </p>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-end gap-2">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder='e.g. "Where does an analyze request enter the worker?"'
              className="min-h-[60px] flex-1 text-[0.8125rem]"
              disabled={busy}
            />
            <Button size="sm" className="gap-1.5" onClick={() => void submit()} disabled={busy || question.trim().length < 3}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
              Ask
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {busy && (
            <p className="text-xs text-muted-foreground">
              Retrieving evidence and validating citations — usually 10–30 seconds…
            </p>
          )}

          {answer && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={asked}>
                  {asked}
                </span>
                <Badge variant="outline" className={cn("text-[0.6875rem] capitalize", confidenceStyle(answer.confidence))}>
                  {answer.confidence} confidence
                </Badge>
              </div>

              <div className="prose prose-sm dark:prose-invert max-w-none text-[0.84375rem] leading-relaxed text-muted-foreground prose-headings:text-foreground prose-headings:text-[0.84375rem] prose-headings:font-semibold prose-strong:text-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.75rem] prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-li:my-0.5 prose-p:my-1.5 prose-ul:my-1 prose-pre:max-h-72 prose-pre:overflow-auto">
                <ReactMarkdown
                  components={{
                    a: ({ href, children }) => {
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
                    },
                  }}
                >
                  {renderReceiptMarkers(answer.answerMarkdown, receipts)}
                </ReactMarkdown>
              </div>

              {receipts.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {receipts.map((r, i) => (
                    <ReceiptChip key={i} receipt={r} onClick={onReceiptClick} index={i + 1} />
                  ))}
                </div>
              )}

              {answer.unknowns.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
                  <p className="section-label mb-1.5 flex items-center gap-1.5">
                    <HelpCircle className="h-3 w-3" /> Not answerable from the evidence
                  </p>
                  <ul className="space-y-1">
                    {answer.unknowns.map((u, i) => (
                      <li key={i} className="text-[0.75rem] leading-relaxed text-muted-foreground">
                        {u.detail ?? u.kind.replace(/_/g, " ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
