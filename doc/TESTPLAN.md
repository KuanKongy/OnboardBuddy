# OnboardBuddy — Test Plan (Milestone 3)

How to validate OnboardBuddy: one command for all automated tests, then manual checklists that exercise the M3 features end to end.

---

## 1. Automated Tests — one command

With only Docker installed, from the repo root:

```bash
docker compose -f docker-compose.test.yml run --rm test
```

Or, with Node 22 instead of Docker:

```bash
npm install && npm test
```

Either way this runs **every automated test** — backend (Mocha/Chai/Supertest) and frontend (Vitest/Testing Library). **Expected output:** backend `302 passing`, frontend `21 passed`; non-zero exit code on any failure. No `.env`, no cloud services, no running stack needed — the suites are self-contained (DB stubbed, API booted in-process, fixture repo shipped in-tree). The first Docker run builds the image (~1–2 min); repeats are cached.

What each suite covers, layer by layer and file by file, is documented in [TESTING.md](./TESTING.md) — including the optional Playwright UI regression suite (21 tests rendering every tab in dark + light themes).

---

## 2. Running the App (for manual tests)

1. Place `backend/.env`, `frontend/.env` (submitted on Canvas/UBC mail) and `github-app.pem` in `backend/`.
2. `docker compose up --build`
3. Open http://localhost:5173 (API: http://localhost:3000/api, health: http://localhost:3000/api/health).

For a repo to analyze, fork https://github.com/KuanKongy/CourseInsights (a CPSC 310 project) into your GitHub account and install the OnboardBuddy GitHub App on it during import.

---

## 3. Manual Test Checklists

### 3.1 Authentication & GitHub setup (unchanged from M2)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open http://localhost:5173, sign up (email + password ≥ 8 chars) | Redirected to `/dashboard` |
| 2 | Account Settings → Connect GitHub → authorize the App | GitHub shows as connected |
| 3 | Sign out and back in | Session restored; GitHub stays connected |

### 3.2 Import & analyze with preview (M3)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Dashboard → Import Repository → pick installation, repo, branch, role → Create Project | Project overview opens |
| 2 | Overview → **Analyze…** | Dialog with scope selector and optional commit SHA |
| 3 | Click **Preview first** | Preview appears: analyzable file count, ~symbols, ~AI calls, cost tier, privacy summary, unsupported-language note if any |
| 4 | Click **Start analysis** | Progress bar advances **without ever moving backwards**: "Analyzing code — …" (0–70%), then "Generating onboarding — …" (70–100%) |
| 5 | While running, watch below the bar | Live activity list shows the current step (spinner) and recently completed steps (checkmarks) with timestamps |
| 6 | After completion, expand **Pipeline phases & spend** | Per-phase rows (ingest…generation) with metrics; budget line shows AI calls, tokens, ~cost |

### 3.3 Onboarding package cards & reader (M3)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open **Your Onboarding** | Card grid: one card per (scope, role, commit) with status, commit freshness, section/tutorial counts |
| 2 | Use the role/status/commit filters | Card list narrows; counter updates |
| 3 | Open a card | Reader: numbered section nav (11 sections), content with Markdown, confidence badge |
| 4 | Click a receipt chip | Code snippet viewer opens with file/line |
| 5 | Open the **Architecture** section | An embedded Mermaid diagram renders |
| 6 | Find a section with "Known gaps" | Honest unknowns listed in plain language (nothing invented) |
| 7 | Switch role to one without a package → **Generate for <role>** | Only that role generates (no re-analysis); package appears after generation — other roles remain untouched |
| 8 | Export → Markdown file | `.md` downloads with all sections |
| 9 | Mark a section reviewed | Badge flips; persists on refresh |

### 3.4 Graph tabs (M3)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | **Architecture** | Layered cluster graph (no overlapping/line-of-nodes); kind-colored chips + criticality bars; click a component → summary (labeled AI vs deterministic), file list, criticality |
| 2 | **Dependencies** | File graph with search; click a node → symbol doc panel: one-line summary, signature, real call-site example, importance + reasons, receipts |
| 3 | Dependencies → **Classes & interfaces** | Class/interface graph with extends/implements edges |
| 4 | **Workflows** | Traced flows list; step graph top-to-bottom with numbered, kind-colored steps; click a step for detail |
| 5 | **Capabilities** | Business capabilities linked to their workflows and components; click for details with cross-links |

### 3.5 Tutorials (M3)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open **Tutorials** | First tutorial auto-opens: step pager, real code snippet, AI explanation, "Backed by" receipts per step |
| 2 | Step through with the pager/arrows | Each step shows file/lines/kind + snippet + explanation |
| 3 | If no tutorials exist for the role | Deterministic workflow walkthrough shows instead, with an honest notice |

### 3.6 Incremental re-analysis & staleness (M3)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Push a commit changing one function body to the analyzed repo | — |
| 2 | Overview → **Analyze…** → Start analysis | Response mode is incremental; run completes faster (cached records reused) |
| 3 | Open **Your Onboarding** | Sections citing the changed file show **Stale** badges; the package card shows a stale count |
| 4 | Open a stale section → **Regenerate** | Section rebuilds against the newest snapshot; stale badge clears |

### 3.7 Settings (M3)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Project **Settings** | Two-column layout: privacy mode (3 options), analysis depth, budget limits + stop behavior, LLM API key, ranking weights, ignored paths, limits |
| 2 | Set privacy to "AI disabled", re-analyze | Pipeline completes deterministic-only; onboarding generation is skipped with an honest notice |
| 3 | Add a project OpenRouter key | Shows "Key configured by <email>" — the key value is never displayed again |
| 4 | Ranking weights → move a slider → Save | Saves instantly; **Revert to defaults** restores |

### 3.8 Q&A evaluation endpoint (stretch, dev-only)

With the stack running and `INTERNAL_CHAT_ENABLED=1` (or non-production), open http://localhost:3000/api/internal/chat, paste a bearer token (from the browser's Supabase session) and a project id, and ask e.g. *"What does the auth service do?"* — expect a receipt-cited answer with confidence and intent shown.

### 3.9 First-timer tour & themes

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open any project in a fresh browser profile | 9-step tour starts, spotlighting each sidebar tab with an explanation |
| 2 | Esc or "Skip tour" | Tour dismisses and stays dismissed; "Take a tour" in the sidebar restarts it |
| 3 | Toggle dark/light theme | All tabs stay legible; graphs re-color |

---

## 4. Recording bugs

Any defect found during these checks goes into [BUGS_AND_FIXES.md](./BUGS_AND_FIXES.md) (and GitHub Issues) with date, reporter, expected vs actual, repro steps, priority (P0–P5) and state (New/Open/Closed/Won't-Fix).
