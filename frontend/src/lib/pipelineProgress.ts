/**
 * One combined pipeline bar shared by the project overview and the dashboard
 * project cards: analysis fills 0-70%, generation 70-100%, so the % never
 * restarts or jumps backwards when the generation job takes over from the
 * analysis job — and every surface shows the same number.
 */

export interface PipelineJobLite {
  job_type: string;
  status: string;
  progress_pct: number | null;
  current_step: string | null;
}

export interface PipelineProgress {
  /** 0-100 combined pipeline percentage. */
  pct: number;
  /** "analysis" | "generation" | "other" | null when no job. */
  stage: "analysis" | "generation" | "other" | null;
  /** Human stage label ("Analyzing code · …") while active, else null. */
  stageLabel: string | null;
  isActive: boolean;
}

const ANALYZE_TYPES = new Set(["analyze_scope", "incremental_update", "analyze_project"]);
const GENERATE_TYPES = new Set(["generate_package", "regenerate_section"]);

export function pipelineProgress(job: PipelineJobLite | null | undefined): PipelineProgress {
  if (!job) return { pct: 0, stage: null, stageLabel: null, isActive: false };

  const isActive = job.status === "queued" || job.status === "running";
  const stage = ANALYZE_TYPES.has(job.job_type)
    ? "analysis" as const
    : GENERATE_TYPES.has(job.job_type)
      ? "generation" as const
      : "other" as const;

  const raw = job.progress_pct ?? 0;
  const pct = !isActive
    ? (job.status === "complete" ? 100 : raw)
    : stage === "analysis"
      ? Math.round(raw * 0.7)
      : stage === "generation"
        ? 70 + Math.round(raw * 0.3)
        : raw;

  // " · " is a parsed separator, not decoration: ProjectCard splits on it to
  // take the stage word alone for its status chip. Change it here and you must
  // change the split there in the same edit, or the chip prints the sentence.
  const stageLabel = isActive
    ? stage === "analysis"
      ? `Analyzing code · ${job.current_step ?? "working…"}`
      : stage === "generation"
        ? `Generating onboarding · ${job.current_step ?? "working…"}`
        : job.current_step ?? "Processing…"
    : null;

  return { pct, stage, stageLabel, isActive };
}
