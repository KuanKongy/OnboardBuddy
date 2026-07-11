# OnboardBuddy

**Team Name:** OnboardBuddies (Team 15)

**Project Name:** OnboardBuddy

**Team Members:**
- Dinh Nam Khanh Le (Nam)
- Eugene Ng
- Sahib Rao
- Bradley Sakran

## Project Description

OnboardBuddy is a codebase onboarding platform that helps developers understand unfamiliar codebases faster. OnboardBuddy builds a persistent, versioned **Codebase Onboarding Package** grounded in verified code references.

The core of the platform is a **deterministic analysis pipeline**: the TypeScript Compiler API parses source code into a structured code evidence model, an algorithmic extractor discovers cross-file workflows, and a composite ranking algorithm identifies the Critical 25% / critical paths a developer needs to become productive. An LLM is used only as an optional layer to generate human-readable explanations on top of already-extracted, validated structure.

## Docker Instructions

The app runs via **Docker Compose**. Three containers start together: frontend, backend API, and backend worker.

1. Place `backend/.env` and `frontend/.env` in their respective directories (submitted on UBC mail).
2. Place `github-app.pem` in `backend/`.
3. From the repo root:

```sh
docker compose up --build
```

5. Access the app:

| Service | Container | URL |
| ------- | --------- | --- |
| Frontend | `frontend` | http://localhost:5173 |
| Backend API | `backend-api` | http://localhost:3000/api |
| Health check | `backend-api` | http://localhost:3000/api/health |
| Backend worker | `backend-worker` | (no HTTP port) |

To stop: `docker compose down`

### Running the automated tests

One command runs **every automated test** (backend + frontend). No local Node/npm, no `.env` files, no running services needed — the suites are self-contained:

```sh
docker compose -f docker-compose.test.yml run --rm test
```

(With Node 22 installed, `npm install && npm test` runs the same suites locally.) Expected: backend `302 passing`, frontend `21 passed`. Details: [doc/TESTPLAN.md](doc/TESTPLAN.md) and [doc/TESTING.md](doc/TESTING.md).

## Milestones

### Milestone 1
- [Proposal document](doc/Team-15-proposal.pdf)
- [Design document](doc/Team-15-design.pdf)

## What the Platform Has

### Dashboard and Projects
Users connect their GitHub repositories through read-only OAuth and manage them as projects on a central dashboard. Each project card shows the analyzed branch, commit hash, analysis status, and whether any onboarding sections have gone stale. Teams can share projects and control who can view or approve generated content.

### Codebase Onboarding Package
Each analyzed repository gets a structured package with sections covering: repository overview, entry points and why they matter, workflow lifecycle guides, data schema and source of truth, safety rails and tooling commands, and architecture references. Every section includes source receipts linking claims back to specific files and lines, confidence labels (High / Medium / Low), and a draft/review workflow so teams approve content before sharing.

### Interactive Codebase Walkthroughs
Guided, step-by-step traces through critical workflows derived from the code evidence model. Each walkthrough is a sequence of annotated stops through the files and symbols involved in a workflow, with contextual explanations at each stop. Walkthroughs are persistent, role-specific, and validated against real code paths — not generated from scratch each time.

### Role-Based Learning Paths
The same codebase produces different onboarding paths depending on the developer's role. A backend developer sees routes, services, auth, and database writes first. A frontend developer sees pages, components, state, and API clients. DevOps sees CI/CD, Docker, deploy scripts, and environment configuration. QA sees test structure, fixtures, coverage, and critical flows.

### Architecture, Dependency, Workflow and Capability Graphs
Four interactive graph tabs, each on its own data: **Architecture** (server-side deterministic clusters with AI or deterministic summaries and criticality bars), **Dependencies** (searchable file map with a classes/interfaces view and the standard symbol doc on click — summary, signature, real call-site example, receipts), **Workflows** (traced request flows from entry point to side effects), and **Capabilities** (business capabilities linked to the workflows and components that deliver them). Layouts use layered (dagre) graph drawing; Mermaid diagrams additionally render inside onboarding sections.

### Incremental Re-analysis
Fully wired: re-analyzing a repo at a new commit diffs files and symbols against the previous snapshot, invalidates only semantic records whose evidence actually changed (whitespace-only edits invalidate nothing), marks affected sections/tutorials/packages stale with `stale_flags`, and regenerates stale sections on request against the newest snapshot. Unchanged symbols are never re-summarized — the content-addressed record cache guarantees it.

## Tech Stack

| Layer | Technology |
| ----- | ----- |
| Frontend | React + TypeScript, Tailwind CSS, React Flow / D3.js |
| Backend API | Node.js + Express + TypeScript |
| Analysis Worker | Node.js + TypeScript |
| Static Analysis | TypeScript Compiler API |
| Auth | Supabase Auth with GitHub OAuth |
| Database | Supabase PostgreSQL |
| Queue | BullMQ backed by Redis |
| Repo Access | GitHub OAuth + GitHub API + Zipball archives |
| AI | OpenRouter with OpenAI as default provider |
| Infra | Docker, GitHub Actions |

## Local Setup

The app runs via **Docker Compose only**. Frontend, backend API, and backend worker start together as containers. External services (Supabase, Upstash Redis, GitHub, OpenRouter) stay in the cloud — see [doc/DEVOPS.md](doc/DEVOPS.md) for full setup.

### Prerequisites

- Docker and Docker Compose
- Supabase project (Auth + PostgreSQL)
- Upstash Redis (TCP/TLS endpoint for BullMQ)
- GitHub OAuth App (Supabase login) and GitHub App (repo import)
- OpenRouter API key (if cloud-assisted AI explanations are enabled)

### Environment

Create env files from the templates and fill in your credentials:

```sh
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

`backend/.env` is required — the API and worker containers load it via `docker-compose.yml`.

### Database

Apply the initial schema once in Supabase (SQL Editor or `psql`):

```txt
backend/supabase/migrations/001_initial_schema.sql
```

The migration is idempotent. To reset everything, run `backend/supabase/migrations/000_drop_all.sql`, then apply `001_initial_schema.sql` again.

### Start the app

From the repo root:

```sh
docker compose up --build
```

Run in the background:

```sh
docker compose up --build -d
```

Ensure `frontend/.env` exists before building — Vite reads it during the frontend image build to embed Supabase and API settings.

Stop:

```sh
docker compose down
```

### Services and URLs

| Service | Container | URL |
| ------- | --------- | --- |
| Frontend | `frontend` | http://localhost:5173 |
| Backend API | `backend-api` | http://localhost:3000/api |
| Health check | `backend-api` | http://localhost:3000/api/health |
| Backend worker | `backend-worker` | (no HTTP port) |

Dockerfiles:

- API: `backend/Dockerfile.api`
- Worker: `backend/Dockerfile.worker`
- Frontend: `frontend/Dockerfile`

---

## Milestone 2

### Milestone 2 Functionality

Our M2 deliverable covers the core analysis pipeline, onboarding package UI, dependency visualization, walkthrough UI, and project management. Several M3 items are partially implemented; others remain stubs or design gaps. The table below reflects what is actually shipped today.

#### Non-Trivial Features

| Feature | M2 Target | Actual State | Type | How to Use |
|---------|-----------|--------------|------|------------|
| AST Parser + Onboarding Package | One role, single text field, OpenAI | Structured multi-section packages for 5 roles (backend, frontend, devops, qa, general), generated via OpenRouter with source receipts. Role tone comes mainly from prompts and file-pattern weighting — not fully separate pipelines per role. | Meets / partial M3 | Import a repo, trigger analysis, view the package under "Your Onboarding". Switch roles via the role dropdown. |
| Dependency Graph Visualizer | One graph type | **Dependencies** tab: searchable dependency map with clustering/caps for large repos (see `GraphPage.tsx`). **Architecture** tab is still a stub. | Meets M2 | Open a project → **Dependencies**. Search files, click nodes for detail panels; drill into clusters when shown. |
| Workflow Extraction + Walkthrough | Extraction algorithm + mock tutorial page | Walkthrough UI is functional. Extraction is a **dependency-edge BFS** from entry points (max ~15 steps), not the full generic call-flow system in Design.md. | Meets M2 UI; partial extraction | Open **Walkthrough**, pick a workflow, step through stops. |
| Critical 25% Ranking | One role only | Composite scoring uses **5 signals** (fan-in, fan-out, export count, entrypoint, side effects) × role file-pattern relevance. Rankings are computed per role but the LLM evidence query does not filter rankings by the requested role. | Meets M2; multi-role scoring added | See the "Critical 25%" section in the onboarding package. |
| Incremental Re-analysis | If time permits | Helper functions for stale receipt detection exist in `sectionValidator.ts`, but are **not wired** into the worker re-analysis flow. | Not complete | N/A — manual review toggle works; automatic stale propagation on re-analyze is incomplete. |

#### Standard Features

| Feature | M2/M3 | State | Owner | How to Use |
|---------|-------|-------|-------|------------|
| Authentication (Supabase + GitHub OAuth) | M2 | Functional | Nam | Sign up or log in at `/login`. GitHub OAuth is available as an alternative. |
| Repository Import + Branch Selection | M2 | Functional | Nam | Click "Import Repository" on the dashboard. Install the GitHub App, select a repo, pick a branch, and choose your developer role. |
| Project CRUD | M2 | Functional | Nam | Create projects via import. View on dashboard. Delete from project settings. |
| Developer-role Preference | M2 | Functional | Nam | Select role during import or change it in project settings. |
| Dashboard | M2 | Functional | Eugene | The landing page after login shows project cards, stats, and recent activity. |
| Package Export | M2 | Functional | Eugene | Click "Export" on the onboarding page to download as Markdown. |
| Team Invitations | M3 | Functional | Nam | Go to the "Team" tab, click "Invite Member", enter an email. Invitee accepts from their Invitations page. |
| Permission Tiers (Owner/Admin/Developer) | M3 | Functional | Nam | Set during invitation. Owner has full control, Admin manages members, Developer views content. |
| Settings (Account + Project) | M3 | Functional | Eugene | Account settings accessible from sidebar. Project settings from the project's "Settings" tab. |
| Analysis Run Status | M3 | Functional | Eugene | After triggering analysis, the project overview shows progress (queued, running, complete, failed). |
| Review/Approve Controls | M3 | Functional | Eugene | Click "Mark Reviewed" on any generated onboarding package to toggle section review status. |

---

## Milestone 3

### Milestone 3 Functionality

M3 delivers the full **hybrid semantic pipeline** ([doc/Pipeline.md](doc/Pipeline.md) is the binding spec): a symbol-level code evidence graph, call-graph workflow extraction, two-phase criticality ranking, an LLM semantic layer with caching/budgets/privacy modes, multi-view embeddings with Graph-RAG retrieval, evidence-cited generation with citation validation, code tutorials, incremental re-analysis with staleness, and a reworked UI (four graph tabs, package cards, settings, guided tour). All external services (Supabase, Redis, GitHub App, OpenRouter LLM + embeddings) are integrated.

Run the app with `docker compose up --build` (see Docker Instructions above), open http://localhost:5173, log in, and import a repository. Everything below is reachable from a project's sidebar tabs.

#### Non-Trivial Features (Design.md §1.5) — cumulative across M2 + M3

All five non-trivial features from the design document, as shipped:

| # | Design.md feature | State | How to Use |
|---|-------------------|-------|------------|
| 1 | **Role-Based Onboarding Package + AST Parser** — GitHub App import with snapshot download, TypeScript Compiler API evidence extraction (symbols, signatures/body hashes, imports/exports, calls, side effects, entrypoints, docs/config/schema), 11-section package with per-claim source receipts, confidence labels, draft/review workflow, 5 developer roles generated on demand from one analysis | Functional | Import a repo → **Analyze…** → **Your Onboarding** → open your role's package card. Other roles: "Generate for &lt;role&gt;" (no re-analysis). |
| 2 | **Graph Visualizer, Architecture Map, Module Dependency Graph** — architecture clusters with summaries, searchable file dependency map, class/interface graph (extends/implements), workflow step graphs, capability map; all clustered/capped for readability with receipt drill-down on every node | Functional | Sidebar tabs **Architecture**, **Dependencies** (+ "Classes & interfaces" toggle), **Workflows**, **Capabilities**. Click any node for details + receipts. |
| 3 | **Generic Workflow Extraction + Walkthrough/Tutorial Generation** — call-graph tracing from entrypoints (routes, UI pages, jobs, exports) to side effects, collapsed into readable steps; tutorials pair each step with a real code snippet, an AI explanation, and receipts | Functional | **Workflows** tab for traced flows; **Tutorials** tab for step-by-step walkthroughs (deterministic fallback when no tutorial is generated for the role). |
| 4 | **Critical 25% / Critical Path Identification** — two-phase ranking: deterministic composite scoring (entrypoint exposure, downstream impact, centrality, side effects, doc gap, tests, churn) gated, then LLM-blended multi-view scores; role-specific projections with explainable reasons and editable weights | Functional | "Critical 25%" section in the onboarding package; importance + reasons in Dependencies node panels; weights in **Settings → Ranking weights** (applies instantly). |
| 5 | **Incremental Re-analysis** — file/symbol AST diff against the previous snapshot, evidence-hash invalidation with upward propagation (whitespace-only edits invalidate nothing), stale flags on affected sections/tutorials/packages, per-section regeneration against the newest snapshot, preserved review history | Functional | Push commits → **Analyze…** again (runs incremental) → stale badges appear → **Regenerate** on stale sections. Manual trigger by design (webhooks are future work). |

#### Milestone 3 pipeline work in detail

| Feature | State | Type | How to Use |
|---------|-------|------|------------|
| Symbol-level evidence graph (TS Compiler API: symbols, signatures/body hashes, call resolution, side effects, entrypoints, docs/config/schema nodes, trust levels) | Functional | Non-trivial | Runs inside every analysis. Inspect via **Dependencies** (click a node for the symbol doc) and API `GET /projects/:id/graph/*`. |
| Call-graph workflow extraction (entry point → side effects, step kinds, deterministic descriptions) | Functional | Non-trivial | **Workflows** tab: pick a traced flow, follow the step graph, click steps for details. |
| Two-phase criticality ranking (deterministic Phase A gating + LLM-blended Phase B multi-view scores, per-role projections with editable weights) | Functional | Non-trivial | "Critical 25%" section in onboarding; importance + reasons in the Dependencies node panel; weights editable in **Settings → Ranking weights** (instant, no re-analysis). |
| LLM semantic layer (batched symbol records → file/module/service/system synthesis → capabilities → refinement → critique), content-address cached so unchanged code is never re-paid | Functional | Non-trivial | Runs during analysis when AI is enabled. Summaries surface in Architecture components, symbol docs, and onboarding sections. |
| Budgets, privacy modes and BYO key (per-depth LLM budgets with pause/degrade/fail, kill switch, `full_ai`/`facts_only_ai`/`ai_disabled`, per-project encrypted OpenRouter key) | Functional | Non-trivial | **Settings → AI & privacy / Analysis budget / Project LLM API key**. Live spend under **Overview → Pipeline phases & spend**. |
| Multi-view embeddings + Graph-RAG retrieval (purpose/domain/dependency/operations views, pgvector + graph-neighborhood expansion) | Functional | Non-trivial | Powers section generation, tutorials and Q&A internally; retrieval stats stored per section in `generation_context`. |
| Evidence-cited onboarding generation (11 section types incl. capability map & role path, per-claim receipts, trust-aware citation validation with downgrade-not-invent, Mermaid diagrams, honest unknowns) | Functional | Non-trivial | **Your Onboarding** → open a package card → read sections; click receipt chips for code snippets; "Known gaps" lists what could not be verified. |
| Code tutorials (real traced flows: per-step code snippet + AI explanation + receipts) | Functional | Non-trivial | **Tutorials** tab; falls back to deterministic workflow steps when no tutorial is generated. |
| Incremental re-analysis + staleness (file/symbol AST diff, evidence-hash invalidation, stale flags, regenerate stale sections against the newest snapshot) | Functional | Non-trivial | Re-run **Analyze…** after pushing commits; stale badges appear on affected sections/packages; click **Regenerate** on a stale section. |
| Grounded Q&A endpoint (intent-routed retrieval, receipt-cited answers, citation-validated) | Functional (internal eval tool) | Stretch | Dev-only: `POST /api/projects/:id/ask` or the internal chat page at `/api/internal/chat` (non-production). |
| Analyze preview (preflight: scope + commit selection, file counts, cost tier, privacy summary before spending) | Functional | Non-trivial | **Overview → Analyze…** → pick scope/commit → "Preview first". |
| Interactive graph tabs (Architecture clusters, Dependencies + classes, Workflows, Capability map; dagre layouts; symbol doc format) | Functional | Non-trivial | Sidebar tabs of any analyzed project. |

#### Standard Features (Design.md §1.6) — cumulative across M2 + M3

All twelve standard features from the design document:

| Feature | Milestone | State | How to Use |
|---------|-----------|-------|------------|
| User authentication (Supabase Auth + GitHub OAuth) | M2 | Functional | Sign up / log in at `/login` with email+password or GitHub. Connect the GitHub App from Account Settings for repo access. |
| Repository import + branch selection (GitHub App) | M2 | Functional | Dashboard → **Import Repository** → pick installation, repo, branch, role. |
| Project dashboard navigation | M2 | Functional | Project cards with status on the dashboard; project view with sidebar tabs (Overview, Onboarding, Architecture, Dependencies, Workflows, Capabilities, Tutorials, Team, Settings). |
| Project CRUD | M2 | Functional | Create via import; view on dashboard; update settings (branch metadata, ignored paths, limits); delete from project settings. |
| Project team invitations | M3 | Functional | **Team** tab → Invite Member by email with tier + role; invitee accepts from their Invitations page; revocable. |
| Permission tiers (Owner / Admin / Developer) | M3 | Functional | Set at invitation. Owner: full control. Admin: members + settings. Developer: view content, pick role, generate missing role packages — cannot re-run analysis. |
| Developer-role preference selector | M2 | Functional | Chosen at import/join; changeable in project settings; decides which package opens first. |
| Settings (Privacy, AI provider, Project, Team) | M3 | Functional | **Settings** tab: privacy mode (`full_ai` / `facts_only_ai` / `ai_disabled`), analysis depth, budgets + stop behavior, BYO OpenRouter key, ranking weights, ignored paths, limits. Team settings in the **Team** tab. |
| Analysis run status | M3 | Functional | One combined progress bar on **Overview** (analysis 0–70%, generation 70–100%, stage-labeled, never moves backwards) with a live activity list and per-phase metrics + spend. |
| Package export (Markdown / zip) | M2 | Functional (Markdown) | Reader → **Export** → downloads a Markdown file with all sections. Zip bundle not implemented — Markdown covers the single-file case. |
| Review/approval controls | M3 | Functional | Mark sections reviewed in the reader; approval state shows on package cards and persists. |
| Snapshot history (stretch) | M3 | Partial | `GET /projects/:id/snapshots` lists past snapshots (commit, scope, date, trigger); package cards show which commit each package was generated from. No dedicated history page yet. |

Beyond the design document, M3 also added: onboarding package cards with role/status/freshness filters, on-demand per-role generation (no 5-role fan-out), an analyze preview (preflight cost/privacy estimate before spending), a first-timer guided tour, and contrast-tuned dark/light themes.

#### Testing

All automated suites run with one command — `docker compose -f docker-compose.test.yml run --rm test` (see "Running the automated tests" above). The full test plan for the TA — automated commands plus manual checklists — is in [doc/TESTPLAN.md](doc/TESTPLAN.md), with every suite explained in [doc/TESTING.md](doc/TESTING.md). Bugs are tracked in [doc/BUGS_AND_FIXES.md](doc/BUGS_AND_FIXES.md) and mirrored to GitHub Issues.
