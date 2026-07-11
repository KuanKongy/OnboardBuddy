import { AlertTriangle, Loader2, Shield, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Scope {
  id: string;
  path_prefix: string;
  display_name: string;
  kind: string;
}

interface PreflightPreview {
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

interface AnalyzeDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after the analysis job is accepted, so callers can start polling. */
  onStarted: () => void;
}

/**
 * Analyze flow (doc/PLAN.md Phase 10): pick a scope (and optionally an exact
 * commit), run a preflight preview — file counts, LLM-call and cost
 * estimates, the privacy summary, size-cap confirmations — then confirm.
 */
export function AnalyzeDialog({ projectId, open, onOpenChange, onStarted }: AnalyzeDialogProps) {
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [scopeId, setScopeId] = useState<string>("whole");
  const [commit, setCommit] = useState("");
  const [preview, setPreview] = useState<PreflightPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError("");
    apiFetch(`/projects/${projectId}/scopes`)
      .then((data: { scopes: Scope[] }) => setScopes(data.scopes ?? []))
      .catch(() => setScopes([]));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open, projectId]);

  const commitValid = commit === "" || /^[0-9a-f]{7,40}$/i.test(commit.trim());

  async function runPreview() {
    setPreviewing(true);
    setPreview(null);
    setError("");
    try {
      const body: Record<string, string> = {};
      if (scopeId !== "whole") body.scope_id = scopeId;
      const res = await apiFetch(`/projects/${projectId}/preflight`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const jobId = res.preflight?.id;
      if (!jobId) throw new Error("Preflight did not start");
      // The preview lands on the job checkpoint once the worker finishes.
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        try {
          const status = await apiFetch(`/projects/${projectId}/analysis-status`);
          const job = (status.jobs as Array<{ id: string; status: string; checkpoint?: { preview?: PreflightPreview }; error_message?: string | null }>)
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

  async function startAnalysis() {
    setStarting(true);
    setError("");
    try {
      const body: Record<string, string> = {};
      if (scopeId !== "whole") body.scope_id = scopeId;
      if (commit.trim()) body.commit = commit.trim().toLowerCase();
      await apiFetch(`/projects/${projectId}/analyze`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onOpenChange(false);
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start analysis");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Analyze repository</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Scope</Label>
            <Select value={scopeId} onValueChange={(v) => { setScopeId(v); setPreview(null); }}>
              <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whole">Whole repository</SelectItem>
                {scopes.filter((s) => s.path_prefix !== "").map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.display_name} ({s.path_prefix})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Commit (optional)</Label>
            <Input
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              placeholder="branch head"
              className="h-8 font-mono text-[12px]"
              aria-invalid={!commitValid}
            />
            {!commitValid && <p className="text-[11px] text-danger">Must be a git SHA (7–40 hex characters)</p>}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>
        )}

        {previewing && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Building the analysis preview — scanning files and estimating cost…
          </div>
        )}

        {preview && (
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
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!preview && (
            <Button variant="outline" size="sm" onClick={runPreview} disabled={previewing}>
              {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Preview first
            </Button>
          )}
          <Button size="sm" onClick={startAnalysis} disabled={starting || !commitValid}>
            {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Start analysis
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
