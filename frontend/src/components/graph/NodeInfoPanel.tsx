import { AlertCircle, Check, Copy, ExternalLink, Info, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { NodeDetail } from "@/lib/graphData";
import { buildGithubBlobUrl, type GithubRepoRef } from "@/lib/githubUrl";
import { RANKING_EXPLANATION } from "@/lib/rankingCopy";
import { useOptionalProject } from "@/contexts/ProjectContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GraphNode } from "@/types/graph";

interface NodeInfoPanelProps {
  node: GraphNode;
  detail?: NodeDetail | null;
  /** True while a detail fetch is in flight — distinguishes "still loading"
   * from "no detail was ever fetched for this node type" or "the fetch
   * settled with nothing" so the panel doesn't show a spinner forever. */
  loading?: boolean;
  githubRepo?: GithubRepoRef;
  /** Deselects the node (also reachable via Esc / clicking empty canvas). */
  onClose?: () => void;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers/contexts without the async Clipboard API.
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Single-column detail panel following the standard symbol doc format
 * (doc/Pipeline.md): one-line summary, signature/params/returns, a real
 * call-site example, then importance and receipts.
 */
export function NodeInfoPanel({ node, detail, loading = false, githubRepo, onClose }: NodeInfoPanelProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const githubUrl = githubRepo ? buildGithubBlobUrl(githubRepo, detail?.file_path ?? node.id) : null;
  const projectId = useOptionalProject()?.project?.id ?? null;
  const doc = detail?.doc;

  async function handleCopyPath() {
    const ok = await copyToClipboard(node.id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 1500);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground" title={node.label}>
            {node.label}
          </p>
          <p className="truncate font-mono text-[0.6875rem] text-muted-foreground" title={node.id}>
            {node.id}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {githubUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="xs" asChild>
                  <a href={githubUrl} target="_blank" rel="noopener noreferrer" aria-label="Open on GitHub">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Open this file on GitHub</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="xs" onClick={handleCopyPath} aria-label="Copy path">
                {copyFailed ? (
                  <AlertCircle className="h-3 w-3 text-destructive" />
                ) : copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{copyFailed ? "Couldn't copy the path" : "Copy the file path"}</TooltipContent>
          </Tooltip>
          {onClose && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close details">
                  <X className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Close (Esc)</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* 1. One-line summary */}
        {doc?.summary && (
          <div>
            <p className="text-[0.8125rem] leading-relaxed text-foreground">{doc.summary}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-[0.65625rem] text-muted-foreground/70">
              {doc.factsOnly ? (
                "Deterministic facts only — no AI summary for this symbol"
              ) : (
                <>
                  <Sparkles className="h-2.5 w-2.5" /> AI summary ({doc.summaryConfidence} confidence), backed by the receipts below
                </>
              )}
            </p>
          </div>
        )}

        {/* 2-3. Signature, params, returns (deterministic) */}
        {doc?.signature && (
          <div>
            <p className="section-label mb-1">Signature</p>
            <pre className="overflow-x-auto rounded-md bg-muted px-2.5 py-2 text-[0.71875rem] leading-relaxed text-foreground">
              {doc.signature}
            </pre>
            {doc.returns && (
              <p className="mt-1 text-[0.71875rem] text-muted-foreground">
                Returns <code className="rounded bg-muted px-1 py-0.5 text-[0.6875rem]">{doc.returns}</code>
              </p>
            )}
          </div>
        )}

        {/* 4. Real example usage from a call site */}
        {doc?.exampleUsage && (
          <div>
            <p className="section-label mb-1">Example usage</p>
            <p className="mb-1 font-mono text-[0.6875rem] text-muted-foreground">
              called from {doc.exampleUsage.caller} · {doc.exampleUsage.filePath}
              {doc.exampleUsage.lineStart ? `:${doc.exampleUsage.lineStart}` : ""}
            </p>
            <pre className="max-h-40 overflow-auto rounded-md bg-muted px-2.5 py-2 text-[0.6875rem] leading-relaxed text-foreground">
              {doc.exampleUsage.snippet}
            </pre>
          </div>
        )}

        {/* Importance (ranking always shown with its reasons) */}
        {detail && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <p className="section-label">Importance</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex cursor-help text-muted-foreground/60 hover:text-muted-foreground">
                    <Info className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-left">{RANKING_EXPLANATION}</TooltipContent>
              </Tooltip>
              {projectId && (
                <Link
                  to={`/projects/${projectId}/settings`}
                  className="text-[0.65625rem] font-medium text-primary hover:underline"
                >
                  Adjust weights
                </Link>
              )}
            </div>
            {detail.composite_score === null ? (
              <p className="text-[0.71875rem] text-muted-foreground">Not ranked in this snapshot</p>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {Math.round(detail.composite_score * 100)}
                </span>
                <span className="text-[0.65625rem] text-muted-foreground">/ 100 critical-path score</span>
              </div>
            )}
            {detail.ranking_reasons.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {detail.ranking_reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-1.5">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-success" />
                    <span className="text-[0.71875rem] text-muted-foreground">{reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Deterministic relationships — every node has these, so the panel
            has substance even when no AI record exists for the symbol. */}
        {detail && ((detail.callers?.length ?? 0) > 0 || (detail.callees?.length ?? 0) > 0) && (
          <div>
            <Separator className="mb-3" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(detail.callers?.length ?? 0) > 0 && (
                <div>
                  <p className="section-label mb-1.5">
                    {detail.relation_labels?.inbound ?? "Used by"} ({detail.callers!.length})
                  </p>
                  <ul className="space-y-0.5">
                    {detail.callers!.map((c) => (
                      <li key={c.stable_key} className="truncate font-mono text-[0.6875rem] text-muted-foreground" title={c.file_path ?? undefined}>
                        {c.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(detail.callees?.length ?? 0) > 0 && (
                <div>
                  <p className="section-label mb-1.5">
                    {detail.relation_labels?.outbound ?? "Uses"} ({detail.callees!.length})
                  </p>
                  <ul className="space-y-0.5">
                    {detail.callees!.map((c) => (
                      <li key={c.stable_key} className="truncate font-mono text-[0.6875rem] text-muted-foreground" title={c.file_path ?? undefined}>
                        {c.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Side effects + owning cluster */}
        {detail && ((detail.side_effects?.length ?? 0) > 0 || detail.cluster) && (
          <div>
            <Separator className="mb-3" />
            {(detail.side_effects?.length ?? 0) > 0 && (
              <div className="mb-2">
                <p className="section-label mb-1.5">Side effects</p>
                <div className="flex flex-wrap gap-1">
                  {detail.side_effects!.map((se, i) => (
                    <Badge key={i} variant="outline" className="h-5 px-1.5 text-[0.625rem]" title={se.target ?? undefined}>
                      {se.type.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {detail.cluster && (
              <p className="text-[0.71875rem] text-muted-foreground">
                Part of the <span className="font-medium text-foreground">{detail.cluster.label}</span> component
                — see the Architecture tab.
              </p>
            )}
          </div>
        )}

        {/* Connected workflows */}
        {detail && detail.connected_workflows.length > 0 && (
          <div>
            <Separator className="mb-3" />
            <p className="section-label mb-1.5">Part of workflows</p>
            <ul className="space-y-1.5">
              {detail.connected_workflows.map((wf) => (
                <li key={wf.id} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--node-worker)" }} />
                  <span className="min-w-0 flex-1 truncate text-[0.75rem] text-foreground">{wf.title}</span>
                  <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-[0.5625rem]">
                    {wf.trigger_type}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 5. Receipts */}
        {doc && doc.receipts.length > 0 && (
          <div>
            <Separator className="mb-3" />
            <p className="section-label mb-1.5">Receipts</p>
            <ul className="space-y-1">
              {doc.receipts.map((r) => {
                const receiptUrl =
                  githubRepo && r.file_path
                    ? buildGithubBlobUrl(githubRepo, r.file_path, { lineStart: r.line_start, lineEnd: r.line_end })
                    : null;
                const label = (
                  <>
                    {r.file_path ?? r.receipt_kind}
                    {r.line_start ? `:${r.line_start}` : ""}
                  </>
                );
                return (
                  <li key={r.id} className="flex items-center gap-1.5 text-[0.6875rem]">
                    <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-[0.5625rem] uppercase">
                      {r.trust_level}
                    </Badge>
                    {receiptUrl ? (
                      <a
                        href={receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={r.file_path ?? undefined}
                        className="inline-flex min-w-0 flex-1 items-center gap-1 truncate font-mono text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <span className="min-w-0 truncate">{label}</span>
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={r.file_path ?? undefined}>
                        {label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!detail && loading && (
          <p className="text-[0.71875rem] text-muted-foreground">Loading details…</p>
        )}
        {!detail && !loading && (
          <p className="text-[0.71875rem] text-muted-foreground">No additional details available for this node.</p>
        )}
      </div>
    </div>
  );
}
