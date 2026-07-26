# Bug Log

Copy each `## [P…][State] Bug …` block into a GitHub issue.

**Priority:** P0 crash · P1 intermittent · P2 reproducible · P3 patch later · P4 annoying · P5 idea
**State:** New (not investigated) · Open (someone is working on it) · Closed (fixed) · Won't-Fix (closed with a reason)

**Bugs #1–#52** — Milestones 2 and 3. **Bugs #53–#74** — Milestone 4 (2026-07-16 → 2026-07-25). **Bugs
#75–#83** — found by the eleven-project audit and the owner-directed reader/graph pass on 2026-07-25
(eight P1, one P2), and **all nine fixed 2026-07-25/26** in the final pre-submission commits (see each
bug's Notes for the exact fix).

**M4 sprint work (#53–#74): 22 issues — 12 Closed** (found and fixed inside the sprint), **10 Open**
(the M5 backlog). Every pre-#75 Open issue has an owner and a target in
[§ M5 bug plan](#m5-bug-plan--every-open-bug-resolved-or-closed).

**One issue per root cause.** Where several defects shared a cause or a fix location they are batched
into one issue and listed inside it — 51 individual defects became these 22 issues. Fixing them one at
a time would have meant twenty near-identical PRs touching the same three files, and a tracker where
the items that matter are buried. Anything genuinely standalone stayed standalone.

Security review findings from M2/M3 (formerly #30–#34) are merged into **#13** and **#18**. The M4
security assessment's nine findings are one issue (**#63**) with the full inventory, payloads and
per-finding severity in [SECURITY_XSS_PROMPT_INJECTION.md](./SECURITY_XSS_PROMPT_INJECTION.md).

---

## GitHub Issues — TODO

Actions to take on the GitHub Issues tracker. `scripts/sync-github-issues.sh` automates the M4 rows
(see [§ Filing these on GitHub](#filing-these-on-github)).

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
| **File + Close** | **#53–#64** | **M4 issues, fixed during the sprint** — file with the bodies below, close with the fix notes. |
| **File (Open)** | **#65–#74** | **M4 backlog** — file Open with the owner from the M5 plan. #65 and #66 are the highest-priority items (cross-tenant scoping + the auth bypass). |
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
| 11 | Team member removal uses confusing double /members/ path | P2 | Closed | Fixed (verified 2026-07-25) |
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

#### Milestone 4 — found and fixed in the sprint (#53–#64)

| # | Issue | P | State | Defects batched |
|---|-------|---|-------|-----------------|
| 53 | A project behaved as if one repository meant one commit | P2 | Closed | 3 |
| 54 | A user could not manage their own account | P3 | Closed | 5 |
| 55 | Turning AI off produced a visibly worse document | P3 | Closed | 2 |
| 56 | App ignored OS theme preference and had no keyboard navigation | P4 | Closed | 2 |
| 57 | The reader displayed trust signals that were not real | P2 | Closed | 3 |
| 58 | Generated sections ignored evidence the pipeline had already extracted | P2 | Closed | 4 |
| 59 | Whole subsystems traced to nothing, and it looked like an empty result | P1 | Closed | 1 (+ detection gaps) |
| 60 | Caches could serve empty or broken content forever | P1 | Closed | 4 |
| 61 | The analysis worker could stall or die | P1 | Closed | 2 |
| 62 | Workflow graphs and dependency counts misrepresented the code | P3 | Closed | 3 |
| 63 | XSS and prompt-injection assessment — nine findings | P2 | Closed | 9 |
| 64 | Our own security fixes introduced three defects, one that would have broken every import | P0 | Closed | 3 |

#### Milestone 4 — open backlog for M5 (#65–#74)

| # | Issue | P | State | Owner | M5 batch |
|---|-------|---|-------|-------|----------|
| 65 | Three routes are not scoped to the project — cross-tenant reads and one write | P2 | Open | Nam | 1 |
| 66 | The authentication surface has an unused bypass and no throttling | P2 | Open | Nam | 1 |
| 67 | Repository import blocks large accounts and its cost safety gate is bypassable | P2 | Open | Eugene / Nam | 2 |
| 68 | Failed requests look like empty results — one pushes toward a paid action | P2 | Open | Sahib | 3 |
| 69 | Analysis jobs can get stuck, or fail on an error that should have been retried | P2 | Open | Nam | 2 |
| 70 | Dependency graph reports "imported by 0" for everything; search blanks the canvas | P2 | Open | Bradley / Eugene | 3 |
| 71 | Accessibility gaps and measured contrast failures | P3 | Open | Eugene | 4 |
| 72 | Team lifecycle is a one-way door (no email, decline, leave, or ownership transfer) | P3 | Open | Nam | 5 |
| 73 | The frontend image only works when the browser is on the Docker host | P3 | Open | Nam | 6 |
| 74 | [Tracker] Polish tail from the two end-of-M4 audits — 49 low-severity findings | P4 | Open | Eugene | 7 |

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

**#29** was originally accepted as a Won't-Fix at M2 scope (BFS workflow extraction); the full call-graph
extraction shipped in M3, so it is now Closed–Fixed rather than Won't-Fix. There are currently **no**
Won't-Fix bugs; the ones expected at M5 are declared in the plan below.

### Roll-up as of 2026-07-26 (end of M4, after the audit-fix commits)

| Bucket | Count | Numbers |
|--------|-------|---------|
| **Closed** — verified fixed | **57** | #2, #11–#13, #16–#21, #23, #26–#35, #38–#52, #53–#64, #75–#83 |
| **Open** — M4 backlog | **10** | #65–#74 |
| **Open** — M2/M3 carry-over | **12** | #1, #3–#10, #14, #15, #22 |
| **Open** — P5 ideas, not defects | **3** | #24, #25, #36 |
| **Open** — blocked on an external service | **1** | #37 |
| **Won't fix** | **0** | — |
| **Total tracked** | **83** | #1–#83 |

**Open total: 26. No P0. Two P1 — #3 and #37**, both narrow: #3 is a missing-config crash (GitHub
routes throw if the App private key is absent, instead of returning a comprehensible error), and #37 is
an auth-provider limitation whose user-facing half we already fixed. Everything else open is P2 or
below. The M4 backlog is the deliberate output of two audits we ran *at the end* of the sprint (73
functional/security findings and 20 visual findings, both 2026-07-22) plus the security assessment —
most of it exists because we went looking, not because it surfaced in use. The two that matter are
**#65 and #66** (cross-tenant scoping and the auth bypass), and they are the first work of M5.

**A third, later audit (the eleven-project pass, #75–#83) found 9 more the same day** — eight P1 —
but unlike #65–#74, **all nine were fixed the same sprint** rather than deferred: entrypoint detection
broadened past HTTP shapes, unparsed languages force-disclosed, run-status/pause semantics made
truthful, a statement-timeout retry, the fullscreen exit control, and the viewport-reset-on-select all
landed in the pre-submission commits. See each bug's Notes for the exact fix.

**Regression check: nothing closed in M2 or M3 has re-opened.** The three M3 fixes with the highest
regression risk — run control (#50), incremental staleness (#52) and receipt citations (#45) — each
gained a dedicated automated test during M4, so a regression now fails the suite instead of waiting to
be found by hand.

---

## M5 bug plan — every Open bug resolved or closed

**Commitment for the final release: 26 Open → 0 Open.** Every item is either fixed or closed
Won't-Fix with a stated reason. Sequenced by risk, not by number.

| Batch | Scope | Issues | Owner |
|-------|-------|--------|-------|
| **1** | **Tenant isolation and auth** — do first, before any feature work | #65, #66 | Nam |
| **2** | **Flows that block users or spend their money** — import pickers, the bypassable cost gate, stuck jobs | #67, #69 | Eugene / Nam |
| **3** | **Correctness the product's value rests on** — dependency counts, graph search, error-vs-empty states | #68, #70 | Bradley / Sahib |
| **4** | **Accessibility and measured contrast** | #71 | Eugene |
| **5** | **Team lifecycle** — decline, leave project, ownership transfer | #72 | Nam |
| **6** | **Deployment** — configurable API origin, which also tightens the CSP | #73 | Nam |
| **7** | **Polish tail** — worked as a checklist against the two audit documents | #74 | Eugene |
| **8** | **M2/M3 carry-over** server-side hygiene — batched into one hardening PR early so it cannot slip again. Includes the two open P1s (#3, #37). | #1, #3–#10, #14, #15, #22, #37 | Nam |

**Expected Won't-Fix at M5 — declared now rather than discovered at the deadline:**

- **#24** — per-route error boundaries. The router-level boundary plus per-page error states cover the failure modes we actually see. P5.
- **#25** — a test that could pass vacuously on an empty edge set. Superseded: the graph tests now assert non-empty sets and exact counts.
- **#36** — regenerating a single stale tutorial. Tutorials regenerate cheaply as a set now that the caches work, so per-tutorial granularity is not worth the surface area. P5.
- **#37** — GitHub sign-up identity conflict. Our half is fixed (the error now gets a plain-language explanation); the rest is a known limitation of the auth provider, not our code.
- **Invitation emails** (part of **#72**) — needs an email provider we have not provisioned. The likely outcome is relabelling the action "Create invitation" with a share-the-link hint and closing the email half Won't-Fix. Decline and leave-project still ship.

**Standing rule for M5:** anything found in a walkthrough gets filed the same day, with a priority,
before any fix work starts. That is how #65–#74 came to exist rather than being discovered during
grading.

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

## [P2][Closed] Bug 11: Team member removal uses confusing double /members/ path

**Bug #11**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed |
| File / area | frontend/src/pages/TeamPage.tsx |

## Expected behavior

DELETE should use a clear REST path such as /projects/:id/members/:userId.

## Actual behavior

Frontend calls DELETE /projects/:id/members/members/:userId. Works with current routes but is error-prone.

## Steps to reproduce

Open Team tab → Remove a member → Inspect network tab — path contains /members/members/.

## Notes

**Closed 2026-07-25 — verified fixed.** The frontend now calls
`DELETE /projects/:id/members/:userId` (`TeamPage.tsx:196`) against the router mounted at
`/projects/:id/members` (`routes/index.ts:26`), so there is a single `/members/` segment. Fixed
incidentally during the M4 UI work rather than as a deliberate change, which is why it sat Open —
found while triaging effort for M5.

*Residual, tracked in #74 rather than kept open here:* invitations live at
`/projects/:id/members/invitations` while a separate top-level `/invitations` router also exists. Two
invitation surfaces at different paths is a naming inconsistency, not a broken path.

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

---

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

---

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

---

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


---

# Milestone 4 bugs (#53–#74)

Found between 2026-07-16 and 2026-07-25. **#53–#64 were fixed inside the sprint; #65–#74 are the
open backlog** carried into M5 (see [§ M5 bug plan](#m5-bug-plan--every-open-bug-resolved-or-closed)).

Each entry is one GitHub issue. Where several defects shared a root cause or a fix location, they
are batched into one issue and listed inside it — closing them one at a time would have meant
twenty near-identical PRs touching the same three files.

---

## [P2][Closed] Bug 53: A project behaved as if one repository meant one commit

**Bug #53**

| Field | Value |
|-------|-------|
| Date created | 2026-07-16 |
| Reported by | OnboardBuddies (Team 15), from M3 TA/peer feedback |
| Priority | P2 |
| State | Closed |
| Area | Project workspace — package resolution, analysis concurrency, tab wiring |

## Expected behavior

A project holds several analyses at once (different branches, scopes, commits) and the user chooses
which one every tab reads from.

## Actual behavior

Three defects with one root cause — nothing in the system named "which package am I looking at".

1. **Generating a package silently re-pointed every tab at it.** Architecture, Dependencies,
   Capabilities, Workflows and Tutorials each resolved "the latest package", so a second analysis
   overwrote what the user was reading even though the older package still existed.
2. **Only one analysis per project could run.** Any queued or running job blocked the next one
   regardless of what it was analyzing, so a user who wanted `main` and a feature branch had to wait.
   Double-clicking Analyze produced a 409 with no pointer to the run already in progress.
3. **The Tutorials tab had its own role chooser** that disagreed with the rest of the workspace — you
   could read `backend` tutorials while every other tab showed the `general` package.

## Steps to reproduce

Analyze a repo, note the Architecture component list, analyze the same repo at a different commit,
then reopen Architecture — it shows the new package with no indication that it switched.

## Notes during fixing

Fixed (2026-07-16): one resolution rule — **explicit selection → the caller's saved default → latest
complete** — now serves every feature read, and packages carry their branch as part of their
identity. Two analyses of different scope/commit pairs run in parallel; only an identical re-run
conflicts, and it returns the id of the run already going. A package selector in the project header
switches packages, and each member stores their own default. The Tutorials role chooser was removed.
Regression-covered by 17 package-resolution tests and 4 concurrency tests.

---

## [P3][Closed] Bug 54: A user could not manage their own account

**Bug #54**

| Field | Value |
|-------|-------|
| Date created | 2026-07-16 |
| Reported by | OnboardBuddies (Team 15), from M3 feedback |
| Priority | P3 |
| State | Closed |
| Area | Account settings, auth entry flow |

## Expected behavior

A user can recover a forgotten password, edit their profile, disconnect GitHub, and delete their
account.

## Actual behavior

None of it existed. A forgotten password was unrecoverable. The GitHub connection could not be
revoked from inside the app. There was no account deletion, so a test account was permanent. The
sign-in page was a dead end with no way back to the intro page, and an already-signed-in user who
deliberately opened the intro page was bounced to the dashboard.

## Notes during fixing

Fixed (2026-07-16): forgot-password and reset-password flows; display name and avatar editing;
add/remove email sign-in; GitHub disconnect behind a confirm dialog; and account deletion that
removes the account and its project data in one transaction. The intro-page redirect was inverted —
signed-in users stay put and are only transferred when they deliberately open sign-in.

---

## [P3][Closed] Bug 55: Turning AI off produced a visibly worse document, not just a differently-written one

**Bug #55**

| Field | Value |
|-------|-------|
| Date created | 2026-07-16 |
| Reported by | OnboardBuddies (Team 15), from M3 feedback |
| Priority | P3 |
| State | Closed |
| Area | Deterministic (AI-disabled) generation |

## Expected behavior

Privacy mode decides *how* a document is written, never how much the product knows. With AI off, a
package should present all the evidence the model would have received.

## Actual behavior

The deterministic path rendered a thin summary while the AI path received a far richer evidence
bundle, so a privacy-conscious team got a worse product from the same analysis. Deterministic
sections also had no citable receipts at all, which left them permanently low-confidence.

## Notes during fixing

Fixed (2026-07-16): the deterministic facts (routes, tables, environment variables, entry points,
side effects) now produce real citable receipts, so an AI-disabled section cites code exactly as an
AI-written one does, and the renderer lays out the full evidence bundle with the section's diagrams
and an explicit "AI explanations are off" banner.

---

## [P4][Closed] Bug 56: The app ignored OS theme preference and could not be driven from the keyboard

**Bug #56**

| Field | Value |
|-------|-------|
| Date created | 2026-07-16 |
| Reported by | OnboardBuddies (Team 15), from M3 feedback |
| Priority | P4 |
| State | Closed |
| Area | Theme, keyboard shortcuts |

## Expected behavior

The app follows the OS colour scheme until the user pins a choice, and frequent navigation is
reachable from the keyboard.

## Actual behavior

The app defaulted to dark regardless of the OS setting. Every action required a pointer — stepping
through a 15-stop walkthrough meant fifteen clicks — and there was nothing to discover shortcuts
with.

## Notes during fixing

Fixed (2026-07-16): unpinned theme reads the OS preference and follows live changes; the first click
pins. Shortcuts cover previous/next and jump-to-tab, with `?` opening a shortcuts dialog. Every
binding is suppressed while typing, while a modifier is held, and while a dialog or tour overlay is
open, so it cannot hijack a form. *Known follow-up:* shortcuts cannot be disabled — WCAG 2.1.4,
tracked in #74.

---

## [P2][Closed] Bug 57: The reader displayed trust signals that were not real

**Bug #57**

| Field | Value |
|-------|-------|
| Date created | 2026-07-23 |
| Reported by | OnboardBuddies (Team 15), onboarding content audit |
| Priority | P2 |
| State | Closed |
| Area | Onboarding reader — receipts, citations, review state |

## Expected behavior

Every trust signal in the reader reflects reality. This is the product's entire pitch, so a
fabricated one is worse than none.

## Actual behavior

Three defects in the layer users judge us on.

1. **Staleness and age were hardcoded in the API response.** Every receipt was returned as
   `staleness: "current"` and `ageLabel: "recent"`, and the claim it supported was dropped. A receipt
   pointing at code deleted three commits ago still read "current".
2. **Citations rendered as raw markers.** The model cited receipts by short alias, but nothing turned
   those aliases back into UI citations — readers saw literal text like `[R3]` in the prose, with the
   receipts listed separately at the bottom and no link to the sentence they supported.
3. **"Reviewed" meant two things and served neither.** It was an owner/admin-only editorial action,
   yet the reader tour sold it as "your progress tracker" and the Team tab showed "N sections
   reviewed" per member — so the actual onboardees could never move their own number off zero.

## Steps to reproduce

Generate a package, push a commit deleting a cited symbol, re-analyze, and reopen the section that
cited it — the receipt still reads "current".

## Notes during fixing

Fixed (2026-07-23): staleness is computed by re-verifying each receipt against the newest snapshot,
age comes from the receipt's own commit date, and the claim travels with it. Aliases are rewritten to
stable markers at write time and rendered as clickable chips at the claim. Review was split in two —
**Mark reviewed** stays an owner/admin editorial action, and a personal **read** mark is available to
every tier and is what the tour and progress metric now refer to. The presentation logic was
extracted and covered by 19 tests so the values cannot be faked again.

---

## [P2][Closed] Bug 58: Generated sections ignored evidence the pipeline had already extracted

**Bug #58**

| Field | Value |
|-------|-------|
| Date created | 2026-07-23 |
| Reported by | OnboardBuddies (Team 15), onboarding content audit |
| Priority | P2 |
| State | Closed |
| Area | Section generation — prompts, specs, diagrams, evidence filtering |

## Expected behavior

Facts the pipeline extracted are handed to the model as authoritative context. The model explains
them; it never has to recall them.

## Actual behavior

The single largest quality problem in M4, in four parts.

1. **Facts were asked of the model rather than given to it.** Reference-shaped sections asked it to
   produce route lists, table names and environment variables from retrieved snippets — the exact
   place hallucination risk is highest and prose value lowest. Validator issues concentrated there
   (31 in one section, 17 in another on a measured run).
2. **Documented routes did not exist.** Routes were read from the `router.get("/…")` call site alone,
   losing the mount chain, so the reference listed paths like `/analyze` instead of
   `/api/projects/:id/analyze`. A reader who trusted the table and made the request got a 404.
3. **Test fixtures competed with real code.** Test and fixture files were ordinary source to the
   pipeline, so the Critical 25% list and the workflow list filled with fixture entry points, and
   tutorials were generated over fixture code — pointing "critical path" at files no user executes.
4. **Diagrams contradicted the evidence.** They contained nodes with no receipts and shapes that did
   not match the traced flow. A diagram reads as the most authoritative thing on the page, so one
   that disagrees with the code is worse than none.

## Notes during fixing

Fixed (2026-07-23/24): deterministic facts are injected into every section prompt, and reference
sections went further — their tables are generated deterministically and spliced in byte-stable, with
the model only annotating. Mount expressions resolve transitively so routes carry their full path. A
shared classifier keeps test and fixture paths out of ranking, workflow entry points and tutorial
selection (while keeping them available to the QA role, where they *are* the subject). Diagrams are
built only from extracted structure, every node links to its source, and node counts are capped so a
large repo degrades to a readable subset. A completeness gate with a targeted retry catches the case
where the model ships a summary and skips the enumeration — that alone took one section from 303 to
5,400 characters. Measured effect across the package: 7,500 → 13,800 words on our benchmark repo.

---

## [P1][Closed] Bug 59: Whole subsystems traced to nothing, and it looked like an empty result

**Bug #59**

| Field | Value |
|-------|-------|
| Date created | 2026-07-24 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Closed |
| Area | Entry-point and side-effect detection |

## Expected behavior

Background consumers are entry points, so the work they drive is traced end to end. Anything the
detectors cannot classify is reported, not dropped.

## Actual behavior

The detector recognised inline queue handlers but not handlers passed as a bare reference — the form
our own background pipeline uses. That subsystem therefore had **zero** entry points, which means
zero workflows, zero journeys and no tutorials. Because missing data surfaced as an empty result
rather than an error, downstream sections confidently described the system as if the subsystem did
not exist. This is the definitively-wrong failure mode: silence that reads as "this does nothing".

## Steps to reproduce

Analyze a repository whose queue consumer is constructed as `new Worker(QUEUE, handlerFn)` and open
Workflows — the consumer's flow is absent, with no warning.

## Notes during fixing

Fixed (2026-07-24): handler references are resolved to their declaration so the body is traced.
The same pass closed the detection gaps around it — authentication, external-service and
process-execution effects, queue hints on enqueues — and introduced an **honesty rule**: a symbol
that is connected to entry points but matches no known pattern is recorded as a low-confidence
unknown, a trace that ends nowhere records a dead end, and both are counted and shown in the reader.
Unknowns became findable work instead of invisible holes.

---

## [P1][Closed] Bug 60: Caches could serve empty or broken content forever

**Bug #60**

| Field | Value |
|-------|-------|
| Date created | 2026-07-24 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Closed |
| Area | Section and tutorial caches |

## Expected behavior

Only good content is reused, and an unchanged repository hits the cache reliably.

## Actual behavior

Four defects in the caching added to cut cost and latency — one of them twice, which is why the
batch is worth reading as a group.

1. **An empty section was cloned forward permanently.** A worker death between inserting a section
   row and writing its content left a hash-bearing row with no content, and every later run with the
   same inputs reused it while reporting a cache hit. The package looked complete with a blank
   section.
2. **The identical crash window existed in the tutorial cache.** A tutorial row is written before its
   steps, so a death between the two left a row with **zero steps** that later runs cloned forward
   while counting steps that did not exist. The tutorial cache shipped in the same commit that added
   quality gates to the section cache — without any gate of its own.
3. **Every same-package cache hit silently failed.** Cloning inserted before deleting, violating a
   unique index; the error was swallowed as a cache miss, so the cache did nothing in its most common
   case and paid for the work again.
4. **The cache key was unstable.** It included retrieval results, which wobble run-to-run, so an
   unchanged repository hit 9 of 12 sections on one run and 5 of 12 on the next. A cache that fires
   half the time makes cost and latency unpredictable.

## Notes during fixing

Fixed (2026-07-24): reuse is gated on length, confidence and coverage, and cached content is
re-judged against *today's* quality rules before being reused; tutorial reuse additionally requires
at least one step to exist. Clone order was corrected. The key is now derived only from deterministic
inputs, which took the hit rate to 11 of 12 with the single miss explained. Result: a warm
regeneration costs about six model calls instead of thirty. Found by deliberately re-checking the
commit that fixed defect 1 for the same class of mistake — worth recording as a method, not just a
fix.

---

## [P1][Closed] Bug 61: The analysis worker could stall or die

**Bug #61**

| Field | Value |
|-------|-------|
| Date created | 2026-07-24 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Closed |
| Area | Worker lifecycle, queue connection |

## Expected behavior

If a worker stops doing work it recovers by itself, and one job's failure never takes the process
down.

## Actual behavior

1. **A live worker could stop consuming and still look healthy.** M3 added heartbeats so a *dead
   process* could be detected. This was the case that missed: the process is alive and heartbeating,
   but its blocking queue connection has died. Jobs sat queued indefinitely, the UI showed "Waiting
   for worker" forever, and nothing considered the worker unhealthy.
2. **One job's budget failure killed the whole process.** A rejected promise from the tutorials
   fan-out went unobserved when the budget tripped, and Node terminated the worker — taking every
   other job on it. Observed once in a live run.

## Notes during fixing

Fixed (2026-07-24): a watchdog samples for "work waiting, nothing running" and, on two consecutive
zombie samples, recreates the worker in place — it fired in production and self-healed in about two
minutes. Fan-out rejections are observed at creation, and process-level guards log instead of
exiting, so a budget trip now fails only its own job.

---

## [P3][Closed] Bug 62: Workflow graphs and dependency counts misrepresented the code

**Bug #62**

| Field | Value |
|-------|-------|
| Date created | 2026-07-24 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| Area | Workflow extraction, evidence graph |

## Expected behavior

A traced flow reads top-to-bottom and terminates; the flow list shows distinct flows, most important
first; and two files have one dependency edge between them however many symbols cross it.

## Actual behavior

1. **Every flow rendered as a loop.** The synthetic closing step was treated as an ordinary step, so
   the graph drew an edge from the last step back to the trigger — implying a cycle that does not
   exist.
2. **The flow list was dozens of near-identical entries.** Routes sharing almost all of their call
   path each produced their own workflow, burying the genuinely distinct flows. Separately, a page
   mount scored the same as a server flow of the same shape and often out-ranked it.
3. **Import counts were inflated.** Each import statement produced its own edge, so a file importing
   five symbols from one module counted as five dependencies — and those counts feed the ranking, so
   verbose importers were scored as critical.

## Notes during fixing

Fixed (2026-07-24): the closing step is tagged and drawn as a terminal node; a flow sharing ≥80% of
its steps with a higher-ranked one is suppressed; UI-route traces are damped relative to server flows
of the same shape; and repeat or type-only imports collapse into one weighted edge.

---

## [P2][Closed] Bug 63: XSS and prompt-injection assessment — nine findings

**Bug #63**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), internal security assessment (authorized, own application) |
| Priority | P2 |
| State | Closed |
| Area | Frontend rendering, nginx, LLM prompts, GitHub and archive handling |

## Expected behavior

Untrusted repository content cannot execute script, plant a beacon, phish a teammate, or steer the
document generator.

## Actual behavior

Nine findings, three of them High. **No script-executing XSS was exploitable** — React escaping,
safe markdown defaults and strict-mode diagrams held — but two genuine exposures existed:

- **A prompt-injection chain.** Repository text (comments, README, symbol names) entered LLM prompts
  with no untrusted-data boundary, and the one free-form output field was stored verbatim and
  rendered as markdown. Script was escaped, but external images and links survived — so an imported
  repository could plant a zero-click tracking beacon or a phishing link that fires in every
  teammate's browser. The same poisoned text was cached and re-fed into later prompts.
- **No Content-Security-Policy or security headers anywhere.** Nothing contained that chain, and
  nothing would contain a future sanitizer slip.

Also confirmed: unfiltered markdown images/links, a diagram renderer resting entirely on its
library's sanitizer, an unvalidated avatar URL that measurably beaconed, an unvalidated branch name
reaching GitHub API URLs (a constrained authenticated SSRF), and archive extraction with no zip-slip
guard.

## Steps to reproduce

Full input-point inventory, payloads, per-test results and severities are in
[SECURITY_XSS_PROMPT_INJECTION.md](./SECURITY_XSS_PROMPT_INJECTION.md). The prompt-injection half
reproduces with `npm run security:report -w backend`, which runs a hostile fixture repository through
the real production code paths.

## Notes during fixing

Fixed (2026-07-24) — **all nine mitigated**, at three independent layers so no single one has to
hold: an untrusted-data boundary around repository content in every prompt (with cache versions
bumped so content generated under the old prompts can never be reused), mechanical sanitization of
model output before it is stored, and a Content-Security-Policy verified in a real browser against
the real production bundle. Plus a host allowlist on avatar URLs, git-ref validation, and archive
entries validated before extraction. Residual risks are stated plainly in §7.5 of the report — the
most important being that a generated onboarding document is not a security review of the repository
it describes.

---

## [P0][Closed] Bug 64: Our own security fixes introduced three defects, including one that would have broken every import

**Bug #64**

| Field | Value |
|-------|-------|
| Date created | 2026-07-24 |
| Reported by | OnboardBuddies (Team 15), caught by the new security tests before merge |
| Priority | P0 |
| State | Closed |
| Area | Archive extraction, prompt sanitizing, markdown export |

## Expected behavior

A security fix works on every platform the app is deployed to, and holds on every path the content
leaves by.

## Actual behavior

1. **P0 — the zip-slip guard would have thrown on every repository import in production.** It listed
   archive entries with a command flag that the container's `unzip` build does not support. It passed
   on a developer laptop and failed inside the deployed worker image — and because the guard runs
   before every extraction, imports would have been dead on arrival.
2. **The identifier sanitizer was too weak.** It replaced disallowed characters with spaces, so a
   hostile repository scope name still read as a readable instruction, still in instruction position.
3. **"Inert plain text" was not inert.** Unsafe links were defanged to plain text on the reasoning
   that this app's renderer leaves bare URLs as text — but the same content is served by the Markdown
   export, and mainstream markdown renderers turn bare URLs straight back into live links.

## Notes during fixing

Fixed (2026-07-24): archive entries are now read by parsing the archive index directly, with no
dependency on which `unzip` is installed, cross-checked against three different archive writers
including the streaming form GitHub produces. Only the leading identifier token is kept, which is
lossless for real values and total for hostile ones. Off-allowlist URLs are removed outright rather
than defanged.

**Filed as P0 because of what it says about process, not because it shipped:** it was caught only
because the security suite runs inside the deployment image in CI rather than on a laptop. Defects 2
and 3 were caught the same way.

---

## [P2][Open] Bug 65: Three routes are not scoped to the project, allowing cross-tenant reads and one write

**Bug #65**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), security & UX audit |
| Priority | P2 |
| State | Open — Nam, M5 batch 1 |
| Area | API — onboarding sections, receipts, workflow walkthrough |

## Expected behavior

A request for a child object only succeeds if that object belongs to the project named in the URL.

## Actual behavior

Three routes look up a child object by its own id alone. The access-control middleware proves the
caller manages the project *in the path* — it does not prove the child belongs to it, so supplying a
foreign id crosses the tenant boundary.

| Route | Effect |
|-------|--------|
| `PATCH …/onboarding/sections/:sectionId/review` | **Cross-tenant write** — approve or un-approve another team's sections and flip their package status |
| `GET …/onboarding/sections/:sectionId/receipts` | **Cross-tenant read of source code** — snippets, file paths and symbol summaries from another team's repository |
| `GET …/workflows/:workflowId/walkthrough` | **Cross-tenant read** — another project's file paths, symbol names, line ranges and step explanations |

The receipts route is the most severe of the three: it returns private source.

## Steps to reproduce

As owner of project A, call any of the three routes with project A's id in the path and a child id
belonging to project B. The operation succeeds against project B.

## Notes

Fix: join each child through its parent and require the project id to match — the regenerate route
already does exactly this and is the reference. All three are the same shape and should land in one
PR, each with a test asserting a 404 for a foreign child id. **First work item of M5, before any
feature work.**

---

## [P2][Open] Bug 66: The authentication surface has an unused bypass and no throttling

**Bug #66**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), security & UX audit |
| Priority | P2 |
| State | Open — Nam, M5 batch 1 |
| Area | API — auth routes, invitations |

## Expected behavior

Nobody can create an account for an email address they do not control, an invitation can only grant
the tiers it is meant to, and failed logins are throttled.

## Actual behavior

1. **An unauthenticated endpoint pre-registers any email as confirmed.** `POST /api/auth/signup` is
   unauthenticated, unrate-limited, and creates a **confirmed** account for any address. The real app
   signs up through the Supabase client (which sends a confirmation email), so this endpoint is an
   unused bypass of that confirmation. Because invitations match on email, an attacker can
   pre-register a victim's address, then accept invitations addressed to them and read the team's
   content and code snippets.
2. **Invitation tier is not validated.** `"owner"` is accepted and inserted verbatim, so an admin can
   mint a second owner on accept — bypassing both the "use ownership transfer" guard and the "cannot
   remove the owner" guard, producing an irremovable second owner. A typo'd tier throws a 500 instead
   of a 400.
3. **No rate limiting anywhere.** Login proxies the auth provider with unlimited attempts, and
   because every attempt arrives from the backend's IP, the provider's own throttling degrades auth
   for *all* users rather than for the attacker.

## Steps to reproduce

`curl -X POST localhost:3000/api/auth/signup -d '{"email":"victim@example.com","password":"…"}'`
returns 201 and the account is confirmed and loginable.

## Notes

Fix: delete the signup endpoint (it is dead code — the frontend does not use it), whitelist
invitation tiers with a 400, and add rate limiting to the auth routes. Two divergent signup paths
with different confirmation behaviour is the smell that surfaced this.

---

## [P2][Open] Bug 67: Repository import blocks large accounts and its cost safety gate is bypassable

**Bug #67**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P2 |
| State | Open — Eugene (frontend), Nam (backend), M5 batch 2 |
| Area | Import wizard, GitHub repo/branch listing |

## Expected behavior

Every repository the App is installed on is selectable, and an oversized-repo cost warning must be
acknowledged before analysis starts.

## Actual behavior

Four defects on the first flow a new user ever sees.

1. **The cost/size safety gate is bypassable.** When the preview requires acknowledgment, the
   checkbox is a frozen control that can never be ticked — while Start analysis is not gated on it.
   So the warning is silently bypassed on the exact first-run flow where oversized-repo warnings
   matter most. The Analyze dialog elsewhere in the app gates correctly and is the reference.
2. **Large accounts cannot find their repository.** Repo listing fetches one page of 100 and branch
   listing takes the API default of 30, with no pagination and no search — a hard blocker for exactly
   the org-scale teams this product targets, with no error to explain it.
3. **Already-imported repos are not marked**, and the resulting "project already exists" error has no
   link to the existing project — a common dead end after a mid-wizard refresh.
4. **Refreshing on step 2 loses the created project**, because the wizard keeps its state in
   component state only; retrying step 1 then hits the error above.

## Notes

Fix: wire the acknowledgment state and gate the button; paginate both listings to exhaustion and add
type-to-filter search; cross-reference existing projects to badge imported repos and link the
conflict; and persist the created project id in the URL so step 2 survives a refresh.

---

## [P2][Open] Bug 68: Failed requests look like empty results — and one pushes the user toward a paid action

**Bug #68**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P2 |
| State | Open — Sahib, M5 batch 3 |
| Area | Frontend data layer and error states |

## Expected behavior

A failed request shows an error with a retry. Only a genuinely absent thing shows an empty state.

## Actual behavior

A family of defects with one shape: errors are caught and discarded, so a failure is indistinguishable
from "there is nothing here".

1. **The worst instance costs money.** The onboarding package fetch catches all errors and returns
   nothing, so any server or network failure paints "No package for this role — Generate". That tells
   the user their existing package does not exist and invites them to start a **billed** generation to
   recreate something already there. The reader also has no loading state, so the same false empty
   state flashes on every load and package switch.
2. Opening a tutorial that fails shows a spinner and then snaps back to the picker, so the click looks
   broken; a failed workflow load renders "No steps found", presenting a server error as authoritative
   absence.
3. The dashboard activity feed, the API-key and ranking-weight loads, and the run-history fetch all
   swallow their errors — showing "No activity yet", an empty dropdown, or an error next to a spinner
   that never resolves.
4. A regeneration poll is not cleared on unmount, so navigating away mid-regeneration leaves a request
   firing every four seconds for up to two minutes.

## Notes

Fix: return a discriminated error result instead of nothing, track loading state separately from
emptiness, and render error-with-retry in each pane. The pattern already exists in the pages fixed
during the M4 audit passes — this is applying it to the rest.

---

## [P2][Open] Bug 69: Analysis jobs can get stuck, or fail on an error that should have been retried

**Bug #69**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P2 |
| State | Open — Nam, M5 batch 2 |
| Area | Worker job lifecycle |

## Expected behavior

Any job that cannot progress is reconciled to a failed state with an honest message, and a transient
upstream error is retried.

## Actual behavior

1. **A job whose queue submission failed stays queued forever.** The reconciler added in M3 only
   rescues jobs already *running*. Submission happens after the database commit, so if it throws, the
   project is pinned to "analyzing", the UI polls a "waiting for worker" card indefinitely, and every
   retry is rejected as "already being analyzed" — the concurrency guard doing its job on a phantom.
2. **The retry policy is a no-op.** The first failure marks the job failed, so the retry immediately
   exits on the status guard. Transient errors (an upstream 502, a network blip) surface as hard
   failures needing a manual resume.

## Notes

Fix: also fail queued jobs with no matching queue entry after a few minutes (or mark the row failed
when submission throws), and only mark a job failed on its final attempt. Distinct from #61, which
covered a live worker that stopped consuming.

---

## [P2][Open] Bug 70: The dependency graph reports "imported by 0" for everything, and search blanks the canvas

**Bug #70**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P2 |
| State | Open — Bradley (backend), Eugene (frontend), M5 batch 3 |
| Area | Dependency graph — grouped view aggregation, search |

## Expected behavior

A directory group shows how many things depend on it, and searching brings the matches into view.

## Actual behavior

1. **Every module reads "imported by 0".** In the default directory-grouped view the inbound count is
   hardcoded to zero while the outbound count is summed correctly. Confirmed live: a directory showed
   "403 imports · 0 imported by" with two inbound edges visibly drawn to it. This states the opposite
   of the tool's core claim — that it shows you what depends on what. Drilling in shows correct
   per-file counts, which makes the group view look arbitrary rather than broken.
2. **Search updates the count but not the camera.** Confirmed live: typing a query showed "2 / 60
   files" while the canvas went completely blank, because both matches were laid out off-screen.
   Users conclude search is broken. The search input is also not debounced, so each keystroke re-runs
   a full graph re-layout.

## Notes

Fix: aggregate inbound cross-directory edges into each group's count; fit the viewport to the
filtered node set once a search resolves (the camera machinery already exists, it just is not driven
by search); debounce the input.

---

## [P3][Open] Bug 71: Accessibility gaps and measured contrast failures

**Bug #71**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit + visual audit (the two HIGH items) |
| Priority | P3 |
| State | Open — Eugene, M5 batch 4 |
| Area | Routing, theme tokens, motion, keyboard reachability |

## Expected behavior

Navigation is announced, content is reachable without twenty tab stops, structural boundaries clear
WCAG's 3:1 UI-component threshold, and an OS reduced-motion preference is respected.

## Actual behavior

1. **No per-page title, no focus reset, no skip link.** Every page keeps one static title, so tab and
   history entries are indistinguishable; screen-reader users get no signal that navigation happened;
   and with no skip link, keyboard users tab through the logo, up to nine nav links, tour and
   shortcut buttons, the account card and the theme toggle on *every* page before reaching content.
2. **Dark-theme structure fails the 3:1 threshold**, measured against its own surfaces: card/background
   **1.09**, border/card **1.43**, input/card **1.43**, sidebar divider **1.26**. Confirmed live: cards
   read as barely raised and the settings inputs look like floating placeholder text. Phase 6 of the
   M4 audit work fixed the *light* theme and left the dark theme alone because its **text** contrast
   was fine — its *structural* contrast was never measured.
3. **Avatar initials are illegible** — white text on 500-weight fills measures 2.15 to 2.54, failing
   even the large-text bar.
4. **Setting a default package is impossible from the keyboard** — the control is nested inside a menu
   item that moves focus past it. Per-member defaults were the headline of #53, so this is worth
   fixing with it.
5. **No reduced-motion handling** while the app runs perpetual motion: animated flow edges, pulsing
   status dots, camera glides and smooth scrolling. This can cause dizziness or nausea for vestibular
   users.

## Notes

Fix: one route effect for title and focus, plus a skip anchor; raise the dark `border`/`input`/`card`
tokens and move the avatar palette to darker shades (every screen reads from these tokens, so it
propagates without touching a page — the same reason the light-theme fix was cheap); promote the
default-package control to its own menu item; add a reduced-motion base rule gating animation and
camera glides. **Contrast must be measured, not eyeballed** — Phase 6 caught its own approximation
error exactly that way.

---

## [P3][Open] Bug 72: Team lifecycle is a one-way door

**Bug #72**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P3 |
| State | Open — Nam, M5 batch 5 |
| Area | Invitations, membership, ownership |

## Expected behavior

Inviting someone notifies them, an invitee can decline, a member can leave, and an owner can hand
over the project.

## Actual behavior

1. **No email is ever sent** — inviting only writes a database row, yet the dialog collects an "Email
   address" and the button says "Send". The invitee only discovers the invitation if they
   independently sign up with that exact address and open their invitations page.
2. **Decline does not exist** (the button is permanently disabled), and the list shows expired
   invitations that then error on click. Invitations are also created with no expiry at all, and a
   missing expiry is treated as "never expires".
3. **There is no way to leave a project** and the API forbids self-removal, so accepting an invitation
   is permanent unless an owner removes you.
4. **Ownership transfer does not exist** — the API refuses to assign a second owner with an error that
   says "use ownership transfer instead", pointing at a feature that was never built. An owner who
   leaves the team strands the project. It is also the guard that #66's tier defect bypasses.

## Notes

Plan: add decline, expiry filtering, self-removal for non-owners, and an ownership-transfer endpoint
with a type-to-confirm dialog. The **email** half is the likely Won't-Fix — no mail provider is
provisioned; the fallback is relabelling the action "Create invitation" with a "no email is sent —
share the link yourself" hint.

---

## [P3][Open] Bug 73: The frontend image only works when the browser is on the Docker host

**Bug #73**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P3 |
| State | Open — Nam, M5 batch 6 |
| Area | Frontend build, nginx |

## Expected behavior

The API origin is configurable per deployment.

## Actual behavior

The API origin is inlined into the JavaScript bundle at build time and the build takes no argument
for it, so the image is pinned to `localhost:3000`. **Not a blocker for grading** — the documented
Docker Compose setup is exactly that case — but it blocks any non-localhost deployment, and it is why
the Content-Security-Policy has to name `localhost:3000` explicitly instead of `'self'`.

## Notes

Fix: accept the origin as a build argument from compose, or serve the API through the frontend's
nginx on a relative path — the second option also lets the CSP tighten.

---

## [P4][Open] Bug 74: [Tracker] Polish tail from the two end-of-M4 audits

**Bug #74**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Open — Eugene, M5 batch 7 |
| Area | Frontend and backend, various |

## Expected behavior

The polish tail is tracked and either fixed or explicitly closed, not quietly forgotten.

## Actual behavior

The two audits run on 2026-07-22 produced 49 findings below the individually-tracked bar — 31 in
`UX_AUDIT_FINDINGS.md` and 18 in `UX_VISUAL_AUDIT.md`.
Filing 49 separate issues would bury the ten that matter, so they are tracked here as one checklist.

> **⚠ Provenance corrected 2026-07-25.** Both audit documents were **rewritten** on 2026-07-25 and no
> longer contain these 49 items — a live link to them would resolve to unrelated content. They survive
> only in git history: **`git show 2efba04 -- doc/UX_AUDIT_FINDINGS.md doc/UX_VISUAL_AUDIT.md`**.
> Because that makes this ticket the only durable record, the item list below is expanded from
> "representative" to **the actual checklist**. Do not treat the current audit documents as its source.

The checklist:

**Backend (13)**
- [ ] `backend/src/api/routes/members.ts:57` — `permission_tier` on invitations is not validated; `"owner"` is accepted and inserted verbatim on accept. An admin.
- [ ] `backend/src/api/routes/github.ts:160` — OAuth/link catch-alls return `err.message` verbatim (400), and lib errors embed raw GitHub/Supabase response bodie.
- [ ] `backend/src/api/app.ts:10` — No rate limiting anywhere; `POST /api/auth/login` proxies `signInWithPassword` with unlimited attempts. Brute-forceable, and.
- [ ] `backend/src/api/routes/members.ts:83` — Invitations are inserted with no `expires_at`, and the accept path treats NULL as never-expiring. Pending invites.
- [ ] `backend/src/worker/index.ts:780` — The orphan reconciler only rescues `status='running'` jobs. A job whose DB row committed but whose Redis enqueue failed.
- [ ] `backend/src/worker/index.ts:244` — BullMQ `attempts: 2` is a no-op: the first failure stamps the DB row `failed`, so the retry immediately hits the `KillS.
- [ ] `backend/src/api/routes/projects.ts:159` — When no branch is supplied and the GitHub repo fetch fails (revoked access / deleted repo), it becomes a generic.
- [ ] `backend/src/api/routes/members.ts:83` + `frontend/src/pages/TeamPage.tsx:305` — "Inviting" only inserts a DB row — no email is ever sent — yet the dialog.
- [ ] `backend/src/api/routes/members.ts:67` — Invite creation does no email trim/format check and doesn't reject self-invites or existing members. A whitespace-.
- [ ] `backend/src/api/routes/graph.ts:73` — In the default directory-grouped dependency view, every group is built with `dependentCount: 0` hardcoded while `imp.
- [ ] `backend/src/api/middleware/project-access.ts:15` — A non-UUID `:id` (truncated shared link) makes Postgres throw, caught as a 500 instead of a comprehensi.
- [ ] `backend/src/api/app.ts:30` — The global error handler ignores `err.status`, so malformed-JSON (400) and payload-too-large (413) both surface as 500.
- [ ] `backend/src/api/app.ts:7` — No `compression()` middleware, and large graph payloads have no node caps: `/graph/classes` and `/graph/architecture` (incl. a.

**Frontend (48)**
- [ ] `frontend/src/pages/OnboardingPage.tsx:1125` — The reader has no loading state for the package fetch; `pkg` starts `null` so `isMissing` immediately paints.
- [ ] `frontend/src/pages/OnboardingPage.tsx:639` — `handleRegenerateSection`'s 4s poll interval is a local variable, cleared only from inside its own callback;.
- [ ] `frontend/src/pages/ProjectOverviewPage.tsx:452` — `packagesError`/`statusError` are only surfaced in the `neverAnalyzed` branch. On an already-analyzed pr.
- [ ] `frontend/src/pages/ImportPage.tsx:484` — Already-imported repos aren't marked or filtered, and the resulting 409 "Project already exists" is a bare error.
- [ ] `frontend/src/pages/ImportPage.tsx:91` — The two-step wizard keeps `createdProjectId` and step-1 selections only in component state. Refreshing on "Step 2.
- [ ] `frontend/src/pages/ResetPasswordPage.tsx:26` — The page never reads Supabase's `#error=access_denied&error_code=otp_expired` hash on an expired/invalid re.
- [ ] `frontend/src/pages/LoginPage.tsx:44` — "Sign in with GitHub" drops the deep link. Email login preserves `location.state.from`, but `signInWithGithub()` re.
- [ ] `frontend/src/pages/LoginPage.tsx:76` — None of the four auth pages set `autocomplete` (login lacks `email`/`current-password`, signup lacks `email`/`new-p.
- [ ] `frontend/src/pages/AccountSettingsPage.tsx:373` — Unlinking a GitHub/email sign-in identity happens instantly on click with no confirmation, while the *le.
- [ ] `frontend/src/pages/AccountSettingsPage.tsx:538` — The "Add email sign-in" dialog is a `<div>` with onClick buttons, not a `<form onSubmit>`, so pressing E.
- [ ] `frontend/src/pages/SignupPage.tsx:46` — "Sign up with GitHub" has no loading state and doesn't mutually disable with the submit button (LoginPage shares `.
- [ ] `frontend/src/pages/ResetPasswordPage.tsx:110` — Test convenience leaks into user copy: the confirm field is labeled "Confirm new" (truncated) and the mism.
- [ ] `frontend/src/pages/InvitationsPage.tsx:221` — The Decline button is permanently disabled (no decline endpoint exists), and the list also shows expired inv.
- [ ] `frontend/src/pages/TeamPage.tsx:208` — There is no "Leave project" anywhere in the UI, and the backend forbids self-removal (members.ts:216). Anyone who a.
- [ ] `frontend/src/components/ProjectCard.tsx:119` — The card's "Delete project" menu shows for owner *and* admin, but the API requires owner (projects.ts:486),.
- [ ] `frontend/src/pages/OnboardingPage.tsx:989` — "Mark reviewed" renders only for owner/admin (API agrees), yet the tour sells it as "your progress tracker" a.
- [ ] `frontend/src/pages/GraphPage.tsx` (dependency search) — Searching filters the match count but never recenters the viewport onto the matches. *(Confirmed l.
- [ ] `frontend/src/pages/GraphPage.tsx:82` — The `?focus=` deep-link param is re-resolved on every `loadGraph` and never removed from the URL. On a clustered re.
- [ ] `frontend/src/pages/WorkflowsPage.tsx:137` — The workflow-graph fetch (and the package-keyed loads in ArchitecturePage/CapabilitiesPage/ClassGraphSection/G.
- [ ] `frontend/src/pages/GraphPage.tsx:208` (+ `ClassGraphSection.tsx:67`) — The graph search input isn't debounced; each keystroke re-runs a full union-find +.
- [ ] `frontend/src/components/graph/GraphFirstVisitHint.tsx:37` — The first-visit hint copy is hardcoded to the files view ("map of how files depend… open it on.
- [ ] `frontend/src/components/graph/ModuleNode.tsx:3` — Leftover commented-out code shipped in a per-node component: a commented import, a dead `const complexit.
- [ ] `frontend/src/App.tsx:93` — No skip-to-content link and `<main>` regions aren't focus targets. Keyboard users Tab through the logo, 4–9 nav links, tour/sho.
- [ ] `frontend/src/pages/ImportPage.tsx:407` (+ TeamPage, ProjectSettingsPage, ArchitecturePage, ProjectOverviewPage) — Many `<Label>`s lack `htmlFor` and their.
- [ ] `frontend/src/pages/ProjectSettingsPage.tsx:266` (+ Dashboard, Import, Team, Invitations, Onboarding, AnalyzeDialog, AccountSettings) — Async error/status.
- [ ] `frontend/src/pages/DashboardPage.tsx:250` (+ ~13 other pages) — Full-page loading is a bare spinning `Loader2` with no `role="status"`/sr-only text, so du.
- [ ] `frontend/src/pages/WorkflowsPage.tsx:186` — No `prefers-reduced-motion` handling anywhere while the app runs continuous motion: every workflow edge is `an.
- [ ] `frontend/src/pages/WalkthroughTab.tsx:310` (+ OnboardingPage, InvitationsPage) — Selected item in several toggle lists is conveyed only by background colo.
- [ ] `frontend/src/components/AnalysisRunPanel.tsx:177` + `PackageSelector.tsx:120` — Pipeline phase status and package status are conveyed solely by icon color.
- [ ] `frontend/src/pages/TeamPage.tsx:340` — Avatar initials are white text on `bg-amber-500`/`emerald-500`/`cyan-500` (~1.6:1 on amber) — illegible for low-vis.
- [ ] `frontend/src/pages/OnboardingPage.tsx:1110` (+ several) — Meaningful sub-12px text at reduced opacity (`text-muted-foreground/50`, `opacity-50` at 10–11px.
- [ ] `frontend/src/pages/ProjectSettingsPage.tsx:278` (+ ProjectOverviewPage, OnboardingPage) — Heading levels skip `h1 → h3` with no `h2`, breaking the screen-.
- [ ] `frontend/src/components/AppTour.tsx:119` — On tour end, focus isn't restored to the triggering element (it grabbed focus into the card on open), dropping.
- [ ] `frontend/src/hooks/useHotkeys.ts:33` — Global single-character shortcuts (`[`, `]`, `1`-`9`, `?`) are always active with no way to disable/remap — a WCAG.
- [ ] `frontend/src/components/SidebarShell.tsx:60` — The sidebar toggle has `aria-label` but no `aria-expanded`/`aria-controls`.
- [ ] `frontend/src/pages/ProjectSettingsPage.tsx:251` — A failed project deletion writes to the page-level error banner, but the confirmation dialog has no erro.
- [ ] `frontend/src/pages/WalkthroughTab.tsx:262` — `openTutorial`'s catch is empty; a tutorial that 500s shows a spinner then silently snaps back to the picker.
- [ ] `frontend/src/lib/api.ts:48` — On a final 401 there's no shared redirect-to-login; pages print raw text like "API error 401" until Supabase's SIGNED_OUT ev.
- [ ] `frontend/src/pages/DashboardPage.tsx:162` — The activity-feed fetch swallows errors (`.catch(() => {})`), so on failure users with real activity see "No a.
- [ ] `frontend/src/pages/ProjectOverviewPage.tsx:716` — On run-history fetch failure, `runs` stays `null`, so the error text renders together with a spinner tha.
- [ ] `frontend/src/pages/ProjectSettingsPage.tsx:135` — The llm-key and ranking-weights loads swallow errors, leaving a permanently empty role dropdown / "no ke.
- [ ] `frontend/src/components/PackageSelector.tsx:108` — The "make default" star calls `void setDefaultPackage(...)` and never catches the rejection — it can fa.
- [ ] `frontend/nginx.conf:1` — The prod nginx config has SPA fallback only — no `gzip`, no `Cache-Control` for `index.html` or hashed `/assets/*`. Big JS ships.
- [ ] `frontend/index.html:3` — No `<meta name="description">` or `theme-color`, and the theme-bootstrap `catch` forces dark mode when localStorage throws, ignor.
- [ ] `frontend/src/components/ProjectLayout.tsx:190` — The branch `Badge` in the 224px sidebar has `whitespace-nowrap` and no `max-w`/`truncate` (the repo name.
- [ ] `frontend/src/pages/InvitationsPage.tsx:107` — "Pending Invitations" (title) vs "Active Invitations" (list heading, 3 lines down) vs "Invitations" (sidebar.
- [ ] `frontend/src/pages/LoginPage.tsx:117` — Mixed verbs/casing on the app's front door: "Sign In" (Title Case) above "Sign in with GitHub" (sentence case), wh.
- [ ] `frontend/src/pages/OnboardingPage.tsx:450` — The onboarding reader always uses `setParams({ replace: true })`, so opening a package card replaces the grid.

**Cross-cutting (2)**
- [ ] Architecture view (AI-generated component summaries) — *(Observed live)* a component card read "Database Schema: 0 files." in its description while showing.
- [ ] One action, four names: the import action is "Add Project" (headers), "Import Repository" (empty state), "Add New Repository" (`ProjectListPage.tsx:161`),.

## Notes

Plan for M5: work the two audit documents as a checklist in priority order, naming and terminology
first because that is what a reviewer notices. Anything not done by the freeze is closed
**Won't-Fix with its specific reason**, so the tracker ends clean rather than open.

---

---

## [P1][Closed] Bug 75: A failed analysis leaves its snapshot marked `complete`, so the failure is invisible

**Bug #75**

| Field | Value |
|-------|-------|
| Date created | 2026-07-25 |
| Reported by | OnboardBuddies (Team 15) — eleven-project audit |
| Priority | P1 |
| State | Closed |
| Area | Backend — worker pipeline, `analysis_snapshots.status`, `lib/projectStatus.ts` |

## Expected behavior

A run that does not finish every phase leaves its snapshot in a non-success state, and the project
surfaces that. A user who opens a project whose analysis failed is told it failed.

## Actual behavior

Two of nine fresh analyses (`KuanKongy/MasterPokedex`, `KuanKongy/StudyFlow`) died at **98%** with
`canceling statement due to statement timeout`. In both cases:

- `analysis_jobs.status = 'failed'`
- **`analysis_snapshots.status = 'complete'`**
- `generate_package` was never enqueued, so the package has **0 sections**

`lib/projectStatus.ts` derives the project status as *"anything ever completed ⇒ complete"*, so the
wrongly-completed snapshot propagates to the project card. Both projects present as analyzed. Opening
**Your Onboarding** shows nothing — no error, no warning, no reason to retry.

This is worse than a visible crash: the worker-restart path produces an excellent message
(*"Worker lost this run (restart or crash). Completed phases are checkpointed — run Analyze… again to
resume from cache."*) and this path produces silence.

## Notes
**Fixed 2026-07-25/26** (`WIP: M4 rework — … concurrency` / `runStatus.test.ts`, "bugs #75 / #77 /
#80"): the run now owns its snapshot's status end-to-end — a run that dies after persistence marks
the snapshot `failed` rather than leaving a stale `complete`, and never stomps a genuine `paused`.


Three fixes, independent:
1. Only a run that completes every phase may write `status = 'complete'` on its snapshot; a run that
   dies mid-pipeline must leave `failed` or `partial`.
2. Treat "snapshot complete **and** package has 0 sections" as a failure state in the UI regardless of
   any status column — the data to detect it is already loaded.
3. Surface `paused` and its reason; today the reason lives only in `analysis_jobs.error_message`, which
   no screen reads.

Found and re-verified in [UX_AUDIT_FINDINGS.md §18.6](./UX_AUDIT_FINDINGS.md#186-a-failed-analysis-is-indistinguishable-from-a-successful-one).

---

## [P1][Closed] Bug 76: Statement timeout kills ~22% of fresh analyses at the final persistence step

**Bug #76**

| Field | Value |
|-------|-------|
| Date created | 2026-07-25 |
| Reported by | OnboardBuddies (Team 15) — eleven-project audit |
| Priority | P1 |
| State | Closed |
| Area | Backend — worker persistence, Supabase transaction-mode pooler |

## Expected behavior

Analysis of a mid-size repository completes. Bulk writes are chunked to fit the pooler's statement
timeout regardless of repo size.

## Actual behavior

**Two of nine** fresh analyses failed with the identical Postgres error at the identical point —
`canceling statement due to statement timeout` at **98%** progress:

| Repo | Files | Analyzed |
|---|---|---|
| `KuanKongy/StudyFlow` | 186 | 102 |
| `KuanKongy/MasterPokedex` | 107 | 90 |

Both are mid-size. A timeout at the last persistence step points at a single oversized write — a bulk
insert of semantic records or embeddings — that scales with repo size and is not chunked. `DATABASE_URL`
is the **transaction-mode** pooler (port 6543), where a long single statement is exactly what gets cut.

## Notes
**Fixed 2026-07-25/26** (`lib/pgRetry.ts`, `statementTimeoutCoverage.test.ts`): a one-shot retry on
SQLSTATE 57014 now wraps every autocommit-mode bulk write on both the semantic and analysis sides —
the exact write the six-way-concurrency run of 2026-07-26 showed cancelling.


Reproduce directly against `DIRECT_DATABASE_URL` with `log_min_duration_statement` to identify the
statement, then chunk it the way the record inserts already are. Both runs were resumed successfully
from checkpoint afterwards, so the work is not lost — but a 22% first-run failure rate on imports is
the single biggest reliability number in M4, and it is invisible to the user because of #75.

---

## [P2][Closed] Bug 77: One invalid LLM section pauses the entire onboarding package at 0%

**Bug #77**

| Field | Value |
|-------|-------|
| Date created | 2026-07-25 |
| Reported by | OnboardBuddies (Team 15) — eleven-project audit |
| Priority | P2 |
| State | Closed |
| Area | Backend — `worker/generation`, structured-output validation |

## Expected behavior

Sections generate in parallel and degrade independently. A section whose model output fails validation
is marked low-confidence or omitted with a visible gap; the other eleven still ship.

## Actual behavior

`KuanKongy/NationalPokedex` package generation **paused at 0%**:

```
LLM work paused: section: structured output invalid:
structured output failed validation after retry:
Expected ',' or ']' after array element in JSON at position 8439
```

Truncation at byte 8439 after a retry looks like an output-token ceiling rather than a model mistake.
One section blocked all twelve, leaving the project with a `paused` snapshot and **0 sections** — and,
per #75, no user-visible explanation.

## Notes
**Fixed 2026-07-25/26** (`runStatus.test.ts` "#77: a plain section failure becomes a recorded gap; a
run-control signal is never absorbed"): one section's hard failure now becomes a named gap instead of
pausing/discarding the other eleven; a partial package is a package with a recorded gap, not a silent
one.


Cap or stream the section payload so it cannot exceed the output limit, and make the failure per-section
rather than per-package. `SECTION_CONCURRENCY` already generates them in parallel, so the blast radius
is a policy choice, not an architectural constraint.

---

## [P1][Closed] Bug 78: The entrypoint detector only recognises HTTP-shaped code, and blames the repo when it finds nothing

**Bug #78**

| Field | Value |
|-------|-------|
| Date created | 2026-07-25 |
| Reported by | OnboardBuddies (Team 15) — eleven-project audit |
| Priority | P1 |
| State | Closed |
| Area | Backend — `worker/engine/entrypointDetector.ts`; Frontend — Workflows empty state |

## Expected behavior

Event-driven, real-time, CLI and scheduled architectures produce entrypoints and traced flows. When
they cannot be detected, the product says the **detector** did not match, not that the **repo** has
nothing.

## Actual behavior

Across every project ever analyzed: `http_route` **167**, `ui_route` **22**, `package_export` **5**,
`worker_job` **2**, and **`event_listener` 0, `scheduled_job` 0, `cli` 0, `serverless_handler` 0**.
`doc/DETECTION_COVERAGE.md:15` advertises eight types; four have never fired.

`KuanKongy/Skribbl` is a real-time multiplayer game with **20 distinct Socket.IO events** across 22
`socket.on(` sites. Detected entrypoints: **1** — `GET /health`, at **high confidence**. Because
workflows are composed from entrypoints, its only "traced flow" is its CI YAML file, rendered as one
node with zero edges under a "high confidence" pill.

Cause — `entrypointDetector.ts:140` gates event-handler detection on the **file path** matching
`/worker|listener|consumer|jobs?\//i` **and** requires an exported named function. Skribbl registers
its events as inline closures inside `server/src/handlers.js`: wrong path, not exported. The comment
20 lines below shows the same bug class was already found and fixed **only for our own pattern**:
*"BullMQ-style queue consumers … invisible to the named-export heuristic above, which is why the analyze
pipeline never traced as a workflow."*

Confirmed independently on a second real-time repo (`Multiplayer-Tetris`: 2 entrypoints, 0 workflows)
and on `UBCPSS` (1 entrypoint, 0 workflows) and `DeepRecall` (0 entrypoints) — all clean runs.
Consequence when the bucket is wrong rather than empty: the static `kuankongy.github.io` portfolio, which
has **no server at all**, reports two workflows named `HTTP InputController.onKeyDown` and
`HTTP InputController.clearRepeat` — keyboard listeners presented as HTTP endpoints.

## Notes
**Fixed 2026-07-25/26** (`Surface what each project actually does, on every archetype`,
`entrypointDetector.ts`): adds `ui_action` entrypoints (a component reaching an effect via a resolved
call, not a string-matched name), library/CLI manifest-surface detection (`exports`/`bin`), and a
broadened effect vocabulary (document-store, client SDKs, Firestore, browser storage, redis) beyond
HTTP routes. Validated: MasterPokedex 10→26 entrypoints, StudyFlow 5→22 effects, p-limit/ky libraries.


1. Detect the **call**, not the filename: match `X.on('event', …)`, `addEventListener`, `process.on` at
   any path, taking the string literal as the name — exactly as the BullMQ detector already takes its
   queue name.
2. Never rate a lone `/health` as a high-confidence entrypoint set; denylist health/readiness/metrics
   probes and say *"no application entrypoints detected"* instead.
3. Rewrite the Workflows empty state, which currently says *"If the repo has no detectable entry points,
   none can be traced — that's reported honestly, not invented."* That blames the repo, and its `Retry`
   button re-spends money for a deterministic identical result. This wording fix needs no detector work
   and is the cheapest credibility win in the audit.

---

## [P1][Closed] Bug 79: Languages the analyzer cannot parse are never disclosed after import

**Bug #79**

| Field | Value |
|-------|-------|
| Date created | 2026-07-25 |
| Reported by | OnboardBuddies (Team 15) — eleven-project audit |
| Priority | P1 |
| State | Closed |
| Area | Backend — section generation; Frontend — reader trust strip, Architecture map |

## Expected behavior

A developer reading generated onboarding docs is told what share of the codebase was analyzed, in the
reader, every time.

## Actual behavior

`KuanKongy/FloowForge`'s README calls its `api/` **FastAPI execution engine** the core of the product;
the repo has **49 `.py` files, more than its 46 `.tsx`**. The snapshot's own metadata records
`"unsupported": {"python": 49}, "supportedFileCount": 65`.

Across **28,661 characters of generated prose in 12 sections**, the strings `python`, `fastapi`, `.py`,
`not analyzed`, `skipped` and `unsupported` appear **zero times**; `warnings` is `[]`. All nine
architecture clusters are frontend or generic — there is no engine and no API. `language_inventory` is
referenced in exactly **one** frontend file, `components/PreflightPreview.tsx` — the **import** screen.
So coverage is disclosed once, before analysis, to the person importing, and never to the newcomer.

`CourseInsights` is worse in raw terms: **382 files, 42 analyzed (11%)**, and it ships a confident
12-section guide.

Related: only **3** source receipts in the entire database cite a `.md` file, so READMEs are counted in
the file census and then not used as evidence. `kuankongy.github.io`'s generated `setup_run` says *"There
are no specific commands for running the project … documented"* while its README contains
`npm install` / `npm run dev` and a four-row script table.

## Notes
**Fixed 2026-07-25/26** (`snapshot.unreadStacks.mustDisclose` + generation prompt rules): sections
must now state the exact unparsed-language file counts in their opening paragraphs and add a "Not
covered here" subsection when a whole stack was never parsed. Golden check "the unread Python
subsystem is named" flipped from red to green on FloowForge.


1. Add a coverage clause to the reader trust strip, which already reports ratios of exactly this shape
   (`cites 77 of 435 symbols in 32 files`): `65 of 116 code files analyzed · 49 Python files not parsed`.
2. Put a greyed, non-clickable node on the Architecture map for unparsed mass — `api/ (49 Python files —
   not analyzed)`. A visible hole is honest; an invisible one is a lie of omission, and it appears
   exactly where the wrong conclusion would otherwise be drawn.
3. Feed `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md` and `docs/**` into the `setup_run`,
   `big_picture` and `first_change` prompts as first-class cited context. FloowForge ships an
   `ARCHITECTURE.md` that names the FastAPI engine the tool missed entirely.

---

---

## [P1][Closed] Bug 80: A paused package generation blanks completed analysis data, inconsistently across tabs

**Bug #80**

| Field | Value |
|-------|-------|
| Date created | 2026-07-25 |
| Reported by | OnboardBuddies (Team 15) — eleven-project audit |
| Priority | P1 |
| State | Closed |
| Area | Frontend — WorkflowsPage, CapabilitiesPage; Backend — snapshot status semantics |

## Expected behavior

Deterministic extraction that completed is visible regardless of whether the LLM write-up has finished.
All tabs agree on whether a snapshot's data exists.

## Actual behavior

`KuanKongy/NationalPokedex` snapshot `998a15b7` has `status = 'paused'` (package generation unfinished)
while its `analyze_scope` job is **complete at 100%**. The snapshot contains **71 entrypoints, 71
workflows, 6 architecture clusters and 4 capabilities**.

| Tab | Data present | Rendered |
|---|---|---|
| Architecture | 6 clusters | yes |
| Dependencies | 298 nodes | yes |
| **Workflows** | **71 workflows** | **"No workflows traced yet … if the repo has no detectable entry points, none can be traced"** |
| **Capabilities** | **4 capabilities** | **"No capabilities extracted yet"** |

Three defects stacked: (a) an unfinished *package* suppresses *analysis* results that are complete, because
both share one snapshot status; (b) the four tabs disagree — two read the paused snapshot, two refuse it;
(c) **the state is permanent.** After a resume, `generate_package` reached `complete` at 100% with all 12
sections written, and the snapshot **remained `paused`** — so the two tabs stay empty indefinitely on a
project with 71 workflows and a finished package. The Workflows copy is also provably false here, since 71
entrypoints were detected.

## Notes
**Fixed 2026-07-25/26** (`runStatus.test.ts` "#80: a stopped generation never wedges on 'generating',
and a finished one un-pauses its snapshot"): the status transition is fixed at the source, so a
completed `generate_package` always returns its snapshot to `complete` and tabs no longer blank.


Fix the status transition first — a `generate_package` that completes must return its snapshot to
`complete`. Then gate tab content on row existence rather than on the snapshot's package status, so a
stuck status can never blank extracted data again. Make the empty state distinguish the three real cases — detector matched nothing / analysis failed / still generating — using
`analysis_jobs`, which already holds the information. See
[UX_AUDIT_FINDINGS.md §18.7](./UX_AUDIT_FINDINGS.md#187-a-paused-package-hides-a-completed-analysis--and-only-on-some-tabs).

---

---

## [P1][Closed] Bug 81: Fullscreen graph has no visible exit — the overlay covers its own toggle

**Bug #81**

| Field | Value |
|-------|-------|
| Date created | 2026-07-25 |
| Reported by | Product owner, reproduced from source |
| Priority | P1 |
| State | Closed |
| Area | Frontend — `pages/ArchitecturePage.tsx`, `pages/GraphPage.tsx`, `components/PageHeader.tsx` |

## Expected behavior

A fullscreen mode has a visible way out.

## Actual behavior

**Confirmed by operating the control** (Playwright, foreground tab, `elementFromPoint` hit-test at the
button's own centre), which also corrected the mechanism this ticket originally asserted:

| | Before click | After click |
|---|---|---|
| `title` | `Fullscreen` | **`Exit fullscreen (Esc)`** |
| Hit-test at its own centre | **not covered** | **covered** |
| Covered by | — | **`react-flow__pane`** |
| Controls rendered inside the fullscreen overlay | — | **none** |
| "Esc" hinted anywhere on screen | — | **no** |
| Escape actually exits | — | **yes** |

So: `ArchitecturePage.tsx:246` gives the graph container `fixed inset-0 z-50 bg-background p-3`, the
only toggle lives in `PageHeader`'s `actions` (`:180–187`), and once fullscreen engages **the React Flow
canvas covers that button**. The Escape handler (`:64–70`) does work, but the sole documentation of it is
the `title` of the element that just became unreachable, and **no control is rendered inside the overlay
at all**. `GraphPage.tsx:325–328` is structurally identical.

*(The original text of this ticket blamed `z-50` painting over an unstacked `PageHeader`. That was read
from CSS and was wrong about the occluder — it is the canvas. The user-visible defect is unchanged.)*

## Notes
**Fixed 2026-07-25/26** (`GraphPage.tsx`, tagged `AUDIT C11 / B81` at the call site): an explicit
"Exit fullscreen (Esc)" control now renders inside the fullscreen overlay itself, not only behind it.


Render an exit control **inside** the fullscreen container (top-right, over the canvas), and/or give the
header `relative z-[60]`. Add a transient "Press Esc to exit" hint on entry. See
[UX_AUDIT_FINDINGS.md §19.8](./UX_AUDIT_FINDINGS.md#198-fullscreen-has-no-visible-way-out).

---

## [P1][Closed] Bug 82: Selecting a graph node discards the user's viewport (absolute `zoom: 1.15`)

**Bug #82**

| Field | Value |
|-------|-------|
| Date created | 2026-07-25 |
| Reported by | Product owner, reproduced at runtime and traced to source |
| Priority | P1 |
| State | Closed |
| Area | Frontend — `components/graph/ViewportFocus.tsx` (affects Architecture, Workflows, Dependencies) |

## Expected behavior

Selecting a node to read its details preserves the surrounding context the user had established.

## Actual behavior

`ViewportFocus.tsx:23` defaults `zoom = 1.15` and `:59` calls
`setCenter(nodeCenter, { zoom, duration: 500 })`. **All three callers use the default** —
`ArchitecturePage:266`, `WorkflowsPage:329`, `DependencyGraphView:196` pass `fitPadding` /
`fitMinZoom` / `ownsInitialFit` but never `zoom`. Measured at runtime: viewport transform moved
`0.93843` → `1.15` with a pan.

Consequences:
- **Absolute, not relative.** On the Dependencies drill-in, where `fitView` lands at **0.15×**, one click
  is a **7.7× jump** from whole-graph to single-node.
- **Selection is also inspection**, so a node's details cannot be read without losing the overview, and
  the overview only returns by deselecting, which closes the details.
- **Simultaneously the canvas loses 320px** — `ArchitecturePage.tsx:246` switches to
  `grid lg:grid-cols-[1fr_320px]` when something is selected.
- **It defeats its own feature.** The legend promises *"its direct neighbors stay lit while everything
  else dims"*; centring at 1.15× often pushes those neighbours off-screen.

## Notes
**Fixed 2026-07-25/26** (`components/graph/ViewportFocus.tsx`): selecting a node no longer calls
`setCenter(..., { zoom: 1.15 })`. Selection is at most a pan-into-view nudge; the absolute-zoom frame
is reserved for `DrillCamera`'s explicit drill-down transitions.


Pan the minimum distance to bring the node inside the remaining pane and keep the current scale
(`setCenter` with `getZoom()`); no-op when the node is already visible. Put an explicit "zoom to this" in
the detail panel where the user asks for it. See
[UX_AUDIT_FINDINGS.md §19.7](./UX_AUDIT_FINDINGS.md#197-clicking-a-node-throws-away-your-view--setcenterzoom-115).

---

## [P1][Closed] Bug 83: Known-gaps and citation blocks bloat the reader; counts disagree with the page

**Bug #83**

| Field | Value |
|-------|-------|
| Date created | 2026-07-25 |
| Reported by | Product owner, reproduced and measured |
| Priority | P1 |
| State | Closed |
| Area | Backend — gap generation; Frontend — reader gap/citation rendering |

## Expected behavior

Gaps and citations are scannable and their counts agree with the header. Repetition is grouped.

## Actual behavior

FloowForge **Guardrails & Operations** ends with **34 consecutive lines** identical except a variable
name — *"gap — There are no documented guardrails for `X`."* — generated one-per-variable from
`api/.env.example` and `web/.env.example`. Measured: **996px of 1,572px = 63% of the section**, with the
word `gap` repeated 34 times as a prefix. Several are not real gaps (`SUPABASE_URL`, `REDIS_URL`,
`OPENAI_API_KEY` need no "documented guardrails").

`code_map` renders **16** gaps, all beginning with the word `Unknown`, all describing *the pipeline's own
evidence* rather than the codebase — **3 are byte-identical apart from the filename** (*"does not contain
direct snippet information."*).

**The header contradicts the page:** the trust strip says **"5 known unknowns"** while `guardrails_ops`
shows **34** and `code_map` shows **16**; the twelve sections hold **89**.

Citations: `code_map` lists **43 chips**, each a number plus a bare file path (DOM text
`28packages/shared/src/index.ts`) — no symbol, no line range, no claim, no collapse, some duplicated.
And `record_reference` receipts — **459 of FloowForge's 662 (69%)** — carry **no file, no symbol, and in
443 cases no claim**, while still counting toward the citation totals the product uses to demonstrate
trustworthiness.

## Notes
**Fixed 2026-07-25/26** (`backend/src/api/lib/gapSummary.ts`): known gaps are now deduped by template
(not rendered string) and reported as one grouped row with a count instead of one row per instance;
citation counts are reconciled so the trust strip and the sections agree.


Group and collapse (`No documented guardrails for 34 environment variables (show)`); dedupe on the gap
*template* not the rendered string; drop config-name gaps entirely; report `43 citations · 21 you can
open`; put `file.ts:120–134 · symbolName` on the chip (those ranges are verified accurate per §17.1);
reconcile the strip and say what it counts; and rewrite gap copy to describe the codebase, not the
pipeline. See [UX_AUDIT_FINDINGS.md §19.3](./UX_AUDIT_FINDINGS.md#193-the-citations-footer-43-numbered-file-paths-with-no-names)
and [§19.4](./UX_AUDIT_FINDINGS.md#194-known-gaps-34-copies-of-one-sentence-63-of-a-section).

---

## Filing these on GitHub

**Done — all 83 bugs (#1–#83) are filed on `github.students.cs.ubc.ca/CPSC455-2026S/team15`.**
#1–#52 were filed manually in an earlier session. #53–#83 were filed on 2026-07-25 (GitHub issues
#76–#106; issue numbers don't equal Bug N — see note below); #53–#64 were closed with a fix-note
comment, #65–#83 left Open per this document's State column. Labels: `P0`–`P5` on every issue,
`milestone-4` on #53–#74 only (#75–#83 are the 2026-07-25 audit findings, not M4 sprint work),
`security` on #63–#66.

To re-sync after future edits to this document:

```sh
gh auth login -h github.students.cs.ubc.ca                  # re-authenticate first
scripts/sync-github-issues.sh --dry-run --from 53 --to 83   # prints every gh command it would run
scripts/sync-github-issues.sh --from <N> --to <M>           # files/closes only the new or changed range
```

**Never run `--from 1`.** #1–#52 were filed manually (not via this script) before this document
existed in its current form, and 9 of those titles carry a stray leading space — `" Bug 1: …"`,
`" Bug 3: …"`, `" Bug 8: …"`, `" Bug 11: …"`, `" Bug 16: …"`, `" Bug 19: …"`, `" Bug 23: …"`,
`" Bug 26: …"`, `" Bug 37: …"` — that the script's exact-string title dedup will not match against
the clean `"Bug N: …"` it constructs from this doc. A `--from 1` run reports those 9 as new and
files duplicates. If #1–#52 ever need re-syncing, fix the 9 titles on GitHub first (strip the
leading space) or dedup by number instead of exact title before running below #53.

The script reads the `## [P…][State] Bug N: …` blocks straight out of this file, so this document
stays the single source of truth and the tracker cannot drift from it. Its title-based dedup does a
byte-exact match against existing issue titles — if a bug's title here is ever edited after filing,
re-running the script will create a duplicate rather than updating the existing issue.
