# OnboardBuddy — DevOps Guide

## Project Architecture

OnboardBuddy is a monorepo with three top-level directories:

```
team15/
├── frontend/          React 19 + Vite + Tailwind CSS SPA
├── backend/           Express 5 + TypeScript API and BullMQ worker
├── doc/               Design docs and this guide
├── docker-compose.yml Container orchestration (production-like)
├── package.json       npm workspaces root
└── tsconfig.base.json Shared TypeScript config
```

| Component | Runtime | Local dev port | Entry point |
|---|---|---|---|
| **Frontend** | Vite dev server | `:5173` | `frontend/src/main.tsx` |
| **Backend API** | Express 5 | `:3000` | `backend/src/api/server.ts` |
| **Backend Worker** | Standalone Node process | — | `backend/src/worker/index.ts` |

**All infrastructure services are cloud-hosted.** Nothing except the frontend dev
server and backend Node processes runs locally. There is no local PostgreSQL,
no local Redis.

---

## External Services

### 1. Supabase (Auth + PostgreSQL)

**What it does:** Provides user authentication (email/password and GitHub OAuth)
and hosts the PostgreSQL database that stores all application data — users,
projects, analysis snapshots, onboarding packages, the code-evidence graph, etc.

**What data it holds:** Every table defined in `001_initial_schema.sql`, plus the
`auth.users` table managed by Supabase Auth.

| Env var | `.env` file | Description |
|---|---|---|
| `SUPABASE_URL` | `backend/.env` | Project API URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` | Secret service-role key (full DB access, never expose to browser) |
| `DATABASE_URL` | `backend/.env` | PostgreSQL connection string (Session mode) |
| `VITE_SUPABASE_URL` | `frontend/.env` | Same project URL, exposed to browser via Vite |
| `VITE_SUPABASE_ANON_KEY` | `frontend/.env` | Publishable anon key (safe to expose, RLS-gated) |

### 2. Upstash Redis

**What it does:** Backs the BullMQ job queue. The worker polls this queue for
analysis and onboarding-generation jobs.

**What data it holds:** Queued, active, and completed/failed job payloads.
Ephemeral — losing data here only means re-enqueuing pending jobs.

> **Important:** You must use the **TCP/TLS** endpoint (`rediss://`), **not** the
> HTTP/REST endpoint. BullMQ (via `ioredis`) requires a persistent TCP
> connection.

| Env var | `.env` file | Description |
|---|---|---|
| `REDIS_URL` | `backend/.env` | TCP/TLS connection string: `rediss://default:<password>@<host>.upstash.io:6379` |

### 3. GitHub OAuth App (for login)

**What it does:** Supabase delegates GitHub sign-in to this OAuth App. Users see
a GitHub consent screen and are redirected back to Supabase.

**What data it holds:** None — it's purely an OAuth bridge.

| Env var | `.env` file | Description |
|---|---|---|
| `GITHUB_CLIENT_ID` | `backend/.env` | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | `backend/.env` | OAuth App client secret |

The callback URL configured on the OAuth App must be the Supabase callback:

```
https://<ref>.supabase.co/auth/v1/callback
```

### 4. GitHub App (for repo import)

**What it does:** Grants OnboardBuddy read-only access to repository contents and
metadata. Users install this App on their GitHub account, and the backend uses
its credentials to download repo archives for analysis.

**What data it holds:** None — installation tokens are short-lived.

| Env var | `.env` file | Description |
|---|---|---|
| `GITHUB_APP_ID` | `backend/.env` | Numeric App ID |
| `GITHUB_APP_CLIENT_ID` | `backend/.env` | App client ID |
| `GITHUB_APP_CLIENT_SECRET` | `backend/.env` | App client secret |
| `GITHUB_APP_PRIVATE_KEY_PATH` | `backend/.env` | Path to `.pem` private key file (default: `./github-app.pem`) |

### 5. OpenRouter (AI)

**What it does:** Routes LLM requests to configurable providers. The default
model is `openai/gpt-4o-mini`. OpenRouter uses the OpenAI-compatible API shape,
so the `openai` npm package works directly.

**What data it holds:** Request/response logs on the OpenRouter dashboard only.

| Env var | `.env` file | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | `backend/.env` | API key from openrouter.ai |
| `OPENROUTER_BASE_URL` | `backend/.env` | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | `backend/.env` | Model identifier (e.g. `openai/gpt-4o-mini`) |

---

## Complete Secrets Reference

| Variable | `.env` file | Description | Where to find it |
|---|---|---|---|
| `NODE_ENV` | `backend/.env` | `development` or `production` | Set manually |
| `PORT` | `backend/.env` | API listen port (default `3000`) | Set manually |
| `CORS_ORIGIN` | `backend/.env` | Allowed origin (e.g. `http://localhost:5173`) | Set manually |
| `SUPABASE_URL` | `backend/.env` | Supabase project URL | Supabase → Settings → Data API |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` | Service-role secret key | Supabase → Settings → API Keys → create Secret key |
| `DATABASE_URL` | `backend/.env` | PostgreSQL connection string (Session mode) | Supabase → Settings → Database → Connection string |
| `REDIS_URL` | `backend/.env` | Upstash TCP/TLS connection string | Upstash Console → Database → Details |
| `WORKER_POLL_INTERVAL_MS` | `backend/.env` | Worker poll interval in ms (default `5000`) | Set manually |
| `GITHUB_CLIENT_ID` | `backend/.env` | GitHub OAuth App client ID | github.com → Settings → Developer settings → OAuth Apps |
| `GITHUB_CLIENT_SECRET` | `backend/.env` | GitHub OAuth App client secret | Same page as above |
| `GITHUB_APP_ID` | `backend/.env` | GitHub App numeric ID | github.com → Settings → Developer settings → GitHub Apps |
| `GITHUB_APP_CLIENT_ID` | `backend/.env` | GitHub App client ID | Same page as above |
| `GITHUB_APP_CLIENT_SECRET` | `backend/.env` | GitHub App client secret | Same page as above |
| `GITHUB_APP_PRIVATE_KEY_PATH` | `backend/.env` | Path to `.pem` file | Generate on GitHub App page → download |
| `OPENROUTER_API_KEY` | `backend/.env` | OpenRouter API key | openrouter.ai → Keys |
| `OPENROUTER_BASE_URL` | `backend/.env` | OpenRouter base URL | `https://openrouter.ai/api/v1` (static) |
| `OPENROUTER_MODEL` | `backend/.env` | LLM model identifier | openrouter.ai → Models |
| `TOKEN_ENCRYPTION_KEY` | `backend/.env` | 32-byte hex key for encrypting GitHub tokens at rest | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `VITE_API_URL` | `frontend/.env` | Backend API URL | `http://localhost:3000/api` for local dev |
| `VITE_SUPABASE_URL` | `frontend/.env` | Supabase project URL (same as `SUPABASE_URL`) | Supabase → Settings → Data API |
| `VITE_SUPABASE_ANON_KEY` | `frontend/.env` | Supabase publishable (anon) key | Supabase → Settings → API Keys → Publishable key |

---

## Setup Guide

### Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. **Settings → Data API** → copy the **Project URL**.
   - Paste into `SUPABASE_URL` (backend) and `VITE_SUPABASE_URL` (frontend).
3. **Settings → API Keys**:
   - Copy the **Publishable key** (`sb_publishable_...`) → paste into `VITE_SUPABASE_ANON_KEY`.
   - Create (or reveal) the **Secret key** (`sb_secret_...`) → paste into `SUPABASE_SERVICE_ROLE_KEY`.
4. **Settings → Database** → copy the **Connection string** (select **Session mode**).
   - Paste into `DATABASE_URL`.
5. **Authentication → Sign In / Providers → GitHub** → enable the provider.
   - Copy the **Callback URL** shown — you'll need it for the GitHub OAuth App.
6. Run the database migration:
   - **Option A:** Supabase Dashboard → **SQL Editor** → paste the contents of
     `backend/supabase/migrations/001_initial_schema.sql` → Run.
   - **Option B:** From your terminal:
     ```bash
     psql "$DATABASE_URL" -f backend/supabase/migrations/001_initial_schema.sql
     ```

### GitHub OAuth App (for login)

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name:** OnboardBuddy (or anything)
   - **Homepage URL:** `http://localhost:5173`
   - **Authorization callback URL:** the Supabase callback URL copied in step 5 above
     (`https://<ref>.supabase.co/auth/v1/callback`)
3. Click **Register application**.
4. Copy **Client ID** → paste into `GITHUB_CLIENT_ID` in `backend/.env`.
5. Generate a **Client secret** → paste into `GITHUB_CLIENT_SECRET` in `backend/.env`.
6. Go back to **Supabase → Authentication → Providers → GitHub** and paste the
   same Client ID and Client Secret there.

### GitHub App (for repo import)

1. Go to [github.com/settings/apps](https://github.com/settings/apps) → **New GitHub App**.
2. Fill in:
   - **App name:** OnboardBuddy Repo Access (or anything unique)
   - **Homepage URL:** `http://localhost:5173`
   - **Callback URL:** `http://localhost:5173/auth/callback`
   - **Webhook:** uncheck "Active" (we don't need webhooks)
3. Under **Permissions → Repository permissions**:
   - **Contents:** Read-only
   - **Metadata:** Read-only
4. Click **Create GitHub App**.
5. On the app's settings page:
   - Copy **App ID** → `GITHUB_APP_ID`
   - Copy **Client ID** → `GITHUB_APP_CLIENT_ID`
   - Generate a **Client secret** → `GITHUB_APP_CLIENT_SECRET`
6. Scroll to **Private keys** → **Generate a private key**.
   - Save the downloaded `.pem` file to `backend/github-app.pem`.
   - Set `GITHUB_APP_PRIVATE_KEY_PATH=./github-app.pem` (this is the default).
7. **Install the App** on your GitHub account:
   - From the app settings page → **Install App** → select your account → choose
     "All repositories" or select specific ones.

### OpenRouter (AI)

1. Go to [openrouter.ai](https://openrouter.ai) → sign in.
2. **Keys** → **Create Key** → copy the key → paste into `OPENROUTER_API_KEY`.
3. Set `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`.
4. Set `OPENROUTER_MODEL=openai/gpt-4o-mini` (recommended for development — fast
   and cheap).

### Upstash Redis

1. Go to [console.upstash.com](https://console.upstash.com) → create a new Redis database.
2. On the database details page, find the **TCP/TLS** connection string.
   > Do **not** use the HTTP/REST endpoint — BullMQ requires a persistent TCP
   > connection.
3. The connection string format is:
   ```
   rediss://default:<password>@<endpoint>.upstash.io:6379
   ```
4. Paste into `REDIS_URL` in `backend/.env`.

### Generate Encryption Key

Generate a 32-byte hex key for encrypting GitHub tokens at rest:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into `TOKEN_ENCRYPTION_KEY` in `backend/.env`.

---

## Local Development

Install dependencies from the repo root:

```bash
npm install
```

Copy the example env files and fill in your secrets:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Start everything:

```bash
npm run dev          # Starts frontend + backend API + worker (all three)
```

Or start individually:

```bash
npm run dev:frontend   # Frontend only → http://localhost:5173
npm run dev:backend    # Backend API + worker only → http://localhost:3000
```

| Script | What it runs |
|---|---|
| `npm run dev` | `concurrently` — backend (API + worker) and frontend |
| `npm run dev:frontend` | Vite dev server with HMR |
| `npm run dev:backend` | `concurrently` — `tsx watch` for API and worker |
| `npm run build` | TypeScript compile + Vite build (all workspaces) |
| `npm run test` | Mocha (backend) + Vitest (frontend) |
| `npm run lint` | ESLint across the monorepo |
| `npm run format` | Prettier check |

---

## Database Management

### Running the migration

The migration in `backend/supabase/migrations/001_initial_schema.sql` is
**idempotent** — every statement uses `IF NOT EXISTS` or `CREATE OR REPLACE`, so
it's safe to re-run after adding new tables or columns.

**Via Supabase Dashboard:**

1. Go to **SQL Editor** in the Supabase dashboard.
2. Paste the contents of `001_initial_schema.sql`.
3. Click **Run**.

**Via psql:**

```bash
psql "$DATABASE_URL" -f backend/supabase/migrations/001_initial_schema.sql
```

### Nuclear reset

If you need to wipe everything and start fresh:

```bash
# Step 1: Drop all tables, functions, triggers, and extensions
psql "$DATABASE_URL" -f backend/supabase/migrations/000_drop_all.sql

# Step 2: Re-create everything
psql "$DATABASE_URL" -f backend/supabase/migrations/001_initial_schema.sql
```

Or paste each file into the SQL Editor in order.

### Auth trigger

The migration includes a `handle_new_user()` trigger on `auth.users`. When
Supabase Auth creates a new user (via email signup or GitHub OAuth), this trigger
automatically inserts a corresponding row into `public.users`. No manual user
creation is needed.

### Schema overview

The database has the following table groups:

- **Users & Auth:** `users`, `github_connections`
- **Projects:** `projects`, `project_members`, `project_invitations`, `project_settings`
- **Analysis:** `analysis_snapshots`, `analysis_jobs`
- **Code Evidence Graph:** `graph_nodes`, `graph_edges`
- **Workflows:** `workflows`, `workflow_steps`, `workflow_scores`
- **Onboarding Packages:** `onboarding_packages`, `package_sections`, `source_receipts`
- **Documentation Health:** `doc_links`, `stale_flags`
- **Role Paths:** `role_paths`

---

## Docker

The `docker-compose.yml` builds and runs three containers:

| Service | Dockerfile | Port mapping | Purpose |
|---|---|---|---|
| `backend-api` | `backend/Dockerfile.api` | `3000:3000` | Express API server |
| `backend-worker` | `backend/Dockerfile.worker` | — | BullMQ job worker |
| `frontend` | `frontend/Dockerfile` | `5173:80` | Nginx serving the Vite build |

All three Dockerfiles use multi-stage builds on `node:22-alpine`:
1. **deps** — installs npm workspaces dependencies
2. **build** — compiles TypeScript (backend) or runs `vite build` (frontend)
3. **runtime** — minimal image with only production artifacts

Containers connect to cloud services (Supabase, Upstash, OpenRouter, GitHub)
via env vars loaded from `backend/.env`. There is **no local Redis or
PostgreSQL** in the compose stack.

```bash
# Build and run all containers
docker compose up --build

# Run in background
docker compose up --build -d

# Tear down
docker compose down
```

> For local development, prefer `npm run dev` over Docker — you get hot-reload
> from Vite and `tsx watch`.

---

## Auth Flow

The full authentication flow using Supabase + GitHub OAuth:

```
┌──────────┐       ┌───────────┐       ┌────────┐       ┌──────────┐
│ Frontend │       │  Supabase │       │ GitHub │       │ Backend  │
└────┬─────┘       └─────┬─────┘       └───┬────┘       └────┬─────┘
     │                    │                 │                  │
     │ 1. Click "Sign in  │                 │                  │
     │    with GitHub"    │                 │                  │
     │───────────────────>│                 │                  │
     │ signInWithOAuth()  │                 │                  │
     │                    │ 2. Redirect to  │                  │
     │                    │    consent      │                  │
     │                    │────────────────>│                  │
     │                    │                 │                  │
     │                    │ 3. User grants  │                  │
     │                    │    access       │                  │
     │                    │<────────────────│                  │
     │                    │  (callback URL) │                  │
     │                    │                 │                  │
     │ 4. Create session, │                 │                  │
     │    store provider  │                 │                  │
     │    token           │                 │                  │
     │<───────────────────│                 │                  │
     │  (redirect to      │                 │                  │
     │   /auth/callback)  │                 │                  │
     │                    │                 │                  │
     │ 5. Extract session │                 │                  │
     │    from URL        │                 │                  │
     │                    │                 │                  │
     │ 6. API requests with Supabase JWT    │                  │
     │─────────────────────────────────────────────────────────>│
     │                    │                 │   7. Validate JWT │
     │                    │                 │                  │
```

**Step-by-step:**

1. User clicks **"Sign in with GitHub"** on the frontend.
2. Frontend calls `supabase.auth.signInWithOAuth({ provider: "github" })`.
3. Supabase redirects the browser to the **GitHub OAuth App** consent screen.
4. After the user grants access, GitHub redirects back to the **Supabase callback
   URL** (`https://<ref>.supabase.co/auth/v1/callback`).
5. Supabase creates a session and stores the `provider_token` (the GitHub access
   token from the OAuth exchange).
6. The browser is redirected to `/auth/callback` on the frontend, which extracts
   the session from the URL hash/query params.
7. On every subsequent API request, the frontend sends the Supabase JWT in the
   `Authorization` header. The backend validates this JWT against the Supabase
   project's JWT secret.

---

## Repo Import Flow

```
┌──────────┐       ┌──────────┐       ┌───────────┐       ┌──────────┐
│ Frontend │       │ Backend  │       │  Upstash  │       │  Worker  │
│          │       │   API    │       │   Redis   │       │          │
└────┬─────┘       └────┬─────┘       └─────┬─────┘       └────┬─────┘
     │                   │                   │                   │
     │ 1. User installs  │                   │                   │
     │    GitHub App on  │                   │                   │
     │    their account  │                   │                   │
     │                   │                   │                   │
     │ 2. GET /api/      │                   │                   │
     │    github/        │                   │                   │
     │    installations  │                   │                   │
     │──────────────────>│                   │                   │
     │    (list repos)   │                   │                   │
     │<──────────────────│                   │                   │
     │                   │                   │                   │
     │ 3. User selects   │                   │                   │
     │    repo + branch  │                   │                   │
     │                   │                   │                   │
     │ 4. POST /api/     │                   │                   │
     │    projects       │                   │                   │
     │──────────────────>│                   │                   │
     │   (create project)│                   │                   │
     │<──────────────────│                   │                   │
     │                   │                   │                   │
     │ 5. POST /api/     │                   │                   │
     │    projects/:id/  │                   │                   │
     │    analyze        │                   │                   │
     │──────────────────>│                   │                   │
     │                   │ 6. Enqueue job    │                   │
     │                   │──────────────────>│                   │
     │                   │                   │                   │
     │                   │                   │ 7. Claim job      │
     │                   │                   │<──────────────────│
     │                   │                   │                   │
     │                   │                   │  8. Download repo │
     │                   │                   │     archive from  │
     │                   │                   │     GitHub, run   │
     │                   │                   │     analysis      │
     │                   │                   │                   │
```

**Step-by-step:**

1. The user **installs the OnboardBuddy GitHub App** on their GitHub account
   (from the App's public install page or github.com/settings/installations).
   This grants OnboardBuddy read-only access to the selected repositories.
2. The frontend calls **`GET /api/github/installations`** to fetch a list of
   installations and their accessible repositories.
3. The user **selects a repository and branch** in the UI.
4. The frontend calls **`POST /api/projects`** to create a project record in the
   database (owner, repo name, branch).
5. The frontend calls **`POST /api/projects/:id/analyze`** to kick off analysis.
6. The backend API **enqueues an analysis job** on the BullMQ queue in Upstash
   Redis.
7. The backend worker **claims the job** from the queue.
8. The worker **downloads the repo archive** from GitHub using the GitHub App's
   installation token, then runs static analysis and (optionally) AI-powered
   explanation generation. Results are written back to the database.
