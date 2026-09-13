-- ============================================================
-- 002: Subscription tiers + per-user daily credit gate support
-- ============================================================
-- Adds a persisted per-user tier and the indexes the credit gate
-- (backend/src/api/services/creditGate.ts) reads on every analysis start.
-- RLS is intentionally NOT touched here: prod public tables already have RLS
-- enabled (managed in the Supabase dashboard), a new column inherits it, and
-- the service-role backend bypasses RLS, so these queries are unaffected.

-- Effective tier can also come from the DEV_TIER_EMAILS allowlist at runtime;
-- this column is the persisted fallback. 'blocked' is headroom for a future
-- abuse block switch (schema only).
alter table public.users
  add column if not exists tier varchar not null default 'free'
  check (tier in ('free', 'pro', 'max', 'dev', 'blocked'));

-- Daily spend rollup: SUM(estimated_cost_usd) over a user's runs since UTC
-- midnight, joined ai_generation_runs.job_id -> analysis_jobs.requested_by.
create index if not exists idx_analysis_jobs_requested_by_created
  on public.analysis_jobs (requested_by, created_at);

-- Concurrency check: COUNT of a user's queued/running jobs.
create index if not exists idx_analysis_jobs_requested_by_status
  on public.analysis_jobs (requested_by, status);

-- The join key for the daily spend rollup.
create index if not exists idx_ai_generation_runs_job
  on public.ai_generation_runs (job_id);
