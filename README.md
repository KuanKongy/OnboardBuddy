# OnboardBuddy

**Team Name:** OnboardBuddies (Team 15)

**Project Name:** OnboardBuddy

**Team Members:**
- Dinh Nam Khanh Le
- Eugene Ng
- Sahib Rao
- Bradley Sakran

**Live app:** https://onboardbuddy-three.vercel.app | **Final release branch:** `FinalRelease` | Run it yourself: [Docker Instructions](#docker-instructions) | Test it: [doc/TESTPLAN.md](doc/TESTPLAN.md)

## Project Description

OnboardBuddy helps a developer get productive in an unfamiliar codebase. Point it at a GitHub
repository and it produces an **onboarding handbook** for that repository: what the system does, how
it is put together, the flows that matter, and what to do on day one, with every claim linked back
to the exact file and lines it came from, so nothing has to be taken on trust.

What makes it different from asking an AI to summarise a repo is the order of operations. The
structure is **extracted from the code first** (entry points, call flows, data model, dependencies,
what matters most), and AI is only used to explain structure that has already been verified.
Reference material is generated straight from code facts, and generated prose is checked against its
own citations before it ships. Teams that prefer no AI at all can turn it off and still get a
complete document.

Results are versioned per commit. Re-analysing after a push only re-does what actually changed and
marks the affected sections stale rather than silently rewriting them, so a team onboarding people
months apart is reading the same document, not two different ones.

## Goals

Original documents: [Proposal (M0)](doc/Team-15-proposal.pdf) and [Design (M1)](doc/Team-15-design.pdf)

**What we set out to build.** The M0 proposal defined OnboardBuddy as a codebase onboarding platform
that "generates and maintains a Codebase Onboarding Package for a repository". It is explicitly not
company, HR or culture onboarding; the focus is only on helping developers understand a specific
codebase faster. The committed product definition: extract repository structure deterministically,
identify important workflows, rank critical learning paths (the "Critical 25%"), and produce
role-specific onboarding documentation grounded in verified code references, with the LLM used only
as an explanation layer on top of already-extracted, validated structure. The MVP bar was the
pipeline working end to end:

> repo access → static analysis → workflow extraction → critical-path ranking → onboarding package
> generation → source validation → stale-section updates

The proposal listed 9 non-trivial requirements; the M1 design document regrouped them into the **5
non-trivial feature families** and **12 standard features** that every milestone since has tracked
(the mapping is §1.5 of the design document; final status of each is in
[Non-Trivial Features](#non-trivial-features) below).

**Where the final application landed.**

- **Met.** The pipeline runs end to end exactly as proposed: GitHub import → TypeScript Compiler API
  evidence extraction → call-graph workflow extraction → two-phase criticality ranking → a
  role-based, receipt-cited onboarding package → citation validation → incremental re-analysis with
  staleness. All 5 non-trivial families are complete, and all 12 standard features shipped,
  including the team-lifecycle items (invitation decline, leave project, ownership transfer)
  finished in M5.
- **Exceeded.** The trust layer went further than the design asked: every claim carries a clickable
  receipt pinned to the analysed commit, sections are re-checked against their own citations before
  they ship, confidence labels state their reason, and what could not be verified is listed instead
  of dropped. Two stretch goals shipped: a grounded **Ask** panel (AI chat over the package and its
  receipts) and **public deployment**. On top of that came things the design never promised: four
  interactive maps instead of "supporting reference graphs", a full XSS / prompt-injection
  assessment with a CSP and a hostile-repository CI harness, per-project spend budgets with a
  preflight cost preview, and 1,406 automated tests behind a one-command runner.
- **Deviated (shipped smaller, stated plainly).**

  | Original commitment | What shipped | Why |
  |---|---|---|
  | Package export as "Markdown or zip bundle" | Markdown export only | A zip containing one file adds nothing; multi-file export has no consumer |
  | Project archive (soft-delete) | Hard delete with type-to-confirm | A second lifecycle state was not worth the surface area |
  | Invitations "accept or decline", implicitly by email | Full in-app lifecycle (invite, accept, decline, leave, transfer ownership), but no email delivery | Needs a mail provider we never provisioned; the invite dialog says so and offers the share-a-link path |
  | One parsed language was never promised, but worth naming | TypeScript/JavaScript parsed to symbol level; 29 languages/formats read and classified, never call-graphed | Deliberate: ship one language analysed well rather than several analysed shallowly (see [What it can analyse](#what-it-can-analyse)) |

## Key Features

The core loop: import a repository, let the analysis run, then read. Everything you read can be
audited back to code. Every screenshot below is the live app analyzing **its own repository** (no
mocked data), and follows your light/dark preference.

### 1. The onboarding handbook

Twelve sections in four chapters: *Orient* (what this system is and its vocabulary), *Understand*
(subsystems, traced flows, the files that matter), *Do* (set up and run it, make your first change,
this repo's common tasks), *Consult* (lookup tables for routes, data model and operational
guardrails). Each section opens with a TL;DR; a "Suggested for you" rail keeps track of what to read
next; the Consult tables are generated deterministically from code facts, so routes and columns are
exact. The same analysis reads differently by role: a backend developer sees routes, services and
database writes first; a frontend developer sees pages, components and API clients; DevOps sees CI,
Docker and configuration; QA sees tests and critical flows. Owners approve content before it is
shared, each member tracks their own reading progress, and **Export** downloads the whole handbook
as Markdown.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/reader-dark.png">
  <img alt="The onboarding reader: chaptered sidebar, topology diagram, and receipt-backed prose" src="doc/screenshots/reader-light.png">
</picture>

### 2. Every claim is auditable: receipts, confidence, and Ask

The product's core promise is that every statement is backed by code, and the reader makes that
checkable rather than asserted. Citation chips sit at the claim they support; clicking one opens the
file, the line range, the code itself, and a **View on GitHub** link pinned to the analysed commit.
Each section shows how much of it is receipt-backed, why its confidence is what it is, and lists
what could not be verified as a known unknown instead of quietly dropping it. The **Ask** panel
answers free-form questions about the repository under the same rules: answers cite receipts, and
an unsupported answer is flagged rather than asserted.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/receipt-dark.png">
  <img alt="A receipt opened from a citation chip: file, line range, confidence, verification commit, and the code itself" src="doc/screenshots/receipt-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/ask-dark.png">
  <img alt="The Ask panel: a free-form question answered with numbered, clickable receipts, and gaps stated rather than guessed" src="doc/screenshots/ask-light.png">
</picture>

### 3. Four interactive maps

*Architecture* (subsystem clusters and how critical each is), *Dependencies* (searchable file and
class map), *Workflows* (traced flows and end-to-end product journeys), and *Capabilities* (what the
product does, linked to the code that delivers it). Every node opens its underlying evidence;
criticality scores explain themselves signal by signal rather than presenting a bare number.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/architecture-dark.png">
  <img alt="The architecture map: subsystem clusters with criticality and drill-down" src="doc/screenshots/architecture-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/workflows-dark.png">
  <img alt="The workflows map: 103 traced flows ranked by criticality, each step annotated and scored" src="doc/screenshots/workflows-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/dependencies-dark.png">
  <img alt="The dependencies map: directory groups with real import counts, drill-down to files and classes" src="doc/screenshots/dependencies-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/capabilities-dark.png">
  <img alt="The capabilities map: what the product does, derived from traced flows, with confidence labels" src="doc/screenshots/capabilities-light.png">
</picture>

### 4. Guided walkthroughs

Step-by-step traces through the flows that matter, each stop pairing real code with an explanation
and receipts that deep-link to the exact lines on GitHub. Walkthroughs are generated from traced
call graphs, so the steps are the path a request actually takes, not a narrative reconstruction.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/tutorials-dark.png">
  <img alt="A guided walkthrough: real code with the lines that matter highlighted, phases, and per-step explanations" src="doc/screenshots/tutorials-light.png">
</picture>

### 5. Analysis you can watch, budget, and keep fresh

A project holds many analyses at once (different branches, commits and sub-directories), and each
team member chooses which one they read, behind three permission tiers (owner, admin, developer).
Before spending anything, **Preview first** shows file counts, estimated AI calls and a cost tier;
during a run, a stage-labelled progress bar and live activity feed show exactly what is happening,
with pause/stop/resume; afterwards, **Run history** records every run's configuration, duration and
cost. Re-analysing a new commit only re-does what changed and marks affected sections stale instead
of rewriting them. With **Re-analyze on push** enabled, that happens automatically when the
repository changes (webhook delivery needs the deployed instance, since GitHub cannot reach
`localhost`; see [Final Release](#final-release-milestone-5)). Privacy is a first-class setting:
three modes including fully AI-disabled (which still produces a complete document from code facts),
per-project API keys, spend budgets with a stop switch, and AI routing restricted to providers that
do not retain data. A cold analysis of a 2.3M-token repository takes about 4–5 minutes and costs
about $0.35.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/screenshots/overview-dark.png">
  <img alt="Project overview: per-phase pipeline progress with timings, AI calls, cache hits and total spend" src="doc/screenshots/overview-light.png">
</picture>

## Non-Trivial Features

The five non-trivial feature families from the design document (§1.5), which are the M1 regrouping
of the proposal's nine non-trivial requirements. **All five were finished; none were dropped.**

| # | Feature (Design §1.5) | Final status | Final state |
|---|---|---|---|
| 1 | **Role-Based Onboarding Package + AST Parser** | **Completed** | GitHub App import, TypeScript Compiler API evidence extraction (symbols, calls, side effects, entrypoints, docs/config/schema), 12-section chaptered handbook with per-claim receipts, five roles generated on demand from one analysis |
| 2 | **Graph Visualizer, Architecture Map, Dependency Graph** | **Completed** | Four maps (Architecture, Dependencies + classes, Workflows, Capabilities), clustered and capped for readability, receipts on every node |
| 3 | **Generic Workflow Extraction + Walkthrough/Tutorial Generation** | **Completed** | Call-graph tracing from entrypoints (routes, UI actions, jobs, sockets, CLI, public API) to side effects; tutorials pair each step with real code, an explanation and receipts |
| 4 | **Critical 25% / Critical Path Identification** | **Completed** | Two-phase ranking: deterministic composite scoring gated, then LLM-blended multi-view scores; per-role projections with explainable reasons and user-editable weights |
| 5 | **Incremental Re-analysis** | **Completed** | File/symbol AST diff, evidence-hash invalidation (whitespace-only edits invalidate nothing), stale badges, per-section regeneration, plus automatic re-analysis on push via the GitHub webhook (deployed instance only; signed off in M5) |

The twelve standard features (Design §1.6: authentication, repository import + branch selection,
dashboard, project CRUD, invitations, permission tiers, role selector, settings, run status, export,
review controls, snapshot history) **all shipped**; the three that shipped smaller than their
specification wording are labelled in [Goals](#goals) above.

### Stretch goals

The proposal (§2.3) listed stretch goals; the team also took on deployment as a stretch beyond the
core Docker requirement. Final status of each:

| Stretch goal | Status |
|---|---|
| AI chat over the generated package and receipts | **Completed**: the **Ask** panel in the reader (grounded, receipt-cited, rate-limited) |
| Public deployment | **Completed (M5)**: frontend, API and worker deployed as three services at https://onboardbuddy-three.vercel.app |
| Local Ollama / self-hosted AI mode | **Dropped**: bring-your-own-key plus no-retention routing addresses the privacy motivation without a second AI backend |
| Multi-language support | **Dropped deliberately**: one language parsed well over several parsed shallowly; 29 languages/formats are still read, classified and counted honestly |
| PR-triggered onboarding update comments | **Partially superseded**: push-triggered re-analysis covers keeping the handbook fresh; posting PR comments was not built |
| Confluence/Notion export | **Not attempted**: Markdown export is the interchange format |
| VSCode extension | **Not attempted**: the web reader was the priority |
| External source integrations (PRs, tickets, Slack, design docs) | **Not attempted**: out of scope for the course timeline |

## Final Release (Milestone 5)

M5 added no new product surface beyond the plan set at the end of M4: close every open bug, finish
the deferred items, and deploy. What that came to:

1. **Public deployment.** The app is live at **https://onboardbuddy-three.vercel.app**, running the frontend, API and
   worker as three services. The M4 blocker (the frontend baking `localhost:3000` in at build time)
   was cleared by runtime configuration: one image reads its API origin, Supabase URL and
   Content-Security-Policy at container start, so the same build serves local Docker and the cloud.
   Setup is documented in [doc/DEVOPS.md](doc/DEVOPS.md).

2. **Push-triggered re-analysis, signed off.** M4 shipped the webhook endpoint but refused to claim
   it ("built, not signed off") because every trigger had been a replayed payload. M5 completed the
   GitHub App consent and verified real push deliveries end to end against the deployed instance:
   push → HMAC-verified delivery → incremental analysis → stale badges, with redeliveries
   deduplicated and superseded pushes skipped. **An honest caveat: this is the one feature that only
   works on the deployed site.** GitHub cannot deliver webhooks to `localhost`, so on a local
   install the endpoint simply answers 503 (off without a secret) unless you stand up a tunnel
   ([doc/DEVOPS.md](doc/DEVOPS.md), "Webhook URL — local development"). Everything else that works
   in production works identically in local Docker.

3. **Team lifecycle finished.** Invitations can be declined, members can leave a project, and owners
   can transfer ownership (`declined` is its own invitation status, not a revocation). Invitation email delivery is
   the one piece that stays Won't-Fix (no mail provider), and the invite dialog says so instead of
   pretending an email was sent.

4. **The loop closed on freshness.** A new opt-in Automation setting, **auto-regenerate stale
   sections** (`project_settings.auto_regenerate_stale`), rebuilds what a push staled, so a
   repository that changes overnight can have an up-to-date handbook by morning without anyone
   clicking. Off by default, because it is the only setting that spends AI budget unattended.

5. **The bug list went to zero.** All 26 bugs open at the end of M4 were resolved or explicitly
   closed with a reason, including repository-picker pagination for large accounts, the dark-theme
   contrast and accessibility items, and the API route-scoping security fixes. The final open bug
   (#56, a GitHub sign-up auth-provider error) closed on 2026-08-07 after live verification on the
   deployed instance. See [Bug list](#bug-list) below.

6. **Tests: 906 → 1,406** (980 backend + 426 frontend), still one command with a per-area summary
   (see [Testing](#testing)).

7. **Documentation for the final release.** This README was restructured around the final state of
   the app (Goals / Key Features / Non-Trivial Features replacing the per-milestone running record;
   the history lives in the `Milestone2`–`Milestone4` branches and in git). The test plan
   ([doc/TESTPLAN.md](doc/TESTPLAN.md)) was rewritten for the final release, and internal
   audit/planning scratch documents were removed from `doc/` so what remains explains the system:
   [Pipeline.md](doc/Pipeline.md), [BACKEND.md](doc/BACKEND.md), [FRONTEND.md](doc/FRONTEND.md),
   [DEVOPS.md](doc/DEVOPS.md), [IMPLEMENTATION.md](doc/IMPLEMENTATION.md),
   [TESTING.md](doc/TESTING.md), [TESTPLAN.md](doc/TESTPLAN.md), the security assessment, and the
   bug ledger.

**Dropped (decided at M4, unchanged):** project archive/soft-delete (hard delete covers the need),
zip export (Markdown covers the requirement), and local/self-hosted AI providers (see
[Stretch goals](#stretch-goals)).

**Known limits we ship with** (each is surfaced in the product rather than hidden): one parsed
language (TypeScript/JavaScript; everything else is read and cited but not call-graphed, and the
import preview says how much of a repository that leaves unparsed); AI narration is thin where
evidence is thin (structural descriptions always exist, and the UI labels which text is which); and
a repository with no traceable effects (a static content site, say) honestly produces no workflows,
so those tabs are legitimately empty for that shape of project.

### Bug list

**Every bug is closed: 85 GitHub issues filed across M2–M5, 0 open.** All P0/P1 bugs are resolved,
and no whole bug was closed Won't-Fix. The eight Won't-Fix items (W1–W8) are sub-items of otherwise
fixed bugs, each closed with a stated reason (invitation email delivery being the most visible).
The tracker is [GitHub Issues](../../issues?q=is%3Aissue); the underlying ledger with expected vs
actual, repro steps, fix notes and per-bug verification is
[doc/BUGS_AND_FIXES.md](doc/BUGS_AND_FIXES.md).

### Testing

[doc/TESTPLAN.md](doc/TESTPLAN.md) is the walkthrough for validating the release by hand: numbered
steps with the expected result at each one, on the deployed instance or a local install.
[doc/TESTING.md](doc/TESTING.md) explains what the 1,406 automated tests cover and why. One command
runs everything, no credentials needed:

```sh
docker compose -f docker-compose.test.yml run --rm test    # ends with a per-area pass/fail summary
```

## Docker Instructions

The app runs via **Docker Compose**. Three containers start together: frontend, backend API, and backend worker. No local Node, Postgres or Redis install is needed: Supabase, Upstash Redis, GitHub and OpenRouter are reached as cloud services using the credentials in the `.env` files. (Prefer not to run anything? The same build is live at https://onboardbuddy-three.vercel.app.)

1. Clone the repo and check out the `FinalRelease` branch.
2. Copy the three files submitted on Canvas into the repo:
   - `backend/.env`: API + worker configuration (Supabase, Postgres, Redis, GitHub App, OpenRouter keys)
   - `frontend/.env`: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `backend/github-app.pem`: GitHub App private key (mounted read-only into both backend containers)

   Both `.env` files must exist before you start: `docker-compose.yml` loads `backend/.env` into the API and worker, and `frontend/.env` into the frontend. All three containers read their configuration at **startup**, so editing a `.env` and re-running `docker compose up -d` is enough (no rebuild needed). If you only have the templates, `cp backend/.env.example backend/.env` and `cp frontend/.env.example frontend/.env` show every variable with comments.
3. From the repo root:

```sh
docker compose up --build
```

First build takes a few minutes. When it is up you should see `OnboardBuddy API listening on http://localhost:3000` from `backend-api`, and `[worker] listening on queue "analysis-…"` plus `[summary-worker] listening on queue "summary-…"` from `backend-worker`. (Upstash prints `IMPORTANT! Eviction policy is optimistic-volatile` on connect; that is a Redis-provider notice from BullMQ, not an error.)

4. Access the app:

| Service | Container | URL |
| ------- | --------- | --- |
| Frontend | `frontend` | http://localhost:5173 |
| Backend API | `backend-api` | http://localhost:3000/api |
| Health check | `backend-api` | http://localhost:3000/api/health |
| Backend worker | `backend-worker` | (no HTTP port) |

**Open http://localhost:5173.** Sign up (or use the demo credentials in the Canvas submission note), then Dashboard → **Import repository** to analyze a repo. Full walkthrough: [doc/TESTPLAN.md](doc/TESTPLAN.md).

To stop: `docker compose down`. To run more analysis workers in parallel: `docker compose up -d --scale backend-worker=3`.

Optional: set `GITHUB_WEBHOOK_SECRET` in `backend/.env` to enable the push webhook endpoint. Leaving it unset simply disables it (it answers 503); nothing else depends on it. Note that even with a secret set, GitHub cannot deliver webhooks to `localhost`, so push-triggered re-analysis is exercised on the deployed instance (or locally via a tunnel: [doc/DEVOPS.md](doc/DEVOPS.md), "GitHub App webhook").

### Running the automated tests

One command, no credentials and no running services needed:

```sh
docker compose -f docker-compose.test.yml run --rm test
```

Both suites run, then a **per-area summary** prints how many tests passed in each part of the system
(backend security / analysis pipeline / AI & caching / document generation / API / unit, frontend unit,
and e2e reported honestly as skipped because the image has no browser). Exit code is 0 only if every
area passed. Every number is parsed from the runners' own machine-readable output (see
[doc/TESTING.md](doc/TESTING.md)). How to test the final release by hand: [doc/TESTPLAN.md](doc/TESTPLAN.md).

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
| Repo Access | GitHub OAuth + GitHub App + Zipball archives + push webhook (HMAC) |
| AI | OpenRouter (ZDR-only routing); default `google/gemini-2.5-flash-lite`, auto-rotated per job |
| Embeddings | OpenAI `text-embedding-3-small` + pgvector |
| Infra | Docker, nginx (CSP + security headers), GitHub Actions |

## What it can analyse

**Code is TypeScript and JavaScript**: those are the two languages parsed all the way down into
symbols, call graphs and dependencies. Everything else a repository contains is still read, classified
and used as evidence; it just is not parsed into a call graph.

| | Formats | What we do with them |
|---|---|---|
| **Parsed into symbols** | TypeScript (`.ts`, `.tsx`), JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`) | Full analysis: symbols, signatures, imports/exports, call graph, entry points, side effects, ranking |
| **Documentation** | Markdown (`.md`, `.mdx`), reStructuredText (`.rst`), plain text (`.txt`), `LICENSE`, anything under `docs/` | Read as evidence, citable in the handbook, and compared against the code to flag documentation that has drifted |
| **Configuration** | JSON, YAML, TOML, XML, Dockerfile, Docker Compose, GitHub Actions workflows, `.env.example`, `tsconfig`, and the usual build/lint/test configs | Read as its own layer: this is where the dev, test and CI paths come from, and the environment-variable reference |
| **Data model** | SQL (including migrations), Prisma schemas, `schema.json` | Tables and their foreign-key relationships, used to build the data-model reference |
| **Scripts** | Shell (`.sh`, `.bash`, `.zsh`), PowerShell (`.ps1`) | Read as evidence for the operational commands a developer needs |
| **Recognised, not parsed** | Python, Go, Ruby, Java, Kotlin, C#, PHP, Rust, Swift, Scala, C, C++, Vue, Svelte, HTML, CSS/SCSS/LESS | Counted and reported. The cost preview tells you up front how much of the repository we cannot parse, rather than quietly analysing a fraction of it |
| **Assets** | Images, fonts, archives, media, PDFs | Inventoried and hashed for change detection; contents never read |

**What it finds, not just what it reads.** Parsing a file is only half the job; the other half is
recognising where a system's work actually happens. Entry points are detected across the shapes real
repositories take (HTTP routes, UI actions that reach an effect, socket and event handlers, queue
consumers, CLI commands, and a package's public API), and effects are counted whether they go through
an ORM, a document store, a client SDK, a cache, a queue, browser storage or the filesystem. This
matters because a study app whose features live in React components calling a database directly, or a
game whose protocol is socket events, has no HTTP surface to find: an analyser that only understands
request handlers reports such a repository as doing almost nothing.

In total the classifier knows **29 languages and formats across 42 file extensions**. The honest
summary: a mixed TypeScript repository is analysed properly end to end, a repository whose core logic
is in another language will produce a documentation-and-configuration-level handbook and say so.

Adding a second parsed language is a deliberate non-goal for this project: the parser sits behind an
interface so it is possible, but we would rather ship one language well.

## Running it against your own accounts

The Docker instructions above are all a reviewer needs (the `.env` files on Canvas point at our
cloud services). To stand the app up on your own accounts instead, you need a Supabase project, an
Upstash Redis endpoint, a GitHub App, and an OpenRouter key. Copy `backend/.env.example` and
`frontend/.env.example`, fill them in, and apply the schema once from
`backend/supabase/migrations/001_initial_schema.sql` (idempotent; `000_drop_all.sql` resets it).
The two M5 additions made under the database change policy (doc/DEVOPS.md) — the
`project_settings.auto_regenerate_stale` boolean and the `declined` invitation status — are
additive, M4-compatible (M4 filters to `pending`, so the new value is invisible to it), and folded
into `001_initial_schema.sql` now that every live database has them applied.

Full setup, deployment and operations notes (including worker scaling, connection pooling, the push
webhook, and cost/latency tuning) are in [doc/DEVOPS.md](doc/DEVOPS.md).
