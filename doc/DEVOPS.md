# OnboardBuddy — DevOps Guide

## Project Architecture

OnboardBuddy is a monorepo with three top-level directories:

```
onboardbuddy/
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

## Database change policy (read before writing a migration)

**The deployed build and local builds share one Supabase project**, so a migration lands under
code that is still running. Prefer solving the problem in application code, in a jsonb column that
already exists (`metadata`, `generation_context`, `checkpoint`, `budget_usage`, `score_breakdown`),
or by deriving the value at read time.

**When a schema change is genuinely needed, it must be backwards compatible with the build currently
deployed**, which means all of:

- **Additive only.** New nullable columns, new tables, new indexes. Never drop or rename a column or
  table, never narrow a type, never add a `NOT NULL` without a default, never tighten a `CHECK` that
  existing rows or the deployed code paths could violate.
- **Existing queries keep working unchanged.** The deployed build selects named columns and writes
  rows without the new field; both must still succeed. A new column has to have a sensible default or
  be nullable.
- **No destructive backfill.** Backfill into new space, never overwrite existing values.
- **Reversible.** Ship a `DOWN` alongside the `UP`, and confirm the deployed build still runs after the
  `UP` is applied, not just after the `DOWN`.
- **Written down.** Add it to the migration folder with a comment naming why it was needed, and note
  it in this guide.

The practical test before writing any migration: *if the currently deployed build runs against this
database tomorrow, does it still work?* If the honest answer is "probably", that is a no.

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
| `DATABASE_URL` | `backend/.env` | PostgreSQL connection string (Transaction mode, port 6543) |
| `DIRECT_DATABASE_URL` | `backend/.env` | Session-mode string (port 5432) — DDL/migrations only |
| `VITE_SUPABASE_URL` | `frontend/.env` | Same project URL, exposed to browser via Vite |
| `VITE_SUPABASE_ANON_KEY` | `frontend/.env` | Publishable anon key (safe to expose, RLS-gated) |

**Dashboard settings the app depends on** (Supabase → Authentication). One
Supabase project can serve localhost and a Railway deployment at the same
time — the allow-list accepts multiple entries, so configure both origins
side by side:

1. **Authentication → URL Configuration → Site URL** — the frontend origin
   Supabase falls back to when a redirect isn't allow-listed, and the base
   for links in auth emails. Use the origin users actually open:
   `http://localhost:5173` while developing locally, `https://<frontend-domain>.up.railway.app`
   once deployed (switch it when the Railway deployment becomes the primary).
2. **Authentication → URL Configuration → Redirect URLs** — add **all four**
   (each origin × each path; Supabase refuses any redirect not listed here):

   | Entry | Used by |
   |---|---|
   | `http://localhost:5173/reset-password` | "Forgot password?" email flow (local) |
   | `http://localhost:5173/auth/callback` | GitHub sign-in + identity linking (local) |
   | `https://<frontend-domain>.up.railway.app/reset-password` | password reset (Railway) |
   | `https://<frontend-domain>.up.railway.app/auth/callback` | sign-in + linking (Railway) |

3. **Authentication → Sign In / Providers → Allow manual linking** — enable
   it. Account Settings uses `auth.linkIdentity` / `auth.unlinkIdentity` for
   the "Link GitHub account", "Unlink", and "Email Login" buttons; with the
   toggle off those calls fail with a 4xx and the buttons error out.

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

### 3. GitHub login (via the GitHub App's OAuth)

**What it does:** Supabase delegates GitHub sign-in to the GitHub App's own
OAuth credentials (see the next section — one app for login AND repo access).
Users see a single GitHub consent screen and are redirected back to Supabase.
The separately registered OAuth App this project used previously is retired;
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` env vars are gone with it
(the backend never read them — they only ever lived in the Supabase dashboard).

The Supabase provider config holds the GitHub App's Client ID/secret, and the
App's callback list must include the Supabase callback (as the SECOND entry):

```
https://<ref>.supabase.co/auth/v1/callback
```

### 4. GitHub App (for repo import)

**What it does:** Grants OnboardBuddy read-only access to repository contents and
metadata. Users install this App on their GitHub account, and the backend uses
its credentials to download repo archives for analysis. The GitHub App also
performs user authorization so OnboardBuddy can list only the installations
accessible to the connected GitHub user.

**What data it holds:** None — installation tokens are short-lived.

| Env var | `.env` file | Description |
|---|---|---|
| `GITHUB_APP_ID` | `backend/.env` | Numeric App ID |
| `GITHUB_WEBHOOK_SECRET` | `backend/.env` | Optional push-webhook HMAC secret (unset = webhook disabled) |
| `GITHUB_APP_CLIENT_ID` | `backend/.env` | App client ID |
| `GITHUB_APP_CLIENT_SECRET` | `backend/.env` | App client secret |
| `GITHUB_APP_PRIVATE_KEY_PATH` | `backend/.env` | Path to `.pem` private key file (default: `./github-app.pem`) |
| `GITHUB_APP_PRIVATE_KEY` | `backend/.env` | Alternative to the path: the full PEM **contents** (for hosts without file mounts, e.g. Railway; takes precedence, `\n`-escaped newlines OK) |
| `GITHUB_INSTALL_STATE_SECRET` | `backend/.env` | Secret used to sign GitHub App install state; falls back to `TOKEN_ENCRYPTION_KEY` |
| `FRONTEND_URL` | `backend/.env` | Frontend origin used for GitHub App OAuth/setup redirects, e.g. `http://localhost:5173` |

### 5. OpenRouter (AI)

**What it does:** Routes LLM requests to configurable providers. The default
model is `deepseek/deepseek-v4-flash` (1M context, 65k max output). OpenRouter
uses the OpenAI-compatible API shape, so the `openai` npm package works directly.

**What data it holds:** Request/response logs on the OpenRouter dashboard only.

| Env var | `.env` file | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | `backend/.env` | API key from openrouter.ai |
| `OPENROUTER_BASE_URL` | `backend/.env` | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | `backend/.env` | Legacy alias for the cheap-tier model |

#### LLM models & cost — where to change the models

The pipeline uses two chat tiers (**cheap** for bulk symbol/file work and
claim verification, **strong** for synthesis, ranking, tutorials and the
onboarding sections) plus an **embedding** tier. **Both chat tiers default to
`deepseek/deepseek-v4-flash`** ($0.09/M in, $0.18/M out — a full
standard-depth analysis of a small/medium repo costs cents; the batch sizes
in `engine/budgets.ts` are tuned to its 1M-context/65k-output caps). Change
them in either of two places:

1. **Server-wide (env, `backend/.env`)** — any OpenRouter model id:

   ```bash
   OPENROUTER_MODEL_CHEAP=deepseek/deepseek-v4-flash
   OPENROUTER_MODEL_STRONG=deepseek/deepseek-v4-flash   # e.g. anthropic/claude-sonnet-4.5 for premium section prose
   EMBEDDINGS_MODEL=text-embedding-3-small
   ```

2. **Per project (DB/API)** — `project_settings.model_tier_overrides`, e.g.
   `{"strong": ["anthropic/claude-sonnet-4.5", "openai/gpt-4o"]}` via
   `PUT /api/projects/:id/settings` (later list entries are degrade
   fallbacks). Failure behavior per tier lives in
   `project_settings.model_failure_behavior`.

#### Latency model (2026-07 overhaul)

**Latency targets (cold runs only; warm/incremental runs don't count):** cold first
import ≤ 9:00 analysis, cold re-import ≤ 5:00 analysis; end-to-end adds ~1:00
of generation. The benchmark case is our own repository (2.3M tokens, 268
files): analyze ~4:16, ~5:17 end-to-end cold, ~$0.35. (The working document
that tracked these measurements, `ONBOARDING_QUALITY_LATENCY_PLAN.md`, was
removed from `doc/` in August 2026; it remains in git history.)

The pipeline is sized for a flash-class 1M-context model and a REMOTE
Postgres: throughput comes from *moderately sized batches × high
concurrency × bulk DB statements*, not mega-prompts (output decode is the
per-call bound, ~65k max output).

- **Batching:** symbol records pack 10/call across files
  (`engine/budgets.ts`), file synthesis 6 files/call, critique 12
  records/call, rerank 15 targets/call. Every chat call sets an explicit
  `maxOutputTokens`. Sizes are tuned to MEASURED OpenRouter decode
  (~30–120 tok/s depending on upstream): keep per-call output ≤ ~7k tokens
  so a slow upstream costs ≤ ~2 min, not 9.
- **Concurrency:** `LLM_MAX_CONCURRENCY` (per AiClient, default 12, env 28)
  is the provider-pressure knob; per-pass `mapLimit`s feed it. It is **per
  running job**, not global — `WORKER_CONCURRENCY` runs multiply it, and
  OpenRouter limits are per key. `PG_POOL_MAX` (worker 30) caps concurrent
  statements — the transaction-mode pooler multiplexes, so it sizes per
  process, not per user.
- **Slow-upstream guards:** every provider attempt has a hard deadline
  (`LLM_REQUEST_TIMEOUT_MS`, default 240s) and chat requests ask OpenRouter
  to route by `provider.sort` (`OPENROUTER_PROVIDER_SORT`, default
  `throughput`). A timed-out attempt is a retryable provider error, so
  normal retries / symbol-batch halving absorb it.
- **Bulk persistence:** record lookups/inserts/receipts/snapshot-mappings,
  criticality upserts, entrypoint/side-effect/workflow-step persists, and
  tutorial steps are all multi-VALUES / `unnest` statements. Per-record
  round trips to the pooler were the dominant wall-clock cost.
- **Budget counters are amortized:** limits are enforced from in-memory
  counters; `analysis_snapshots.budget_usage` is flushed every 10 calls/5s
  and at phase boundaries — a crash loses at most a few calls of counters
  while `ai_generation_runs` stays the exact per-call ground truth. The
  kill-switch check is cached for 2s (pause lands within ~2s + one batch).
- **Carry-forward:** a forced re-scan captures the previous mapping before
  deleting it; symbols whose evidence/prompt/model/depth identity is
  unchanged re-map in bulk with zero lookups and zero LLM calls
  (`carriedForward` in the `semantic_symbols` phase metrics).
- **Benchmarking:** `node scripts/latency-report.cjs <snapshot_id>` inside a
  backend container prints per-phase wall-clock + per-call rollups.
- **Prompt-version freeze (2026-07-28):** `SECTION_PROMPT_VERSION`,
  `TUTORIAL_PROMPT_VERSION` and `PROMPT_VERSIONS.*` are frozen unless a
  change is deliberately paid for. Every bump voids the semantic-record
  carry-forward AND the section cache in one stroke — the 07-25 bumps
  (`section-v6→v7`, `tutorial-v2→v3→v4`) are why every run that week was
  fully cold. A bump must say so in its commit message.

Defaults live in `backend/src/worker/ai/modelTiers.ts`
(`defaultTierModels()`); the coarse per-tier price table used for the cost
UI is in the same file — update the `strong` row if you point that tier at
a premium model.

### 6. Embeddings (for RAG — OpenAI or OpenRouter, keyed by model id)

**What it does:** Generates vector embeddings for semantic-record views,
enabling semantic search and retrieval-augmented generation. Routing is
decided by the SHAPE of `EMBEDDINGS_MODEL` (`worker/ai/embeddingProfiles.ts`):

| Model id shape | Route | Key | Body |
|---|---|---|---|
| `vendor/model` (e.g. `qwen/qwen3-embedding-8b`, this deployment) | OpenRouter `/embeddings` | `OPENROUTER_API_KEY` | ZDR provider prefs (`zdr`, `data_collection` — same envs as chat), `encoding_format: float`, no `dimensions` |
| bare (e.g. `text-embedding-3-small`, code default, $0.02/M) | `EMBEDDINGS_BASE_URL` (OpenAI direct) | `EMBEDDINGS_API_KEY` | `dimensions: 1536` |

The DB column is frozen at `vector(1536)` (policy above), so
OpenRouter-route vectors longer than 1536 are MRL-truncated to the leading
1536 dims and L2-normalized before insert (qwen3-embedding-8b is
Matryoshka-trained, natively 4096-dim and unnormalized; cosine `<=>` needs
unit vectors; pplx-embed, the previous model, was 2560). Rows are keyed
`unique(record_id, view_type, model)`, and retrieval detects per snapshot
which model wrote its vectors, embeds the query with that same model, and
filters the seed search on `e.model` — so pre-switch snapshots (and anything
an older build writes) keep working after a model flip.

**Older-build coexistence caveat:** `semantic_records` is a project-scoped
cache. If a newer build re-analyzes a project and an older build (whose
retrieval has no model filter) then queries it, the older build silently
ranks vectors from different models against each other: no crash, degraded
ordering. Don't point an older build at projects re-analyzed by a newer one.

**What data it holds:** None — embeddings are stored in PostgreSQL (pgvector).

| Env var | `.env` file | Description |
|---|---|---|
| `EMBEDDINGS_API_KEY` | `backend/.env` | OpenAI key (bare-model route; keep it for pre-switch snapshots) |
| `EMBEDDINGS_BASE_URL` | `backend/.env` | `https://api.openai.com/v1` (bare-model route only) |
| `EMBEDDINGS_MODEL` | `backend/.env` | this deployment: `qwen/qwen3-embedding-8b` (code default `text-embedding-3-small`) |
| `EMBED_BATCH_SIZE` | `backend/.env` | inputs per API request (default 128); the escape hatch if an upstream rejects the batch |
| `EMBED_WRITE_CONCURRENCY` | `backend/.env` | concurrent INSERT writers per job (default 2 — 8-way self-contention on the HNSW index is the measured failure mode, see the 2026-07-28 latency audit) |
| `EMBED_INSERT_CHUNK` | `backend/.env` | rows per INSERT statement (default 64) |
| `SYMBOL_HEDGE_MAX` | `backend/.env` | max hedged duplicate calls per run against symbol-phase straggler batches (default 3; winner-take-first, loser aborted) |

### 7. BullMQ Worker Configuration

The worker uses the following tuning parameters to balance responsiveness vs
Upstash Redis cost:

| Env var | Default | Description |
|---|---|---|
| `WORKER_POLL_INTERVAL_MS` | `30000` | BullMQ `drainDelay`: how long to wait between idle polls. Jobs still picked up instantly via ZSET signal. |
| `WORKER_CONCURRENCY` | `4` | Max parallel **analysis** runs per worker process |
| `SUMMARY_CONCURRENCY` | `4` | Max parallel **package generations** per worker process (same process — `worker/index.ts` imports `summaryWorker.js`) |
| `LLM_MAX_CONCURRENCY` | `12` | Parallel AI calls per run (per `AiClient` semaphore — **per job, not global**) |
| `SECTION_CONCURRENCY` | `12` | Package sections generated in parallel within one generation job |
| `WORKER_SHUTDOWN_GRACE_MS` | `25000` | On SIGTERM: stop taking new jobs, finish the current ones, then exit. Must stay **under** the orchestrator's stop grace (`docker-compose.yml` sets `stop_grace_period: 30s`) or the drain is SIGKILLed mid-way |
| `JOB_RECOVERY_MAX_ATTEMPTS` | `2` | Times one job row may be automatically re-queued after a worker restart before it is failed for good |

#### Restart resilience (why a deploy no longer kills in-flight runs)

Any container recreate used to orphan every running analysis: the reconciler
marked them `failed` and a human had to notice and press Analyze… again. Two
mechanisms now cover it, in `backend/src/worker/jobRecovery.ts` and
`backend/src/worker/shutdown.ts`:

1. **Recovery sweep** — on boot and every 120s in *every* replica, a job stuck
   `running` with a heartbeat older than 3 minutes is claimed by one atomic
   `UPDATE` and put back on its queue **on the same `analysis_jobs` row**, so
   phase checkpoints, the budget baseline and the content-addressed record
   cache all still apply. Analysis re-queues carry `force: true` for the same
   reason `POST /resume` does — otherwise the snapshot-reuse short-circuit sees
   the optimistic `complete` written at 46% and skips the six phases after it.
2. **Bounded, durable attempts** — a dead heartbeat cannot tell "SIGKILLed by a
   deploy" from "crashes on this repository", so recovery is capped. The count
   lives in `analysis_jobs.checkpoint->'recovery'->>'attempts'` (existing jsonb
   column, no schema change) and is incremented by the claim itself, before the
   job goes back on the queue. BullMQ's `attemptsMade` resets on re-enqueue and
   cannot bound this. `preflight` and `regenerate_section` are never
   auto-recovered — the same two types `POST /resume` refuses.
3. **Graceful shutdown** — SIGTERM closes both workers so they stop fetching and
   finish what they hold. If the grace period expires the runs are abandoned
   (a cold analysis takes minutes; no orchestrator waits that long), their rows
   are explicitly aged into the recovery window, and the process exits `1` so
   the platform log shows the drain did not complete. The replacement container
   re-queues them on its boot sweep.

`backend/Dockerfile.worker` runs `node` **directly** rather than through
`npm run`: as PID 1, npm's signal forwarding is unreliable and the kernel drops
default-action signals to PID 1 entirely, so SIGTERM never reached the handler.

**Cost note:** With `drainDelay: 30000`, idle Redis commands drop ~6x compared
to the BullMQ default of 5000ms. For sustained usage, switch to Upstash Fixed
plan ($10/month) for unlimited commands.

### 8. Connection pooling (Supabase transaction mode)

`DATABASE_URL` points at Supabase's Supavisor pooler in **transaction mode**
(port **6543**). Clients multiplex over the pooler's backend pool: a connection
is borrowed per transaction/statement and returned immediately, so the API and
any number of worker replicas can each run a full-size `pg.Pool` without
exhausting a user-wide session cap.

This is safe for OnboardBuddy because the backend uses **no session-scoped
Postgres features**: no advisory locks, no LISTEN/NOTIFY, no `SET
SESSION`/`set_config`, no cursors, and node-postgres only issues *unnamed*
prepared statements (supported by Supavisor transaction mode). All multi-step
transactions run on a single checked-out client between `BEGIN` and `COMMIT`,
which transaction mode pins to one backend connection. **Keep it that way** —
if you ever need a session feature, take a dedicated client from the pool and
document it here.

Two URLs, two jobs:

| Env var | Port | Used for |
|---|---|---|
| `DATABASE_URL` | `6543` (transaction) | All application traffic (API + workers) |
| `DIRECT_DATABASE_URL` | `5432` (session) | DDL only: `psql -f` migrations and manual `ALTER`s |

Per-process `PG_POOL_MAX` (default 30, `backend/src/lib/db.ts`) sizes for the
process's own fan-out, not a shared cap: `10` for the API, `30` per worker
replica (both pinned in `docker-compose.yml`, which **overrides**
`backend/.env`). The 30 budgets ~6 connections per concurrent job across
`WORKER_CONCURRENCY` analyses + `SUMMARY_CONCURRENCY` generations — full
arithmetic in the `db.ts` header comment.

`connectionTimeoutMillis` is **30s**, not 5s. At 5s, two concurrent analyses
both died with `timeout exceeded when trying to connect`: the 28-wide semantic
`mapLimit` saturated a 10-slot pool and the short acquire cap turned ordinary
queueing into failed runs. Statements are short bulk writes and no code path
holds a client while awaiting another, so waiting is always the right answer.

Under heavy parallel load the failure mode is pooler queue wait (slow queries)
or `pg.Pool` acquire timeouts — never a session-cap error. Supavisor's
`MaxClientsInSessionMode` exists only in session mode, and application traffic
never touches the session pooler (DDL-only, above), so it cannot occur here.
If queries start queueing, raise `default_pool_size` in Supabase (Database →
Settings → Connection pooling) before raising `PG_POOL_MAX` — it sizes the
transaction pooler's shared backend pool. The one hard connection error
transaction mode can produce is the plan-level `Max client connections
reached`, which counts client connections (the API pool plus `PG_POOL_MAX`
per worker replica), so keep replicas × pool size under the plan's client
limit.

### 9. Scaling workers (parallel analyses)

Runs for different (scope, commit) tuples execute concurrently. To add
throughput, scale worker replicas:

```bash
docker compose up -d --scale backend-worker=3
```

BullMQ distributes jobs across replicas; per-job heartbeats, checkpoints, and
the row-guarded kill switch/reconciler are already multi-worker-safe. Tuning:

- Total parallel **analyses** = replicas × `WORKER_CONCURRENCY` (4 per replica
  by default); package generations scale separately via `SUMMARY_CONCURRENCY`.
- Total parallel **AI calls** ≈ replicas × `WORKER_CONCURRENCY` ×
  `LLM_MAX_CONCURRENCY` — the `AiClient` semaphore is per job, there is **no
  global cross-run LLM limiter**, and OpenRouter's spend/rate limits are per
  key. 4 concurrent semantic phases therefore multiply burst spend ~4×; keep
  the product under your key's limits.
- Total pooler **client slots** = API (10) + replicas × `PG_POOL_MAX` (30).
  Supavisor allows ~200 per project, so ~4 replicas is the practical ceiling
  before you also need a bigger `default_pool_size`.
- Prefer more replicas over a much higher `WORKER_CONCURRENCY`: repo parsing is
  CPU/RAM-heavy per job, and replicas isolate failures.
- Verify a live N-way run with `backend/tmp/concurrency-test.mts` (see its
  header for the exact command).

---

## Complete Secrets Reference

| Variable | `.env` file | Description | Where to find it |
|---|---|---|---|
| `NODE_ENV` | `backend/.env` | `development` or `production` | Set manually |
| `PORT` | `backend/.env` | API listen port (default `3000`) | Set manually |
| `CORS_ORIGIN` | `backend/.env` | Allowed origin (e.g. `http://localhost:5173`). Required when `NODE_ENV=production` | Set manually |
| `FRONTEND_URL` | `backend/.env` | Frontend origin the GitHub App OAuth/setup redirects land on | Set manually |
| `SUPABASE_URL` | `backend/.env` | Supabase project URL | Supabase → Settings → Data API |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` | Service-role secret key | Supabase → Settings → API Keys → create Secret key |
| `DATABASE_URL` | `backend/.env` | PostgreSQL connection string (Transaction pooler, port 6543) | Supabase → **Connect** (top of dashboard) → Transaction pooler |
| `DIRECT_DATABASE_URL` | `backend/.env` | Session-pooler string (port 5432), DDL/migrations only | Same dialog, Session pooler |
| `PG_POOL_MAX` | `backend/.env` | Per-process pg pool cap (code default `30`; 10 for api, 30 for worker) | Set manually (see "Connection pooling" above) |
| `REDIS_URL` | `backend/.env` | Upstash TCP/TLS connection string. Required when `NODE_ENV=production` (or `REDIS_HOST`) | Upstash Console → Database → Details |
| `QUEUE_SUFFIX` | `backend/.env` | BullMQ queue-name suffix. Empty locally; `-prod` in production. **Must match between api and worker** | Set manually |
| `WORKER_POLL_INTERVAL_MS` | `backend/.env` | Worker poll interval in ms (default `30000`) | Set manually |
| `GITHUB_CLIENT_ID` | (none) | **Retired.** Login runs through the GitHub App's OAuth; no backend code reads this | Lives only in Supabase → Authentication → Providers → GitHub |
| `GITHUB_CLIENT_SECRET` | (none) | **Retired.** Same as above | Lives only in the Supabase dashboard |
| `GITHUB_APP_ID` | `backend/.env` | GitHub App numeric ID | github.com → Settings → Developer settings → GitHub Apps |
| `GITHUB_WEBHOOK_SECRET` | `backend/.env` | Push-webhook HMAC secret (optional) | Same page → Webhook secret |
| `GITHUB_APP_CLIENT_ID` | `backend/.env` | GitHub App client ID | Same page as above |
| `GITHUB_APP_CLIENT_SECRET` | `backend/.env` | GitHub App client secret | Same page as above |
| `GITHUB_APP_PRIVATE_KEY_PATH` | `backend/.env` | Path to `.pem` file | Generate on GitHub App page → download |
| `GITHUB_APP_PRIVATE_KEY` | `backend/.env` | PEM contents (hosted alternative to the path, e.g. Railway) | Same `.pem` file — paste its contents |
| `GITHUB_INSTALL_STATE_SECRET` | `backend/.env` | Signs the GitHub App install state parameter. Falls back to `TOKEN_ENCRYPTION_KEY` if unset | Generate like `TOKEN_ENCRYPTION_KEY` below |
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
4. Click **Connect** at the top of the dashboard and copy the connection string twice:
   - **Transaction pooler** (port 6543) → paste into `DATABASE_URL`.
   - **Session pooler** (port 5432) → paste into `DIRECT_DATABASE_URL` (DDL/migrations only).
5. **Authentication → Sign In / Providers → GitHub** → enable the provider.
   - Copy the **Callback URL** shown — you'll need it for the GitHub OAuth App.
6. Run the database migration:
   - **Option A:** Supabase Dashboard → **SQL Editor** → paste the contents of
     `backend/supabase/migrations/001_initial_schema.sql` → Run.
   - **Option B:** From your terminal:
     ```bash
     psql "$DIRECT_DATABASE_URL" -f backend/supabase/migrations/001_initial_schema.sql
     ```

### GitHub login (the GitHub App's own OAuth — no separate OAuth App)

Login and repo access share ONE GitHub App (the one created in the next
section). A GitHub App carries its own OAuth credentials and speaks the same
`login/oauth/authorize` protocol an OAuth App would, so Supabase's GitHub
provider works with it directly; the separately registered OAuth App this
project used previously is retired.

1. Create the GitHub App first (next section), then on its settings page:
   - **Account permissions → Email addresses: Read-only** — REQUIRED.
     Supabase needs a verified email to create the user; without this
     permission, sign-ups fail for users with private email addresses
     ("Error getting user profile from external provider", Bug #37 in
     [BUGS_AND_FIXES.md](./BUGS_AND_FIXES.md)).
   - **Callback URLs**: keep `http://localhost:5173/github/oauth/callback`
     FIRST (GitHub sends installation-time authorizations to the first one),
     and add the Supabase callback as a second entry:
     `https://<ref>.supabase.co/auth/v1/callback`.
2. In **Supabase → Authentication → Providers → GitHub**, paste the GitHub
   App's **Client ID** and a generated **Client secret** (the same values as
   `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` in `backend/.env`).
3. That's it: signing in with GitHub now consents to the app once, and repo
   selection happens later, only when the user imports. Existing accounts
   survive a credential swap (Supabase keys identities by GitHub user ID);
   users just see one fresh consent on their next login.

### GitHub App (for repo import)

1. Go to [github.com/settings/apps](https://github.com/settings/apps) → **New GitHub App**.
2. Fill in:
   - **App name:** OnboardBuddy Repo Access (or anything unique)
   - **Homepage URL:** `http://localhost:5173`
   - **Callback URL:** `http://localhost:5173/github/oauth/callback`
   - **Setup URL:** `http://localhost:5173/github/setup`
   - **Webhook:** check **Active** if you want push-triggered re-analysis
     (optional — see "GitHub App webhook (auto re-analysis)" below). Otherwise
     uncheck it.
3. Under **Permissions → Repository permissions**:
   - **Contents:** Read-only
   - **Metadata:** Read-only
   - Under **Subscribe to events**, tick **Push** (only if the webhook is Active).
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

### Combined install + authorize (one GitHub screen)

On the App's **General** page, under "Identifying and authorizing users":

1. Keep the app's own callback (`<origin>/github/oauth/callback`) as the FIRST
   Callback URL (see the login section above for the Supabase entry).
2. Tick **Request user authorization (OAuth) during installation**.
3. The **Setup URL** field becomes unavailable once that box is ticked — that
   is expected; the `/github/setup` route keeps working for arrivals from
   configurations that predate the change. Tick **Redirect on update** if the
   checkbox is still enabled.
4. Save. No environment variables change.

With this on, installing the app both grants identity and links the
installation in one round trip: GitHub returns to
`/github/oauth/callback?code=…&installation_id=…&setup_action=install&state=…`
and the app completes the OAuth exchange and the installation link in one
pass. Installs or repository changes started ON github.com (not from an
in-app button) return without a `state`; the app shows a success notice and
the Import page picks the change up when focused. Such installs are usable
immediately — `github_installations` is bookkeeping that nothing reads; the
live list always comes from the GitHub API.

Deploy order for production: ship the release containing the combined
callback handling BEFORE flipping the checkbox on the production App.

### GitHub App webhook (auto re-analysis)

Optional: pushes can trigger an **incremental** re-analysis automatically.
Off by default — each project opts in via Settings → "Re-analyze on push"
(`project_settings.auto_reanalyze_on_push`).

Behavior: a push to branch X re-analyzes each scope that has onboarding
packages on X (one `incremental_update` job per scope, attributed to the
project owner). Pushes to branches without packages are ignored. Incremental
runs **stale-flag** affected sections/tutorials — they never rebuild packages,
so there is no surprise LLM spend. Redeliveries are idempotent (the per-tuple
concurrency guard skips identical active runs). Note a repo imported by
several users fans out to one run set per opted-in project.

Setup — the shared part first, then the URL, which depends on where the API
runs:

1. Generate a secret once:
   `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
2. GitHub App settings ([github.com/settings/apps](https://github.com/settings/apps)
   → your app → **General**) → **Webhook**: check **Active**, paste the secret
   into **Webhook secret**, and set the **Webhook URL** per environment (below).
3. Same page → **Permissions & events → Subscribe to events**: tick **Push**
   (the events list only appears while the webhook is Active).
4. Give the backend the same secret: `GITHUB_WEBHOOK_SECRET=<secret>`.
   Deliveries are verified against `X-Hub-Signature-256` (HMAC over the raw
   body); with the env var unset the endpoint answers 503 and does nothing.
5. Toggle **Settings → Re-analyze on push** in each project that should react.
6. Verify: GitHub App settings → **Advanced → Recent Deliveries** — the
   `ping` delivery should show a green check and a `{"ok":true,"pong":true}`
   response body. Redeliver any row from there while testing.

**Webhook URL — local development.** GitHub can't reach `localhost`, so run a
tunnel and give GitHub the tunnel's public URL:

- **smee.io** (simplest, no account): open [smee.io](https://smee.io) → **Start
  a new channel** → use the channel URL as the GitHub **Webhook URL**
  (e.g. `https://smee.io/AbCdEf123`), then forward it to the local API and
  keep this running while you test:

  ```bash
  npx smee-client --url https://smee.io/AbCdEf123 \
    --target http://localhost:3000/api/webhooks/github
  ```

  smee replays the raw body and headers, so the HMAC signature still
  verifies. The channel page shows every delivery and lets you replay them.
- **ngrok** (alternative): `ngrok http 3000`, then set the Webhook URL to
  `https://<id>.ngrok-free.app/api/webhooks/github`. On the free tier the
  URL changes every time ngrok restarts — update the GitHub App each time,
  which is why smee is more convenient for occasional testing.
- After editing `backend/.env`, restart the API so it picks the secret up
  (`docker compose up -d backend-api`, or restart `npm run dev:backend`).

**Webhook URL — deployed on Railway.** No tunnel needed; the API service has
a public domain:

1. Railway → the **API service** → **Settings → Networking → Generate Domain**
   (if not already done) — say it's `https://onboardbuddy-api.up.railway.app`.
2. GitHub App **Webhook URL:** `https://onboardbuddy-api.up.railway.app/api/webhooks/github`.
3. Railway → API service → **Variables**: add `GITHUB_WEBHOOK_SECRET=<secret>`
   (the worker service doesn't need it — only the API receives deliveries) →
   redeploy the service.
4. Confirm via **Recent Deliveries** (step 6 above). A `no_matching_projects`
   response on pushes just means no project on that repo has the setting ON —
   signature and routing are already working.

Smoke test without GitHub:

```bash
BODY='{"ref":"refs/heads/main","after":"<40-hex sha>","deleted":false,"repository":{"name":"<repo>","owner":{"login":"<owner>"}},"installation":{"id":123}}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" -hex | sed 's/^.*= //')"
curl -i -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" -H "X-GitHub-Event: push" \
  -H "X-Hub-Signature-256: $SIG" -d "$BODY"
```

### OpenRouter (AI)

1. Go to [openrouter.ai](https://openrouter.ai) → sign in.
2. **Keys** → **Create Key** → copy the key → paste into `OPENROUTER_API_KEY`.
3. Set `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`.
4. Set `OPENROUTER_MODEL_CHEAP=deepseek/deepseek-v4-flash` and
   `OPENROUTER_MODEL_STRONG=deepseek/deepseek-v4-flash` (fast, 1M context,
   cents per analysis).

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

## Deploying to Railway

Supabase, Upstash, and OpenRouter are already cloud services — deploying
OnboardBuddy means hosting the three containers from `docker-compose.yml` as
three Railway services in one Railway project, each built from this repo with
its own Dockerfile.

### 1. Create the services

In a Railway project, add three services, each **from this GitHub repo**, and
point each at its Dockerfile (service → **Settings → Build → Dockerfile
Path**):

| Service | Dockerfile Path | Public domain? |
|---|---|---|
| `api` | `backend/Dockerfile.api` | Yes — **Settings → Networking → Generate Domain** |
| `worker` | `backend/Dockerfile.worker` | No (queue consumer only) |
| `frontend` | `frontend/Dockerfile` | Yes — Generate Domain |

Railway auto-deploys every push to the connected branch. The API listens on
`process.env.PORT` (Railway injects it); the frontend's nginx serves on 80 and
Railway maps it automatically. Scaling workers = raising the worker service's
replica count (see "Scaling workers" above; same env knobs apply).

### 2. Service variables

**`api`** — everything from `backend/.env`, with these deployment-specific
differences:

- `GITHUB_APP_PRIVATE_KEY` = the full contents of `github-app.pem` (Railway
  has no file mounts, so the path variable can't work; the variable editor
  accepts multi-line values — paste the PEM as is). Leave
  `GITHUB_APP_PRIVATE_KEY_PATH` unset.
- `CORS_ORIGIN` = `https://<frontend-domain>.up.railway.app`. **Required** —
  with `NODE_ENV=production` the API refuses to start without it rather than
  falling back to `http://localhost:5173`, which would block the deployed
  frontend while letting any local page call production (bug #15). Accepts a
  comma-separated list if the deployment serves more than one origin.
- `FRONTEND_URL` = the same frontend origin (GitHub App OAuth/setup redirects
  land there).
- `GITHUB_WEBHOOK_SECRET` = see the webhook section above.
- `REDIS_URL` = the Upstash TCP/TLS string. **Required**: with
  `NODE_ENV=production` the process now refuses to start when neither
  `REDIS_URL` nor `REDIS_HOST` is set, instead of falling back to
  `localhost:6379`. The fallback was the worst kind of misconfiguration to
  diagnose, because the queue client retries forever by design (Upstash drops
  idle sockets), so the service came up healthy, answered `/api/health`,
  accepted every enqueue, and ran nothing.
- `QUEUE_SUFFIX` = `-prod`. See the note under `worker` below.
- Do **not** set `PORT` — Railway provides it.

**`worker`** — the same `backend/.env` set minus `CORS_ORIGIN`,
`FRONTEND_URL`, and `GITHUB_WEBHOOK_SECRET` (it serves no HTTP). It DOES need
`GITHUB_APP_PRIVATE_KEY` (it downloads repo zipballs), and the same `REDIS_URL`
guard applies to it.

- `QUEUE_SUFFIX` = `-prod`, **exactly the value set on `api`**. The two
  processes resolve their queue names independently from their own
  environments, so a mismatch is not an error anywhere: `api` enqueues into
  `analysis-prod`, `worker` listens on `analysis`, and the job sits in
  `waiting` forever looking like a slow analysis. `-prod` rather than empty
  because the team's dev machines share one Upstash instance with the
  deployment: with no suffix, a teammate's local worker is a legitimate
  consumer of production jobs and will take them (and fail them, since it holds
  different GitHub credentials).

**`frontend`** — read at **container start**, not baked into the image (see
"Runtime configuration" below). Set exactly these three, and nothing else:

- `VITE_API_URL` = `https://<api-domain>.up.railway.app/api`
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` = same values as local.

Changing any of them takes effect on a **restart** — no rebuild. Nothing else
you put in this service's variables reaches the browser; the startup script
publishes those three names only.

> The API domain must exist before the frontend can be pointed at it, but not
> before it can be *built*. Deploy `api`, generate its domain, then set
> `VITE_API_URL` on `frontend` and restart it.

#### Frontend on Vercel (alternative to the Railway frontend container)

Vercel serves the built static bundle directly, so the nginx container is not
involved and neither is its runtime configuration. `api` and `worker` still
belong on Railway; only the `frontend` service is replaced.

| Vercel project setting | Value |
|---|---|
| Root Directory | the repo root (this is a workspace build, not a `frontend/` build) |
| Install Command | `npm install --workspaces --include-workspace-root` (already encoded in `/vercel.json`) |
| Build Command | `npm run build -w frontend` (already encoded in `/vercel.json`) |
| Output Directory | `frontend/dist` (already encoded in `/vercel.json`) |

Set the same three variables in **Settings > Environment Variables**:
`VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

The important difference from the Railway container: **these are build-time
values on Vercel.** Vite inlines `import.meta.env.VITE_*` into the JavaScript
during the build, and there is no container start to write a `/config.js` at
(see "Runtime configuration" below for what the nginx image does instead). So
changing any of the three means **redeploying**, not restarting, and the
`/config.js` smoke check from the Railway steps does not apply here. Deploy the
frontend only after the API domain exists, because the build bakes it in.

`/vercel.json` (repo root, where Vercel reads it when Root Directory is the
repo root) carries the install/build/output settings above plus what the nginx
config carried:

- **SPA rewrite.** Every path that is not `/assets/` or `/fonts/` falls back to
  `/index.html`, which is what lets `/auth/callback`, `/github/oauth/callback`
  and `/github/setup` be hard-loaded rather than only reached by client-side
  navigation. Vercel checks the filesystem before applying rewrites, so real
  files are still served as themselves; the two excluded directories are
  excluded so that a **missing** asset 404s instead of returning an HTML page
  with a 200, which is how a stale hashed chunk turns into a blank screen with
  no error.
- **Security headers**, mirroring `frontend/security-headers.conf.template`.
- **Cache-Control**: `no-cache` on `/index.html` and everything else unhashed,
  one year `immutable` on `/assets/`, one year (not `immutable`) on `/fonts/`,
  for the reasons written in `frontend/nginx.conf`.

One thing the deployer has to do by hand, because Vercel cannot derive it:

1. **Fill in the CSP `connect-src` origins.** The nginx entrypoint builds that
   directive from `VITE_API_URL` and `VITE_SUPABASE_URL` at container start;
   Vercel has no equivalent hook, so `/vercel.json` ships the placeholders
   `https://YOUR-API-DOMAIN`, `https://YOUR-SUPABASE-REF.supabase.co` and
   `wss://YOUR-SUPABASE-REF.supabase.co`. Replace all three with the real
   origins before the first deploy. Left as they are, the browser blocks every
   API and Supabase call and the app looks broken with only console errors to
   show for it.

Verify after deploying: `curl -sI https://<domain>/` must show the
`Content-Security-Policy` header. If it is absent, Vercel never read
`/vercel.json` (wrong Root Directory) and the app is running with no CSP at
all.

### 3. Point the external services at the deployment

| Where | What to change |
|---|---|
| Supabase → Authentication → URL Configuration | Site URL → frontend domain; add the two Railway Redirect URLs (see the Supabase section table) |
| GitHub **App** (repo import) | Either update Homepage/Callback/Setup URLs from `http://localhost:5173` to the frontend domain — or create a **second GitHub App for production** (recommended: keeps local dev working; each environment gets its own App ID/secrets/PEM) |
| GitHub App → Webhook | URL → `https://<api-domain>.up.railway.app/api/webhooks/github` (see webhook section) |
| GitHub **OAuth App** (login) | Nothing — its callback is the Supabase URL (`https://<ref>.supabase.co/auth/v1/callback`), which is environment-independent |

### 4. Smoke test

1. `https://<api-domain>.up.railway.app/api/health` → 200.
2. `https://<frontend-domain>.up.railway.app/config.js` → shows the three
   values the container booted with. This is the fastest way to tell a
   configuration problem from an application problem.
3. Open the frontend domain → sign in → import a repo → run an analysis
   (exercises Supabase, GitHub App, Upstash, and the worker in one pass).
4. Browser devtools → Network: API calls must go to the Railway API domain. If
   the page instead shows "OnboardBuddy is not configured", the named variable
   is missing or malformed on the frontend service — check the deploy logs for
   the `[onboardbuddy-config]` lines, fix the variable, restart.

---

## Runtime configuration (how the frontend learns its API origin)

Vite inlines `import.meta.env.VITE_*` into the JavaScript **at build time**, and
the production image is nginx serving that static bundle. Previously that meant
one image could only ever talk to one API origin — `localhost:3000` — which made
a hosted deploy impossible, because Railway's `*.up.railway.app` API hostname
only exists *after* the image does (issue #73). It is also why the CSP had to
name localhost explicitly.

Configuration is now read when the container starts:

| Piece | Where |
|---|---|
| Startup script | `frontend/docker-entrypoint.d/10-onboardbuddy-runtime-config.sh` |
| What it writes | `/usr/share/nginx/html/config.js` and `/etc/nginx/security-headers.conf` |
| CSP template | `frontend/security-headers.conf.template` |
| What the app reads | `frontend/src/lib/runtimeConfig.ts` |

The nginx image runs every executable `/docker-entrypoint.d/*.sh` before nginx
starts. The script reads `VITE_API_URL`, `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` from the environment and emits:

```js
window.__ONBOARDBUDDY_CONFIG__ = { apiUrl: "…", supabaseUrl: "…", supabaseAnonKey: "…" };
```

`index.html` loads that as a plain synchronous same-origin script *before* the
app module, so the values are present on the app's first line — no boot fetch,
no round trip to the API, no 404 to handle. nginx serves it `no-store`, so a
copy can never outlive the deployment that produced it.

Things worth knowing:

- **Only those three names are ever published.** The script uses an explicit
  allow-list, not an `env | grep ^VITE_` scan, so a secret that lands in the
  frontend service's variables cannot end up in a world-readable file. All three
  values are public by design anyway — the anon key is the RLS-gated publishable
  key and ships in every browser session.
- **`connect-src` is derived from the same values.** `'self'` + the API origin
  (dropped when `VITE_API_URL` is a same-origin path) + the Supabase origin and
  its `wss:` counterpart. That removed the hardcoded `http://localhost:3000` and
  *tightened* the policy: it now names one Supabase project instead of
  `https://*.supabase.co`.
- **Values are validated, and a bad one is not fatal.** Anything that isn't a
  plausible URL or key is logged (without echoing the value) and dropped. The
  app then renders a page naming the missing variable and where to set it,
  instead of a blank screen or a crash-looping container.
- **The image carries no baked origin.** `frontend/Dockerfile` deletes
  `frontend/.env` before `vite build`, so there is nothing to silently fall back
  to. You can verify: `docker run --rm --entrypoint sh <image> -c
  "grep -rl 'localhost:3000' /usr/share/nginx/html || echo clean"`.
- **Local `npm run dev` is unchanged.** With no `/config.js` global present the
  app falls back to `import.meta.env.VITE_*` from `frontend/.env`, exactly as
  before. The committed `frontend/public/config.js` is an empty placeholder that
  exists only so the dev server has a file to serve.

Local Docker Compose works the same way, from the same file the setup
instructions already ask for: `docker-compose.yml` passes `frontend/.env` to the
frontend service as `env_file`. Reviewer instructions are unchanged. One small
bonus — editing `frontend/.env` now takes effect with `docker compose up -d
frontend`, with no `--build`.

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
psql "$DIRECT_DATABASE_URL" -f backend/supabase/migrations/001_initial_schema.sql
```

### Nuclear reset

If you need to wipe everything and start fresh:

```bash
# Step 1: Drop all tables, functions, triggers, and extensions
psql "$DIRECT_DATABASE_URL" -f backend/supabase/migrations/000_drop_all.sql

# Step 2: Re-create everything
psql "$DIRECT_DATABASE_URL" -f backend/supabase/migrations/001_initial_schema.sql
```

Or paste each file into the SQL Editor in order.

### Auth trigger

The migration includes a `handle_new_user()` trigger on `auth.users`. When
Supabase Auth creates a new user (via email signup or GitHub OAuth), this trigger
automatically inserts a corresponding row into `public.users`. No manual user
creation is needed.

### Schema overview

The database has the following table groups (see
`backend/supabase/migrations/001_initial_schema.sql` for the full definitions):

- **Users & Auth:** `users`, `github_connections`, `github_installations`
- **Projects:** `projects` (identified by `user + repo`; branch is per-run), `project_members`, `project_invitations`, `project_settings`, `project_llm_keys`, `ranking_weight_configs`
- **Analysis:** `analysis_scopes`, `analysis_snapshots`, `snapshot_phases`, `analysis_jobs`
- **Code Evidence Graph:** `repository_files`, `graph_nodes`, `graph_edges`, `entrypoints`, `side_effects`
- **Workflows & Ranking:** `workflows`, `workflow_steps`, `criticality_scores`, `architecture_clusters` (+ `_members`, `_edges`)
- **Semantic Layer:** `semantic_records`, `snapshot_semantic_records`, `capabilities`, `capability_members`, `embeddings`
- **Onboarding Packages:** `onboarding_packages`, `ai_generation_runs`, `package_sections`, `tutorials`, `tutorial_steps`, `source_receipts`, `stale_flags`
- **Per-user Progress:** `user_progress` (resume onboarding/tutorial position)

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
5. Supabase creates a session for OnboardBuddy. The GitHub provider token from
   this login is not used for repository import.
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

1. The logged-in user connects GitHub from Account Settings. The frontend calls
   **`GET /api/github/oauth/start`** and redirects to the GitHub App user
   authorization URL.
2. GitHub redirects to **`/github/oauth/callback?code=...&state=...`**. The
   frontend calls **`POST /api/github/oauth/complete`**. The backend verifies
   state, exchanges the code with the GitHub App client ID/secret, and stores a
   GitHub App user access token plus refresh token in `github_connections`.
   Later installation-list requests refresh this token automatically when it is
   close to expiry.
3. The user opens the signed install URL returned by **`GET /api/github/app`**.
   The URL includes short-lived `state` tied to that OnboardBuddy user.
4. The user installs or configures the OnboardBuddy GitHub App. GitHub redirects
   to **`/github/setup?installation_id=...&state=...`**.
5. The frontend calls **`POST /api/github/installations/link`**. The backend
   verifies state and confirms the connected GitHub user can access that
   installation through GitHub's user-scoped installations endpoint before
   linking it.
6. The frontend calls **`GET /api/github/installations`**. The backend uses the
   stored GitHub App user access token and only returns installations owned by
   that connected GitHub account.
7. The user **selects a repository and branch** in the UI.
8. The frontend calls **`POST /api/projects`** to create a project record in the
   database (owner, repo name, branch).
9. The frontend calls **`POST /api/projects/:id/analyze`** to kick off analysis.
10. The backend API **enqueues an analysis job** on the BullMQ queue in Upstash
   Redis.
11. The backend worker **claims the job** from the queue.
12. The worker **downloads the repo archive** from GitHub using the GitHub App's
   installation token, then runs static analysis and (optionally) AI-powered
   explanation generation. Results are written back to the database.
