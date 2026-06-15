# Backend API Documentation

## Architecture

The backend is an **Express 5** application written in TypeScript. It runs on Node.js and serves a REST API under the `/api` prefix.

**Key libraries:**

- `express` v5 — HTTP server and routing
- `pg` — PostgreSQL client (direct queries via connection pool, no ORM)
- `jose` — JWKS-based JWT verification for Supabase tokens
- `@supabase/supabase-js` — Admin operations (user creation, sign-out)
- `cors`, `express.json()` — standard middleware

**Entry point:** `backend/src/api/server.ts`

DNS is configured with `dns.setDefaultResultOrder("ipv4first")` to work around IPv6 issues in Docker environments.

---

## Authentication

### JWT Verification (`backend/src/lib/verifySupabaseJwt.ts`)

Supabase access tokens are verified using the **JWKS** endpoint at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. The `jose` library fetches and caches the signing keys automatically.

### `requireAuth` Middleware (`backend/src/api/middleware/auth.ts`)

- Extracts the `Bearer` token from the `Authorization` header
- Verifies the JWT via JWKS
- Attaches `req.user` with `{ id, email }` from the token payload
- Returns `401` if the token is missing, invalid, or expired

All routes except `/api/health` and `/api/auth/signup|login` require authentication.

---

## Authorization

### `requireProjectAccess` Middleware (`backend/src/api/middleware/project-access.ts`)

A factory function that returns middleware enforcing project membership and optional tier restrictions.

```typescript
requireProjectAccess()                    // any member
requireProjectAccess("owner", "admin")    // owner or admin only
requireProjectAccess("owner")             // owner only
```

- Queries `project_members` to verify the user belongs to the project
- Checks `permission_tier` against allowed tiers (if specified)
- Attaches `req.projectMember` with `{ project_id, user_id, permission_tier, developer_role }`
- Returns `403` if the user is not a member or lacks the required tier

**Permission tiers** (highest to lowest): `owner` > `admin` > `developer`

---

## API Endpoints

All endpoints are prefixed with `/api`.

### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/signup` | No | Create a new user account |
| `POST` | `/auth/login` | No | Sign in and receive access token |
| `POST` | `/auth/logout` | Yes | Invalidate the current session |
| `GET` | `/auth/me` | Yes | Get current user profile with GitHub connection status |
| `POST` | `/auth/github/save-token` | Yes | Store encrypted GitHub OAuth token |

#### `POST /auth/signup`

**Request:** `{ email: string, password: string }`
**Response:** `201 { user: { id, email } }`
**Errors:** `400` missing fields, `409` email already taken, `422` validation error

#### `POST /auth/login`

**Request:** `{ email: string, password: string }`
**Response:** `200 { user: { id, email }, session: { access_token } }`
**Errors:** `400` missing fields, `401` invalid credentials

#### `GET /auth/me`

**Response:** `200 { user: { id, email, created_at, github_connected, github_username } }`

#### `POST /auth/github/save-token`

**Request:** `{ github_user_id: number, github_username: string, access_token: string, scopes: string[] }`
**Response:** `200 { success: true }`

The access token is encrypted with AES-256-GCM before storage.

---

### GitHub (`/api/github`)

All GitHub routes require authentication.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/github/app` | Get GitHub App info (name, slug, install URL) |
| `GET` | `/github/installations` | List all installations of the GitHub App |
| `GET` | `/github/repos` | List repos for a specific installation |
| `GET` | `/github/repos/:owner/:repo/branches` | List branches for a repo |

#### `GET /github/app`

**Response:** `200 { name, slug, install_url }`

Uses the GitHub App's own JWT (signed with the private key) to call `GET /app`.

#### `GET /github/installations`

**Response:** `200 { installations: [{ id, account: { login } }] }`

Uses the GitHub App JWT to call `GET /app/installations`.

#### `GET /github/repos?installation_id=<id>`

**Response:** `200 { repos: [{ id, name, full_name, owner, private, default_branch }] }`

Obtains an installation token, then lists repos accessible to that installation.

#### `GET /github/repos/:owner/:repo/branches?installation_id=<id>`

**Response:** `200 { branches: [{ name, commit: { sha } }] }`

---

### Projects (`/api/projects`)

All project routes require authentication.

| Method | Path | Auth Tier | Description |
|--------|------|-----------|-------------|
| `GET` | `/projects` | Any member | List all projects the user belongs to |
| `POST` | `/projects` | Any user | Create a new project |
| `GET` | `/projects/:id` | Any member | Get project details with settings |
| `PUT` | `/projects/:id/settings` | Owner/Admin | Update project settings |
| `DELETE` | `/projects/:id` | Owner | Delete a project |
| `POST` | `/projects/:id/analyze` | Owner/Admin | Trigger analysis |

#### `GET /projects`

**Response:** `200 { projects: [{ id, repo_owner, repo_name, branch, status, permission_tier, developer_role, stale_count, ... }] }`

Joins `project_members` to include the caller's tier/role and a lateral subquery for stale flag count.

#### `POST /projects`

**Request:** `{ repo_owner: string, repo_name: string, branch: string, default_developer_role?: string }`
**Response:** `201 { project: { ... } }`

Creates the project, project settings, and adds the creator as `owner` — all in a single transaction.

#### `GET /projects/:id`

**Response:** `200 { project: { ..., settings: { ... }, permission_tier, developer_role } }`

#### `PUT /projects/:id/settings`

**Request (all optional):** `{ ignored_paths?: string[], default_developer_role?: string, file_limit?: number, loc_limit?: number }`
**Response:** `200 { settings: { ... } }`

Only updates the fields that are provided.

#### `DELETE /projects/:id`

**Response:** `200 { success: true }`

Cascading deletes remove members, invitations, snapshots, and analysis jobs.

#### `POST /projects/:id/analyze`

**Response:** `202 { analysis: { id, status, mode, branch } }`

Sets project status to `analyzing` and inserts an analysis job into `analysis_jobs`.

---

### Invitations (`/api/invitations`)

All invitation routes require authentication.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/invitations` | List pending invitations for the current user |
| `GET` | `/invitations/:invitationId` | Get a specific invitation |
| `POST` | `/invitations/:invitationId/accept` | Accept an invitation and join the project |

#### `GET /invitations`

**Response:** `200 { invitations: [{ id, project_id, repo_owner, repo_name, branch, permission_tier, developer_role, invited_by_email, status }] }`

Filters by the current user's email (case-insensitive) and `status = 'pending'`.

#### `POST /invitations/:invitationId/accept`

**Request:** `{ developer_role?: string }`
**Response:** `200 { project: { ... }, member: { ... } }`

Runs in a transaction: updates invitation status, inserts into `project_members`.

---

### Members (`/api/projects/:id/members`)

All member routes require authentication and project membership.

| Method | Path | Auth Tier | Description |
|--------|------|-----------|-------------|
| `GET` | `/projects/:id/members` | Any member | List project members |
| `GET` | `/projects/:id/members/invitations` | Any member | List pending invitations for the project |
| `POST` | `/projects/:id/members/invitations` | Owner/Admin | Invite a user by email |
| `PATCH` | `/projects/:id/members/invitations/:invitationId` | Owner/Admin | Revoke a pending invitation |
| `PATCH` | `/projects/:id/members/members/:userId` | Owner/Admin | Update a member's tier or role |
| `DELETE` | `/projects/:id/members/members/:userId` | Owner/Admin | Remove a member (cannot remove owner) |

#### `POST /projects/:id/members/invitations`

**Request:** `{ email: string, permission_tier: string, developer_role?: string }`
**Response:** `201 { invitation: { ... } }`
**Errors:** `409` if a pending invitation already exists for that email.

#### `PATCH /projects/:id/members/members/:userId`

**Request (all optional):** `{ permission_tier?: string, developer_role?: string }`
**Response:** `200 { member: { ... } }`

Admins can only modify members with `developer` tier. Owners can modify anyone.

---

## Database Access

The backend connects to **Supabase PostgreSQL** via the `pg` Pool, using the `DATABASE_URL` environment variable (connection pooler endpoint recommended for Docker).

**Module:** `backend/src/lib/db.ts`

```typescript
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export { pool, query };
```

All queries use parameterized statements (`$1`, `$2`, etc.) to prevent SQL injection. Transactions use `pool.connect()` with explicit `BEGIN`/`COMMIT`/`ROLLBACK`.

---

## GitHub App Integration

**Module:** `backend/src/lib/github.ts`

The app authenticates to the GitHub API in two ways:

1. **App-level JWT** — for endpoints like `GET /app`, `GET /app/installations`. Signed with the private key (`github-app.pem`) using RS256.
2. **Installation token** — for repo-scoped operations. Obtained by calling `POST /app/installations/:id/access_tokens` with the App JWT.

**Environment variables:**
- `GITHUB_APP_ID` — the numeric App ID
- `GITHUB_APP_PRIVATE_KEY_PATH` — path to the PEM file (e.g., `./github-app.pem`)

---

## Encryption

**Module:** `backend/src/lib/encryption.ts`

GitHub OAuth tokens are encrypted at rest using **AES-256-GCM**.

- **Key:** 32-byte hex string from `TOKEN_ENCRYPTION_KEY` env var
- **Format:** `iv:authTag:ciphertext` (all hex-encoded)
- **Functions:** `encrypt(plaintext)` and `decrypt(encrypted)`

---

## Error Handling

All endpoints return errors in the format:

```json
{ "error": "Human-readable error message" }
```

**Standard status codes:**
- `400` — Bad request (missing required fields)
- `401` — Authentication required or token invalid
- `403` — Insufficient permissions
- `404` — Resource not found
- `409` — Conflict (duplicate resource)
- `422` — Validation error
- `500` — Internal server error

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase connection pooler) |
| `SUPABASE_URL` | Supabase project URL (e.g., `https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (admin operations) |
| `GITHUB_APP_ID` | GitHub App numeric ID |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Path to GitHub App PEM private key |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `TOKEN_ENCRYPTION_KEY` | 64-char hex string for AES-256-GCM encryption |
| `PORT` | Server port (default: 3001) |
