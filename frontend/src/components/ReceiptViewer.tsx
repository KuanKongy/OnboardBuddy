import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileCode2,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeSnippet } from "@/components/CodeSnippet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOptionalProject } from "@/contexts/ProjectContext";
import { buildGithubBlobUrl } from "@/lib/githubUrl";
import type { SourceReceipt } from "@/types/onboarding";

function confidenceBadgeClasses(c: string) {
  switch (c) {
    case "high":
      return "border-success/40 bg-success-soft text-success";
    case "medium":
      return "border-warning/40 bg-warning-soft text-warning";
    default:
      return "border-danger/40 bg-danger-soft text-danger";
  }
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-help">
          <Badge
            variant="outline"
            className={`text-xs ${confidenceBadgeClasses(confidence)}`}
          >
            <Shield className="mr-1 h-2.5 w-2.5" />
            {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        How strongly this claim is backed by code evidence.
      </TooltipContent>
    </Tooltip>
  );
}

interface ReceiptViewerProps {
  receipt: SourceReceipt;
  onClose: () => void;
}

export function ReceiptViewer({ receipt, onClose }: ReceiptViewerProps) {
  const projectCtx = useOptionalProject();
  const project = projectCtx?.project;
  const lineRange =
    receipt.lineStart && receipt.lineEnd
      ? `${receipt.lineStart}–${receipt.lineEnd}`
      : receipt.lineStart
        ? `${receipt.lineStart}`
        : null;
  const githubUrl =
    project && receipt.filePath
      ? buildGithubBlobUrl(
          { owner: project.repo_owner, repo: project.repo_name, branch: project.branch },
          receipt.filePath,
          { ref: receipt.commitHash ?? undefined, lineStart: receipt.lineStart ?? null, lineEnd: receipt.lineEnd ?? null },
        )
      : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 pr-10 text-left">
          <DialogTitle className="flex items-center gap-2 text-[0.875rem] font-semibold text-foreground">
            <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono" title={receipt.filePath}>{receipt.filePath}</span>
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-2 text-[0.75rem] text-muted-foreground">
            {receipt.symbolName && (
              <span className="flex items-center gap-1">
                <Code2 className="h-3 w-3" />
                {receipt.symbolName}
              </span>
            )}
            {lineRange && <span>Lines {lineRange}</span>}
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          {/* Confidence & staleness badges */}
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge confidence={receipt.confidence} />
            {receipt.staleness === "stale" ? (
              <Badge
                variant="outline"
                className="border-warning/40 bg-warning-soft text-xs text-warning"
              >
                <AlertTriangle className="mr-1 h-2.5 w-2.5" />
                Stale — source has changed
              </Badge>
            ) : receipt.staleness === "fresh" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex cursor-help">
                    <Badge
                      variant="outline"
                      className="border-success/40 bg-success-soft text-xs text-success"
                    >
                      <CheckCircle2 className="mr-1 h-2.5 w-2.5" />
                      Current
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  Re-verified: this symbol's code is unchanged in the latest analysis.
                </TooltipContent>
              </Tooltip>
            ) : (
              // "unknown" — docs/synthesis evidence with no symbol hash to
              // re-check. Shown neutrally; never a green "Current" we can't back.
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Not re-verifiable
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {receipt.ageLabel}
            </span>
          </div>

          {/* What the cited symbol does — evidence should explain, not just show */}
          {receipt.summary && (
            <div className="rounded-md border px-3 py-2.5">
              <p className="text-xs font-medium text-muted-foreground">
                What this does
              </p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-foreground">{receipt.summary}</p>
            </div>
          )}

          {/* Code snippet — capped height so a long function never swallows
              the whole modal; line-numbered from the receipt's file range. */}
          {receipt.snippet && (
            <div className="rounded-md border bg-muted/30">
              <div className="border-b px-3 py-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Source Evidence
                </span>
              </div>
              <CodeSnippet
                code={receipt.snippet}
                startLine={receipt.lineStart ?? 1}
                maxHeightClass="max-h-[40vh]"
                className="rounded-none border-0 bg-transparent"
              />
            </div>
          )}

          {/* Claim (what this receipt proves) */}
          {receipt.claim && (
            <div className="rounded-md border px-3 py-2.5">
              <p className="text-xs font-medium text-muted-foreground">
                This receipt supports:
              </p>
              <p className="mt-1 text-[0.8125rem] text-foreground">{receipt.claim}</p>
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

        {githubUrl && (
          <div className="flex justify-end border-t px-5 py-3">
            <Button variant="outline" size="sm" asChild>
              <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                View on GitHub
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
