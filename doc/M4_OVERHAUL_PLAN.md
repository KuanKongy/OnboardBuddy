# Milestone 4 — UI/UX & Data-Model Overhaul

## Context

Milestone 3 feedback surfaced ~20 UI/UX defects and two structural problems: (1) the product model treats a project as repo+branch, forcing users to duplicate projects to analyze another branch/commit/role, and (2) analysis auto-starts on import with default settings, wasting tokens and hitting the Supabase session-pooler connection cap (`EMAXCONNSESSION`, pool_size 15). Alongside the mechanical fixes, AI-generated content (tutorials, workflows, capabilities) isn't useful enough yet — explanations are wordy/off-point, workflow diagrams contain a false last→first cycle, dependency counts are wrong, and Capabilities has no clear purpose.

Goal: project = repo; branch/commit/scope/depth/role become per-run analysis config; import follows the industry pattern (Import → Configure → Start); all listed UI bugs fixed; AI content overhauled for utility.

This document is the execution plan for Milestone 4.

## Status (2026-07-11)

All workstreams (WS0–WS10) are implemented on the `Milestone3` branch. Verified:
backend `tsc` + build clean, 314 backend tests passing (incl. new
`m4-regressions` and `progress` suites), frontend `tsc` + build clean,
25 vitest tests passing (incl. the new `graphLayout` packing suite), and all
33 Playwright UI specs passing against mocked APIs in both themes + mobile.

**Remaining manual steps (need team coordination / live credentials):**

1. **Dev DB reset** — run `000_drop_all.sql` then `001_initial_schema.sql`
   against the shared Supabase project (Settings → SQL Editor). Destructive:
   every teammate re-imports their repos afterwards. Announce before running.
2. **Set `PG_POOL_MAX` in `backend/.env`** (recommended 4 for the API process,
   8 for the worker — docker-compose already pins these per service).
3. **AI-content validation run** — import a test repo through the new wizard,
   analyze on `cheap` depth, and review the v2 tutorials (`tutorial-v2`) and
   capabilities (`capability-extraction-v2`) against the old output; log
   findings in `doc/BUGS_AND_FIXES.md`. Prompt-version bumps invalidate the
   semantic cache, so this run pays full LLM cost for those passes.

## Decisions confirmed with the team

1. **Schema change ships by editing `001_initial_schema.sql` in place + DB reset** via `000_drop_all.sql` (pre-production; all projects re-imported — coordinate with teammates).
2. **Full AI content-quality overhaul** (prompts + pipeline), validated with real re-runs on a test repo.
3. **Capabilities becomes a feature-map navigation hub** (cards linking to workflows/tutorials/architecture), graph removed; tab moves above Workflows.

## Implicit design decisions

1. **Snapshot identity stays `(scope_id, commit_hash)`** — the same commit analyzed from two branches shares one snapshot; branch is stored as provenance on snapshots/jobs. Avoids re-analyzing identical code.
2. **`projects.branch` is kept but demoted** to "default branch for new runs" (not identity, not display identity). Overview shows `owner/repo`.
3. **Import wizard creates the project at step 1** (before configuration) — abandoning mid-wizard leaves a project without analysis, which is now harmless since project = repo.
4. **Depth and role become per-run overrides**; the project-settings values remain the defaults.
5. **Commit picker**: new backend endpoint lists recent commits per branch via the existing GitHub App integration (mirrors the `/branches` endpoint) — users never hunt for SHAs. "Latest (head)" is the default.
6. **Dependencies "imports/exports" filter is removed** (it only ever no-ops without a selected node) rather than repurposed.
7. **"Strongest edges" becomes real**: backend supplies edge weight (deduped import count); frontend sorts by weight before the 3-in/3-out cap.
8. **Count semantics redefined**: node badges show `exports · imports (internal, deduped) · imported by (deduped)`; external/third-party imports listed separately; NodeInfoPanel labels split by node type ("Imported by/Imports" for files, "Called by/Calls" for symbols) so panel and badge numbers agree. The redundant "Used by = exports" style row is dropped.
9. **Workflow cycle fix renders a distinct terminal "response" node** (`…::return`) instead of deleting the response step — the trace stays honest, the loop disappears.
10. **Workflow selection quality**: UI-route seeds deprioritized vs HTTP/worker seeds in importance scoring; near-duplicate workflows (≥80% shared steps) suppressed.
11. **"0 Need review" stat**: replaced with "Stale sections", rendered only when > 0; otherwise the slot shows "Tutorials available". Breadcrumb "Overview > Dashboard" deleted.
12. **Logo = universal home button**: `BrandLogo` at the top of both sidebars links to `/dashboard`; the project sidebar's `BackLink` is removed (repo name stays beneath the logo).
13. **Account settings back** uses `location.state.from` → `navigate(-1)` → `/dashboard` fallback; content centered `max-w-2xl mx-auto`.
14. **`user_progress` table is polymorphic** (`ref_id` without FK, validated on read) so onboarding packages and tutorials share one table; resume links fall back to static links when the ref is regenerated away.
15. **Pool fix is env-based**: `PG_POOL_MAX` default 20→10, `.env.example` documents API=4 / worker=8 (session pooler cap 15 shared by both processes); the DB-heavy `mapLimit(…,12)` in symbolPass drops to 8. No pooler-mode migration.
16. **Members API cleanup**: the doubled `members/members/:userId` path becomes `/:userId` (frontend + backend ship together).
17. **Team "more info" uses existing data only** (GitHub username via `github_connections`, join date, sections-reviewed count) — no new columns this milestone.
18. **Prompt-version bumps intentionally invalidate the content-addressed cache** — validation re-runs cost LLM tokens; iterate on `cheap` depth, final check on `standard`.

## Workstreams (execution order)

`WS0 → (WS1 ∥ WS2 ∥ WS4) → (WS3 ∥ WS5 ∥ WS6) → (WS7 ∥ WS8 ∥ WS9) → WS10`

### WS0 — Schema (M) — `backend/supabase/migrations/001_initial_schema.sql`
- `projects`: unique key → `(user_id, repo_owner, repo_name)`; `branch` re-commented as default-only.
- `analysis_jobs`: add `branch varchar`, `commit_hash varchar`, `semantic_depth varchar check (in cheap|standard|full)`, `role`. (`analysis_snapshots` already has `branch`.)
- New `user_progress` table: PK `(user_id, project_id, kind, ref_id)`, `kind in ('onboarding','tutorial')`, `position jsonb`, `updated_at`; index on `(user_id, project_id, updated_at desc)`.
- Reset dev DB (`000` + `001`), announce to team. Fix stale `doc/DEVOPS.md:382-392` schema overview (drop nonexistent `workflow_scores`/`doc_links`/`role_paths`).

### WS1 — Backend API (L)
- `POST /projects` (`api/routes/projects.ts:42`): branch optional (defaults to repo default); 409 message → "Project already exists for this repo".
- `POST /projects/:id/analyze` (`projects.ts:636`): body `{scope_id?, scope_path?, branch?, commit?, depth?, role?}`; free-text `scope_path` upserts an `analysis_scopes` row; config persisted on the job + passed in `AnalysisJobData`; 409 body gains `active_job_id`.
- `POST /projects/:id/preflight` (`projects.ts:593`): accepts the same body so preview matches run config.
- New `GET /github/repos/:owner/:repo/commits?branch=` (`api/routes/github.ts` + `listCommits()` in `lib/github.ts` next to `listBranches`): `{sha, shortSha, message, author, date}`.
- New `api/routes/progress.ts` mounted at `/projects/:id/progress`: `GET /` (items enriched with titles + existence), `PUT /` upsert.
- `members.ts`: enrich `GET /` with `github_username` + `sections_reviewed`; rename `members/:userId` handlers to `/:userId`.
- `capabilities.ts`: payload gains workflow `purpose`/`composite_score`, linked `tutorials`, `startHere`, member `membership_reason`.
- `workflows.ts`: list gains `reasons`/`score_breakdown` from `criticality_scores`.

### WS2 — Worker correctness + pool (M)
- `lib/queue.ts` `AnalysisJobData`: add `branch`, `depth`, `role`.
- `worker/index.ts`: run branch/commit/depth resolved as `job.data.X ?? project default` through fetch, snapshot insert, and summary enqueue; preflight honors the same.
- **Cycle fix** (`worker/engine/workflowExtractor.ts:210-214`): tag the synthetic final response step `metadata.syntheticReturn`; `api/routes/graph.ts:392-412` emits a distinct terminal node for it instead of re-linking node 1. Regression test.
- **Count fixes** (`worker/engine/evidenceGraphBuilder.ts`): `importCount` = distinct resolved internal imports (external count separate); `dependentCount` increments only when `addEdge` actually inserts; `graph.ts:516-529` panel queries split imports/calls by node type; edge weight added for "strongest edges".
- **Pool**: `lib/db.ts` default max → 10; `.env.example` + `doc/DEVOPS.md` document per-process sizing (API 4 / worker 8 vs pooler cap 15); `worker/semantic/symbolPass.ts` `mapLimit` 12→8.

### WS3 — AI content overhaul (L)
- **Tutorials** (`worker/generation/tutorialGenerator.ts`, prompt version → `tutorial-v2`): goal-first ("after this you can trace/change X"); per step ≤3 sentences, must reference concrete identifiers from the snippet, explain why the step exists in the flow, ban generic filler; `goal` persisted. `WalkthroughTab.tsx` renders code + explanation side-by-side consistently.
- **Workflow node docs**: tutorial explanations already flow onto `workflow_steps.explanation` (`summaryWorker.ts:167-172`) — improved automatically; tighten deterministic `describeStep` wording (name the effect target).
- **Capabilities** (`worker/semantic/capabilityPass.ts`, prompt version → `capability-extraction-v2`): require plain-language `description`, `user_value`, `where_the_code_lives` (+ reasons), `where_to_start` (1-3 entry symbols + why); stored in `capabilities.metadata` / `capability_members.membership_reason`.
- **Selection quality** (`workflowExtractor.ts`): deprioritize `ui_route` seeds; suppress ≥80%-overlap duplicate workflows.
- Validate by re-running on the test repo (cheap depth for iteration); log findings in `doc/BUGS_AND_FIXES.md`.

### WS4 — Shared PageHeader + frame (M)
- New `frontend/src/components/PageHeader.tsx` (`{title, subtitle?, actions?, leading?}`) with `SidebarToggle` inline in the title row.
- Delete standalone toggle rows `App.tsx:64-66` and `ProjectLayout.tsx:280-282`; migrate all pages (`.page-header` users + hand-rolled: Dashboard, ProjectList, ProjectOverview, Team, Import, AccountSettings, Invitations) to `<PageHeader>`.
- Unify main/project layout frame: identical sidebar width, header height rhythm, and the top/sidebar "cut" line so switching contexts doesn't shift borders.

### WS5 — One guarded analyze flow (L)
- New `frontend/src/components/AnalyzeConfigForm.tsx`: branch select (existing `/branches`), commit picker (new `/commits`, default head), scope select + free-text path, depth, role.
- `AnalyzeDialog.tsx` embeds the form; preflight preview carries full config; 409 shown as "analysis already running" with link to the active job.
- **Import wizard** (`ImportPage.tsx`): remove auto-`POST /analyze` (line 211). Flow: pick repo → create project → configure (AnalyzeConfigForm + preflight cost preview) → explicit "Start analysis" → project overview. Extend `AppTour` to cover it.
- Consolidate call sites: `OnboardingPage.tsx:396-405` and `ProjectSettingsPage.tsx:227` open `AnalyzeDialog` instead of firing `POST /analyze` directly; disabled state driven by live `/analysis-status`, not local flags.

### WS6 — Graph UX (L)
- **`frontend/src/lib/graphLayout.ts` rewrite**: connected-component split (union-find) → dagre per component → shelf-pack component boxes into rows (~16:9 target); isolated nodes as a compact grid block. Same exported signatures — fixes vertical stacking in all 5 views. Unit test: no overlaps, components spread horizontally.
- **Dependencies** (`GraphPage.tsx`, `graph/`): remove imports/exports filter + `GraphToolbar.tsx:49-61` dead code; Files/Classes toggle pinned right (`ml-auto`), no shift when files-only controls hide; cluster drill-down as stable in-title breadcrumb (`Dependencies / cluster`) instead of a prepended button; legend built from kinds actually present, collapse animates body only (fixed header/padding); "modules" wording corrected per view; badge/panel counts + weighted "strongest edges" from WS2.

### WS7 — Capabilities hub + workflow relevance + nav (M)
- `CapabilitiesPage.tsx` → card grid: name, plain-language description/user value, "Where the code lives" (cluster chips → architecture), "Start here" links (→ dependencies node), linked workflows and tutorials (query-param deep links; target pages accept them).
- `ProjectLayout.tsx:28-92`: Capabilities moves above Workflows (nav + tour order).
- `WorkflowsPage.tsx`: per-workflow "Why this matters" line from `reasons`/`score_breakdown`.

### WS8 — Page-level fixes (L)
- **TeamPage**: card click opens detail modal for all members (read-only when unmanageable); adds join date, GitHub username, sections reviewed; tier/role change + kick (confirm) gated as today; new API paths.
- **ProjectOverviewPage**: Analyze button → primary blue `variant="default" size="sm"`; three cards flattened to icon-left/text-right rows; identity shows `owner/repo`; analysis-status + role-package panels grouped per run config `(branch, commit, scope, depth)` with role chips — shared repo/config header, switchable between configs; Continue cards wired to WS9 progress.
- **DashboardPage**: breadcrumb removed; "Need review" stat per implicit decision 11; adopts PageHeader.
- **ProjectListPage**: single combined empty-state box (message + Add-repository CTA); filtered-empty shows one box with clear-search, no orphan Add tile.
- **ProjectSettingsPage**: centered single-column `max-w-4xl mx-auto` (drop `lg:grid-cols-2`); Select overflow fixed (`w-full min-w-0`, truncate, wider column) for "When exceeded" and "Analysis depth".
- **Navigation**: BrandLogo → `/dashboard` in both sidebars; AccountSettings back-to-previous + centered.

### WS9 — Progress persistence (M)
- `frontend/src/lib/useProgress.ts`: GET on mount, debounced PUT.
- `OnboardingPage` records active section; `WalkthroughTab` records tutorial step; both accept resume query params.
- Overview Continue cards show "Continue onboarding — Architecture" / "Continue tutorial — step 3/7" with graceful fallback.

### WS10 — Docs + tests

## Verification

- **Backend (vitest, via `docker compose -f docker-compose.test.yml run --rm test`)**: analyze-body persistence + 409 `active_job_id`; commits endpoint (mocked GitHub); progress upsert/list/access-control; members paths + enrichment; graph count consistency + workflow no-cycle regression; evidenceGraphBuilder distinct-count tests; prompt-version/schema updates in `worker/ai/__tests__`.
- **Frontend**: `graphLayout` packing test (no overlapping component boxes); `GraphPage.test.tsx` update; e2e `fixtures.ts` mocks extended (progress, commits, capabilities), `phase10-ui.spec.ts` + `mobile-ui.spec.ts` updated for PageHeader/wizard/nav order.
- **Manual end-to-end**: reset DB → import test repo through the wizard (branch + commit picker + scope + depth + role, preflight preview) → start analysis → watch API/worker logs for `EMAXCONNSESSION` (must be gone) → verify: graph component packing + correct counts + legend; workflows without cycle, with "why this matters"; concise code-first tutorials; capabilities hub links; team modal; progress resume after reload; friendly 409 on double-start.

## Risks

- DB reset is destructive — land WS0 alone, coordinate with teammates.
- Prompt bumps → full-cost validation runs; budget OpenRouter spend, iterate on cheap depth.
- Same commit on two branches shares a snapshot (branch is provenance) — package panels display the snapshot's branch with that caveat.
- Layout rewrite churns e2e screenshots across all five graph views — re-baseline deliberately.
- Members route rename requires frontend+backend landing together (monorepo, fine).
