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

### Architecture and Dependency Graphs
Interactive visualizations show dependency relationships for a project snapshot. The **Dependencies** tab renders a searchable dependency map with clustering for large repos (directory clusters, drill-down, capped node counts — not the entire repo at once). The **Architecture** tab is not implemented yet (placeholder page). Class/interface and workflow path diagrams from the design doc are not built.

### Incremental Re-analysis
Partial support exists: `sectionValidator.ts` can compare receipt hashes across snapshots and create `stale_flags`, but this logic is **not wired into the analysis worker pipeline** yet. The dashboard may show stale indicators when flags exist, but a new analysis run does not automatically re-check all sections end-to-end.

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
