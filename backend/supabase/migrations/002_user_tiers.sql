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

-- ── Anti-abuse signals ───────────────────────────────────────────────────────
-- Hashed device/browser/network signals, recorded on every credit check. These
-- do NOT change anyone's limits: limits stay strictly per-account. They feed a
-- DETECTOR (backend/src/api/services/creditGate.ts) that refuses free-tier
-- spend only when one device shows several freshly created accounts AND their
-- combined monthly spend is already a multiple of one free budget. The flag is
-- computed live from these rows at request time and never written back to
-- users.tier, so it decays on its own once the activity ages out.
--
-- Only the 'device' kind (the client's own random id) can influence a decision.
-- 'fp' and 'ip' are evidence for a human reading the table: a campus or an
-- office is one shared IP and a row of near-identical laptops, and punishing
-- that shape would be a false positive on honest users.
--
-- `on delete set null` is deliberate: deleting the account must not erase the
-- device's history, or the whole detector is defeated by delete-and-recreate.
-- The orphan rows keep no user-identifying data, only the hashes.
create table if not exists public.user_signals (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  kind varchar not null check (kind in ('device', 'fp', 'ip')),
  value_hash varchar not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  -- A named unique CONSTRAINT, not just an index: the recorder upserts with
  -- `on conflict (user_id, kind, value_hash) do update set last_seen = now()`,
  -- which needs a real constraint to target.
  constraint user_signals_user_kind_value_key unique (user_id, kind, value_hash)
);

-- The detector's read path: every account seen on one device inside the window.
create index if not exists idx_user_signals_kind_value_seen
  on public.user_signals (kind, value_hash, last_seen);

-- Prod public tables have RLS enabled and the service-role backend bypasses it;
-- enable it here too, with no policies, so a leaked anon key can never read
-- these hashes even if this table is created outside the dashboard.
alter table public.user_signals enable row level security;
