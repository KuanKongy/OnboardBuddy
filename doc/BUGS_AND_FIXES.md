# Bug Log

Copy each `## [P…][State] Bug …` block into a GitHub issue.

**Priority:** P0 crash · P1 intermittent · P2 reproducible · P3 patch later · P4 annoying · P5 idea

**Bugs #1–#29** — Canonical list from GitHub Issues (OnboardBuddies Team 15).

Security review findings (formerly #30–#34) are merged into **#13** and **#18** — do not file them as separate issues.

---

## GitHub Issues — TODO

Actions to take on the GitHub Issues tracker:

| Action | Issue | What to do |
|--------|-------|------------|
| **Close** | #13 | Endpoint and file removed. Token save via `POST /github/oauth/complete`. Comment "Fixed: save-token flow replaced by server-side App OAuth" and close. |
| **Close** | #18 | All server + client fixes shipped. Comment with summary below and close. |
| **Close** | #17, #19, #26, #27, #28, #29 | Fixed in Milestone 3 — copy each bug's "Fix notes (2026-07-10)" as the closing comment. |
| **File + Close** | #30–#34 | New M3 bugs, already fixed — file with the full body from this doc, then close with the fix notes. |
| **File + Close** | #35 | Fixed same day — file then close with fix note. |
| **File (Open)** | #36 | Known open item — file and leave Open (P5 future work). |
| **File (Open)** | #37 | GitHub sign-up provider error — file Open; close once the Supabase GitHub provider config is fixed and sign-up verified. |
| **File + Close** | #38–#45 | Found during the first real M3 end-to-end run (2026-07-11), fixed same day — file with the bodies below, close with the fix notes. |
| **File + Close** | #46–#48 | Found testing CourseInsights (2026-07-11), fixed same day — file with the bodies below, close with the fix notes. |
| **File + Close** | #49–#52 | Found during M3 polish testing (2026-07-11/12), fixed same day — file with the bodies below, close with the fix notes. |
| **Update** | #2, #12, #16, #20, #21, #23 | Already Closed on GitHub — verify and leave as-is. |

**Close comment for #18:**
> Fixed in multiple commits:
> - Server: per-user installations, ownership checks, identity match (`assertAuthorizedGitHubMatchesSupabaseIdentity`), duplicate-link guard (`assertGithubAccountCanBeLinked`), `POST /projects` validation before pool (8381fbb, a2e8f17). OAuth URL includes `prompt=select_account`.
> - Client: `signOut()` clears `sessionStorage` OAuth state and invalidates Supabase session (GitHub App connection persists — no re-auth needed on next login). Settings shows App connection from `/auth/me` with explicit Disconnect via `DELETE /github/connection`. Import shows linked `@username` and reconnect CTA.

---

## Table of contents

| # | Title | P | State | Fix status |
|---|-------|---|-------|------------|
| 1 | encrypt('') does not round-trip through decrypt() | P4 | Open | — |
| 2 | requireProjectAccess did not catch DB query errors | P2 | Closed | Fixed |
| 3 | GitHub routes fail when github-app.pem is missing | P1 | Open | — |
| 4 | Signup does not validate email format server-side | P3 | Open | — |
| 5 | Signup password minimum mismatches frontend (6 vs 8) | P3 | Open | — |
| 6 | ProjectContext fetchProject missing useCallback deps | P3 | Open | — |
| 7 | apiFetch sends Content-Type on GET requests | P4 | Open | — |
| 8 | GitHub repos rejects installation_id=0 | P3 | Open | — |
| 9 | Project settings uses fragile dynamic SQL pattern | P2 | Open | — |
| 10 | Project delete relies on CASCADE without verification | P3 | Open | — |
| 11 | Team member removal uses confusing double /members/ path | P2 | Open | — |
| 12 | App.test.tsx broken after auth routing refactor | P2 | Closed | Fixed |
| 13 | saveGithubTokenFromSession / save-token flow | P4 | Closed | Fixed |
| 14 | InvitationsPage error persists across operations | P3 | Open | — |
| 15 | CORS falls back to localhost when CORS_ORIGIN unset | P3 | Open | — |
| 16 | Mark as Reviewed was UI-only (did not persist) | P2 | Closed | Fixed |
| 17 | Analysis generates onboarding for all 5 roles, not just selected role | P2 | Closed | Fixed (M3) |
| 18 | GitHub OAuth can link wrong GitHub account | P3 | Closed | Fixed |
| 19 | Regenerate section is a UI stub | P3 | Closed | Fixed (M3) |
| 20 | Package export was a frontend alert stub | P3 | Closed | Fixed |
| 21 | graphBuilder did not resolve .js imports to .ts sources | P3 | Closed | Fixed |
| 22 | OnboardingPage swallows role-status fetch errors | P4 | Open | — |
| 23 | GraphPage tests relied on DEV mock fallback | P4 | Closed | Fixed |
| 24 | No per-route React error boundaries | P5 | Open | — |
| 25 | graphBuilder edge tests could pass vacuously when edges empty | P5 | Open | — |
| 26 | Architecture tab is a placeholder stub | P3 | Closed | Fixed (M3) |
| 27 | LLM evidence context ignores role when loading critical rankings | P3 | Closed | Fixed (M3) |
| 28 | Incremental re-analysis helpers not wired into worker | P3 | Closed | Fixed (M3) |
| 29 | Workflow extraction is dependency BFS, not Design.md call-flow | P5 | Closed | Fixed (M3) |
| 30 | Analysis progress bar shows random/backwards percentages | P2 | Closed | Fixed (M3) |
| 31 | Semantic-record cache: refinement records superseded base records | P2 | Closed | Fixed (M3) |
| 32 | Refined records lost their original code receipts | P2 | Closed | Fixed (M3) |
| 33 | DEV mock fallbacks masked real API failures | P3 | Closed | Fixed (M3) |
| 34 | Graph layout stacked nodes / rendered a line of nodes | P2 | Closed | Fixed (M3) |
| 35 | Inline code in onboarding markdown shows decorative backticks | P4 | Closed | Fixed (M3) |
| 36 | Stale tutorials cannot be regenerated individually | P5 | Open | — |
| 37 | GitHub sign-up fails: "Error getting user profile from external provider" | P1 | Open | Frontend part fixed; Supabase config pending |
| 38 | Semantic analysis extremely slow (23 min analyze + 10 min generate) and ~$2/run | P1 | Closed | Fixed (M3) |
| 39 | Workflow extraction finds 0 workflows on real repos (alias imports + fake route entrypoints) | P1 | Closed | Fixed (M3) |
| 40 | Onboarding section titles not standardized (raw type strings / LLM-invented) | P3 | Closed | Fixed (M3) |
| 41 | Sections invisible until the whole generation finishes | P3 | Closed | Fixed (M3) |
| 42 | Dashboard project card shows hardcoded 45% while analyzing | P2 | Closed | Fixed (M3) |
| 43 | Ranking-weight sliders always show 0; budget defaults opaque | P2 | Closed | Fixed (M3) |
| 44 | Section confidence used worst-case rule — sections almost always "low" | P2 | Closed | Fixed (M3) |
| 45 | Receipts cited by raw UUIDs — small models mangle them, causing citation failures | P2 | Closed | Fixed (M3) |
| 46 | Class-method route handlers yield 0 workflows (CourseInsights) | P1 | Closed | Fixed (M3) |
| 47 | AI & privacy setting changes ignored by generation; ai_disabled blocks packages entirely | P2 | Closed | Fixed (M3) |
| 48 | Regenerate failures invisible: silent UI catch, sections stuck in regenerate_requested | P2 | Closed | Fixed (M3) |
| 49 | Tours never re-appear for new accounts; package/lifecycle tour never auto-starts | P3 | Closed | Fixed (M3) |
| 50 | Runs are untrustworthy: phantom phase durations, dead workers look alive, no pause/stop/resume | P1 | Closed | Fixed (M3) |
| 51 | Receipt UX: unbounded snippets, no symbol explanation, reviewer shown as UUID | P3 | Closed | Fixed (M3) |
| 52 | Incremental re-analysis: doc changes never stale anything; binary files false-churn; short SHAs fork snapshots | P2 | Closed | Fixed (M3) |

### What has been fixed

**Closed — fully fixed (8):**

| # | What was fixed |
|---|----------------|
| 2 | `requireProjectAccess` wrapped in try/catch; invalid project IDs return 500 JSON |
| 12 | `App.test.tsx` rewritten with Supabase mock and correct routes |
| 13 | `save-token` endpoint and `saveGithubToken.ts` removed; token save via `POST /github/oauth/complete` |
| 16 | Mark Reviewed persists via `PATCH /onboarding/sections/:sectionId/review` |
| 18 | IDOR, identity mismatch, duplicate linking, pool ordering fixed server-side; OAuth forces account picker (`prompt=select_account`), Settings shows App connection + explicit disconnect, Import shows linked `@username` |
| 20 | Export downloads Markdown from `GET /onboarding/export` |
| 21 | `graphBuilder` resolves `.js` imports to `.ts`/`.tsx` sources |
| 23 | `GraphPage` tests use explicit `vi.mock` instead of DEV fallback |

**Won't fix (1):** #29 — BFS workflow extraction accepted as M2 scope; full call-flow deferred to M3.

**Open — not yet fixed (20):** #1, #3–#11, #14–#15, #17, #19, #22, #24–#28

---

## [P4][Open] Bug 1: encrypt('') does not round-trip through decrypt()

**Bug #1**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Open |
| File / area | backend/src/lib/encryption.ts |

## Expected behavior

encrypt('') either rejects empty input or decrypt handles empty ciphertext.

## Actual behavior

encrypt produces iv:tag: with empty ciphertext; decrypt throws Invalid encrypted string format.

## Steps to reproduce

Call encrypt('') then decrypt(result) in a REPL or unit test.

## Notes

Low impact — tokens never empty in production.

---

## [P2][Closed] Bug 2: requireProjectAccess did not catch DB query errors

**Bug #2**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | backend/src/api/middleware/project-access.ts |

## Expected behavior

Invalid project IDs or DB failures should return 500 JSON, not crash the request.

## Actual behavior

query() was uncaught; non-UUID project IDs could throw.

## Steps to reproduce

GET /api/projects/not-a-uuid with valid auth token.

## Notes

**Fixed:** Wrapped middleware in try/catch; returns 500.

---

## [P1][Open] Bug 3: GitHub routes fail when github-app.pem is missing

**Bug #3**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Open |
| File / area | backend/src/lib/github.ts (createAppJwt) |

## Expected behavior

Missing PEM should return a clear 500 JSON error without crashing the process.

## Actual behavior

fs.readFileSync(privateKeyPath) throws ENOENT when GITHUB_APP_PRIVATE_KEY_PATH is wrong or the file is absent. Request fails with a generic 500.

## Steps to reproduce

Remove or misconfigure backend/github-app.pem → GET /api/github/installations with valid auth.

## Notes

Hit during local dev. Error not actionable for TAs.

---

## [P3][Open] Bug 4: Signup does not validate email format server-side

**Bug #4**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Open |
| File / area | backend/src/api/routes/auth.ts |

## Expected behavior

Malformed emails rejected with 400 before Supabase call.

## Actual behavior

Any non-empty string forwarded to Supabase; error messages inconsistent.

## Steps to reproduce

POST /api/auth/signup with "email":"notanemail".

## Notes

Add regex or validator matching frontend expectations.

---

## [P3][Open] Bug 5: Signup password minimum mismatches frontend (6 vs 8)

**Bug #5**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Open |
| File / area | backend/src/api/routes/auth.ts |

## Expected behavior

API rejects passwords shorter than 8 characters.

## Actual behavior

Supabase minimum is 6; API accepts shorter passwords than the signup form.

## Steps to reproduce

POST /api/auth/signup with password "abc123" (6 chars) via curl.

## Notes

Align server validation with frontend minLength={8}.

---

## [P3][Open] Bug 6: ProjectContext fetchProject missing useCallback deps

**Bug #6**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Open |
| File / area | frontend/src/contexts/ProjectContext.tsx |

## Expected behavior

Effect dependencies should be exhaustive; refetch uses current projectId.

## Actual behavior

fetchProject recreated each render; useEffect depends only on [projectId]. Works in practice but triggers exhaustive-deps warnings.

## Steps to reproduce

Enable eslint-plugin-react-hooks exhaustive-deps on ProjectContext.tsx.

## Notes

Wrap fetchProject in useCallback or inline fetch in effect.

---

## [P4][Open] Bug 7: apiFetch sends Content-Type on GET requests

**Bug #7**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Open |
| File / area | frontend/src/lib/api.ts |

## Expected behavior

Content-Type: application/json only when body present.

## Actual behavior

Header set on all requests including GET.

## Steps to reproduce

Inspect network tab on any GET from the app.

## Notes

Most servers ignore; technically incorrect HTTP.

---

## [P3][Open] Bug 8: GitHub repos rejects installation_id=0

**Bug #8**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Open |
| File / area | backend/src/api/routes/github.ts |

## Expected behavior

installation_id=0 should be validated with Number.isFinite / parseInt, not truthiness.

## Actual behavior

Number("abc") → NaN correctly 400, but installation_id=0 treated as missing (0 is falsy).

## Steps to reproduce

GET /api/github/repos?installation_id=0 with valid auth.

## Notes

Use explicit NaN / integer parsing.

---

## [P2][Open] Bug 9: Project settings uses fragile dynamic SQL pattern

**Bug #9**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Open |
| File / area | backend/src/api/routes/projects.ts |

## Expected behavior

Only whitelisted setting fields should be writable.

## Actual behavior

PUT builds SET clauses from request body fields. Current code reads named fields only (safe today) but the pattern is easy to break when adding fields.

## Steps to reproduce

N/A — code review concern; no exploit today.

## Notes

Refactor to an explicit allowlist map before M3.

---

## [P3][Open] Bug 10: Project delete relies on CASCADE without verification

**Bug #10**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Open |
| File / area | backend/src/api/routes/projects.ts + migrations |

## Expected behavior

Deleting a project removes all related jobs, snapshots, packages.

## Actual behavior

DELETE relies on DB CASCADE; orphaned rows possible if any FK lacks ON DELETE CASCADE.

## Steps to reproduce

Audit 001_initial_schema.sql FKs referencing projects.id.

## Notes

Add explicit cleanup or migration audit before production.

---

## [P2][Open] Bug 11: Team member removal uses confusing double /members/ path

**Bug #11**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Open |
| File / area | frontend/src/pages/TeamPage.tsx |

## Expected behavior

DELETE should use a clear REST path such as /projects/:id/members/:userId.

## Actual behavior

Frontend calls DELETE /projects/:id/members/members/:userId. Works with current routes but is error-prone.

## Steps to reproduce

Open Team tab → Remove a member → Inspect network tab — path contains /members/members/.

## Notes

Consider flattening API route in a future refactor.

---

## [P2][Closed] Bug 12: App.test.tsx broken after auth routing refactor

**Bug #12**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | frontend/src/App.test.tsx |

## Expected behavior

Routing tests pass with auth mocks.

## Actual behavior

Test looked for Projects heading on unauthenticated intro page.

## Steps to reproduce

npm run test -w frontend (old test).

## Notes

**Fixed:** Rewrote tests with Supabase mock and correct routes.

---

## [P4][Closed] Bug 13: saveGithubTokenFromSession / save-token flow

**Bug #13**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Closed |
| File / area | frontend/src/lib/saveGithubToken.ts (removed), POST /auth/github/save-token (removed) |

## Expected behavior

Repo import uses a GitHub App user token saved server-side after OAuth code exchange.

## Actual behavior

Two problems in the old save-token flow:

1. `if (!githubUserId)` returns early; `0` is falsy (GitHub IDs start at 1) — theoretical only.
2. Frontend sent Supabase login `provider_token` to `POST /auth/github/save-token`; backend stored it without verification. Wrong OAuth app — token incompatible with `/user/installations`.

## Steps to reproduce

1. Sign in with GitHub via Supabase on /login — observe `saveGithubTokenFromSession` POST to `/auth/github/save-token`.
2. Open Import — GitHub App authorization still required; stored token unusable for installations.

## Notes

**Fixed:** Endpoint `POST /auth/github/save-token` and `saveGithubToken.ts` removed. Token save moved to `POST /github/oauth/complete` → `saveGithubConnection()`. Original `provider_id` check is moot with file removal. References cleaned from `FRONTEND.md` and `TESTING.md`.

---

## [P3][Open] Bug 14: InvitationsPage error persists across operations

**Bug #14**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Open |
| File / area | frontend/src/pages/InvitationsPage.tsx |

## Expected behavior

Error banner clears when starting a new accept/decline.

## Actual behavior

Failed accept leaves error visible when selecting another invitation.

## Steps to reproduce

Cause network error on accept → Click a different invitation.

## Notes

Call setError('') at start of handleAccept / handleDecline.

---

## [P3][Open] Bug 15: CORS falls back to localhost when CORS_ORIGIN unset

**Bug #15**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Open |
| File / area | backend/src/api/app.ts |

## Expected behavior

Production requires explicit CORS_ORIGIN.

## Actual behavior

Defaults to http://localhost:5173 if env missing — blocks real deployment origin.

## Steps to reproduce

Deploy without CORS_ORIGIN; browser requests from production domain blocked.

## Notes

Log warning in production when fallback used.

---

## [P2][Closed] Bug 16: Mark as Reviewed was UI-only (did not persist)

**Bug #16**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | frontend/src/pages/OnboardingPage.tsx + onboarding routes |

## Expected behavior

Mark Reviewed should PATCH review_status in the database.

## Actual behavior

Button toggled local React state only; status reset on refresh/role switch.

## Steps to reproduce

Open onboarding section → Click Mark Reviewed → Refresh page — status lost.

## Notes

**Fixed:** Added PATCH /sections/:sectionId/review and wired frontend.

---

## [P2][Closed] Bug 17: Analysis generates onboarding for all 5 roles, not just selected role

**Bug #17**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | backend/src/worker/summaryWorker.ts (~line 537) |

## Expected behavior

Importing with role General (or any single role) should generate one onboarding package.

## Actual behavior

After primary role completes, worker enqueues generate_onboarding jobs for all remaining roles (backend, frontend, devops, qa, general).

## Steps to reproduce

Import repo choosing role General Dev → Run analysis → Check analysis_jobs / onboarding_packages — all 5 roles queued.

## Notes

Observed in testing: 3+ developer packages appear immediately. Increases OpenRouter cost and confuses users.


**Fix notes (2026-07-10):** Fixed in M3: the 5-role fan-out was removed from summaryWorker; packages now generate only for the requested role. Other roles generate on demand via POST /projects/:id/onboarding/generate {role}, reusing the latest snapshot (no re-analysis). UI: "Generate for <role>" button in the onboarding reader.

---

## [P3][Closed] Bug 18: GitHub OAuth can link wrong GitHub account

**Bug #18**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | frontend/src/contexts/AuthContext.tsx, frontend/src/pages/AccountSettingsPage.tsx, frontend/src/pages/ImportPage.tsx, backend/src/api/routes/auth.ts, backend/src/api/routes/github.ts, backend/src/api/routes/projects.ts, backend/src/lib/github-connection.ts |

## Expected behavior

- GitHub account linked to Supabase user matches the user initiating connect.
- User A sees only their GitHub installations and repos; cannot pass another user's `installation_id`.
- One GitHub account maps to one OnboardBuddy account; email users cannot swap GitHub identity on re-auth.
- Users who signed in with GitHub must authorize the same `@username` for GitHub App OAuth.
- Invalid or foreign `github_installation_id` on `POST /projects` returns 403 without touching the database.
- Logout clears GitHub tokens and connections; OAuth forces explicit account selection.

## Actual behavior

Several related failures in the GitHub link / repo-import path:

1. **Browser / UX:** Stale GitHub OAuth session can authorize a different account during repo import. Tokens persist across sign-out. Repro intermittent.
2. **IDOR (P0 severity):** `GET /github/installations` listed all app installations globally. Any logged-in user could call `GET /github/repos?installation_id=<victim>` on shared deployments (Replit/Docker) and read another user's repos.
3. **Identity mismatch:** `POST /github/oauth/complete` accepted any GitHub account — e.g. Supabase user `@alice` could link App OAuth as `@bob`.
4. **Duplicate linking:** Same GitHub user could link to multiple OnboardBuddy accounts, or overwrite connection with a different GitHub user on re-auth.
5. **Project create ordering:** `POST /projects` called `pool.connect()` before `userCanAccessInstallation()` — foreign `installation_id` could 500 instead of 403 when DB unavailable.

## Steps to reproduce

**Symptom (original):** Sign in with email/password → Connect GitHub while another GitHub session is active in browser → Import repo — wrong account may appear.

**IDOR:** User A imports private repo → User B on same deployment calls `GET /api/github/installations` and sees User A's installations → `GET /api/github/repos?installation_id=<A's id>` returns User A's repos.

**Identity mismatch:** Log in as `@alice` via Supabase → Complete GitHub App OAuth as `@bob` → Connection saved for `@bob`.

**Duplicate link:** Link `@alice` to account A → Link same `@alice` to account B — succeeds.

## Notes

**Fixed — server-side (commits 8381fbb, a2e8f17):** Per-user `listInstallationsForUser()` + `getInstallationTokenForUser()`; `userCanAccessInstallation()` on repos/branches and `POST /projects`; `assertAuthorizedGitHubMatchesSupabaseIdentity()` and `assertGithubAccountCanBeLinked()` on oauth/complete; installation check moved before `pool.connect()`.

**Fixed — client-side:** `signOut()` clears `sessionStorage` OAuth state and invalidates Supabase session; GitHub App connection persists so the user does not need to re-authorize on next login. OAuth URL includes `prompt=select_account` to force explicit GitHub account selection. `AccountSettingsPage` shows GitHub App connection (from `/auth/me`) with explicit Disconnect via `DELETE /github/connection`. `ImportPage` displays linked `@username`. Error with "reconnect" shows CTA to re-authorize.

---

## [P3][Closed] Bug 19: Regenerate section is a UI stub

**Bug #19**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | frontend/src/pages/OnboardingPage.tsx handleRegenerateSection |

## Expected behavior

Regenerate should call backend to re-run AI for the section.

## Actual behavior

setTimeout(1500) only — no API call.

## Steps to reproduce

Click Regenerate on any onboarding section — no network request.

## Notes

Wire to future regenerate endpoint or hide button until implemented.


**Fix notes (2026-07-10):** Fixed in M3 (Phase 10): the button now calls POST /onboarding/sections/:id/regenerate, which queues a regenerate_section job; stale sections rebuild against the newest snapshot into the same package, and the UI polls until the new section lands.

---

## [P3][Closed] Bug 20: Package export was a frontend alert stub

**Bug #20**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | frontend/src/pages/OnboardingPage.tsx + onboarding routes |

## Expected behavior

Export downloads Markdown from API.

## Actual behavior

alert() mock only.

## Steps to reproduce

Click Export on onboarding page.

## Notes

**Fixed:** GET /export endpoint + browser download wired in OnboardingPage.

---

## [P3][Closed] Bug 21: graphBuilder did not resolve .js imports to .ts sources

**Bug #21**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | backend/src/worker/engine/graphBuilder.ts resolveSpecifier |

## Expected behavior

NodeNext .js specifiers resolve to .ts fixture files.

## Actual behavior

Dependency edges empty for ESM projects using .js extensions in imports.

## Steps to reproduce

Run graphBuilder tests on simple fixture before fix — 9 tests skipped/failing.

## Notes

**Fixed:** Strip .js and try .ts/.tsx in resolveSpecifier. Tests unskipped.

---

## [P4][Open] Bug 22: OnboardingPage swallows role-status fetch errors

**Bug #22**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Open |
| File / area | frontend/src/pages/OnboardingPage.tsx |

## Expected behavior

Failed role status poll shows error or stops polling.

## Actual behavior

.catch(() => {}) hides failures silently.

## Steps to reproduce

Break API during onboarding page load — no user-visible error.

## Notes

Surface toast or inline error state.

---

## [P4][Closed] Bug 23: GraphPage tests relied on DEV mock fallback

**Bug #23**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Closed |
| File / area | frontend/src/pages/GraphPage.test.tsx |

## Expected behavior

Tests mock fetchDependencyGraph explicitly.

## Actual behavior

Tests passed only when import.meta.env.DEV triggered mock data path.

## Steps to reproduce

Run frontend tests in production-like env without mocks.

## Notes

**Fixed:** Explicit vi.mock of graphData / apiFetch.

---

## [P5][Open] Bug 24: No per-route React error boundaries

**Bug #24**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P5 |
| State | Open |
| File / area | frontend/src/App.tsx |

## Expected behavior

Feature routes isolate render errors.

## Actual behavior

Only top-level ErrorBoundary; one broken page can blank entire app.

## Steps to reproduce

N/A — enhancement.

## Notes

Future: wrap project layout routes.

---

## [P5][Open] Bug 25: graphBuilder edge tests could pass vacuously when edges empty

**Bug #25**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P5 |
| State | Open |
| File / area | backend/src/worker/engine/tests/graphBuilder.test.ts |

## Expected behavior

Edge assertions fail when graph has no edges (regression signal).

## Actual behavior

Before Bug 21 fix, some tests passed with 0 edges.

## Steps to reproduce

Review tests that use graph.edges.length >= 0 style assertions.

## Notes

Partially mitigated by Bug 21 fix; keep monitoring.

---

## [P3][Closed] Bug 26: Architecture tab is a placeholder stub

**Bug #26**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | frontend/src/App.tsx route architecture → EmptyStubPage |

## Expected behavior

Architecture tab shows architecture visualization.

## Actual behavior

Route renders EmptyStubPage with title Architecture only.

## Steps to reproduce

Open project → Architecture tab.


**Fix notes (2026-07-10):** Fixed in M3 (Phase 10): the Architecture tab renders server-side deterministic clusters (architecture_clusters/-edges) as an interactive layered graph with AI/deterministic summaries, criticality bars, and a detail panel.

---

## [P3][Closed] Bug 27: LLM evidence context ignores role when loading critical rankings

**Bug #27**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | backend/src/worker/summaryWorker.ts buildContext (~line 172) |

## Expected behavior

Critical rankings in evidence bundle filtered by requested onboarding role.

## Actual behavior

Query selects top rankings for snapshot without WHERE role = $role.

## Steps to reproduce

Generate backend package; inspect evidence context / DB — rankings from all roles mixed in.

## Notes

Role packages differ mainly via prompts; ranking context is not role-filtered.


**Fix notes (2026-07-10):** Fixed in M3: the old buildContext path was replaced by the retrieval service + role projections; criticality is projected per role via ranking_weight_configs and used in retrieval boosts and section context.

---

## [P3][Closed] Bug 28: Incremental re-analysis helpers not wired into worker

**Bug #28**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | backend/src/worker/engine/sectionValidator.ts + worker/index.ts |

## Expected behavior

Re-analysis run compares receipt hashes and marks sections stale.

## Actual behavior

checkReceiptStaleness / createStaleFlags exist but are not called from analysis worker pipeline.

## Steps to reproduce

Run analysis → Change code, re-analyze same project → Stale flags may not auto-update.

## Notes

Unit tests cover helpers; end-to-end re-analysis incomplete.


**Fix notes (2026-07-10):** Fixed in M3 (Phase 9): incrementalAnalyzer is wired into every re-analysis — file/symbol AST diff, evidence-hash upward invalidation, stale_flags on records/sections/tutorials/packages, on-request regeneration.

---

## [P5][Closed] Bug 29: Workflow extraction is dependency BFS, not Design.md call-flow

**Bug #29**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P5 |
| State | Closed |
| File / area | backend/src/worker/engine/workflowExtractor.ts |

## Expected behavior

Generic call-flow tracing per Design.md.

## Actual behavior

BFS over dependency edges from entry points, max 15 steps, max 5 deps per node.

## Steps to reproduce

N/A — documented limitation for M2.

## Notes

Accepted M2 scope gap. Walkthrough UI works on simplified extraction. Full call-flow deferred to M3.


**Fix notes (2026-07-10):** Reopened and fixed in M3 (Phase 3): workflow extraction is now a real call-graph traversal (entrypoint → calls/handles_route/enqueues_job edges → side effects) with step kinds and deterministic descriptions, per doc/Pipeline.md.

---

## [P2][Closed] Bug 30: Analysis progress bar shows random/backwards percentages

**Bug #30**

| Field | Value |
|-------|-------|
| Date created | 2026-07-10 |
| Reported by | OnboardBuddies (Team 15, user report) |
| Priority | P2 |
| State | Closed |
| File / area | frontend/src/pages/ProjectOverviewPage.tsx, backend analysis-status route |

## Expected behavior

One progress bar that advances monotonically from 0 to 100% across the whole pipeline, with a clear statement of what is running.

## Actual behavior

The bar appeared to jump to random values and move backwards: each pipeline job (analysis, then up to five generation jobs) was its own 0-100% bar, and the UI flipped between whichever job was newest.

## Steps to reproduce

Import a repo → run analysis → watch the Overview progress bar as the analysis job completes and generation jobs start; the percentage drops from 100 back to a low number repeatedly.

## Notes during fixing

Root causes: (1) 5-role generation fan-out created five sequential jobs (bug #17); (2) `jobs[0]` was ordered by created_at only, so a queued job could shadow the running one; (3) analysis and generation each reported their own 0-100%. Fixed by removing the fan-out, ordering active jobs first in `/analysis-status`, and mapping analysis to 0-70% / generation to 70-100% with a stage label ("Analyzing code — …", "Generating onboarding — …"). A live activity list under the bar now shows the current step and the recent step trail with timestamps.

---

## [P2][Closed] Bug 31: Semantic-record cache: refinement records superseded base records

**Bug #31**

| Field | Value |
|-------|-------|
| Date created | 2026-07-08 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | backend/src/worker/semantic/recordStore.ts insertRecord |

## Expected behavior

Re-analyzing unchanged code should hit the content-addressed record cache — unchanged symbols are never re-paid.

## Actual behavior

`insertRecord` marked records of *different prompt versions* superseded, so refinement-v1 records invalidated the base symbol-record-v1 records; the next run cache-missed on every refined symbol and re-paid LLM calls.

## Steps to reproduce

Run the semantic pipeline twice on the same commit (e2e-phase5 script); observe cache misses for all refined symbols on the second run.

## Notes during fixing

Caught by the Phase 5 end-to-end caching checks. Fix: supersede only within the *same* prompt_version when evidence hash or model family differs — different prompt versions layer, never invalidate each other.

---

## [P2][Closed] Bug 32: Refined records lost their original code receipts

**Bug #32**

| Field | Value |
|-------|-------|
| Date created | 2026-07-08 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | backend/src/worker/semantic/refinementPass.ts |

## Expected behavior

A refined record replaces the base record in the snapshot mapping but keeps the base record's code receipts, so citation validation can still bottom out in code.

## Actual behavior

Refined records carried only record_reference receipts; sections citing them failed trust resolution and were downgraded to low confidence.

## Steps to reproduce

Generate sections for a snapshot with refined records (e2e-phase6 script); observe validation downgrades on claims citing refined records.

## Notes during fixing

Fix: the refinement pass unions the original record's receipt ids into the refined record. A related validator fix treats facts-only records as code-trust when resolving reference chains.

---

## [P3][Closed] Bug 33: DEV mock fallbacks masked real API failures

**Bug #33**

| Field | Value |
|-------|-------|
| Date created | 2026-07-10 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | frontend/src/lib/graphData.ts, frontend/src/lib/onboardingData.ts |

## Expected behavior

A failed API call shows the honest error/empty state so problems are visible during development and demos.

## Actual behavior

In dev builds, dependency-graph and onboarding fetch failures silently fell back to hardcoded mock data, hiding backend errors and showing fake content.

## Steps to reproduce

Run the frontend in dev with the backend stopped → open Dependencies or Onboarding → mock data rendered as if real.

## Notes during fixing

M3 finalizes features: mock fallbacks removed along with the mock data files, the dead stub pages (EmptyStubPage, WalkthroughPage), and the hardcoded "Role packages" card on Overview (now backed by the packages endpoint).

---

## [P2][Closed] Bug 34: Graph layout stacked nodes / rendered a line of nodes

**Bug #34**

| Field | Value |
|-------|-------|
| Date created | 2026-07-10 |
| Reported by | OnboardBuddies (Team 15, user report) |
| Priority | P2 |
| State | Closed |
| File / area | frontend/src/lib/graphLayout.ts |

## Expected behavior

Graph tabs show a readable graph: grouped, spaced nodes with visible edge flow.

## Actual behavior

The hand-rolled longest-path layout pushed most nodes into deep single-node columns (a horizontal line of nodes) and stacked all disconnected nodes on top of each other at the same coordinates.

## Steps to reproduce

Open Dependencies or Architecture on any repo with disconnected files; nodes overlap at the far end of the canvas.

## Notes during fixing

Replaced with dagre (Sugiyama layered layout): rank assignment, crossing minimization, and side-by-side packing of disconnected components. All four graph tabs share the new `layoutGraph`.

---

## [P4][Closed] Bug 35: Inline code in onboarding markdown shows decorative backticks

**Bug #35**

| Field | Value |
|-------|-------|
| Date created | 2026-07-10 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Closed |
| File / area | frontend prose styles (@tailwindcss/typography defaults) |

## Expected behavior

Inline code like `authService.ts` renders as a code chip without literal backtick characters.

## Actual behavior

The typography plugin's default adds decorative backtick pseudo-elements before/after inline code, which reads as noise inside the code-chip background.

## Steps to reproduce

Open any onboarding section containing inline code; backticks are visible around code spans.

## Notes during fixing

Fixed (2026-07-10): prose override `prose-code:before:content-none prose-code:after:content-none` applied to the onboarding reader.

---

## [P5][Open] Bug 36: Stale tutorials cannot be regenerated individually

**Bug #36**

| Field | Value |
|-------|-------|
| Date created | 2026-07-10 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P5 |
| State | Open |
| File / area | backend tutorials routes / summaryWorker |

## Expected behavior

A stale tutorial offers a Regenerate action like stale sections do.

## Actual behavior

Incremental analysis marks tutorials stale, but regeneration currently only exists per-section; a stale tutorial refreshes only with a full package regeneration.

## Steps to reproduce

Change a file on a tutorial's path → incremental re-analysis → tutorial shows stale with no regenerate button.

## Notes during fixing

Future work: mirror the regenerate_section flow for tutorials (queue job, rebuild against latest snapshot, settle package staleness including tutorials).

---

## [P1][Open] Bug 37: GitHub sign-up fails with "Error getting user profile from external provider"

**Bug #37**

| Field | Value |
|-------|-------|
| Date created | 2026-07-10 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Open |
| File / area | Supabase GitHub auth provider config; frontend/src/pages/AuthCallbackPage.tsx |

## Expected behavior

"Sign up with GitHub" completes and lands on the dashboard; if the provider fails, the callback page explains what went wrong.

## Actual behavior

Supabase redirects back to `/auth/callback?error=server_error&error_code=unexpected_failure&error_description=Error+getting+user+profile+from+external+provider`. The callback page ignored the error params and showed a "Completing sign in..." spinner forever; the only clue was the raw URL.

## Steps to reproduce

1. Open the login or signup page → **Sign up with GitHub** → authorize.
2. GitHub redirects to Supabase, Supabase redirects back with the error above.

## Notes during fixing

Two independent problems:

1. **Frontend (fixed 2026-07-10):** `AuthCallbackPage` never read `error`/`error_description` from the callback URL (Supabase puts them in both the query string and the hash). It now surfaces the message with a hint to use email/password signup and connect GitHub later from Account Settings.
2. **Supabase provider config (open):** the error means Supabase's GoTrue exchanged the OAuth code successfully but could not fetch the user's profile/email from GitHub. Likeliest causes, in order:
   - The Supabase GitHub provider was configured with the **GitHub App's** client ID/secret (client ID starts with `Iv1.`) instead of a dedicated **OAuth App** (DEVOPS.md §3). A GitHub App token cannot read the user's email addresses unless the App has **Account permissions → Email addresses: Read-only**, so profile fetch fails exactly this way.
   - The OAuth App client secret in the Supabase dashboard was rotated/mistyped.

   Fix: in Supabase → Authentication → Providers → GitHub, make sure the Client ID/Secret belong to the login **OAuth App** from DEVOPS.md "GitHub OAuth App (for login)" (create one if missing). If the team intentionally reuses the GitHub App for login instead, grant it "Email addresses: Read-only" under Account permissions and have users re-authorize. Email/password signup is unaffected either way.

---

## [P1][Closed] Bug 38: Semantic analysis extremely slow and expensive (~33 min, ~$2 per run)

**Bug #38**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Closed |
| File / area | backend/src/worker/semantic/*, generation/*, ai/aiClient.ts |

## Expected behavior

A small-to-medium repo analyzes in minutes for well under a dollar.

## Actual behavior

Whole-repo run: analyze scope 23 min, generation 10 min, ~$1.74. Phase timings from the real run: synthesis 627s, refinement 198s, symbols 176s, critique 150s, reranking 144s, generation 601s.

## Steps to reproduce

Import a ~100-file repo, run a standard-depth analysis, watch snapshot_phases timings and ai_generation_runs costs.

## Notes during fixing

Fixed (2026-07-11). Three root causes:

1. **Everything was serial.** Every pass awaited one LLM call at a time even though AiClient already had a concurrency semaphore. Now all passes fan out via `mapLimit` (symbol batches, file/module/service/workflow synthesis, critique batches, refinement, reranking, embeddings, sections, tutorials); `LLM_MAX_CONCURRENCY` default raised 4→6, `PG_POOL_MAX` 10→20.
2. **Bulk work ran on the strong tier.** File records (26 calls, $0.30) and critique (every pending record, $0.22) moved to the cheap tier; refinement is depth-gated (0/5/10 for cheap/standard/full).
3. **Thousands of sequential round trips to remote Postgres.** Cache lookups parallelized; embeddings write one multi-row INSERT per batch instead of one INSERT per vector; critique fetches a batch's receipts in one query.

Expected effect on the same run: analysis LLM phases ~23 min → ~4 min, generation ~10 min → ~3 min, cost ~$1.74 → ~$1.05 (sections stay on the strong tier — that's the user-facing artifact). Re-runs stay near-free via the content-addressed cache.

---

## [P1][Closed] Bug 39: Workflow extraction finds 0 workflows on real repos

**Bug #39**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Closed |
| File / area | engine/astParser.ts, evidenceGraphBuilder.ts, entrypointDetector.ts, symbolExtractor.ts, new tsconfigPaths.ts |

## Expected behavior

Real repos produce traced workflows (Workflows tab, tutorials, workflow records) with correct titles.

## Actual behavior

A whole-repo run produced **0 workflows** despite 9 HTTP entrypoints and 11 side effects — only 19 `calls` edges existed in a 437-node graph, so no trace ever reached an effect. Tutorials: 0. Most sections: low confidence (starved of evidence).

## Steps to reproduce

Analyze any monorepo using tsconfig path aliases (`@/components/x`); check `graph_edges` type counts and the workflows table.

## Notes during fixing

Fixed (2026-07-11). Compound root cause:

1. **Path aliases resolved as fake packages.** The worker analyzes a zipball with no node_modules and often no root tsconfig.json; the TS program fell back to Node10 resolution with no `paths`, and our own import resolver treated `@/lib` as a scoped npm package. New `tsconfigPaths.ts` merges `paths` from every workspace tsconfig, rebased to the repo root; the program now uses Bundler resolution with those paths, and `resolveImport` tries aliases before classifying imports external.
2. **Route entrypoints were name-matched garbage.** Any `*.get(...)` call (`map.get`, `headers.get`) counted as an HTTP route — 285 fake entrypoints on this repo, with wrong seeds producing titles like "GET runSynthesisPass". Route registrations are now AST-detected (`router.get('/x', handler)` with a string path), inline handlers become synthesized symbols (named `GET /x`) with real bodies/hashes/resolved calls, and titles use the actual route pattern.
3. **Frontend components were invisible to the call graph.** JSX usage (`<UserCard/>`) now resolves as a call edge, and exported page components under `pages/` are `ui_route` entrypoints — frontend repos get UI flows.

Verified on this repo (clean copy, no node_modules): calls edges 19-equivalent → **1057**, imports 442 → 707, entrypoints 285 → 90 (real kinds), workflows 0 → **76** with titles like "POST /installations/link" and "Page: GraphPage". All 302 backend tests pass.

---

## [P3][Closed] Bug 40: Onboarding section titles not standardized

**Bug #40**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | generation/sectionSpecs.ts, sectionGenerator.ts |

## Expected behavior

Every package shows the same set of section titles.

## Actual behavior

Half the sections showed raw type strings ("entry_points", "role_path"), the rest LLM-invented titles ("Start Here: OnboardBuddy Platform Orientation").

## Notes during fixing

Fixed (2026-07-11): canonical `SECTION_TITLES` map (Design.md package structure) — the LLM's title suggestion is ignored on persist.

---

## [P3][Closed] Bug 41: Sections invisible until the whole generation finishes

**Bug #41**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | frontend OnboardingPage.tsx |

## Expected behavior

Sections appear in the reader as each one is generated.

## Actual behavior

The worker persists each section immediately, and the API serves them — but the reader fetched once and never refreshed, so nothing showed until the run finished.

## Notes during fixing

Fixed (2026-07-11): the reader polls every 5s while the package is generating (with a "sections appear as each one finishes (N/11)" banner); the card grid refreshes while anything is generating. Sections also now generate 4 at a time, so the first ones land within seconds.

---

## [P2][Closed] Bug 42: Dashboard project card shows hardcoded 45% while analyzing

**Bug #42**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | frontend ProjectCard.tsx, lib/pipelineProgress.ts |

## Expected behavior

The dashboard card and the project overview show the same progress.

## Actual behavior

The card showed a fixed "Analyzing 45%" regardless of actual progress.

## Notes during fixing

Fixed (2026-07-11): the combined pipeline progress (analysis 0–70%, generation 70–100%, stage-labeled) was extracted into shared `pipelineProgress()`; analyzing cards poll `/analysis-status` and render the identical number and stage as the overview.

---

## [P2][Closed] Bug 43: Ranking-weight sliders always show 0; budget defaults opaque

**Bug #43**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | frontend ProjectSettingsPage.tsx |

## Expected behavior

Weight sliders show each role's real defaults (summing to 100%); budget inputs show the actual depth defaults.

## Actual behavior

The sliders used short view keys ("runtime") that never matched the API's `critical_for_runtime` keys — every slider showed 0, and saves sent keys the backend rejects. Budget inputs said only "depth default".

## Notes during fixing

Fixed (2026-07-11): sliders use the API's `critical_for_*` keys with readable labels, display percentages, and show a "Total: N%" line (defaults sum to 100%). Budget inputs show the real per-depth defaults (e.g. standard: 300 calls, 4M input tokens).

---

## [P2][Closed] Bug 44: Section confidence used a worst-case rule — sections almost always "low"

**Bug #44**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | generation/citationValidator.ts |

## Expected behavior

Section confidence reflects how well-supported the section is overall.

## Actual behavior

Section confidence was the MINIMUM over all claims — one uncited claim among twenty branded the whole section low, so 8 of 11 sections in the first real run were "low" regardless of quality.

## Notes during fixing

Fixed (2026-07-11): distribution-based grade — >30% weak claims → low; ≥60% high with no lows → high; otherwise medium — capped by the model's own self-assessment. Individual weak claims keep their downgrade and unknowns entry, so per-claim honesty is unchanged; only the section-level grade is calibrated.

---

## [P2][Closed] Bug 45: Receipts cited by raw UUIDs — small models mangle them

**Bug #45**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | generation/sectionGenerator.ts |

## Expected behavior

Models can cite evidence reliably regardless of tier.

## Actual behavior

Section prompts identified receipts by full UUIDs. Small models (now the default tier) reproduce UUIDs imperfectly → "unknown receipt id" validation failures, stricter-prompt retries (extra cost), and dropped citations that dragged confidence down.

## Notes during fixing

Fixed (2026-07-11): receipts are aliased r1, r2, … in the prompt and mapped back to UUIDs before validation; unknown aliases still count as unknown for the validator. Shorter prompts, near-zero citation mangling.


---

## [P1][Closed] Bug 46: Class-method route handlers yield 0 workflows (CourseInsights)

**Bug #46**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Closed |
| File / area | engine/symbolExtractor.ts, entrypointDetector.ts, workflowExtractor.ts, evidenceGraphBuilder.ts, behaviorSignals.ts |

## Expected behavior

A repo whose Express handlers are class methods passed by reference (`this.express.put('/dataset/:id/:kind', facade.addDataset)`) produces traced workflows and tutorials like any other repo.

## Actual behavior

CourseInsights (classic InsightFacade shape) analyzed with 5 real HTTP routes and a complete call graph (`InsightFacade.addDataset → DatasetProcessor.processAddDataset → DatasetPersister.persistWriteDataset`) but **0 workflows** and 0 tutorials; snapshot honestly recorded `no_workflows_found`. Workflow-adjacent sections stayed low confidence no matter how often they were regenerated (starved evidence bundles — regeneration re-retrieves the same evidence, so "keeps being low" was deterministic, not random).

## Steps to reproduce

Import any repo registering routes as `app.get('/x', Class.method)` or `app.put('/x', instance.method)`; analyze; Workflows tab is empty.

## Notes during fixing

Fixed (2026-07-11). Compound root cause, follow-up to #39:

1. **Unqualified handler keys.** `resolveCallTarget` returned the bare method name (`addDataset`) and dropped the declaring class, so the entrypoint's `symbolStableKey` (`file#addDataset`) never matched the method node (`file#InsightFacade.addDataset`). Seeds fell back to the file node, whose only child is the class node (no traversal edges) → every trace died at 1 step. Same mismatch also silently disabled all `handles_route` edges. `RouteRegistration` now carries `handlerParentName`; the detector builds class-qualified keys.
2. **File-fallback couldn't see into classes.** `seedsForEntrypoint` only considered direct file children; a class-based route file produced the class node as its only (dead-end) candidate. The fallback now descends one level into classes, and an unambiguous `file#Class.member` suffix match rescues bare-name keys.
3. **Method nodes had no behavior signals.** Signals (response_output, database_read, …) were only stamped on top-level symbols, so class methods could never count as effect steps. Methods are now signaled individually from their own calls/snippets.
4. **Test files as entrypoints.** `test/controller/*.spec.ts` matched the `/controller/i` convention and minted junk http_route entrypoints; test files are now excluded from convention-based detection.
5. **Tie-break.** When a route-registered seed and a convention seed trace the same steps, the AST-detected route (real method + pattern) now wins duplicate suppression.

Verified live on CourseInsights: re-analysis at the same commit went from 0 → **3 workflows** ("HTTP InsightFacade.addDataset" 20 steps high, "removeDataset" 7 steps high, "GET /echo/:msg" 3 steps medium); `no_workflows_found` gone. Regression fixture `worker/fixtures/classServer` + 4 tests added. All 320 backend tests pass.

---

## [P2][Closed] Bug 47: AI & privacy setting changes ignored by generation; ai_disabled blocks packages entirely

**Bug #47**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | worker/summaryWorker.ts, new generation/deterministicSectionGenerator.ts, api/routes/onboarding.ts, api/routes/projects.ts |

## Expected behavior

Changing Settings → AI & privacy changes how the next generation/regeneration runs (spec: ai_disabled = "deterministic-only outputs", not "no outputs"). Every project setting is applicable at the point it claims to act.

## Actual behavior

Generation used the privacy mode **copied onto the snapshot at analysis time**, so flipping the setting after an analysis changed nothing — the pipeline kept generating "the same full AI" content. The gates were also inconsistent: `/generate` checked the snapshot's mode, `/regenerate` and `/summarize` checked current settings, and all three refused with 403 under ai_disabled, while the worker skipped generation entirely — an ai_disabled project either kept its old full-AI package (misleading) or got nothing.

## Steps to reproduce

Analyze with full_ai → switch to facts_only_ai → regenerate a section: prompt still contains snippets. Switch to ai_disabled → regenerate: 403, nothing happens.

## Notes during fixing

Fixed (2026-07-11):

- The summary worker now resolves the **effective privacy mode from current `project_settings`** (snapshot mode is the fallback/audit record); facts_only/full switches apply to the very next generation with no re-analysis.
- ai_disabled no longer blocks: new `deterministicSectionGenerator` renders each section's deterministic query result (the same facts the LLM would get as authoritative context) into readable markdown with the section's Mermaid diagrams, zero LLM calls, `generation_run_id NULL`, an explicit "AI explanations are off" banner, and an `ai_disabled` unknown. The 403 gates on `/generate`, `/sections/:id/regenerate`, and `/summarize` are removed — the mode decides HOW, never WHETHER.
- Settings audit: budgets, stop behavior, model tiers/failure behavior, and ranking weights were already read live at job time; ignored paths, file/LOC limits, and analysis depth correctly apply at the next analysis (copied onto the snapshot per spec).

## [P2][Closed] Bug 48: Regenerate failures invisible: silent UI catch, sections stuck in regenerate_requested

**Bug #48**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | pages/OnboardingPage.tsx, worker/summaryWorker.ts |

## Expected behavior

Clicking Regenerate either visibly starts a job or visibly tells you why it can't; a failed job never leaves a section in a dead state.

## Actual behavior

"Sometimes it doesn't even regenerate": `handleRegenerateSection` and `handleGenerateRole` swallowed every error (`catch { setRegenerating(false) }`), so a 403 (privacy gate, permission tier) or timeout looked like a no-op — job logs show users double-clicking Regenerate 49s apart. On the worker side, `review_status='regenerate_requested'` was write-only: a failed/paused regenerate job left the section stuck there forever.

## Notes during fixing

Fixed (2026-07-11): reader shows a dismissible error banner with the API's message for generate/regenerate failures and a note when polling times out; the worker's failure path resets `regenerate_requested` sections to `stale` so old content stays visible and the Regenerate button returns.

---

## [P3][Closed] Bug 49: Tours never re-appear for new accounts; lifecycle tour never auto-starts

**Bug #49**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | frontend lib/tourState.ts (new), DashboardPage.tsx, ProjectLayout.tsx, OnboardingPage.tsx |

## Expected behavior

A brand-new account (even after a full DB wipe + GitHub token revocation) sees the first-run tours; the "How packages work" tour introduces itself on first visit.

## Actual behavior

Tour dismissal lived in browser-global localStorage keys, which survive DB wipes, account deletion, and Docker restarts — a "new" user on the same browser never saw a tour again. The package-lifecycle tour existed only behind a button nobody knew to click.

## Notes during fixing

Fixed (2026-07-11): dismissal keys are per-account (`…:<userId>`, shared helper `lib/tourState.ts`); the lifecycle tour auto-runs on first visit to the package grid, sequenced after the project tour so two spotlight overlays never stack. Existing accounts see each tour once more (keys migrated).

## [P1][Closed] Bug 50: Runs are untrustworthy — phantom phase durations, dead workers look alive, no pause/stop/resume

**Bug #50**

| Field | Value |
|-------|-------|
| Date created | 2026-07-12 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Closed |
| File / area | worker/ai/checkpoints.ts, worker/index.ts, worker/summaryWorker.ts, lib/queue.ts, api/routes/projects.ts, migration 002, ProjectOverviewPage.tsx, AnalysisRunPanel.tsx |

## Expected behavior

Phase timings reflect the actual run; a "running" job means a worker is actually working; users can pause, stop, and resume runs.

## Actual behavior

Three compounding failures. (1) `snapshot_phases` upserts never reset `started_at`, so re-running the same commit showed first-run-start → latest-finish spans (observed: 507-minute "Download & inventory"). (2) A worker whose blocking Redis connection died — or that was restarted mid-job — left the DB row "running" forever; the progress bar animated over nothing and BullMQ retries silently shifted timings with no indication. (3) There was no way to intervene: no pause, stop, or resume, despite the worker-side kill switch and checkpoint machinery already existing.

## Notes during fixing

Fixed (2026-07-12):
- `markPhase` restarts the phase clock whenever a phase begins a new run (re-marked running, or re-marked after a terminal state).
- Migration 002 adds `last_heartbeat_at` + `attempt`; workers stamp a heartbeat every ~15s and record the delivery attempt. `analysis-status` flags running jobs silent >2min as `stalled`; the worker reconciles them to failed (with an honest message) on boot and every 2 minutes. Redis connections reconnect forever with keep-alive; worker connection errors are logged.
- New endpoints `POST /projects/:id/analysis-jobs/:jobId/{pause,stop,resume}`: pause/stop flip the job status (workers honor it at the next step or AI-batch boundary via a status guard that also prevents progress updates from stomping the user's choice); resume re-enqueues the SAME job row so phase checkpoints and the content-addressed cache skip all completed work. Overview gains Pause/Stop/Resume buttons, a ticking "last worker activity Xs ago" line, stalled + attempt badges, and a live elapsed timer on the running phase.
- Bonus: ai_disabled analyses now auto-enqueue their deterministic package (previously only manual generation).

Verified live: paused a run mid-download → worker logged "stopped by kill switch (status: paused)" and exited without stomping the status; resume re-enqueued and completed from checkpoints.

## [P3][Closed] Bug 51: Receipt UX — unbounded snippets, no symbol explanation, reviewer shown as UUID

**Bug #51**

| Field | Value |
|-------|-------|
| Date created | 2026-07-11 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | ReceiptViewer.tsx, OnboardingPage.tsx, api/routes/onboarding.ts, retrieval/retrievalService.ts |

## Expected behavior

Receipts explain what the cited code does and stay readable at any snippet length; reviewers are named readably.

## Actual behavior

A long function snippet stretched the receipt modal to the full page height; receipts showed code with no summary of what the function does; "Reviewed by @<uuid>" was meaningless; doc_health claims could never cite documentation (record receipts are code-first), so the section was systematically low-confidence.

## Notes during fixing

Fixed (2026-07-11): snippet capped at 40vh with two-way scrolling inside a wider modal (markdown code fences in sections capped too); receipts carry the cited symbol's semantic-record summary ("What this does", JSDoc fallback); reviewer shows the user's email; doc_health bundles attach the snapshot's doc nodes as citable doc-trust receipts — verified low → high on a live regeneration with zero validation issues.

---

## [P2][Closed] Bug 52: Incremental re-analysis — doc changes never stale anything; binary files false-churn; short SHAs fork snapshots

**Bug #52**

| Field | Value |
|-------|-------|
| Date created | 2026-07-12 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | worker/incrementalAnalyzer.ts, engine/repoIngester.ts, worker/index.ts, AnalysisRunPanel.tsx |

## Expected behavior

Re-analyzing after a new commit stale-flags the content the change actually affects, and the run visibly reports what it concluded.

## Actual behavior

A docs-only commit (README + two PDFs) produced zero staleness and zero visible outcome: staleness only matched code receipts, so doc-derived sections (doc_health, start_here) never went stale for doc edits; the diff row in the run panel showed no diff numbers, so "nothing stale" looked like "nothing happened"; the tour promised a new card that incremental runs never create. Two latent bugs surfaced during diagnosis: binary files hashed `path:size:mtime` where mtime is the zipball EXTRACTION time — every PDF "changed" on every run (false churn in all diffs); and a requested short SHA was recorded verbatim, forking the (scope, commit) snapshot identity so diffs compared the wrong pair.

## Notes during fixing

Fixed (2026-07-12):
- Doc staleness: changed doc files now stale sections citing doc receipts (`doc:<path>#…` prefix match), always stale `doc_health`, and stale `start_here` when the README changed.
- Binary files ≤2MB hash their bytes; oversized files hash path+size — mtime is never used. (One transitional "changed" wave for binaries on the first re-analysis after deploy.)
- Requested commits are resolved to the full 40-char SHA before snapshotting.
- The run panel's diff row now shows "N files changed · N symbols changed · N sections stale"; the lifecycle tour copy matches reality (a new card appears when you generate at the new commit; incremental runs stale-flag in place).

Verified live end-to-end on a real project: symbol-hash change → `symbolsChanged: 1`, the section citing it stale-flagged; README change → start_here + doc_health stale; package marked stale with flags feeding the staleness view and the card badge.
