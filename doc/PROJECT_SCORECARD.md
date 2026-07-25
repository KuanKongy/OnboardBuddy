# Project Scorecard — is the generated onboarding content *correct about what each repo is*?

**Date:** 2026-07-25 · **Scope:** all 11 projects owned by `user_id d843908a-1da6-4230-90ff-fc6c7d66293b`, org `KuanKongy`.
**Verdict up front:** the pipeline's *evidence layer* is sound (220/220 sampled receipts verify byte-for-byte against the analyzed commit, 0 dangling citations). Its *description layer* is not. Two projects are described as the wrong kind of software, and no project — 0 of 11, 0 of 132 sections — ever tells the reader in prose which files it did not read.

---

## Method

For each project I used the single latest `analysis_snapshots` row (every project has exactly one; NationalPokedex's is `status='paused'`, used anyway and flagged). All 11 have exactly 12 sections and one `onboarding_packages` row.

Ground truth: each repo was cloned and **checked out at the exact `commit_hash` the snapshot recorded**, so file existence, line ranges and snippet bytes are compared against what the analyzer actually saw — not against today's `HEAD`.

| Ground truth available | Notes |
|---|---|
| READMEs, 10 of 11 | `raw.githubusercontent.com` |
| CourseInsights README + tree | `raw.githubusercontent` 404s (repo is private) but `git clone` succeeded with cached credentials, so **GT was available after all** — CourseInsights is *not* scored `GT:none`. |
| Real file tree + all manifests, 11 of 11 | `git ls-files` at the analyzed commit |
| Real entrypoints, 11 of 11 | `grep` for `socket.on`, `@app.route`, `@router.*`, `router.<verb>`, `<Route path=`, GH Actions workflows |

Nothing was written to the database; every query was a `SELECT`.

**Two distinctions I hold throughout:**

- **Wrong** vs **silent.** "The `web` service holds the core application logic" is *wrong*. Never mentioning the 49 Python files is *silent*. Both harm the reader; only the first is a false statement.
- **Prose** vs **coverage strip.** D3 measures the 12 generated sections. The UI *does* disclose skipped files outside prose — `PreflightPreview.tsx:131-136` warns before analysis, and `OnboardingPage.tsx:1267-1270` renders "Analyzed *N* files (*M* unsupported skipped)" plus a `detectionUnknowns` chip list fed from `snapshot.unknowns`, which for FloowForge literally reads `unsupported_languages · python, css · 51`. Credit given. But a chip does not correct 28,000 characters of prose that describe a Next.js app as the whole system — and that `analyzed` number is itself wrong (see the D3 note below).

---

## Scorecard

Legend: `✓` PASS · `~` WEAK · `✗` FAIL · `·` N-A.
**Grade rule applied: no project grades above C if D1 or D3 is FAIL.**

| Repo | Sec | Files | Analyzed | D1 Identity | D2 Name | D3 Skip disclosure | D4 Capabilities | D5 Commands | D6 Entrypoints | D7 Filler | D8 Receipts | Grade |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **OnboardBuddy** | 12 | 268 | 222 (83%) | ✓ | ✓ 7× | ~ 0/2 | ~ 5/6 | ✓ | ✓ ~93/110 | ~ x6, 6.0× | ~ 20/20, 77% blank | **B** |
| **StudyFlow** | 12 | 186 | 102 (55%) | ✓ | ✓ 11× | ~ 0/3 +30 .tf | ✓ 4/5 | ✓ | ✓ 64/66 | ✗ x34, 28.3× | ~ 20/20, 64% blank | **B−** |
| **Skribbl** | 12 | 104 | 83 (80%) | ✓ | ✓ 5× | ~ 0/2 | ~ 4/5 | ~ | ✗ 1/12 | ~ x13, 16.3× | ~ 20/20, 64% blank | **C+** |
| **MasterPokedex** | 12 | 107 | 90 (84%) | ~ | ✓ 5× | ~ 0/3 | ~ 2/3 | ✓ | ✗ 0/6 | ~ x10, 18.9× | ✓ 20/20, 55% blank | **C+** |
| **kuankongy.github.io** | 12 | 124 | 70 (56%) | ✓ | ✓ 3× | ~ 0/2 | ✓ 3/3 | ✗ | ✗ 0 real, 2 junk | ~ x9, 16.2× | ~ 20/20, 63% blank | **C** |
| **CourseInsights** | 12 | 382 | 42 (11%) | ~ | ✓ 5× | ~ 0/3 | ✗ 3/5 | ~ | ~ 5/5 +2 junk | ~ x4, 11.2× | ✓ 20/20, 56% blank | **C** |
| **NationalPokedex** | 12 | 92 | 44 (48%) | ~ | ~ 4× / 2 var | ~ 0/5 | ~ 3/4 | ✗ | ✓ 71/71 | ✗ x65, 21.2× | ✓ 20/20, 43% blank | **C** |
| **Multiplayer-Tetris** | 12 | 52 | 32 (62%) | ~ | ~ 3× vs `tetris_mp` 5× | ~ 0/2 | ✓ 3/3 | ~ | ✗ 0 events | ~ x1, 16.7× | ✓ 20/20, 56% blank | **C** |
| **UBCPSS** | 12 | 40 | 25 (63%) | ✓ | ✓ 6× | ~ 0/2 | ✗ 0/2 | ✗ | ✓ 0 (correct) | ✗ x14, 39.9× | ~ 20/20, 64% blank | **C−** |
| **DeepRecall** | 12 | 46 | 19 (41%) | **✗** | ✓ 3× | ~ 0/4 | ✗ 0/3 | ~ | ✗ 0/5 | ~ x1, 16.6× | ~ 20/20, 67% blank | **D** |
| **FloowForge** | 12 | 167 | 65 (39%) | **✗** | **✗** "FlowForge" 4× | **✗ 0/51** | ~ 6/6 | ✗ | ✗ 0/~46 | ~ x2, 38.7× | ~ 20/20, 69% blank | **D−** |

Column notes — **Files** = `snapshot.file_count`; **Analyzed** = `language_inventory.supportedFileCount`, i.e. files actually parsed. **D2** = exact repo-name hits / near-miss variants. **D3** = prose mentions / undisclosed unsupported files. **D6** = matched/real. **D7** = max repeated normalised line × its count, then longest÷shortest section. **D8** = sampled receipts verified / share of all receipts with no `file_path`.

---

## Per project

### FloowForge — Grade D−

**What it is:** "A no-code AI workflow platform… rebuilt on a **server-side execution engine**." `web/` = Next.js 15 UI; `api/` = **FastAPI execution engine + REST API**; plus a Redis Streams worker and APScheduler cron.

**What the tool said:** "The system comprises a `web` service responsible for the user interface **and core application logic**. It interacts with external services including Supabase (Postgres + Auth), Redis, and OpenAI."

Exactly inverted. Across 12 sections `FastAPI`, `Python`, `uvicorn`, `APScheduler`, `Next.js` and `worker` appear **zero times each**. The 49 `.py` files — 29% of the repo, 51 of 116 code files — were never parsed and never mentioned, though `snapshot.unknowns` records `unsupported_languages · python, css · 51`. Wrong *and* silent.

**D2** — "FlowForge" ×3, "flowforge" ×1 against 4 correct spellings, twice in the `big_picture` TL;DR. **D6** — one `package_export` row for ~46 real entrypoints (30 FastAPI decorators, 14 Next pages, 2 `route.ts` handlers, webhook, cron); `routes_jobs` is 208 chars promising "the tables related to routes and jobs", then nothing. **D5** — prescribes `docker compose up`, but **FloowForge has no compose file** (only `Dockerfile.api`/`Dockerfile.worker`; the README never mentions Docker), and `cp web/.env.example .env` then `cp api/.env.example .env` clobbers the first. **D4** — 6/6 denylist-clean, but all six describe `web/`; none covers execution, queueing, scheduling or webhooks.

### DeepRecall — Grade D

**What it is:** "DeepRecall is a **Flask-based AI API** that turns videos into structured, searchable knowledge by transcribing, summarizing, and indexing content." One file, `app.py` (327 lines): Whisper, GPT-4, Sentence-Transformers, Redis, FFmpeg.

**What the tool said:** "This system provides a **frontend interface for interacting with AI models, handling theme customization and displaying notifications**. It is structured as a single `server` service, composed locally using Docker."

The `server` service is `compose.yaml` → `Dockerfile` → `CMD ["python", "app.py"]`. The tool named the right container, then described its contents as a theme switcher. `capabilities` confirms the substitution: "**Theme Management**… uses the `frontend/src/components/ThemeProvider.tsx` file", "UI State Management", "Local Development Environment" — **0 of 3** describe the product. `routes_jobs`: "describes the frontend state management for toast notifications and application theming… There are no routes or workflows described in the provided evidence." There are five: `POST /process_video`, `/search`, `/highlights`, `/common`, `GET /`.

Root cause: `unsupported: {python: 1}`. By file count 1 of 46 (2%), so D3 scores WEAK on the specified weighting — but that single skipped file **is the entire product**, and `frontend/` is a 14-file shadcn scaffold. **D5** WEAK not FAIL: `docker compose up --build` genuinely works, though the tool never mentions Python.

### UBCPSS — Grade C−

**What it is:** "The official website for **UBC Project STEM Search (PSS)**, a UBC AMS club that bridges the gap between classroom learning and hands-on undergraduate research." React 18 + Vite 5 + Tailwind on Vercel.

**What the tool said:** "a web application designed to showcase research projects and team members from UBC's Project STEM Search initiative… past events, current pillars of research, and the team." Correct, and it names the real sections. **D1 PASS.**

**D5 fabricates a prerequisite**: "This project requires **Docker** for container management and Node.js for development." UBCPSS contains **no Dockerfile, no compose file, no `.dockerignore`**. It then claims "There is no explicit command provided in the evidence to run the application" while the README documents five (`npm install`, `npm run dev`, `npx tsc --noEmit`, `npm run build`, `npm run preview`) — then contradicts itself one sentence later by printing `npm run dev`. **D4**: both capabilities — "Data Management and Structure", "UI Presentation" — are layer names, not things a visitor can do; nothing names the events timeline, team directory, FAQ or gallery. Denylist-clean, 0/2 by meaning. **D7** is the worst of the 11: `code_map` is 11,942 chars against a 299-char `routes_jobs` (39.9×), with "Called by: 1 file (dependents: 1)." ×14.

### NationalPokedex — Grade C

**Snapshot status: `paused`** — scored anyway, as instructed.

**What it is:** a CPSC 304 Oracle database project — "describing video game characters called Pokémon through their in-game statistics, types, moves, abilities, and evolution chains" — with `pokedexOracle.sql`, an Express + `oracledb` API and a Vite/React frontend.

**What the tool said:** "a data management and retrieval platform… exposes a RESTful API." Right domain (`Oracle` ×57). But the runtime is **inverted**: "The system is composed of a single service, `my-pokedex-app`. This service is responsible for handling API requests… **The `root` service serves the frontend UI.**" In fact root `server.js` is the Express+`oracledb` API (`PORT = 2424`, 65 routes, CORS'd to `localhost:5173`) and `my-pokedex-app/` is the Vite React frontend. Both halves backwards — but fenced in `[[unverified]]`, hence WEAK not FAIL.

**D6 is the best of the 11**: 71 claimed = 71 real (65 root + 6 nested). **D5 FAIL**: "There is no explicit command or sequence of commands provided in the evidence to run the application" while `my-pokedex-app/package.json` ships `dev`/`build`/`lint`/`preview` and the repo ships 9 `.sh` + 6 `.cmd` start/tunnel scripts, none modelled. **D7 FAIL**: `routes_jobs` is 15,355 chars emitting one table *per route*, so `| Method | Path | Handler | Workflow |` repeats **65 times** — 15% of the section is duplicated scaffolding.

### Multiplayer-Tetris — Grade C

**What it is:** "A clone of Tetris game designed using React, Node.js. Server is implemented using **Express.js, Socket.IO**. Highscore database uses **Firebase Firestore**."

**What the tool said:** "The `tetris_mp` system provides a real-time multiplayer Tetris experience." Category correct. But `Express` = 0 mentions, `socket.io` = 0, `Firestore` = 0, `Heroku` = 0 — the README's whole stack sentence survives only as `firebase` (×4). And `architecture_deep` gets the server exactly wrong: "**Server · Modules** — This cluster is **a frontend UI component on the server side**… **0 outgoing or incoming connections** to other clusters." Those 4 files (`main.js`, `session.js`, `client.js`, `firebase/firebase.js`) are the Socket.IO session broker; client↔server traffic is the entire product.

**D2 WEAK**: called `tetris_mp` ×5 (from `client/package.json`) vs 3 uses of the repo name. **D6 FAIL**: 2 `package_export` rows with null paths; no `event_listener` rows. **D5 WEAK**: both `npm start --prefix` commands are correct, but "We will use Docker to run the server" is fabricated (no Docker files), as is "create a file named `.env` in the `server` directory" (no `.env.example`), and the ports ("3000 client / 8080 server") are backwards. **D7**: `routes_jobs` claims routes are "grouped by their functional area, such as **authentication** and UI components" — grepping `auth` across `server/` and `client/src` returns only `author`.

### CourseInsights — Grade C

**GT note:** `raw.githubusercontent.com` 404s (private); `git clone` succeeded, so GT *was* available.

**What it is:** "A full-stack web application designed to help students easily search and filter **UBC history of courses** by year, course name, department, and instructor."

**What the tool said:** "This system… **ingests and processes datasets to enable complex querying**. It operates as a single server component within a containerized environment."

Not false — the `InsightFacade` abstraction described faithfully — but at the wrong altitude: `student` appears **0 times** in 12 sections, `UBC` once. A reader learns about dataset ingestion, never that this is a course-search tool. Runtime is partial too: "a single service, 'server'…", while the repo has 36 `frontend/` files and a React app served at `localhost:5173/CourseFinder/`.

**Analyzed coverage is the lowest of the 11 — 42 of 382 files (11%)**; 269 are `.json` fixtures counted evidence-only. **D4 FAIL** 3/5: "Continuous Integration and Deployment" ("Automates the process of building, testing, and deploying the system") and "Development Environment" are build infrastructure sold as product capability. **D5 WEAK**: "No environment files need to be created" contradicts the README's "Configuring your environment" section. **D6**: 5 of 5 Express routes matched exactly — the cleanest in the set — spoiled by 2 null-method, null-path rows.

### kuankongy.github.io — Grade C

**What it is:** "My portfolio… with an interactive 3D background you can step into and play… a nod to Tricky Towers: teris with physics." Vite 5 + React 18 + `three` + `rapier3d`, on GitHub Pages.

**What the tool said:** "a 3D portfolio application that showcases projects and experience, featuring interactive 3D elements and game-like mechanics." Accurate; `three.js` and WebGL named. **D1 and D4 both PASS** (3/3 genuine capabilities).

**D5 is the canonical failure, self-contradicting inside one paragraph:** "There are no specific commands for running the project in a development or production environment documented. The available scripts in `package.json` are: `dev`… `build`… `preview`… `lint`… `typecheck`." The README's Quick start is `npm install` / `npm run dev` plus a four-row script table. The tool had the scripts in hand, printed them, and still asserted nothing was documented.

**D6 FAIL by fabrication rather than omission.** A static Pages site: 0 HTTP routes, 0 React Router routes. The tool emitted **2 `http_route` rows with null method and null path**, and `code_map` explains why — `src/three/gameplay/InputController.ts` is "Manages game input events **for HTTP request handling and data writing**." It is a keyboard handler. **D7**: "Calls: none explicitly shown. Called by: GameEngine." ×9 (11% duplicated chars; 9,698 vs 599 = 16.2×).

### MasterPokedex — Grade C+

**What it is:** the README is nearly empty — "What technologies are used for this project? Vite, TypeScript, React, shadcn-ui, Tailwind CSS." The tree is a Vite SPA whose `src/api/*.ts` are `fetch` wrappers over `https://pokeapi.co/api/v2`.

**What the tool said:** "This system **organizes and serves frontend application assets and API routes**, allowing users to explore Pokémon and trainer data."

The trailing clause is right; the lead clause describes a build output, and "serves… API routes" is affirmatively wrong — `big_picture` elaborates "**API Routes:** This layer **exposes** API functions for interacting with data", but `pokemonApi.ts` sets `API_BASE_URL = 'https://pokeapi.co/api/v2'` and consumes a third-party API. `PokeAPI` appears **0 times**: the most important architectural fact — all data is external, there is no backend — is absent. `Vite` also scores 0. D1 WEAK: category right, runtime misstated.

**D6 FAIL 0/6**: `src/App.tsx` registers `/`, `/items`, `/map`, `/pokemon-filter`, `/pokemon/:id`, `/trainer` plus a `*` catch-all; the `entrypoints` table is **empty**, and `routes_jobs` promises "the various routes and their functionalities" then offers one note: "The `toast` functionality is related to managing in-app notifications." **D5 PASS** — a rare case where the tool beats its README, supplying `npm run dev` and `npm install` where the README documents nothing. **D7**: "Open the `src/api/trainerApi.ts` file." ×10 in `common_tasks`.

### Skribbl — Grade C+

**What it is:** "A real-time multiplayer draw-and-guess game (a skribbl.io clone)… Built with React + Vite on the front, **Express + Socket.IO** on the back."

**What the tool said:** "a real-time Pictionary-style drawing and guessing game… through a **WebSocket server** managing game states and client interactions, and a web client." **D1 PASS** — the best identity match in the set. `socket.io`, `websocket` and `express` all appear, and "Real-time Game Communication — Manages live interactions between players and the game server using WebSockets" is right.

**D6 is the flagship systemic failure. `server/index.js` and `server/src/handlers.js` register 11 inbound `socket.on` handlers** — `create-room`, `join-room`, `start-game`, `word-selected`, `draw-ops`, `undo`, `clear-canvas`, `chat-message`, `sync`, `leave-room`, `disconnect` — plus one HTTP route; ~9 outbound events complete a ~20-event protocol. The `entrypoints` table contains **exactly one row: `GET /health`**, and `routes_jobs` is a single-row table for it: "Handles HTTP GET requests for server health checks." **1/12 inbound = 8%.**

**D5 WEAK**: `cp .env.example .env` is correct, but `npm run dev` is labelled "Start the server" when root `dev` is `vite` — the client; the README's `cd server && npm run dev` is missing; and `npm run test` is prescribed at root where **no `test` script exists** (it lives in `server/package.json`, which the section cites). **D4** 4/5.

### StudyFlow — Grade B−

**What it is:** "an intelligent study assistant platform… using a combination of a React frontend, API server, Redis queue/cache, and worker server integration with AI APIs", plus MongoDB.

**What the tool said:** "a web application designed to help users organize and engage with their study materials… supports individual learning and collaborative study groups by facilitating note-taking, topic organization, and AI-powered content generation." Then: "The StudyFlow system comprises a `mongo` database and a `redis` cache… An `api` service… The `worker` service… handles asynchronous tasks such as AI content generation… The frontend application, served by a Vite/React/TypeScript setup." **D1 PASS** — every component named, matching the README's architecture list one-for-one. **D4** 4/5, **D6** 42/42 API routes and 22 of 24 React routes, **D5** correct.

**D7 FAIL**: `code_map` repeats "Calls: none specified." **34 times** — 13.8% of the section's characters — and `code_map` (9,269) is 28.3× `data_model` (327). 50% generic sentences. **D3 note**: the 30 Terraform files (`.tf`, the second-largest file type after `.tsx`) are **not counted as unsupported at all** — `unsupportedFileCount` is 3 (css/html only); the `.tf` files land in `evidenceOnly.other`. "Terraform" appears in prose only as CI job names, never as infrastructure nobody read. The disclosure mechanism under-reports the gap rather than reporting it.

### OnboardBuddy — Grade B

**What it is:** "a codebase onboarding platform that helps developers understand unfamiliar codebases faster… The core is a **deterministic analysis pipeline**: the TypeScript Compiler API parses source code… An LLM is used only as an optional layer."

**What the tool said:** "OnboardBuddy is a system designed to assist new developers in understanding a codebase. It analyzes source code, extracts key information about workflows, architecture, and capabilities… The system comprises three primary services: **backend-api**… **backend-worker**… " **D1 PASS** — category and all three compose services correct. **D5 PASS**. **D6** ≈93 claimed (69 http + 22 ui + 2 worker_job) against ≈87 backend route registrations and 23 React routes: the strongest coverage in the set, and the only project emitting `worker_job` rows.

**D4** 5/6 — "Configuration and Settings" is borderline. **D8** has the **highest blank-receipt rate in the set: 2,406 of 3,141 receipts (77%) carry no `file_path`**, all `record_reference`, and only 20 link to a section. **D7**: "This is noted as a boundary." ×6 (10.9% duplicated); 53% generic sentences; the length spread is the *tightest* of the 11 at 6.0×. **D3**: only 2 css/html files skipped, but still 0 prose mentions — the tool does not disclose gaps even when analysing itself.

---

## Systemic vs project-specific

### Systemic (≥5 projects)

1. **Zero skipped-file disclosure in prose — 11/11.** Fifteen phrasings (`skip`, `not analyzed`, `not parsed`, `unsupported`, `excluded`, `out of scope`, `no parser`, `known gap`, `did not read`, `only TypeScript`, …) return **0 hits across 132 sections**. The information exists in `snapshot.unknowns` on every project. It never reaches the narrative. Worst case FloowForge (49 Python files); mildest case 1–5 css/html files.
2. **`event_listener` has never been produced — 11/11.** The 245 entrypoint rows across all projects are `http_route` (192), `ui_route` (44), `package_export` (7), `worker_job` (2). No `event_listener`, no `cron`, no `webhook`, no `cli`. Any product whose interface is a socket protocol (Skribbl's ~20-event protocol, Multiplayer-Tetris) or a scheduler (FloowForge APScheduler) is structurally invisible.
3. **Majority of receipts are unclickable — 11/11.** 43%–77% of every project's receipts have no `file_path`, and in every project 100% of those are `receipt_kind='record_reference'`. Median 63%. FloowForge 69% confirms the earlier measurement; OnboardBuddy is worst at 77%.
4. **`package_export` and blank-path entrypoint rows as filler — 5/11.** FloowForge, Multiplayer-Tetris (×2), UBCPSS, kuankongy.github.io (×2 `http_route`) and CourseInsights (×2 `http_route`) all emit rows with null method and null path. On kuankongy.github.io both `http_route` rows are pure fabrication — the repo is a static Pages site.
5. **Repeated filler lines in `code_map` — 6/11.** StudyFlow ×34, UBCPSS ×14, Multiplayer-Tetris ×11 (sentence-level), MasterPokedex ×10, kuankongy.github.io ×9, Skribbl ×13 (sentence-level). Always the same shape: "Calls: none specified." / "Called by: 1 file (dependents: 1)."
6. **`setup_run` denies commands it can see — 5/11.** kuankongy.github.io, NationalPokedex and UBCPSS all assert no run command is documented; kuankongy.github.io and UBCPSS then print one in the next sentence. CourseInsights and Skribbl omit half the documented path. Root cause looks like `setup_run` reasoning from the *root* manifest only — and the four projects with no root `package.json` (FloowForge, StudyFlow, DeepRecall, Multiplayer-Tetris) plus the two with nested manifests (NationalPokedex, CourseInsights) are exactly where this lands.
7. **~Half of all prose carries no repo-specific token — 11/11.** Range 40% (NationalPokedex) to 57% (Multiplayer-Tetris), median 52%. No file path, no symbol, no repo name.
8. **Large section-length imbalance — 9/11.** Longest÷shortest ≥ 15× on nine projects; UBCPSS 39.9×, FloowForge 38.7×, StudyFlow 28.3×. `code_map` is almost always the longest and `routes_jobs` or `data_model` the shortest.
9. **Coverage strip overstates what was read — 11/11.** `backend/src/api/routes/onboarding.ts:657` sets `coverage.files.analyzed = snapMeta.file_count`, but `file_count = supported + unsupported + evidenceOnly`. So the UI renders "Analyzed 167 files (51 unsupported skipped)" for FloowForge when only 65 were parsed — a number that both contradicts itself and overstates true coverage by 2.6×. CourseInsights reads "Analyzed 382 files (3 unsupported skipped)" against 42 parsed: **9× overstatement**.

### Project-specific

- **Wrong product identity (2/11):** FloowForge (FastAPI engine → "web service… core application logic") and DeepRecall (Flask/Whisper API → "frontend interface… theme customization"). Both share a mechanism — the product's real runtime is in an unparsed language, and the tool describes the TypeScript scaffolding it *could* read as though it were the system.
- **Name corruption (1/11):** only FloowForge → "FlowForge".
- **Build infrastructure sold as product capability (2/11):** CourseInsights ("Continuous Integration and Deployment", "Development Environment") and DeepRecall ("Local Development Environment"). A softer variant — layer names instead of user-facing capabilities — hits UBCPSS (0/2 by meaning) and MasterPokedex and Skribbl (1 each).
- **Fabricated prerequisites (3/11):** UBCPSS and Multiplayer-Tetris are told to install Docker; neither repo contains a single Docker file. FloowForge is told to run `docker compose up`; it has no compose file.
- **Inverted service roles (2/11):** NationalPokedex (API and frontend swapped, but honestly `[[unverified]]`-fenced) and Multiplayer-Tetris ("Server · Modules… is a frontend UI component on the server side… 0 connections").
- **Fabricated domain claim (1/11):** Multiplayer-Tetris `routes_jobs` groups routes "by functional area, such as **authentication** and UI components" — the repo contains no authentication of any kind.
- **Terraform invisible to the language inventory (1/11):** StudyFlow's 30 `.tf` files are classified `evidenceOnly.other`, so they are not even eligible for the unsupported-language disclosure.
- **Not systemic, and worth saying plainly:** receipt *bytes* are trustworthy. Across 220 sampled receipts (20 per project, deterministic sample from the pool that has both a `file_path` and a `snippet`), **220 of 220 files existed at the analyzed commit, 0 line ranges were out of bounds, and 220 of 220 snippets matched the real bytes** whitespace-normalised. 6 of the 220 carried no line numbers at all (`config_snippet` receipts on DeepRecall, FloowForge, Skribbl ×3, UBCPSS) — their snippet text was still found verbatim in the named file. Separately, **0 of the 413 distinct inline `[[receipt:<uuid>]]` citations (993 occurrences) were dangling**; every one resolves to a real `source_receipts` row on the same snapshot. Where the pipeline points at code, it points correctly. The failures above are all in what it *says about* that code, and in what it declines to mention at all.

---

## Per-tab assessment

D1–D8 above score the generated **package** (the 12-section reader). But the same snapshot feeds five other surfaces, and they fail independently. Below, each project × tab gets one verdict:

- **EMPTY** — the tab renders nothing, or nothing about the product.
- **WRONG** — it renders a statement a reader would act on that is false.
- **THIN** — true, but too little or too generic to be worth opening.
- **USEFUL** — a new developer is better off for having read it.

Every number is a row count from the latest snapshot, cross-checked against the repo at the recorded `commit_hash`.

| Repo | Architecture | Dependencies | Workflows | Capabilities | Tutorials | Package (D1–D8) |
|---|---|---|---|---|---|---|
| **OnboardBuddy** | USEFUL 14c/50e | USEFUL 1884n/4175e | USEFUL 76 | USEFUL 6 | THIN 4 of 76 | B |
| **StudyFlow** | THIN 8c/11e, 4 isolated | USEFUL 838n/2081e | USEFUL 50 | USEFUL 5 | THIN 4 of 50 | B− |
| **NationalPokedex** | WRONG 6c/7e | USEFUL 398n/748e | USEFUL 71 = 71 real | USEFUL 4 | THIN 4 of 71 | C |
| **CourseInsights** | THIN 6c/11e | USEFUL 298n/512e | USEFUL 8 | THIN 5, 2 are build infra | USEFUL 4, 54 steps | C |
| **Skribbl** | WRONG 8c/16e | THIN 652n, 285 are vars | THIN 1, and it is `ci.yml` | USEFUL 5 | THIN 1 = CI | C+ |
| **kuankongy.github.io** | USEFUL 5c/15e | USEFUL 454n/787e | WRONG 2 of 4 fabricated | USEFUL 3 | WRONG 1 of 4 fabricated | C |
| **MasterPokedex** | THIN 6c/10e | THIN 584n, 263 are vars | **EMPTY 0** | USEFUL 3 | **EMPTY 0** | C+ |
| **Multiplayer-Tetris** | WRONG 5c/6e | THIN 168n/238e | **EMPTY 0** | USEFUL 3 | **EMPTY 0** | C |
| **UBCPSS** | THIN 4c/3e | THIN 241n, 59% non-code | EMPTY 0 *(correctly)* | THIN 2 layer names | EMPTY 0 | C− |
| **FloowForge** | WRONG 9c/19e | THIN 460n, 0 Python | THIN 1, and it is `ci.yml` | THIN 6, all `web/` | THIN 1 = CI | D− |
| **DeepRecall** | WRONG 5c/7e | THIN 129n, 35% non-code | THIN 1 = compose up | WRONG 0 of 3 real | THIN 1 = compose up | D |

`c` = clusters, `e` = edges, `n` = nodes. Tab totals: 76 clusters, 155 architecture edges, 6,106 graph nodes, 12,346 graph edges, 213 workflows, 1,504 workflow steps, 245 entrypoints, 45 capabilities, 24 tutorials, 189 tutorial steps.

**One defect is universal and is not reflected in the Architecture column, because it would collapse all 11 rows to WRONG:** every project renders at least one cluster summary claiming **"0 files."** over a cluster that has members. See failure F2.

### Architecture tab

**"Configuration & Deployment: 0 files." appears on 11 of 11 projects**, and `Database Schema: 0 files.` on three more. Thirteen clusters total, and **all 13 reach the UI raw** — none has a semantic module record to mask it (`graph.ts:254` falls back to `deterministic_summary` only when the record is missing; 31 of 76 clusters project-wide fall back this way).

| Repo | Cluster | Members | Summary shown | Sample members |
|---|---|---|---|---|
| StudyFlow | Configuration & Deployment | **21** | "0 files." | 5 `.github/workflows/*.yml`, `api/Dockerfile` |
| CourseInsights | Configuration & Deployment | **17** | "0 files." | `compose.yaml`, `Dockerfile`, 2 workflow files |
| FloowForge | Configuration & Deployment | **14** | "0 files." | `Dockerfile.api`, `Dockerfile.worker`, `ci.yml` |
| DeepRecall | Configuration & Deployment | **11** | "0 files." | `compose.yaml`, `Dockerfile`, `.env.sample` |
| Skribbl | Configuration & Deployment | 10 | "0 files." | `.env.example`, `server/Procfile`, `deploy.yml` |
| NationalPokedex | Configuration & Deployment | 9 | "0 files." | `my-pokedex-app/pokedexOracle.sql`, 5 tsconfigs |
| NationalPokedex | **Database Schema** | **48** | "0 files." | `pokedexOracle.sql` ×2 |
| OnboardBuddy | **Database Schema** | **37** | "0 files." | `backend/supabase/migrations/001_initial_schema.sql` |
| FloowForge | Database Schema | 9 | "0 files." | `supabase/migrations/0001_init.sql` |
| MasterPokedex / Multiplayer-Tetris / UBCPSS / kuankongy | Configuration & Deployment | 6 / 3 / 4 / 4 | "0 files." | manifests, tsconfigs, `vercel.json` |
| OnboardBuddy | Configuration & Deployment | 23 | "**1 file**, 3 symbols." | same bug, understated rather than zeroed |

NationalPokedex is the sharpest case: a CPSC 304 Oracle project whose entire point is the schema gets `Database Schema: 0 files.` over 48 schema nodes.

**Cluster `kind` misclassification is total, not occasional. All 16 clusters labelled `* Modules` — across all 11 projects — are typed `frontend_ui`.** `Modules` is the leftover bucket, and its kind comes from repo-wide framework sniffing rather than from the files in it. Five of the 16 hold server-side code:

| Repo | Cluster | Real contents | Prose shown |
|---|---|---|---|
| Skribbl | `Server · Modules` | `server/index.js`, `src/handlers.js`, `GameRoom.js`, `roomManager.js`, `validate.js`, `words.js`, `config.js` — the whole Express+Socket.IO server | "Serve as the main entry point and integration layer for the server-side application." — **correct prose, wrong badge** |
| NationalPokedex | `Modules` | `server.js`, `appService.js`, `appController.js`, `public/scripts.js` — the Express + `oracledb` API | "**Frontend UI module** for My Pokedex App." — the badge leaked into the sentence |
| Multiplayer-Tetris | `Server · Modules` | `server/main.js`, `session.js`, `client.js`, `firebase/firebase.js` | no semantic record → "4 files, 28 symbols"; the package prose calls it "a frontend UI component on the server side" |
| OnboardBuddy | `Backend · Modules` | `backend/src/qa/askService.ts`, `backend/src/retrieval/retrievalService.ts` | "Backend module for handling retrieval and question answering." — correct prose, wrong badge |
| CourseInsights | `Modules` | `src/App.ts`, `src/datasetProcessor/*` — the InsightFacade core | "Orchestrates the processing of datasets and queries." — correct prose, wrong badge |

So the misclassification leaks into prose on 2 of 5 and stays a silent badge error on 3. The badge is not cosmetic: it drives cluster colour and grouping via `CLUSTER_KIND_PALETTE` / `CLUSTER_KIND_LABELS`.

The remaining 11 `Modules` clusters are honest but near-worthless: MasterPokedex's is `eslint.config.js`, `postcss.config.js`, `App.tsx`, `main.tsx`, `tailwind.config.ts`, `vite.config.ts` — build scaffolding presented as an architectural component. OnboardBuddy's unscoped `Modules` cluster is **one file, `eslint.config.mjs`**.

**17 of 76 clusters have degree 0** — no inbound or outbound architecture edge. `Configuration & Deployment` is isolated on 11 of 11. StudyFlow is worst at **4 of 8 isolated, including `Api · API Routes` and `Worker · Workers`** — the two clusters the package's own D1 narrative names as central are drawn as disconnected islands.

Where it is right: OnboardBuddy's 14 clusters / 50 edges cleanly separate `Backend · API Routes`, `Backend · Workers`, `Frontend · UI`, `Frontend · State`, with summaries that name real tables ("touches tables analysis_snapshots, workflows, workflow_steps"). kuankongy.github.io's `Modules` → "3D Rendering and Game Logic Management" is a good compression of 41 files.

### Dependencies tab

**All 11 projects exceed `MAX_GRAPH_NODES = 60`** (smallest graph is DeepRecall at 129 nodes), so **11 of 11 render the directory-clustered view by default** — and that view hardcodes `dependentCount: 0` (`backend/src/api/routes/graph.ts:73`):

```ts
metadata: {
  exportedSymbols: [] as string[],
  importCount: info.importCount,   // accumulated at line 58
  dependentCount: 0,               // never accumulated
  fileCount: info.count,
```

The bucket built at line 51 is only `{ count, importCount, keys }` — there is no `dependentCount` accumulator at all, while the two non-clustered paths (lines 152, 323) do read the real per-node value. `frontend/src/components/graph/ModuleNode.tsx:77` renders it as "**0 imported by**". So on every project, every directory group in the default view claims nothing depends on it, while the graph simultaneously draws the inbound edges. `frontend/src/pages/ArchitecturePage.tsx:110` hardcodes the same field.

Node composition determines whether the tab is worth opening:

| Repo | Nodes | Edges | doc/external/config | `variable` nodes | Real code nodes |
|---|---|---|---|---|---|
| UBCPSS | 241 | 163 | **143 (59%)** | 27 | 67 |
| DeepRecall | 129 | 169 | 45 (35%) | 34 | 40 |
| FloowForge | 460 | 808 | 129 (28%) | 68 | 217 |
| MasterPokedex | 584 | 1389 | 65 (11%) | **263 (45%)** | 228 |
| Skribbl | 652 | 1173 | 83 (13%) | **285 (44%)** | 253 |
| StudyFlow | 838 | 2081 | 146 (17%) | 292 | 370 |
| OnboardBuddy | 1884 | 4175 | 317 (17%) | 338 | 1147 |

UBCPSS is the degenerate case: 128 of its 241 nodes are `doc` nodes (README headings), and the entire graph contains **3 `calls` edges**. A dependency graph with three call edges is a picture of a README. MasterPokedex and Skribbl are diluted differently — nearly half their nodes are `variable`, so the graph is dominated by consts rather than modules.

Where it is right: NationalPokedex's graph carries 71 `handles_route` and 74 `touches_schema` edges, and OnboardBuddy's carries 318 `touches_schema` and 154 `tests` edges. When the language is fully supported and the code is real, the edge typing is genuinely informative.

### Workflows tab

Counts run **0, 0, 0, 1, 1, 1, 4, 8, 50, 71, 76**. Three projects render an empty tab; three more render a tab whose only content is infrastructure.

| Repo | Workflows | What they actually are | Ground truth in repo |
|---|---|---|---|
| MasterPokedex | **0** | — | 7 `<Route path=` in `src/App.tsx`, 8 page components in `src/pages/` |
| Multiplayer-Tetris | **0** | — | Socket.IO session broker, `server/main.js` |
| UBCPSS | **0** | — | no routes, no CI, no compose — **0 is correct** |
| DeepRecall | 1 | `Local dev: docker compose up` (2 steps) | 5 Flask routes in `app.py` |
| FloowForge | 1 | `CI: on push, pull_request` (3 steps) | 30 FastAPI decorators, a Redis Streams worker, APScheduler cron |
| Skribbl | 1 | `CI: on push, workflow_dispatch` (4 steps) | **20 distinct `socket.on` events** + 1 HTTP route |
| kuankongy.github.io | 4 | 1 CI, 1 real export, **2 fabricated `HTTP handler`** | static GitHub Pages site — 0 HTTP anything |
| CourseInsights | 8 | 5 HTTP + 2 CI + 1 dev | 5 Express routes |
| StudyFlow | 50 | 17 UI page, 25 HTTP, 5 CI, 1 dev, 2 export | matches |
| NationalPokedex | 71 | 26 GET + 45 POST | 73 Express route registrations |
| OnboardBuddy | 76 | 25 GET, 15 POST, 15 UI page, 4 journey, 2 consumer, 1 CI | matches |

FloowForge is the emblem: **a no-code workflow-execution platform whose Workflows tab contains exactly one workflow, and it is the project's GitHub Actions file.** Skribbl is the same shape — a real-time game with a ~20-event protocol whose only "workflow" is its deploy pipeline.

**`event_listener` has never been produced, and the reason is now precise.** The detector kind exists (`entrypointDetector.ts:140-156`) but requires the file path to match `/worker|listener|consumer|jobs?\//i` **and** the symbol name to match `/^(process|handle|consume|on[A-Z])/`. Skribbl's `server/src/handlers.js` fails the path test ("handlers" matches neither `listener` nor `consumer`). More fundamentally: **no `socket.on`, `addEventListener`, or `EventEmitter` detection exists anywhere in the analyzer.** Separately, `cron_job` is declared in the detector union (line 8) and mapped to a trigger type (line 215) but **no branch ever emits it**, and `webhook` is not in the DB enum at all.

**Step text is mostly untouched template.** `workflow_steps.explanation` is populated only for steps a tutorial happens to cover (`summaryWorker.ts:278-286`):

| Repo | Steps | With explanation | Dominant template |
|---|---|---|---|
| OnboardBuddy | 635 | **37 (6%)** | "Touches database table X" ×137 |
| NationalPokedex | 356 | **25 (7%)** | "Touches database table X" ×72 |
| StudyFlow | 419 | **49 (12%)** | "Checks authentication/authorization in useAuth (...)" ×16 |
| CourseInsights | 67 | 54 (81%) | — |

So the three projects with the richest Workflows tabs are the three whose step text is 88–94% deterministic strings. Purposes are templated too: "Handles GET /region-byspawnrate: reads data, responds to the caller".

### Capabilities tab

The best-behaved tab. Every project produces 2–6, all denylist-clean, and several are genuinely good: Multiplayer-Tetris's three ("Game Control and Initialization", "Tetris Game Rendering and UI", "Tetris Game State Management") describe the product accurately even though its Workflows and Tutorials tabs are empty and its architecture is inverted. Skribbl's "Real-time Game Communication — Manages live interactions between players and the game server using WebSockets" is the only place in the entire product where Skribbl's socket protocol is acknowledged at all.

Two failure shapes recur, both **precision** failures rather than accuracy failures:

- **Build infrastructure sold as product capability** — CourseInsights "Continuous Integration and Deployment", "Development Environment"; DeepRecall "Local Development Environment"; StudyFlow "System Information and Utilities".
- **Layer names instead of user-facing verbs** — UBCPSS "Data Management and Structure" / "UI Presentation" (2 of 2); MasterPokedex "Core Utilities and UI Components"; FloowForge "Application Presentation and Layout"; CourseInsights "Utility Endpoints".

DeepRecall is the one WRONG cell: "Frontend UI and State Management", "Local Development Environment", "Notification System" — **0 of 3 describe a video-transcription API**.

### Tutorials tab

`DEFAULT_MAX_TUTORIALS = 4` (`tutorialGenerator.ts:19`) and the only caller never overrides it (`summaryWorker.ts:271-274`). So **tutorial count is `min(4, workflows)` and tracks nothing about project complexity**:

| Repo | Files | Workflows | Tutorials | Coverage |
|---|---|---|---|---|
| OnboardBuddy | 268 | 76 | 4 | 5% |
| NationalPokedex | 92 | 71 | 4 | 6% |
| StudyFlow | 186 | 50 | 4 | 8% |
| kuankongy.github.io | 124 | 4 | 4 | 100% |
| CourseInsights | 382 | 8 | 4 | 50% |
| MasterPokedex / Multiplayer-Tetris / UBCPSS | 107 / 52 / 40 | 0 | **0** | — |

A 268-file platform and a static portfolio site both get exactly four.

**The steps themselves are not padding.** Explanations average 176–292 characters, and spot-checking the text confirms it is specific: "The `createWizard` function constructs the 3D model for a Wizard. It initializes a `THREE.Group` and adds various components like a robe, head, and hat. This function is called by `createCharacter`." Every one of the 189 tutorial steps carries at least one receipt id. Where a real workflow was traced, the tutorial written on top of it is the highest-quality prose the product generates.

The failure is in *what gets traced*, which the tutorial layer inherits wholesale:

- **kuankongy.github.io: "Trace InputController.clearRepeat HTTP flow"** — a two-step tutorial whose first line reads "**The HTTP request first hits the InputController.clearRepeat function.**" It is a keyboard repeat-timer cleanup on a static site. The LLM faithfully narrated a false premise handed to it by the entrypoint detector.
- **Skribbl and FloowForge**: the single tutorial is a walkthrough of the CI file. Accurate, well written, and about the wrong thing.
- **NationalPokedex**: 7 of 25 steps have no `snippet`.
- All 24 tutorials across all 11 projects are `status='draft'`.

---

## Accuracy vs precision vs quality

These three collapse into "is it good?" in most review, but they fail through different code paths and need different fixes, so they are scored separately.

- **Accuracy** — is the statement **true**? A false claim survives no amount of polish. *FloowForge described as a Next.js app when it is a FastAPI execution engine.*
- **Precision** — is it **specific enough to act on**? A true-but-vague statement wastes the reader's time without misleading them. *A capability called "Utility Endpoints"; a cluster called "Modules" with 6 files and 3 symbols.*
- **Quality** — is it **well-made and worth reading**? Structure, non-repetition, proportion. *34 identical "Calls: none specified." lines; a 39.9× spread between the longest and shortest section; the day-one section being the shortest.*

Legend as above: `✓` sound · `~` mixed · `✗` failing.

| Repo | Accuracy | Precision | Quality | Where they diverge |
|---|---|---|---|---|
| **OnboardBuddy** | ✓ | ✓ | ~ | Tightest length spread (6.0×) but 53% generic sentences, "This is noted as a boundary." ×6, and 6% of workflow steps explained. |
| **StudyFlow** | ✓ | ✓ | ✗ | **The clearest divergence.** Every claim checks out and the routes are named precisely — yet `code_map` repeats "Calls: none specified." 34 times and runs 28.3× longer than `data_model`. Accurate, precise, badly made. |
| **NationalPokedex** | ✗ | ✓ | ✗ | Precise *and* false at once: 71 route paths named correctly, while the API and frontend roles are inverted and the Express server is labelled "Frontend UI module". Precision without accuracy is worse than vagueness — it is confidently wrong. |
| **CourseInsights** | ~ | ~ | ~ | **Accurate but imprecise.** Nothing said about `InsightFacade` is false; "student" appears 0 times in 12 sections and "UBC" once. The reader learns dataset ingestion and never learns it is a course-search tool. |
| **Skribbl** | ~ | ~ | ~ | Best identity match in the set, and its capabilities name WebSockets — yet the server cluster is badged `frontend_ui`, 1 of 12 inbound handlers is modelled, and `npm run test` is prescribed where no such script exists. |
| **MasterPokedex** | ~ | ~ | ~ | **Accurate about domain, wrong about architecture, imprecise everywhere else.** "Serves API routes" is false (it consumes PokeAPI); `PokeAPI` appears 0 times. Capabilities are the only precise surface. |
| **kuankongy.github.io** | ~ | ✓ | ~ | Package identity and all 3 capabilities are right and specific; the Workflows and Tutorials tabs invent HTTP request handling on a static site. Accuracy is good in prose and fails in the structured tabs. |
| **Multiplayer-Tetris** | ✗ | ~ | ~ | Capabilities are accurate and useful; the architecture calls the Socket.IO broker "a frontend UI component on the server side", `routes_jobs` invents "authentication", and setup invents Docker. |
| **UBCPSS** | ~ | ✗ | ✗ | Identity is right. Then: a fabricated Docker prerequisite, "no explicit command" followed by the command, 2 capabilities that are layer names, a graph with 3 call edges, and the worst length spread (39.9×). Lowest precision in the set. |
| **DeepRecall** | ✗ | ✗ | ~ | A Flask/Whisper API described as a theme switcher. The prose is tidy and internally consistent — quality does not rescue an inaccurate premise, it makes it more persuasive. |
| **FloowForge** | ✗ | ~ | ~ | Inverted identity, plus the name corrupted to "FlowForge" 4×. Its 6 capabilities are reasonably specific — about `web/`, which is the 30% of the system that is not the product. |

Three patterns worth naming:

1. **Precision and accuracy are independent, and precision amplifies whichever way accuracy points.** NationalPokedex names 71 routes correctly and inverts the two services; a reader trusts the second claim *because* the first is so specific. CourseInsights does the opposite — vague enough that nothing it says is wrong.
2. **Quality is the axis the pipeline controls most directly and does worst on.** Nine of 11 projects have a ≥15× section-length imbalance; six repeat a filler line ≥9 times; the three largest projects explain 6–12% of their workflow steps. None of that requires better understanding of the repo — it requires proportion and de-duplication.
3. **Accuracy failures cluster on one mechanism.** Both ✗ accuracy grades in the package (FloowForge, DeepRecall) and both inverted-architecture cases (NationalPokedex, Multiplayer-Tetris) share a cause: the analyzer described the code it could parse as though it were the system, without ever saying what it could not parse.

---

## Rework pointers: what to change in generation

Ordered by leverage — how many projects and how many tabs each fix repairs. Tags: **(a) prompt** · **(b) detector/classifier** · **(c) UI** · **(d) data model**.

### F1 — Cluster `kind` falls back to repo-wide framework sniffing · **(b)** · 11/11 projects
**Now.** `fallbackKind()` (`backend/src/worker/engine/architectureClusterer.ts:216`) returns `frontend_ui` whenever the *repository* manifest mentions react/vue/svelte, regardless of which files are in the cluster; unmatched buckets get the literal category `'Modules'` (line 103). Result: **16 of 16 `* Modules` clusters across all 11 projects are typed `frontend_ui`**, including Skribbl's entire Express+Socket.IO server, NationalPokedex's `oracledb` API, Multiplayer-Tetris's session broker, and OnboardBuddy's `askService.ts`/`retrievalService.ts`.
**Why it's wrong.** The reader concludes there is no backend. On NationalPokedex the badge leaked into the sentence — "Frontend UI module for My Pokedex App" over `server.js` — so the reader is told the API server is a UI component. On the other four the prose is right and the badge contradicts it, which is worse than either alone: the colour, the grouping and the sentence disagree.
**Should.** Decide `kind` from the cluster's own members, not the repo: if any member imports `express`/`fastify`/`socket.io`/`oracledb`/`pg`, or has an outgoing `handles_route` or `touches_schema` edge, it cannot be `frontend_ui`. The signals already exist as graph edges. Add `backend_service` as the fallback for server-side leftovers and reserve `other` for genuinely unclassifiable. Also stop shipping a bucket named `Modules` — name it after its dominant directory (`server/`, `src/datasetProcessor/`), which is already in `metadata.directory`.

### F2 — `deterministic_summary` counts only `module`/`file` nodes · **(b)** · 11/11 projects, 13 clusters
**Now.** `summarize()` (`architectureClusterer.ts:222`, emitter at 230/242) builds `files` by filtering members to `node.type ∈ {module, file}`. But the `Configuration & Deployment` bucket is seeded at lines 113–116 exclusively from `node.type === 'config'`, and `Database Schema` from `schema` nodes. Every member fails the filter, so the string is `"Configuration & Deployment: 0 files."`. `symbolCount` (lines 225–228) matches on raw `filePath` while config nodes carry `stableKey = config:<path>` (`stableKeys.ts:52`), so no second clause is appended either. The same row's `metadata.memberCount` says 17, or 21, or 48. **All 13 such clusters reach the UI raw** — `graph.ts:254` only masks the deterministic string when a semantic module record exists, and none of the 13 has one.
**Why it's wrong.** "0 files" is a direct statement that a component is empty. A developer looking for where deployment is configured reads that StudyFlow's `Configuration & Deployment` has 0 files, when it holds five GitHub Actions workflows and `api/Dockerfile`. On NationalPokedex — a database course project — `Database Schema: 0 files.` sits over 48 schema nodes from `pokedexOracle.sql`.
**Should.** Count members, not module-typed members: `${memberCount} file${s}` with a type breakdown (`17 config files`, `48 schema objects across 2 files`). Fix the `symbolCount` join to strip the `config:`/`schema:` stable-key prefix before comparing paths. Generate a semantic module record for config and schema clusters too, so they are not the only clusters permanently on the deterministic fallback. Secondary: in monorepos the path-rule devops cluster gets a scoped key (`cluster:backend/configuration-deployment`) and never merges with the unscoped config-node bucket — hence OnboardBuddy showing two Configuration & Deployment clusters, one saying "1 file, 3 symbols" over 23 members.

### F3 — No event/socket entrypoint detection exists · **(b)**, partly **(d)** · 11/11 projects
**Now.** 245 entrypoints across all projects: 192 `http_route`, 44 `ui_route`, 7 `package_export`, 2 `worker_job`. **Zero `event_listener`, zero `cli`, zero scheduled jobs, ever.** The `event_listener` path (`entrypointDetector.ts:140-156`) requires the file path to match `/worker|listener|consumer|jobs?\//i` **and** the symbol name to match `/^(process|handle|consume|on[A-Z])/`; Skribbl's `server/src/handlers.js` fails the path test. No `socket.on`, `addEventListener` or `EventEmitter` detection exists anywhere in the analyzer. `cron_job` is declared in the kind union (line 8) and mapped to a trigger type (line 215) but is emitted by no branch — dead code. `webhook` is absent from the DB enum entirely.
**Why it's wrong.** Any product whose interface is a message protocol is structurally invisible. Skribbl's 20-event protocol *is* the game; the tool models `GET /health`. FloowForge's APScheduler cron and Redis Streams worker are the execution engine; the tool models none of it. The reader concludes these systems have almost no surface area.
**Should.** Add an AST detector for `X.on('event', handler)` where `X` resolves to a socket/emitter import, emitting `event_listener` with `route_path = <event name>`, plus the outbound `emit`/`broadcast` calls as the response side. Drop the conjunctive path-*and*-name requirement on the existing branch — the name heuristic alone is enough when the callee is a known emitter. Wire the dead `cron_job` branch to `node-cron`/`APScheduler`/`@Cron` decorators. Add `webhook` to the entrypoint enum in `001_initial_schema.sql:391-394`.

### F4 — `ui_route` only recognizes `export default function Name()` · **(b)** · 2/11 projects, cascades to 3 tabs
**Now.** The `ui_route` detector (`entrypointDetector.ts:108-122`) looks for an exported PascalCase function under `pages/`/`views/`/`screens/`, capped at `.slice(0, 2)` per file. StudyFlow's pages are written `export default function CreateTopic() {` → **22 `ui_route` rows**. MasterPokedex's are written `const Items = () => {...}; export default Items;` → **0 rows**, despite an identical `src/pages/` directory with 8 PascalCase page components and 7 `<Route path=` registrations in `src/App.tsx`. Skribbl's `src/pages/` uses the same arrow-const form → 0 rows.
**Why it's wrong.** This one AST gap is the entire reason MasterPokedex's Workflows *and* Tutorials tabs are empty: 0 entrypoints → 0 traces → 0 workflows → 0 tutorials. Three tabs blank on a healthy, fully-supported TypeScript SPA, for a code-style reason that has nothing to do with the project.
**Should.** Resolve `export default <Identifier>` back to its declaration before testing the shape, and accept `const X = () => {}` / `const X = function() {}` / `React.memo(...)` / `forwardRef(...)` wrappers. Better still, read the router directly: `<Route path="..." element={<X/>}/>` in `App.tsx` gives both the path and the component, which is what the reader actually wants and which no current detector consults. Also drop or raise the 2-per-file cap — it silently truncates any file that registers several routes.

### F5 — Workflow creation gate discards short and effect-free traces · **(b)** · 6/11 projects
**Now.** `trace()` (`workflowExtractor.ts:366-376`) requires `steps.length >= 2 && effectCount >= 1`; anything else returns a dead end with reason `no_calls_traced` or `no_effects_reached`. `effectCount` only rises on a `DetectedSideEffect`, an `EFFECT_SIGNALS` match, or a `schema` node. Traversal is limited to `calls | handles_route | registers_callback | enqueues_job | handles_job | touches_schema` (lines 83–86). Outcome: **0 workflows on MasterPokedex, Multiplayer-Tetris and UBCPSS**; 1 each on DeepRecall, FloowForge and Skribbl, and in two of those three the single workflow is the project's CI file.
**Why it's wrong.** The tab is called Workflows. When FloowForge — a workflow-execution platform — shows one workflow named `CI: on push, pull_request`, the reader concludes the system has one workflow and it is a build pipeline. A blank or CI-only Workflows tab reads as "this system does nothing", not "the tracer found nothing".
**Should.** Keep the gate but stop letting it silently empty the tab. Rank CI/dev-command workflows below product workflows and label them as infrastructure so they never appear alone as if they were the product. Widen `EFFECT_SIGNALS` to count socket `emit`, state mutation, and canvas/DOM writes so front-end-only and game projects can produce traces. And when a trace dies, surface the reason: `index.ts:563-566` already writes `{"kind": "no_workflows_found"}` into `unknowns` — nothing renders it.

### F6 — `workflow_steps.explanation` is written only for tutorial-covered steps · **(b)** + **(c)** · 4/11 projects, worst on the best ones
**Now.** `summaryWorker.ts:278-286` copies tutorial explanations back onto workflow steps. Since tutorials are capped at 4, the coverage on large projects is: OnboardBuddy **37 of 635 steps (6%)**, NationalPokedex **25 of 356 (7%)**, StudyFlow **49 of 419 (12%)**. Everything else renders the deterministic string — "Touches database table X" appears 137 times on OnboardBuddy and 72 times on NationalPokedex.
**Why it's wrong.** The three projects whose Workflows tab is otherwise the strongest surface in the product present 88–94% of their step text as identical template lines, with no visual distinction between a sentence an LLM wrote about this code and a string a formatter produced. The reader cannot tell which steps were understood.
**Should.** Two independent changes. **(c)** Mark deterministic step text as deterministic in `WorkflowsPage.tsx` — the data already distinguishes them (`explanation` empty vs not), exactly as `graph.ts` already tracks `summarySource: "semantic" | "deterministic"` for clusters. **(b)** Decouple step narration from tutorial selection: narrate the top-N workflows by `critical_for_workflow` in a cheap batched pass rather than only the ≤4 promoted to tutorials.

### F7 — `dependentCount` hardcoded to 0 in the clustered graph view · **(c)** · 11/11 projects
**Now.** `backend/src/api/routes/graph.ts:73` sets `dependentCount: 0` on every directory-group node. The `dirMap` bucket (line 51) has no accumulator for it, while `importCount` is summed at line 58 and the two non-clustered paths read the real value at lines 152 and 323. `MAX_GRAPH_NODES = 60` and the smallest graph in the set is 129 nodes, so **the clustered view is the default on 11 of 11 projects**. `frontend/src/components/graph/ModuleNode.tsx:77` renders it as "0 imported by". `frontend/src/pages/ArchitecturePage.tsx:110` hardcodes the same field for architecture clusters.
**Why it's wrong.** The panel states that nothing depends on `src/api/` while the graph draws arrows into it. "0 imported by" is the single number a reader uses to judge what is safe to change; it is wrong on every node of every project's default view.
**Should.** Accumulate it in `dirMap` alongside `importCount` — the per-node value already exists in `graph_nodes.metadata.dependentCount`. Better: compute it from the cluster edges actually built at lines 80–95, which is the number the diagram is drawing. Same fix in `ArchitecturePage.tsx:110`.

### F8 — Capability prompt demands 2–8 groups regardless of what exists · **(a)** · 5/11 projects
**Now.** `capabilityPass.ts:99-110` instructs the model to "Group the workflows and modules given by the user into 2-8 capabilities", on the `cheap` tier. With thin evidence the quota gets filled from whatever is in scope: CourseInsights "Continuous Integration and Deployment" and "Development Environment"; DeepRecall "Local Development Environment"; UBCPSS "Data Management and Structure" and "UI Presentation" — 2 of 2, both layer names; CourseInsights "Utility Endpoints".
**Why it's wrong.** Capabilities is the tab a reader opens to answer "what can this thing do?". Build infrastructure listed there tells them CI is a product feature. Layer names tell them nothing while occupying the slot where a real answer would go.
**Should.** Change the prompt to name capabilities as **user-visible outcomes**, with explicit exclusions ("do not emit capabilities for CI, linting, build tooling, or local development") and a rule that each capability must be phrased as something a user or caller can do. Make the count a ceiling, not a range — "up to 8, and fewer is correct when the evidence is thin". Optionally add a post-filter rejecting names matching `/^(development|local|continuous integration|build|configuration)/i`; the pass already has grounding filters at lines 188–196 and 210–226 to hang it on.

### F9 — No distinction between "nothing here" and "we found nothing" · **(c)** + **(d)** · 5/11 projects
**Now.** UBCPSS renders 0 workflows and 0 tutorials because it genuinely has no routes, no CI and no compose file — the correct answer. MasterPokedex renders 0 workflows and 0 tutorials because of F4. Multiplayer-Tetris renders 0 because of F3. **All three look identical.** `no_workflows_found` is written to `unknowns` (`index.ts:563-566`) and never surfaced.
**Why it's wrong.** A blank tab reads as "this project is trivial". For UBCPSS that is nearly true and the tab should say so; for MasterPokedex it is a tool failure being presented as a property of the repo. This is the tab-level version of the D3 finding in the package: the pipeline never says what it did not find.
**Should.** Give every tab an explicit empty state driven by data, not absence: "No workflows traced. 7 UI routes were detected but no trace reached a side effect" vs "No routes, scheduled jobs or CI pipelines found in this repository." That needs the dead-end reasons from `workflowExtractor.ts:366-376` persisted rather than discarded — a small data-model addition — and a render path in `WorkflowsPage.tsx` / `WalkthroughTab.tsx`.

### F10 — `DEFAULT_MAX_TUTORIALS = 4` is never scaled · **(b)** · 4/11 projects
**Now.** `tutorialGenerator.ts:19` sets the cap; the only caller (`summaryWorker.ts:271-274`) does not pass `maxTutorials`. OnboardBuddy (268 files, 76 workflows) and kuankongy.github.io (a portfolio site, 4 workflows) both get exactly 4. `pickDiverseWorkflows()` (line 134) then caps `read_route` and `ui` families at 2 slots each, so on a 76-workflow project at most 2 of the 4 can be API traces.
**Why it's wrong.** Tutorials are the highest-quality prose the product generates — 176–292 characters per step, all receipt-backed, genuinely specific. Capping at 4 means 94–95% of traced workflows on the three large projects never get narrated, while a static site gets full coverage.
**Should.** Scale the cap with traced-workflow count and repo size (`classifyScopeSize()` in `engine/budgets.ts:100` already buckets scopes) — e.g. 4 / 8 / 12 for small / medium / large — and raise the per-family cap proportionally so a 76-workflow project is not limited to 2 API walkthroughs. This is the cheapest quality win available: the generator already works, it is just rate-limited.

### F11 — 17 of 76 architecture clusters are drawn with no edges · **(b)** · 11/11 projects
**Now.** `Configuration & Deployment` is degree-0 on 11 of 11. StudyFlow has **4 of 8 clusters isolated, including `Api · API Routes` and `Worker · Workers`**; Multiplayer-Tetris's `Server · Modules` is isolated, which is why the package prose says it has "0 outgoing or incoming connections to other clusters".
**Why it's wrong.** An isolated node on an architecture diagram means "not connected to anything". For StudyFlow the API and the worker are the two halves the package's own narrative describes as central; the diagram says they touch nothing. For Multiplayer-Tetris, client↔server traffic is the entire product.
**Should.** Include configuration and deployment relationships as edges — a Dockerfile that builds a service, a compose file that names it, a CI job that deploys it — rather than leaving config clusters to float. For code clusters, fall back to inferring an edge from any `imports` relationship between members when no stronger edge type exists, and if a cluster still has degree 0, say so explicitly ("no dependencies detected") instead of drawing an unexplained island.

### F12 — Cluster and node inventories are diluted by non-code nodes · **(b)** · 3/11 projects
**Now.** UBCPSS's dependency graph is **143 of 241 nodes (59%) `doc`/`external`/`config`**, with 128 `doc` nodes from README headings and **3 `calls` edges in the entire graph**. MasterPokedex and Skribbl are 45% and 44% `variable` nodes.
**Why it's wrong.** The Dependencies tab promises module structure and delivers a README outline. A reader who opens it on a small project sees a dense picture that encodes almost no dependency information.
**Should.** Exclude `doc` nodes from the dependency graph by default (they belong to search and receipts, not to structure) and collapse module-scoped `variable` nodes into their parent. `graph.ts` already filters `extends`/`implements` edges at the query — extend the same treatment to node types, with a toggle if the full set is wanted.

### What must not regress

The evidence layer is the part that works, and every change above should preserve it: **220 of 220 sampled receipts verify byte-for-byte at the analyzed commit, 0 of 413 inline citations dangle, and all 189 tutorial steps carry a receipt id.** The tutorial prose built on top of correctly-traced workflows is genuinely good. Nine of the twelve failure modes above are in *selection and classification* — what gets detected, what bucket it lands in, and what the summary line asserts about it — not in the retrieval that backs them.
