-- 001_initial_schema.sql
-- Complete schema including all pipeline tables, pgvector, and RAG.
-- DESTRUCTIVE: Drop all existing tables and recreate from scratch.
-- Run this after dropping your existing schema.

-- ============================================================
-- Extensions
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- Users and Auth
-- ============================================================

create table if not exists public.users (
  id uuid primary key,
  email varchar not null unique,
  created_at timestamptz not null default now()
);

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
  unique (user_id, github_user_id)
);

alter table public.github_connections
  add column if not exists access_token_expires_at timestamptz;

alter table public.github_connections
  add column if not exists refresh_token_encrypted text;

alter table public.github_connections
  add column if not exists refresh_token_expires_at timestamptz;

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
-- Projects
-- ============================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  repo_owner varchar not null,
  repo_name varchar not null,
  branch varchar not null,
  default_branch varchar,
  github_installation_id text,
  repo_full_name varchar generated always as (repo_owner || '/' || repo_name) stored,
  status varchar not null default 'idle' check (status in ('idle', 'analyzing', 'complete', 'failed')),
  created_at timestamptz not null default now(),
  last_analyzed_at timestamptz,
  unique (user_id, repo_owner, repo_name, branch)
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
  status varchar not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  accepted_at timestamptz
);

-- ============================================================
-- Project Settings
-- ============================================================

create table if not exists public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  ignored_paths text[] not null default array['node_modules', 'dist', '.git', '.env'],
  ai_enabled boolean not null default false,
  default_developer_role varchar not null default 'general'
    check (default_developer_role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  file_limit integer not null default 5000 check (file_limit > 0),
  loc_limit integer not null default 250000 check (loc_limit > 0)
);

-- ============================================================
-- Analysis
-- ============================================================

create table if not exists public.analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  commit_hash varchar not null,
  branch varchar not null,
  file_count integer not null default 0,
  symbol_count integer not null default 0,
  workflow_count integer not null default 0,
  trigger_type varchar not null default 'manual'
    check (trigger_type in ('manual', 'initial', 'incremental', 'regeneration')),
  duration_ms integer,
  status varchar not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'failed')),
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, commit_hash)
);

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  snapshot_id uuid references public.analysis_snapshots(id) on delete set null,
  requested_by uuid not null references public.users(id) on delete restrict,
  job_type varchar not null
    check (job_type in ('analyze_project', 'generate_onboarding', 'regenerate_section', 'embed_summaries')),
  role varchar check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  status varchar not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed')),
  progress_pct integer not null default 0 check (progress_pct between 0 and 100),
  current_step varchar,
  checkpoint jsonb not null default '{}',
  step_log jsonb not null default '[]',
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- ============================================================
-- Code Evidence Model
-- ============================================================

create table if not exists public.graph_nodes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  stable_key varchar not null,
  type varchar not null,
  name varchar not null,
  file_path varchar not null,
  line_start integer,
  line_end integer,
  hash varchar not null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.graph_edges (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  source_node_id uuid not null references public.graph_nodes(id) on delete cascade,
  target_node_id uuid not null references public.graph_nodes(id) on delete cascade,
  type varchar not null,
  confidence varchar not null default 'high' check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}'::jsonb
);

-- ============================================================
-- Entrypoints & Side Effects (Pipeline Engine)
-- ============================================================

create table if not exists public.entrypoints (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  node_id uuid not null references public.graph_nodes(id) on delete cascade,
  kind varchar not null check (kind in ('http_route', 'cli_command', 'event_handler', 'cron_job', 'message_consumer', 'export')),
  method varchar,
  route_pattern varchar,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.side_effects (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  node_id uuid not null references public.graph_nodes(id) on delete cascade,
  kind varchar not null check (kind in ('database_write', 'http_call', 'file_write', 'message_publish', 'email_send', 'cache_write')),
  target varchar,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Workflows
-- ============================================================

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  title varchar not null,
  trigger_type varchar not null,
  purpose varchar not null,
  stable_key varchar,
  importance_score numeric(6, 3) not null default 0,
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
  step_kind varchar check (step_kind in ('trigger', 'auth_guard', 'validation', 'data_read', 'data_write', 'async_work', 'side_effect', 'response')),
  deterministic_description text,
  explanation text,
  role_relevance jsonb not null default '{}'::jsonb,
  unique (workflow_id, step_order)
);

create table if not exists public.workflow_scores (
  workflow_id uuid primary key references public.workflows(id) on delete cascade,
  entrypoint_exposure numeric(6, 3) not null default 0,
  downstream_impact numeric(6, 3) not null default 0,
  structural_centrality numeric(6, 3) not null default 0,
  external_side_effects numeric(6, 3) not null default 0,
  documentation_gap numeric(6, 3) not null default 0,
  test_coverage_signal numeric(6, 3) not null default 0,
  git_churn_recency numeric(6, 3) not null default 0,
  composite_score numeric(6, 3) not null default 0,
  ranking_reasons text[] not null default '{}'
);

-- ============================================================
-- Critical Rankings
-- ============================================================

create table if not exists public.critical_rankings (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  target_type varchar not null,
  target_id uuid not null,
  role varchar not null check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  composite_score numeric(6, 3) not null default 0,
  scores jsonb not null default '{}',
  ranking_reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (snapshot_id, target_type, target_id, role)
);

-- ============================================================
-- Architecture Map
-- ============================================================

create table if not exists public.architecture_clusters (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  label varchar not null,
  description text,
  parent_cluster_id uuid references public.architecture_clusters(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.architecture_cluster_members (
  cluster_id uuid not null references public.architecture_clusters(id) on delete cascade,
  node_id uuid not null references public.graph_nodes(id) on delete cascade,
  primary key (cluster_id, node_id)
);

create table if not exists public.architecture_edges (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  source_cluster_id uuid not null references public.architecture_clusters(id) on delete cascade,
  target_cluster_id uuid not null references public.architecture_clusters(id) on delete cascade,
  edge_count integer not null default 1,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Semantic Summaries (RAG)
-- ============================================================

create table if not exists public.semantic_summaries (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  target_type varchar not null,
  target_id uuid not null,
  stable_key varchar not null,
  summary text not null,
  facts jsonb not null default '[]',
  confidence varchar not null check (confidence in ('high', 'medium', 'low')),
  receipt_ids uuid[] not null default '{}',
  evidence_hash text not null,
  model text,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique (snapshot_id, target_type, target_id, evidence_hash)
);

-- ============================================================
-- Evidence Embeddings (pgvector RAG)
-- ============================================================

create table if not exists public.evidence_embeddings (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  summary_id uuid not null references public.semantic_summaries(id) on delete cascade,
  target_type varchar not null,
  target_id uuid not null,
  content text not null,
  embedding vector(1536),
  provider text not null,
  model text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Onboarding Packages
-- ============================================================

create table if not exists public.onboarding_packages (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  role varchar not null check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  status varchar not null default 'generating'
    check (status in ('generating', 'draft', 'approved', 'stale', 'failed')),
  generated_by uuid not null references public.users(id) on delete restrict,
  analyzed_commit varchar not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, role, analyzed_commit)
);

create table if not exists public.package_sections (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.onboarding_packages(id) on delete cascade,
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  type varchar not null
    check (type in (
      'start_here', 'entry_points', 'critical_25', 'workflow_guide',
      'data_schema', 'safety_rails', 'dependency_graph', 'architecture', 'doc_health'
    )),
  title varchar not null,
  content text not null default '',
  confidence varchar not null default 'low' check (confidence in ('high', 'medium', 'low')),
  review_status varchar not null default 'draft'
    check (review_status in ('draft', 'approved', 'edited', 'stale', 'regenerate_requested')),
  analyzed_commit varchar not null,
  role varchar check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  generation_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null
);

create table if not exists public.source_receipts (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.package_sections(id) on delete cascade,
  node_id uuid references public.graph_nodes(id) on delete set null,
  workflow_id uuid references public.workflows(id) on delete set null,
  node_stable_key varchar,
  node_hash varchar,
  file_path varchar not null,
  symbol_name varchar,
  line_start integer,
  line_end integer,
  snippet text,
  claim text,
  confidence varchar default 'high' check (confidence in ('high', 'medium', 'low')),
  commit_hash varchar not null
);

-- ============================================================
-- AI Generation Audit Trail
-- ============================================================

create table if not exists public.ai_generation_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  package_id uuid references public.onboarding_packages(id) on delete cascade,
  target_type varchar not null,
  target_id uuid,
  section_type varchar,
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_hash text not null,
  output_hash text,
  token_usage jsonb not null default '{}',
  latency_ms integer,
  status varchar not null check (status in ('running', 'complete', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ============================================================
-- Documentation Health
-- ============================================================

create table if not exists public.doc_links (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  doc_path varchar not null,
  linked_node_id uuid references public.graph_nodes(id) on delete set null,
  linked_workflow_id uuid references public.workflows(id) on delete set null,
  doc_hash varchar not null
);

create table if not exists public.stale_flags (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  target_type varchar not null check (target_type in ('package_section', 'repo_doc')),
  target_id uuid not null,
  reason text not null,
  changed_files text[] not null default '{}',
  package_id uuid references public.onboarding_packages(id) on delete cascade,
  section_id uuid references public.package_sections(id) on delete cascade,
  old_hash varchar,
  new_hash varchar,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Role Paths
-- ============================================================

create table if not exists public.role_paths (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  package_id uuid not null references public.onboarding_packages(id) on delete cascade,
  role varchar not null check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  step_order integer not null,
  workflow_id uuid references public.workflows(id) on delete set null,
  section_id uuid references public.package_sections(id) on delete set null,
  title varchar not null,
  reason text not null,
  unique (package_id, step_order)
);

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
create index if not exists idx_analysis_snapshots_project_id on public.analysis_snapshots(project_id);
create index if not exists idx_analysis_jobs_project_status on public.analysis_jobs(project_id, status);
create index if not exists idx_graph_nodes_snapshot_id on public.graph_nodes(snapshot_id);
create index if not exists idx_graph_nodes_file_path on public.graph_nodes(snapshot_id, file_path);

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
create index if not exists idx_critical_rankings_snapshot_role on public.critical_rankings(snapshot_id, role);
create index if not exists idx_architecture_clusters_snapshot on public.architecture_clusters(snapshot_id);
create index if not exists idx_architecture_edges_snapshot on public.architecture_edges(snapshot_id);
create index if not exists idx_semantic_summaries_snapshot on public.semantic_summaries(snapshot_id);
create index if not exists idx_semantic_summaries_target on public.semantic_summaries(snapshot_id, target_type, target_id);
create index if not exists idx_evidence_embeddings_snapshot on public.evidence_embeddings(snapshot_id);
create index if not exists idx_evidence_embeddings_summary on public.evidence_embeddings(summary_id);
create index if not exists idx_ai_generation_runs_snapshot on public.ai_generation_runs(snapshot_id);
create index if not exists idx_onboarding_packages_project_role on public.onboarding_packages(project_id, role);
create index if not exists idx_package_sections_snapshot_id on public.package_sections(snapshot_id);
create index if not exists idx_package_sections_package_id on public.package_sections(package_id);
create index if not exists idx_source_receipts_section_id on public.source_receipts(section_id);
create index if not exists idx_source_receipts_node_stable_key on public.source_receipts(node_stable_key);
create index if not exists idx_doc_links_snapshot_id on public.doc_links(snapshot_id);
create index if not exists idx_stale_flags_snapshot_id on public.stale_flags(snapshot_id);
create index if not exists idx_role_paths_snapshot_role on public.role_paths(snapshot_id, role);

-- HNSW index for vector similarity search (RAG)
create index if not exists idx_evidence_embeddings_vector
  on public.evidence_embeddings using hnsw (embedding vector_cosine_ops);
