# Testing Documentation

OnboardBuddy uses a **layered** testing strategy. Most automated tests run locally with `npm run test` and do **not** require Docker. Unit and pipeline tests call the **same production functions** the worker uses, against a **shared fixture repo**. Integration and manual tests use the Docker stack plus cloud services (Supabase, Redis, GitHub, OpenRouter).

For TA-facing run instructions, see [TESTPLAN.md](./TESTPLAN.md).

## Quick Reference

```sh
# Run Layer 1–2 tests (no Docker required)
npm run test -w backend    # 137 passing
npm run test -w frontend   # 20 passing

# Lint + typecheck/build
npm run lint               # 0 errors
npm run build              # frontend + backend compile

# Layer 3: stack smoke tests (Docker required)
docker compose up --build -d
npm run test:stack         # API health + frontend landing page via Playwright
docker compose down
```

---

## Test Layers

| Layer | What runs | Docker? | External services? | Examples |
|-------|-----------|---------|-------------------|----------|
| **1 — Engine unit** | Production engine functions in-process | No | No | `buildRepoIndex`, `extractFileAnalysis`, `buildDependencyGraph`, `rankCriticalFiles` |
| **2 — API in-process** | Express app via Supertest + fake env | No | No (placeholders only) | 401 guards, signup/login validation |
| **3 — Stack integration** | API + worker + frontend containers | **Yes** | Supabase, Redis, GitHub, OpenRouter | Worker job lifecycle, authenticated CRUD, end-to-end analysis |
| **4 — Manual** | Browser against Docker URLs | **Yes** | Same as layer 3 | Checklists in TESTPLAN.md §3 |

**Key idea:** Layers 1–2 exercise real code paths without standing up the stack. Layer 3 reuses the same engine code Layer 1 already tested, but adds persistence, queues, auth, and HTTP boundaries.

### What is shared

| Resource | Used by |
|----------|---------|
| `backend/src/worker/fixtures/simple/` | Engine unit tests, pipeline tests, ranking tests — same 3-file TS mini-repo |
| Engine modules under `backend/src/worker/engine/` | Production worker **and** unit tests (identical imports) |
| `backend/test/setup.ts` | All backend tests — injects placeholder `DATABASE_URL`, Supabase keys, encryption key so Express can boot |
| `backend/.env` + `frontend/.env` | Docker compose, manual testing, future integration tests |
| Supabase / Upstash Redis | Dev, Docker worker, manual tests — not needed for `npm run test` today |

Unit tests are not a separate “test-only” implementation. They import and call the same functions the analysis worker runs in production.

---

## Backend Tests

**Framework:** Mocha + Chai + Supertest
**Runner:** `node --import tsx ../node_modules/mocha/bin/mocha.js`
**Config:** `backend/.mocharc.yml`

### 1. API Route Tests (Layer 2 — in-process)

These tests boot the real Express app in-process via Supertest. `backend/test/setup.ts` sets placeholder env vars so routes load without connecting to Supabase, Postgres, or Redis. Most tests only assert **401/400 guards** — they never hit the database.

| File | Endpoints Covered | Tests |
|------|-------------------|-------|
| `test/api/auth.test.ts` | `POST /signup` (3 validation), `POST /login` (2 validation), `POST /logout` (2 auth), `GET /me` (1 auth) | 8 |
| `test/api/github.test.ts` | `GET /github/app`, `GET /github/installations`, `GET /github/repos`, `GET /github/repos/:owner/:repo/branches` | 4 |
| `test/api/projects.test.ts` | `GET /projects` (2: no auth + malformed header), `POST /projects`, `GET /projects/:id`, `DELETE /projects/:id`, `POST /projects/:id/analyze`, `PUT /projects/:id/settings` | 7 |
| `test/api/members.test.ts` | `GET /projects/:id/members`, `GET /members/invitations`, `POST /members/invitations`, `PATCH /members/:userId`, `DELETE /members/:userId` | 5 |
| `test/api/invitations.test.ts` | `GET /invitations`, `GET /invitations/:id`, `POST /invitations/:id/accept` | 3 |
| `test/api/onboarding.test.ts` | `GET /onboarding`, `GET /onboarding/export`, `GET /sections/:sectionId/receipts`, `GET /onboarding/validate`, `PATCH /sections/:sectionId/review` | 5 |
| `test/api/workflows.test.ts` | `GET /workflows`, `GET /workflows/:workflowId/walkthrough` | 2 |
| `test/api/graph.test.ts` | `GET /graph/dependencies`, `GET /graph/nodes/:nodeId` | 2 |
| `test/api/health.test.ts` | `GET /health` (public, no auth required) | 1 |

**Total: 38 passing**

### 2. Analysis Pipeline Tests (Layer 1 — same functions as worker)

File: `test/analysis/pipeline.todo.test.ts`

Calls the same pipeline functions the worker uses (`buildRepoIndex` → `extractFileAnalysis`, etc.) against the shared `simple` fixture. No Docker, no DB writes.

| Test | What It Verifies |
|------|-----------------|
| Repo inventory detects TypeScript project shape and key configs | `buildRepoIndex` correctly identifies all `.ts` files and sets `detectedLanguage` |
| Privacy filtering excludes .env files, ignored paths, and secret-like content | No `.env` or `node_modules` paths appear in the file index |
| AST extraction records files, symbols, imports, exports, and calls | Every `FileAnalysis` has symbols and imports; class, function, and type kinds are present |
| AST extraction assigns stable symbol keys and body/signature hashes | Every symbol has a non-empty name and valid line numbers |

**Passing: 4 | Pending: 3**

| Pending test | Blocker | Could implement as |
|--------------|---------|-------------------|
| Workflow extraction discovers entrypoint-to-side-effect paths | Not written yet | Layer 1 — `extractWorkflows()` already has unit tests; wire into pipeline test |
| Code evidence model persists nodes and edges for a completed snapshot | Needs DB write path | Layer 3 — Docker + Supabase, or mocked `query()` |
| Generated sections persist source receipts and generation context | Needs DB + optional AI | Layer 3 — Docker stack + test project row |

### 3. Ranking Algorithm Tests (Layer 1)

File: `test/ranking/ranking.todo.test.ts`

Uses the same `rankCriticalFiles()` function as production, fed by fixture-derived graph/entrypoint/side-effect data.

| Test | What It Verifies |
|------|-----------------|
| Composite score matches the weighted 5-signal formula | Rankings have `fanIn`, `fanOut`, `exportCount`, `isEntrypoint`, `hasSideEffects` scores |
| Role-based re-ranking changes top files appropriately | General role produces at least as many rankings as backend-specific |
| Ranking reasons explain the score signals | Each ranking includes a `reasons` array; entry points have "Entry point" in reasons |

**Passing: 3 | Pending: 2**

| Pending test | Blocker | Could implement as |
|--------------|---------|-------------------|
| Auth and DB-write workflows rank above low-impact utility flows | Needs richer fixture (routes + DB side effects) | Layer 1 — add fixture files, still no Docker |
| High-churn isolated files do not dominate critical path rankings | Needs multi-file churn scenario | Layer 1 — extend shared fixture |

### 4. Encryption Tests (Layer 1 — pure library)

Tests the token encryption/decryption library used for storing GitHub OAuth tokens.

| Test | What It Verifies |
|------|-----------------|
| Round-trip decrypt | `decrypt(encrypt(text))` returns original plaintext |
| Random IV | Same input produces different ciphertexts each call |
| Rejects empty string | `encrypt("")` followed by `decrypt()` is handled gracefully |
| Unicode content | Non-ASCII characters survive the round-trip |
| Very long strings | Large payloads encrypt/decrypt correctly |
| Hex format | Output matches `iv:authTag:ciphertext` pattern |
| Corrupted ciphertext | Throws on tampered hex data |
| Invalid format | Throws when parts are missing |
| Empty string input | `decrypt("")` throws |
| Missing key | Throws when `TOKEN_ENCRYPTION_KEY` env var is absent |
| Wrong key length | Throws when key is not 64 hex characters |

**Passing: 11**

### 5. Engine Unit Tests (Layer 1 — `src/worker/engine/__tests__/`)

Each file imports production engine modules and runs them against the shared `simple` fixture. These are the deepest unit tests — same code the worker executes during analysis.

#### Symbol Extractor (`symbolExtractor.test.ts`)

Verifies that the TypeScript AST parser correctly extracts symbols (classes, functions, interfaces, enums, types) from source files.

| File Under Test | Tests |
|-----------------|-------|
| `jwtUtil.ts` | No parse errors, extracts `TokenPayload` type, `signToken` function, `verifyToken` arrow-function, `TokenStatus` enum, valid line numbers, zero imports | 7 |
| `authService.ts` | No parse errors, extracts `ICredentials` and `ISession` interfaces, `AuthService` class with JSDoc, correct imports from jwtUtil, not type-only | 7 |
| `index.ts` | No parse errors, 2 imports, correct `AuthService` and `signToken` imports, exports `authService` | 5 |

**Passing: 19**

#### Graph Builder (`graphBuilder.test.ts`)

Verifies dependency graph construction: node creation, edge resolution (including `.js` → `.ts` specifier mapping), and entry point detection.

| Section | Tests |
|---------|-------|
| Nodes | One node per file, relative path IDs, `kind = module`, exported symbols listed, correct dependent counts | 7 |
| Edges | Import edges between index → authService, index → jwtUtil, authService → jwtUtil; no duplicates; weight ≥ 1 | 5 |
| Entry points | `index.ts` detected; `jwtUtil.ts` excluded (has inbound imports) | 2 |
| Resolved imports | `../utils/jwtUtil.js` specifier resolves to `jwtUtil.ts`; `./services/authService.js` resolves to `authService.ts` | 2 |

**Passing: 16**

#### Repo Ingester (`repoIngester.test.ts`)

| Test | What It Verifies |
|------|-----------------|
| Root path | `buildRepoIndex` returns the resolved absolute path |
| File discovery | All `.ts` files in fixture are found |
| Language tagging | Every file entry has `language: "typescript"` |
| Detected language | Overall project language is `"typescript"` |
| File sizes | Each entry has `sizeBytes > 0` |
| Absolute paths | Entries start with the root path |
| Error handling | Non-existent path throws with "does not exist" |
| Language filter | `filterByLanguage("typescript")` returns all; `"javascript"` returns none |

**Passing: 9**

#### Entrypoint Detector (`entrypointDetector.test.ts`)

| Test | What It Verifies |
|------|-----------------|
| Export entrypoint | `index.ts` is detected with `kind: "export"` |
| Utility exclusion | `jwtUtil.ts` is not detected as an entrypoint |
| At least one | The fixture produces at least one entrypoint |
| Valid kinds | All detected kinds are in the allowed set |

**Passing: 4**

#### Side Effect Detector (`sideEffectDetector.test.ts`)

| Test | What It Verifies |
|------|-----------------|
| Array output | Returns an array (may be empty for a simple fixture) |
| Valid kinds | Each effect has a kind from the allowed set (database_write, http_call, etc.) |
| File path | Each effect includes a non-empty file path |

**Passing: 3**

#### Workflow Extractor (`workflowExtractor.test.ts`)

| Test | What It Verifies |
|------|-----------------|
| Extraction | At least one workflow is extracted |
| Required fields | Each workflow has title, triggerType, stableKey, importanceScore, confidence, steps |
| Step order | Steps have sequential `stepOrder` values |
| Trigger first | The first step of each workflow has `isTrigger: true` |
| Sorted by importance | Workflows are ordered by `importanceScore` descending |

**Passing: 5**

### 6. Previously Pending Tests — Now Implemented

All 25 backend `it.skip` placeholders and 5 frontend `test.todo` items have been replaced with real tests:

| Area | File | What was added |
|------|------|----------------|
| Pipeline | `test/analysis/pipeline.todo.test.ts` | Workflow extraction, graph evidence model, receipt shape |
| Ranking | `test/ranking/ranking.todo.test.ts` | Entrypoint scoring signal, top-ranked entry file |
| API integration | `test/api/routes.todo.test.ts` | Mocked auth + DB tests for auth, GitHub, projects, export/review, team permissions |
| AI generation | `test/ai/generation.todo.test.ts` | Evidence context, citation validation, AI-disabled guard, draft status |
| Re-analysis | `test/incremental-reanalysis/reanalysis.todo.test.ts` | Stale hash detection, stale flags, unchanged sections |
| Worker queue | `test/worker/jobs.todo.test.ts` | Redis URL parsing, job payloads, retry policy, step logs |
| Frontend flows | `frontend/src/test/frontend-flows.todo.test.tsx` | Import, package, walkthrough, graph, review flows (mocked API) |

Tests use `backend/test/helpers/testHarness.ts` to stub JWT verification and Postgres `query()` — no Docker required.

---

## Frontend Tests (Layer 1–2 — jsdom, mocked API/auth)

**Framework:** Vitest + React Testing Library + jsdom

Frontend unit tests render components in jsdom. Supabase and graph data are **mocked** — no Docker, no running API. Feature-flow tests in `frontend-flows.todo.test.tsx` exercise mocked API chains for import, onboarding, walkthrough, graph, and review flows.

### 1. App Routing Tests (`src/App.test.tsx`)

Tests that the top-level React Router configuration correctly enforces authentication.

| Test | What It Verifies |
|------|-----------------|
| Redirects unauthenticated users to the intro page | Visiting `/` without a session shows the landing page |
| Shows login page at /login | `/login` route renders the login form |
| Shows signup page at /signup | `/signup` route renders the signup form |
| Redirects /dashboard to login when unauthenticated | Protected routes bounce to `/login` |

**Passing: 4**

### 2. Login Page Tests (`src/pages/LoginPage.test.tsx`)

Tests that the login page renders all required UI elements.

| Test | What It Verifies |
|------|-----------------|
| Renders email and password fields | Both labeled inputs are present |
| Renders sign in button | The "Sign In" submit button exists |
| Renders GitHub OAuth option | The "Sign in with GitHub" button exists |
| Has a link to the signup page | A "Sign up" link points to `/signup` |

**Passing: 4**

### 3. Signup Page Tests (`src/pages/SignupPage.test.tsx`)

Tests that the signup page renders all required UI elements.

| Test | What It Verifies |
|------|-----------------|
| Renders email and password fields | Both labeled inputs are present |
| Renders create account button | The "Create Account" submit button exists |
| Renders GitHub OAuth option | The "Sign up with GitHub" button exists |
| Has a link to the login page | A "Sign in" link points to `/login` |

**Passing: 4**

### 4. Graph Page Tests (`src/pages/GraphPage.test.tsx`)

Tests the dependency graph visualizer with mock graph data (4 nodes, 3 edges).

| Test | What It Verifies |
|------|-----------------|
| Renders all module nodes | All 4 mock nodes (index, strings, logger, userService) appear; "4 / 4 modules" count shown |
| Filters nodes by search | Typing "logger" reduces display to "1 / 4 modules" and hides other nodes |
| Opens info panel on node click | Clicking "userService" shows a Functions panel with UserService details |

**Passing: 3**

### 5. Frontend Feature Flow Tests (`src/test/frontend-flows.todo.test.tsx`)

Mocked API integration tests for core user flows (Layer 2 — no Docker).

| Test | What It Verifies |
|------|-----------------|
| Repository Import populates repos and branches after GitHub connection | Chained `/github/installations` → `/github/repos` → `/github/.../branches` responses |
| Package Overview switches role-specific package content | Backend vs frontend onboarding payloads differ by `role` query |
| Walkthrough Viewer advances through ordered code stops | Workflow walkthrough steps returned in `stepOrder` sequence |
| Graph Viewer switches between architecture, dependency, and workflow tabs | GraphPage renders nodes from mocked dependency graph |
| Documentation Health clears stale sections after review | Stale section → PATCH review → approved status |

**Passing: 5**

---

## Shared Test Fixture

The **`simple`** fixture is the backbone of Layer 1 backend tests. Pipeline, ranking, and every engine `__tests__` file point at the same directory:

```
backend/src/worker/fixtures/simple/
├── index.ts              # Main entry — imports AuthService and signToken
├── services/
│   └── authService.ts    # AuthService class with login/logout/verify
└── utils/
    └── jwtUtil.ts         # JWT helpers: signToken, verifyToken, TokenPayload, TokenStatus
```

This fixture is parsed by the **same** `createProgram` / `extractFileAnalysis` / `buildDependencyGraph` code paths the worker runs on real repos. Adding files here extends unit coverage without Docker.

### In-process test env (`backend/test/setup.ts`)

When Supertest loads the Express app, this file provides safe defaults so modules initialize without real credentials:

- `DATABASE_URL` → placeholder Postgres URL (guard tests never connect)
- `SUPABASE_URL` / service role key → placeholders
- `TOKEN_ENCRYPTION_KEY` → random 32-byte hex per run
- `GITHUB_APP_PRIVATE_KEY_PATH` → `/dev/null`

Real Supabase, Redis, and GitHub are only required for **Layer 3** (Docker stack) and **manual** testing.

---

## ESLint

**Config:** `eslint.config.mjs` (flat config)

```sh
npm run lint    # 0 errors
```

The ESLint configuration includes overrides for test and fixture files:
- **Test files** (`*.test.ts`, `__tests__/`, `test/`): `no-unused-expressions` is disabled to allow Chai's property-access assertion style (`.to.exist`, `.to.be.true`)
- **Fixture files** (`**/fixtures/**`): Both `no-unused-expressions` and `no-unused-vars` are disabled since fixture code is parsed by the AST engine for testing, not executed directly

---

## Summary

| Category | Passing | Pending/Todo | Total |
|----------|---------|-------------|-------|
| Backend API routes (guards + integration) | 43 | 0 | 43 |
| Backend pipeline | 7 | 0 | 7 |
| Backend ranking | 5 | 0 | 5 |
| Backend encryption | 11 | 0 | 11 |
| Backend AI + re-analysis | 10 | 0 | 10 |
| Backend worker queue | 5 | 0 | 5 |
| Backend engine (symbol, graph, repo, entry, side-effect, workflow) | 56 | 0 | 56 |
| Frontend routing + pages | 15 | 0 | 15 |
| Frontend feature flows | 5 | 0 | 5 |
| **Total** | **157** | **0** | **157** |

**Test runner output:** `npm run test -w backend` → 137 passing. `npm run test -w frontend` → 20 passing. `npm run lint` → 0 errors.
