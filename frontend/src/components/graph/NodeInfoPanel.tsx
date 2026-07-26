import { AlertCircle, Check, Copy, ExternalLink, Network, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { NodeDetail } from "@/lib/graphData";
import { buildGithubBlobUrl, type GithubRepoRef } from "@/lib/githubUrl";
import { ScoreProvenanceDisclosure } from "@/components/ScoreProvenance";
import { useOptionalProject } from "@/contexts/ProjectContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GraphNode } from "@/types/graph";

/** Tiers whose members can actually move the ranking weights. */
const CAN_ADJUST_WEIGHTS = new Set(["owner", "admin", "manager"]);

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
  /**
   * Set only for a class or interface, and only outside the Classes view.
   * Inheritance is a sibling view rather than a rung of this ladder — the
   * class graph is project-wide with no file scope, so nesting it under a
   * file would assert a containment that does not exist. The hand-off is
   * therefore an explicit switch, not a drill.
   */
  onSeeInheritance?: () => void;
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
 * One caller/callee.
 *
 * UX §17.6 measured this list rendering `page.tsx` six times with no directory
 * in a Next.js App Router repo — "six identical rows look like a rendering bug
 * and convey nothing. Show the parent path." For an import relation the path
 * IS the identity, so it is what the row prints; a symbol relation keeps the
 * symbol name and prints the file under it. Neither needs a tooltip any more
 * (owner H1): the disambiguator is on screen.
 */
function RelationItem({
  name,
  filePath,
  isFileRelation,
}: {
  name: string;
  filePath: string | null;
  isFileRelation: boolean;
}) {
  if (isFileRelation && filePath) {
    return <li className="truncate font-mono text-[0.6875rem] text-muted-foreground">{filePath}</li>;
  }
  return (
    <li className="min-w-0">
      <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">{name}</p>
      {filePath && (
        <p className="truncate font-mono text-[0.625rem] text-muted-foreground/60">{filePath}</p>
      )}
    </li>
  );
}

/**
 * Single-column detail panel following the standard symbol doc format
 * (doc/Pipeline.md): one-line summary, signature/params/returns, a real
 * call-site example, then importance and receipts.
 */
export function NodeInfoPanel({
  node,
  detail,
  loading = false,
  githubRepo,
  onClose,
  onSeeInheritance,
}: NodeInfoPanelProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const githubUrl = githubRepo ? buildGithubBlobUrl(githubRepo, detail?.file_path ?? node.id) : null;
  const project = useOptionalProject()?.project ?? null;
  const projectId = project?.id ?? null;
  // UX §9.3 / ledger E10: the link was rendered for every tier and landed on a
  // settings page whose sliders are disabled below manager — a dead end, on
  // three projects in the audit.
  const canAdjustWeights = CAN_ADJUST_WEIGHTS.has(project?.permission_tier ?? "");
  const doc = detail?.doc;
  const isFileRelation = detail?.relation_labels?.inbound === "Imported by";
  const inboundTotal = detail?.relation_totals?.inbound ?? detail?.callers?.length ?? 0;
  const outboundTotal = detail?.relation_totals?.outbound ?? detail?.callees?.length ?? 0;

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
        {/* Wrapped, not truncated-with-a-tooltip: owner H1 — a tooltip that
            reveals text the panel had room to print is the screen refusing to
            do its job. */}
        <div className="min-w-0">
          <p className="text-sm font-semibold break-words text-foreground">{node.label}</p>
          <p className="font-mono text-[0.6875rem] break-all text-muted-foreground">{node.id}</p>
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
        {onSeeInheritance && (
          <div>
            <Button variant="outline" size="xs" className="w-full justify-center" onClick={onSeeInheritance}>
              <Network className="mr-1 h-3 w-3" />
              See inheritance
            </Button>
            <p className="mt-1 text-[0.65625rem] leading-snug text-muted-foreground">
              Opens the project-wide class graph focused on {node.label}. It is a separate view, not a level
              inside this file — extends/implements relationships cross files.
            </p>
          </div>
        )}

        {/* 1. What this thing does. For a FILE this is the file record, which
            the endpoint never looked up before — owner E3: "The dependencies
            should also have explanation of what file does." */}
        {doc?.summary ? (
          <div>
            <p className="section-label mb-1">
              {isFileRelation ? "What this file does" : "What this does"}
            </p>
            <p className="text-[0.8125rem] leading-relaxed text-foreground">{doc.summary}</p>
            {doc.role && (
              <p className="mt-1 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                {doc.role}
              </p>
            )}
            {(doc.keySymbols?.length ?? 0) > 0 && (
              <p className="mt-1 text-[0.71875rem] text-muted-foreground">
                Key symbols:{" "}
                <span className="font-mono text-[0.6875rem]">{doc.keySymbols!.join(", ")}</span>
              </p>
            )}
            <p className="mt-1 inline-flex items-center gap-1 text-[0.65625rem] text-muted-foreground/70">
              {doc.factsOnly ? (
                "Deterministic facts only — no AI summary here"
              ) : (
                <>
                  <Sparkles className="h-2.5 w-2.5" /> AI summary ({doc.summaryConfidence} confidence), backed by the receipts below
                </>
              )}
            </p>
          </div>
        ) : (
          detail && (
            <p className="text-[0.71875rem] text-muted-foreground">
              No description was generated for this {isFileRelation ? "file" : "symbol"}. The
              relationships and score below are traced from the code and are always present.
            </p>
          )
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

        {/* Importance. The derivation used to sit open under every score, plus
            a hover ⓘ repeating it — owner B1 asked for one explicit control,
            owner J1 for the content to be staged behind it. */}
        {detail && (
          <ScoreProvenanceDisclosure
            data={detail.ranking_provenance}
            sectionLabel="Importance"
            buttonLabel="Explain how this importance score was derived"
            // VISUAL QA M4 #7: the payload's caveat is an internal
            // reconciliation note about the snapshot's top-500 score cap, not
            // something a reader of a file panel needs; the headline below
            // already says when a file is unranked and why.
            showCaveat={false}
            extra={
              projectId && canAdjustWeights ? (
                <Link
                  to={`/projects/${projectId}/settings`}
                  className="text-[0.65625rem] font-medium text-primary hover:underline"
                >
                  Adjust weights
                </Link>
              ) : undefined
            }
            headline={
              <>
                {detail.composite_score === null ? (
                  <p className="text-[0.71875rem] text-muted-foreground">Not ranked in this snapshot</p>
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-semibold tabular-nums text-foreground">
                      {Math.round(detail.composite_score * 100)}
                    </span>
                    <span className="text-[0.65625rem] text-muted-foreground">
                      / 100 critical-path score
                      {detail.ranking_scope === "file_fallback" &&
                        " — from this symbol's file (symbol not individually ranked)"}
                    </span>
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
              </>
            }
          />
        )}

        {/* Deterministic relationships — every node has these, so the panel
            has substance even when no AI record exists for the symbol. */}
        {detail && ((detail.callers?.length ?? 0) > 0 || (detail.callees?.length ?? 0) > 0) && (
          <div>
            <Separator className="mb-3" />
            {/* "(8)" used to be the LIMIT, printed as if it were the total,
                directly under a reason saying "Imported by 12 files"
                (UX §17.6). Both numbers are now on the heading. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(detail.callers?.length ?? 0) > 0 && (
                <div className="min-w-0">
                  <p className="section-label mb-1.5">
                    {detail.relation_labels?.inbound ?? "Used by"}{" "}
                    {inboundTotal > detail.callers!.length
                      ? `(${detail.callers!.length} of ${inboundTotal})`
                      : `(${inboundTotal})`}
                  </p>
                  <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                    {detail.callers!.map((c) => (
                      <RelationItem
                        key={c.stable_key}
                        name={c.name}
                        filePath={c.file_path}
                        isFileRelation={isFileRelation}
                      />
                    ))}
                  </ul>
                </div>
              )}
              {(detail.callees?.length ?? 0) > 0 && (
                <div className="min-w-0">
                  <p className="section-label mb-1.5">
                    {detail.relation_labels?.outbound ?? "Uses"}{" "}
                    {outboundTotal > detail.callees!.length
                      ? `(${detail.callees!.length} of ${outboundTotal})`
                      : `(${outboundTotal})`}
                  </p>
                  <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                    {detail.callees!.map((c) => (
                      <RelationItem
                        key={c.stable_key}
                        name={c.name}
                        filePath={c.file_path}
                        isFileRelation={isFileRelation}
                      />
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
                {/* The target ("POST /api/jobs") is printed, not hovered: it
                    is the only place in the panel that fact appears, so hiding
                    it behind a tooltip hid the content, not the chrome. */}
                <ul className="space-y-0.5">
                  {detail.side_effects!.map((se, i) => (
                    <li key={i} className="flex min-w-0 items-baseline gap-1.5">
                      <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[0.625rem]">
                        {se.type.replace(/_/g, " ")}
                      </Badge>
                      {se.target && (
                        <span className="min-w-0 break-all font-mono text-[0.65625rem] text-muted-foreground">
                          {se.target}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
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
                  // No tooltip: it repeated the path already printed on the row
                  // (owner H1). The row wraps instead, so the whole path is
                  // readable without hovering.
                  <li key={r.id} className="flex items-start gap-1.5 text-[0.6875rem]">
                    <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-[0.5625rem] uppercase">
                      {r.trust_level}
                    </Badge>
                    {receiptUrl ? (
                      <a
                        href={receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-w-0 flex-1 items-baseline gap-1 break-all font-mono text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <span className="min-w-0 break-all">{label}</span>
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 break-all font-mono text-muted-foreground">
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
