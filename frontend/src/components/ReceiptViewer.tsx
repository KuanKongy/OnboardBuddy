import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  FileCode2,
  Shield,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SourceReceipt } from "@/types/onboarding";

function confidenceBadgeClasses(c: string) {
  switch (c) {
    case "high":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "medium":
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    default:
      return "bg-red-500/10 text-red-400 border-red-500/30";
  }
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <Badge
      variant="outline"
      className={`text-xs border ${confidenceBadgeClasses(confidence)}`}
    >
      <Shield className="mr-1 h-2.5 w-2.5" />
      {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
    </Badge>
  );
}

interface ReceiptViewerProps {
  receipt: SourceReceipt;
  onClose: () => void;
}

export function ReceiptViewer({ receipt, onClose }: ReceiptViewerProps) {
  const lineRange =
    receipt.lineStart && receipt.lineEnd
      ? `${receipt.lineStart}–${receipt.lineEnd}`
      : receipt.lineStart
        ? `${receipt.lineStart}`
        : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-viewer-title"
    >
      <div
        className="w-full max-w-lg rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2
              id="receipt-viewer-title"
              className="flex items-center gap-2 text-[14px] font-semibold text-foreground"
            >
              <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{receipt.filePath}</span>
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              {receipt.symbolName && (
                <span className="flex items-center gap-1">
                  <Code2 className="h-3 w-3" />
                  {receipt.symbolName}
                </span>
              )}
              {lineRange && <span>Lines {lineRange}</span>}
            </div>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={onClose}
            aria-label="Close receipt viewer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Confidence & staleness badges */}
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge confidence={receipt.confidence} />
            {receipt.staleness === "stale" ? (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/5 text-xs text-amber-400"
              >
                <AlertTriangle className="mr-1 h-2.5 w-2.5" />
                Stale — source has changed
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-400"
              >
                <CheckCircle2 className="mr-1 h-2.5 w-2.5" />
                Current
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {receipt.ageLabel}
            </span>
          </div>

          {/* Code snippet */}
          {receipt.snippet && (
            <div className="rounded-md border bg-muted/30">
              <div className="border-b px-3 py-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Source Evidence
                </span>
              </div>
              <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-foreground">
                <code>{receipt.snippet}</code>
              </pre>
            </div>
          )}

          {/* Claim (what this receipt proves) */}
          {receipt.claim && (
            <div className="rounded-md border px-3 py-2.5">
              <p className="text-xs font-medium text-muted-foreground">
                This receipt supports:
              </p>
              <p className="mt-1 text-[13px] text-foreground">{receipt.claim}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {receipt.commitHash && (
              <span className="font-mono">
                commit: {receipt.commitHash.slice(0, 8)}
              </span>
            )}
            {receipt.nodeStableKey && (
              <span className="font-mono">key: {receipt.nodeStableKey}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
