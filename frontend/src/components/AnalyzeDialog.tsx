import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api";
import {
  AnalyzeConfigForm,
  DEFAULT_ANALYZE_CONFIG,
  analyzeRequestBody,
  type AnalyzeConfig,
} from "@/components/AnalyzeConfigForm";
import { PreflightPreviewCard, usePreflight } from "@/components/PreflightPreview";
import type { ProjectData } from "@/contexts/ProjectContext";
import { PRIVACY_MODES } from "@/lib/privacyModes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface AnalyzeDialogProps {
  project: ProjectData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired with the accepted job's id, so callers can watch it to completion. */
  onStarted: (jobId: string) => void;
  /** Pre-selects the package role (e.g. regenerating a specific package at a new commit). */
  initialRole?: string;
}

/**
 * The one guarded analyze flow: configure the run (branch, commit, scope,
 * depth, role), optionally preflight it — file counts, LLM-call and cost
 * estimates, the privacy summary, size-cap confirmations — then explicitly
 * start. Every analyze entry point in the app goes through this dialog.
 */
export function AnalyzeDialog({ project, open, onOpenChange, onStarted, initialRole }: AnalyzeDialogProps) {
  const projectId = project.id;
  const [config, setConfig] = useState<AnalyzeConfig>(DEFAULT_ANALYZE_CONFIG);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const { preview, previewing, error: previewError, run: runPreflight, reset: resetPreflight } = usePreflight(projectId);

  useEffect(() => {
    if (!open) return;
    resetPreflight();
    setError("");
    setConflict(false);
    setConfirmed(false);
    setConfig({ ...DEFAULT_ANALYZE_CONFIG, role: initialRole ?? "" });
  }, [open, projectId, initialRole]);

  function updateConfig(next: AnalyzeConfig) {
    setConfig(next);
    // The preview describes one exact configuration; invalidate it on change.
    resetPreflight();
    // A tuple conflict is config-specific too — editing the config may
    // resolve it (different branch/commit/scope runs in parallel).
    setConflict(false);
    setConfirmed(false);
  }

  async function startAnalysis() {
    setStarting(true);
    setError("");
    setConflict(false);
    try {
      const data = (await apiFetch(`/projects/${projectId}/analyze`, {
        method: "POST",
        body: JSON.stringify(analyzeRequestBody(config)),
      })) as { analysis: { id: string } };
      onOpenChange(false);
      onStarted(data.analysis.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
      } else {
        setError(err instanceof Error ? err.message : "Failed to start analysis");
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Analyze {project.repo_owner}/{project.repo_name}
          </DialogTitle>
        </DialogHeader>

        <AnalyzeConfigForm
          projectId={projectId}
          repoOwner={project.repo_owner}
          repoName={project.repo_name}
          installationId={project.github_installation_id ?? ""}
          defaultBranch={project.branch}
          projectDepth={project.settings?.analysis_depth}
          projectRole={project.settings?.default_developer_role}
          config={config}
          onChange={updateConfig}
        />

        <div className="rounded-md border border-border">
          <button
            type="button"
            onClick={() => setPrivacyOpen((v) => !v)}
            aria-expanded={privacyOpen}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[0.71875rem] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", !privacyOpen && "-rotate-90")} />
            What gets sent to the AI?
          </button>
          {privacyOpen && (() => {
            const mode = PRIVACY_MODES.find((m) => m.key === (project.settings?.privacy_mode ?? "full_ai")) ?? PRIVACY_MODES[0]!;
            return (
              <div className="border-t border-border px-3 py-2 text-[0.71875rem] text-muted-foreground">
                <p>
                  This project's privacy mode: <span className="font-medium text-foreground">{mode.label}</span>
                </p>
                <p className="mt-0.5">{mode.hint}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  <Link to={`/projects/${projectId}/settings`} className="text-primary hover:underline">
                    Change in Project Settings
                  </Link>
                  <Link to="/help#privacy" className="text-primary hover:underline">
                    Learn more
                  </Link>
                </div>
              </div>
            );
          })()}
        </div>
        {conflict && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-foreground">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-warning" />
            <span>
              This exact scope and commit are already being analyzed — that run's progress
              is on the Project Overview. Change the branch, commit, or scope to start
              another run in parallel.
            </span>
          </div>
        )}
        {(error || previewError) && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
            <span>{error || previewError}</span>
            {previewError && (
              <Button
                size="xs"
                variant="outline"
                className="shrink-0 border-danger/50 text-danger hover:bg-danger-soft"
                onClick={() => runPreflight(analyzeRequestBody(config))}
              >
                Retry
              </Button>
            )}
          </div>
        )}

        {previewing && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
            Building the analysis preview — scanning files and estimating cost…
          </div>
        )}

        {preview && (
          <PreflightPreviewCard preview={preview} acknowledged={confirmed} onAcknowledgedChange={setConfirmed} />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!preview && (
            <Button variant="outline" size="sm" onClick={() => runPreflight(analyzeRequestBody(config))} disabled={previewing}>
              {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Preview first
            </Button>
          )}
          <Button
            size="sm"
            onClick={startAnalysis}
            disabled={starting || conflict || (preview !== null && preview.confirmationsRequired.length > 0 && !confirmed)}
          >
            {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Start analysis
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
