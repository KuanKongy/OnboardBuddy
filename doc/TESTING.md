# Testing Documentation

Everything about OnboardBuddy's automated tests: how to run them, how they are layered, and what every suite covers. For the TA-facing test plan (run commands + manual checklists), see [TESTPLAN.md](./TESTPLAN.md).

## How to run

One command, from the repo root:

```bash
docker compose -f docker-compose.test.yml run --rm test   # needs only Docker
# — or, with Node 22 installed —
npm install && npm test
```

Both run the exact same suites. **Expected: backend `321 passing`, frontend `25 passed`.** Non-zero exit code on any failure. No `.env`, no cloud services, no running stack — the suites are fully self-contained (see "Test layers" below).

Supporting commands (local, optional):

```bash
npm run lint          # ESLint, whole monorepo — 0 errors
npm run build         # tsc + production Vite build — clean
npx playwright test e2e/phase10-ui.spec.ts   # from frontend/ — 21 UI regression tests
npm run test:stack    # smoke-test a running `docker compose up` stack
```

---

## Test layers

Unit and pipeline tests call the **same production functions** the worker uses, against a shared fixture repository, with the database layer stubbed — they are not a separate test-only implementation.

| Layer | What runs | Docker? | External services? |
|-------|-----------|---------|-------------------|
| **1 — Engine & library unit** | Production engine/AI/semantic functions in-process against `backend/src/worker/fixtures/simple/` | No | No |
| **2 — API in-process** | Real Express app via Supertest; JWT + Postgres `query()` stubbed by `backend/test/helpers/testHarness.ts` | No | No |
| **3 — UI regression** | Every project tab rendered in Playwright (dark + light) against mocked API routes | No | No |
| **4 — Stack & manual** | `docker compose up` + browser checklists in TESTPLAN.md §3 | Yes | Supabase, Redis, GitHub, OpenRouter |

Key pieces the suites share:

- `backend/src/worker/fixtures/simple/` — a 3-file TypeScript mini-repo (entry `index.ts`, `services/authService.ts`, `utils/jwtUtil.ts`) parsed by the same `createProgram`/AST code paths the worker runs on real repos.
- `backend/test/setup.ts` — placeholder env (DB URL, Supabase keys, encryption key) so the Express app boots without credentials.
- `backend/test/helpers/testHarness.ts` — stubs JWT verification and Postgres `query()` for authenticated-route tests.
- The **mock LLM provider** — LLM-infrastructure tests run the real orchestration code (retries, budgets, caching, privacy) against a scripted provider; no OpenRouter calls.

---

## Backend suite — 302 tests (Mocha + Chai + Supertest, `npm test -w backend`)

### API routes (`backend/test/api/`)

| File | Covers |
|------|--------|
| `auth.test.ts` | Signup/login validation, logout + `/me` auth guards |
| `github.test.ts` | GitHub App/installations/repos/branches route guards |
| `projects.test.ts` | Project CRUD guards, analyze route (commit SHA validation, incremental mode), settings |
| `members.test.ts`, `invitations.test.ts` | Team management + invitation guards |
| `onboarding.test.ts` | Package/section routes, export, receipts, review, on-demand generation guards |
| `workflows.test.ts`, `graph.test.ts` | Workflow + graph route guards |
| `ask.test.ts` | Q&A endpoint: validation and error taxonomy (404 no snapshot / 403 AI disabled / 400 bad input), internal chat gating |
| `llmKeys.test.ts` | BYO LLM key management — the key value is never returned |
| `health.test.ts` | Public health check |
| `routes.todo.test.ts` | Authenticated-path integration (mocked JWT + DB): auth, GitHub, projects, export/review, team permissions |

### Deterministic engine (`backend/src/worker/engine/__tests__/`)

| File | Covers |
|------|--------|
| `repoIngester.test.ts` | Repo ingestion, language guardrails, ignored paths |
| `symbolExtractor.test.ts` | AST symbol extraction: classes/functions/interfaces/enums/types, signatures, hashes, JSDoc, imports/exports |
| `graphBuilder.test.ts` | Dependency graph nodes/edges, `.js`→`.ts` import resolution, entry points |
| `entrypointDetector.test.ts`, `sideEffectDetector.test.ts` | Entrypoint kinds; side-effect detection (DB writes, HTTP calls, …) |
| `workflowExtractor.test.ts` | Call-graph workflow extraction: steps, ordering, triggers, importance |
| `phase2.test.ts` | Evidence graph building: nodes, edges, dedup, stable keys |
| `phase3.test.ts` | Candidate ranking, role weights, depth gating, architecture clustering, preflight estimates |

### LLM infrastructure (`backend/src/worker/ai/__tests__/phase4.test.ts`)

Structured-output fallback + validation retry, model tiers and failure behaviors (retry/degrade/pause/fail), budget enforcement (limits, kill switch, counters), key resolution, privacy modes (snippet stripping in `facts_only_ai`), generation-run auditing, input-hash caching, checkpointing — all against the mock provider.

### Semantic layer (`backend/src/worker/semantic/__tests__/`)

`phase5.test.ts`: content-addressed record cache (depth layering, supersede rules), batching, facts-only records. `phase6.test.ts`: synthesis hierarchy, capability extraction, critique verdicts, reranker features, embeddings view rendering + selection.

### Generation (`backend/src/worker/generation/__tests__/phase7.test.ts`)

Citation validator (all 8 trust rules: unknown receipts, stale nodes, file/claim matching, uncited downgrades, docs-only caps), deterministic Mermaid diagram builders, section specs.

### Incremental analysis (`backend/src/worker/__tests__/phase9.test.ts`)

Upward invalidation propagation — a body change climbs symbol → file → module → service → system; a whitespace-only change invalidates nothing; membership/workflow-fingerprint changes; removed files/symbols; stale flags.

### Cross-cutting (`backend/test/`)

| File | Covers |
|------|--------|
| `lib/encryption.test.ts` | Token encryption round-trip, random IV, tamper/format/key-length failures |
| `analysis/pipeline.todo.test.ts` | Whole-pipeline runs on the fixture: inventory, privacy filtering, AST extraction, workflow discovery, evidence/receipt shape |
| `ranking/ranking.todo.test.ts` | Composite 5-signal scoring, role re-ranking, ranking reasons, entrypoint signal |
| `ai/generation.todo.test.ts` | Evidence context assembly, citation validation, AI-disabled guard, draft status |
| `incremental-reanalysis/reanalysis.todo.test.ts` | Stale-hash detection, stale flags, unchanged sections |
| `worker/jobs.todo.test.ts` | Redis URL parsing, job payloads, retry policy, step logs |

---

## Frontend suite — 21 tests (Vitest + Testing Library + jsdom, `npm test -w frontend`)

| File | Covers |
|------|--------|
| `src/App.test.tsx` | Router auth enforcement: intro page, login/signup routes, protected-route redirect |
| `src/pages/LoginPage.test.tsx`, `SignupPage.test.tsx` | Form fields, submit buttons, GitHub OAuth buttons, cross-links |
| `src/pages/GraphPage.test.tsx` | Dependency graph rendering, search filtering, symbol-doc panel, classes view |
| `src/test/frontend-flows.todo.test.tsx` | Mocked-API feature flows: repository import chain, role-specific packages, walkthrough steps, graph tabs, review status |

Supabase and all API calls are mocked — no running backend needed.

---

## UI regression suite — 21 tests (Playwright, optional)

`frontend/e2e/phase10-ui.spec.ts` renders **every project tab in dark and light themes** against mocked API routes and a fake Supabase session, exercises the first-timer tour and the symbol-doc interaction, verifies the analysis progress bar (stage label, monotonic %, live activity), and captures full-page screenshots.

```bash
cd frontend
npx playwright install chromium               # once
npx playwright test e2e/phase10-ui.spec.ts    # starts its own dev server
```

`frontend/e2e/docker-stack.spec.ts` smoke-tests a running Docker stack (frontend serves, API health OK): `npm run test:stack` from the repo root with the stack up.

---

## ESLint

`eslint.config.mjs` (flat config), `npm run lint` → 0 errors. Overrides: test files disable `no-unused-expressions` (Chai's `.to.exist` style); fixture files also disable `no-unused-vars` (fixture code is parsed by the AST engine, not executed).
