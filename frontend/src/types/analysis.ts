/** Shared analysis/run types — the API shapes behind /analysis-status,
 * /snapshots/:id/metrics, and /runs. Hoisted out of the components so the
 * package context, overview, and run panels all speak the same shapes. */

export interface StepLogEntry {
  step: string;
  pct: number;
  ts: string;
}

export interface AnalysisJob {
  id: string;
  job_type: string;
  status: string;
  progress_pct: number;
  current_step: string | null;
  snapshot_id: string | null;
  checkpoint: Record<string, unknown>;
  step_log: StepLogEntry[];
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** Worker liveness: stamped every ~15s while the run is genuinely alive. */
  last_heartbeat_at: string | null;
  /** Delivery attempt (>1 = the queue retried this run). */
  attempt: number;
  /** Running but silent for 2+ minutes — presumed dead until reconciled. */
  stalled: boolean;
  /** Per-run configuration as requested (null = project default). */
  requested_branch: string | null;
  requested_commit: string | null;
  requested_depth: string | null;
  requested_role: string | null;
  scope_path: string | null;
  file_count: number | null;
  symbol_count: number | null;
  workflow_count: number | null;
  commit_hash: string | null;
  branch: string | null;
}

export interface SnapshotSummary {
  id: string;
  file_count: number;
  symbol_count: number;
  workflow_count: number;
  commit_hash: string;
  branch: string;
  semantic_depth: string;
  created_at: string;
}

export interface AnalysisStatus {
  jobs: AnalysisJob[];
  latestSnapshot: SnapshotSummary | null;
}

export interface PhaseRow {
  phase: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  metrics: Record<string, unknown>;
}

export interface MetricsResponse {
  snapshot: { budget_usage?: Record<string, unknown> } & Record<string, unknown>;
  phases: PhaseRow[];
}

/** One row of GET /projects/:id/runs — a historical (or live) run with its
 * resolved config, per-job cost, and generated-vs-cached sections. */
export interface RunHistoryEntry {
  id: string;
  job_type: string;
  status: string;
  progress_pct: number;
  current_step: string | null;
  error_message: string | null;
  snapshot_id: string | null;
  /** regenerate_section runs: which section. */
  section_type: string | null;
  config: {
    branch: string | null;
    commit: string | null;
    scope_path: string | null;
    scope_name: string | null;
    depth: string | null;
    role: string | null;
  };
  requested_by_email: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  attempt: number;
  step_log: StepLogEntry[];
  package: { id: string; role: string; branch: string; status: string } | null;
  cost: {
    estimated_cost_usd: number;
    llm_calls: number;
    cached_calls: number;
    input_tokens: number;
    output_tokens: number;
  };
  /** The cap this run was measured against, plus lifetime totals for the
   * snapshot it wrote to. Budgets are enforced per run; the snapshot's
   * counters keep accumulating as the cost record. */
  budget: RunBudget;
  sections: { generated: string[]; cached: string[] };
}

export interface RunBudget {
  capLlmCalls: number;
  /** null on runs that predate per-run metering — see `note`. */
  usedThisRun: number | null;
  remaining: number | null;
  lifetimeLlmCalls: number;
  lifetimeCostUsd: number;
  note?: string;
}
