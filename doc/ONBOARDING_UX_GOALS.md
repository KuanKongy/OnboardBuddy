# Onboarding UX goals — ground truth for success

Companion to `doc/DIATAXIS_NOTES.md` (form/mode quality) and `doc/ONBOARDING_QUALITY_LATENCY_PLAN.md` (architecture). This file defines **content success**: what a generated package MUST surface for it to count as good, with OnboardBuddy as the permanent golden test repo. If a golden item is missing, buried, or wrong, **the fault is ours** — generation/extraction must improve; the bar does not move.

## The core principle

Every repo exists to do a small number of things. The onboarding is successful only if a new developer can, within the first minutes of reading, name and then trace **the product's core user journeys** — the reason the code exists. Everything else (files, tables, routes) is supporting material for those journeys.

Operational test for any repo: pick the 2–5 journeys a team lead would whiteboard on day one. Each must be:
1. **Present** — extracted as a coherent end-to-end journey, not fragments.
2. **Findable** — visible in the first screen of workflows/tutorials and named in `big_picture` (not buried below route-level noise).
3. **Correct** — steps match the code in order; receipts resolve; nothing invented.
4. **Complete** — crosses the real boundaries (frontend → API → queue → worker → DB/external), not stopping at the first hop.

## OnboardBuddy golden journeys (the user-set bar, 2026-07-24)

### J1 — User Auth
Signup/login/logout/session: frontend auth pages + AuthContext → Supabase auth (the SDK hop is part of the journey) → backend `/api/auth/*` routes → `requireAuth` middleware guarding everything else.
Must appear in: workflows (as one journey), a tutorial OR traced_flow, `big_picture` (one sentence), `routes_jobs` reference, capabilities.

### J2 — Repo Import
ImportPage → GitHub OAuth (`/api/github/oauth/*`) → App installation link (`/api/github/installations/link`) → `POST /api/projects` → repo listed/ready to analyze.
Must appear as ONE journey (today it exists only as 3 disconnected route workflows).

### J3 — Onboarding Analysis & Generation
`POST /api/projects/:id/analyze` (or webhook) → analysis queue → deterministic pipeline → semantic pipeline → auto-chained generation on the summary queue → sections+tutorials → package ready → UI shows it.
The **whole chain across both queues is one journey** — the product's heartbeat. A generation half that's invisible (today's state) is an automatic fail.

### J4 — Local Dev & Test (the DevOps journey; "flow is not just code")
`docker compose up --build` → three services (frontend, backend-api, backend-worker) + their cloud dependencies (Supabase Postgres/Auth, Upstash Redis, GitHub App, OpenRouter + OpenAI) → app on :5173/:3000; and `docker compose -f docker-compose.test.yml run --rm test` as the one-command test journey. Extracted from compose/Dockerfiles/package scripts (see `doc/DETECTION_COVERAGE.md` §3), not from TS code.
Must appear in: setup_run (as THE tutorial), big_picture's topology diagram, guardrails_ops (env vars from `.env.example`, QUEUE_SUFFIX isolation), first_change (verification commands).

## OnboardBuddy golden content — per artifact (the test checklist)

This is what we test against on the dogfood repo; each item is checkable by reading the generated package.

**`big_picture`** must contain: the runtime topology diagram AT TOP (3 compose services + 4 external dependencies, from compose — not hand-waved); the three product journeys J1–J3 named in prose; the snapshot/package content-addressing idea in one sentence; where LLM spend happens (worker only).
**`concepts`** must define at least: project, scope, snapshot, analysis job, package, section, record, receipt, capability, criticality view, privacy mode, budget/kill switch, stable key. Each with where-it-lives (table + module).
**`architecture_deep`** must cover each cluster the clusterer found, and state at least these design decisions with receipts: transaction-pooler ⇒ no session state; content-addressed records keyed by (stable_key, evidence_hash, prompt_version, depth, model_family); two BullMQ queues with auto-chained generation; per-call `ai_generation_runs` audit.
**`traced_flows`** must include J3 end-to-end (API → analysis queue → deterministic phases → semantic phases → summary queue → sections/tutorials → package ready) with its sequence diagram, plus at least one of J1/J2 fully traced.
**`code_map`** must include (grouped by subsystem, not rank): `worker/index.ts`, `summaryWorker.ts`, `aiClient.ts`, `budgetEnforcer.ts`, `semanticPipeline.ts`, `sectionSpecs.ts`, `sectionGenerator.ts`, `retrievalService.ts`, `askService.ts`, `analysisStarter.ts`, `queue.ts`, `db.ts`, the api route index, `001_initial_schema.sql`, frontend `App.tsx` + `PackagesContext.tsx` + `OnboardingPage.tsx` — with the familiar per-function format.
**`capabilities`** must include (or map onto): repo import & GitHub integration, analysis pipeline, package generation, grounded Q&A, access control/teams, budget & privacy guardrails.
**`setup_run`** must be executable truth: env files, `github-app.pem`, compose up, the two URLs, the one-command test run — each with a verify step. Wrong or stale commands = hard fail.
**`common_tasks`** must include at least: add an API route; add a table/column (edit 001 + recreate, per house rule); add/modify a section spec; run one worker locally; write a backend test.
**`routes_jobs`** must list every mounted router group (17 mounts in `routes/index.ts`), BOTH queues with their job types (`analyze_scope`/`preflight`/`incremental_update`; `generate_package`/`regenerate_section`), and the webhook with its trigger semantics.
**`data_model`** must include the ER anchor and at minimum the core chain: users → projects → scopes → snapshots → (graph_nodes/edges, workflows, criticality_scores, semantic_records↔snapshot_semantic_records, embeddings) → packages → sections/tutorials → receipts; plus ai_generation_runs and budget bookkeeping.
**`guardrails_ops`** must list: depth budgets + overrides + stop behaviors, the kill-switch endpoints, privacy modes incl. facts_only stripping, secret-path ingestion filter, env vars from `.env.example` (names + purpose, never values), queue isolation via QUEUE_SUFFIX, heartbeats/orphan reconciliation.
**Tutorials** must cover ≥2 of J1–J3 before anything route-shaped; every step keyed to real code with receipts.
**Diagrams minimum set**: topology (big_picture), ER (data_model), J3 sequence (traced_flows), per-cluster maps (architecture_deep).

## Current state vs the bar — RE-VERIFIED after step 0 (snapshot `55e18c0f` re-extracted 2026-07-24, forced re-run on the new pipeline)

| Golden item | Status now | Was (before step 0) |
| --- | --- | --- |
| J1 User Auth | ✅ **"User authentication" journey** (members in canonical order: signup → login → me → logout) + all four route workflows individually (auth SDK sinks keep them alive; seed auth calls surface as `auth_guard` steps) | MISSING — only `GET /api/auth/me` survived |
| J2 Repo Import | ✅ **"Repo import & GitHub connection" journey**: oauth/start → oauth/complete → installations/link → github/app → connection → **POST /api/projects** (terminal create appended) | FRAGMENTED — 3 disconnected route workflows |
| J3 Analysis & Generation | ✅ **"Analysis → onboarding generation pipeline"** spanning BOTH queues: `POST /:id/analyze` → `Queue consumer: ANALYSIS_QUEUE` → `Queue consumer: SUMMARY_QUEUE` (truncation-proof enqueue detection recovered the auto-chain hop); plus "Onboarding generation pipeline" (regenerate → SUMMARY consumer). SUMMARY consumer has its own workflow (handler-reference seeding) | HALF-MISSING — no SUMMARY workflow, no chain |
| J4 Local Dev & Test | ✅ "Local dev: docker compose up" (dependency-ordered service steps), "Run the test suite (one command)", "CI: on push, pull_request" (needs-ordered jobs); topology stamped on the compose config node | NOT EXTRACTABLE |
| Golden gate | ✅ **5 passes, 0 gaps**: `queue_pipeline:analysi`, `queue_pipeline:summary`, `auth`, `import`, `local_dev`. Honesty: 2 trace dead-ends recorded (internal-chat/health trivial GETs), 10 unmodeled packages listed | no gate existed |
| Tutorials | Journey-first selection bonus shipped; verify picks on the next full generation | route-shaped picks |

## Data-acquisition rethink (feeds the plan's sequencing)

All seven items **shipped 2026-07-24** (plan step 0); implementation notes per item:

1. **Unify consumer detection** ✅ — root cause was handler *references* (`new Worker(Q, processJob)`): the Worker const has no call edges, so the trace died at 1 step. `entrypointDetector.ts` now seeds the referenced handler; both consumers get the "Queue consumer:" treatment. (Fixes J3's missing half.)
2. **Extend the side-effect taxonomy** ✅ — `sideEffectDetector.ts`: `auth_call` (supabase.auth/jwt/passport/bcrypt/firebase/clerk → `auth_check`), `external_service` (openai/openrouter/anthropic/octokit/storage/s3/stripe/email/twilio → `external_integration` with target), `process_exec`; enqueues now carry job name + normalized queue hint. (Fixes J1's extraction.)
3. **Journey composition layer** ✅ — `journeyComposer.ts`: queue-boundary pipelines (producer hint ↔ consumer queue token, multi-hop, consumer-file attribution for chain-forward enqueues), auth route group in canonical order, OAuth start→callback→link chain + terminal create-POST. Journeys are workflow rows (`trigger_type='journey'`, `metadata.journey` with members/boundaries) — ranking/selection/tabs consume them with zero new machinery.
4. **Selection flips journey-first** ✅ — journey/dev_command bonus in `tutorialGenerator.selectWorkflows`; journeys form their own uncapped family. traced_flows drawing from journeys lands with the step-2 spec rewrite.
5. **Config-as-flow extraction** (J4) ✅ — `configFlowExtractor.ts`: compose topology (services/build/ports/depends_on/env_file, dependency-ordered) stamped on the compose config node (big_picture's anchor data), test-compose journey, CI pipelines (triggers + needs-ordered jobs), `.env.example` names+comments (never values), package scripts on their config nodes.
6. **Detection honesty rule** ✅ — `unknown_external` low-confidence fallback (one per file×package, pure-package blocklist; persists as `external_integration` + `metadata.detectorKind`), `TraceDeadEnd` recording in the extractor, rollups into snapshot `unknowns`, surfaced in the coverage strip ("N known unknowns").
7. **Golden-journey gate** ✅ — `journeyGate.ts` runs after composition: shape-conditional assertions (queue+consumer pairs, ≥2 auth routes, ≥2 oauth routes, compose present); gaps land in snapshot `unknowns` + phase metrics. Receipt-resolution and per-artifact content assertions extend with the step-2 spec rewrite.

## Evaluation protocol (every content eval, after the Diátaxis rubric)

1. Golden-journey check first (present / findable / correct / complete, per journey).
2. Then the DIATAXIS_NOTES.md rubric per section.
3. Verdicts always name the smallest fix, and whether the fault is **extraction** (data missing), **composition** (data present, journey absent), **selection** (journey present, buried), or **narration** (surfaced but wrong/vague) — the four failure layers above.
