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

This repository is scaffolded as an npm workspace with separate frontend and backend packages.

### Prerequisites

- Node.js 22+
- npm 10+
- Supabase project
- Redis instance for BullMQ worker queues
- GitHub OAuth app credentials
- OpenRouter API key and default OpenAI provider/model values, only if cloud-assisted explanations are enabled

### Install

```sh
npm install
```

### Environment

Create local env files from the templates:

```sh
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Fill in the Supabase, Redis/BullMQ, GitHub OAuth, and OpenRouter/OpenAI default-provider values as needed.

### Database

The initial schema is in:

```txt
backend/supabase/migrations/001_initial_schema.sql
```

Apply it through the Supabase SQL editor or your team's migration flow.

### Development

Run the frontend plus backend API and worker:

```sh
npm run dev
```

Run one app:

```sh
npm run dev:backend
npm run dev:frontend
```

Run backend processes separately:

```sh
npm run dev:api -w backend
npm run dev:worker -w backend
```

Backend entrypoints are intentionally separate:

- API: `backend/src/api/server.ts`
- Worker: `backend/src/worker/index.ts`

Backend tests follow the same split:

- API tests: `backend/test/api`
- Worker tests: `backend/test/worker`
- Analysis/ranking/AI/incremental re-analysis skeletons: `backend/test/analysis`, `backend/test/ranking`, `backend/test/ai`, `backend/test/incremental-reanalysis`

Default local URLs:

- Backend API: `http://localhost:3000/api`
- Health check: `http://localhost:3000/api/health`
- Frontend: `http://localhost:5173`

### Verification

```sh
npm run lint
npm run test
npm run build
```

The current implementation is intentionally a backbone only. The health check and app shell are real; product features are represented by placeholders and todo-style tests.

### Docker

After creating `backend/.env`, build and run the backend API, backend worker, and frontend containers:

```sh
docker compose up --build
```

The API and worker use separate Dockerfiles:

- API: `backend/Dockerfile.api`
- Worker: `backend/Dockerfile.worker`
