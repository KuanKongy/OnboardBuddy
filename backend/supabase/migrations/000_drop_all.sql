-- 000_drop_all.sql
-- Nuclear teardown: drops ALL OnboardBuddy tables, functions, triggers, and extensions.
-- Safe to run on an already-empty database (uses IF EXISTS everywhere).
-- Run this when you need a clean slate, then re-run 001_initial_schema.sql.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.graph_neighborhood(uuid, uuid[], integer, text[], integer, integer);

drop table if exists public.stale_flags cascade;
drop table if exists public.source_receipts cascade;
drop table if exists public.tutorial_steps cascade;
drop table if exists public.tutorials cascade;
drop table if exists public.package_sections cascade;
drop table if exists public.ai_generation_runs cascade;
drop table if exists public.onboarding_packages cascade;
drop table if exists public.embeddings cascade;
drop table if exists public.capability_members cascade;
drop table if exists public.capabilities cascade;
drop table if exists public.snapshot_semantic_records cascade;
drop table if exists public.semantic_records cascade;
drop table if exists public.architecture_edges cascade;
drop table if exists public.architecture_cluster_members cascade;
drop table if exists public.architecture_clusters cascade;
drop table if exists public.criticality_scores cascade;
drop table if exists public.workflow_steps cascade;
drop table if exists public.workflows cascade;
drop table if exists public.side_effects cascade;
drop table if exists public.entrypoints cascade;
drop table if exists public.graph_edges cascade;
drop table if exists public.graph_nodes cascade;
drop table if exists public.repository_files cascade;
drop table if exists public.analysis_jobs cascade;
drop table if exists public.snapshot_phases cascade;
drop table if exists public.analysis_snapshots cascade;
drop table if exists public.analysis_scopes cascade;
drop table if exists public.ranking_weight_configs cascade;
drop table if exists public.project_llm_keys cascade;
drop table if exists public.project_settings cascade;
drop table if exists public.project_invitations cascade;
drop table if exists public.project_members cascade;
drop table if exists public.projects cascade;
drop table if exists public.github_installations cascade;
drop table if exists public.github_connections cascade;
drop table if exists public.users cascade;

-- Legacy tables from the pre-rework schema (harmless if absent).
drop table if exists public.role_paths cascade;
drop table if exists public.doc_links cascade;
drop table if exists public.evidence_embeddings cascade;
drop table if exists public.semantic_summaries cascade;
drop table if exists public.critical_rankings cascade;
drop table if exists public.workflow_scores cascade;

drop extension if exists vector;
drop extension if exists "pgcrypto";
