# OnboardBuddy Hybrid Semantic Pipeline

This document is the source of truth for OnboardBuddy's analysis pipeline: how a Git repository becomes a persistent, scope-aware, role-specific Codebase Onboarding Package.

The core rule is:

```txt
AST/config/git evidence is the source of truth.
Phase A deterministic ranking decides what deserves LLM attention.
The LLM semantic pass produces structured semantic records per symbol.
Hierarchical synthesis builds file -> module -> service -> system understanding.
Phase B semantic reranking produces multi-view criticality, projected per role.
Multi-view embeddings + SQL graph expansion retrieve stored understanding.
Generation writes cited, trust-validated onboarding content from retrieved evidence.
Content-addressed records and hashes make everything auditable, resumable,
cacheable, and incrementally refreshable.
```

This supersedes the previous pipeline spec. The key differences:

1. **Code snippets ARE sent to LLMs by default** (zero-data-retention via OpenRouter). The old "no code to LLM" promise in Design.md is superseded; the privacy filter still strips secrets/env files, and three per-project privacy modes exist (`full_ai`, `facts_only_ai`, `ai_disabled`).
2. **Semantic records replace freeform summaries.** The symbol pass produces fixed-schema structured records; a hierarchical synthesis pass builds the whole-repo picture bottom-up even without a README.
3. **Ranking is two-phase and multi-view.** A deterministic candidate ranking gates LLM depth; a semantic reranking after synthesis produces the real Critical 25% as projections over per-view scores with per-role configurable weights.
4. **Scopes.** Project = GitHub repo connection; Analysis Scope = whole repo or a selected directory/service/package; Onboarding Package = (scope, role, commit). Snapshots, graphs, and packages belong to a scope.
5. **Graph RAG on Supabase.** Retrieval = multi-view pgvector seed + recursive-CTE graph expansion. The old section-markdown embedding path and unused `hybridRetrieve` are deleted.
6. **Operational guardrails are first-class**: budgets and kill switches, model failure behavior, preflight preview, resume/idempotency, trust levels, honest unknowns, observability.

## External References

- TypeScript Compiler API: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- OpenRouter quickstart and OpenAI SDK compatibility: https://openrouter.ai/docs/quickstart
- OpenRouter zero-data-retention: https://openrouter.ai/docs/features/privacy-and-logging
- OpenAI structured outputs: https://platform.openai.com/docs/guides/structured-outputs
- OpenAI embeddings: https://platform.openai.com/docs/guides/embeddings
- Supabase pgvector: https://supabase.com/docs/guides/database/extensions/pgvector

## Concepts

| Concept | Meaning |
| --- | --- |
| Project | One GitHub repo connection (owner/repo/branch). Acts as the repo identity (`repo_id`) for content-addressed caching. |
| Analysis Scope | Ingestion boundary inside a project: whole repo (`path_prefix = ''`) or a directory / workspace package / docker service. |
| Snapshot | One analysis run of (project, scope, commit). Owns the graph, workflows, rankings, clusters, and generated artifacts for that commit. |
| Onboarding Package | (scope, role, commit). The generated deliverable: sections + tutorials + diagrams. |
| Semantic Record | Fixed-schema structured LLM output for a symbol/file/module/service/system/workflow/capability, content-addressed and shared across scopes/snapshots of the same repo. |
| Receipt | Typed evidence reference (code/config/doc snippet, graph edge, workflow step, or record reference) with a trust level. |
| Criticality Score | One (phase, view, target) score row. Rankings are projections over views, never a single stored list. |

## Target Architecture

```mermaid
flowchart TD
    ingest["Ingestion: zipball + scope boundary + privacy filter + repo inventory + docs/README + language guardrail"]
    parse["Parser layer (TS/JS via Compiler API, pluggable interface)"]
    graph["Deterministic Knowledge Graph: symbol-level nodes + edges (calls, imports, routes, DB, jobs, env, tests)"]
    derive["Deterministic candidate selection: workflows, candidate rankings (fan-in/out, exposure, side effects, churn), architecture clusters"]
    semantic["LLM Semantic Pass (tiered, depth-gated by candidate ranking, batched per file): structured semantic records per symbol"]
    synth["Hierarchical Synthesis: file -> module -> service -> system + Capability extraction + refinement/critique pass"]
    rerank["Semantic reranking: multi-view criticality scores; Critical 25% = projection over views"]
    embed["Multi-view embeddings over semantic records (purpose, domain, dependency, operations)"]
    kb[("Persistent Knowledge Base in Supabase")]
    retrieve["Hybrid retrieval: vector seed -> SQL graph expansion -> receipts"]
    gen["Generation: onboarding sections, request-flow tutorials + diagrams, architecture map, learning paths (validated, cited)"]
    qa["Grounded Q&A eval endpoint + internal chat UI"]
    incr["Incremental: file hashes + symbol AST diffs -> invalidate affected records upward"]

    ingest --> parse --> graph --> derive --> semantic --> synth --> rerank --> embed --> kb
    kb --> retrieve --> gen
    retrieve --> qa
    incr --> graph
    incr --> semantic
```

## Pipeline Phases

Every phase writes a `snapshot_phases` row with status, metrics, and a resume checkpoint. A failed or paused job resumes from the last incomplete phase and skips already-persisted work.

```txt
 0. preflight          Inventory + shallow parse -> analysis preview (separate job, no snapshot mutation)
 1. ingest             Zipball download, scope boundary, privacy filter, inventory, docs, language guardrail
 2. parse              TS Program creation, per-file AST parse (scope files only)
 3. graph              Symbol-level evidence graph: nodes, edges, entrypoints, side effects, doc/config/schema nodes
 4. workflows          Call-graph workflow extraction (entrypoint -> side effects)
 5. candidate_ranking  Phase A deterministic scores (view='candidate'); drives depth gating
 6. clustering         Deterministic architecture clusters + cluster edges
 7. semantic_symbols   Depth-gated, batched, cached LLM symbol records          [skipped if ai_disabled]
 8. synthesis          file -> module -> service -> system records              [skipped if ai_disabled]
 9. capabilities       Business capability extraction                           [skipped if ai_disabled]
10. refinement         Re-annotate critical symbols/files with system context   [skipped if ai_disabled]
11. critique           Verify records against receipts; mark 'usable'           [skipped if ai_disabled]
12. semantic_ranking   Phase B multi-view criticality scores                    [skipped if ai_disabled]
13. embeddings         Multi-view embeddings over usable records                [skipped if ai_disabled]
14. generation         Package sections + tutorials + diagrams per (scope, role, commit)
15. validation         Citation/trust validation (also runs inline during generation)
16. incremental_diff   Only on incremental runs: file/symbol diff + stale flags
```

With `ai_disabled`, the pipeline still produces deterministic outputs: graph, workflows, candidate rankings, clusters, inventory, and deterministic section content clearly labeled as AI-free.

---

# Operational Guardrails

## Privacy modes

Three per-project modes (`project_settings.privacy_mode`), chosen in project settings and shown in the preflight privacy summary. The mode used for a run is copied onto the snapshot.

- `full_ai` (default): code snippets + deterministic facts sent to the LLM; best quality.
- `facts_only_ai`: no code snippets leave the system — only extracted facts, signatures, and graph metadata; medium quality, clearly labeled in outputs.
- `ai_disabled`: no LLM calls at all; deterministic-only outputs.

Enforcement is mechanical, not prompt wording: prompt builders take the mode as an input, and evidence bundle assembly strips `snippet` fields in `facts_only_ai` mode before anything reaches a provider. The privacy filter always strips secret-bearing files (`.env*`, key/cert files, files matching secret patterns) during ingestion, in every mode.

## Evidence trust levels

Trust is a mechanical field stored on `repository_files`, `graph_nodes`, and `source_receipts`:

```txt
code                    highest   parsed source symbols
config/schema/migration high      configs, SQL schema, migrations   (stored as 'config')
tests                   medium-high
docs                    medium-low README/docs/JSDoc ("docs may be stale, code wins")
llm_inference           lowest    must cite higher-trust evidence to be usable
```

The citation validator enforces that claims resolve to sufficient trust. Doc-derived claims that conflict with code-derived evidence are resolved code-over-docs mechanically and flagged (`semantic_records.flags` / section `unknowns`) as `docs_conflict_with_code`.

## Receipt taxonomy

A receipt (`source_receipts.receipt_kind`) is any of:

```txt
code_snippet       file/line range + snippet
config_snippet     config or schema snippet
doc_snippet        README/docs/JSDoc snippet
graph_edge         edge evidence ("A calls B") with the detection expression
workflow_step      step evidence from a traced workflow
record_reference   reference to another semantic record, which itself bottoms
                   out in code-level receipts (resolved transitively by the validator)
```

Every receipt carries `trust_level`, `commit_hash`, and enough identity (`node_stable_key`, `node_hash`, file/lines) to survive re-analysis and be checked for staleness.

## Cost budgets and kill switches

Project-level budgets enforced by the worker per snapshot: max LLM calls, max input tokens, max files ingested, max symbols sent to LLM, max runtime. Counters live in `analysis_snapshots.budget_usage` and are surfaced in progress UI.

Default budgets by depth (tunable constants, `backend/src/worker/engine/budgets.ts`; overridable per project via `project_settings.budget_overrides`):

| Depth | Max files | Max symbols to LLM | Max LLM calls | Max input tokens | Max runtime |
| --- | --- | --- | --- | --- | --- |
| `cheap` | 1,000 | 600 | 100 | 1,000,000 | 25 min |
| `standard` (default) | 2,500 | 2,000 | 300 | 4,000,000 | 60 min |
| `full` | 5,000 | 10,000 | 1,500 | 20,000,000 | 4 hr |

Stop behavior when a budget trips (`project_settings.budget_stop_behavior`):

- `fail`: mark snapshot failed with a transparent budget report.
- `pause` (default): checkpoint and mark snapshot/job `paused`; resumable after raising the budget.
- `degrade`: drop remaining targets to a cheaper depth (facts-only records for what's left), record a `budget_degraded` event in `budget_usage.budget_events` and a snapshot unknown.

Preflight requires explicit user confirmation when estimates exceed any of: **>2,500 files, >2,000 symbols selected for LLM, >300 LLM calls, or high cost tier.** Very large repos require a smaller scope, a raised budget, a BYO key, or a cheaper depth.

## Model tiers and failure behavior

Two LLM tiers plus embeddings, each a configurable model list (currently one model per tier) via OpenRouter:

| Tier | Used for | Default env |
| --- | --- | --- |
| `cheap` | symbol-level semantic pass | `OPENROUTER_MODEL_CHEAP` (e.g. `openai/gpt-4o-mini`) |
| `strong` | synthesis, capabilities, refinement, critique, reranking, sections, tutorials, Q&A | `OPENROUTER_MODEL_STRONG` (e.g. `anthropic/claude-sonnet-4.5`) |
| `embedding` | multi-view embeddings | `EMBEDDINGS_MODEL` (default `text-embedding-3-small`, 1536 dims) |

On model failure/rate-limit, behavior is configurable per tier (`project_settings.model_failure_behavior`), analogous to budget stop behavior:

- `retry`: exponential backoff; retries are **per-symbol, not per-batch**.
- `degrade`: fall back to the next model in the tier list, or from `strong` work to nothing (pause) — the cheap tier may degrade, quality-critical strong-tier work should not silently degrade.
- `pause`: resumable checkpoint.
- `fail`: fail the snapshot.

Defaults: `{"cheap": ["retry", "degrade"], "strong": ["retry", "pause"]}`.

## Analysis preview (preflight)

Flow: import repo -> click Analyze -> **preview modal** -> confirm. The preflight job produces:

- selected scope (+ proposed alternatives),
- supported vs unsupported files (language guardrail output),
- estimated symbol count and symbols selected for LLM at the chosen depth,
- estimated LLM calls and token range, and a coarse cost tier,
- a warning when the repo/scope is large, size-cap confirmations,
- a privacy summary of what evidence may be sent to the LLM per the project's privacy mode.

**Explicit limitation:** preflight uses inventory + shallow syntactic parse only — no TypeChecker, no call graph, no ranking — so estimates are coarse by design and preflight stays fast instead of becoming half the pipeline.

Estimate formulas (constants in `budgets.ts`):

```txt
estSymbols        = count of declaration statements from shallow parse
estSelected       = min(depthSelectionRatio(depth) * estSymbols, maxSymbolsToLlm(depth))
                    depthSelectionRatio: cheap 0.25, standard 0.5, full 1.0
estSymbolCalls    = ceil(estSelected / 15)                     (batching cap)
estSynthesisCalls = ceil(estFiles / 10) + ceil(estModules) + ~5 (capabilities/system/critique)
estCalls          = estSymbolCalls + estSynthesisCalls + sectionCount + tutorialCount
estInputTokens    = estCalls * avgTokensPerCall (cheap ~6k, strong ~9k)
costTier          = low (< $2) | medium ($2-$15) | high (> $15) at configured model prices
```

## Full-depth size caps

`full` depth is capped unless explicitly confirmed (by preflight-estimated counts):

| Scope size | Files | Est. symbols | Behavior |
| --- | --- | --- | --- |
| small | < 300 | < 1,500 | allowed |
| medium | 300–1,000 | 1,500–5,000 | warning + estimate |
| large | 1,000–2,500 | 5,000–10,000 | explicit confirmation required |
| very large | > 2,500 | > 10,000 | require smaller scope, raised budget, or BYO key |

## Honest unknowns (don't bluff)

First-class stored outputs (flags/fields, not prose afterthoughts), rendered in UI and generated content:

- unsupported languages/files (`analysis_snapshots.language_inventory`, `repository_files.supported`),
- "no workflow found" (`analysis_snapshots.unknowns`),
- low-confidence claims (claim-level confidence + section `unknowns`),
- docs-conflict-with-code flags (`semantic_records.flags`, section `unknowns`),
- missing test coverage (candidate ranking signal surfaced in reasons),
- external dependencies outside the analysis scope (`external` graph nodes).

## Idempotency and resume

Every phase is resumable:

- `snapshot_phases` rows carry per-phase status + checkpoint keyed by snapshot (scope + commit).
- Semantic records are content-addressed; a batch whose records already exist is skipped.
- Embeddings are keyed by (record_id, view, model); existing rows are skipped.
- `ai_generation_runs.input_hash` makes each LLM/embedding batch skippable on retry (a cached skip is recorded as `skipped_cached`).
- A failed job resumes from the last incomplete phase instead of restarting the pipeline.

## Observability

Structured per-phase metrics persisted in `snapshot_phases.metrics`: files parsed, symbols extracted, graph nodes/edges, LLM calls/tokens/estimated cost per phase and model, semantic-record cache hit rate, unsupported file counts, retrieval bundle sizes, citation validation pass/fail counts. Exposed via an internal metrics endpoint (`GET /projects/:id/snapshots/:snapshotId/metrics`) and shown in the analysis status UI alongside budget consumption.

## BYO LLM keys

Per-project API keys (`project_llm_keys`), encrypted with the same pattern as GitHub tokens (`backend/src/lib/encryption.ts`). Editable only by project owner/admin. Teammates may see provider name, model names, key existence, and token usage/cost — never the key value. The AI provider layer is abstract; only the OpenRouter provider is implemented for now, with the per-project key overriding the server key when present (`ai_generation_runs.key_source` records which was used). A nullable `org_id` column allows org-level keys later without migration pain.

---

# Database Schema

The executable schema is [backend/supabase/migrations/001_initial_schema.sql](../backend/supabase/migrations/001_initial_schema.sql) (run [000_drop_all.sql](../backend/supabase/migrations/000_drop_all.sql) first on a dirty database). Users/auth, GitHub connections/installations, projects, membership, and invitations are unchanged from the previous schema and not repeated here. Everything below is the pipeline schema, verbatim from the migration.

```sql
create extension if not exists "pgcrypto";
create extension if not exists "vector";
```

## Settings, keys, ranking weights

```sql
create table if not exists public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  ignored_paths text[] not null default array['node_modules', 'dist', '.git', '.env'],
  default_developer_role varchar not null default 'general'
    check (default_developer_role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  file_limit integer not null default 5000 check (file_limit > 0),
  loc_limit integer not null default 250000 check (loc_limit > 0),
  analysis_depth varchar not null default 'standard'
    check (analysis_depth in ('cheap', 'standard', 'full')),
  privacy_mode varchar not null default 'full_ai'
    check (privacy_mode in ('full_ai', 'facts_only_ai', 'ai_disabled')),
  budget_overrides jsonb not null default '{}',
  budget_stop_behavior varchar not null default 'pause'
    check (budget_stop_behavior in ('fail', 'pause', 'degrade')),
  model_failure_behavior jsonb not null default '{}',
  model_tier_overrides jsonb not null default '{}'
);

create table if not exists public.project_llm_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  org_id uuid,                                   -- forward-compat: org-level keys
  provider varchar not null default 'openrouter',
  api_key_encrypted text not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider)
);

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
```

A `ranking_weight_configs` row exists only when a project customizes a role; absence means code defaults (see "Weight configs and projections"). "Revert to default" deletes the row.

## Scopes, snapshots, phases, jobs

```sql
create table if not exists public.analysis_scopes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  path_prefix varchar not null default '',        -- '' = whole repo
  display_name varchar not null,
  kind varchar not null default 'whole_repo'
    check (kind in ('whole_repo', 'workspace_package', 'docker_service', 'directory', 'manual')),
  detected_from varchar,                          -- 'package_json_workspaces' | 'docker_compose' | ...
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path_prefix)
);

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
  semantic_depth varchar not null default 'standard'
    check (semantic_depth in ('cheap', 'standard', 'full')),
  privacy_mode varchar not null default 'full_ai'
    check (privacy_mode in ('full_ai', 'facts_only_ai', 'ai_disabled')),
  file_count integer not null default 0,
  symbol_count integer not null default 0,
  workflow_count integer not null default 0,
  language_inventory jsonb not null default '{}', -- language guardrail output
  budget_usage jsonb not null default '{}',       -- live budget counters
  unknowns jsonb not null default '[]',           -- snapshot-level honest unknowns
  duration_ms integer,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (scope_id, commit_hash)
);

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
  metrics jsonb not null default '{}',            -- per-phase observability counters
  checkpoint jsonb not null default '{}',         -- resume cursor
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
  status varchar not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'complete', 'failed')),
  progress_pct integer not null default 0 check (progress_pct between 0 and 100),
  current_step varchar,
  checkpoint jsonb not null default '{}',
  step_log jsonb not null default '[]',
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
```

The legacy job types (`analyze_project`, `generate_onboarding`, `embed_summaries`) and the legacy `ai_enabled` boolean are removed; AI on/off is expressed only through `privacy_mode`, and the pre-rework analysis path runs as `analyze_scope` on the whole-repo scope until Phase 2 makes scopes selectable.

## Files and the evidence graph

```sql
create table if not exists public.repository_files (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  stable_key varchar not null,                    -- repo-local path
  file_path varchar not null,
  language varchar not null,
  category varchar not null default 'other'
    check (category in ('source', 'test', 'config', 'schema', 'migration', 'doc', 'script', 'asset', 'other')),
  supported boolean not null default true,        -- language guardrail output
  trust_level varchar not null default 'code'
    check (trust_level in ('code', 'config', 'tests', 'docs')),
  size_bytes integer not null,
  line_count integer,
  hash varchar not null,
  metadata jsonb not null default '{}',           -- extension, package, pathSegments, churn {...}
  unique (snapshot_id, stable_key)
);

create table if not exists public.graph_nodes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  stable_key varchar not null,
  type varchar not null check (type in (
    'file', 'module', 'function', 'method', 'class', 'interface', 'type',
    'enum', 'variable', 'entrypoint', 'schema', 'test', 'config', 'doc', 'external'
  )),
  name varchar not null,
  file_path varchar,                              -- null for 'external' nodes
  line_start integer,
  line_end integer,
  hash varchar,                                   -- combined identity hash; null for 'external'
  signature_hash varchar,
  body_hash varchar,
  trust_level varchar not null default 'code'
    check (trust_level in ('code', 'config', 'tests', 'docs', 'llm_inference')),
  exported boolean not null default false,
  snippet text,                                   -- capped; stripped in facts_only_ai bundles
  metadata jsonb not null default '{}'::jsonb     -- signature, params, returnType, behaviorSignals, ...
);
-- unique index (snapshot_id, stable_key)

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
  metadata jsonb not null default '{}'::jsonb     -- detectedFrom, expression
);
-- unique index (snapshot_id, source_node_id, target_node_id, type)
```

`external` nodes represent anything imported/called across the scope boundary (other packages in the repo outside the scope, or third-party modules). `doc` nodes carry README/docs/JSDoc evidence with `trust_level = 'docs'`.

## Entrypoints, side effects, workflows

```sql
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
  explanation text,                     -- LLM-enriched step explanation (walkthrough UI)
  role_relevance jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}',
  unique (workflow_id, step_order)
);
```

## Criticality scores (two-phase, multi-view)

```sql
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
  target_id uuid,                                 -- workflow/cluster/capability id when not a node
  stable_key varchar not null,
  role varchar check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  score numeric(7, 5) not null default 0,
  score_breakdown jsonb not null default '{}',
  reasons text[] not null default '{}',
  receipt_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
-- unique index (snapshot_id, phase, view, target_type, stable_key, coalesce(role, ''))
```

`role` is set only for `critical_for_role` rows (one row per role). Raw view scores are never overwritten — re-weighting a role's projection is instant and needs no re-analysis.

## Architecture map

```sql
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
```

## Semantic records and capabilities

```sql
create table if not exists public.semantic_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,  -- acts as repo_id
  stable_key varchar not null,
  record_level varchar not null check (record_level in (
    'symbol', 'file', 'module', 'service', 'system', 'workflow', 'capability', 'cluster'
  )),
  semantic_depth varchar not null check (semantic_depth in ('cheap', 'standard', 'full')),
  evidence_hash text not null,
  prompt_version text not null,
  model_family text not null,                     -- exact model stored in `model`
  record jsonb not null,                          -- fixed-schema structured record
  summary text not null,                          -- rendered display summary
  confidence varchar not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  facts_only boolean not null default false,      -- trivial symbol: no LLM call
  status varchar not null default 'pending'
    check (status in ('pending', 'usable', 'rejected', 'superseded')),
  flags jsonb not null default '[]',              -- honest-unknown / conflict flags
  child_record_ids uuid[] not null default '{}',  -- hierarchy links (synthesis inputs)
  receipt_ids uuid[] not null default '{}',
  model text,
  token_usage jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (project_id, stable_key, evidence_hash, prompt_version, semantic_depth, model_family)
);

create table if not exists public.snapshot_semantic_records (
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  record_id uuid not null references public.semantic_records(id) on delete cascade,
  node_id uuid references public.graph_nodes(id) on delete set null,
  stable_key varchar not null,
  record_level varchar not null,
  primary key (snapshot_id, record_id)
);

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
```

Records are **not** snapshot-scoped. `snapshot_semantic_records` maps which record is active for which target in a snapshot; that is what retrieval joins through. The canonical content-address key is:

```txt
project_id + stable_key + evidence_hash + prompt_version + semantic_depth + model_family
```

## Embeddings

```sql
create table if not exists public.embeddings (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.semantic_records(id) on delete cascade,
  view_type varchar not null check (view_type in ('purpose', 'domain', 'dependency', 'operations')),
  content text not null,                          -- deterministic rendering of record fields
  embedding vector(1536),
  provider text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (record_id, view_type, model)
);
-- HNSW index: using hnsw (embedding vector_cosine_ops)
```

## Packages, sections, tutorials, receipts, audit, staleness

```sql
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, scope_id, role, analyzed_commit)
);

create table if not exists public.ai_generation_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  package_id uuid references public.onboarding_packages(id) on delete cascade,
  target_type varchar not null,                   -- symbol_record | file_record | module_record |
                                                  -- service_record | system_record | capability_record |
                                                  -- workflow_record | refinement | critique | rerank |
                                                  -- section | tutorial | qa_answer | embedding_batch
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

create table if not exists public.package_sections (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.onboarding_packages(id) on delete cascade,
  snapshot_id uuid not null references public.analysis_snapshots(id) on delete cascade,
  generation_run_id uuid references public.ai_generation_runs(id) on delete set null,
  type varchar not null
    check (type in (
      'start_here', 'architecture', 'entry_points', 'critical_25', 'capability_map',
      'role_path', 'workflow_guide', 'data_schema', 'safety_rails',
      'dependency_graph', 'doc_health'
    )),
  title varchar not null,
  content text not null default '',
  diagrams jsonb not null default '[]',           -- [{"kind": "architecture", "mermaid": "..."}]
  confidence varchar not null default 'low' check (confidence in ('high', 'medium', 'low')),
  review_status varchar not null default 'draft'
    check (review_status in ('draft', 'approved', 'edited', 'stale', 'regenerate_requested')),
  analyzed_commit varchar not null,
  role varchar check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  unknowns jsonb not null default '[]',           -- first-class honest unknowns
  generation_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null
);

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
-- unique index (package_id, stable_key) where package_id is not null

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
  section_id uuid references public.package_sections(id) on delete cascade,
  record_id uuid references public.semantic_records(id) on delete cascade,
  tutorial_step_id uuid references public.tutorial_steps(id) on delete cascade,
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
  detection_expression text,                      -- for graph_edge receipts
  claim text,
  commit_hash varchar not null,
  confidence varchar not null default 'high' check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}'
);

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
```

Receipts are project-scoped (snapshot reference is `set null`) because content-addressed semantic records outlive snapshots; a receipt attached to a record must not disappear when an old snapshot is deleted.

## Graph neighborhood SQL function

Graph RAG expansion in plain SQL — recursive CTE with hop and fan-out caps, both edge directions, optional edge-type filter:

```sql
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
```

---

# Deterministic Layer

## Parser interface

Languages: TypeScript + JavaScript via the TS Compiler API with `allowJs: true`, behind a parser interface so future languages plug in without touching the pipeline:

```ts
export interface LanguageParser {
  id: string;                                   // 'typescript'
  supportedExtensions: string[];                // ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
  supports(filePath: string): boolean;
  createContext(files: RepoFileEntry[], rootPath: string): Promise<ParserContext>; // TS Program
  parseFile(ctx: ParserContext, filePath: string): ParsedFile;
  extractSymbols(ctx: ParserContext, parsed: ParsedFile): ExtractedSymbol[];
}
```

The TS implementation keeps `program.getTypeChecker()` available for cross-file call resolution. Raw ASTs are never stored — only extracted evidence.

## Language inventory and guardrail

During ingestion, every file gets a language + supported flag. The inventory is persisted on the snapshot:

```json
{
  "supported": { "typescript": 118, "javascript": 12 },
  "unsupported": { "go": 42, "python": 7 },
  "evidenceOnly": { "json": 20, "markdown": 9, "yaml": 6 },
  "supportedFileCount": 130,
  "unsupportedFileCount": 49
}
```

Hard guardrail: if `supportedFileCount === 0`, the snapshot **fails transparently** (`status = 'failed'`, unknown `{"kind": "unsupported_only_repo"}`) with the inventory as the report — the pipeline never hallucinates analysis of languages it cannot parse. Partially supported repos proceed and surface unsupported files as first-class unknowns. `evidenceOnly` files (configs, docs, schemas) are not "unsupported" — they feed the config scanner and docs ingestion but produce no symbols.

## Scope proposal

Deterministic proposal from repo inventory; the user confirms or overrides (manual path entry allowed, never the only way):

```txt
1. Always: whole repo ('' prefix, kind 'whole_repo').
2. package.json workspaces (and pnpm-workspace.yaml)  -> kind 'workspace_package'
3. docker-compose services with build contexts        -> kind 'docker_service'
4. Conventional top dirs when they contain a package.json or >= 10 source files:
   apps/*, packages/*, services/*, frontend, backend, server, client, api, worker
                                                       -> kind 'directory'
5. Deploy configs pointing at subdirectories (vercel.json, netlify.toml, Procfile)
```

Proposals are upserted into `analysis_scopes` with `detected_from`; duplicates by `path_prefix` are merged.

## Scope-bounded ingestion

The zipball flow is unchanged (GitHub archive download, no clone). Scope rules:

1. Only files under `path_prefix` are parsed and become `file` nodes / `repository_files` rows.
2. The privacy filter and ignored paths apply first, in every privacy mode.
3. Imports resolving outside the scope become `external` nodes (`stable_key = 'external:<specifier-or-repo-path>'`) with `references_external` / `imports` edges — graphs stay honest without exploding.
4. Repo-level inventory (workspaces, docker services, root configs) is always read for scope proposal and framework detection, even when the scope is a subdirectory.
5. Stable keys stay repo-local (full repo-relative paths) in every scope, so overlapping scopes share semantic records.

## Symbol extraction

`symbolExtractor.ts` (upgraded) — every symbol gets a stable identity, hashes, and a capped snippet:

```ts
export interface ExtractedSymbol {
  stableKey: string;          // 'backend/src/api/routes/projects.ts#createProject'
  name: string;
  kind: SymbolKind;           // function | method | class | interface | type | enum | variable
  filePath: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  signature?: string;
  params?: ParameterInfo[];
  returnType?: string;
  jsdoc?: string;             // ingested as docs-trust evidence
  callsSymbols: string[];     // TypeChecker-resolved where possible
  importsUsed: string[];
  behaviorSignals: string[];
  purposeSignals: string[];
  signatureHash: string;      // sha256 of normalized signature
  bodyHash: string;           // sha256 of normalized body text
  snippet: string;            // capped ~2k tokens; oversized bodies -> signature + selected slices
  isTrivial: boolean;         // see trivial classification
}
```

Stable key formats (repo-local — the project id disambiguates across repos):

```txt
relative/path.ts#SymbolName
relative/path.ts#ClassName.methodName
relative/path.ts#HTTP GET /api/projects
relative/path.ts#default
relative/path.ts                      (file)
doc:README.md#section-slug            (doc nodes)
config:docker-compose.yml             (config nodes)
schema:migrations/001_initial.sql#projects   (schema nodes)
external:express                      (external nodes)
```

Call resolution uses the TypeChecker (`checker.getResolvedSignature` / symbol resolution on call expressions); unresolved calls keep the callee text with `confidence: 'medium'` edges.

## Entrypoint detection

Same rule families as before, now emitting symbol-level nodes:

```txt
Express:    router|app.get/post/put/delete/patch(...)      -> http_route
React:      route config entries, pages dirs, App/main.tsx -> ui_route
Worker:     new Worker(...), queue.process(...)            -> worker_job
Scheduled:  cron.schedule(...), setInterval at module top  -> scheduled_job
CLI:        package.json bin, #!/usr/bin/env node          -> cli
Serverless: exported handler conventions                   -> serverless_handler
Package:    package.json main/exports                      -> package_export
```

## Side effect detection

Per-symbol AST scan (unchanged rule families):

```txt
database_read/write:  query('select|insert|update|delete ...'), supabase.from(...).*, prisma.*
queue_enqueue:        queue.add(...)
queue_consume:        new Worker(...)
http_request:         fetch(...), axios(...), octokit.*
auth_check:           jwt.verify(...), jose.jwtVerify(...), requireProjectAccess(...)
response_output:      res.json/send(...), Response.json(...)
env_read:             process.env.*
filesystem_*:         fs.*, fs/promises.*
```

Each detection stores the `evidence` expression text — this is what `graph_edge` receipts show.

## Config/schema/migration scanner

`configScanner.ts` walks non-source evidence files and emits `config` / `schema` nodes (`trust_level = 'config'`): tsconfig, vite, docker/compose, GitHub Actions, env examples, SQL migrations (parsed for `create table` -> one `schema` node per table), package scripts. `touches_schema` edges connect symbols whose detected queries mention a schema node's table name.

## Docs ingestion

READMEs, `doc/**`, and JSDoc blocks become `doc` nodes (`trust_level = 'docs'`), split per heading section with capped snippets, and `documents` edges to files/symbols they reference (path mentions, code-fence imports, JSDoc attachment). Doc evidence feeds synthesis prompts with explicit "docs may be stale, code wins" framing and is never allowed to be the sole support for a code-behavior claim.

## Churn signals

GitHub API commit stats (`GET /repos/:owner/:repo/commits?path=...` aggregated per directory + `stats/contributors`) — no clone needed, fits the zipball flow. Cached per snapshot in `repository_files.metadata.churn`:

```json
{ "commitCount90d": 14, "lastTouchedAt": "2026-06-21T10:02:00Z", "distinctAuthors": 3 }
```

Fetched with a small request budget (one page per top-level dir + per top-N candidate files); missing churn degrades to 0-weight, never blocks analysis.

## Preflight endpoint

`POST /projects/:id/preflight` `{ scopeId?, commit?, depth? }` runs a `preflight` job (inventory + shallow syntactic parse only) and returns the analysis preview described under "Analysis preview (preflight)". No snapshot rows are mutated; results are stored on the job's `step_log` for the modal.

---

# Workflows, Candidate Ranking, Clusters

## Workflow extraction (call-graph, replaces import-BFS)

```txt
1. Start from every entrypoint node.
2. Traverse outgoing calls, handles_route, registers_callback, enqueues_job,
   handles_job, touches_schema edges (maxDepth 8).
3. Stop a path when it reaches a meaningful side effect or response output.
4. Keep paths with >= 1 side effect or output.
5. Collapse noisy helpers (trivial symbols, logging, pure formatting).
6. Classify purpose from entrypoint + side-effect types + purpose signals.
7. Convert into ordered workflow_steps with step kinds and deterministic descriptions.
8. If no workflows are found, record the snapshot unknown {"kind": "no_workflows_found"} —
   never invent one.
```

Cross-boundary steps (calls into `external` nodes) terminate the trace with a step noting the external dependency — an honest unknown, not a guess.

## Phase A: deterministic candidate ranking

Cheap, auditable, runs **before** any LLM call. Writes `criticality_scores` rows with `phase = 'candidate'`, `view = 'candidate'` for symbols, files, workflows, modules, schemas, configs, tests. Its jobs: decide what deserves semantic analysis (depth gating), seed workflow/tutorial selection, and give `ai_disabled` projects a useful ranking.

Signals and default weights (constants; breakdown stored in `score_breakdown`, human reasons in `reasons`):

| Signal | Weight |
| --- | --- |
| workflow participation | 0.20 |
| fan-in/fan-out centrality | 0.15 |
| exported/public surface | 0.15 |
| side effects (DB/API/job/env) | 0.15 |
| entrypoint participation | 0.10 |
| route/schema ownership | 0.10 |
| test coverage proximity | 0.05 |
| config/deployment relevance | 0.05 |
| churn (GitHub API stats) | 0.05 |

Every signal is normalized to [0, 1] within the snapshot before weighting. Ranking reasons are always stored ("Handles POST /api/projects", "Called by 14 symbols", "Writes projects table") — scores are never presented without reasons.

## Depth gating (candidate ranking -> semantic pass)

Which symbols get LLM semantic records, by `semantic_depth`:

```txt
cheap:     symbols that are (exported AND on the public surface) OR route/controller
           handlers OR entrypoint handlers, ordered by candidate score,
           capped at the cheap budget (<= 600 symbols). Target ~ top 25%.
standard:  cheap set + all workflow participants + major internal services
           (fan-in >= 5 or cluster-central), capped at <= 2,000 symbols.
full:      every symbol including trivial ones, capped at <= 10,000 symbols.
```

Everything not selected still gets a **facts-only record** (deterministic fields, `facts_only = true`, no LLM call), so retrieval always has something honest to return.

## Architecture clustering (deterministic)

`architectureClusterer.ts` fills the previously-empty `architecture_*` tables:

```txt
1. Path-based grouping (frontend/src/pages -> Frontend Pages, backend/src/api/routes -> API...).
2. Framework-based kind assignment (React -> frontend_ui, Express -> api_layer,
   Supabase/pg -> database_layer, BullMQ -> worker_layer, Docker/CI -> devops_layer).
3. Collapse node edges into weighted cluster edges; attach workflow crossings.
4. critical_score = aggregate of member candidate scores.
5. deterministic_summary from member facts (no LLM).
```

The LLM later labels/explains clusters (cluster-level semantic records); it never invents clusters.

**Interim UI baseline (pre-rework).** The current frontend Architecture tab, class graph, and workflow graph views are served by transitional endpoints (`GET /projects/:id/graph/architecture`, `/graph/classes`, `/graph/workflows/:workflowId`) that return the raw file-level module graph and let the frontend derive component groupings client-side. These are stopgaps on the old file-level graph: Phase 3 replaces the grouping with server-side deterministic `architecture_*` clustering, and Phase 10 rebuilds the Architecture Map and Dependency Graph UI on cluster data with criticality reasons, receipts, and drill-down to symbol-level views. Do not extend the client-side grouping further.

---

# LLM Infrastructure

## Provider abstraction

```ts
export interface AiProvider {
  id: string;                                       // 'openrouter'
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<T>;   // JSON-schema strict
  embed(inputs: string[], model: string): Promise<number[][]>;
}
```

Only `OpenRouterProvider` exists for now (OpenAI SDK with `baseURL: https://openrouter.ai/api/v1`). Structured outputs use `response_format: { type: 'json_schema', strict: true }`; if the configured model rejects strict schemas, fall back to JSON-only prompting + server-side schema validation + one retry, then apply the tier's failure behavior.

Key resolution per call: project key (`project_llm_keys`, decrypted) if present, else server key. `ai_generation_runs.key_source` records which.

## Budget enforcement

A `BudgetEnforcer` wraps every provider call: increments `budget_usage` counters (calls, input/output tokens, estimated cost, runtime), checks limits **before** dispatching each batch, and triggers the configured stop behavior when a limit trips. Runtime is checked between batches. Kill switch: setting the job status to `paused`/`failed` from the API is honored at the next batch boundary.

## Checkpointing and resume

Each LLM phase iterates a deterministic, ordered target list. The checkpoint stores the ordinal position + batch identity. On resume: recompute the target list (deterministic), skip targets whose records/embeddings already exist (content-address lookup), continue from the checkpoint. `ai_generation_runs.input_hash` = sha256 of the full request payload; a run with an existing `complete` row for the same hash is recorded as `skipped_cached`.

## Auditing

Every LLM/embedding call writes an `ai_generation_runs` row (provider, model, tier, key source, prompt version, input/output hashes, token usage, estimated cost, latency, status). This is the raw data for the observability metrics and the cost UI.

---

# Semantic Pass

## Semantic record schema (fixed, structured outputs)

The symbol pass produces this JSON — never freeform prose:

```json
{
  "purpose": "1-2 sentences: what this symbol is for.",
  "behavior": "Step-level description of what it does, in order.",
  "responsibilities": ["..."],
  "business_concepts": ["project import", "analysis job"],
  "side_effects": [
    { "kind": "database_write", "description": "...", "mergedWithDeterministic": true }
  ],
  "inputs_outputs": {
    "inputs": [{ "name": "opts", "type": "RunAnalysisOptions", "meaning": "..." }],
    "outputs": [{ "type": "Promise<AnalysisSnapshot>", "meaning": "..." }]
  },
  "dependencies_narrative": "Why it calls what it calls.",
  "design_patterns": ["orchestrator"],
  "risks_invariants": ["Must run after ingestion; assumes files exist on disk."],
  "confidence": "high",
  "claims": [
    { "claim": "...", "receiptIds": ["r1"], "confidence": "high" }
  ]
}
```

Level-specific additions:

```txt
file:     key_symbols[], file_role (route file / service / util / config glue)
module:   key_files[], internal_structure, boundary_contracts
service:  responsibilities across modules, runtime shape (api/worker/frontend)
system:   what the product does, main capabilities, architecture narrative,
          how a request flows end to end   <- the "whole picture without a README"
workflow: step_narrative[], failure_modes[]
capability: user_value, involved_workflows[], involved_modules[]
cluster:  label_explanation, boundary_rationale
```

Evidence hash: `evidence_hash = sha256(canonical JSON of the deterministic input bundle)` — symbol body/signature hashes, callers/callees stable keys + hashes, detected side effects, and (for synthesis levels) child record ids + their evidence hashes. Unchanged evidence -> cache hit -> no LLM call.

## Trivial symbol classification (deterministic, no LLM)

A symbol is trivial when **all** hold: body <= 3 statements; no detected side effects; no branching; and it matches one of: constant/literal initializer, simple type alias (no mapped/conditional types), pass-through helper (single delegated call), dumb React wrapper (single JSX return, no hooks), getter/setter. Trivial symbols get facts-only records — except at `full` depth, where everything selected gets an LLM record.

## Batching

Per-file symbol grouping with hard limits — never naive one-call-per-file:

```txt
<= 15 symbols per call
<= ~2k tokens per symbol snippet
<= ~12k input tokens per request
Files exceeding limits are split into multiple symbol-group calls.
Oversized functions send signature + selected body slices + deterministic facts.
Failed symbols are retried individually, not the whole file.
```

## Cache policy (canonical, applies everywhere)

Lookup key: `project_id + stable_key + evidence_hash + prompt_version + semantic_depth + model_family` (exact model in metadata).

- Records are shared across scopes of the same repo — overlapping scopes (whole repo vs `backend/`) never re-pay LLM cost for shared symbols; only synthesis levels above the scope boundary differ.
- Prompt version or model family change = cache miss. Old records are kept for audit (`status = 'superseded'`), never silently reused.
- Depths coexist; higher depth never blindly overwrites lower. Lookup order for `standard` needs: `full` -> `standard` (-> `cheap` only where explicitly allowed); for `full` needs: `full` only. A higher-depth record substitutes for lower-depth needs, never the reverse.
- Depth upgrades (cheap -> standard -> full) fill only the missing records; cheap records are kept for audit/cost comparison.

## Prompts (versioned; all use structured outputs)

All prompts share output rules: *use only provided evidence; cite receipt ids per claim; do not guess business intent beyond the evidence; docs receipts may be stale — code receipts win; say "unknown" rather than invent.*

**`symbol-record-v1`** (cheap tier) — input: deterministic facts (signature, params, callers/callees, detected side effects, behavior signals, env/config touched) + snippet (privacy-mode permitting) + JSDoc/doc receipts. Output: the symbol record schema above. Batched.

**`file-synthesis-v1`** (strong tier) — input: file facts (imports/exports, category) + all child symbol records (summaries + purposes) + doc receipts for the file. Output: file record.

**`module-synthesis-v1`** (strong tier) — input: cluster/directory facts + child file records + cross-module edges. Output: module record.

**`service-synthesis-v1`** (strong tier) — input: module records + runtime facts (entrypoints, deploy configs). Output: service record.

**`system-synthesis-v1`** (strong tier) — input: service records + capability candidates + top workflows + architecture map. Output: the system record — the whole-repo picture; must work when no README exists.

**`capability-extraction-v1`** (strong tier) — input: workflows + module records + business_concepts aggregation. Output: capability list with members and evidence links; stored as `capabilities` rows + capability records.

**`refinement-v1`** (strong tier) — re-annotates the top-N critical symbols/files with system context (why this matters to the product), producing new record versions (new prompt_version, same evidence).

**`critique-v1`** (strong tier) — verifies each record's claims against its receipts; output per record: `verdict: usable | rejected`, per-claim pass/fail, missing-evidence notes. Records must be `usable` before retrieval/generation may use them; rejected records are regenerated once with the critique attached, then kept `rejected` if they fail again (honest unknown).

**`workflow-record-v1`** (strong tier) — narrative record per selected workflow from its steps + participating symbol records.

## Phase B: semantic reranking

After synthesis, the strong model + deterministic aggregation produce multi-view scores (`phase = 'semantic'`), one row per (view, target):

```txt
critical_for_runtime       what breaks the app when wrong (side effects, load-bearing paths)
critical_for_business      business/domain importance (capability ownership)
critical_for_onboarding    what a newcomer must understand first
critical_for_role          per role: backend/frontend/devops/qa/general (one row each)
critical_for_change_risk   operational risk, invariants, migration/config sensitivity
critical_for_architecture  boundary importance, coupling points
critical_for_workflow      workflow criticality
```

Method (`rerank-v1`): batched LLM scoring of the candidate top slice per view with reasons + evidence citations, blended 50/50 with deterministic per-view features, normalized within the snapshot. This catches low-degree but vital code (auth helpers, migrations, retry handlers, config loaders) that Phase A under-ranks.

## Weight configs and projections

A role's ranking = weighted sum over view scores using `ranking_weight_configs` (or code defaults). Default weights:

| View | backend | frontend | devops | qa | general |
| --- | --- | --- | --- | --- | --- |
| critical_for_runtime | 0.20 | 0.10 | 0.20 | 0.10 | 0.15 |
| critical_for_business | 0.10 | 0.15 | 0.05 | 0.10 | 0.20 |
| critical_for_onboarding | 0.15 | 0.20 | 0.10 | 0.15 | 0.25 |
| critical_for_role | 0.25 | 0.25 | 0.25 | 0.25 | 0.10 |
| critical_for_change_risk | 0.10 | 0.05 | 0.20 | 0.20 | 0.10 |
| critical_for_architecture | 0.10 | 0.15 | 0.15 | 0.05 | 0.15 |
| critical_for_workflow | 0.10 | 0.10 | 0.05 | 0.15 | 0.05 |

"Critical 25%" = top 25% of targets per target_type by the role projection. Tutorial selection, learning paths, and Q&A priorities are also projections. A project admin can adjust weights per role in settings (with per-role revert-to-default); since raw view scores are stored, re-weighting is instant.

---

# Multi-view Embeddings

One row per (usable record, view, model), pgvector 1536 (`text-embedding-3-small`), HNSW index. Embedding text is rendered **deterministically** from record fields — never freeform:

```txt
purpose view:     name, kind, purpose, behavior, responsibilities
domain view:      business_concepts, capability names, purpose
dependency view:  dependencies_narrative, caller/callee names, imports
operations view:  side_effects, risks_invariants, env/config touched, failure modes
```

Example renderer (purpose view):

```txt
{kind} {name} in {filePath}.
Purpose: {purpose}
Behavior: {behavior}
Responsibilities: {responsibilities joined}
```

Facts-only records get purpose/dependency/operations views rendered from deterministic facts. Query-time view selection is by intent: "what does X do" -> purpose; "what handles payments" -> domain; "what calls/uses X" -> dependency; "what breaks if X fails" -> operations; section generation declares its views (see each section spec).

---

# Retrieval (Graph RAG)

One retrieval service powers section generation, tutorials, regeneration, and Q&A:

```txt
1. Embed the query (or section objective) once per relevant view.
2. pgvector top-k per view (k ~ 8), filtered to the snapshot via
   snapshot_semantic_records, records status = 'usable' (or facts_only).
3. Map hits to graph nodes (stable_key join).
4. graph_neighborhood(snapshot, seeds, max_hops 1-2, edge_types by intent).
5. Join: semantic records for expanded nodes, workflows touching them,
   receipts, criticality reasons.
6. Dedupe by stable_key (best score wins), score = vector similarity
   + criticality projection boost, cap bundle size (~40 records / ~15 receipts).
7. Assemble the evidence bundle (privacy mode enforced mechanically here).
```

Vector seed SQL:

```sql
select ssr.stable_key, sr.id as record_id, sr.summary, sr.record_level,
       e.view_type, 1 - (e.embedding <=> $1::vector) as similarity
from public.embeddings e
join public.semantic_records sr on sr.id = e.record_id
join public.snapshot_semantic_records ssr
  on ssr.record_id = sr.id and ssr.snapshot_id = $2
where e.view_type = any($3)
  and sr.status = 'usable'
order by e.embedding <=> $1::vector
limit $4;
```

The evidence bundle type (extended from v1):

```ts
export interface EvidenceBundle {
  bundleVersion: '2.0';
  task: string;
  sectionType?: PackageSectionType;
  role?: DeveloperRole;
  privacyMode: 'full_ai' | 'facts_only_ai';
  repo: { owner: string; name: string; branch: string; commit: string };
  scope: { id: string; pathPrefix: string; displayName: string };
  deterministicContext: Record<string, unknown>;   // rankings, graph facts, inventory
  semanticContext: Array<{
    recordId: string; recordLevel: string; stableKey: string;
    summary: string; record: unknown;              // structured record fields
    confidence: 'high' | 'medium' | 'low'; receiptIds: string[];
  }>;
  receipts: Array<{
    receiptId: string; receiptKind: ReceiptKind; trustLevel: TrustLevel;
    nodeStableKey?: string; filePath?: string; symbolName?: string;
    lineStart?: number; lineEnd?: number;
    snippet?: string;                              // stripped in facts_only_ai
    detectionExpression?: string;                  // graph_edge receipts
    referencedRecordId?: string;                   // record_reference receipts
  }>;
  unknowns: Array<{ kind: string; detail?: string }>;
  outputRules: {
    useOnlyProvidedEvidence: true;
    citeEverySubstantiveClaim: true;
    codeReceiptsWinOverDocs: true;
    stateUnknownsExplicitly: true;
  };
}
```

---

# Generation

Sections are generated one at a time per (scope, role, commit) — each with its own deterministic query, semantic retrieval, bundle, strong-tier LLM call, inline validation, and stored `generation_context`. Never one giant call.

Common output schema (structured): `title`, `contentMarkdown`, `confidence`, `claims[] {claim, receiptIds, confidence}`, `usedReceiptIds[]`, `unknowns[]`, optional `diagrams[] {kind, mermaid}`.

| Section | Deterministic retrieval | Semantic retrieval (views) | Notes |
| --- | --- | --- | --- |
| `start_here` | inventory, top clusters, top role-projected files/modules, scripts, entrypoints | system + service records; "repo purpose, main subsystems, first files for ROLE" (purpose, domain) | 3-6 paragraphs + read-first list |
| `architecture` | clusters, cluster edges, workflow crossings | cluster + module records (purpose, dependency) | embeds architecture Mermaid diagram from cluster edges |
| `entry_points` | entrypoints by role relevance + criticality, handler symbols, connected workflows | entrypoint symbol records (purpose) | routes/jobs/CLI and why each matters |
| `critical_25` | role projection top 25% per target_type with reasons + breakdowns | records for those targets; "why these matter for ROLE" (purpose, domain) | explain by category with ranking reasons, never dump scores |
| `capability_map` | capabilities + members + workflows | capability + system records (domain) | business context: what the product does and where |
| `role_path` | role projection + capabilities + tutorials | onboarding-view ordering rationale (purpose, domain) | ordered learning path with reasons |
| `workflow_guide` | workflow + steps + entrypoint + side effects + ranking reasons | workflow + participant records (purpose, operations) | one subsection per selected workflow |
| `data_schema` | schema nodes, DB side effects, migrations, workflows touching tables | schema-adjacent records (operations, dependency) | source-of-truth objects and who reads/writes them |
| `safety_rails` | scripts, tests, CI, Docker, env examples, risky side effects | operations-view records; risks_invariants (operations) | commands, tests to trust, risky areas |
| `dependency_graph` | graph slice for the UI view | dependency-view records for hover summaries (dependency) | mostly deterministic |
| `doc_health` | stale_flags, changed files/symbols, affected artifacts, docs-conflict flags | none | deterministic content, LLM phrasing optional |

Diagram-bearing sections (`architecture`, `data_schema`, `workflow_guide`) get Mermaid diagrams **derived from deterministic data** (cluster edges, schema references, workflow steps); the LLM may caption them but does not invent nodes/edges. The frontend Diagrams tab aggregates section + tutorial diagrams.

## Request-flow tutorials

Generated from symbol-level workflow traces — traced real examples, not prose essays:

```txt
1. Select workflows: top critical_for_workflow x role projection (default 3-5 per package).
2. For each workflow step: fetch node snippet + symbol record + step evidence.
3. tutorial-v1 (strong tier): per-step explanation (what happens, why it matters,
   what to look at) citing the step receipt; plus title + summary.
4. Generate a Mermaid sequence diagram (dataflow for data-heavy workflows)
   deterministically from the trace: participants = files/services, arrows = steps.
5. Persist tutorials + tutorial_steps (snippet, file/lines, explanation, receipts).
6. Validate citations like sections.
```

Each step = code snippet + explanation + file/line receipt. Tutorials are shown in the tutorials UI and linked from `workflow_guide` sections.

## Symbol doc format (UI standard)

Every symbol shown in the UI follows one format, assembled from the record + graph:

```txt
1. One-line summary            (record.purpose, first sentence)
2. Params/types                (deterministic signature)
3. Returns                     (deterministic)
4. Real example usage          (call-site snippet pulled from the graph's callers)
5. Receipts                    (file/line links)
```

## Citation validation (in-pipeline, trust-aware)

Runs inline during generation (retry once with stricter prompt on failure) and as the `validation` phase:

```txt
1. Every used receipt id exists in the bundle.
2. Every cited receipt belongs to the same snapshot/commit lineage.
3. Claims naming files/symbols must cite receipts from those files/symbols.
4. Uncited claims are rejected or downgraded to low confidence + listed in unknowns.
5. Trust: claims about code behavior need >= 'tests' trust; docs-only support
   downgrades to medium and flags docs_conflict_with_code when code disagrees.
6. record_reference receipts resolve transitively to code-level receipts;
   unresolvable chains fail validation.
7. Section confidence = min reasonable confidence of major claims.
8. Everything starts as draft.
```

## Regeneration

`regenerate_section` job: rebuild that section's bundle against the same snapshot (or a newer one when regenerating from stale), regenerate, revalidate, replace content, keep the old `generation_run` for audit. Actually implemented in this rework, not just an API stub.

---

# Q&A Evaluation Endpoint (dev tool, not a product feature)

`POST /projects/:id/ask`:

```json
{ "question": "...", "scope_id": "optional", "role": "optional", "snapshot_id": "optional" }
```

Defaults: whole-repo scope, `general` role, latest complete snapshot — answers never mix unrelated scopes/packages. Flow: intent -> view selection -> retrieval (same service) -> `qa-v1` grounded answer:

```json
{
  "answerMarkdown": "...",
  "claims": [{ "claim": "...", "receiptIds": ["r1"], "confidence": "high" }],
  "receipts": [{ "receiptId": "r1", "filePath": "...", "lineStart": 10, "lineEnd": 30, "snippet": "..." }],
  "confidence": "high",
  "unknowns": [{ "kind": "out_of_scope_dependency", "detail": "payment provider SDK not in scope" }]
}
```

Answers are validated with the same citation validator. A minimal internal chat page (dev-only flag) renders this for manual quality evaluation. Q&A runs are audited in `ai_generation_runs` (`target_type = 'qa_answer'`) but not persisted as content.

---

# Incremental Updates

`incrementalAnalyzer.ts`, triggered by `incremental_update` jobs (new commit on an analyzed scope):

```txt
 1. Download new zipball for the target commit; new snapshot row (trigger 'incremental').
 2. Recompute repository_files hashes; diff against the previous snapshot of the scope.
 3. Re-parse changed files only; copy nodes/edges of unchanged files forward.
 4. Recompute symbol signature_hash/body_hash; symbol-level AST diff by stable_key.
 5. Changed symbols -> their semantic records' evidence hashes no longer match
    -> new records needed (content-address lookup misses).
 6. Staleness propagates upward (symbol -> file -> module -> service -> system)
    ONLY when the child evidence hash actually changes the parent's evidence hash.
 7. Re-run workflows/rankings/clusters on the affected subgraph; unchanged
    subgraphs keep prior results (copied forward).
 8. Insert stale_flags for affected records, sections, tutorials, packages;
    mark sections/packages 'stale'.
 9. Partial regeneration: re-summarize only invalidated targets, re-embed only
    new records, regenerate only stale sections/tutorials when requested.
10. Unchanged symbols are NEVER re-summarized (content-address guarantees it).
```

---

# Implementation Files

Keep and extend existing engine files; add the rest:

```txt
backend/src/worker/engine/
  parserInterface.ts        LanguageParser + TS implementation glue
  repoIngester.ts           (extend) scope-bounded ingestion, inventory, language guardrail
  privacyFilter.ts          secret stripping, ignored paths
  hashUtils.ts              sha256 helpers, canonical JSON hashing
  stableKeys.ts             stable key construction for all node kinds
  astParser.ts              (keep) TS Program creation
  symbolExtractor.ts        (extend) hashes, snippets, TypeChecker call resolution, trivial classification
  behaviorSignals.ts        behavior/purpose signal detection
  entrypointDetector.ts     (extend) symbol-level
  sideEffectDetector.ts     (extend) symbol-level, evidence expressions
  configScanner.ts          config/schema/migration nodes
  docsIngester.ts           README/docs/JSDoc -> doc nodes
  churnService.ts           GitHub API commit stats, cached
  evidenceGraphBuilder.ts   symbol-level graph persistence with trust levels
  workflowExtractor.ts      (rewrite) call-graph traversal
  candidateRanker.ts        Phase A scores + depth gating
  architectureClusterer.ts  deterministic clusters
  preflightService.ts       analysis preview estimates
  budgets.ts                depth budgets, size caps, cost tiers (constants)

backend/src/worker/ai/
  aiProvider.ts             AiProvider interface
  openRouterProvider.ts     OpenRouter implementation
  budgetEnforcer.ts         counters + stop behavior
  promptBuilders.ts         per prompt version, privacy-mode aware
  semanticRecordService.ts  symbol pass: gating, batching, caching
  synthesisService.ts       file/module/service/system + refinement + critique
  capabilityExtractor.ts    capability pass
  semanticReranker.ts       Phase B multi-view scores
  embeddingService.ts       (retarget) multi-view embeddings
  retrievalService.ts       vector seed + graph expansion + bundle assembly
  sectionGenerator.ts       section-by-section generation
  tutorialGenerator.ts      traces -> steps -> diagrams
  citationValidator.ts      trust-aware validation (replaces sectionValidator.ts)
  qaService.ts              grounded /ask

backend/src/worker/
  incrementalAnalyzer.ts    diff + invalidation + partial regeneration
  phaseRunner.ts            snapshot_phases orchestration, checkpoints, resume
```

Deleted: the old section-markdown embedding path and the unused `hybridRetrieve`.

# Build Order

```txt
Phase 1  (done with this spec): migration 001 — full schema above.
Phase 2  Deterministic layer: parser interface, scope ingestion, guardrails,
         symbol extraction, graph persistence, docs/config ingestion, preflight.
Phase 3  Workflows (call-graph), Phase A candidate ranker, clusters.
Phase 4  LLM infra: provider, structured outputs, auditing, budgets,
         checkpoint/resume, BYO keys, privacy-mode bundles.
Phase 5  Semantic pass: symbol records, synthesis, capabilities,
         refinement/critique, Phase B reranking.
Phase 6  Embeddings + retrieval; delete old RAG.
Phase 7  Generation: sections, tutorials + diagrams, validation, regeneration.
Phase 8  Q&A eval endpoint + internal chat page.
Phase 9  Incremental analyzer.
Phase 10 API + frontend adaptation.
Phase 11 Tests + end-to-end verification; update Design.md/BACKEND.md/TESTING.md.
```

# What Gets Sent To The LLM

Send (subject to privacy mode): selected deterministic facts, ranked targets with reasons, semantic records, capped snippets, receipt ids, strict output rules.

Never send: raw full repository, raw ASTs, all files, secret-bearing files, uncapped graph dumps, unvalidated user-supplied claims.

```txt
AST/config/git graph decides what is true.
Structured semantic records preserve meaning, hierarchically.
Multi-view embeddings + graph expansion retrieve relevant meaning.
Section generation explains the selected evidence, per scope, role, and commit.
Receipts with trust levels prove where every explanation came from.
```
