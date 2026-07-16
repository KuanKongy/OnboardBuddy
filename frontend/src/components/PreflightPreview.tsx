import { AlertTriangle, Shield } from "lucide-react";
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setPreview(null);
    setError("");
    setPreviewing(false);
  }

  async function run(body: Record<string, string>) {
    if (pollRef.current) clearInterval(pollRef.current);
    setPreviewing(true);
    setPreview(null);
    setError("");
    try {
      const res = await apiFetch(`/projects/${projectId}/preflight`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const jobId = res.preflight?.id;
      if (!jobId) throw new Error("Preflight did not start");
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        try {
          const status = await apiFetch(`/projects/${projectId}/analysis-status`);
          const job = (status.jobs as Array<{ id: string; status: string; checkpoint?: { preview?: PreflightPreviewData }; error_message?: string | null }>)
            .find((j) => j.id === jobId);
          if (job?.status === "complete" && job.checkpoint?.preview) {
            if (pollRef.current) clearInterval(pollRef.current);
            setPreview(job.checkpoint.preview);
            setPreviewing(false);
          } else if (job?.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setError(job.error_message || "Preview failed");
            setPreviewing(false);
          } else if (Date.now() - started > 180_000) {
            if (pollRef.current) clearInterval(pollRef.current);
            setError("Preview timed out — you can still start the analysis directly.");
            setPreviewing(false);
          }
        } catch { /* transient; keep polling */ }
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setPreviewing(false);
    }
  }

  return { preview, previewing, error, run, reset };
}

export function PreflightPreviewCard({ preview }: { preview: PreflightPreviewData }) {
  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-foreground">
        <span><strong>{preview.estimates.supportedFiles}</strong> analyzable files</span>
        <span>~<strong>{preview.estimates.symbols}</strong> symbols</span>
        {preview.privacy.llmCallsPlanned && (
          <span>~<strong>{preview.estimates.llmCalls}</strong> AI calls</span>
        )}
        <Badge variant="outline" className="text-[10px] uppercase">{preview.estimates.costTier} cost tier</Badge>
      </div>

      {preview.languageInventory.unsupportedFileCount > 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          {preview.languageInventory.unsupportedFileCount} files are in unsupported languages
          ({Object.keys(preview.languageInventory.unsupported).slice(0, 4).join(", ")}) and
          will be listed as a known gap, not analyzed.
        </p>
      )}

      <div className="flex items-start gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[11.5px] text-muted-foreground">
          Privacy: <span className="font-medium text-foreground">{preview.privacy.mode.replace(/_/g, " ")}</span>
          {" — "}
          {preview.privacy.codeSnippetsLeaveSystem
            ? "selected code snippets are sent to the AI provider."
            : preview.privacy.llmCallsPlanned
              ? "only extracted facts are sent — never code."
              : "nothing is sent anywhere; fully local analysis."}
        </p>
      </div>

      {[...preview.confirmationsRequired, ...preview.warnings].map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-[11.5px] text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
        </p>
      ))}
    </div>
  );
}
