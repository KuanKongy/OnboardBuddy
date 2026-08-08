import { AlertTriangle, ShieldAlert, Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

export interface PreflightPreviewData {
  languageInventory: {
    supportedFileCount: number;
    unsupportedFileCount: number;
    unsupported: Record<string, number>;
  };
  privacy: {
    mode: string;
    codeSnippetsLeaveSystem: boolean;
    llmCallsPlanned: boolean;
    evidenceSentToLlm: string[];
  };
  estimates: {
    files: number;
    supportedFiles: number;
    symbols: number;
    symbolsSelectedForLlm: number;
    llmCalls: number;
    estimatedUsd: number;
    costTier: string;
  };
  depth: string;
  warnings: string[];
  confirmationsRequired: string[];
  limitations: string;
}

/**
 * Runs a preflight job for one analysis configuration and polls until its
 * preview (file counts, cost estimates, privacy summary) lands on the job
 * checkpoint. Shared by the Analyze dialog and the import wizard.
 */
export function usePreflight(projectId: string) {
  const [preview, setPreview] = useState<PreflightPreviewData | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<number | undefined>(undefined);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      window.clearInterval(pollRef.current);
    };
  }, []);

  function reset() {
    window.clearInterval(pollRef.current);
    setPreview(null);
    setError("");
    setPreviewing(false);
  }

  async function run(body: Record<string, string>) {
    window.clearInterval(pollRef.current);
    setPreviewing(true);
    setPreview(null);
    setError("");
    try {
      const res = await apiFetch(`/projects/${projectId}/preflight`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (cancelledRef.current) return;
      const jobId = res.preflight?.id;
      if (!jobId) throw new Error("Preflight did not start");
      const started = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await apiFetch(`/projects/${projectId}/analysis-status`);
          if (cancelledRef.current) return;
          const job = (status.jobs as Array<{ id: string; status: string; checkpoint?: { preview?: PreflightPreviewData }; error_message?: string | null }>)
            .find((j) => j.id === jobId);
          if (job?.status === "complete" && job.checkpoint?.preview) {
            window.clearInterval(pollRef.current);
            setPreview(job.checkpoint.preview);
            setPreviewing(false);
          } else if (job?.status === "failed") {
            window.clearInterval(pollRef.current);
            setError(job.error_message || "Preview failed");
            setPreviewing(false);
          } else if (Date.now() - started > 180_000) {
            window.clearInterval(pollRef.current);
            setError("Preview timed out. Retry, or start the analysis directly.");
            setPreviewing(false);
          }
        } catch {
          if (cancelledRef.current) {
            window.clearInterval(pollRef.current);
            return;
          }
          // A dead status endpoint must not poll silently forever with the
          // spinner up: apply the same deadline the success path enforces.
          if (Date.now() - started > 180_000) {
            window.clearInterval(pollRef.current);
            setError("Preview timed out. Retry, or start the analysis directly.");
            setPreviewing(false);
          }
        }
      }, 2500);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : "Preview failed");
      setPreviewing(false);
    }
  }

  return { preview, previewing, error, run, reset };
}

export function PreflightPreviewCard({
  preview,
  acknowledged,
  onAcknowledgedChange,
}: {
  preview: PreflightPreviewData;
  /** Whether the user has checked the confirmations-required acknowledgment. */
  acknowledged?: boolean;
  onAcknowledgedChange?: (v: boolean) => void;
}) {
  const unsupportedLangs = Object.keys(preview.languageInventory.unsupported);
  const shownLangs = unsupportedLangs.slice(0, 4);
  const remainingLangs = unsupportedLangs.length - shownLangs.length;
  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-foreground">
        <span><strong>{preview.estimates.supportedFiles}</strong> analyzable files</span>
        <span>~<strong>{preview.estimates.symbols}</strong> symbols</span>
        {preview.privacy.llmCallsPlanned && (
          <span>~<strong>{preview.estimates.llmCalls}</strong> AI calls</span>
        )}
        <Badge variant="outline" className="text-[0.625rem] uppercase">{preview.estimates.costTier} cost tier</Badge>
      </div>

      {preview.languageInventory.unsupportedFileCount > 0 && (
        <p className="text-[0.71875rem] text-muted-foreground">
          {preview.languageInventory.unsupportedFileCount} files are in unsupported languages
          ({shownLangs.join(", ")}{remainingLangs > 0 ? `, +${remainingLangs} more` : ""}) and
          will be listed as a known gap, not analyzed.
        </p>
      )}

      <div className="flex items-start gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[0.71875rem] text-muted-foreground">
          Privacy: <span className="font-medium text-foreground">{preview.privacy.mode.replace(/_/g, " ")}</span>
          {", "}
          {preview.privacy.codeSnippetsLeaveSystem
            ? "selected code snippets are sent to the AI provider."
            : preview.privacy.llmCallsPlanned
              ? "only extracted facts are sent, never code."
              : "nothing is sent anywhere; fully local analysis."}
        </p>
      </div>

      {preview.confirmationsRequired.length > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-[0.71875rem]">
          <input
            type="checkbox"
            checked={acknowledged ?? false}
            onChange={(e) => onAcknowledgedChange?.(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-destructive"
          />
          <span className="text-foreground">
            <span className="mb-1 flex items-center gap-1.5 font-medium text-destructive">
              <ShieldAlert className="h-3 w-3 shrink-0" /> Requires acknowledgment before starting
            </span>
            {preview.confirmationsRequired.map((w, i) => (
              <span key={i} className="block text-muted-foreground">{w}</span>
            ))}
          </span>
        </label>
      )}

      {preview.warnings.length > 0 && (
        <div className="space-y-1">
          {preview.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[0.71875rem] text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
