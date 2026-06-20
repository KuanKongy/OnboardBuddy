# OnboardBuddy -- Test Plan (Milestone 2)

This document describes how to test OnboardBuddy. It covers setup, automated test suites, and manual test checklists for the TA to validate the application.

---

## 1. Setup

### Prerequisites

- **Node.js 22** and **npm** (for running automated tests locally)
- **Docker Desktop** (for running the full app)

### Clone and Install

```bash
git clone <repo-url>
cd team15
npm install
```

### Environment Files

**For automated tests:** No `.env` files or Docker are needed. Tests call the same backend engine functions the worker uses, with a shared fixture repo (`backend/src/worker/fixtures/simple/`). The API boots in-process via Supertest with placeholder env vars from `backend/test/setup.ts`. See [TESTING.md](./TESTING.md) for the full test catalog and layer breakdown.

**For manual tests (and future integration tests):** Docker + real credentials:

1. Place `backend/.env` in the `backend/` directory (submitted on UBC Mail).
2. Place `frontend/.env` in the `frontend/` directory (submitted on UBC Mail).
3. Place `github-app.pem` in the `backend/` directory (submitted on UBC Mail).
4. Fork 'https://github.com/KuanKongy/CourseInsights' repo into your GitHub account and use it for onboarding. It is a CPSC 310 project.

### Running the App (for manual tests)

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000/api |
| Health check | http://localhost:3000/api/health |

---

## 2. Automated Tests

### Run All Tests

```bash
npm run test
```

This fans out to each workspace's `test` script via npm workspaces, running both backend (Mocha) and frontend (Vitest) tests.

### Backend Tests (Mocha + Chai + Supertest)

```bash
npm run test -w backend
```

**Expected output:** 137 passing, 0 pending.

**What is covered:**
- Health endpoint (`GET /api/health`) returns 200
- Auth routes: signup/login validation (400 for missing fields), unauthenticated guards (401)
- GitHub routes: unauthenticated guards (401) for app, installations, repos, branches
- Project routes: unauthenticated guards (401) for CRUD, analyze, settings
- Member routes: unauthenticated guards (401) for list, invitations, role updates, removal
- Invitation routes: unauthenticated guards (401) for list, detail, accept
- Onboarding routes: unauthenticated guards (401) for package, export, receipts, validate, review
- Workflow routes: unauthenticated guards (401) for list, walkthrough
- Graph routes: unauthenticated guards (401) for dependencies, node detail
- Encryption: AES-256-GCM round-trip, random IV, format validation, tamper detection, key validation
- Repo Ingester: file discovery, language detection, path resolution, error handling, language filtering
- Symbol Extractor: type aliases, functions, classes, enums, interfaces, imports, JSDoc, exports
- Graph Builder: node creation, import edges, dependent counts, entry point detection, edge deduplication
- Entrypoint Detector: detects entry files by pattern and inbound-edge absence
- Side Effect Detector: identifies DB writes, network calls, file I/O, process exits
- Workflow Extractor: traces entrypoint-to-side-effect paths
- Analysis Pipeline: repo inventory, privacy filtering, AST extraction, symbol hashing
- Critical Ranking: composite scoring, role-based re-weighting

### Frontend Tests (Vitest + Testing Library)

```bash
npm run test -w frontend
```

**Expected output:** 20 passing, 0 todo.

**What is covered:**
- App routing: intro page, login page, signup page, protected route redirect
- Graph page: node rendering from mock data, search filtering, node click info panel
- Login page: form rendering, validation, submit behavior
- Signup page: form rendering, password validation, submit behavior
- Feature flows: GitHub import chain, role-specific onboarding, walkthrough steps, graph rendering, review status

### Lint

```bash
npm run lint
```

**Expected output:** 0 errors. ESLint runs across the entire monorepo.

### Build (Type Check + Production Build)

```bash
npm run build
```

**Expected output:** Clean build with 0 TypeScript errors and successful Vite production bundle.

---

## 3. Manual Test Checklists

Run these against the Docker stack (`docker compose up --build`) with valid `.env` files.

### 3.1 Authentication

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to http://localhost:5173 | Landing page with "Onboard Developers" heading is displayed |
| 2 | Click "Get Started" or navigate to `/signup` | Signup form with email, password fields and "Sign in with GitHub" button |
| 3 | Enter a valid email and password (min 8 chars), click "Create Account" | Account created, redirected to `/dashboard` |
| 4 | Click the user avatar in the sidebar, click "Sign Out" | Redirected to `/login` or intro page |
| 5 | Navigate to `/login`, enter credentials, click "Sign In" | Redirected to `/dashboard` |
| 6 | Click "Sign in with GitHub" on the login page | Redirected to GitHub OAuth, then back to the app's dashboard |

### 3.2 GitHub Setup

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Go to Account Settings (sidebar) | Shows GitHub connection status |
| 2 | Click "Connect GitHub" | Redirected to GitHub App authorization flow |
| 3 | Authorize the OnboardBuddy GitHub App | Returned to app with GitHub connected status |

### 3.3 Repository Import

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Import Repository" on the dashboard | Import page loads showing GitHub App configuration |
| 2 | If no installations, click "Configure repositories" | GitHub App install flow opens |
| 3 | After installing, select an installation from the dropdown | Repository list loads |
| 4 | Select a repository | Branch dropdown appears |
| 5 | Select a branch | Branch selected, developer role dropdown visible |
| 6 | Choose a developer role (e.g., "General") | Role selected |
| 7 | Click "Create Project" | Project created, redirected to project overview |

### 3.4 Analysis

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | On the project overview page, click "Run Analysis" | Analysis job queued, progress indicator appears |
| 2 | Wait for analysis to complete | Status changes from "Analyzing" to "Complete" with stats (files, symbols, edges) |
| 3 | If analysis fails, check the status message | Error message displayed, can retry |

### 3.5 Onboarding Package

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to the "Your Onboarding" tab | Onboarding page loads with section navigation on the left |
| 2 | Click through different sections (Start Here, Entry Points, etc.) | Content updates in the main area with Markdown rendering |
| 3 | Each section shows source receipts | Receipts display with file paths, line numbers, confidence labels |
| 4 | Switch roles using the role dropdown in the right panel | Package reloads with role-specific content; role status badges update |
| 5 | Click "Mark Reviewed" on a generated package | Section review status updates to "Approved" (persists on refresh) |
| 6 | Click "Export" > "Markdown file" | Markdown file downloads with all sections |

### 3.6 Dependency Graph

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to the "Dependencies" tab | Graph renders with module nodes and edges |
| 2 | Type in the search bar | Nodes filter to match the search, count updates (e.g., "2 / 15 modules") |
| 3 | Click a node | Info panel opens showing exported symbols, functions, imports |
| 4 | Large repos show clustered directory groups | Clusters are expandable/navigable |

### 3.7 Walkthrough

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to the "Walkthrough" tab | List of discovered workflows loads |
| 2 | Select a workflow | Step-by-step walkthrough opens |
| 3 | Navigate through stops | Each stop shows the file, symbol, and contextual explanation |

### 3.8 Team Management

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to the "Team" tab | Team member list displays (at minimum, the owner) |
| 2 | Click "Invite Member" | Dialog opens with email field and permission tier selector |
| 3 | Enter an email, select a tier, click "Send Invitation" | Invitation created, shown in pending invitations list |
| 4 | Log in as the invited user, go to Invitations page | Pending invitation visible with accept/decline options |
| 5 | Click "Accept" | User gains access to the project |

### 3.9 Settings

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Settings" in the sidebar | Account settings page loads with profile info |
| 2 | GitHub connection status visible | Shows connected/disconnected state with username |
| 3 | Navigate to a project's "Settings" tab | Project settings load: ignored paths, AI toggle, branch info |
