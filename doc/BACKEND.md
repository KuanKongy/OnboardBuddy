# Backend API Documentation

This document describes the **HTTP REST API** exposed by the OnboardBuddy backend. It covers every route the frontend (or any API client) can call: authentication, GitHub integration, projects, team management, analysis results, and onboarding content.

**URL prefix:** All routes are mounted under `/api`. A path written as `/auth/login` in code is called as **`/api/auth/login`** — e.g. `http://localhost:3000/api/auth/login`. Paths in the tables below omit the prefix for brevity; prepend `/api` for the full URL.

**Related docs:** Background jobs (analysis, AI summary) are part of the backend but have no HTTP surface — see [Pipeline.md](./Pipeline.md).

---

## Architecture

The backend is an **Express 5** application written in TypeScript. It runs on Node.js and serves a REST API under the `/api` prefix.

**Key libraries:**

- `express` v5 — HTTP server and routing
- `pg` — PostgreSQL client (connection pool, no ORM)
- `jose` — JWKS-based JWT verification for Supabase tokens
- `@supabase/supabase-js` — Admin operations (user creation, sign-out)
- `cors`, `express.json()` — standard middleware

**HTTP entry point:** `backend/src/api/server.ts` — starts Express, mounts `/api`, listens on `PORT` (default 3000).

**Worker process:** `backend/src/worker/index.ts` — same codebase, separate Node process. Consumes BullMQ jobs from Redis (repo analysis, onboarding generation). Triggered by API routes such as `POST /projects/:id/analyze`; progress read via `GET /projects/:id/analysis-status`. Job types, pipeline stages, and engine modules are documented in [Pipeline.md](./Pipeline.md).

DNS uses `ipv4first` to avoid IPv6 issues in Docker.

---

## Authentication

Two separate systems: **Supabase login** (who you are in OnboardBuddy) and **GitHub App authorization** (which GitHub account/repos you can import). Logging in does not connect GitHub.

### Token types

Three tokens in the system. Confusing them was the root cause of Bug #18 and #13.

| Token | Prefix | Lifetime | Stored where | Purpose |
|-------|--------|----------|--------------|---------|
| Supabase JWT | `eyJ…` | ~1 hour | Frontend only (`session.access_token`) | Identity — authenticates every API call via `Authorization: Bearer` |
| GitHub App user token | `ghu_` + `ghr_` | 8 hours (access) / 6 months (refresh) | `github_connections` (encrypted) | Ownership — asks GitHub which installations this user owns |
| GitHub installation token | — | 1 hour | Not stored (ephemeral) | Repo access — lists repos/branches and downloads zipballs |

**Supabase JWT** is an identity token — it says who the user is in OnboardBuddy. It never touches GitHub. The Supabase client SDK refreshes it automatically (~1 hour cycle); our backend only verifies the JWT that arrives in the `Authorization` header. When a user signs in with GitHub via Supabase, the result is still a Supabase JWT — GitHub is just the identity provider.

**GitHub App user token** is a pair: access (`ghu_`, 8h) + refresh (`ghr_`, 6mo), returned together when the user authorizes the GitHub App. The access token calls `GET /user/installations` — the only secure way to ask GitHub which installations belong to this user. When the access token expires, the server uses the refresh token to silently get a new pair from GitHub (no user interaction). GitHub invalidates the old refresh token on use (one-time use). If a concurrent request races and the refresh token is already consumed, the code re-reads the DB to pick up the token saved by the winning request. After 6 months without use, the refresh token expires and the user must re-authorize (`403` with `code: "github_reconnect_required"`). Both tokens are stored encrypted in one `github_connections` row.

**GitHub installation token** is ephemeral — generated from the App's private key + installation ID, scoped to repos that installation can access. A new one is minted per request (repos, branches, zipball download). Never stored.

**Encryption:** Stored tokens (`ghu_`, `ghr_`) use AES-256-GCM with a random 12-byte IV per call. Same plaintext → different ciphertext every time. Format: `iv:authTag:ciphertext`. Key: `TOKEN_ENCRYPTION_KEY` env var (32 bytes / 64 hex chars).

### JWT verification (`backend/src/lib/verifySupabaseJwt.ts`)

Supabase access tokens verified via JWKS at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. Keys fetched and cached by `jose`.

### `requireAuth` (`backend/src/api/middleware/auth.ts`)

Extracts `Bearer` token from `Authorization`, verifies JWT, sets `req.user = { id, email }`. Returns `401` if missing, invalid, or expired.

**Public routes (no Bearer token):** `GET /api/health`, `POST /api/auth/login` (rate limited)

The frontend stores `session.access_token` from login and sends it on every other API call. That token is a Supabase JWT — not a GitHub token.

### GitHub App authorization (repo import only)

Required before listing installations/repos or creating a project. Flow:

| Step | Route | Saved to DB |
|------|-------|-------------|
| Authorize GitHub App | `GET /github/oauth/start` → GitHub → `POST /github/oauth/complete` | Encrypted GitHub App user token → `github_connections` |
| Install App on a GitHub org/user | `POST /github/installations/link` | `github_installations` row |
| Import repo | `POST /projects` | `projects.github_installation_id` (ownership checked first) |

Email/password users link GitHub on first App auth; re-auth must use the same GitHub account. Users who signed in via GitHub must authorize the same `@username`. OAuth URL includes `prompt=select_account` to force explicit GitHub account selection. Server auto-refreshes GitHub tokens; expired refresh returns `403` with `code: "github_reconnect_required"`. Logout does not delete the GitHub App connection — it persists so the user does not re-authorize on next login.

---

## Authorization

### `requireProjectAccess` (`backend/src/api/middleware/project-access.ts`)

Factory for project-scoped routes:

- `requireProjectAccess()` — any member
- `requireProjectAccess("owner", "admin")` — owner or admin
- `requireProjectAccess("owner")` — owner only

Queries `project_members`, checks tier, attaches `req.projectMember`. Returns `403` if not a member or tier too low; DB errors return `500`.

**Tiers:** `owner` > `admin` > `developer`

### GitHub installation access (`backend/src/lib/github-connection.ts`)

`userCanAccessInstallation()` and `getInstallationTokenForUser()` run before listing repos or minting installation tokens — ensures users only access their own GitHub installations.

---

## API Endpoints

Unless noted, routes require header `Authorization: Bearer <access_token>` (the Supabase JWT from `POST /auth/login`).

**Request/response notation:**

| Part | Meaning |
|------|---------|
| Input | JSON body, query string, or `no body` for GET/DELETE with no payload |
| → | HTTP status code and JSON response shape (unless noted, e.g. Markdown download) |
| Errors | Status code — when it occurs |

Example: `Input: { email, password }` → `200 { user, session }` means POST that JSON and expect status 200 with that response.

---

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Liveness check for load balancers and dev |

#### GET /health

Returns whether the API process is running. No authentication.

Input: no body → 200 `{ status: "ok" }`  
Errors: none expected

---

### Auth (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | No | Sign in; returns JWT access token (rate limited) |
| POST | `/auth/logout` | Yes | Invalidate current session |
| GET | `/auth/me` | Yes | Profile + whether GitHub App is connected |
| DELETE | `/auth/account` | Yes | Permanently delete the account and its data |

**There is no `POST /auth/signup`.** It was removed in M5 (bug #66): an
unauthenticated caller could create an *email-confirmed* account for any
address, bypassing the confirmation email that real sign-up sends — and since
invitations are matched on email address, that let an attacker pre-register a
victim's address and accept invitations meant for them. Sign-up happens in the
browser against Supabase (`supabase.auth.signUp`), which is the only path the
product ever used.

#### POST /auth/login

Authenticates with email and password. Returns a Supabase JWT; the frontend stores `session.access_token` and sends it as `Authorization: Bearer …` on all protected routes.

Throttled in memory (`backend/src/api/middleware/authRateLimit.ts`): 10 attempts
per 15 minutes per address+email, and 60 per 15 minutes per address. Both windows
answer 429 with `Retry-After`.

Input: `{ email, password }` → 200 `{ user: { id, email }, session: { access_token } }`  
Errors: 400 — email or password missing · 401 — wrong email or password · 429 — too many attempts · 500 — server failure

#### POST /auth/logout

Invalidates the Supabase session tied to the current Bearer token. GitHub App connections persist — the user does not need to re-authorize the App on next login.

Input: no body → 200 `{ success: true }`  
Errors: 401 — not authenticated · 422 — Supabase could not sign out the token · 500 — server failure

#### GET /auth/me

Returns the authenticated user's profile and GitHub App connection status from `github_connections` (not the same as signing in with GitHub via Supabase).

Input: no body → 200 `{ user: { id, email, created_at, github_connected, github_username } }`  
Errors: 401 — not authenticated · 404 — user row missing in DB · 500 — server failure

---

### GitHub (`/github`)

All routes require auth. Connects the user's GitHub account for repo import — separate from Supabase login.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/github/app` | App name/slug + install URL with signed state |
| GET | `/github/oauth/start` | Start GitHub App user OAuth |
| POST | `/github/oauth/complete` | Exchange OAuth code; save encrypted token |
| POST | `/github/installations/link` | Record installation after App install |
| GET | `/github/installations` | Installations for connected GitHub account only |
| GET | `/github/repos` | Repos accessible to an installation |
| GET | `/github/repos/:owner/:repo/branches` | Branches for a repo |
| DELETE | `/github/connection` | Disconnect GitHub App (clear tokens) |

#### GET /github/app

Fetches GitHub App metadata using an App JWT (`github-app.pem`). Returns an install URL with signed `state` for linking after the user installs the App.

Input: no body → 200 `{ name, slug, install_url }`  
Errors: 401 — not authenticated · 500 — GitHub App config error (e.g. missing PEM)

#### GET /github/oauth/start

Builds the GitHub App OAuth authorize URL with `prompt=select_account` so the user must explicitly pick a GitHub account. Frontend redirects the browser there so the user grants repo access.

Input: no body → 200 `{ authorization_url }`  
Errors: 401 — not authenticated · 500 — failed to build OAuth URL

#### POST /github/oauth/complete

Completes OAuth after redirect. Verifies signed `state`, exchanges `code` for a GitHub App user token, checks the GitHub account matches the Supabase user, encrypts and stores the token in `github_connections`.

Input: `{ code, state }` → 200 `{ github_user: { id, login } }`  
Errors: 400 — missing/invalid code or state, identity mismatch, or account already linked · 500 — server failure

#### POST /github/installations/link

Called after the user installs the App on GitHub. Associates an `installation_id` with the user when they own that installation.

Input: `{ installation_id, state }` → 200 `{ installation: { id, account } }`  
Errors: 400 — missing installation_id or state · 403 — user cannot access this installation · 500 — server failure

#### GET /github/installations

Lists GitHub App installations visible to the connected GitHub account using the stored user token. Does not return other users' installations.

Input: no body → 200 `{ github_connected, github_username, installations: [{ id, account: { login } }] }`  
Errors: 401 — not authenticated · 403 — GitHub token expired; reconnect required · 500 — server failure

#### GET /github/repos

Lists repositories an installation can access. Mints an installation token only after verifying the user owns `installation_id`.

Input: query `?installation_id=<id>` → 200 `{ repos: [{ id, name, full_name, owner, private, default_branch }] }`  
Errors: 400 — installation_id missing or not a number · 403 — installation not owned by user · 500 — server failure

#### GET /github/repos/:owner/:repo/branches

Lists branch names and tip commits for a repo under the given installation.

Input: query `?installation_id=<id>` → 200 `{ branches: [{ name, commit: { sha } }] }`  
Errors: 400 — installation_id missing or invalid · 403 — installation not owned · 500 — server failure

#### DELETE /github/connection

Disconnects the user's GitHub App link. Deletes their `github_connections` and `github_installations` rows. After this, `/github/installations` returns an empty list and the user must re-authorize the GitHub App to import repos.

Input: no body → 200 `{ success: true }`  
Errors: 401 — not authenticated · 500 — server failure

---

### Projects (`/projects`)

| Method | Path | Tier | Description |
|--------|------|------|-------------|
| GET | `/projects` | member | List projects the user belongs to |
| POST | `/projects` | any | Create project from an imported repo |
| GET | `/projects/:id` | member | Project details + settings |
| PUT | `/projects/:id/settings` | owner/admin | Update analysis/onboarding settings |
| DELETE | `/projects/:id` | owner | Delete project and related data (CASCADE) |
| POST | `/projects/:id/analyze` | owner/admin | Queue static analysis worker job (concurrent runs allowed; 409 only for an identical scope+commit) |
| GET | `/projects/:id/analysis-status` | member | Recent jobs + latest snapshot stats |
| GET | `/projects/:id/runs` | member | Run history: config, duration, per-job LLM cost, generated-vs-cached sections (`?limit=&before=`) |
| PUT | `/projects/:id/default-package` | member | Set the CALLER's default package (`{ package_id: uuid \| null }`, per member) |
| GET | `/projects/:id/summary` | member | Latest onboarding package summary |
| POST | `/projects/:id/summarize` | owner/admin | Queue AI onboarding generation job |

> **Package selection:** every feature read (`/onboarding`, `/graph/*`, `/capabilities`,
> `/workflows`, `/tutorials`, `/onboarding/{staleness,validate,export}`, `/ask`) accepts an
> optional `?package_id=` and resolves what to serve as **explicit package → caller's member
> default → latest complete snapshot** (`api/services/packageResolver.ts`). Packages are
> identified by (project, scope, role, commit, **branch**); snapshots stay content-addressed
> per (scope, commit), so the same commit on two branches shares one analysis.

#### GET /projects

Returns all projects where the caller is a member, including their tier, developer role, and count of stale onboarding sections from the latest snapshot.

Input: no body → 200 `{ projects: [{ id, repo_owner, repo_name, branch, status, permission_tier, developer_role, stale_count, ... }] }`  
Errors: 401 — not authenticated · 500 — server failure

#### POST /projects

Creates a project for a GitHub repo/branch. Validates `github_installation_id` ownership, then inserts project, default settings, and owner membership in one transaction.

Input: `{ repo_owner, repo_name, branch, github_installation_id, default_developer_role? }` → 201 `{ project }`  
Errors: 400 — required field missing · 403 — installation not owned · 409 — project already exists for repo/branch · 500 — server failure

#### GET /projects/:id

Returns project row, settings JSON, and the caller's membership tier/role.

Input: no body → 200 `{ project: { ..., settings, permission_tier, developer_role } }`  
Errors: 401 — not authenticated · 403 — not a project member · 404 — project not found · 500 — server failure

#### PUT /projects/:id/settings

Updates only the settings fields present in the body.

Input: `{ ignored_paths?, ai_enabled?, default_developer_role?, file_limit?, loc_limit? }` → 200 `{ settings }`  
Errors: 400 — no settings fields in body · 401 — not authenticated · 403 — not owner/admin · 404 — project not found · 500 — server failure

#### DELETE /projects/:id

Deletes the project row; related members, jobs, snapshots, and packages removed via database CASCADE.

Input: no body → 200 `{ success: true }`  
Errors: 401 — not authenticated · 403 — not project owner · 500 — server failure

#### POST /projects/:id/analyze

Starts static repo analysis: sets project status to `analyzing`, inserts an `analysis_jobs` row, enqueues a BullMQ job for the worker (see [Pipeline.md](./Pipeline.md)). Runs for **different** (scope, commit) tuples execute concurrently; only an identical active run conflicts. If the resolved commit already has a complete snapshot, the worker reuses it and jumps straight to package generation (`force: true` re-analyzes).

Input: `{ scope_id?, scope_path?, branch?, commit?, depth?, role?, force? }` → 202 `{ analysis: { id, status, mode, branch } }`  
Errors: 401 — not authenticated · 403 — not owner/admin · 404 — project not found · 409 — an identical scope+commit run is already active (`active_job_id`) · 500 — server failure

#### GET /projects/:id/analysis-status

Returns the five most recent analysis/summary jobs plus stats from the latest completed snapshot (file count, symbols, workflows, commit).

Input: no body → 200 `{ jobs: [...], latestSnapshot: { file_count, symbol_count, ... } | null }`  
Errors: 401 — not authenticated · 403 — not a member · 500 — server failure

#### GET /projects/:id/summary

Returns the most recent onboarding package (any role) with aggregated section metadata — used by summary views.

Input: no body → 200 `{ summary: { package_id, role, sections, ... } }`  
Errors: 401 — not authenticated · 403 — not a member · 404 — no package generated yet · 500 — server failure

#### POST /projects/:id/summarize

Queues AI onboarding generation for the latest completed analysis snapshot. Requires `ai_enabled` in project settings.

Input: no body → 202 `{ jobId, snapshotId }`  
Errors: 401 — not authenticated · 403 — not owner/admin or AI disabled for project · 409 — no completed analysis snapshot · 500 — server failure

---

### Invitations (`/invitations`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/invitations` | Pending invites for the caller's email |
| GET | `/invitations/:invitationId` | Single invite detail |
| POST | `/invitations/:invitationId/accept` | Accept invite and join project |

#### GET /invitations

Lists pending project invitations addressed to the authenticated user's email.

Input: no body → 200 `{ invitations: [{ id, project_id, repo_owner, repo_name, branch, permission_tier, developer_role, invited_by_email, status }] }`  
Errors: 401 — not authenticated · 500 — server failure

#### GET /invitations/:invitationId

Returns one invitation if it belongs to the caller's email.

Input: no body → 200 `{ invitation }`  
Errors: 401 — not authenticated · 403 — invitation sent to a different email · 404 — invitation not found · 500 — server failure

#### POST /invitations/:invitationId/accept

Accepts a pending invitation: marks it accepted and adds the user to `project_members` with the invite's tier. `developer_role` comes from the invite or request body.

Input: `{ developer_role? }` → 200 `{ project, member }`  
Errors: 400 — developer_role required but missing on invite and body · 403 — invitation for another account · 404 — not found or expired · 409 — already accepted or already a member · 503 — database unavailable · 500 — server failure

---

### Members (`/projects/:id/members`)

| Method | Path | Tier | Description |
|--------|------|------|-------------|
| GET | `/members` | member | List project members |
| GET | `/members/invitations` | member | Pending invites for this project |
| POST | `/members/invitations` | owner/admin | Invite a user by email |
| PATCH | `/members/invitations/:invitationId` | owner/admin | Revoke a pending invite |
| PATCH | `/members/members/:userId` | owner/admin | Update member tier or role |
| DELETE | `/members/members/:userId` | owner/admin | Remove a member |

#### GET /members

Lists all members of the project with email and join date.

Input: no body → 200 `{ members: [{ project_id, user_id, permission_tier, developer_role, email, joined_at }] }`  
Errors: 401 — not authenticated · 403 — not a member · 500 — server failure

#### GET /members/invitations

Lists pending invitations created for this project.

Input: no body → 200 `{ invitations: [...] }`  
Errors: 401 — not authenticated · 403 — not a member · 500 — server failure

#### POST /members/invitations

Sends a pending invitation to join the project with the given permission tier and optional developer role.

`permission_tier` must be `admin` or `developer`. **Owner is not invitable** — a
project has one owner and it changes by transfer, never by invite (bug #66); the
accept endpoint re-checks the tier for the same reason.

Input: `{ email, permission_tier, developer_role? }` → 201 `{ invitation }`  
Errors: 400 — email or permission_tier missing, tier not admin/developer, or unknown developer_role · 401 — not authenticated · 403 — not owner/admin · 409 — pending invite already exists for email · 500 — server failure

#### PATCH /members/invitations/:invitationId

Revokes a pending invitation (sets status to `revoked`).

Input: no body → 200 `{ invitation }`  
Errors: 401 — not authenticated · 403 — not owner/admin · 404 — no pending invitation with that id · 500 — server failure

#### PATCH /members/members/:userId

Updates a member's permission tier and/or developer role. Admins may only change developers; owners cannot assign owner to someone else.

Input: `{ permission_tier?, developer_role? }` → 200 `{ member }`  
Errors: 400 — invalid tier/role or no fields to update · 401 — not authenticated · 403 — caller lacks permission for this change · 404 — member not found · 500 — server failure

#### DELETE /members/members/:userId

Removes a member from the project. Cannot remove yourself or the project owner.

Input: no body → 200 `{ success: true }`  
Errors: 401 — not authenticated · 403 — not allowed (self, owner, or admin removing non-developer) · 404 — member not found · 500 — server failure

---

### Graph (`/projects/:id/graph`)

Reads from the latest completed analysis snapshot.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/graph/dependencies` | Module dependency graph |
| GET | `/graph/nodes/:nodeId` | Detail for one graph node |

#### GET /graph/dependencies

Returns nodes and edges for the dependency graph. Auto-clusters by directory when node count exceeds 20; optional `?cluster=` for cluster drill-down.

Input: query `?cluster=<dir>` (optional) → 200 `{ projectId, snapshotId, graph: { nodes, edges, entryPoints }, totalNodes, totalEdges, ... }`  
Errors: 401 — not authenticated · 403 — not a member · 404 — no completed analysis snapshot · 500 — server failure

#### GET /graph/nodes/:nodeId

Returns metadata for a single node (file path, symbol name, line range, etc.).

Input: no body → 200 `{ node: { id, stable_key, type, name, file_path, line_start, line_end, metadata } }`  
Errors: 401 — not authenticated · 403 — not a member · 404 — node not found · 500 — server failure

---

### Workflows (`/projects/:id/workflows`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workflows` | Ranked workflows from latest snapshot |
| GET | `/workflows/:workflowId/walkthrough` | Ordered steps for one workflow |

#### GET /workflows

Lists workflows extracted during analysis, sorted by importance score. Empty array if no snapshot yet.

Input: no body → 200 `{ workflows: [...], snapshotId }`  
Errors: 401 — not authenticated · 403 — not a member · 500 — server failure

#### GET /workflows/:workflowId/walkthrough

Returns workflow metadata and ordered steps (file, symbol, explanation) for the walkthrough UI.

Input: no body → 200 `{ workflow, steps: [{ step_order, file_path, symbol_name, explanation, ... }] }`  
Errors: 401 — not authenticated · 403 — not a member · 404 — workflow not found · 500 — server failure

---

### Onboarding (`/projects/:id/onboarding`)

| Method | Path | Tier | Description |
|--------|------|------|-------------|
| GET | `/onboarding` | member | Onboarding sections for a role |
| GET | `/onboarding/sections/:sectionId/receipts` | member | Source code receipts for a section |
| GET | `/onboarding/validate` | owner/admin | Validate section citations |
| GET | `/onboarding/export` | member | Download package as Markdown |
| PATCH | `/onboarding/sections/:sectionId/review` | owner/admin | Mark section reviewed |

#### GET /onboarding

Returns the onboarding package for a developer role (query `?role=` or caller's `developer_role`). Includes sections, content blocks, and inline receipts. Returns `status: "missing"` if no package exists yet.

Input: query `?role=backend` (optional) → 200 `{ package: { id, role, status, sections: [{ id, label, blocks, reviewStatus, ... }] } }`  
Errors: 401 — not authenticated · 403 — not a member · 500 — server failure

#### GET /onboarding/sections/:sectionId/receipts

Returns source receipts (file paths, line ranges, snippets) backing a section's claims.

The section is resolved through its package and must belong to the project in
the path; a section id from another project is a 404, not another tenant's
source (bug #65). The same rule applies to `PATCH …/review` and
`GET /workflows/:workflowId/walkthrough`.

Input: no body → 200 `{ receipts: [{ file_path, symbol_name, line_start, line_end, snippet, ... }] }`  
Errors: 401 — not authenticated · 403 — not a member · 404 — no such section in this project · 500 — server failure

#### GET /onboarding/validate

Runs citation validation against graph nodes for the latest onboarding package.

Input: no body → 200 `{ validations: [...] }`  
Errors: 401 — not authenticated · 403 — not owner/admin · 404 — no onboarding package · 500 — server failure

#### GET /onboarding/export

Streams a Markdown file of all sections for the given role.

Input: query `?role=backend` (optional) → 200 Markdown attachment (`Content-Type: text/markdown`)  
Errors: 401 — not authenticated · 403 — not a member · 404 — no package for role · 500 — server failure

#### PATCH /onboarding/sections/:sectionId/review

Sets a section's review status. When all sections are approved, the package status becomes `approved`.

Input: `{ review_status: "approved" | "draft" }` → 200 `{ section }`  
Errors: 400 — review_status not approved or draft · 401 — not authenticated · 403 — not owner/admin · 404 — section not found · 500 — server failure

---

## Database Access

**Module:** `backend/src/lib/db.ts`

Connects to Supabase PostgreSQL via `pg` Pool (`DATABASE_URL`; pooler recommended for Docker). Parameterized queries prevent SQL injection. Transactions: `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK`.

---

## GitHub App Integration

**Modules:** `backend/src/lib/github.ts`, `backend/src/lib/github-connection.ts`

| Token | How minted | Used for |
|-------|------------|----------|
| App JWT | RS256 with `github-app.pem` | App metadata, mint installation tokens |
| GitHub App user token | OAuth code exchange; stored encrypted | List user's installations, ownership checks |
| Installation token | App JWT + `installation_id` | List repos/branches; worker zipball fetch (~1h TTL) |

Installation tokens only minted after `userCanAccessInstallation()` passes.

---

## Encryption

**Module:** `backend/src/lib/encryption.ts`

GitHub tokens encrypted at rest with **AES-256-GCM**.

- Key: 32-byte hex from `TOKEN_ENCRYPTION_KEY`
- Format: `iv:authTag:ciphertext` (hex)
- Functions: `encrypt()`, `decrypt()`

OAuth/install `state` HMAC uses `GITHUB_INSTALL_STATE_SECRET` (defaults to encryption key).

---

## Error Handling

Failures return `{ "error": "message" }`. GitHub token refresh failure also includes `code: "github_reconnect_required"`.

| Code | Meaning |
|------|---------|
| `400` | Bad request / missing fields |
| `401` | Auth required or token invalid |
| `403` | Forbidden / insufficient tier / GitHub access denied |
| `404` | Not found |
| `409` | Conflict (duplicate, job running, etc.) |
| `422` | Validation error |
| `500` | Internal server error |
| `503` | Service unavailable (DB pool) |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase pooler) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (admin ops) |
| `REDIS_URL` | BullMQ queue (Upstash TCP) |
| `GITHUB_APP_ID` | GitHub App numeric ID |
| `GITHUB_APP_CLIENT_ID` | GitHub App OAuth client ID |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App OAuth secret |
| `GITHUB_APP_PRIVATE_KEY_PATH` | PEM path (default `./github-app.pem`) |
| `GITHUB_CLIENT_ID` | Supabase login OAuth app (frontend) |
| `GITHUB_CLIENT_SECRET` | Supabase login OAuth secret |
| `TOKEN_ENCRYPTION_KEY` | 64-char hex AES key |
| `GITHUB_INSTALL_STATE_SECRET` | OAuth state HMAC secret |
| `FRONTEND_URL` | OAuth redirect base |
| `CORS_ORIGIN` | Allowed browser origin(s), comma-separated; required when `NODE_ENV=production` |
| `PORT` | Server port (default 3000) |
