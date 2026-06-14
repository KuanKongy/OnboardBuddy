# Team 15 - OnboardBuddies
## Team members:
- Dinh Nam Khanh Le
- Eugene Ng
- Sahib Rao
- Bradley Sakran

## Milestone 1
- [Proposal document](doc/Team-15-proposal.pdf)
- [Design document](doc/Team-15-design.pdf)

# OnboardBuddy

## Project Description

OnboardBuddy is a codebase onboarding platform that helps developers understand unfamiliar codebases faster. OnboardBuddy builds a persistent, versioned **Codebase Onboarding Package** grounded in verified code references.

The core of the platform is a **deterministic analysis pipeline**: the TypeScript Compiler API parses source code into a structured code evidence model, an algorithmic extractor discovers cross-file workflows, and a composite ranking algorithm identifies the Critical 25% / critical paths a developer needs to become productive. An LLM is used only as an optional layer to generate human-readable explanations on top of already-extracted, validated structure.

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
Interactive visualizations (React Flow / D3.js) show high-level architecture maps, dependency clusters grouped by module, class/interface relationships, and workflow path diagrams. Graphs are pull-based — the system shows relevant slices, not the entire repo graph.

### Incremental Re-analysis
When code changes, the platform compares file and symbol hashes across analysis snapshots to identify which generated onboarding sections may be stale. Teams can regenerate specific sections or mark them as reviewed.

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
