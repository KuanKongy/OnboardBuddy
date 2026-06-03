create extension if not exists "pgcrypto";

create table public.users (
  id uuid primary key,
  email varchar not null unique,
  created_at timestamptz not null default now()
);

create table public.github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  github_user_id integer not null,
  github_username varchar not null,
  access_token_encrypted text not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, github_user_id)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name varchar not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role varchar not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  repo_owner varchar not null,
  repo_name varchar not null,
  branch varchar not null,
  status varchar not null default 'idle' check (status in ('idle', 'analyzing', 'complete', 'failed')),
  created_at timestamptz not null default now(),
  last_analyzed_at timestamptz,
  unique (user_id, repo_owner, repo_name, branch)
);

create table public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  ignored_paths text[] not null default array['node_modules', 'dist', '.git', '.env'],
  ai_enabled boolean not null default false,
  default_role varchar not null default 'general'
    check (default_role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  file_limit integer not null default 5000 check (file_limit > 0),
  loc_limit integer not null default 250000 check (loc_limit > 0)
);

create table public.analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  commit_hash varchar not null,
  branch varchar not null,
  file_count integer not null default 0,
  symbol_count integer not null default 0,
  workflow_count integer not null default 0,
  status varchar not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'failed')),
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, commit_hash)
);

create table public.graph_nodes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  type varchar not null,
  name varchar not null,
  file_path varchar not null,
  line_start integer,
  line_end integer,
  hash varchar not null,
  metadata jsonb not null default '{}'::jsonb
);

create table public.graph_edges (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  source_node_id uuid not null references public.graph_nodes(id) on delete cascade,
  target_node_id uuid not null references public.graph_nodes(id) on delete cascade,
  type varchar not null,
  metadata jsonb not null default '{}'::jsonb
);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  title varchar not null,
  trigger_type varchar not null,
  purpose varchar not null,
  importance_score numeric(6, 3) not null default 0,
  confidence varchar not null default 'low' check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}'::jsonb
);

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  step_order integer not null,
  node_id uuid references public.graph_nodes(id) on delete set null,
  file_path varchar not null,
  symbol_name varchar,
  line_start integer,
  line_end integer,
  explanation text,
  role_relevance jsonb not null default '{}'::jsonb,
  unique (workflow_id, step_order)
);

create table public.workflow_scores (
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

create table public.package_sections (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  type varchar not null,
  title varchar not null,
  content text not null default '',
  confidence varchar not null default 'low' check (confidence in ('high', 'medium', 'low')),
  review_status varchar not null default 'draft'
    check (review_status in ('draft', 'approved', 'edited', 'stale', 'regenerate_requested')),
  analyzed_commit varchar not null,
  role varchar check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null
);

create table public.source_receipts (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.package_sections(id) on delete cascade,
  node_id uuid references public.graph_nodes(id) on delete set null,
  file_path varchar not null,
  symbol_name varchar,
  line_start integer,
  line_end integer,
  snippet text,
  commit_hash varchar not null
);

create table public.doc_links (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  doc_path varchar not null,
  linked_node_id uuid references public.graph_nodes(id) on delete set null,
  linked_workflow_id uuid references public.workflows(id) on delete set null,
  doc_hash varchar not null
);

create table public.stale_flags (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  target_type varchar not null check (target_type in ('package_section', 'repo_doc')),
  target_id uuid not null,
  reason text not null,
  changed_files text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.role_paths (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  role varchar not null check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  step_order integer not null,
  workflow_id uuid references public.workflows(id) on delete set null,
  section_id uuid references public.package_sections(id) on delete set null,
  title varchar not null,
  reason text not null,
  unique (snapshot_id, role, step_order)
);

create index idx_github_connections_user_id on public.github_connections(user_id);
create index idx_team_members_user_id on public.team_members(user_id);
create index idx_projects_user_id on public.projects(user_id);
create index idx_projects_team_id on public.projects(team_id);
create index idx_analysis_snapshots_project_id on public.analysis_snapshots(project_id);
create index idx_graph_nodes_snapshot_id on public.graph_nodes(snapshot_id);
create index idx_graph_nodes_file_path on public.graph_nodes(snapshot_id, file_path);
create index idx_graph_edges_snapshot_id on public.graph_edges(snapshot_id);
create index idx_graph_edges_source_node_id on public.graph_edges(source_node_id);
create index idx_graph_edges_target_node_id on public.graph_edges(target_node_id);
create index idx_workflows_snapshot_id on public.workflows(snapshot_id);
create index idx_workflow_steps_workflow_id on public.workflow_steps(workflow_id);
create index idx_package_sections_snapshot_id on public.package_sections(snapshot_id);
create index idx_source_receipts_section_id on public.source_receipts(section_id);
create index idx_doc_links_snapshot_id on public.doc_links(snapshot_id);
create index idx_stale_flags_snapshot_id on public.stale_flags(snapshot_id);
create index idx_role_paths_snapshot_role on public.role_paths(snapshot_id, role);
