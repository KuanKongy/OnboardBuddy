-- 001_initial_schema.sql
-- Hybrid semantic pipeline schema (see doc/Pipeline.md for the full spec).
-- DESTRUCTIVE: intended for a clean database. Run 000_drop_all.sql first.
--
-- Kept from the previous schema: users/auth, github connections/installations,
-- projects, membership, invitations, settings (extended), analysis_jobs (extended).
-- Everything analysis-related is replaced by the scope-aware, symbol-level,
-- semantic-record model.
--
-- 2026-08-08: the M5 additive migrations (002 parsed_file_count comment,
-- 003 project_settings.auto_regenerate_stale, 004 invitation status
-- 'declined') are folded in — every live database already has them applied,
-- so a fresh standup is this one file.

-- ============================================================
-- Extensions
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- Users and Auth (unchanged)
-- ============================================================

create table if not exists public.users (
  id uuid primary key,
  email varchar not null,
  created_at timestamptz not null default now()
);

alter table public.users
  drop constraint if exists users_email_key;

create table if not exists public.github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  github_user_id integer not null,
  github_username varchar not null,
  access_token_encrypted text not null,
  access_token_expires_at timestamptz,
  refresh_token_encrypted text,
  refresh_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  installation_id text not null,
  account_login varchar not null,
  account_type varchar,
  app_id integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, installation_id)
);

-- Trigger: sync Supabase auth.users -> public.users on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Projects (a project = one GitHub repo connection)
-- ============================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  repo_owner varchar not null,
  repo_name varchar not null,
  -- Default branch for new analysis runs only; the branch actually analyzed
  -- lives on analysis_snapshots/analysis_jobs (a project is identified by repo).
  branch varchar not null,
  default_branch varchar,
  github_installation_id text,
  -- GitHub repo metadata for dashboard cards (fetched at import, refreshed on
  -- every analysis run; null until first fetched).
  repo_description text,
  primary_language varchar,
  repo_pushed_at timestamptz,
  repo_full_name varchar generated always as (repo_owner || '/' || repo_name) stored,
  status varchar not null default 'idle' check (status in ('idle', 'analyzing', 'complete', 'failed')),
  created_at timestamptz not null default now(),
  last_analyzed_at timestamptz,
  unique (user_id, repo_owner, repo_name)
);

-- ============================================================
-- Project Membership
-- ============================================================

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  permission_tier varchar not null check (permission_tier in ('owner', 'admin', 'developer')),
  developer_role varchar not null default 'general'
    check (developer_role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email varchar not null,
  permission_tier varchar not null default 'developer'
    check (permission_tier in ('owner', 'admin', 'developer')),
  developer_role varchar
    check (developer_role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  invited_by uuid not null references public.users(id) on delete restrict,
  accepted_by uuid references public.users(id) on delete set null,
  -- 'declined' = the invitee said no; distinct from an admin revoking (#72).
  status varchar not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired', 'declined')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  accepted_at timestamptz
);

-- ============================================================
-- Project Settings (extended for the hybrid pipeline)
-- ============================================================

create table if not exists public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  ignored_paths text[] not null default array['node_modules', 'dist', '.git', '.env'],
  default_developer_role varchar not null default 'general'
    check (default_developer_role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  file_limit integer not null default 5000 check (file_limit > 0),
  loc_limit integer not null default 250000 check (loc_limit > 0),
  -- Semantic depth for LLM analysis: which symbols get semantic records.
  analysis_depth varchar not null default 'standard'
    check (analysis_depth in ('cheap', 'standard', 'full')),
  -- What evidence may leave the system (see Pipeline.md "Privacy modes").
  privacy_mode varchar not null default 'full_ai'
    check (privacy_mode in ('full_ai', 'facts_only_ai', 'ai_disabled')),
  -- Overrides for the depth-based default budgets, e.g.
  -- {"max_llm_calls": 500, "max_input_tokens": 6000000, "max_files": 3000,
  --  "max_symbols_to_llm": 2500, "max_runtime_ms": 5400000}
  budget_overrides jsonb not null default '{}',
  budget_stop_behavior varchar not null default 'pause'
    check (budget_stop_behavior in ('fail', 'pause', 'degrade')),
  -- Per-tier model failure behavior, e.g.
  -- {"cheap": ["retry", "degrade"], "strong": ["retry", "pause"]}
  model_failure_behavior jsonb not null default '{}',
  -- Per-tier model list overrides, e.g.
  -- {"cheap": ["openai/gpt-4o-mini"], "strong": ["anthropic/claude-sonnet-4.5"]}
  model_tier_overrides jsonb not null default '{}',
  -- GitHub App push webhook: when true, a push to a branch that has
  -- onboarding packages triggers an incremental re-analysis per affected
  -- scope (stale-flags sections; never rebuilds packages). Requires the
  -- App webhook + GITHUB_WEBHOOK_SECRET to be configured (doc/DEVOPS.md).
  auto_reanalyze_on_push boolean not null default false,
  -- Opt-in: an incremental analysis that flags content stale immediately
  -- enqueues one only-stale generation per affected package. Off (default) =
  -- stale badges wait for a manual Regenerate. Opt-in because regeneration is
  -- LLM spend without a click.
  auto_regenerate_stale boolean not null default false
);

comment on column public.project_settings.auto_regenerate_stale is
  'When true, an incremental analysis that flags artifacts stale immediately enqueues one only-stale package generation per affected package (checkpoint.onlyStale). False (default) = stale content is flagged and waits for a manual Regenerate. Costs LLM calls without a click, which is why it is opt-in.';

-- Per-project LLM API key override (BYO key). Encrypted with the same
-- pattern as GitHub tokens. Editable by owner/admin only (enforced in API);
-- teammates may see provider/model/usage but never the key value.
-- org_id is a nullable forward-compatibility scope for org-level keys.
create table if not exists public.project_llm_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  org_id uuid,
  provider varchar not null default 'openrouter',
  api_key_encrypted text not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider)
);

-- Per-role ranking weight configs over the criticality views.
-- A row exists only when a project customizes a role; absence = code defaults.
-- weights maps view name -> weight, e.g. {"critical_for_runtime": 0.2, ...}
create table if not exists public.ranking_weight_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  role varchar not null check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  weights jsonb not null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, role)
);

-- ============================================================
-- Analysis Scopes
-- ============================================================

-- A scope is the ingestion boundary: whole repo ('' prefix) or a directory /
-- workspace package / docker service. Snapshots, graphs, and packages hang
-- off a scope; imports crossing the boundary become 'external' graph nodes.
create table if not exists public.analysis_scopes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  path_prefix varchar not null default '',
  display_name varchar not null,
  kind varchar not null default 'whole_repo'
    check (kind in ('whole_repo', 'workspace_package', 'docker_service', 'directory', 'manual')),
  -- How the scope proposal found it: 'package_json_workspaces', 'docker_compose',
  -- 'top_level_dir', 'deploy_config', 'user_manual', ...
  detected_from varchar,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path_prefix)
);

-- ============================================================
-- Snapshots and Jobs
-- ============================================================

-- A snapshot = one analysis of (project, scope, commit).
create table if not exists public.analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scope_id uuid not null references public.analysis_scopes(id) on delete cascade,
  commit_hash varchar not null,
  branch varchar not null,
  trigger_type varchar not null default 'manual'
    check (trigger_type in ('manual', 'initial', 'incremental', 'regeneration')),
  status varchar not null default 'pending'
    check (status in ('pending', 'running', 'paused', 'complete', 'failed')),
  -- Depth and privacy mode actually used for this run (copied from settings).
  semantic_depth varchar not null default 'standard'
    check (semantic_depth in ('cheap', 'standard', 'full')),
  privacy_mode varchar not null default 'full_ai'
    check (privacy_mode in ('full_ai', 'facts_only_ai', 'ai_disabled')),
  -- Every file in scope, including assets/docs/lockfiles. NOT a coverage
  -- number — see parsed_file_count below.
  file_count integer not null default 0,
  -- Files the AST parser actually read. This is the honest coverage figure.
  parsed_file_count integer,
  symbol_count integer not null default 0,
  workflow_count integer not null default 0,
  -- Language guardrail output (honest unknowns): supported/unsupported files
  -- per language, e.g. {"supported": {"typescript": 120}, "unsupported": {"go": 40},
  -- "supportedFileCount": 130, "unsupportedFileCount": 45}
  language_inventory jsonb not null default '{}',
  -- Budget counters, updated by the worker as the run progresses:
  -- {"llm_calls": 0, "input_tokens": 0, "output_tokens": 0,
  --  "estimated_cost_usd": 0, "runtime_ms": 0, "files_ingested": 0,
  --  "symbols_sent_to_llm": 0, "budget_events": []}
  budget_usage jsonb not null default '{}',
  -- Snapshot-level honest unknowns, e.g.
  -- [{"kind": "unsupported_language", "detail": "..."}, {"kind": "no_workflows_found"}]
  unknowns jsonb not null default '[]',
  duration_ms integer,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (scope_id, commit_hash)
);

comment on column public.analysis_snapshots.parsed_file_count is
  'Files the AST parser actually produced a FileAnalysis for (snapshot.fileAnalyses.length). NULL for snapshots taken before this column existed. Distinct from file_count (all files in scope) and language_inventory.supportedFileCount (files a parser could read).';

-- Per-phase status, metrics, and resume checkpoints (idempotency and resume).
create table if not exists public.snapshot_phases (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  phase varchar not null check (phase in (
    'preflight', 'ingest', 'parse', 'graph', 'workflows', 'candidate_ranking',
    'clustering', 'semantic_symbols', 'synthesis', 'capabilities', 'refinement',
    'critique', 'semantic_ranking', 'embeddings', 'generation', 'validation',
    'incremental_diff'
  )),
  status varchar not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'failed', 'paused', 'skipped')),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  -- Observability counters for this phase (files parsed, nodes/edges written,
  -- llm calls/tokens per model, cache hit rate, citation pass/fail, ...).
  metrics jsonb not null default '{}',
  -- Resume cursor (last completed batch / target list position).
  checkpoint jsonb not null default '{}',
  unique (snapshot_id, phase)
);

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scope_id uuid references public.analysis_scopes(id) on delete set null,
  snapshot_id uuid references public.analysis_snapshots(id) on delete set null,
  requested_by uuid not null references public.users(id) on delete restrict,
  job_type varchar not null
    check (job_type in (
      'preflight', 'analyze_scope', 'generate_package', 'regenerate_section', 'incremental_update'
    )),
  role varchar check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  -- Per-run configuration (null = project default). Branch/commit identify what
  -- gets fetched; semantic_depth overrides project_settings.analysis_depth.
  branch varchar,
  commit_hash varchar,
  semantic_depth varchar check (semantic_depth in ('cheap', 'standard', 'full')),
  status varchar not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'complete', 'failed')),
  progress_pct integer not null default 0 check (progress_pct between 0 and 100),
  current_step varchar,
  checkpoint jsonb not null default '{}',
  step_log jsonb not null default '[]',
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- Worker liveness: stamped every ~15s while a run is genuinely alive. A
  -- 'running' job silent for minutes is presumed dead and gets reconciled.
  last_heartbeat_at timestamptz,
  -- Delivery attempt (>1 = the queue retried this run after an interruption).
  attempt integer not null default 1
);

-- ============================================================
-- Repository Files
-- ============================================================

create table if not exists public.repository_files (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  stable_key varchar not null,          -- scope-relative-free repo path (repo-local)
  file_path varchar not null,
  language varchar not null,            -- 'typescript' | 'javascript' | 'json' | 'markdown' | ...
  category varchar not null default 'other'
    check (category in ('source', 'test', 'config', 'schema', 'migration', 'doc', 'script', 'asset', 'other')),
  supported boolean not null default true,  -- language guardrail output
  trust_level varchar not null default 'code'
    check (trust_level in ('code', 'config', 'tests', 'docs')),
  size_bytes integer not null,
  line_count integer,
  hash varchar not null,
  -- extension, isTest, package, pathSegments, churn: {commitCount90d, lastTouchedAt, authors}
  metadata jsonb not null default '{}',
  unique (snapshot_id, stable_key)
);

-- ============================================================
-- Code Evidence Graph (symbol-level)
-- ============================================================

create table if not exists public.graph_nodes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  stable_key varchar not null,
  type varchar not null check (type in (
    'file', 'module', 'function', 'method', 'class', 'interface', 'type',
    'enum', 'variable', 'entrypoint', 'schema', 'test', 'config', 'doc', 'external'
  )),
  name varchar not null,
  file_path varchar,                    -- null for 'external' nodes
  line_start integer,
  line_end integer,
  hash varchar,                         -- combined identity hash; null for 'external'
  signature_hash varchar,
  body_hash varchar,
  trust_level varchar not null default 'code'
    check (trust_level in ('code', 'config', 'tests', 'docs', 'llm_inference')),
  exported boolean not null default false,
  -- Capped code snippet for prompts/receipts (stripped in facts_only_ai mode).
  snippet text,
  -- signature, params, returnType, behaviorSignals, purposeSignals, jsdoc, ...
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.graph_edges (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  source_node_id uuid not null references public.graph_nodes(id) on delete cascade,
  target_node_id uuid not null references public.graph_nodes(id) on delete cascade,
  type varchar not null check (type in (
    'imports', 'exports', 'calls', 'extends', 'implements', 'contains',
    'registers_callback', 'handles_route', 'touches_schema',
    'reads_env', 'queries_database', 'writes_database',
    'enqueues_job', 'handles_job', 'http_calls',
    'tests', 'documents', 'depends_on', 'references_external'
  )),
  confidence varchar not null default 'high' check (confidence in ('high', 'medium', 'low')),
  -- detectedFrom, expression (the detection expression shown in edge receipts)
  metadata jsonb not null default '{}'::jsonb
);

-- ============================================================
-- Entrypoints and Side Effects
-- ============================================================

create table if not exists public.entrypoints (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  node_id uuid not null references public.graph_nodes(id) on delete cascade,
  trigger_type varchar not null check (trigger_type in (
    'http_route', 'ui_route', 'event_listener', 'worker_job',
    'scheduled_job', 'serverless_handler', 'cli', 'package_export'
  )),
  method varchar,
  route_path varchar,
  runtime varchar,
  role_relevance jsonb not null default '{}',
  confidence varchar not null default 'high' check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.side_effects (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  node_id uuid not null references public.graph_nodes(id) on delete cascade,
  type varchar not null check (type in (
    'database_read', 'database_write', 'http_request', 'queue_enqueue',
    'queue_consume', 'filesystem_read', 'filesystem_write',
    'auth_check', 'env_read', 'response_output', 'external_integration'
  )),
  target varchar,
  confidence varchar not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  evidence text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Workflows
-- ============================================================

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  stable_key varchar not null,
  title varchar not null,
  trigger_type varchar not null,
  purpose varchar not null,
  entrypoint_id uuid references public.entrypoints(id) on delete set null,
  confidence varchar not null default 'low' check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}'::jsonb,
  unique (snapshot_id, stable_key)
);

create table if not exists public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  step_order integer not null,
  node_id uuid references public.graph_nodes(id) on delete set null,
  file_path varchar not null,
  symbol_name varchar,
  line_start integer,
  line_end integer,
  step_kind varchar check (step_kind in (
    'trigger', 'auth_guard', 'validation', 'data_read', 'data_write',
    'async_work', 'side_effect', 'transform', 'response'
  )),
  deterministic_description text,
  explanation text,
  role_relevance jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}',
  unique (workflow_id, step_order)
);

-- ============================================================
-- Criticality Scores (two-phase, multi-view)
-- ============================================================

-- Rankings are scored artifacts, not one list.
-- phase='candidate': deterministic Phase A scores (view='candidate'),
--   computed before the semantic pass; drives depth gating.
-- phase='semantic': Phase B multi-view scores after synthesis.
-- Critical 25%, tutorial selection, and learning paths are projections over
-- these rows using ranking_weight_configs; raw scores are never overwritten.
create table if not exists public.criticality_scores (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  phase varchar not null check (phase in ('candidate', 'semantic')),
  view varchar not null check (view in (
    'candidate',
    'critical_for_runtime', 'critical_for_business', 'critical_for_onboarding',
    'critical_for_role', 'critical_for_change_risk', 'critical_for_architecture',
    'critical_for_workflow'
  )),
  target_type varchar not null check (target_type in (
    'symbol', 'file', 'module', 'workflow', 'schema', 'config', 'test', 'cluster', 'capability'
  )),
  target_node_id uuid references public.graph_nodes(id) on delete cascade,
  target_id uuid,                        -- workflow/cluster/capability id when not a node
  stable_key varchar not null,
  role varchar check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  score numeric(7, 5) not null default 0,
  score_breakdown jsonb not null default '{}',
  reasons text[] not null default '{}',
  receipt_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Architecture Map
-- ============================================================

create table if not exists public.architecture_clusters (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  stable_key varchar not null,
  label varchar not null,
  kind varchar not null check (kind in (
    'frontend_ui', 'frontend_state', 'api_layer', 'auth_layer',
    'database_layer', 'worker_layer', 'analysis_engine',
    'integration_layer', 'devops_layer', 'test_layer', 'shared_module', 'other'
  )),
  critical_score numeric(7, 5) not null default 0,
  deterministic_summary text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (snapshot_id, stable_key)
);

create table if not exists public.architecture_cluster_members (
  cluster_id uuid not null references public.architecture_clusters(id) on delete cascade,
  node_id uuid not null references public.graph_nodes(id) on delete cascade,
  membership_reason text not null default '',
  primary key (cluster_id, node_id)
);

create table if not exists public.architecture_edges (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  source_cluster_id uuid not null references public.architecture_clusters(id) on delete cascade,
  target_cluster_id uuid not null references public.architecture_clusters(id) on delete cascade,
  type varchar not null check (type in (
    'imports', 'calls', 'sends_request', 'enqueues_job', 'reads_writes_data', 'uses_config', 'tests'
  )),
  weight numeric(7, 3) not null default 1,
  evidence_edge_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Semantic Records (content-addressed, shared across scopes/snapshots)
-- ============================================================

-- One structured semantic record per target per canonical content-address key:
--   project_id + stable_key + evidence_hash + prompt_version + semantic_depth + model_family
-- project_id acts as the repo id (a project IS one repo connection; stable
-- keys are repo-local). Records are NOT snapshot-scoped: unchanged symbols are
-- never re-summarized across snapshots or overlapping scopes. Old records are
-- kept for audit when prompt/model versions change; never silently reused.
create table if not exists public.semantic_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stable_key varchar not null,
  record_level varchar not null check (record_level in (
    'symbol', 'file', 'module', 'service', 'system', 'workflow', 'capability', 'cluster'
  )),
  semantic_depth varchar not null check (semantic_depth in ('cheap', 'standard', 'full')),
  evidence_hash text not null,
  prompt_version text not null,
  model_family text not null,           -- e.g. 'gpt-4o-mini'; exact model in `model`
  -- Fixed-schema structured record (see Pipeline.md "Semantic record schema"):
  -- purpose, behavior, responsibilities[], business_concepts[], side_effects[],
  -- inputs_outputs, dependencies_narrative, design_patterns[], risks_invariants[]
  -- plus level-specific fields.
  record jsonb not null,
  summary text not null,                -- rendered display summary
  confidence varchar not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  facts_only boolean not null default false,  -- trivial symbol: deterministic facts, no LLM call
  status varchar not null default 'pending'
    check (status in ('pending', 'usable', 'rejected', 'superseded')),
  -- Honest-unknown / conflict flags, e.g.
  -- [{"kind": "docs_conflict_with_code", "detail": "...", "receiptIds": [...]}]
  flags jsonb not null default '[]',
  child_record_ids uuid[] not null default '{}', -- hierarchy links (synthesis inputs)
  receipt_ids uuid[] not null default '{}',
  model text,
  token_usage jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (project_id, stable_key, evidence_hash, prompt_version, semantic_depth, model_family)
);

-- Maps which record is active for which target in a given snapshot
-- (records are shared; this join makes per-snapshot retrieval possible).
create table if not exists public.snapshot_semantic_records (
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  record_id uuid not null references public.semantic_records(id) on delete cascade,
  node_id uuid references public.graph_nodes(id) on delete set null,
  stable_key varchar not null,
  record_level varchar not null,
  primary key (snapshot_id, record_id)
);

-- ============================================================
-- Capabilities (business capabilities extracted during synthesis)
-- ============================================================

create table if not exists public.capabilities (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  stable_key varchar not null,
  name varchar not null,
  description text not null default '',
  record_id uuid references public.semantic_records(id) on delete set null,
  confidence varchar not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (snapshot_id, stable_key)
);

create table if not exists public.capability_members (
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  member_type varchar not null check (member_type in ('workflow', 'cluster', 'node')),
  member_id uuid not null,
  stable_key varchar not null default '',
  membership_reason text not null default '',
  primary key (capability_id, member_type, member_id)
);

-- ============================================================
-- Multi-view Embeddings
-- ============================================================

-- Embedding text is rendered deterministically from record fields per view.
create table if not exists public.embeddings (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.semantic_records(id) on delete cascade,
  view_type varchar not null check (view_type in ('purpose', 'domain', 'dependency', 'operations')),
  content text not null,
  embedding vector(1536),
  provider text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (record_id, view_type, model)
);

-- ============================================================
-- Onboarding Packages (scope + role + commit + branch)
-- ============================================================

create table if not exists public.onboarding_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scope_id uuid not null references public.analysis_scopes(id) on delete cascade,
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  role varchar not null check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  status varchar not null default 'generating'
    check (status in ('generating', 'draft', 'approved', 'stale', 'failed')),
  generated_by uuid not null references public.users(id) on delete restrict,
  analyzed_commit varchar not null,
  -- Branch is part of PACKAGE identity (what users pick and generate per
  -- branch), while snapshots stay content-addressed at (scope, commit) — the
  -- same SHA on two branches shares one analysis but gets one package each.
  branch text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_packages_identity_key
    unique (project_id, scope_id, role, analyzed_commit, branch)
);

-- Per-member default package (the sidebar selection default; a finished
-- generation sets the requester's default to the new package). NULL = "latest
-- complete" behavior. Added post-hoc because project_members is created
-- before onboarding_packages.
alter table public.project_members
  add column if not exists default_package_id uuid
  references public.onboarding_packages(id) on delete set null;

-- ============================================================
-- AI Generation Audit Trail
-- ============================================================

create table if not exists public.ai_generation_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  package_id uuid references public.onboarding_packages(id) on delete cascade,
  -- The analysis_jobs row this call ran under (per-job cost rollups). NULL
  -- for calls with no job context (e.g. /ask Q&A) and pre-migration rows.
  job_id uuid references public.analysis_jobs(id) on delete set null,
  -- 'symbol_record', 'file_record', 'module_record', 'service_record',
  -- 'system_record', 'capability_record', 'workflow_record', 'refinement',
  -- 'critique', 'rerank', 'section', 'tutorial', 'qa_answer', 'embedding_batch'
  target_type varchar not null,
  target_id uuid,
  section_type varchar,
  provider text not null,
  model text not null,
  model_tier varchar check (model_tier in ('cheap', 'strong', 'embedding')),
  key_source varchar not null default 'server' check (key_source in ('server', 'project')),
  prompt_version text not null,
  input_hash text not null,
  output_hash text,
  token_usage jsonb not null default '{}',
  estimated_cost_usd numeric(10, 6),
  latency_ms integer,
  status varchar not null check (status in ('running', 'complete', 'failed', 'skipped_cached')),
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ============================================================
-- Package Sections
-- ============================================================

create table if not exists public.package_sections (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.onboarding_packages(id) on delete cascade,
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  generation_run_id uuid references public.ai_generation_runs(id) on delete set null,
  type varchar not null
    check (type in (
      -- Diátaxis redesign (doc/ONBOARDING_QUALITY_LATENCY_PLAN.md), 4 chapters:
      -- ORIENT (explanation)
      'big_picture', 'concepts',
      -- UNDERSTAND (explanation + annotated reference)
      'architecture_deep', 'traced_flows', 'code_map', 'capabilities',
      -- DO (tutorial / how-to)
      'setup_run', 'first_change', 'common_tasks',
      -- CONSULT (reference: deterministic tables + LLM annotations)
      'routes_jobs', 'data_model', 'guardrails_ops',
      -- Legacy ids, kept valid during the spec transition so the current
      -- generators still insert; drop this row block once the redesigned
      -- specs ship and the old specs are deleted.
      'start_here', 'architecture', 'entry_points', 'critical_25', 'capability_map',
      'role_path', 'workflow_guide', 'data_schema', 'safety_rails',
      'dependency_graph', 'doc_health'
    )),
  title varchar not null,
  content text not null default '',
  -- Embedded Mermaid diagrams: [{"kind": "architecture", "mermaid": "..."}]
  diagrams jsonb not null default '[]',
  confidence varchar not null default 'low' check (confidence in ('high', 'medium', 'low')),
  review_status varchar not null default 'draft'
    check (review_status in ('draft', 'approved', 'edited', 'stale', 'regenerate_requested')),
  analyzed_commit varchar not null,
  role varchar check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  -- First-class honest unknowns for this section, e.g.
  -- [{"kind": "no_workflow_found"}, {"kind": "low_confidence", "claim": "..."}]
  unknowns jsonb not null default '[]',
  generation_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null
);

-- ============================================================
-- Tutorials (request-flow walkthroughs with diagrams)
-- ============================================================

create table if not exists public.tutorials (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  package_id uuid references public.onboarding_packages(id) on delete cascade,
  workflow_id uuid references public.workflows(id) on delete set null,
  generation_run_id uuid references public.ai_generation_runs(id) on delete set null,
  stable_key varchar not null,
  title varchar not null,
  summary text not null default '',
  diagram_kind varchar not null default 'sequence' check (diagram_kind in ('sequence', 'dataflow')),
  diagram_mermaid text,
  status varchar not null default 'draft'
    check (status in ('draft', 'approved', 'stale', 'failed')),
  confidence varchar not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  unknowns jsonb not null default '[]',
  generation_context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tutorial_steps (
  id uuid primary key default gen_random_uuid(),
  tutorial_id uuid not null references public.tutorials(id) on delete cascade,
  step_order integer not null,
  node_id uuid references public.graph_nodes(id) on delete set null,
  file_path varchar not null,
  symbol_name varchar,
  line_start integer,
  line_end integer,
  snippet text,
  explanation text not null default '',
  receipt_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}',
  unique (tutorial_id, step_order)
);

-- ============================================================
-- Per-user Progress (resume onboarding/tutorials where you left off)
-- ============================================================

-- ref_id is polymorphic (onboarding: package_id; tutorial: tutorial_id) and
-- deliberately not an FK — packages/tutorials are regenerated per commit, so
-- the API validates existence on read and the UI falls back to static links.
create table if not exists public.user_progress (
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind varchar not null check (kind in ('onboarding', 'tutorial')),
  ref_id uuid not null,
  -- Position within the ref: {"sectionType": "architecture"} | {"stepOrder": 3}
  position jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id, kind, ref_id)
);

create index if not exists idx_user_progress_recent
  on public.user_progress(user_id, project_id, updated_at desc);

-- ============================================================
-- Source Receipts (typed, trust-levelled)
-- ============================================================

-- A receipt is any of: code/config/doc snippet, graph edge evidence, workflow
-- step evidence, or a reference to another semantic record (which bottoms out
-- in code receipts transitively). Receipts are project-scoped (not cascaded
-- from snapshots) because content-addressed semantic records outlive snapshots.
create table if not exists public.source_receipts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  snapshot_id uuid references public.analysis_snapshots(id) on delete set null,
  receipt_kind varchar not null default 'code_snippet' check (receipt_kind in (
    'code_snippet', 'config_snippet', 'doc_snippet',
    'graph_edge', 'workflow_step', 'record_reference'
  )),
  trust_level varchar not null default 'code'
    check (trust_level in ('code', 'config', 'tests', 'docs', 'llm_inference')),
  -- Attachment points (exactly one owner is set by convention):
  section_id uuid references public.package_sections(id) on delete cascade,
  record_id uuid references public.semantic_records(id) on delete cascade,
  tutorial_step_id uuid references public.tutorial_steps(id) on delete cascade,
  -- Evidence references:
  node_id uuid references public.graph_nodes(id) on delete set null,
  edge_id uuid references public.graph_edges(id) on delete set null,
  workflow_id uuid references public.workflows(id) on delete set null,
  referenced_record_id uuid references public.semantic_records(id) on delete set null,
  node_stable_key varchar,
  node_hash varchar,
  file_path varchar,
  symbol_name varchar,
  line_start integer,
  line_end integer,
  snippet text,
  detection_expression text,            -- for graph_edge receipts
  claim text,
  commit_hash varchar not null,
  confidence varchar not null default 'high' check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}'
);

-- ============================================================
-- Stale Flags (incremental invalidation)
-- ============================================================

create table if not exists public.stale_flags (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  target_type varchar not null check (target_type in (
    'graph_node', 'semantic_record', 'workflow', 'capability',
    'package', 'package_section', 'tutorial', 'embedding'
  )),
  target_id uuid,
  target_stable_key varchar not null,
  reason text not null,
  old_hash varchar,
  new_hash varchar,
  package_id uuid references public.onboarding_packages(id) on delete cascade,
  section_id uuid references public.package_sections(id) on delete cascade,
  record_id uuid references public.semantic_records(id) on delete cascade,
  changed_files text[] not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ============================================================
-- Graph RAG: neighborhood expansion (recursive CTE, hop/fan-out capped)
-- ============================================================

create or replace function public.graph_neighborhood(
  p_snapshot_id uuid,
  p_seed_node_ids uuid[],
  p_max_hops integer default 2,
  p_edge_types text[] default null,
  p_max_fanout integer default 25,
  p_max_nodes integer default 200
)
returns table (node_id uuid, hop integer, via_edge_id uuid, via_edge_type text, direction text)
language sql
stable
as $$
  with recursive frontier as (
    select seed.node_id, 0 as hop,
           null::uuid as via_edge_id, null::text as via_edge_type, null::text as direction
    from unnest(p_seed_node_ids) as seed(node_id)
    union
    select nbr.node_id, f.hop + 1, nbr.edge_id, nbr.edge_type, nbr.direction
    from frontier f
    join lateral (
      (
        select e.target_node_id as node_id, e.id as edge_id, e.type::text as edge_type, 'out'::text as direction
        from public.graph_edges e
        where e.snapshot_id = p_snapshot_id
          and e.source_node_id = f.node_id
          and (p_edge_types is null or e.type = any (p_edge_types))
        limit p_max_fanout
      )
      union all
      (
        select e.source_node_id as node_id, e.id as edge_id, e.type::text as edge_type, 'in'::text as direction
        from public.graph_edges e
        where e.snapshot_id = p_snapshot_id
          and e.target_node_id = f.node_id
          and (p_edge_types is null or e.type = any (p_edge_types))
        limit p_max_fanout
      )
    ) nbr on true
    where f.hop < p_max_hops
  )
  select distinct on (f.node_id) f.node_id, f.hop, f.via_edge_id, f.via_edge_type, f.direction
  from frontier f
  order by f.node_id, f.hop
  limit p_max_nodes;
$$;

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_github_connections_user_id on public.github_connections(user_id);
create index if not exists idx_project_members_user_id on public.project_members(user_id);
create index if not exists idx_project_invitations_project_id on public.project_invitations(project_id);
create index if not exists idx_project_invitations_email on public.project_invitations(email);
create index if not exists idx_project_invitations_email_status on public.project_invitations(email, status);

do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_project_invitations_pending_unique_email') then
    create unique index idx_project_invitations_pending_unique_email
      on public.project_invitations(project_id, lower(email)) where status = 'pending';
  end if;
end $$;

create index if not exists idx_projects_user_id on public.projects(user_id);
create index if not exists idx_project_llm_keys_project on public.project_llm_keys(project_id);
create index if not exists idx_ranking_weight_configs_project on public.ranking_weight_configs(project_id);
create index if not exists idx_analysis_scopes_project on public.analysis_scopes(project_id);
create index if not exists idx_analysis_snapshots_project_id on public.analysis_snapshots(project_id);
create index if not exists idx_analysis_snapshots_scope on public.analysis_snapshots(scope_id);
create index if not exists idx_snapshot_phases_snapshot on public.snapshot_phases(snapshot_id);
create index if not exists idx_analysis_jobs_project_status on public.analysis_jobs(project_id, status);
create index if not exists idx_repository_files_snapshot on public.repository_files(snapshot_id);
create index if not exists idx_graph_nodes_snapshot_id on public.graph_nodes(snapshot_id);
create index if not exists idx_graph_nodes_file_path on public.graph_nodes(snapshot_id, file_path);
create index if not exists idx_graph_nodes_type on public.graph_nodes(snapshot_id, type);

do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_graph_nodes_snapshot_stable_key') then
    create unique index idx_graph_nodes_snapshot_stable_key on public.graph_nodes(snapshot_id, stable_key);
  end if;
end $$;

create index if not exists idx_graph_edges_snapshot_id on public.graph_edges(snapshot_id);
create index if not exists idx_graph_edges_source_node_id on public.graph_edges(source_node_id);
create index if not exists idx_graph_edges_target_node_id on public.graph_edges(target_node_id);

do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_graph_edges_unique_per_snapshot') then
    create unique index idx_graph_edges_unique_per_snapshot
      on public.graph_edges(snapshot_id, source_node_id, target_node_id, type);
  end if;
end $$;

create index if not exists idx_entrypoints_snapshot on public.entrypoints(snapshot_id);
create index if not exists idx_side_effects_snapshot on public.side_effects(snapshot_id);
create index if not exists idx_workflows_snapshot_id on public.workflows(snapshot_id);
create index if not exists idx_workflow_steps_workflow_id on public.workflow_steps(workflow_id);
create index if not exists idx_criticality_scores_snapshot on public.criticality_scores(snapshot_id, phase, view);
create index if not exists idx_criticality_scores_target on public.criticality_scores(snapshot_id, target_type, stable_key);

do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_criticality_scores_unique') then
    create unique index idx_criticality_scores_unique
      on public.criticality_scores(snapshot_id, phase, view, target_type, stable_key, coalesce(role, ''));
  end if;
end $$;

create index if not exists idx_architecture_clusters_snapshot on public.architecture_clusters(snapshot_id);
create index if not exists idx_architecture_edges_snapshot on public.architecture_edges(snapshot_id);
create index if not exists idx_semantic_records_project on public.semantic_records(project_id);
create index if not exists idx_semantic_records_lookup
  on public.semantic_records(project_id, stable_key, evidence_hash);
create index if not exists idx_snapshot_semantic_records_snapshot
  on public.snapshot_semantic_records(snapshot_id);
create index if not exists idx_snapshot_semantic_records_stable_key
  on public.snapshot_semantic_records(snapshot_id, stable_key);
create index if not exists idx_capabilities_snapshot on public.capabilities(snapshot_id);
create index if not exists idx_embeddings_record on public.embeddings(record_id);
create index if not exists idx_onboarding_packages_project_role on public.onboarding_packages(project_id, role);
create index if not exists idx_onboarding_packages_scope on public.onboarding_packages(scope_id);
create index if not exists idx_ai_generation_runs_snapshot on public.ai_generation_runs(snapshot_id);
create index if not exists idx_ai_generation_runs_input_hash on public.ai_generation_runs(snapshot_id, input_hash);
create index if not exists idx_ai_generation_runs_job on public.ai_generation_runs(job_id);
create index if not exists idx_package_sections_snapshot_id on public.package_sections(snapshot_id);
create index if not exists idx_package_sections_package_id on public.package_sections(package_id);
create index if not exists idx_tutorials_snapshot on public.tutorials(snapshot_id);
create index if not exists idx_tutorials_package on public.tutorials(package_id);

do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_tutorials_package_stable_key') then
    create unique index idx_tutorials_package_stable_key
      on public.tutorials(package_id, stable_key) where package_id is not null;
  end if;
end $$;

create index if not exists idx_tutorial_steps_tutorial on public.tutorial_steps(tutorial_id);
create index if not exists idx_source_receipts_project on public.source_receipts(project_id);
create index if not exists idx_source_receipts_section_id on public.source_receipts(section_id);
create index if not exists idx_source_receipts_record_id on public.source_receipts(record_id);
create index if not exists idx_source_receipts_node_stable_key on public.source_receipts(node_stable_key);
create index if not exists idx_stale_flags_snapshot_id on public.stale_flags(snapshot_id);

-- HNSW index for vector similarity search (multi-view retrieval)
create index if not exists idx_embeddings_vector
  on public.embeddings using hnsw (embedding vector_cosine_ops);
