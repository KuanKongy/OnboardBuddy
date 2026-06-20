# OnboardBuddy Analysis and Onboarding Pipeline

This document is the implementation plan for turning a Git repository into a persistent, role-specific Codebase Onboarding Package.

The core rule is:

```txt
AST/config/git evidence is the source of truth.
LLM summaries preserve semantic context.
Embeddings retrieve relevant stored summaries.
LLM package generation writes explanations from retrieved evidence.
Receipts and hashes make the result auditable and incrementally refreshable.
```

AST data alone is not enough. A heavily transformed AST can say that a function calls `query` and imports `enqueueAnalysisJob`, but it cannot reliably preserve the whole-system meaning of a file or module. OnboardBuddy should therefore use a two-layer model:

1. Deterministic evidence layer: symbols, files, edges, workflows, rankings, architecture clusters, hashes, receipts.
2. Semantic layer: generated symbol/file/module/workflow summaries with citations, embedded for retrieval.

The onboarding package is generated section by section from both layers.

## External References

- TypeScript Compiler API: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- OpenRouter quickstart and OpenAI SDK compatibility: https://openrouter.ai/docs/quickstart
- OpenAI structured outputs: https://platform.openai.com/docs/guides/structured-outputs
- OpenAI embeddings: https://platform.openai.com/docs/guides/embeddings
- Supabase pgvector: https://supabase.com/docs/guides/database/extensions/pgvector

## Current Repo Starting Point

The repo already has the first version of the analysis worker:

```txt
backend/src/worker/engine/repoIngester.ts
  Finds TypeScript/JavaScript files and filters ignored folders.

backend/src/worker/engine/astParser.ts
  Creates a TypeScript Program, parses SourceFiles, exposes TypeChecker.

backend/src/worker/engine/symbolExtractor.ts
  Extracts imports, exports, classes, interfaces, functions, variables, methods, calls.

backend/src/worker/engine/graphBuilder.ts
  Builds the current file-level import graph.

backend/src/worker/engine/analysisRunner.ts
  Runs indexing -> parsing -> extraction -> graph building.

backend/src/worker/types/analysis.ts
  Defines FileAnalysis, SymbolInfo, GraphNode, GraphEdge, AnalysisSnapshot.
```

The implementation should extend these files instead of replacing them.

## Final Pipeline

```txt
1. Create analysis job
2. Download temporary GitHub archive
3. Apply privacy filters
4. Build repo inventory
5. Parse TypeScript/TSX with TypeScript Compiler API
6. Scan configs, docs, tests, package scripts, Docker, CI
7. Extract symbols, imports, exports, calls, side effects, entrypoints
8. Build code evidence graph
9. Extract candidate workflows from entrypoints to side effects
10. Rank Critical 25% for workflows, files, symbols, modules, schemas, configs, tests
11. Build architecture clusters and architecture map
12. Generate cited symbol/file/module/workflow summaries
13. Embed summaries for retrieval
14. Generate onboarding package section by section
15. Validate citations and confidence
16. Store package sections, source receipts, generation context
17. On re-analysis, compare hashes and stale only impacted summaries/sections
```

## Database Schema

Use PostgreSQL/Supabase as the durable store. Use relational tables for things that need joins and JSONB for flexible AST/config metadata. Do not store raw ASTs or full repository source by default.

Enable pgvector if embeddings are used:

```sql
create extension if not exists vector;
```

### Project and Job Tables

These support repo ownership, access, and async worker execution.

```sql
create table github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  github_user_id text not null,
  github_username text not null,
  encrypted_access_token text not null,
  granted_scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  repo_owner text not null,
  repo_name text not null,
  repo_full_name text generated always as (repo_owner || '/' || repo_name) stored,
  branch text not null,
  default_branch text,
  github_installation_id text,
  last_analyzed_commit text,
  status text not null default 'created',
  ignored_paths text[] not null default '{}',
  ai_enabled boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null,
  permission_tier text not null check (permission_tier in ('owner', 'admin', 'developer')),
  developer_role text check (developer_role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  snapshot_id uuid,
  requested_by uuid not null,
  job_type text not null check (job_type in ('analyze_project', 'generate_onboarding', 'regenerate_section', 'embed_summaries')),
  role text check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  status text not null check (status in ('queued', 'running', 'complete', 'failed')),
  progress_pct integer not null default 0,
  current_step text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
```

### Snapshot and File Tables

`analysis_snapshots` records a commit-level analysis. `repository_files` stores per-file identity and hashes for incremental re-analysis.

```sql
create table analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  commit_hash text not null,
  branch text not null,
  trigger_type text not null check (trigger_type in ('manual', 'initial', 'incremental', 'regeneration')),
  status text not null check (status in ('running', 'complete', 'failed')),
  file_count integer not null default 0,
  symbol_count integer not null default 0,
  workflow_count integer not null default 0,
  duration_ms integer,
  errors jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table repository_files (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  stable_key text not null,
  file_path text not null,
  language text not null,
  category text not null,
  size_bytes integer not null,
  line_count integer,
  hash text not null,
  metadata jsonb not null default '{}',
  unique (snapshot_id, stable_key)
);
```

Example `repository_files.metadata`:

```json
{
  "extension": ".tsx",
  "isTest": false,
  "isConfig": false,
  "package": "frontend",
  "pathSegments": ["frontend", "src", "pages"]
}
```

### Code Evidence Graph

The graph stores files, symbols, configs, schemas, tests, and relationships. It is used by architecture views, workflow extraction, ranking, stale detection, and LLM grounding.

```sql
create table graph_nodes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  stable_key text not null,
  type text not null check (
    type in (
      'file', 'module', 'function', 'method', 'class', 'interface', 'type',
      'enum', 'variable', 'entrypoint', 'schema', 'test', 'config', 'doc'
    )
  ),
  name text not null,
  file_path text,
  line_start integer,
  line_end integer,
  hash text,
  metadata jsonb not null default '{}',
  unique (snapshot_id, stable_key)
);

create table graph_edges (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  source_node_id uuid not null references graph_nodes(id) on delete cascade,
  target_node_id uuid not null references graph_nodes(id) on delete cascade,
  type text not null check (
    type in (
      'imports', 'exports', 'calls', 'extends', 'implements',
      'registers_callback', 'handles_route', 'touches_schema',
      'reads_env', 'queries_database', 'writes_database',
      'enqueues_job', 'handles_job', 'http_calls',
      'tests', 'documents', 'contains', 'depends_on'
    )
  ),
  confidence text not null default 'high' check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}',
  unique (snapshot_id, source_node_id, target_node_id, type)
);
```

Example `graph_nodes.metadata` for a route:

```json
{
  "signature": "(req: Request, res: Response) => Promise<void>",
  "params": ["req", "res"],
  "returnType": "Promise<void>",
  "exported": false,
  "behaviorSignals": ["http_route", "database_write", "queue_enqueue"],
  "purposeSignals": ["project_import", "analysis_start"],
  "signatureHash": "sha256:...",
  "bodyHash": "sha256:..."
}
```

Example edge:

```json
{
  "type": "enqueues_job",
  "metadata": {
    "queueName": "analysis",
    "detectedFrom": "CallExpression",
    "expression": "analysisQueue.add(...)"
  }
}
```

### Entrypoints and Side Effects

These tables make workflow extraction queryable instead of hiding all detection details in JSON.

```sql
create table entrypoints (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  node_id uuid not null references graph_nodes(id) on delete cascade,
  trigger_type text not null check (
    trigger_type in (
      'http_route', 'ui_route', 'event_listener', 'worker_job',
      'scheduled_job', 'serverless_handler', 'cli', 'package_export'
    )
  ),
  method text,
  route_path text,
  runtime text,
  role_relevance jsonb not null default '{}',
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}'
);

create table side_effects (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  node_id uuid not null references graph_nodes(id) on delete cascade,
  type text not null check (
    type in (
      'database_read', 'database_write', 'http_request', 'queue_enqueue',
      'queue_consume', 'filesystem_read', 'filesystem_write',
      'auth_check', 'env_read', 'response_output', 'external_integration'
    )
  ),
  target text,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  evidence text not null,
  metadata jsonb not null default '{}'
);
```

### Workflow Tables

A workflow is not every path. It is a selected candidate path that starts from an entrypoint and reaches meaningful side effects or outputs.

```sql
create table workflows (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  stable_key text not null,
  title text not null,
  trigger_type text not null,
  purpose text not null,
  entrypoint_id uuid references entrypoints(id),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}',
  unique (snapshot_id, stable_key)
);

create table workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  step_order integer not null,
  node_id uuid not null references graph_nodes(id) on delete cascade,
  file_path text,
  symbol_name text,
  line_start integer,
  line_end integer,
  step_kind text not null,
  deterministic_description text,
  role_relevance jsonb not null default '{}',
  metadata jsonb not null default '{}',
  unique (workflow_id, step_order)
);

create table workflow_scores (
  workflow_id uuid primary key references workflows(id) on delete cascade,
  entrypoint_exposure numeric not null,
  downstream_impact numeric not null,
  structural_centrality numeric not null,
  external_side_effects numeric not null,
  documentation_gap numeric not null,
  test_coverage_signal numeric not null,
  git_churn_recency numeric not null,
  composite_score numeric not null,
  ranking_reasons text[] not null default '{}',
  metadata jsonb not null default '{}'
);
```

### Critical 25% Rankings For Everything

Critical 25% is not only workflows. Store a unified ranking table for every target type.

```sql
create table critical_rankings (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  role text not null check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  target_type text not null check (
    target_type in ('workflow', 'file', 'symbol', 'module', 'schema', 'config', 'test')
  ),
  target_id uuid not null,
  stable_key text not null,
  composite_score numeric not null,
  percentile numeric not null,
  is_critical_25 boolean not null,
  ranking_reasons text[] not null default '{}',
  score_breakdown jsonb not null default '{}',
  metadata jsonb not null default '{}',
  unique (snapshot_id, role, target_type, target_id)
);
```

Example row:

```json
{
  "role": "backend",
  "targetType": "file",
  "stableKey": "backend/src/api/routes/projects.ts",
  "compositeScore": 0.91,
  "isCritical25": true,
  "rankingReasons": [
    "Contains public API route entrypoints",
    "Creates persistent project records",
    "Enqueues analysis jobs"
  ],
  "scoreBreakdown": {
    "criticalWorkflowParticipation": 0.95,
    "fanIn": 0.64,
    "sideEffects": 0.9,
    "publicApiExposure": 0.85,
    "churn": 0.25,
    "documentationGap": 0.7,
    "testCoverage": 0.4
  }
}
```

### Architecture Map Tables

The architecture map should be built from graph clustering first. The LLM only labels and explains it.

```sql
create table architecture_clusters (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  stable_key text not null,
  label text not null,
  kind text not null check (
    kind in (
      'frontend_ui', 'frontend_state', 'api_layer', 'auth_layer',
      'database_layer', 'worker_layer', 'analysis_engine',
      'integration_layer', 'devops_layer', 'test_layer', 'shared_module'
    )
  ),
  critical_score numeric not null default 0,
  deterministic_summary text,
  metadata jsonb not null default '{}',
  unique (snapshot_id, stable_key)
);

create table architecture_cluster_members (
  cluster_id uuid not null references architecture_clusters(id) on delete cascade,
  node_id uuid not null references graph_nodes(id) on delete cascade,
  membership_reason text not null,
  primary key (cluster_id, node_id)
);

create table architecture_edges (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  source_cluster_id uuid not null references architecture_clusters(id) on delete cascade,
  target_cluster_id uuid not null references architecture_clusters(id) on delete cascade,
  type text not null check (
    type in ('imports', 'calls', 'sends_request', 'enqueues_job', 'reads_writes_data', 'uses_config', 'tests')
  ),
  weight numeric not null default 1,
  evidence_edge_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'
);
```

### Semantic Summary and Embedding Tables

These preserve context. The summary is generated once per snapshot target and reused by onboarding sections. The embedding is for retrieval.

```sql
create table semantic_summaries (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  target_type text not null check (
    target_type in ('symbol', 'file', 'module', 'workflow', 'architecture_cluster', 'schema', 'config', 'test')
  ),
  target_id uuid not null,
  stable_key text not null,
  summary text not null,
  facts jsonb not null default '[]',
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  receipt_ids uuid[] not null default '{}',
  evidence_hash text not null,
  model text,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique (snapshot_id, target_type, target_id, evidence_hash)
);

create table evidence_embeddings (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  summary_id uuid not null references semantic_summaries(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  content text not null,
  embedding vector(1536),
  provider text not null,
  model text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

Use 1536 dimensions if using `text-embedding-3-small`. If a different model is configured, create a separate embedding table or use a matching vector dimension.

### Onboarding Generation Tables

These tables record section-by-section generation and the exact context used.

```sql
create table onboarding_packages (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  status text not null check (status in ('generating', 'draft', 'approved', 'stale', 'failed')),
  generated_by uuid not null,
  analyzed_commit text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, role, analyzed_commit)
);

create table ai_generation_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  package_id uuid references onboarding_packages(id) on delete cascade,
  target_type text not null check (target_type in ('summary', 'section', 'walkthrough_step')),
  target_id uuid,
  section_type text,
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_hash text not null,
  output_hash text,
  token_usage jsonb not null default '{}',
  latency_ms integer,
  status text not null check (status in ('running', 'complete', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table package_sections (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references onboarding_packages(id) on delete cascade,
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  generation_run_id uuid references ai_generation_runs(id),
  type text not null check (
    type in (
      'start_here', 'architecture', 'entry_points', 'critical_25',
      'role_path', 'workflow_guide', 'data_schema', 'safety_rails',
      'dependency_graph', 'doc_health'
    )
  ),
  title text not null,
  content text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  review_status text not null check (review_status in ('draft', 'approved', 'edited', 'stale', 'regenerate_requested')),
  analyzed_commit text not null,
  role text check (role in ('backend', 'frontend', 'devops', 'qa', 'general')),
  generation_context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

create table source_receipts (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references package_sections(id) on delete cascade,
  summary_id uuid references semantic_summaries(id) on delete set null,
  node_id uuid references graph_nodes(id) on delete set null,
  workflow_id uuid references workflows(id) on delete set null,
  node_stable_key text,
  node_hash text,
  file_path text,
  symbol_name text,
  line_start integer,
  line_end integer,
  snippet text,
  claim text,
  commit_hash text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  metadata jsonb not null default '{}'
);

create table stale_flags (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references analysis_snapshots(id) on delete cascade,
  package_id uuid references onboarding_packages(id) on delete cascade,
  section_id uuid references package_sections(id) on delete cascade,
  summary_id uuid references semantic_summaries(id) on delete cascade,
  target_type text not null,
  target_stable_key text not null,
  reason text not null,
  old_hash text,
  new_hash text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
```

## Implementation Files To Add

Keep existing worker files and add these:

```txt
backend/src/worker/engine/configScanner.ts
backend/src/worker/engine/privacyFilter.ts
backend/src/worker/engine/hashUtils.ts
backend/src/worker/engine/stableKeys.ts
backend/src/worker/engine/behaviorSignals.ts
backend/src/worker/engine/entrypointDetector.ts
backend/src/worker/engine/sideEffectDetector.ts
backend/src/worker/engine/evidenceGraphBuilder.ts
backend/src/worker/engine/workflowExtractor.ts
backend/src/worker/engine/workflowRanker.ts
backend/src/worker/engine/criticalRanker.ts
backend/src/worker/engine/architectureClusterer.ts
backend/src/worker/engine/semanticSummaryService.ts
backend/src/worker/engine/embeddingService.ts
backend/src/worker/engine/evidenceBundleBuilder.ts
backend/src/worker/engine/aiGenerationService.ts
backend/src/worker/engine/sectionValidator.ts
backend/src/worker/engine/persistAnalysis.ts
backend/src/worker/engine/incrementalAnalyzer.ts
```

## Step 1: Repository Inventory

Extend `repoIngester.ts`.

Required functions:

```ts
export async function buildRepoIndex(rootPath: string): Promise<RepoIndex>;
export function applyPrivacyFilters(index: RepoIndex, ignoredPaths: string[]): RepoIndex;
export async function detectRepoInventory(rootPath: string): Promise<RepoInventory>;
```

`RepoInventory`:

```ts
export interface RepoInventory {
  packages: Array<{
    root: string;
    packageJsonPath: string;
    name: string | null;
    scripts: Record<string, string>;
    dependencies: string[];
    devDependencies: string[];
  }>;
  configs: Array<{
    path: string;
    kind: 'tsconfig' | 'vite' | 'docker' | 'compose' | 'github_actions' | 'env_example' | 'eslint';
    facts: Record<string, unknown>;
  }>;
  detectedFrameworks: string[];
}
```

Example output:

```json
{
  "detectedFrameworks": ["react", "vite", "express", "bullmq", "supabase"],
  "packages": [
    {
      "root": "frontend",
      "name": "@onboardbuddy/frontend",
      "scripts": { "dev": "vite", "build": "tsc && vite build" },
      "dependencies": ["@vitejs/plugin-react", "react", "reactflow"]
    }
  ],
  "configs": [
    { "path": "docker-compose.yml", "kind": "compose", "facts": { "services": ["frontend", "backend-api", "backend-worker"] } }
  ]
}
```

## Step 2: AST Parsing

Keep the current TypeScript Compiler API flow in `astParser.ts`:

```ts
const program = createProgram(tsFiles, repoPath);
const parsed = parseSourceFile(program, entry.absolutePath);
```

The TypeScript `Program` is important because it lets future extraction use cross-file type information through `program.getTypeChecker()`.

Do not store raw ASTs. Extract stable evidence from them.

## Step 3: Symbol and Behavior Extraction

Extend `symbolExtractor.ts` so every symbol gets a stable identity and hashes.

Required fields:

```ts
export interface ExtractedSymbol {
  stableKey: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  signature?: string;
  params?: ParameterInfo[];
  returnType?: string;
  callsSymbols: string[];
  importsUsed: string[];
  behaviorSignals: string[];
  purposeSignals: string[];
  signatureHash: string;
  bodyHash: string;
  snippet: string;
}
```

Stable key format:

```txt
relative/path.ts#SymbolName
relative/path.ts#ClassName.methodName
relative/path.ts#HTTP GET /api/projects
relative/path.ts#default
```

Example:

```json
{
  "stableKey": "backend/src/worker/engine/analysisRunner.ts#runAnalysis",
  "name": "runAnalysis",
  "kind": "function",
  "filePath": "backend/src/worker/engine/analysisRunner.ts",
  "lineStart": 12,
  "lineEnd": 58,
  "signature": "(opts: RunAnalysisOptions) => Promise<AnalysisSnapshot>",
  "callsSymbols": [
    "buildRepoIndex",
    "filterByLanguage",
    "createProgram",
    "parseSourceFile",
    "extractFileAnalysis",
    "annotateResolvedImports",
    "buildDependencyGraph"
  ],
  "behaviorSignals": ["analysis_orchestration", "ast_parse", "graph_build"],
  "purposeSignals": ["repository_analysis"],
  "signatureHash": "sha256:...",
  "bodyHash": "sha256:..."
}
```

## Step 4: Entrypoint Detection

Create `entrypointDetector.ts`.

Function:

```ts
export function detectEntrypoints(ctx: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  inventory: RepoInventory;
}): EntrypointCandidate[];
```

Rules:

```txt
Express:
  router.get/post/put/delete/patch(...)
  app.get/post/put/delete/patch(...)

React:
  route config entries
  page components under src/pages
  App.tsx and main.tsx

Worker:
  new Worker(...)
  queue.process(...)
  exported job handler functions

CLI/package:
  package.json bin/main/exports

Serverless:
  exported handler functions
```

Example candidate:

```json
{
  "stableKey": "backend/src/api/routes/projects.ts#POST /api/projects",
  "triggerType": "http_route",
  "method": "POST",
  "routePath": "/api/projects",
  "nodeStableKey": "backend/src/api/routes/projects.ts#projectRouter",
  "confidence": "high",
  "roleRelevance": {
    "backend": 0.95,
    "frontend": 0.25,
    "devops": 0.2,
    "qa": 0.65,
    "general": 0.7
  }
}
```

## Step 5: Side Effect Detection

Create `sideEffectDetector.ts`.

Function:

```ts
export function detectSideEffects(symbol: ExtractedSymbol): SideEffectCandidate[];
```

Rules:

```txt
database_read:
  query("select ...")
  supabase.from(...).select(...)
  prisma.model.findMany(...)

database_write:
  query("insert/update/delete ...")
  supabase.from(...).insert/update/delete(...)
  prisma.model.create/update/delete(...)

queue_enqueue:
  queue.add(...)
  analysisQueue.add(...)

queue_consume:
  new Worker(...)

http_request:
  fetch(...)
  axios(...)
  octokit.*

auth_check:
  jwt.verify(...)
  jose.jwtVerify(...)
  requireProjectAccess(...)

response_output:
  res.json(...)
  res.send(...)
  return Response.json(...)

env_read:
  process.env.*
```

Example:

```json
{
  "nodeStableKey": "backend/src/api/routes/projects.ts#createProject",
  "type": "database_write",
  "target": "projects",
  "confidence": "medium",
  "evidence": "CallExpression query(...) includes INSERT INTO projects"
}
```

## Step 6: Evidence Graph

Replace the current file-only graph with a graph containing both files and symbols.

Create `evidenceGraphBuilder.ts`.

Function:

```ts
export function buildEvidenceGraph(ctx: {
  fileAnalyses: FileAnalysis[];
  inventory: RepoInventory;
  entrypoints: EntrypointCandidate[];
  sideEffects: SideEffectCandidate[];
}): EvidenceGraph;
```

Graph construction:

```txt
1. Create file nodes for every repository file.
2. Create symbol nodes for every extracted symbol.
3. Add contains edges from file -> symbol.
4. Add imports edges from file -> file.
5. Resolve imported names to symbols when possible.
6. Add calls edges from symbol -> symbol when resolved.
7. Add extends/implements edges for classes/interfaces.
8. Add handles_route edges from entrypoint -> handler symbol.
9. Add side-effect edges from symbol -> schema/config/external target.
10. Add tests edges from test files -> tested files/symbols when detectable.
```

Example graph node:

```json
{
  "stableKey": "backend/src/worker/engine/analysisRunner.ts#runAnalysis",
  "type": "function",
  "name": "runAnalysis",
  "filePath": "backend/src/worker/engine/analysisRunner.ts",
  "lineStart": 12,
  "lineEnd": 58,
  "hash": "sha256:...",
  "metadata": {
    "signature": "(opts: RunAnalysisOptions) => Promise<AnalysisSnapshot>",
    "behaviorSignals": ["analysis_orchestration", "ast_parse", "graph_build"]
  }
}
```

Example graph edge:

```json
{
  "source": "backend/src/worker/engine/analysisRunner.ts#runAnalysis",
  "target": "backend/src/worker/engine/astParser.ts#createProgram",
  "type": "calls",
  "confidence": "high",
  "metadata": {
    "detectedFrom": "CallExpression",
    "expression": "createProgram(tsFiles, opts.repoPath)"
  }
}
```

## Step 7: Workflow Extraction

Create `workflowExtractor.ts`.

Function:

```ts
export function extractWorkflows(ctx: {
  graph: EvidenceGraph;
  entrypoints: EntrypointCandidate[];
  sideEffects: SideEffectCandidate[];
}): WorkflowCandidate[];
```

Algorithm:

```txt
1. Start from every entrypoint.
2. Traverse outgoing calls, imports, handles_route, registers_callback, touches_schema edges.
3. Stop when the path reaches a meaningful side effect or response output.
4. Keep paths with at least one side effect or output.
5. Collapse noisy helpers.
6. Classify the workflow purpose.
7. Convert the path into onboarding-level steps.
```

DFS shape:

```ts
function traceFromEntrypoint(entry: EntrypointCandidate, graph: EvidenceGraph) {
  return dfs({
    startNodeId: entry.nodeId,
    maxDepth: 8,
    followEdges: [
      'handles_route',
      'calls',
      'registers_callback',
      'touches_schema',
      'enqueues_job',
      'handles_job'
    ],
    stopWhen: node => hasSideEffect(node) || isResponseOutput(node)
  });
}
```

Example workflow:

```json
{
  "stableKey": "workflow:backend:create-project-and-queue-analysis",
  "title": "Create project and queue repository analysis",
  "triggerType": "http_route",
  "purpose": "project_import",
  "confidence": "high",
  "steps": [
    {
      "order": 1,
      "kind": "trigger",
      "nodeStableKey": "backend/src/api/routes/projects.ts#POST /api/projects"
    },
    {
      "order": 2,
      "kind": "auth_guard",
      "nodeStableKey": "backend/src/api/middleware/project-access.ts#requireProjectAccess"
    },
    {
      "order": 3,
      "kind": "data_write",
      "nodeStableKey": "backend/src/api/routes/projects.ts#createProject"
    },
    {
      "order": 4,
      "kind": "async_work",
      "nodeStableKey": "backend/src/lib/queue.ts#enqueueAnalysisJob"
    }
  ],
  "sideEffects": ["database_write", "queue_enqueue"]
}
```

## Step 8: Critical 25% Ranking

Create `criticalRanker.ts`.

Critical 25% applies to:

```txt
workflows
files
symbols
modules
schemas
configs
tests
```

The worker should score all targets for each role:

```ts
export function rankCriticalTargets(ctx: {
  snapshotId: string;
  role: DeveloperRole;
  graph: EvidenceGraph;
  workflows: WorkflowCandidate[];
  architectureClusters: ArchitectureCluster[];
  inventory: RepoInventory;
  gitSignals: GitSignals;
  testSignals: TestSignals;
  docSignals: DocSignals;
}): CriticalRanking[];
```

Workflow score:

```txt
25% entrypoint exposure
20% downstream impact
20% structural centrality
15% external side effects
10% documentation gap
5% test coverage signal
5% git churn recency
```

File score:

```txt
25% participates in critical workflows
20% dependency fan-in/fan-out
15% contains important side effects
15% public/API exposure
10% documentation gap
10% git churn recency
5% test coverage signal
```

Symbol score:

```txt
25% participates in critical workflows
20% call graph centrality
20% side-effect importance
15% public/API exposure
10% dependency fan-in/fan-out
5% git churn recency
5% test coverage signal
```

Module score:

```txt
30% aggregate critical score of contained files/symbols
25% critical workflow crossings
20% responsibility importance, such as API/auth/data/worker
15% dependency centrality
10% documentation gap
```

Config score:

```txt
35% runtime/build/deploy relevance
25% referenced by scripts or containers
20% role relevance
10% churn
10% documentation gap
```

Test score:

```txt
40% covers critical workflows/symbols
20% fixture importance
20% integration/e2e signal
10% churn
10% role relevance
```

Critical selection:

```ts
function markCritical25(rankings: CriticalRanking[]): CriticalRanking[] {
  const grouped = groupBy(rankings, r => `${r.role}:${r.targetType}`);

  return Object.values(grouped).flatMap(group => {
    const sorted = [...group].sort((a, b) => b.compositeScore - a.compositeScore);
    const cutoff = Math.ceil(sorted.length * 0.25);

    return sorted.map((item, index) => ({
      ...item,
      percentile: 1 - index / sorted.length,
      isCritical25: index < cutoff
    }));
  });
}
```

## Step 9: Architecture Map

Create `architectureClusterer.ts`.

The architecture map should be deterministic first.

Function:

```ts
export function buildArchitectureMap(ctx: {
  graph: EvidenceGraph;
  inventory: RepoInventory;
  workflows: WorkflowCandidate[];
  criticalRankings: CriticalRanking[];
}): ArchitectureMap;
```

Cluster rules:

```txt
Path-based grouping:
  frontend/src/pages -> Frontend Pages
  frontend/src/components -> Frontend Components
  frontend/src/lib -> Frontend Client Libraries
  backend/src/api/routes -> Backend API Routes
  backend/src/api/middleware -> Backend Middleware
  backend/src/lib -> Backend Shared Libraries
  backend/src/worker/engine -> Analysis Engine
  backend/src/worker -> Worker Runtime

Framework-based grouping:
  React/Vite -> frontend_ui
  Express routers -> api_layer
  Supabase/pg queries -> database_layer
  BullMQ -> worker_layer
  Docker/GitHub Actions/env -> devops_layer

Graph-based grouping:
  Collapse file/symbol edges into cluster edges.
  Increase edge weight when many file/symbol edges cross the same clusters.
  Attach workflow crossings to cluster edges.
```

Example architecture map:

```json
{
  "clusters": [
    {
      "stableKey": "cluster:backend-analysis-engine",
      "label": "Analysis Engine",
      "kind": "analysis_engine",
      "files": [
        "backend/src/worker/engine/astParser.ts",
        "backend/src/worker/engine/symbolExtractor.ts",
        "backend/src/worker/engine/graphBuilder.ts",
        "backend/src/worker/engine/analysisRunner.ts"
      ],
      "deterministicSummary": "Parses repositories, extracts symbols, and builds graph evidence.",
      "criticalScore": 0.94
    },
    {
      "stableKey": "cluster:backend-api",
      "label": "Backend API",
      "kind": "api_layer",
      "files": [
        "backend/src/api/app.ts",
        "backend/src/api/routes/projects.ts",
        "backend/src/api/routes/graph.ts"
      ],
      "deterministicSummary": "Exposes authenticated project, graph, GitHub, and onboarding endpoints.",
      "criticalScore": 0.89
    }
  ],
  "edges": [
    {
      "source": "cluster:backend-api",
      "target": "cluster:worker-runtime",
      "type": "enqueues_job",
      "weight": 0.8,
      "evidence": ["analysisQueue.add(...)"]
    }
  ]
}
```

Then generate an architecture explanation from this map plus semantic summaries. The LLM should not invent clusters.

## Step 10: Semantic Summaries

Create `semanticSummaryService.ts`.

Summaries preserve meaning. They are generated before onboarding package sections and reused.

Generation order:

```txt
1. Symbol summaries from AST facts and snippets.
2. File summaries from file facts plus symbol summaries.
3. Module summaries from file summaries and cluster facts.
4. Workflow summaries from workflow steps and side effects.
5. Architecture cluster summaries from cluster members and module summaries.
```

Summary generation input for one symbol:

```json
{
  "task": "summarize_symbol",
  "snapshot": {
    "commit": "abc123",
    "repo": "team15/OnboardBuddy"
  },
  "target": {
    "stableKey": "backend/src/worker/engine/analysisRunner.ts#runAnalysis",
    "kind": "function",
    "name": "runAnalysis",
    "filePath": "backend/src/worker/engine/analysisRunner.ts",
    "lineStart": 12,
    "lineEnd": 58
  },
  "deterministicFacts": {
    "signature": "(opts: RunAnalysisOptions) => Promise<AnalysisSnapshot>",
    "calls": [
      "buildRepoIndex",
      "createProgram",
      "parseSourceFile",
      "extractFileAnalysis",
      "buildDependencyGraph"
    ],
    "behaviorSignals": ["analysis_orchestration", "ast_parse", "graph_build"],
    "sideEffects": []
  },
  "receipts": [
    {
      "receiptId": "r_symbol_1",
      "filePath": "backend/src/worker/engine/analysisRunner.ts",
      "lineStart": 12,
      "lineEnd": 58,
      "snippet": "export async function runAnalysis(opts: RunAnalysisOptions): Promise<AnalysisSnapshot> { ... }"
    }
  ],
  "outputRules": {
    "useOnlyProvidedEvidence": true,
    "citeEachFact": true,
    "doNotGuessBusinessIntent": true
  }
}
```

Expected summary output:

```json
{
  "summary": "Runs one repository analysis snapshot by indexing files, creating a TypeScript program, parsing each TypeScript file, extracting symbols/imports, annotating resolved imports, and building the dependency graph.",
  "facts": [
    {
      "claim": "Indexes repository files before parsing.",
      "receiptId": "r_symbol_1",
      "confidence": "high"
    },
    {
      "claim": "Creates one TypeScript program for cross-file analysis.",
      "receiptId": "r_symbol_1",
      "confidence": "high"
    },
    {
      "claim": "Builds the dependency graph after import resolution.",
      "receiptId": "r_symbol_1",
      "confidence": "high"
    }
  ],
  "confidence": "high"
}
```

File summary input should include all symbol summaries for that file:

```json
{
  "task": "summarize_file",
  "target": {
    "stableKey": "backend/src/worker/engine/analysisRunner.ts",
    "filePath": "backend/src/worker/engine/analysisRunner.ts"
  },
  "fileFacts": {
    "imports": [
      "./repoIngester.js",
      "./astParser.js",
      "./symbolExtractor.js",
      "./graphBuilder.js"
    ],
    "exports": ["runAnalysis"],
    "behaviorSignals": ["analysis_orchestration"]
  },
  "symbolSummaries": [
    {
      "stableKey": "backend/src/worker/engine/analysisRunner.ts#runAnalysis",
      "summary": "Runs one repository analysis snapshot by indexing files, parsing TypeScript, extracting symbols, and building the dependency graph.",
      "receiptIds": ["r_symbol_1"]
    }
  ]
}
```

Expected file summary:

```json
{
  "summary": "This file orchestrates a complete analysis pass. It connects repo indexing, TypeScript program creation, per-file AST extraction, import resolution, and graph construction into one worker-level operation.",
  "facts": [
    {
      "claim": "The file is the worker orchestration point for analysis.",
      "receiptId": "r_symbol_1",
      "confidence": "high"
    }
  ],
  "confidence": "high"
}
```

## Step 11: Embeddings and Retrieval

Embeddings are needed to preserve and retrieve context, not to prove facts.

Embed:

```txt
symbol summaries
file summaries
module summaries
workflow summaries
architecture cluster summaries
schema/config/test summaries
```

Do not embed:

```txt
raw AST
full source files
secret-bearing files
temporary archive contents
```

Create `embeddingService.ts`.

Interface:

```ts
export interface EmbeddingProvider {
  embed(input: string): Promise<number[]>;
}
```

Example OpenAI-compatible implementation:

```ts
import OpenAI from 'openai';

const embeddingsClient = new OpenAI({
  apiKey: process.env.EMBEDDINGS_API_KEY,
  baseURL: process.env.EMBEDDINGS_BASE_URL
});

export async function embedSummary(content: string): Promise<number[]> {
  const result = await embeddingsClient.embeddings.create({
    model: process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
    input: content
  });

  return result.data[0].embedding;
}
```

Retrieval should be hybrid:

```txt
1. Deterministic SQL retrieval:
   critical rankings, graph neighbors, workflow steps, architecture clusters.

2. Semantic vector retrieval:
   find summaries related to the section objective.

3. Graph expansion:
   add directly connected receipts, tests, schemas, configs.

4. Final bundle assembly:
   deduplicate by stable_key, cap size, attach receipts.
```

Example vector search query:

```sql
select
  ee.summary_id,
  ee.target_type,
  ee.target_id,
  ss.summary,
  1 - (ee.embedding <=> $1::vector) as similarity
from evidence_embeddings ee
join semantic_summaries ss on ss.id = ee.summary_id
where ee.snapshot_id = $2
order by ee.embedding <=> $1::vector
limit 12;
```

## Step 12: Evidence Bundles

Create `evidenceBundleBuilder.ts`.

An evidence bundle is the exact compact JSON payload passed to the LLM for one summary or one onboarding section.

Important:

```txt
Do not pass full repo.
Do not pass raw AST.
Do not pass every file.
Do not rely only on embeddings.
Pass ranked targets, graph facts, summaries, selected snippets, and receipt IDs.
```

Bundle type:

```ts
export interface EvidenceBundle {
  bundleVersion: string;
  task: string;
  sectionType?: PackageSectionType;
  role?: DeveloperRole;
  repo: {
    owner: string;
    name: string;
    branch: string;
    commit: string;
  };
  deterministicContext: Record<string, unknown>;
  semanticContext: Array<{
    summaryId: string;
    targetType: string;
    stableKey: string;
    summary: string;
    confidence: 'high' | 'medium' | 'low';
    receiptIds: string[];
  }>;
  receipts: Array<{
    receiptId: string;
    nodeStableKey?: string;
    filePath: string;
    symbolName?: string;
    lineStart?: number;
    lineEnd?: number;
    snippet?: string;
  }>;
  outputRules: {
    useOnlyProvidedEvidence: boolean;
    citeEverySubstantiveClaim: boolean;
    markUnsupportedClaimsLowConfidence: boolean;
  };
}
```

## Step 13: OpenRouter Calls

Create `aiGenerationService.ts`.

OpenRouter supports the OpenAI SDK by pointing `baseURL` at `https://openrouter.ai/api/v1`.

```ts
import OpenAI from 'openai';

const openrouter = new OpenAI({
  baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': process.env.APP_PUBLIC_URL ?? 'http://localhost:5173',
    'X-OpenRouter-Title': 'OnboardBuddy'
  }
});
```

Use a structured output model when available. If a configured model does not support strict JSON schema through OpenRouter, fall back to JSON-only prompting plus server-side validation and retry.

Generic section generation:

```ts
export async function generatePackageSection(bundle: EvidenceBundle) {
  const completion = await openrouter.chat.completions.create({
    model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: [
          'You generate codebase onboarding documentation.',
          'Use only the provided evidence bundle.',
          'Every substantive claim must cite one or more receipt IDs.',
          'If evidence is weak or indirect, set confidence to medium or low.',
          'Do not mention files, functions, dependencies, or behavior not present in the bundle.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify(bundle)
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'onboarding_section',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'contentMarkdown', 'confidence', 'claims', 'usedReceiptIds'],
          properties: {
            title: { type: 'string' },
            contentMarkdown: { type: 'string' },
            confidence: { enum: ['high', 'medium', 'low'] },
            claims: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['claim', 'receiptIds', 'confidence'],
                properties: {
                  claim: { type: 'string' },
                  receiptIds: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  confidence: { enum: ['high', 'medium', 'low'] }
                }
              }
            },
            usedReceiptIds: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
  });

  return JSON.parse(completion.choices[0].message.content ?? '{}');
}
```

Expected result:

```json
{
  "title": "Create Project and Queue Analysis",
  "contentMarkdown": "This workflow starts in the project API route, where the backend accepts a project creation request and persists the project record. It then enqueues analysis work for the worker process. [r1]\n\nFor backend onboarding, this matters because it connects the authenticated API layer to the asynchronous analysis pipeline. [r1, r2]",
  "confidence": "high",
  "claims": [
    {
      "claim": "The workflow starts in the project API route.",
      "receiptIds": ["r1"],
      "confidence": "high"
    },
    {
      "claim": "The workflow enqueues analysis work for the worker process.",
      "receiptIds": ["r2"],
      "confidence": "high"
    }
  ],
  "usedReceiptIds": ["r1", "r2"]
}
```

## Step 14: Section-by-Section Package Generation

Do not generate the whole onboarding package in one LLM call.

Each package section gets its own deterministic query, semantic retrieval query, bundle, LLM call, validation, and stored generation context.

### Section: Start Here

Purpose:

```txt
Give a new developer the fastest accurate overview of what the repo is, how it is structured, and what to inspect first.
```

Deterministic retrieval:

```txt
repo inventory
top architecture clusters
top critical modules/files by role
package scripts
main entrypoints
```

Semantic retrieval prompt:

```txt
"high-level repository purpose, main subsystems, first files to read for ROLE"
```

Bundle example:

```json
{
  "task": "generate_onboarding_section",
  "sectionType": "start_here",
  "role": "backend",
  "deterministicContext": {
    "frameworks": ["React", "Express", "BullMQ", "Supabase"],
    "topClusters": ["Backend API", "Analysis Worker", "Analysis Engine"],
    "topCriticalFiles": [
      "backend/src/api/app.ts",
      "backend/src/worker/engine/analysisRunner.ts"
    ],
    "scripts": {
      "dev": "concurrently -n api,worker ...",
      "build": "tsc -p tsconfig.json"
    }
  },
  "semanticContext": [
    {
      "targetType": "architecture_cluster",
      "stableKey": "cluster:analysis-engine",
      "summary": "Parses repositories, extracts code evidence, and builds the dependency graph.",
      "receiptIds": ["r10", "r11"]
    }
  ],
  "receipts": [
    {
      "receiptId": "r10",
      "filePath": "backend/src/worker/engine/analysisRunner.ts",
      "lineStart": 1,
      "lineEnd": 58
    }
  ]
}
```

Expected output:

```txt
Markdown overview with 3 to 6 paragraphs, a short "read first" list, and citations.
```

### Section: Architecture

Purpose:

```txt
Explain the architecture map from deterministic clusters.
```

Deterministic retrieval:

```txt
architecture_clusters
architecture_edges
critical module rankings
workflow crossings between clusters
```

Semantic retrieval prompt:

```txt
"architecture responsibilities and subsystem relationships for ROLE"
```

Expected output:

```json
{
  "title": "Architecture Map",
  "contentMarkdown": "The repo is split into a React frontend, an Express API, and a worker-side analysis engine. The Backend API cluster exposes project and graph endpoints, while the Analysis Worker runs repository parsing and evidence graph construction. [r_arch_1, r_arch_2]",
  "confidence": "high",
  "claims": [
    {
      "claim": "The backend API and worker analysis engine are separate architecture clusters.",
      "receiptIds": ["r_arch_1", "r_arch_2"],
      "confidence": "high"
    }
  ],
  "usedReceiptIds": ["r_arch_1", "r_arch_2"]
}
```

### Section: Entry Points

Deterministic retrieval:

```txt
entrypoints ordered by role relevance and critical score
handler symbols
connected workflows
route/config evidence
```

Expected content:

```txt
List of API routes, UI routes, worker jobs, CLI/server entries, and why they matter.
```

### Section: Critical 25%

Deterministic retrieval:

```txt
critical_rankings where is_critical_25 = true
grouped by target_type: workflow, file, symbol, module, schema, config, test
score breakdowns
ranking reasons
```

Semantic retrieval prompt:

```txt
"why these critical files, modules, symbols, workflows matter for ROLE onboarding"
```

Bundle example:

```json
{
  "sectionType": "critical_25",
  "role": "backend",
  "deterministicContext": {
    "criticalWorkflows": [
      {
        "stableKey": "workflow:project-import-analysis",
        "title": "Create project and queue repository analysis",
        "score": 0.92,
        "rankingReasons": [
          "Public backend entrypoint",
          "Writes project data",
          "Enqueues analysis job"
        ]
      }
    ],
    "criticalFiles": [
      {
        "stableKey": "backend/src/worker/engine/analysisRunner.ts",
        "score": 0.91,
        "rankingReasons": [
          "Coordinates AST parsing and graph building",
          "Participates in core analysis workflow"
        ]
      }
    ],
    "criticalSymbols": [
      {
        "stableKey": "backend/src/worker/engine/analysisRunner.ts#runAnalysis",
        "score": 0.93
      }
    ],
    "criticalModules": [
      {
        "stableKey": "cluster:analysis-engine",
        "score": 0.94
      }
    ]
  }
}
```

Expected output:

```txt
Explain the Critical 25% by category, with ranking reasons. Do not simply dump scores.
```

### Section: Workflow Guide

Generate one section per selected workflow or one combined section with multiple workflow subsections.

Deterministic retrieval:

```txt
workflow row
workflow_steps
entrypoint
side effects
connected files/symbols
critical ranking reasons
```

Semantic retrieval prompt:

```txt
"workflow lifecycle explanation and role-specific context for WORKFLOW_TITLE"
```

Expected output:

```txt
Step-by-step explanation:
1. Trigger
2. Guard/validation
3. Core logic
4. Data/schema/API interaction
5. Output/side effect
```

### Section: Data Schema

Deterministic retrieval:

```txt
schema nodes
database query side effects
ORM/schema files
migrations if present
workflows touching schema nodes
```

Expected content:

```txt
Explain the source-of-truth data objects and which workflows read/write them.
```

### Section: Safety Rails

Deterministic retrieval:

```txt
package scripts
test files
CI configs
Docker files
env examples
dangerous side effects
```

Expected content:

```txt
Commands to run, tests to trust, env/config notes, and risky areas to review carefully.
```

### Section: Documentation Health

Deterministic retrieval:

```txt
stale_flags
changed files/symbols
affected workflows
affected summaries
affected package sections
```

Expected content:

```txt
Which onboarding sections may be stale and why.
```

## Step 15: Validation

Create `sectionValidator.ts`.

Validation rules:

```txt
1. Every used receipt ID must exist in the bundle.
2. Every cited receipt must belong to the same snapshot/commit.
3. Claims mentioning files must cite receipts from those files.
4. Claims mentioning functions/classes must cite matching node receipts.
5. Claims with no citation are rejected or downgraded to low confidence.
6. Section confidence is the minimum reasonable confidence of major claims.
7. Generated content starts as draft.
```

Function:

```ts
export function validateSectionOutput(ctx: {
  output: GeneratedSectionOutput;
  bundle: EvidenceBundle;
}): ValidatedSection;
```

Example validation failure:

```json
{
  "valid": false,
  "errors": [
    "Claim mentions Prisma but no provided receipt or summary mentions Prisma.",
    "Receipt r99 does not exist in evidence bundle."
  ],
  "action": "retry_with_stricter_prompt"
}
```

## Step 16: Incremental Re-analysis

Create `incrementalAnalyzer.ts`.

Algorithm:

```txt
1. Download new snapshot for target commit.
2. Recompute repository_files.hash.
3. Re-parse changed files.
4. Recompute graph node body/signature hashes.
5. Compare stable_key + hash with previous snapshot.
6. Mark changed nodes.
7. Find graph edges connected to changed nodes.
8. Find workflows containing changed nodes.
9. Find critical rankings referencing changed targets.
10. Find semantic summaries whose evidence_hash changed.
11. Find package sections whose generation_context references changed summaries, nodes, workflows, clusters, or rankings.
12. Insert stale_flags.
13. Regenerate only stale summaries/sections when requested.
```

Generation context stored on `package_sections`:

```json
{
  "bundleVersion": "1.0",
  "promptVersion": "section-critical-25-v1",
  "snapshotId": "snapshot_1",
  "commit": "abc123",
  "targetStableKeys": [
    "backend/src/worker/engine/analysisRunner.ts",
    "backend/src/worker/engine/analysisRunner.ts#runAnalysis"
  ],
  "workflowIds": ["wf_1"],
  "summaryIds": ["sum_1", "sum_2"],
  "receiptIds": ["r1", "r2"],
  "evidenceHashes": {
    "backend/src/worker/engine/analysisRunner.ts#runAnalysis": "sha256:..."
  }
}
```

## Minimal Build Order

Implement in this order:

```txt
1. Add database migration for snapshot, graph, workflow, ranking, architecture, summary, embedding, generation tables.
2. Add hashUtils.ts and stableKeys.ts.
3. Extend symbolExtractor.ts with stableKey, bodyHash, signatureHash, behaviorSignals, snippets.
4. Add configScanner.ts and privacyFilter.ts.
5. Replace file-only graph with evidenceGraphBuilder.ts.
6. Add entrypointDetector.ts.
7. Add sideEffectDetector.ts.
8. Add workflowExtractor.ts.
9. Add criticalRanker.ts for workflows/files/symbols/modules/configs/tests.
10. Add architectureClusterer.ts.
11. Add persistAnalysis.ts.
12. Add semanticSummaryService.ts using OpenRouter.
13. Add embeddingService.ts and evidence_embeddings writes.
14. Add evidenceBundleBuilder.ts.
15. Add aiGenerationService.ts for section-by-section generation.
16. Add sectionValidator.ts.
17. Generate only one role and two sections first: start_here and critical_25.
18. Add workflow_guide, architecture, entry_points, safety_rails, data_schema.
19. Add incrementalAnalyzer.ts and stale_flags.
```

## What Gets Sent To The LLM

Send:

```txt
selected deterministic facts
ranked targets and ranking reasons
semantic summaries
selected snippets
receipt IDs
strict output rules
```

Do not send:

```txt
raw full repository
raw AST
all files
secrets
uncapped graph dumps
unvalidated user-supplied claims
```

This is the important balance:

```txt
AST/config/git graph decides what is true.
LLM summaries preserve meaning.
Embeddings retrieve relevant meaning.
Section generation explains the selected evidence.
Receipts prove where each explanation came from.
```

