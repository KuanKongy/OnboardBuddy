-- 000_drop_all.sql
-- Nuclear teardown: drops ALL OnboardBuddy tables, functions, triggers, and extensions.
-- Safe to run on an already-empty database (uses IF EXISTS everywhere).
-- Run this when you need a clean slate, then re-run 001_initial_schema.sql.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists public.role_paths cascade;
drop table if exists public.stale_flags cascade;
drop table if exists public.doc_links cascade;
drop table if exists public.source_receipts cascade;
drop table if exists public.package_sections cascade;
drop table if exists public.onboarding_packages cascade;
drop table if exists public.workflow_scores cascade;
drop table if exists public.workflow_steps cascade;
drop table if exists public.workflows cascade;
drop table if exists public.graph_edges cascade;
drop table if exists public.graph_nodes cascade;
drop table if exists public.analysis_jobs cascade;
drop table if exists public.analysis_snapshots cascade;
drop table if exists public.project_settings cascade;
drop table if exists public.project_invitations cascade;
drop table if exists public.project_members cascade;
drop table if exists public.projects cascade;
drop table if exists public.github_connections cascade;
drop table if exists public.users cascade;

drop extension if exists "pgcrypto";
