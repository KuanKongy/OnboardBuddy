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
| **Close** | #37 | Done 2026-08-07: closed as GitHub issue #56 with the fix notes. The provider config was fixed by the single-App switch (2026-08-03) and sign-in verified live — the entry's closing criterion. |
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
| 1 | encrypt('') does not round-trip through decrypt() | P4 | Closed | Fixed (M5) |
| 2 | requireProjectAccess did not catch DB query errors | P2 | Closed | Fixed |
| 3 | GitHub routes fail when github-app.pem is missing | P1 | Closed | Fixed (M5) |
| 4 | Signup does not validate email format server-side | P3 | Closed | Absorbed by #66 (M5) — endpoint deleted |
| 5 | Signup password minimum mismatches frontend (6 vs 8) | P3 | Closed | Absorbed by #66 (M5) — endpoint deleted |
| 6 | ProjectContext fetchProject missing useCallback deps | P3 | Closed | Already fixed — verified with the rule (M5) |
| 7 | apiFetch sends Content-Type on GET requests | P4 | Closed | Fixed (M5) |
| 8 | GitHub repos rejects installation_id=0 | P3 | Closed | Fixed (M5) — filed symptom unreachable, a reachable one found in the same guard |
| 9 | Project settings uses fragile dynamic SQL pattern | P2 | Closed | Fixed (M5) |
| 10 | Project delete relies on CASCADE without verification | P3 | Closed | Did not reproduce — cascade verified against the live DB, now pinned by a test (M5) |
| 11 | Team member removal uses confusing double /members/ path | P2 | Closed | Fixed (verified 2026-07-25) |
| 12 | App.test.tsx broken after auth routing refactor | P2 | Closed | Fixed |
| 13 | saveGithubTokenFromSession / save-token flow | P4 | Closed | Fixed |
| 14 | InvitationsPage error persists across operations | P3 | Closed | Fixed (M5) |
| 15 | CORS falls back to localhost when CORS_ORIGIN unset | P3 | Closed | Fixed (M5) |
| 16 | Mark as Reviewed was UI-only (did not persist) | P2 | Closed | Fixed |
| 17 | Analysis generates onboarding for all 5 roles, not just selected role | P2 | Closed | Fixed (M3) |
| 18 | GitHub OAuth can link wrong GitHub account | P3 | Closed | Fixed |
| 19 | Regenerate section is a UI stub | P3 | Closed | Fixed (M3) |
| 20 | Package export was a frontend alert stub | P3 | Closed | Fixed |
| 21 | graphBuilder did not resolve .js imports to .ts sources | P3 | Closed | Fixed |
| 22 | OnboardingPage swallows role-status fetch errors | P4 | Closed | Fixed (M5) |
| 23 | GraphPage tests relied on DEV mock fallback | P4 | Closed | Fixed |
| 24 | No per-route React error boundaries | P5 | Closed | Fixed (M5) — not Won't-Fix after all |
| 25 | graphBuilder edge tests could pass vacuously when edges empty | P5 | Closed | Fixed (M5) |
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
| 36 | Stale tutorials cannot be regenerated individually | P5 | Closed | Fixed (M5) |
| 37 | GitHub sign-up fails: "Error getting user profile from external provider" | P1 | Closed | Fixed (M5) — provider config replaced by the single GitHub App (2026-08-03); verified live 2026-08-07 |
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
| 65 | Three routes are not scoped to the project — cross-tenant reads and one write | P2 | Closed | Nam | 1 |
| 66 | The authentication surface has an unused bypass and no throttling | P2 | Closed | Nam | 1 |
| 67 | Repository import blocks large accounts and its cost safety gate is bypassable | P2 | Closed | Eugene / Nam | 2 + 7 — Fixed (M5): cost gate + pagination in batch 2, repo badges + step-2 refresh in batch 7 |
| 68 | Failed requests look like empty results — one pushes toward a paid action | P2 | Closed | Sahib | 3 |
| 69 | Analysis jobs can get stuck, or fail on an error that should have been retried | P2 | Closed | Nam | 2 — fixed |
| 70 | Dependency graph reports "imported by 0" for everything; search blanks the canvas | P2 | Closed | Bradley / Eugene | 3 — fixed |
| 71 | Accessibility gaps and measured contrast failures | P3 | Closed | Eugene | 4 — Fixed (M5): announce/label/keyboard sweep + dark-token lift, re-measured |
| 72 | Team lifecycle is a one-way door (no email, decline, leave, or ownership transfer) | P3 | Closed | Nam | 5 — Fixed (M5): decline, leave, transfer, invite hygiene; email half Won't-Fix (W1) |
| 73 | The frontend image only works when the browser is on the Docker host | P3 | Closed | Fixed (M5) — runtime config.js written at container start; same image proven against three different API origins, CSP connect-src now derived not hardcoded |
| 74 | [Tracker] Polish tail from the two end-of-M4 audits — 49 low-severity findings | P4 | Closed | Eugene | 7 — Fixed (M5): all 63 checklist lines ticked with per-line evidence; 8 Won't-Fix sub-items (W1–W8; W3 later shipped after all, leaving 7) |

#### Milestone 5 — filed and fixed in the sprint (#84–#85)

Found live during the M4 verification sweep, filed retrospectively when they were fixed. (#75–#83
are listed in the roll-up rather than a table; these two get one because they are new.)

| # | Issue | P | State | Owner |
|---|-------|---|-------|-------|
| 84 | Files ⇄ Classes toggle needs two clicks — a tooltip's invisible popper wrapper eats the first press | P3 | Closed | Sahib |
| 85 | Two "known gaps" numbers on one screen, neither saying what it counted | P4 | Closed | Sahib |

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
| *M5 progress against the above* | | Closed since: **#25, #36, #65, #66, #68, #69, #70**. **#67** part-done (cost gate + pagination fixed; repo badges and step-2 refresh remain). |
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

### M5 progress — frontend / UX error-state batch (2026-07-26)

The table above is the end-of-M4 snapshot and is left as one. This batch closed **six** of its Open
rows and filed **two** new bugs, both already closed. Recorded here rather than by rewriting the
snapshot, because other M5 batches are landing against the same table concurrently.

| # | Was | Now | One line |
|---|-----|-----|----------|
| 68 | P2 Open | **Closed** | Failure and absence separated everywhere they were conflated; the one that offered a **billed** Generate on a failed fetch is fixed at the source |
| 22 | P4 Open | **Closed** | Named code already gone; its surviving descendant (the live poll) now reports or stops instead of failing silently forever |
| 14 | P3 Open | **Closed** | Error banner cleared at the start of every new operation |
| 7 | P4 Open | **Closed** | `Content-Type` only when there is a body |
| 24 | P5 Open | **Closed** | Per-route boundaries — was on the Won't-Fix list; shipped instead |
| 6 | P3 Open | **Closed** | **Did not reproduce** — already fixed; verified with `exhaustive-deps` at error level (0 problems), not by reading the code |
| **84** | — | **Closed (new)** | Files ⇄ Classes two-click. The M4 fix was built on an *inferred* mechanism and did not work; the mechanism is now observed and the fix moved to the element that was actually eating the click |
| **85** | — | **Closed (new)** | The two unlabelled gap numbers. Fixed in M4, re-verified live here and confirmed to read clearly; one pluralisation defect found and fixed |

**Total tracked: 85.** Frontend suite: **192 → 213** passing (14 new specs from this batch; the rest
of the delta is other M5 batches landing in parallel), `tsc --noEmit` and `eslint src` clean, and
`vite build` succeeds — checked because one of these fixes is a CSS rule that only a real build
compiles.

### M5 progress — batch 8 tail: the last three M2/M3 carry-over bugs (2026-07-26)

Closes the M2/M3 carry-over row of the snapshot above. Same convention as the previous section: the
end-of-M4 table is left as a snapshot and progress is recorded here, because several M5 batches are
editing this file at once. **All three were re-verified against running code before anything was
changed** — two reproduced, one did not.

| # | Was | Now | One line |
|---|-----|-----|----------|
| 1 | P4 Open | **Closed** | **Reproduced.** `decrypt()` read an empty ciphertext part as a *missing* field. Traced all three `encrypt()` call sites: `""` cannot reach any of them, so **P4 was correct and is not understated** — but the guards that prevent it are incidental, and the round-trip invariant was simply false |
| 8 | P3 Open | **Closed** | **Reproduced** — and the filed symptom turned out unreachable (GitHub never issues installation id 0). The same `!Number(raw)` guard had a *reachable* defect: `Number()` accepts `0x2329` as 9001, which `POST /projects` would authorize as one installation and persist as another spelling, silently killing webhook re-analysis for that project |
| 10 | P3 Open | **Closed** | **Did not reproduce.** All 12 FKs to `projects` cascade; 34 of 37 public tables are deleted transitively, the 3 survivors are user-scoped. No orphaned data, so no deletion code — a test that fails when a future table is added without a cascade, proven to fail against a probe migration |

**Backend suite: 855 → 858** passing (+3: one per bug; #1 replaced a test that had encoded the bug as
intended behaviour). `npx tsc --noEmit` clean, `npm run truth` 25/25, eslint clean on every touched
file. **No schema change** — #10's audit was read-only against the live DB and its test asserts the
schema rather than altering it.

### M5 progress — batch 7 + absorbed bugs (2026-07-29)

Batch 7 was the #74 tracker, so it absorbed the three open bugs whose remainders sat inside the same
files: **#67**'s declared remainder, **#71** and **#72**. Six commits, oldest first:

| Commit | Subject |
|--------|---------|
| `daae508` | Unify product naming and harden the API surface |
| `26f1118` | Close the team-lifecycle one-way doors (#72) |
| `4a7cd53` | Fix the auth-page and import dead ends |
| `05a4f14` | Accessibility pass: announce, label, and keyboard-reach everything (#71) |
| `cfecb9d` | Stop the graph bouncing back into a focused cluster, and make the package gap count openable |
| `bd37d63` | Lift the dark theme off dark-on-dark, unify code refs and durations, shell the settings pages |

| # | Was | Now | One line |
|---|-----|-----|----------|
| 74 | P4 Open | **Closed** | All 63 checklist lines ticked with per-line evidence — 46 fixed here, 17 verified already-fixed; 8 Won't-Fix sub-items, each with a reason (W3 later shipped after all) |
| 67 | P2 Open | **Closed** | The declared remainder: already-imported repos badged and unselectable, the 409 links the existing project, step 2 survives a refresh via `?project=` |
| 71 | P3 Open | **Closed** | Announce/label/keyboard-reach sweep, reduced motion, hotkey preference; dark tokens lifted and **re-measured** (table in the entry — only input/card is a 1.4.11 pass, the rest are reported as perceptual lifts) |
| 72 | P3 Open | **Closed** | Decline, leave, ownership transfer, invitation hygiene + 14-day TTL. Email delivery Won't-Fix (W1) |

**Suites: backend 898 → 934, frontend 227 → 285, `npm run truth` 25/25.** Both typechecks and eslint
clean on every touched file; `npm run build -w frontend` succeeds — checked because two of these
fixes are CSS/token changes that only a real build compiles.

**Live verification, not assertions.** Three passes against the running stack:

- `backend/tmp/smoke.mts` — **122 checks ok, 2 failures**, both pre-existing: tutorials-coverage
  checks against projects that have never been analyzed. Neither touches code this batch changed.
- `backend/tmp/team-lifecycle.mts` (throwaway probe, written for this batch) — **19/19 green**: invite
  hygiene, decline, re-invite, accept, leave, transfer, and the old owner then failing to delete.
- A browser walkthrough of every changed surface in **both themes** — import, team, invitations, the
  two settings shells, the reader and the graphs.

**One bug found by that live pass, and fixed the same day.** A bodyless `POST` to invitation accept
500'd: `express.json` leaves `req.body` undefined, and the route destructured it
(`invitations.ts:129-130`). Pre-existing, not introduced here. Now `(req.body ?? {})`, pinned by
`invitations.test.ts:62` ("answers a bodyless accept with 404, not a destructure 500") — the +1 in the
backend count.

**Won't-Fix, with reasons** (all sub-items of otherwise-fixed work; nothing on the checklist is wholly
deferred):

| Ref | Item | Reason |
|-----|------|--------|
| W1 | Invitation email delivery | No mail provider provisioned and none planned for M5 (pre-declared). The UI no longer implies one is sent |
| W2 | Merging the two invitation route surfaces | Different principals and authorization — project-scoped management vs a cross-project invitee inbox. Merging mid-freeze breaks the API and its tests for no user-visible gain; documented at the mount point, UI naming unified |
| W3 | A first-class `'declined'` status | The status CHECK is frozen for M5; decline maps to terminal `'revoked'` with identical downstream behaviour. The one-line migration is recorded as a post-freeze follow-up. **Update 2026-08-06: that follow-up shipped** — migration 004 (`e95be2f`, approved under the database-change policy, since folded into `001_initial_schema.sql`) added the `'declined'` arm and declining now writes it, so W3 ended up fixed rather than Won't-Fix (seven Won't-Fix items stand) |
| W4 | Background expiry sweeper | Expiry is enforced at every read (accept plus both lists); a write sweeper adds a failure mode with no observable benefit |
| W5 | Eradicating all sub-12px text | Opacity was dropped on meaningful text only; decorative micro-labels keep the type scale by design |
| W6 | Reader receipts rail | Receipts render inline under each block and are real buttons since #68; the dead gutter is closed by docking the prose. Recorded as a post-M5 idea |
| W7 | Import right-rail | The wizard is a deliberate narrow single flow; preflight and security cards already stack in-flow |
| W8 | Graph edge hover-dimming | Click-to-select dimming already exists (`neighborIds`), and edge visibility was fixed at the token level |

**Open bugs remaining after this batch: #37 only** — GitHub sign-up's identity conflict, blocked on
the external auth provider's configuration. Our half (a plain-language explanation instead of a raw
provider error) shipped in M4.

### M5 progress — #37 closed: zero Open bugs (2026-08-07)

The last Open row is done. #37's provider-config half turned out to be fixed already — the
2026-08-03 single-GitHub-App switch (`d4eb5dd`) gave Supabase the App's own credentials with the
email read-only permission the entry prescribed — but the entry's closing criterion ("config
fixed **and sign-up verified**") had never been exercised. Verified today against the live
stack: six GitHub sign-ups on record since 2026-07-16, and a fresh **Sign in with GitHub**
round trip completed with no error params, advancing `last_sign_in_at` for a GitHub-only
account. The duplicate-email identity conflict stays a Won't-Fix sub-item with a reason (GoTrue
limitation, explained in-app). Details in the entry's fix notes; GitHub issue #56 closed the
same day.

**The M5 commitment ("26 Open → 0") is met: 0 Open, 85 tracked.**

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

- ~~**#24** — per-route error boundaries.~~ **Withdrawn — fixed instead (2026-07-26).** The stated
  reason ("the router-level boundary plus per-page error states cover the failure modes we actually
  see") did not survive contact with the M4 sweep: per-page error states cover *failed requests*,
  and the router-level boundary covers a render error by unmounting the entire application. Neither
  covers "one tab throws, the rest of the product keeps working", which is a ~100-line component.
- ~~**#25** — a test that could pass vacuously on an empty edge set.~~ **Not superseded — it was
  still true, and now Closed–Fixed (2026-07-26).** The claim that "the graph tests now assert
  non-empty sets and exact counts" was written ahead of the work and never verified: reproducing
  bug #21 (disabling the `.js` → `.ts` branch of `resolveSpecifier`) left three graphBuilder tests
  passing over an empty edge set. They now fail. See the entry for the measurement.
- ~~**#36** — regenerating a single stale tutorial.~~ **Closed–Fixed (2026-07-26)** rather than
  Won't-Fix. "Regenerate the set" is not free — it rebuilds every section too — and the tab was
  showing a stale badge with nothing to press. Mirroring `regenerate_section` cost one route, one
  generator entry point and one banner, with no schema change.
- ~~**#37** — GitHub sign-up identity conflict.~~ **Closed–Fixed (2026-08-07)** for the bug as
  filed: the profile-fetch failure was cured by the 2026-08-03 single-App switch — the App holds
  the email read-only permission the entry prescribed — and verified live against the running
  stack. Only the duplicate-email edge stays Won't-Fix: a GoTrue linking limitation
  (supabase/auth#1242), named plainly on the callback page. See the entry's fix notes.
- **Invitation emails** (part of **#72**) — needs an email provider we have not provisioned. The likely outcome is relabelling the action "Create invitation" with a share-the-link hint and closing the email half Won't-Fix. Decline and leave-project still ship.

**Standing rule for M5:** anything found in a walkthrough gets filed the same day, with a priority,
before any fix work starts. That is how #65–#74 came to exist rather than being discovered during
grading.

---

## [P4][Closed] Bug 1: encrypt('') does not round-trip through decrypt()

**Bug #1**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Date fixed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Closed — Fixed (M5 batch 8) |
| File / area | backend/src/lib/encryption.ts |

## Expected behavior

encrypt('') either rejects empty input or decrypt handles empty ciphertext.

## Actual behavior

encrypt produces iv:tag: with empty ciphertext; decrypt throws Invalid encrypted string format.

## Steps to reproduce

Call encrypt('') then decrypt(result) in a REPL or unit test.

## Notes

Low impact — tokens never empty in production.

## Reproduced (2026-07-26)

Yes, exactly as filed. `encrypt("")` returns
`d5c7cd5a9a54c410c37e2687:972eadac3b104b652a78cd50f86be8c3:` — a 24-char IV, a 32-char tag and a
zero-length ciphertext part — and `decrypt()` on that string throws
`Invalid encrypted string format`.

## Can an empty string reach `encrypt()` in production? No — checked, not assumed

The question decides the priority, so all three call sites were traced rather than reasoned about:

| Call site | What stops `""` |
|-----------|-----------------|
| `api/routes/llmKeys.ts:98` — `encrypt(api_key.trim())` | `:82` rejects `api_key.trim().length < 8` first, so a cleared or whitespace-only BYO key is a 400 and never reaches the cipher |
| `lib/github-connection.ts:198` — `encrypt(token.accessToken)` | `lib/github.ts:268` throws when the token response has no `access_token`, and `""` is falsy, so an empty token never becomes a `GitHubAppUserToken` |
| `lib/github-connection.ts:200,243` — refresh tokens | Both guarded `token.refreshToken ? encrypt(...) : null`; `""` stores as `NULL` |

**So P4 is right and is not understated.** What makes it worth fixing anyway is that all three
guards are incidental — a length check written for a different reason, and two ternaries — rather
than a stated rule that empty input is illegal. The invariant a crypto helper is supposed to offer,
*anything `encrypt` produces, `decrypt` accepts*, was simply false, and the failure mode if it ever
were reached is unrecoverable: `saveGithubConnection` deletes the old row before inserting the new
one, so an undecryptable value is not a degraded read, it is a lost credential.

## Fix

`decrypt()` (`backend/src/lib/encryption.ts:31`) now tests for a **missing** field instead of a
falsy one: `parts.length !== 3` plus emptiness checks on the IV and tag only. An empty ciphertext
part is what AES-GCM over an empty plaintext *is*, not a malformed input. Chose "decrypt handles it"
over "encrypt rejects it" — the two options the bug offers — because the same idiom is the root
cause of #8, filed separately on the same day, and because rejecting would leave any already-stored
empty value permanently unreadable.

Authentication is unaffected and was verified, not assumed: the GCM tag covers the empty plaintext,
so a forged tag on the `iv:tag:` form still fails with `Unsupported state or unable to authenticate
data`. The length check also *tightens* one case — `"a:b:c:d"` used to be parsed (extra parts were
ignored) and is now rejected.

## Verification

`backend/test/lib/encryption.test.ts` — the test that previously asserted the bug as intended
behaviour (`"rejects empty string"`, with a comment explaining why it was acceptable) now asserts
`decrypt(encrypt("")) === ""`. Nothing else in the suite exercises a zero-length plaintext, which is
why a regression here would be silent. Full backend suite green; `npx tsc --noEmit` clean.

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

## [P1][Closed] Bug 3: GitHub routes fail when github-app.pem is missing

**Bug #3**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Date fixed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Closed — Fixed (M5 batch 8) |
| File / area | backend/src/lib/github.ts (createAppJwt) |

## Expected behavior

Missing PEM should return a clear 500 JSON error without crashing the process.

## Actual behavior

fs.readFileSync(privateKeyPath) throws ENOENT when GITHUB_APP_PRIVATE_KEY_PATH is wrong or the file is absent. Request fails with a generic 500.

## Steps to reproduce

Remove or misconfigure backend/github-app.pem → GET /api/github/installations with valid auth.

## Reproduced (2026-07-26)

Yes. `backend/src/lib/github.ts:67` was `fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH!, "utf8")`
— a non-null assertion with no guard. Three different unhelpful outcomes: `ENOENT` when the file is
absent, `TypeError [ERR_INVALID_ARG_TYPE]` when the variable is unset (`readFileSync(undefined)`), and
`EISDIR` under Docker, because a bind mount whose host file is missing leaves a *directory* at
`/app/backend/github-app.pem`. All three reached the route as a bare 500 with the cause only in the
container log.

## Fix

`loadAppPrivateKey()` (`backend/src/lib/github.ts:75`) now throws a typed `GitHubAppConfigError`
naming the variable, the path as written, the absolute path it resolved to, **and the working
directory it resolved against** — the relative default `./github-app.pem` means "wrong cwd" and "no
such file" are indistinguishable otherwise. ENOENT / EISDIR / EACCES each get their own sentence, and
a file that is not a PEM is rejected before OpenSSL turns it into
`error:1E08010C:DECODER routines::unsupported`. `createAppJwt()` checks `GITHUB_APP_ID` the same way
instead of asserting it.

`handleGitHubRouteError` (`backend/src/api/routes/github.ts:33`) maps that error to **503 +
`code: "github_app_not_configured"`** with the message — a broken deployment, not a bad request.
`GET /github/app` and `POST /github/installations/link` were routed through the same handler; they
had their own `500` / `400`. `checkGitHubAppConfig()` runs at API boot
(`backend/src/api/server.ts:16`) and logs one warning line, so the misconfiguration is visible before
the first request. The process still starts: everything that is not the GitHub integration works, and
crashing the API over one feature is worse.

**Interaction with the M5 `WORKDIR` change — checked, not made worse.** `Dockerfile.worker` moved its
`WORKDIR` to `/app/backend` because `npm run -w backend` used to set that cwd and the direct `node`
invocation does not. `docker-compose.yml` mounts the key at `/app/backend/github-app.pem`, and the API
image still runs via `npm run start:api -w backend` (cwd `/app/backend`), so `./github-app.pem`
resolves to the mount in both images. The change is what *keeps* #3 from getting worse, and the new
error message prints the cwd precisely so this class of mistake reads itself out.

## Verification

`backend/test/api/configFailures.test.ts` — four cases: missing file (message contains the variable
name, the filename, the temp cwd it looked in, and "no such file"), a directory at the path, a
non-PEM file, and neither source configured. Full backend suite green; `npx tsc --noEmit` clean.

---

## [P3][Closed] Bug 4: Signup does not validate email format server-side

**Bug #4**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Date closed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed — absorbed by #66 (M5): the endpoint was deleted |
| File / area | backend/src/api/routes/auth.ts |

## Expected behavior

Malformed emails rejected with 400 before Supabase call.

## Actual behavior

Any non-empty string forwarded to Supabase; error messages inconsistent.

## Steps to reproduce

POST /api/auth/signup with "email":"notanemail".

## Notes

Add regex or validator matching frontend expectations.

## Closure (2026-07-26)

No longer reachable: `POST /api/auth/signup` was **deleted** while fixing #66 — it created
email-confirmed accounts for addresses the caller did not control. Sign-up happens in the browser
against Supabase, which validates the address and sends the confirmation. There is no server-side
signup surface left to validate. `backend/test/api/auth.test.ts` asserts the route answers 404.

---

## [P3][Closed] Bug 5: Signup password minimum mismatches frontend (6 vs 8)

**Bug #5**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Date closed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed — absorbed by #66 (M5): the endpoint was deleted |
| File / area | backend/src/api/routes/auth.ts |

## Expected behavior

API rejects passwords shorter than 8 characters.

## Actual behavior

Supabase minimum is 6; API accepts shorter passwords than the signup form.

## Steps to reproduce

POST /api/auth/signup with password "abc123" (6 chars) via curl.

## Notes

Align server validation with frontend minLength={8}.

## Closure (2026-07-26)

Same as #4: the endpoint that held the second, weaker password rule was deleted while fixing #66, so
the two rules can no longer disagree. The browser's sign-up form and Supabase's own minimum are now
the only policy.

---

## [P3][Closed] Bug 6: ProjectContext fetchProject missing useCallback deps

**Bug #6**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | frontend/src/contexts/ProjectContext.tsx |

## Expected behavior

Effect dependencies should be exhaustive; refetch uses current projectId.

## Actual behavior

fetchProject recreated each render; useEffect depends only on [projectId]. Works in practice but triggers exhaustive-deps warnings.

## Steps to reproduce

Enable eslint-plugin-react-hooks exhaustive-deps on ProjectContext.tsx.

## Notes

**Closed 2026-07-26 — did not reproduce; already fixed, verified rather than assumed.**

`ProjectContext.tsx:58-80` already carries the prescribed fix: `fetchProject` is wrapped in
`useCallback(..., [projectId])` and the effect depends on `[fetchProject]`, so the callback identity
changes exactly when `projectId` does. It landed with the branch-aware-projects work (`7ca3777`),
after this bug was filed and before anyone updated the row.

Verified with the tool the repro step names rather than by reading the code. `eslint-plugin-react-hooks`
is not a dependency of this repo (see `eslint.config.mjs` — the config has only `@typescript-eslint`),
which is why the warning was never seen either way, so the check was run out-of-tree: plugin 5.2.0
against this file with `react-hooks/exhaustive-deps` and `rules-of-hooks` at **error**. Result: **0
problems**. The temporary config was deleted afterwards; nothing in the repo changed for this bug.

(The same run over the files touched in this batch reports two *pre-existing* exhaustive-deps errors
elsewhere — `DashboardPage.tsx` tour effect, `WalkthroughTab.tsx` `load` callback. Both predate this
work and are left alone; they belong to the #74 polish tail, not here.)

---

## [P4][Closed] Bug 7: apiFetch sends Content-Type on GET requests

**Bug #7**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Closed |
| File / area | frontend/src/lib/api.ts |

## Expected behavior

Content-Type: application/json only when body present.

## Actual behavior

Header set on all requests including GET.

## Steps to reproduce

Inspect network tab on any GET from the app.

## Notes

**Reproduced 2026-07-26.** `api.ts:31-34` built the header map with `"Content-Type": "application/json"`
unconditionally, before any check for a body — so every GET in the app announced a JSON payload it
did not have.

**Fixed.** The header is now spread in only when `options.body != null`, and an explicit caller
header still overrides it (the export path sets its own). Worth more than "technically incorrect":
`Content-Type: application/json` is the header that makes a cross-origin GET a *non-simple* request,
so it forced a CORS preflight on every read — which matters now that the API origin is
runtime-configurable and may not be same-origin.

**Test:** `frontend/src/lib/api.test.ts` — asserts the header is absent on a bodyless GET, present on
a POST with a body, and that a caller-supplied `Content-Type` wins. Nothing else in the app would
notice a regression here, which is exactly why it is pinned.

---

## [P3][Closed] Bug 8: GitHub repos rejects installation_id=0

**Bug #8**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Date fixed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed — Fixed (M5 batch 8) |
| File / area | backend/src/api/routes/github.ts, backend/src/api/routes/projects.ts |

## Expected behavior

installation_id=0 should be validated with Number.isFinite / parseInt, not truthiness.

## Actual behavior

Number("abc") → NaN correctly 400, but installation_id=0 treated as missing (0 is falsy).

## Steps to reproduce

GET /api/github/repos?installation_id=0 with valid auth.

## Notes

Use explicit NaN / integer parsing.

## Reproduced (2026-07-26)

Yes. `GET /api/github/repos?installation_id=0` returned
`400 {"error":"installation_id query parameter is required"}`. The guard was
`const installationId = Number(raw); if (!installationId || Number.isNaN(installationId))`, in
**five** places: `routes/github.ts:188` (`POST /installations/link`), `:254` (`/repos`), `:285`
(`/branches`), `:306` (`/commits`), and `routes/projects.ts:224` (`POST /projects`).

## Can GitHub actually issue installation id 0? No — so the filed symptom is unreachable

App installation ids come from a monotonic sequence starting at 1; live ones in this project are
8-digit. Zero is never issued, so on the filed symptom alone P3 is generous and the row could have
been closed Won't-Fix.

**It was not, because the same expression has a reachable defect.** `Number()` is not an id parser,
and the guard's second half never noticed. Measured against the running API (mocked GitHub, auth
installed):

| `installation_id` | `Number()` | Before | After |
|---|---|---|---|
| `0` | `0` | 400 "required" | **403** — parses fine, just is not one of yours |
| `""` (present, blank) | `0` | 400 "required" | 400 "required" |
| `abc` | `NaN` | 400 "required" | 400 "must be a positive integer" |
| `0x2329` | **`9001`** | **accepted as installation 9001** | 400 |
| `1e4` | `10000` | accepted as 10000 | 400 |
| `" 9001 "` | `9001` | accepted as 9001 | 400 |
| `9001.5` | `9001.5` | reached the ownership check → 403 | 400 |
| `-9001` | `-9001` | reached the ownership check → 403 | 400 |
| repeated param (array) | `NaN` | 400 "required" | 400 "must be a positive integer" |

The `0x2329` row is the one that matters, and it is load-bearing in `POST /projects`: that handler
authorizes with the **parsed number** but line 275 persists the **raw string** into
`projects.github_installation_id`, a `text` column. So a project could be created against
installation 9001 while storing the literal `"0x2329"` — and `githubWebhook.ts:224` matches
`p.github_installation_id = $3` against the numeric string GitHub sends (`"9001"`), so that project
would silently stop receiving push-triggered re-analysis. Nothing logs, nothing 500s; the feature
just never fires. Constraining the format is what makes the stored and the authorized value the
same token again, so the INSERT needed no change.

## Fix

`parseInstallationId()` (`backend/src/api/lib/installationId.ts`) returns
`{ok: true, value}` or `{ok: false, reason: "absent" | "malformed"}` — the distinction the old guard
collapsed. It requires plain decimal digits (`/^\d+$/`, or a safe non-negative integer when a JSON
body sends a number), so every form in the table above that is not an id is rejected as one.
`resolveInstallationId()` (`routes/github.ts:38`) wraps it for the four route handlers and answers
400 with the message that matches the reason; it returns `null` rather than a number precisely so
`0` cannot be re-swallowed by another falsy test at the call site. `routes/projects.ts:229` uses the
parser directly.

**`0` now parses and is answered by the authorization layer (403), not the validation layer (400)** —
which is the actual point of the bug. Absence, malformed shape and "not yours" are three different
answers and now get three different responses. `POST /installations/link` also stops reporting a
missing `state` as a missing `installation_id`.

## Verification

`backend/test/api/github.test.ts` — one test drives `0`, `0x2329`, `9001.5`, `-9001` and `""`
through `GET /repos` and asserts the exact status map `{0: 403, "0x2329": 400, "9001.5": 400,
"-9001": 400, "": 400}`. Both halves are silent regressions: `0 → 400` is a status nobody reads, and
`0x2329 → 200` looks like success. Full backend suite green; `npx tsc --noEmit` and eslint clean.

---

## [P2][Closed] Bug 9: Project settings uses fragile dynamic SQL pattern

**Bug #9**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Date fixed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P2 |
| State | Closed — Fixed (M5 batch 8) |
| File / area | backend/src/api/routes/projects.ts |

## Expected behavior

Only whitelisted setting fields should be writable.

## Actual behavior

PUT builds SET clauses from request body fields. Current code reads named fields only (safe today) but the pattern is easy to break when adding fields.

## Steps to reproduce

N/A — code review concern; no exploit today.

## Notes

Refactor to an explicit allowlist map before M3.

## Reproduced (2026-07-26)

The *pattern* reproduced; the vulnerability did not, exactly as filed. `PUT /:id/settings` had grown
to eleven fields × three hand-written places each — destructure, validate, append a `SET` clause —
133 lines in which nothing but discipline connected "this field is validated" to "this field is
written". Two fields had already drifted: `file_limit` and `loc_limit` were destructured and written
with **no validation at all**, so a non-numeric value reached the `not null check (> 0)` constraint
and came back as a 500 rather than a 400. No injection was possible today because every column name
was a literal, which is precisely the property the next added field could quietly break.

## Fix

`WRITABLE_SETTINGS` (`backend/src/api/routes/projects.ts:24`) is now the single definition: one entry
per field, holding its validator and — for the jsonb columns — its serializer. The handler iterates
**that map** and reads the matching key out of the body, so the request body can no longer contribute
anything to the statement's text; an unlisted key is not merely ignored, it is unreachable. Column
names are keys of a literal object, i.e. compile-time constants. Adding a setting is one entry, and
there is nowhere left to forget the validation half. The two unvalidated numeric fields gained the
check that matches the DB constraint (positive integer), converting that 500 into a 400. Handler body:
133 lines → 20.

## Verification

`backend/test/api/projects.test.ts` — a PUT carrying `permission_tier`, a SQL-shaped key
(`"privacy_mode = 'full_ai', ignored_paths"`) and a camelCase near-miss alongside one legitimate field
asserts the generated statement contains `privacy_mode = $2` and nothing else, with parameters
`[projectId, "facts_only_ai"]`; a body of unknown keys only returns 400 and executes no UPDATE.

---

## [P3][Closed] Bug 10: Project delete relies on CASCADE without verification

**Bug #10**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Date closed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed — did not reproduce; verified against the live DB and pinned (M5 batch 8) |
| File / area | backend/src/api/routes/projects.ts + migrations |

## Expected behavior

Deleting a project removes all related jobs, snapshots, packages.

## Actual behavior

DELETE relies on DB CASCADE; orphaned rows possible if any FK lacks ON DELETE CASCADE.

## Steps to reproduce

Audit 001_initial_schema.sql FKs referencing projects.id.

## Notes

Add explicit cleanup or migration audit before production.

## Did not reproduce (2026-07-26) — no orphaned data exists

The bug says orphans are *possible*; it never established whether any exist. They do not. Audited
against the **live** database rather than the migration file, with throwaway scripts run
`node --env-file=.env --import tsx` under `SET default_transaction_read_only = on` (deleted
afterwards; nothing was written and no DDL was issued, per the M5 no-schema-change policy in
[DEVOPS.md](./DEVOPS.md)).

**Every foreign key pointing at `projects` cascades — 12 of 12, zero exceptions**
(`pg_constraint.confdeltype = 'c'`): `analysis_jobs`, `analysis_scopes`, `analysis_snapshots`,
`onboarding_packages`, `project_invitations`, `project_llm_keys`, `project_members`,
`project_settings`, `ranking_weight_configs`, `semantic_records`, `source_receipts`,
`user_progress`.

Direct FKs are only half the question, so reachability was computed transitively over all 84 public
foreign keys, counting a hop only when it is **both** `on delete cascade` **and** `not null` — a
nullable cascading FK still strands its `NULL` rows. **34 of the 37 public tables are deleted**,
including everything four hops down (`tutorial_steps` via `tutorials` via `analysis_snapshots`;
`embeddings` via `semantic_records`; `capability_members`, `architecture_cluster_members`,
`side_effects`, `entrypoints`).

The three survivors are correct: **`users`, `github_connections`, `github_installations`** are scoped
to a user, not a project, and must outlive any project that referenced them.

The trap case was checked explicitly. Nine nullable cascading FKs exist
(`source_receipts.record_id`, `stale_flags.package_id`, `tutorials.package_id`,
`ai_generation_runs.package_id`, `criticality_scores.target_node_id`, and four more) — every one of
those tables is *also* reached by a separate `not null` cascade path, so no row is stranded by the
nullable edge. Likewise the four `on delete set null` FKs (`analysis_jobs.snapshot_id`,
`analysis_jobs.scope_id`, `source_receipts.snapshot_id`, `project_members.default_package_id`) all
sit on tables that are themselves deleted via `project_id`, so the `SET NULL` never outlives the row.

## Fix — a test, not deletion code

`DELETE FROM projects WHERE id = $1` (`backend/src/api/routes/projects.ts:493`) is correct as
written and was left alone. Writing the explicit cleanup the bug suggests would restate the FK graph
in application code, in the wrong order, where it would drift from the schema and be wrong silently —
strictly worse than the constraint that is already enforced by the database on every path, including
`psql`.

The real defect is that **the guarantee is unenforced**: any table added later with a nullable FK, or
one that omits `on delete cascade`, starts leaking rows on every project delete with no error and no
failing request. `backend/test/lib/schemaCascade.test.ts` parses `supabase/migrations/*.sql`, runs the
same reachability computation, and asserts that the only tables surviving a project delete are the
three user-scoped ones. Static on purpose — it reads what a developer adding a table actually edits,
so it runs in CI without database credentials; the parse was validated by reproducing the live
`pg_constraint` result exactly (34 reachable / 3 not, 84 FKs).

## Verification

Proven to fail, not assumed to: a temporary migration adding two tables — one with
`references public.projects(id)` and no cascade, one with a *nullable* cascading `snapshot_id` — was
applied to the migration folder, and the test failed naming both (`future_project_notes`,
`future_nullable_child`) before the probe was removed. It also parses the
`alter table … add column … references …` form, which the schema already uses once
(`project_members.default_package_id`) and which is the likeliest shape for any FK a later migration
adds — a parser that only read `create table` would go blind exactly when this check starts to
matter. **No schema change was made.**

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

## [P3][Closed] Bug 14: InvitationsPage error persists across operations

**Bug #14**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed |
| File / area | frontend/src/pages/InvitationsPage.tsx |

## Expected behavior

Error banner clears when starting a new accept/decline.

## Actual behavior

Failed accept leaves error visible when selecting another invitation.

## Steps to reproduce

Cause network error on accept → Click a different invitation.

## Notes

**Reproduced 2026-07-26.** `handleAccept` set `error` on failure and nothing ever cleared it:
`selectInvitation` (`InvitationsPage.tsx:47`) only changed the selected id, and the next
`handleAccept` (`:52`) went straight to `setAccepting(true)`. So a failed accept left, say, "You are
already a member of this project" pinned above the page while the user moved to a different
invitation — the banner then described a row that was no longer on screen, and a *successful* accept
of the second invitation still left the first one's failure as the last thing they saw.

**Fixed** as the bug prescribed, in both places that start a new operation: `setError("")` at the top
of `handleAccept`, and in `selectInvitation`. (There is no `handleDecline` — Decline is a disabled
control with a tooltip explaining that declining is not supported yet; that is #72's scope.)

**Test:** `frontend/src/pages/InvitationsPage.test.tsx` — a failed accept, then (a) selecting the
other invitation and (b) starting a second accept; the banner must be gone in both. A stale banner
looks exactly like a fresh one, so this regression is silent by construction.

---

## [P3][Closed] Bug 15: CORS falls back to localhost when CORS_ORIGIN unset

**Bug #15**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Date fixed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P3 |
| State | Closed — Fixed (M5 batch 8) |
| File / area | backend/src/api/app.ts |

## Expected behavior

Production requires explicit CORS_ORIGIN.

## Actual behavior

Defaults to http://localhost:5173 if env missing — blocks real deployment origin.

## Steps to reproduce

Deploy without CORS_ORIGIN; browser requests from production domain blocked.

## Notes

Log warning in production when fallback used.

## Reproduced (2026-07-26)

Yes — `backend/src/api/app.ts:15` was literally
`origin: process.env.CORS_ORIGIN ?? "http://localhost:5173"`. Wrong in both directions at once: the
deployed frontend is refused, *and* a page served from `http://localhost:5173` on any developer's
machine is granted cross-origin access to production. The only symptom is a CORS error in an end
user's browser console — nothing in the server log says the deployment is misconfigured.

## Fix (upgraded from the original "log a warning")

The filed remedy was a warning. That is no longer enough: the M5 deployment work makes the frontend
origin runtime-configurable (#73), so a silent localhost default is now a live hole rather than a
local-dev convenience. `resolveCorsOrigins()` (`backend/src/api/app.ts:8`) **throws in production**
when `CORS_ORIGIN` is unset or blank, with a message naming the variable and showing the expected
value, so the API refuses to start instead of starting wrong. Outside production it still defaults to
`http://localhost:5173` and says so on stdout. Comma-separated origins are accepted (platform domain
plus custom domain) and trailing slashes are trimmed, which is the other half of what a real
deployment needs. `backend/.env.example` documents the production requirement next to the variable.

## Verification

`backend/test/api/configFailures.test.ts` — production + unset and production + whitespace both
throw `/CORS_ORIGIN is required in production/`; a single origin and a comma-separated pair parse to
the expected arrays with slashes trimmed; development still yields `["http://localhost:5173"]`.

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

## [P4][Closed] Bug 22: OnboardingPage swallows role-status fetch errors

**Bug #22**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Closed |
| File / area | frontend/src/pages/OnboardingPage.tsx |

## Expected behavior

Failed role status poll shows error or stops polling.

## Actual behavior

.catch(() => {}) hides failures silently.

## Steps to reproduce

Break API during onboarding page load — no user-visible error.

## Notes

**Partly did not reproduce; the surviving half did, and is fixed. 2026-07-26.**

*The literal code named in the bug is gone.* The `roleStatuses` state and its
`apiFetch(...).catch(() => {})` were removed in the API/frontend rewiring (`c3d74fc`); per-role
package status now comes from `PackagesContext`, which has tracked `packagesError` since the M4
audit passes and renders a "Couldn't load your packages / Retry" pane on the cards view. So the
*role-status* poll no longer swallows anything.

*Its descendant did.* Two polls in this page still hid failures, and both are fixed:

1. **The live "sections are landing" poll** (`OnboardingPage.tsx`, the 5s interval used while a
   package is generating) had a bare `.catch(() => {})` — a poll that could no longer reach the
   server ran forever and reported nothing. It now honours this bug's stated contract, *show an
   error or stop polling*, and does both — but only once the failure is real. One dropped tick is
   normal mid-run, so a single failure is ignored and the sections already on screen are left
   untouched; **three consecutive** failures clear the interval and replace the "Generating —
   sections appear here as each one finishes" banner with "Live updates stopped … Generation is
   still running; this page just stopped following it" plus a **Resume updates** button. The
   distinction matters: the generation is unaffected, only this page's view of it stopped.
2. **The package fetch itself** swallowed every error in `onboardingData.ts` — that is #68, fixed in
   the same batch, and it is what made a failed load on this page indistinguishable from an empty one.

The one remaining `.catch(() => {})` in the page is deliberate and commented: a failed tick of the
generating poll must not change what is rendered, because a poll that can wipe content is how you
manufacture the false empty state #68 is about.

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

## [P5][Closed] Bug 24: No per-route React error boundaries

**Bug #24**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P5 |
| State | Closed |
| File / area | frontend/src/App.tsx, frontend/src/components/ProjectLayout.tsx |

## Expected behavior

Feature routes isolate render errors.

## Actual behavior

Only top-level ErrorBoundary; one broken page can blank entire app.

## Steps to reproduce

N/A — enhancement. (Reproduced structurally: before this change the only boundary was the one
wrapping `<Routes>` in `App.tsx`, so any uncaught render error replaced the entire application.)

## Notes

**Fixed 2026-07-26** — this was on the M5 plan's "Expected Won't-Fix" list; it is cheap enough and
the M4 sweep gave it a concrete case, so it shipped instead.

**What it adds beyond the 404 route** (asked directly, since M4 added `path="*"`):

The two catch **disjoint** failures and neither substitutes for the other.

- `path="*"` handles a URL that **no route matches**. That is a routing decision made before any
  page renders, and it is the fix for VISUAL QA M4 #12 — `/projects` (the real path is `/list`)
  painting a completely blank page whose only trace was a `No routes matched location` console
  warning. Verified present in `App.tsx` and correct: it is last, and deliberately outside
  `ProtectedRoute` so a mistyped URL does not bounce a signed-in user to the login screen.
- A boundary handles a route that **matched and then threw while rendering** — a malformed analysis
  payload, an undefined field inside a `.map`, a bad selector. React's response to an uncaught render
  error is to unmount the tree, so before this the only net was the app-level boundary: one bad graph
  payload replaced the whole application, sidebar and all, with a full-screen "Something went wrong"
  whose only action was a reload of the URL that had just failed.

Scoping it to the routed `<Outlet />` is the actual value: the shell survives. `RouteErrorBoundary`
(`frontend/src/components/RouteErrorBoundary.tsx`) now wraps the outlet in **both** layouts — the
dashboard shell (`App.tsx`) and the project layout (`ProjectLayout.tsx`). A broken tab leaves the
project sidebar, tab strip and package selector working, so the user switches tab instead of losing
the product, and gets two recoveries the app-level boundary cannot offer: retry just this page, and
leave for one that works. It also states that nothing was lost and no analysis was started or
charged — the reassurance a full-screen crash cannot give.

One non-obvious detail: React never resets a boundary on its own, so a page that threw once would
keep showing its error for every later route under the same boundary. The boundary takes the
pathname as a `resetKey` and clears on navigation.

**Test:** `frontend/src/components/RouteErrorBoundary.test.tsx` — a throwing route renders the error
*with the surrounding shell still mounted*; navigating away through that surviving shell clears it;
and the retry button re-renders the same page.

---

## [P5][Closed] Bug 25: graphBuilder edge tests could pass vacuously when edges empty

**Bug #25**

| Field | Value |
|-------|-------|
| Date created | 2026-06-19 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P5 |
| State | Closed — fixed 2026-07-26 (M5) |
| File / area | backend/src/worker/engine/__tests__/graphBuilder.test.ts |

## Expected behavior

Edge assertions fail when graph has no edges (regression signal).

## Actual behavior

Before Bug 21 fix, some tests passed with 0 edges.

## Steps to reproduce

Review tests that use graph.edges.length >= 0 style assertions.

## Verification (2026-07-26)

Reproduced, and measured rather than argued. `resolveSpecifier`'s NodeNext
`.js` → `.ts` branch (`graphBuilder.ts:28`) was disabled to reproduce bug #21
exactly — every import edge disappears at once, which is how this component
fails in production — and the suite was re-run against the pre-fix test file.
**Three tests passed over the empty edge set:**

| Test | Why it passed on zero edges |
|------|------------------------------|
| `graphBuilder — edges › no duplicate edges` | `new Set([]).size === [].length` |
| `graphBuilder — edges › each edge has weight >= 1` | the `for…of` body never ran |
| `buildClassGraph — fixture repo › creates nodes for classes and interfaces only` | `[].every(…)` is `true` |

Three stale `// SKIP (graphBuilder '.js' → '.ts' resolution)` comments were also
still in the file, describing tests that were never actually skipped (`it`, not
`it.skip`) and a defect closed in M3.

## Fix (2026-07-26)

**Rule applied:** anything that iterates or aggregates a collection first
asserts the collection is the size it should be — exact counts, never `>= 0`.

- New headline test `resolves every fixture import into an edge — the exact
  set, no more` pins all **eight** of the fixture's intra-repo imports by
  `(source, target)`. It catches both directions: an empty set, and a resolver
  that starts inventing edges.
- `no duplicate edges` and `each edge has weight >= 1` assert the length before
  iterating; `creates nodes for classes and interfaces only` and `every node has
  kind = module` assert non-empty before their `every`/loop.
- The three stale SKIP comments are replaced with what they were actually
  hiding.

**Evidence the tests now fail when they should.** With the same `.js` → `.ts`
regression applied, `graphBuilder.test.ts` goes from **3 silent passes** to
**0**: the file reports 12 failures, including all three above, and the
headline test's failure message is `no import edges at all — .js → .ts
resolution is broken again`. Restored source: full suite 855 passing.

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

## [P5][Closed] Bug 36: Stale tutorials cannot be regenerated individually

**Bug #36**

| Field | Value |
|-------|-------|
| Date created | 2026-07-10 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P5 |
| State | Closed — fixed 2026-07-26 (M5) |
| File / area | backend/src/api/routes/tutorials.ts, worker/generation/tutorialGenerator.ts, worker/summaryWorker.ts, worker/incrementalAnalyzer.ts, frontend/src/pages/WalkthroughTab.tsx |

## Expected behavior

A stale tutorial offers a Regenerate action like stale sections do.

## Actual behavior

Incremental analysis marks tutorials stale, but regeneration currently only exists per-section; a stale tutorial refreshes only with a full package regeneration.

## Steps to reproduce

Change a file on a tutorial's path → incremental re-analysis → tutorial shows stale with no regenerate button.

## Verification (2026-07-26)

Still reproduced. `incrementalAnalyzer.markStale` flags tutorials
(`incrementalAnalyzer.ts:381`, `UPDATE tutorials SET status = 'stale'`) and
`WalkthroughTab.tsx:673` renders a `stale` badge — but the only regeneration
endpoint was `POST /onboarding/sections/:sectionId/regenerate`. Nothing on the
tab could act on the badge.

A second, quieter half surfaced while verifying: `settlePackageStaleness`
(`incrementalAnalyzer.ts:406`) asked **only** about stale sections, while the
code that SET the package flag counted sections *and* tutorials. A package whose
only stale content was a tutorial could therefore be declared fresh by an
unrelated section regeneration.

## Fix (2026-07-26)

The `regenerate_section` flow, mirrored — including both of its rules: a stale
artifact rebuilds against the newest complete snapshot of its scope, and there
is no privacy-mode gate (under `ai_disabled` the walkthrough skeleton still
comes from the trace, so it rebuilds deterministically with zero LLM calls).

- **`POST /projects/:id/tutorials/:tutorialId/regenerate`** (owner/admin) —
  resolves the target snapshot, refuses a second concurrent rebuild of the same
  key with a 409, inserts the job row, and enqueues it. A submission failure
  fails the row rather than leaving it queued (the #69(1) rule).
- **`regenerateOneTutorial(params, stableKey)`** — re-runs selection against the
  new snapshot and rebuilds just that key. The tutorial **cap is deliberately
  not applied**: the reader already has this tutorial, so "it lost a slot to a
  higher-ranked flow" is not a reason to refuse. Two honest misses are reported
  as a failed job with a reason instead of a silent no-op — `workflow_gone` (the
  flow is not in this snapshot) and `no_longer_eligible` (still there, no longer
  yields a procedure).
- **`settlePackageStaleness`** now counts stale tutorials as well as stale
  sections, so the settle predicate agrees with the one that sets the flag.
- **UI** — a stale walkthrough gets the same banner + Regenerate button a stale
  section has, with the same E10 split: the banner is ungated (the tier that
  reads it needs to know), the action is owner/admin. The completion poll is
  held in a ref and cleared on unmount (bug #68(4)'s lesson applied up front).

**No schema change** (doc/DEVOPS.md M5 freeze). `analysis_jobs.job_type` is a
CHECK-constrained enum, so this rides the existing `regenerate_section` type and
is told apart by `checkpoint->>'tutorialKey'` — the same jsonb the section flow
already uses for `sectionType`. The run-history label reads that key and prints
`Regenerated tutorial "<title>"`.

**Tests:** `backend/src/worker/generation/__tests__/tutorialRegeneration.test.ts`
— the two miss kinds are distinguished, selection is re-run against the new
snapshot, and both directions of the settle predicate.

---

## [P1][Closed] Bug 37: GitHub sign-up fails with "Error getting user profile from external provider"

**Bug #37**

| Field | Value |
|-------|-------|
| Date created | 2026-07-10 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P1 |
| State | Closed |
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

## Fix notes (2026-08-07)

Closed. The provider-config half was fixed on 2026-08-03 by the single-GitHub-App switch
(`d4eb5dd`): Supabase's GitHub provider now holds the GitHub App's own client ID/secret, and the
App carries **Account permissions → Email addresses: Read-only** — the second remedy prescribed
above (DEVOPS.md § "GitHub login (the GitHub App's own OAuth — no separate OAuth App)" documents
the setup and cites this bug). What remained was this entry's own closing criterion — "close once
the Supabase GitHub provider config is fixed and sign-up verified" — so it was verified against
the live stack rather than asserted:

- **Sign-ups succeeded.** `auth.identities` holds six GitHub sign-ups between 2026-07-16 and
  2026-07-27 — every teammate plus the dogfood account — so the filed failure was gone once the
  provider had working credentials.
- **The current config verified live (2026-08-07).** Signed the dogfood account out and back in
  via **Sign in with GitHub** on the running stack: GitHub account chooser → Supabase
  (`/auth/v1/callback`) → `/auth/callback` with **no error params** → signed in on Settings, and
  `auth.users.last_sign_in_at` for `ldnkoff@gmail.com` (a GitHub-only identity, so no other
  sign-in path could have moved it) advanced to `2026-08-08T02:19Z`. The profile/email fetch this
  bug is about runs on every OAuth exchange, sign-up and sign-in alike, so the live round trip
  exercises exactly the step that used to fail.

**Won't-Fix sub-item, with reason:** the duplicate-email identity conflict — signing up with
GitHub when the same address already exists under another sign-in method — is a GoTrue
limitation (supabase/auth#1242), not our code: automatic linking refuses to guess between two
existing accounts. The callback page names it plainly and points at the action the user can
actually take (sign in the original way, then link GitHub from Account Settings):
`AuthCallbackPage.tsx`, the `isDuplicateEmailError` branch.

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

## [P2][Closed] Bug 65: Three routes are not scoped to the project, allowing cross-tenant reads and one write

**Bug #65**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Date fixed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15), security & UX audit |
| Priority | P2 |
| State | Closed — Fixed (M5 batch 1) |
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

## Reproduced (2026-07-26) — two of the three

Each route was driven from the outside with the caller owning project A and a child id belonging to
project B (`backend/test/api/tenantIsolation.test.ts`, against a fake database that answers any
*unscoped* lookup with project B's row):

| Route | Before the fix | Verdict |
|-------|----------------|---------|
| `GET …/onboarding/sections/:sectionId/receipts` | **200** with project B's `snippet`, file path and symbol summary in the body | Reproduced |
| `PATCH …/onboarding/sections/:sectionId/review` | **200**; the `UPDATE package_sections … WHERE id = $3` ran against project B's row and the follow-up flipped project B's package status | Reproduced |
| `GET …/workflows/:workflowId/walkthrough` | **404** | **Already fixed** |

The walkthrough route was scoped during M4 in commit `00639bf` ("Recalibrated onboarding"), which
added `JOIN analysis_snapshots s ON s.id = w.snapshot_id … AND s.project_id = $2`
(`backend/src/api/routes/workflows.ts:145`) without updating this row. The audit finding was correct
when written; one third of it had been quietly closed. A sweep of the remaining child-id routes found
no others: `GET /tutorials/:tutorialId` joins through `onboarding_packages.project_id`,
`GET /graph/workflows/:workflowId` joins through `analysis_snapshots.project_id`, and
`GET /graph/nodes/:nodeId` is bounded by the snapshot the project resolves to.

## Fix

Both remaining routes now join the child to its parent package and filter on the project id from the
path — the same shape as the regenerate route directly above them:

- **Receipts** (`backend/src/api/routes/onboarding.ts:840`): an ownership `SELECT` across
  `package_sections → onboarding_packages` runs before any receipt is read, and a section that is not
  in this project is a 404. The check comes first rather than being folded into the receipts query so
  that "section in another project" and "section with no receipts" stay distinguishable — the second
  is a legitimate 200 with an empty list.
- **Review** (`backend/src/api/routes/onboarding.ts:1020`): the filter is inside the `UPDATE`
  (`FROM onboarding_packages op WHERE op.id = ps.package_id AND ps.id = $3 AND op.project_id = $4
  RETURNING ps.*`) rather than in a check before it, so there is no window in which the row could be
  written outside the tenant the caller was authorized for. The package-status recomputation that
  follows therefore acts on a package already proven to be in this project.

No schema change: both are joins over existing foreign keys.

## Verification

`backend/test/api/tenantIsolation.test.ts` asserts 404 for a foreign child id on all three routes,
that the leaked snippet does not appear in the receipts response body, and — for the write — that no
`UPDATE` was executed at all without the project id among its parameters. The three assertions fail
against the pre-fix code (200/200/pass) and pass after.

---

## [P2][Closed] Bug 66: The authentication surface has an unused bypass and no throttling

**Bug #66**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Date fixed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15), security & UX audit |
| Priority | P2 |
| State | Closed — Fixed (M5 batch 1) |
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

## Reproduced (2026-07-26) — all three parts, one partially mitigated since filing

1. **Signup bypass — reproduced.** `backend/src/api/routes/auth.ts:9` still called
   `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true })` from an
   unauthenticated route. Confirmed dead code: no reference anywhere under `frontend/src` (the app
   signs up through the Supabase client); the only callers were two tests and the API docs.
2. **Invitation tier — reproduced.** `POST /members/invitations`
   (`backend/src/api/routes/members.ts:57`) inserted `permission_tier` straight from the body, and
   `POST /invitations/:id/accept` inserted it into `project_members` verbatim. `"owner"` was accepted
   end to end; a typo'd tier reached the `CHECK` constraint and returned 500. The member `PATCH`
   route two functions away already had a whitelist — the vocabulary just was not shared.
3. **Throttling — partly landed, and the landed half does not cover this.** The `askRateLimit`
   middleware added in M4 (`/projects/:id/ask`) is keyed on `req.user.id` and mounted after
   `requireAuth`; it protects the billed LLM route and is structurally inapplicable to an
   unauthenticated one, which has no user id. `POST /api/auth/login` was still unthrottled. What
   remained was therefore: an unauthenticated-surface limiter, plus a key that is not a user id.

## Fix

**1 — the bypass is deleted.** No `POST /signup` exists; a comment in its place records why, so it is
not reintroduced by someone who finds it in the docs. Sign-up is the Supabase client in the browser,
which sends the confirmation email. This also closes **#4** and **#5**, whose subject was that
endpoint's validation. `doc/BACKEND.md` no longer lists it as a public route.

**2 — invitation tiers are whitelisted, on the way in and on the way out.**
`backend/src/api/lib/permissionTiers.ts` holds the vocabulary once; `INVITABLE_TIERS` is
`admin | developer`, deliberately excluding `owner` (one owner per project, changed by transfer,
never by invite). `POST /members/invitations` rejects anything else with a 400 naming the allowed
values, and validates `developer_role` for the same reason. `POST /invitations/:id/accept` re-checks
the tier as it is redeemed — **pending rows written before this fix are still in the table**, and
that endpoint is what turns one into real permissions. No schema change: this is an application-level
allowlist over the existing `CHECK` values.

**3 — the auth surface is throttled.** `backend/src/api/middleware/rateLimit.ts` generalizes the
fixed-window limiter that `askRateLimit` already was, into a factory taking the bucket key — the ask
limiter is now a three-line configuration of it, unchanged in behaviour.
`backend/src/api/middleware/authRateLimit.ts` mounts two windows on `POST /auth/login`:

| Window | Key | Limit | Stops |
|--------|-----|-------|-------|
| Per credential | client address + email | 10 / 15 min | Guessing one account's password |
| Per address | client address | 60 / 15 min | Rotating emails to stay under the first window |

Both answer 429 with `Retry-After`. The email is part of the first key on purpose: behind a shared
address — an office NAT, or a platform proxy when `trust proxy` is not set — an address-only limiter
would let one attacker lock every colleague out of their own account. The per-address ceiling sits
far above human use for the same reason. Keys are attacker-supplied, so expired windows are swept
once the map grows past 5,000 entries rather than being left to accumulate.

## Verification

- `backend/test/api/auth.test.ts` — `POST /api/auth/signup` answers **404**; twelve login attempts
  against one address produce 429s from the eleventh on, with a positive `Retry-After`; a *different*
  email from the same address is still served after the first is locked out.
- `backend/test/api/members.test.ts` — inviting `"owner"` and inviting a typo'd tier both return 400,
  and **no invitation row is written** in either case.
- `backend/test/api/routes.todo.test.ts` updated to assert the signup route is gone.

---

## [P2][Closed] Bug 67: Repository import blocks large accounts and its cost safety gate is bypassable

**Bug #67**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P2 |
| State | Closed — defects 1 and 2 fixed 2026-07-26 (M5 batch 2), defects 3 and 4 fixed 2026-07-29 (M5 batch 7) |
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

## Verification and fix — defects 1 and 2 (2026-07-26)

**Defect 1 — the cost gate. Reproduced.** `PreflightPreviewCard` takes
`acknowledged` / `onAcknowledgedChange` and renders a **controlled** checkbox
(`PreflightPreview.tsx:154`). The import wizard passed neither
(`ImportPage.tsx:345`, `<PreflightPreviewCard preview={preview} />`), so
`checked` was pinned to `acknowledged ?? false` and `onChange` called
`onAcknowledgedChange?.()` on `undefined` — a box that could never be ticked.
Start analysis was `disabled={startingAnalysis}` only. `AnalyzeDialog.tsx:168`
wires both and gates with
`disabled={… || (preview !== null && preview.confirmationsRequired.length > 0 && !confirmed)}`
— the reference.

*Fixed:* the wizard now matches the reference exactly, plus the invalidation
half — editing the configuration drops the acknowledgment along with the preview
it described, so a cheap `backend/` scope's tick cannot carry over to a
whole-repo full-depth run. `handleStartAnalysis` re-checks the gate on entry, so
a programmatic or keyboard activation cannot slip past a disabled button.

*Scope of the gate, stated plainly:* it is client-side, because
`confirmationsRequired` is computed BY the preflight — before one runs there is
nothing to acknowledge. The server-side guard on spend is `BudgetEnforcer`
(`worker/ai/budgetEnforcer.ts`), which caps a run regardless of what any client
sends. The M5 notice above the buttons already states the analysis scope before
any preview; the gate builds on it rather than duplicating it.

**Defect 2 — large accounts. Reproduced.** `listInstallationRepos`
(`lib/github.ts:278`) fetched `?per_page=100` and returned `data.repositories`
with no pagination; `listBranches` (`:300`) sent no `per_page` at all and took
GitHub's default of 30. An org installed on 250 repositories saw 100, with no
error and no partial-list notice.

*Fixed:* both walk to exhaustion via a shared `fetchAllPages` helper
(`per_page=100`, terminating on a short page), bounded at 20 pages with a
`truncated` flag and a server-side warning so a cut list can never be silent. A
small account still costs exactly one request. Client-side, the repo and branch
pickers get a type-to-filter box above `TYPEAHEAD_MIN_OPTIONS` (8) with a live
`"N of M match"` line and a no-match hint; the selected option is never filtered
out from under the trigger.

**Tests:** `backend/src/lib/__tests__/githubPagination.test.ts` (237 repos over
3 pages, 112 branches over 2, single-page short-circuit, the 20-page ceiling
reported as `truncated`, a 403 surfacing as an error rather than a short list)
and `frontend/src/pages/ImportPage.test.tsx` (filter narrows 137 repos to one;
no-match copy; the checkbox is tickable and gates Start; the tick is dropped on
a config change; the M5 scope notice is not duplicated). Both gate tests were
confirmed to **fail** against the pre-fix `ImportPage.tsx`.

## Verification and fix — defects 3 and 4 (2026-07-29, M5 batch 7)

Shipped in commit `4a7cd53` ("Fix the auth-page and import dead ends"), which
closes the declared remainder.

**Defect 3 — no badge, no link. Fixed.** The repo picker cross-references
`useProjects`, so an already-imported repo renders "(already imported)" and is
not selectable (`ImportPage.tsx:709`). `POST /projects` now returns the existing
project's id alongside the 409 (`projects.ts:332-335`; a failed lookup omits the
id rather than losing the 409), and the wizard turns it into an "Open the project
you already imported for this repository" link (`:595`) through the same markup
the stranded-project case already used.

**Defect 4 — refresh on step 2. Fixed.** The created project id lives in the URL
(`/import?project=<id>`) and is restored on mount (`ImportPage.tsx:104,112,182`),
so a refresh or a Back keeps step 2 instead of dropping the user into step 1 and
straight onto defect 3's dead end. The `sessionStorage` hop stays for the OAuth
round trip only.

**Tests:** `projects.test.ts` (409 body carries `project_id`) and
`ImportPage.test.tsx` (badge + disabled option; step 2 restored from
`?project=`).

---

## [P2][Closed] Bug 68: Failed requests look like empty results — and one pushes the user toward a paid action

**Bug #68**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P2 |
| State | Closed — Sahib, M5 batch 3 |
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

**All four reproduced on 2026-07-26 and are fixed. Frontend only; no backend change was needed.**

The endpoint was never ambiguous, which is what makes the original code wrong rather than merely
lossy: a role with no package answers **200** with `{ package: { status: "missing", sections: [] } }`
(`backend/src/api/routes/onboarding.ts:549`). Absence has its own representation. So the `null`
returned by the swallow could only ever mean *the request failed* — and the reader rendered it as
absence.

**1 — the one that costs money.** `onboardingData.ts:189-203` was
`try { … } catch { return null }`, with the comment *"No mock fallback: a failed load shows the
honest missing state"*. It is the opposite of honest. Any 500, dropped connection or expired session
painted **"No package for Backend"** + a **Generate for Backend** button — telling users the package
they already own does not exist and inviting them to pay for a rebuild. A latent second defect made
it worse: the page *had* a `pkgFetchError` state and a "Couldn't load this package / Retry" pane, but
`loadPkg`'s `.catch` was unreachable because the helper never rejected — dead error-handling sitting
behind a swallow.

*Fixed:* the helper propagates. `OnboardingPage` now tracks three states, not one — `pkgLoading`,
`pkgError`, and real absence — rendered in that order, and **only the last shows a button that starts
a billed run**. A 404 on a pinned `?package=` is separated out again as "This package no longer
exists" with *Back to packages* and no retry, because retrying a deleted package cannot succeed. The
missing loading state (same bullet in the report) is the same fix: `pkg` started `null`, so the false
empty state flashed on every load and every package switch.

**2 — tutorials and workflow steps.** `WalkthroughTab.tsx` had no failure state for its detail pane.
`openTutorial` caught into `/* list stays */`, so a failed open showed a spinner and snapped back to
"Pick a path to read" — the click looked broken. `openWorkflow` caught into `setWfSteps([])`, which
renders **"No steps found for this workflow"** — a server error presented as an authoritative claim
about the repository. Both now set a `detailError` and render a shared `DetailErrorPane` with the
message and a working **Try again**.

Also fixed here, and separately confirmed live during M4 (`UI_VERIFY_M4.md` #13): on
`WorkflowsPage.tsx` the *steps* fetch wrote the **same `error` state as the list fetch**. The rail is
gated on `!error`, so one failed steps call deleted the entire workflow list from the page, and the
banner it left read *"The workflow list could not be loaded"* — blaming the request that had
succeeded. Steps failures are now a `stepsError` scoped to the canvas; the rail stays, and the reader
can pick another flow.

**3 — feeds, keys and history.** Dashboard activity caught into `[]` and rendered *"No activity yet —
it appears once your first repository is imported and analyzed"* to established users; it now
distinguishes never-loaded, failed and genuinely empty. `ProjectSettingsPage` swallowed both the
`llm-key` and `ranking-weights` loads — the first rendered the "paste a key" form to a team whose key
*is* configured (so the fix warns against adding one until it loads, or they overwrite it), the
second rendered an empty role dropdown with no sliders. Run history on `ProjectOverviewPage` printed
its error line **above a spinner that never resolves**, because a failed fetch leaves `runs` at
`null` forever; the failure is now the whole state, with a retry.

**4 — the leaked poll.** `handleRegenerateSection` held its `setInterval` in a local, so navigating
away mid-regeneration left it firing every 4s for the full 120s timeout against an unmounted
component. It is in a ref now and cleared by the same unmount effect that already covered the
generate-role poll. The two `await`-inside-`setInterval` polls also gained try/catch: now that the
helper rejects, an unhandled rejection would have killed the poll without stopping it.

**Also found while sweeping for the same shape (not in the original report):**

- **`useProgress` — the one instance that destroyed data.** A rejected progress fetch did
  `setItems([])` and *still* flipped `loaded` to true in `finally`. The hook's own comment says
  consumers that merge into stored positions "must wait for the initial fetch or they'd overwrite
  history with `[]`" — a failure defeated exactly that guard, so the reader merged its read marks
  against an empty history and wrote `readSections: []` back to the server. One failed GET silently
  erased a member's reading progress. `loaded` is now only set on success, so merge consumers stand
  down; the reader's disabled "Mark as read" says why.
- **`TeamPage` pending invitations** caught into "leave invitations empty", which hides the section
  entirely — so a failed fetch looks like *nobody is waiting*, and an admin acting on that
  re-invites someone who already has an invitation pending.
- **`AnalyzeConfigForm`** caught branches, commits and scopes into `[]`, and each control falls back
  to a single default when its list is empty — so a failed request read as "one branch, no history,
  no sub-packages" on the form that **starts a billed run**. The run is still startable on the
  defaults; the form no longer claims the defaults are all there is.

**Checked and deliberately left alone:** the drill-level loaders on `ArchitecturePage`,
`CapabilitiesPage` and `ClassGraphSection` look like swallows (`.catch(() => {})` at the call site)
but their `loadLevel` sets an error state *before* re-throwing, so the failure is already surfaced.
The status/metrics polls in `ProjectCard` and `AnalysisRunPanel` keep their last good value on a
failed tick and cannot manufacture an empty state.

**Test:** `frontend/src/pages/OnboardingPage.errorstate.test.tsx` — four assertions on the expensive
instance: the helper rejects instead of resolving `null` (the root-cause line, and this one fails if
the swallow is restored — checked by reverting it); a rejected fetch renders an error **with a retry
and no Generate button**; `status: "missing"` still renders the empty state **with** Generate; and
neither paints while the first fetch is in flight.

---

## [P2][Closed] Bug 69: Analysis jobs can get stuck, or fail on an error that should have been retried

**Bug #69**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P2 |
| State | Closed — fixed 2026-07-26 (M5 batch 2) |
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

## What the new recovery module already covers (2026-07-26)

`worker/jobRecovery.ts` + `worker/shutdown.ts` landed in the same milestone and
were read first. **They close neither half of this bug**, and the boundary is
clean:

| Mechanism | Question it answers | Signal | Bound |
|-----------|--------------------|--------|-------|
| `jobRecovery.reconcileOrphanedJobs` | "this row says **running** but its worker is gone" | dead heartbeat, `WHERE status = 'running'` | `checkpoint->recovery->attempts` |
| **#69(1)**, this fix | "this row says **queued** and was never submitted" | the `queue.add` that threw | n/a — one terminal write |
| **#69(2)**, this fix | "the processor threw and BullMQ is about to redeliver" | `attemptsMade + 1 < opts.attempts` | `opts.attempts` |

The recovery sweep cannot rescue a never-submitted job by construction: its only
liveness signal is a heartbeat, and a job that never started has none — it will
sit on `'queued'` past any timeout. And the sweep never sees #69(2) either,
because the old code wrote `'failed'` immediately, which the sweep also skips.
Both files were left untouched.

## Verification and fix (2026-07-26)

**Half 1 — a failed submission leaves the row queued forever. Reproduced.**
`POST /projects/:id/analyze` calls `enqueueAnalysisRun` **after** `COMMIT`
(`routes/projects.ts:1237-1239`). A throw there hit a catch whose `ROLLBACK` is
a no-op on a committed transaction and returned a 500, leaving
`analysis_jobs.status = 'queued'` and `projects.status = 'analyzing'` forever.
Every retry then failed the per-tuple guard in `prepareAnalysisRun` with 409
"already being analyzed" — the concurrency guard doing its job on a phantom.

*Fixed* in the producer, which is the only place that knows the submission
failed. `failUnsubmittedJob` (`api/services/analysisStarter.ts`) fails the row
with the reason and recomputes the project scalar; it is guarded on
`status = 'queued'` so a worker that DID pick the job up despite a lost ack is
never stomped mid-run. Wired into all four sites that commit a row before
submitting: `enqueueAnalysisRun` (used by both the analyze route and the push
webhook), the new `enqueuePreflightRun`, `POST /analysis-jobs/:id/resume`, and
`enqueueSummaryGeneration` in the worker. The webhook loop no longer aborts on
the first failure, so one unreachable-queue error cannot strand its sibling
scopes. The two chained generation enqueues are contained with `.catch`: the
analysis really did complete, so a generation submission failure must not drag
a finished run — or its snapshot — back to `'failed'`.

**Half 2 — the retry policy is a no-op. Reproduced.** Producers enqueue with
`attempts: 2`, so BullMQ redelivers once. Both workers wrote
`status = 'failed'` on the FIRST failure, and both guard their progress writes
with `status NOT IN ('paused','failed')` (`worker/index.ts:280`,
`summaryWorker.ts:107`) — so the redelivery threw `KillSwitchError('failed')`
on its very first step and exited having done nothing. Every transient error
became a hard failure needing a manual resume, while the configured retry
burned a delivery.

*Fixed* in a new `worker/retryPolicy.ts`, shared by both workers. `shouldRetry`
mirrors BullMQ's own `Job.shouldRetryJob` (`attemptsMade + 1 < opts.attempts`,
never for an `UnrecoverableError`) and subtracts a small anchored list of
failures a second attempt cannot fix — project/scope/snapshot not found, no
installation linked, no supported source files, duplicate run. On a non-final
attempt the row goes back to `'queued'` with
`Retrying after error (attempt N of M)`, `finished_at` cleared, guarded on
`status NOT IN ('paused','complete')` so a pause clicked mid-failure still wins.
On the final attempt it is terminal, exactly as before. The generation worker
additionally skips its terminal side effects while retrying — a package that
flickers `'failed'` between attempts is the same lie in miniature.

The snapshot is still marked failed on **every** attempt, deliberately: that
keeps the row truthful (bug #75) and it is also what makes the retry re-run the
pipeline instead of short-circuiting on the optimistic `'complete'` the
persistence step writes at 46%.

**Tests:** `backend/src/worker/__tests__/jobLifecycle.test.ts` — the BullMQ
mirror at each attempt boundary, transient-vs-permanent classification (with
the anchoring check: a 502 quoting "Project not found" is still retried),
`'queued'` on a non-final attempt vs `'failed'` on the last, and the
reconciliation of an unsubmitted row including the `status = 'queued'` guard
and the project recompute. `analysisStarter` gained a
`__setQueuePublishForTests` seam because a real `Queue.add` against an
unreachable Redis never rejects — ioredis reconnects forever by design.

---

## [P2][Closed] Bug 70: The dependency graph reports "imported by 0" for everything, and search blanks the canvas

**Bug #70**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P2 |
| State | Closed — half 1 fixed in M4, half 2 fixed 2026-07-26 (M5 batch 3) |
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

## Verification — half 1 (2026-07-26): already fixed in M4, closed with evidence

**Not reproducible.** `dependentCount` is computed cross-boundary at all three
grouping sites and is no longer hardcoded:

- `api/routes/graph.ts:350` — directory groups: `dependentCount: crossIn.get(dir) ?? 0`,
  built from a `crossOut`/`crossIn`/`internalLinks` pass over `fileEdges`
  (`:327-337`). Its paired half was fixed at the same time: `importCount` counts
  links crossing the group's boundary rather than summing members' own imports.
- `graph.ts:1096` — class-view groups: `inn.get(...)` over `scopedEdges`.
- `graph.ts:511` — sub-cluster groups: `subIn.get(...)`.

Landed in commit `00639bf` ("Recalibrated onboarding"), whose diff carries the
`AUDIT C1 / SC F7 / UX §9.1 + §17.6` comment naming this defect. No change made.

## Verification and fix — half 2 (2026-07-26)

**Reproduced.** `GraphPage.tsx` passed `refitSignal={`${direction}:${fullscreen}`}`
— a search could never change it, and that prop is the only thing that refits
the camera (`GraphCanvas.tsx` keys `<ReactFlow>` on it, so a change remounts the
flow and reruns its declarative `fitView`). Filtering re-runs
`layoutDependencyGraph` over the surviving nodes, which places them somewhere
the current viewport need not cover — so "2 / 60 files" over a blank canvas is
exactly what the pipeline produces. The input was also undebounced: `onChange`
wrote `search` directly, and every keystroke re-ran filter → edge cap → dagre
layout.

**Fixed**, entirely in `GraphPage.tsx`:

- Two states. `searchInput` echoes every keystroke (a laggy box is its own bug);
  `search` is the settled value, 200ms behind, and everything expensive keys off
  it. Clearing is not typing — an emptied box and the X button snap back
  immediately rather than waiting out the debounce.
- `refitSignal={`${direction}:${fullscreen}:${search}`}` — the settled query
  joins the signal, so the camera fits the filtered set once per query rather
  than once per keystroke. This is what the prop is documented for ("bumped when
  node positions change without the selection changing"); no new camera
  machinery.
- `GraphCanvas` publishes the value as `data-refit-signal` so a test can assert
  *when* the camera refits — React Flow's own `fitView` no-ops at jsdom's zero
  canvas size, so the signal is the only observable.

**Tests:** two in `frontend/src/pages/GraphPage.test.tsx` — the signal changes
on a settled query, contains the whole query (not a prefix), and returns to its
original value on clear; and a MutationObserver over the signal proves no
intermediate value is ever emitted for `l`/`lo`/`log`/`logg`/`logge` while
typing "logger". Both were confirmed to **fail** against the pre-fix
`refitSignal`.

---

## [P3][Closed] Bug 71: Accessibility gaps and measured contrast failures

**Bug #71**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit + visual audit (the two HIGH items) |
| Priority | P3 |
| State | Closed — fixed/verified in M5 batch 7 (2026-07-29) |
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

## Fix — 2026-07-29 (M5 batch 7)

Two commits: `05a4f14` ("Accessibility pass: announce, label, and keyboard-reach everything") for
items 1, 4 and 5, and `bd37d63` ("Lift the dark theme off dark-on-dark…") for item 2.

- **Item 1 — navigation.** A skip-to-content link, per-route `document.title`, and focusable
  `<main>` regions with a focus reset on route change. `ErrorBanner`/`PageSpinner` (`components/ui/`)
  give errors `role="alert"` and loading `role="status"`; 28 files were swept onto them.
- **Labels and semantics.** Every settings/team/overview control now has a label that points at it;
  selection and status are announced (`aria-pressed`/`aria-current`/sr-only words) rather than
  carried by background or icon colour alone; the sidebar toggle announces its state; heading levels
  no longer skip; dimmed micro-text on meaningful strings is back at full opacity.
- **Item 4 — default package from the keyboard.** The make-default star is keyboard-operable, and
  its previously uncaught rejection is caught and surfaced.
- **Item 5 — reduced motion.** A base `@media (prefers-reduced-motion: reduce)` rule plus gated flow
  edges, camera glides and the five smooth scrolls.
- **Single-key shortcuts can be disabled** (persisted preference + a toggle in Account settings) —
  the WCAG 2.1.4 half of the same complaint.
- ~~**Item 3 — avatar initials.**~~ **Already fixed** in commit `12b6c40`: `avatarTints`
  (`TeamPage.tsx:64-70`) replaced the white-on-`-500` fills with `bg-*/15 text-*` token pairs.
  Re-measured 2026-07-29 against the post-lift tokens (same method as item 2): the audit's
  2.15–2.54 pairs are now **3.80–5.97** — dark 3.80/5.05/5.24/5.83, light 4.22/5.34/5.42/5.97
  (primary/info/success/warning on their 15% tints over card). Seven of eight clear AA-normal;
  light `text-primary` at 4.22 sits under 4.5 but at double the audited worst case and above the
  3.0 large-text bar — recorded rather than hidden.
- **Item 2 — dark structural contrast.** Full token lift, re-measured with the audit's own
  OKLCH → sRGB → luminance method rather than eyeballed. The BEFORE column reproduces the
  2026-07-22 audit's numbers to the digit, which is what validates the script:

  BEFORE
  ```
  [dark structural — WCAG 1.4.11 bar 3.0]
  card / background                    1.09  (needs >= 3)
  popover / card                       1.08  (needs >= 3)
  border / card                        1.43  (needs >= 3)
  border / background                  1.56  (needs >= 3)
  input / card                         1.43  (needs >= 3)
  sidebar-border / sidebar             1.26  (needs >= 3)
  [light soft-chip text — AA-normal bar 4.5]
  success text / success-soft chip     4.02  (needs >= 4.5)
  success text / background            4.68  (needs >= 4.5)
  warning text / warning-soft chip     4.07  (needs >= 4.5)
  warning text / background            4.60  (needs >= 4.5)
  danger text / danger-soft chip       4.26  (needs >= 4.5)
  danger text / background             5.06  (needs >= 4.5)
  info text / info-soft chip           3.74  (needs >= 4.5)
  info text / background               4.37  (needs >= 4.5)
  ```

  AFTER
  ```
  [dark structural — WCAG 1.4.11 bar 3.0]
  card / background                    1.18  (needs >= 3)
  popover / card                       1.10  (needs >= 3)
  border / card                        1.78  (needs >= 3)
  border / background                  2.09  (needs >= 3)
  input / card                         3.10  (needs >= 3)
  sidebar-border / sidebar             1.81  (needs >= 3)
  [light soft-chip text — AA-normal bar 4.5]
  success text / success-soft chip     5.47  (needs >= 4.5)
  success text / background            6.37  (needs >= 4.5)
  warning text / warning-soft chip     6.22  (needs >= 4.5)
  warning text / background            7.04  (needs >= 4.5)
  danger text / danger-soft chip       5.47  (needs >= 4.5)
  danger text / background             6.49  (needs >= 4.5)
  info text / info-soft chip           5.36  (needs >= 4.5)
  info text / background               6.27  (needs >= 4.5)
  ```

  **Read the dark table honestly: only input/card is a 1.4.11 pass.** 1.4.11 scopes 3.0 to
  boundaries that identify a control, so `--input` was split from the field tint to become that
  boundary (3.10 vs card) while the surface steps and the decorative card border are **perceptual
  lifts** — card/bg 1.09 → 1.18, border/card 1.43 → 1.78, border/bg 1.56 → 2.09, sidebar-border
  1.26 → 1.81 — and are reported as such, not as compliance. All eight light chip pairs clear AA.
  `--ring` was re-measured against the new surfaces (4.26–5.54 dark, 4.86–5.23 light): focus
  indicators are 1.4.11-scoped and all clear 3.0 unchanged, so no lift was needed.

**Verified:** frontend suite 227 → 285 passing across the batch, `tsc -b frontend` and
`npm run build -w frontend` clean, and the built stylesheet grepped to confirm every planned token
value actually compiled. Both themes were walked in a browser (see the batch-7 progress section).

---

## [P3][Closed] Bug 72: Team lifecycle is a one-way door

**Bug #72**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P3 |
| State | Closed — fixed 2026-07-29 (M5 batch 7); the email half Won't-Fix (W1) |
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

## Fix — 2026-07-29 (M5 batch 7)

Commit `26f1118` ("Close the team-lifecycle one-way doors"), plus the copy half in `daae508`. Four
capabilities, all application-level — **no schema change**, per the M5 freeze.

1. **Decline** — `POST /api/invitations/:invitationId/decline` (`invitations.ts:66`) reuses the
   accept path's fetch and email-match guards, then moves the row to `'revoked'`. The status CHECK is
   frozen and has no `'declined'` value, so `'revoked'` is the terminal stand-in and the code says so
   (`invitations.ts:64`); downstream behaviour is identical. The permanently-disabled button and its
   "isn't supported yet" tooltip are gone. *(Superseded 2026-08-06: migration 004 — approved under
   the database-change policy, since folded into `001_initial_schema.sql` — added the `'declined'`
   arm and decline now writes `'declined'`; rows declined before then stay `'revoked'`. That closed
   W3 as fixed rather than Won't-Fix. Commit `e95be2f`.)*
2. **Leave** — `DELETE /api/projects/:id/members/me` (`members.ts:385`), registered before
   `delete("/:userId")` so the literal wins, open to any member and 403 for the owner ("transfer
   ownership first"). Dependent rows were checked: `default_package_id` lives on the deleted row and
   `user_progress` survives by design.
3. **Ownership transfer** — `POST /api/projects/:id/members/:userId/transfer-ownership` in one
   transaction: demote the caller, promote the target, and **move `projects.user_id`**
   (`members.ts:355`). That last write is load-bearing rather than cosmetic —
   `services/accountDeletion.ts` cascades owned projects through `projects.user_id`, so an old owner
   left there would take the project with them when they deleted their account
   (`members.ts:290-292`). A concurrent transfer rolls back as 409; a target who already has a
   project for the same repo answers 409 against `UNIQUE (user_id, repo_owner, repo_name)`;
   self-transfer is 400.
4. **Invitation hygiene** — email trimmed, format-checked, self-invites and existing members
   rejected before the tier check; every invitation stamped `expires_at = NOW() + 14 days`
   (`INVITATION_TTL_DAYS`, `members.ts:17`, set in the INSERT because the schema is frozen); expired
   rows filtered out of both pending lists, keeping the `IS NULL` arm for legacy rows. A background
   sweeper was considered and declined (W4) — expiry is enforced at every read.

**Email delivery stays Won't-Fix (W1)** — no provider is provisioned and none was planned for M5.
The UI no longer implies one: the action is "Create invitation" and it says no email is sent.

**Live probe, not assertions.** `backend/tmp/team-lifecycle.mts` drove the running stack end to end —
invite hygiene (trim, bad format, self, existing member, duplicate), invite → decline → re-invite →
accept, leave, transfer, and the old owner then failing to delete the project: **19/19 checks
green**. Suite coverage lives in `members.test.ts`, `invitations.test.ts`,
`tenantIsolation.test.ts` and `InvitationsPage.test.tsx`.

---

## [P3][Fixed] Bug 73: The frontend image only works when the browser is on the Docker host

**Bug #73**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Date fixed | 2026-07-26 |
| Reported by | OnboardBuddies (Team 15), UX audit |
| Priority | P3 |
| State | Fixed — M5 |
| Area | Frontend build, nginx |

## Expected behavior

The API origin is configurable per deployment.

## Actual behavior

The API origin is inlined into the JavaScript bundle at build time and the build takes no argument
for it, so the image is pinned to `localhost:3000`. **Not a blocker for grading** — the documented
Docker Compose setup is exactly that case — but it blocks any non-localhost deployment, and it is why
the Content-Security-Policy has to name `localhost:3000` explicitly instead of `'self'`.

## Fix

Configuration moved from build time to container start. The nginx image runs
`frontend/docker-entrypoint.d/10-onboardbuddy-runtime-config.sh` before nginx boots; it reads
`VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the environment and writes
`/usr/share/nginx/html/config.js` (`window.__ONBOARDBUDDY_CONFIG__`), which `index.html` loads as a
plain synchronous script before the app module. `frontend/src/lib/runtimeConfig.ts` reads that global
and falls back to `import.meta.env` only when it is absent — i.e. the Vite dev server. The same
script renders `connect-src` into the CSP from the same two URLs, so the policy no longer names
`localhost:3000` and now allows one Supabase host rather than `https://*.supabase.co`.
`frontend/Dockerfile` deletes `frontend/.env` before `vite build`, so the image provably carries no
origin to fall back to; `docker-compose.yml` passes the same `frontend/.env` to the container as
`env_file`, so the reviewer's instructions are unchanged.

Considered and rejected: a build argument (still one origin per image, and Railway's API hostname
does not exist when the image is built); a `/config` endpoint fetched on boot (a round trip before
first paint, plus a 404 failure mode); `envsubst` over the built assets (fragile against
content-hashed filenames and immutable caching); and serving the SPA from the API process (loses
nginx's per-location header handling and couples the two deploys). A same-origin `/api` reverse proxy
through nginx is complementary, not sufficient — the Supabase URL and anon key still have to reach
the browser somehow.

Verified: one image, three containers, three configurations —
`connect-src 'self' http://localhost:3000 https://<ref>.supabase.co wss://<ref>.supabase.co` for the
compose values; `connect-src 'self' http://127.0.0.1:9099 ws://127.0.0.1:9099` for an origin that did
not exist at build time, with the app's real sign-in request landing on that origin and zero requests
to `:3000`; and `connect-src 'self'` with a "OnboardBuddy is not configured" page naming the missing
variables when nothing is set.

---

## [P4][Closed] Bug 74: [Tracker] Polish tail from the two end-of-M4 audits

**Bug #74**

| Field | Value |
|-------|-------|
| Date created | 2026-07-22 |
| Reported by | OnboardBuddies (Team 15) |
| Priority | P4 |
| State | Closed — fixed/verified in M5 batch 7 (2026-07-29) |
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
- [x] `backend/src/api/routes/members.ts:57` — `permission_tier` on invitations is not validated; `"owner"` is accepted and inserted verbatim on accept. An admin. (already fixed by #66 — verified: tier whitelist plus an accept-path recheck)
- [x] `backend/src/api/routes/github.ts:160` — OAuth/link catch-alls return `err.message` verbatim (400), and lib errors embed raw GitHub/Supabase response bodie. (fixed 2026-07-29 — `GitHubApiError {status, body}` keeps bodies out of `message`; catch-alls routed through `handleGitHubRouteError`)
- [x] `backend/src/api/app.ts:10` — No rate limiting anywhere; `POST /api/auth/login` proxies `signInWithPassword` with unlimited attempts. Brute-forceable, and. (already fixed by #66 — verified: `middleware/rateLimit.ts` + tests)
- [x] `backend/src/api/routes/members.ts:83` — Invitations are inserted with no `expires_at`, and the accept path treats NULL as never-expiring. Pending invites. (fixed 2026-07-29 — 14-day `expires_at` set in the INSERT; expired rows filtered from both lists)
- [x] `backend/src/worker/index.ts:780` — The orphan reconciler only rescues `status='running'` jobs. A job whose DB row committed but whose Redis enqueue failed. (fixed 2026-07-29 — the three unguarded enqueues wrapped in `failUnsubmittedJob`; `claimOrphans` now sweeps aged `queued` too)
- [x] `backend/src/worker/index.ts:244` — BullMQ `attempts: 2` is a no-op: the first failure stamps the DB row `failed`, so the retry immediately hits the `KillS. (already fixed by #69 — verified: `worker/retryPolicy.ts`)
- [x] `backend/src/api/routes/projects.ts:159` — When no branch is supplied and the GitHub repo fetch fails (revoked access / deleted repo), it becomes a generic. (fixed 2026-07-29 — classified to 422 "repository not accessible")
- [x] `backend/src/api/routes/members.ts:83` + `frontend/src/pages/TeamPage.tsx:305` — "Inviting" only inserts a DB row — no email is ever sent — yet the dialog. (fixed 2026-07-29 — "Create invitation" + a "no email is sent" hint; delivery itself Won't-Fix: W1)
- [x] `backend/src/api/routes/members.ts:67` — Invite creation does no email trim/format check and doesn't reject self-invites or existing members. A whitespace-. (fixed 2026-07-29 — trim, format, self-invite and existing-member checks before the tier check)
- [x] `backend/src/api/routes/graph.ts:73` — In the default directory-grouped dependency view, every group is built with `dependentCount: 0` hardcoded while `imp. (already fixed by #70 — verified; the missing regression test added in `graph.test.ts`)
- [x] `backend/src/api/middleware/project-access.ts:15` — A non-UUID `:id` (truncated shared link) makes Postgres throw, caught as a 500 instead of a comprehensi. (fixed 2026-07-29 — shared `requireUuidParam` answers 404)
- [x] `backend/src/api/app.ts:30` — The global error handler ignores `err.status`, so malformed-JSON (400) and payload-too-large (413) both surface as 500. (already fixed — verified, and now pinned by a test: malformed JSON 400, oversize body 413)
- [x] `backend/src/api/app.ts:7` — No `compression()` middleware, and large graph payloads have no node caps: `/graph/classes` and `/graph/architecture` (incl. a. (fixed 2026-07-29 — `compression()` after the webhook raw mount; `/onboarding/packages` capped with lateral rollups)

**Frontend (48)**
- [x] `frontend/src/pages/OnboardingPage.tsx:1125` — The reader has no loading state for the package fetch; `pkg` starts `null` so `isMissing` immediately paints. (already fixed by #68 — verified)
- [x] `frontend/src/pages/OnboardingPage.tsx:639` — `handleRegenerateSection`'s 4s poll interval is a local variable, cleared only from inside its own callback;. (already fixed by #68 — verified)
- [x] `frontend/src/pages/ProjectOverviewPage.tsx:452` — `packagesError`/`statusError` are only surfaced in the `neverAnalyzed` branch. On an already-analyzed pr. (fixed 2026-07-29 — error-with-retry hoisted above the grid on analyzed projects too)
- [x] `frontend/src/pages/ImportPage.tsx:484` — Already-imported repos aren't marked or filtered, and the resulting 409 "Project already exists" is a bare error. (fixed 2026-07-29 — #67 remainder: repos badged and unselectable; the 409 links the existing project)
- [x] `frontend/src/pages/ImportPage.tsx:91` — The two-step wizard keeps `createdProjectId` and step-1 selections only in component state. Refreshing on "Step 2. (fixed 2026-07-29 — #67 remainder: step 2 restored from `?project=<id>`)
- [x] `frontend/src/pages/ResetPasswordPage.tsx:26` — The page never reads Supabase's `#error=access_denied&error_code=otp_expired` hash on an expired/invalid re. (fixed 2026-07-29 — expired/dead links surfaced instead of spinning forever, plus a 10s timeout guard)
- [x] `frontend/src/pages/LoginPage.tsx:44` — "Sign in with GitHub" drops the deep link. Email login preserves `location.state.from`, but `signInWithGithub()` re. (fixed 2026-07-29 — `next` threaded into `redirectTo`)
- [x] `frontend/src/pages/LoginPage.tsx:76` — None of the four auth pages set `autocomplete` (login lacks `email`/`current-password`, signup lacks `email`/`new-p. (fixed 2026-07-29 — `autoComplete` on all four auth pages)
- [x] `frontend/src/pages/AccountSettingsPage.tsx:373` — Unlinking a GitHub/email sign-in identity happens instantly on click with no confirmation, while the *le. (fixed 2026-07-29 — both unlinks ask for confirmation first)
- [x] `frontend/src/pages/AccountSettingsPage.tsx:538` — The "Add email sign-in" dialog is a `<div>` with onClick buttons, not a `<form onSubmit>`, so pressing E. (fixed 2026-07-29 — a real form; Enter submits)
- [x] `frontend/src/pages/SignupPage.tsx:46` — "Sign up with GitHub" has no loading state and doesn't mutually disable with the submit button (LoginPage shares `. (fixed 2026-07-29 — loading state + mutual disable, mirroring LoginPage)
- [x] `frontend/src/pages/ResetPasswordPage.tsx:110` — Test convenience leaks into user copy: the confirm field is labeled "Confirm new" (truncated) and the mism. (fixed 2026-07-29 — label and mismatch copy fixed; tests moved to exact-match queries)
- [x] `frontend/src/pages/InvitationsPage.tsx:221` — The Decline button is permanently disabled (no decline endpoint exists), and the list also shows expired inv. (fixed 2026-07-29 — #72: a real decline endpoint; expired rows filtered out)
- [x] `frontend/src/pages/TeamPage.tsx:208` — There is no "Leave project" anywhere in the UI, and the backend forbids self-removal (members.ts:216). Anyone who a. (fixed 2026-07-29 — #72: `DELETE /members/me` plus a TeamPage action)
- [x] `frontend/src/components/ProjectCard.tsx:119` — The card's "Delete project" menu shows for owner *and* admin, but the API requires owner (projects.ts:486),. (fixed 2026-07-29 — owner-gated, behind the shared type-to-confirm dialog)
- [x] `frontend/src/pages/OnboardingPage.tsx:989` — "Mark reviewed" renders only for owner/admin (API agrees), yet the tour sells it as "your progress tracker" a. (fixed 2026-07-29 — the editorial metric is relabelled "Approvals" and a per-member read count sits beside it)
- [x] `frontend/src/pages/GraphPage.tsx` (dependency search) — Searching filters the match count but never recenters the viewport onto the matches. *(Confirmed l. (already fixed by #70 — verified: `refitSignal` + test)
- [x] `frontend/src/pages/GraphPage.tsx:82` — The `?focus=` deep-link param is re-resolved on every `loadGraph` and never removed from the URL. On a clustered re. (fixed 2026-07-29 — `focus` deleted once resolved, and a target resolves only once)
- [x] `frontend/src/pages/WorkflowsPage.tsx:137` — The workflow-graph fetch (and the package-keyed loads in ArchitecturePage/CapabilitiesPage/ClassGraphSection/G. (fixed 2026-07-29 — staleness guards on all five package-keyed loads)
- [x] `frontend/src/pages/GraphPage.tsx:208` (+ `ClassGraphSection.tsx:67`) — The graph search input isn't debounced; each keystroke re-runs a full union-find +. (fixed 2026-07-29 — `useDebouncedValue` extracted; ClassGraphSection debounced for the first time)
- [x] `frontend/src/components/graph/GraphFirstVisitHint.tsx:37` — The first-visit hint copy is hardcoded to the files view ("map of how files depend… open it on. (fixed 2026-07-29 — a `classes` variant with its own copy and dismissal key)
- [x] `frontend/src/components/graph/ModuleNode.tsx:3` — Leftover commented-out code shipped in a per-node component: a commented import, a dead `const complexit. (already fixed — verified: the component carries no dead code)
- [x] `frontend/src/App.tsx:93` — No skip-to-content link and `<main>` regions aren't focus targets. Keyboard users Tab through the logo, 4–9 nav links, tour/sho. (fixed 2026-07-29 — skip link, focusable `<main>` with a focus reset, per-route `document.title`)
- [x] `frontend/src/pages/ImportPage.tsx:407` (+ TeamPage, ProjectSettingsPage, ArchitecturePage, ProjectOverviewPage) — Many `<Label>`s lack `htmlFor` and their. (fixed 2026-07-29 — label sweep across the settings, team and overview controls)
- [x] `frontend/src/pages/ProjectSettingsPage.tsx:266` (+ Dashboard, Import, Team, Invitations, Onboarding, AnalyzeDialog, AccountSettings) — Async error/status. (fixed 2026-07-29 — shared `ErrorBanner` with `role="alert"`, 28 files swept onto it)
- [x] `frontend/src/pages/DashboardPage.tsx:250` (+ ~13 other pages) — Full-page loading is a bare spinning `Loader2` with no `role="status"`/sr-only text, so du. (fixed 2026-07-29 — shared `PageSpinner` with `role="status"` and a label)
- [x] `frontend/src/pages/WorkflowsPage.tsx:186` — No `prefers-reduced-motion` handling anywhere while the app runs continuous motion: every workflow edge is `an. (fixed 2026-07-29 — base CSS rule plus gated edge animation, camera glides and smooth scrolls)
- [x] `frontend/src/pages/WalkthroughTab.tsx:310` (+ OnboardingPage, InvitationsPage) — Selected item in several toggle lists is conveyed only by background colo. (fixed 2026-07-29 — `aria-pressed` on the toggle lists, `aria-current` on the reader nav)
- [x] `frontend/src/components/AnalysisRunPanel.tsx:177` + `PackageSelector.tsx:120` — Pipeline phase status and package status are conveyed solely by icon color. (fixed 2026-07-29 — sr-only status words on the phase icon and the package dot)
- [x] `frontend/src/pages/TeamPage.tsx:340` — Avatar initials are white text on `bg-amber-500`/`emerald-500`/`cyan-500` (~1.6:1 on amber) — illegible for low-vis. (already fixed by 12b6c40 — verified: `avatarTints` token pairs replaced the `-500` fills)
- [x] `frontend/src/pages/OnboardingPage.tsx:1110` (+ several) — Meaningful sub-12px text at reduced opacity (`text-muted-foreground/50`, `opacity-50` at 10–11px. (fixed 2026-07-29 — opacity dropped on meaningful text; full sub-12px eradication Won't-Fix: W5)
- [x] `frontend/src/pages/ProjectSettingsPage.tsx:278` (+ ProjectOverviewPage, OnboardingPage) — Heading levels skip `h1 → h3` with no `h2`, breaking the screen-. (fixed 2026-07-29 — levels corrected; the settings h2 layer arrived with SettingsShell)
- [x] `frontend/src/components/AppTour.tsx:119` — On tour end, focus isn't restored to the triggering element (it grabbed focus into the card on open), dropping. (fixed 2026-07-29 — the tour restores focus to its trigger)
- [x] `frontend/src/hooks/useHotkeys.ts:33` — Global single-character shortcuts (`[`, `]`, `1`-`9`, `?`) are always active with no way to disable/remap — a WCAG. (fixed 2026-07-29 — persisted hotkeys preference, a settings toggle and a note in the shortcuts dialog)
- [x] `frontend/src/components/SidebarShell.tsx:60` — The sidebar toggle has `aria-label` but no `aria-expanded`/`aria-controls`. (fixed 2026-07-29 — the toggle announces its state)
- [x] `frontend/src/pages/ProjectSettingsPage.tsx:251` — A failed project deletion writes to the page-level error banner, but the confirmation dialog has no erro. (fixed 2026-07-29 — delete failures render inside the dialog)
- [x] `frontend/src/pages/WalkthroughTab.tsx:262` — `openTutorial`'s catch is empty; a tutorial that 500s shows a spinner then silently snaps back to the picker. (already fixed by #68 — verified)
- [x] `frontend/src/lib/api.ts:48` — On a final 401 there's no shared redirect-to-login; pages print raw text like "API error 401" until Supabase's SIGNED_OUT ev. (fixed 2026-07-29 — one idempotent sign-out, then login with the return path)
- [x] `frontend/src/pages/DashboardPage.tsx:162` — The activity-feed fetch swallows errors (`.catch(() => {})`), so on failure users with real activity see "No a. (already fixed by #68 — verified)
- [x] `frontend/src/pages/ProjectOverviewPage.tsx:716` — On run-history fetch failure, `runs` stays `null`, so the error text renders together with a spinner tha. (already fixed by #68 — verified)
- [x] `frontend/src/pages/ProjectSettingsPage.tsx:135` — The llm-key and ranking-weights loads swallow errors, leaving a permanently empty role dropdown / "no ke. (already fixed by #68 — verified)
- [x] `frontend/src/components/PackageSelector.tsx:108` — The "make default" star calls `void setDefaultPackage(...)` and never catches the rejection — it can fa. (fixed 2026-07-29 — caught in `PackagesContext` and surfaced; the star is keyboard-operable via `*`)
- [x] `frontend/nginx.conf:1` — The prod nginx config has SPA fallback only — no `gzip`, no `Cache-Control` for `index.html` or hashed `/assets/*`. Big JS ships. (already fixed with #73 — verified: gzip, no-cache `index.html`, immutable assets)
- [x] `frontend/index.html:3` — No `<meta name="description">` or `theme-color`, and the theme-bootstrap `catch` forces dark mode when localStorage throws, ignor. (fixed 2026-07-29 — description + per-scheme `theme-color`; the catch falls back to `matchMedia`)
- [x] `frontend/src/components/ProjectLayout.tsx:190` — The branch `Badge` in the 224px sidebar has `whitespace-nowrap` and no `max-w`/`truncate` (the repo name. (already fixed — verified: the badge was removed by design after M2 owner feedback)
- [x] `frontend/src/pages/InvitationsPage.tsx:107` — "Pending Invitations" (title) vs "Active Invitations" (list heading, 3 lines down) vs "Invitations" (sidebar. (fixed 2026-07-29 — one name for the surface; the two routers stay, Won't-Fix: W2)
- [x] `frontend/src/pages/LoginPage.tsx:117` — Mixed verbs/casing on the app's front door: "Sign In" (Title Case) above "Sign in with GitHub" (sentence case), wh. (fixed 2026-07-29 — sentence-case verbs across the front door)
- [x] `frontend/src/pages/OnboardingPage.tsx:450` — The onboarding reader always uses `setParams({ replace: true })`, so opening a package card replaces the grid. (fixed 2026-07-29 — the three reader view boundaries push instead of replacing)

**Cross-cutting (2)**
- [x] Architecture view (AI-generated component summaries) — *(Observed live)* a component card read "Database Schema: 0 files." in its description while showing. (already fixed at root cause — `architectureClusterer.ts:296-306`: counts live in the chip, never in the prose; **checked live 2026-07-29**: 0 of 94 stored clusters carry an "N files." claim in `deterministic_summary` or `metadata`, semantic narratives included)
- [x] One action, four names: the import action is "Add Project" (headers), "Import Repository" (empty state), "Add New Repository" (`ProjectListPage.tsx:161`),. (fixed 2026-07-29 — "Import repository" at every CTA site, grep-proofed to zero others)

## Notes

Plan for M5: work the two audit documents as a checklist in priority order, naming and terminology
first because that is what a reviewer notices. Anything not done by the freeze is closed
**Won't-Fix with its specific reason**, so the tracker ends clean rather than open.

## Closure — 2026-07-29 (M5 batch 7)

Every one of the 63 lines above is ticked, each with its own evidence: **46 fixed in this batch, 17
verified already-fixed** (checked against current source or a test, not assumed). Eight sub-items are
Won't-Fix with a stated reason — W1–W8 in the batch-7 progress section. Nothing on the checklist is
wholly Won't-Fix; the eight are halves of items whose other half shipped. (One of the eight was later
un-Won't-Fixed: W3, the first-class `'declined'` status, shipped 2026-08-06 via migration 004 — see
the update under #72 — so seven stand.)

Three items that lived only in this log's prose were closed with the batch: the two pre-existing
`react-hooks/exhaustive-deps` errors (DashboardPage's tour effect, WalkthroughTab's `load` — proven
with an out-of-tree run of the rule at error level, 2 → 0), the dual invitation route surfaces (kept,
W2, with an explanatory comment at the mount point), and the package-level known-gaps count, which is
now a real disclosure listing both provenances (#85's remainder).

The **visual-audit tail** landed in the same batch (`bd37d63`): the dark-theme token lift with
before/after numbers, the light soft-chip darkening, `--node-state` split off `ui`, the disabled-button
and duration formatting fixes, `CodeRef`, and `SettingsShell`. Its measured contrast table is recorded
under **#71**, which is where the "measured, not eyeballed" bar was set.

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

Found and re-verified in UX_AUDIT_FINDINGS.md §18.6 (audit doc survives only in git history — see Bug 74's provenance note).

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
`analysis_jobs`, which already holds the information. See UX_AUDIT_FINDINGS.md §18.7
(git history — see Bug 74's provenance note).

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
UX_AUDIT_FINDINGS.md §19.8 (git history — see Bug 74's provenance note).

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
the detail panel where the user asks for it. See UX_AUDIT_FINDINGS.md §19.7
(git history — see Bug 74's provenance note).

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
pipeline. See UX_AUDIT_FINDINGS.md §19.3 and §19.4 (git history — see Bug 74's provenance note).

---

## [P3][Closed] Bug 84: The Files ⇄ Classes toggle needs two clicks — a tooltip's invisible wrapper eats the first press

**Bug #84**

| Field | Value |
|-------|-------|
| Date created | 2026-07-26 |
| Reported by | M4 live UI verification (`.notes/UI_VERIFY_M4.md` #5, VISUAL QA M4 #5); filed retrospectively during the M5 frontend batch |
| Priority | P3 |
| State | Closed |
| File / area | frontend/src/components/ui/tooltip.tsx, frontend/src/styles.css (surfaced on frontend/src/pages/GraphPage.tsx) |

## Expected behavior

One click on `Classes & interfaces` switches the Dependencies canvas to the class view.

## Actual behavior

The first click restyled the button and left the canvas showing Files; a second click switched it.
Reproduced on OnboardBuddy and FloowForge during the M4 sweep.

## Steps to reproduce

Open `/projects/:id/dependencies`, move the pointer across the header controls (count badge,
Fullscreen, "Show all edges", LR/TB) so a tooltip opens, then click `Classes & interfaces` once, at a
width where the header actions row **wraps to two lines**.

## Notes

**This is filed retrospectively because a fix had already shipped for it in M4 — and that fix did not
work.** It was written from an *inferred* mechanism that was never observed, which is exactly why it
missed. Recording both halves, because the interesting part is the miss.

**The M4 attempt.** `GraphPage.tsx` reasoned that a portalled tooltip was landing on the toggle when
the row wrapped, and added `sideOffset={6}` plus `pointer-events-none` to the four header
`TooltipContent`s, and `flex-nowrap` to the toggle group. The comment left in the file says a
tooltip "can never take a click" as a result. It still could.

**Observed 2026-07-26, live, for the first time.** The inference was right; the fix was on the wrong
element. Radix renders `TooltipPrimitive.Content` *inside* `[data-radix-popper-content-wrapper]` — an
un-classed `position: fixed; z-index: 50` div, with no way to pass it a className, that keeps
`pointer-events: auto`. So the visible tooltip was transparent to the pointer while the invisible box
around it was not. `document.elementFromPoint` at the toggle's centre returned that **DIV**, not the
BUTTON, and a hit scan across the button's whole width returned it at every sample.

The decisive control, on the same button with the same tooltip open: clicking the region the tooltip
covered failed **3/3**; clicking the uncovered region succeeded first time. Purely geometric.
Tallies: unwrapped row — 1 click switches, 6/6 across both projects. Wrapped row — first click a
no-op, **7/7** on OnboardBuddy and **3/3** on FloowForge, confirmed on the canvas (`8 / 8 groups` →
`2 / 2 groups · 5 inheritance links`), not merely on `aria-pressed`. `sideOffset={6}` was irrelevant —
6px is smaller than the gap between wrapped rows. `flex-nowrap` does keep the two buttons together;
it just cannot stop a tooltip landing on them.

**Confirmed fixed, live, after the fix was actually deployed.** Same page, same forced wrap
(`main{max-width:660px}`, actions row 68px = two lines, verified per trial), judged on the canvas:

| Probe | Before | After |
|---|---|---|
| `elementFromPoint` at the toggle centre, badge tooltip covering it | `DIV [data-radix-popper-content-wrapper]` | `BUTTON "Classes & interfaces"` (`el === toggleButton`) |
| Wrapper computed `pointer-events` | `auto` | `none` |
| Wrapper inline `style.pointerEvents` | `""` | `none` |

One-click switches: **5/5 OnboardBuddy** (`8 / 8 groups` → `2 / 2 groups · 5 inheritance links`) and
**3/3 FloowForge** (`6 / 6 groups` → `15 / 15 classes`), each with the covering tooltip verified
open, including the exact left-of-centre spot that failed 3/3 before. Classes → Files: **6/6**.

*Direction asymmetry worth knowing:* in Classes view the header holds only the toggle — no badge,
fullscreen, edges or LR/TB controls — so that row never wraps and no tooltip can cover the toggle.
Classes → Files could never reproduce the condition in the first place.

**No regressions, checked live rather than argued** — the `:has()` scoping holds. The package/commit
`DropdownMenu` opened and **items were actually selected twice**, with
`wrapper.matches(':has(> [data-slot="tooltip-content"])')` → **false** and inline `pointerEvents`
empty. The ranking-weights `Select` opened and **"frontend" was actually selected** (weights
re-projected `25/10/10/25/10/10/10` → `10/20/20/25/5/10/10`); it uses item-aligned positioning and
has no popper wrapper at all. Tooltips still appear on hover and still dismiss.

**Deployment note, found during that verification and worth more than the bug.** `localhost:5173` is
not a Vite dev server — it is `team15-frontend-1`, nginx serving a **static production build baked
into the image** (`frontend/Dockerfile`). There is no HMR. The first measurements reproduced the bug
perfectly against a container built 100 minutes before the fix was written, while the DOM shape
matched every assumption the fix makes — i.e. it was staleness, not a bad selector. **No frontend
change reaches this stack without `docker compose up -d --build frontend`.** Anyone verifying
frontend work here by loading `:5173` is testing whatever was last built, not what is on disk.

**Fixed on the wrapper, and for every tooltip rather than that one control** — any tooltip that
overlaps any control eats a click; this instance only became reproducible because a wrapping header
row happened to put the box over a button. Two layers, both in shared UI code:

- `ui/tooltip.tsx` — `TooltipContent` takes a ref callback that walks to `parentElement` and sets
  `pointerEvents = "none"` on the popper wrapper. Observable from a test, unlike a CSS rule.
- `styles.css` — `[data-radix-popper-content-wrapper]:has(> [data-slot="tooltip-content"])
  { pointer-events: none }`. Scoped with `:has()` on purpose: dropdown-menu, select and the other
  Radix poppers share that wrapper and must stay interactive.

Safe app-wide because no `TooltipContent` in this codebase contains anything clickable — that is a
premise, so it is asserted rather than assumed.

**Severity note, and one honest loose end.** Measured wrap threshold is `main` ≤ 680px, which needs
a viewport under ~676 CSS px with the sidebar expanded — so not a normal desktop, but real at narrow
windows, on mobile, and at high browser zoom (1280 @ 200% = 640 CSS px). P3 rather than P2 for that
reason. The loose end: the M4 sweep recorded this at its normal 1493×812 session width, where the
row should not wrap, while the 2026-07-26 pass got 6/6 first-click successes unwrapped. Either the
M4 session was in a state that widened the row (the Files-view count badge grows with the repo, and
a truncation suffix widens it further) or something else contributed there. The mechanism proven
above is real and is fixed; that width discrepancy is not explained, and is recorded rather than
tidied away.

**Test:** `frontend/src/components/ui/tooltip.interactive.test.tsx`, three assertions. jsdom does no
layout and cannot reproduce a hit test, so it pins the three facts the fix depends on instead —
each one something a future edit could quietly undo:

1. the popper **wrapper** (not just the content) ends up `pointer-events: none` — fails if the fix
   drifts back onto the inner element, which is exactly how M4 got it wrong;
2. a `Select` still opens **and accepts a click on an option**, with its wrapper untouched — the
   regression the `:has()` scoping guards, since select and dropdown-menu share that wrapper;
3. no `TooltipContent` anywhere in `src/**/*.tsx` contains a button, link or `onClick` — the premise
   that makes the fix safe app-wide, asserted rather than assumed.

---

## [P4][Closed] Bug 85: Two "known gaps" numbers on one screen, neither saying what it counted

**Bug #85**

| Field | Value |
|-------|-------|
| Date created | 2026-07-26 |
| Reported by | M4 live UI verification (`.notes/UI_VERIFY_M4.md` #9 and "still broken" #6); filed retrospectively during the M5 frontend batch |
| Priority | P4 |
| State | Closed |
| File / area | frontend/src/pages/OnboardingPage.tsx |

## Expected behavior

Every gap count on the reader states the population it counted, so two different numbers on one
screen do not read as a contradiction.

## Actual behavior

The sticky trust strip said **"66 known gaps"** while a section footer on the same screen said
**"6 known gaps"**. Both were correct — the strip counts the package, the footer counts that section
— but neither said so, so one word described two populations.

## Steps to reproduce

Open a package in the reader (`/projects/:id/onboarding?view=reader`) and compare the sticky strip
with a section footer.

## Notes

**Fixed in M4; re-verified live 2026-07-26 and confirmed to read clearly.** Filed retrospectively so
the tracker carries the finding and its verification rather than only the code comments.

Both labels now name their scope, and the strip's tooltip explicitly cross-references the section
label. Verified with both on screen simultaneously:

| Where | Rendered text |
|---|---|
| Strip (OnboardBuddy) | `82 known gaps in this package` |
| Section 9 | `5 known gaps in this section · 1 kinds` |
| Section 1 | `1 known gap in this section` |
| Strip (FloowForge) | `42 known gaps in this package` |
| Section 1 (FloowForge) | `5 known gaps in this section · 3 kinds` |

- **No truncation at any width.** The strip span's `scrollWidth == clientWidth` (162px) from 900 down
  to 300 CSS px; its container is `flex flex-wrap` with `overflow: visible`, so it wraps to a second
  line rather than ellipsizing. Both scope words survive.
- **The strip tooltip reconciles the two numbers in words**: "82 things this analysis knows it could
  not determine, across the whole package: 71 raised while writing the sections (each section lists
  its own share under *known gaps in this section*; grouped into 14 kinds in total) and 11 found by
  detection."
- (The count is 82, not the 66 recorded in M4, because the package was regenerated at `main@9f4d168`.)

**One defect found by this verification and fixed here:** the "kinds" suffix did not pluralise —
`· 1 kinds`. The gap noun did (`1 known gap` / `5 known gaps`); the suffix was a bare template. Now
`1 kind` / `3 kinds`.

**Carried forward, not fixed:** the strip number is still a hover/focus `cursor-help` span (a Radix
tooltip trigger with `tabindex="0"`), not a clickable disclosure — while the section number is a real
`<button>` with `aria-expanded` that expands the gap list. The M4 note calls this out: the counted
*affordances* live only at the section footer. Making the package-level number a disclosure too is a
reader-navigation change, not an error-state one; it belongs to the #74 polish tail.

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
