# Milestone 4 — Test Plan

How to validate M4. Follow the parts in order; each **Test** is a numbered table of *do this → you
should see this*. Nothing here needs you to read code.

**Two formatting conventions, so you can skim:**

> ℹ️ **Blue-labelled blockquotes are context** — why a test exists or what it is really checking. Skip
> them if you just want to click through.

> ⚠️ **Warning-labelled blockquotes are known bugs** — already filed, with the issue number. If you hit
> the described behaviour, it is expected, not a new find.

**Time budget**

| Part | What | Time |
|------|------|-----:|
| **0** | Automated tests — one command | 3 min |
| **1** | Get the app running | 5 min |
| **2** | Import and analyse a repository | 10 min |
| **3** | The onboarding handbook *(the main M4 deliverable)* | 10 min |
| **4** | Trust and transparency | 5 min |
| **5** | Multiple analyses per project | 5 min |
| **6** | Security mitigations | 5 min |
| **7** | Everything else — graphs, settings, account, help | 10 min |
| | **Total** | **~50 min** |

Parts 0–4 are the core. Parts 5–7 are optional if you are short on time.

---

# Part 0 · Automated tests

**Test 0.1 — run every automated test**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | From the repo root: `docker compose -f docker-compose.test.yml run --rm test` | Both suites scroll past, then a **per-area summary table** — how many tests passed in each part of the system — ending in `Overall: PASS`. Exit code 0. |

The table is the quickest way to see what is covered where:

```text
  AREA                                                  PASSED   FAILED  SKIPPED    RESULT
  ────────────────────────────────────────────────────────────────────────────────────────
  Backend · security (hostile input)                        83        0        0      PASS
  Backend · analysis pipeline                              276        0        0      PASS
  Backend · AI, caching & model routing                    100        0        0      PASS
  Backend · document generation                            188        0        0      PASS
  Backend · API & auth (HTTP)                              149        0        0      PASS
  Backend · unit (libs, queue, crypto)                      23        0        0      PASS
  Frontend · unit (components, pages, safe rendering)      164        0        0      PASS
  E2E · Playwright (browser)                                 0        0        9   SKIPPED
  ────────────────────────────────────────────────────────────────────────────────────────
  TOTAL                                                    984        0        9      PASS
```

Every number is parsed from the runners' own machine-readable output, not written down anywhere — see
[TESTING.md → Run everything](./TESTING.md#run-everything). If any area fails, that row says `FAIL`,
the failing tests are listed with their file and message, and the command exits 1. E2E is honestly
reported as skipped because the test image has no browser; `RUN_E2E=1 npm test` runs it for real on a
machine that does.

Nothing else is required — no `.env`, no cloud accounts, no running app. First run builds the image
(1–2 min); after that it is cached — add `--build` if you have run an older version before.

**Test 0.2 — security evidence report** *(optional, 1 min)*

| # | Do this | You should see |
|---|---------|----------------|
| 1 | `npm run security:report -w backend` | A verdict for each of 10 attack payloads, all passing, exit code 0 |

> ℹ️ **What this is** — it runs our real document-generation code over a deliberately malicious sample
> repository and prints the actual prompt sent and the actual output stored for each attack. It exits
> non-zero if a defence regresses, so it doubles as a CI gate. Output is committed at
> [SECURITY_TEST_EVIDENCE.md](./SECURITY_TEST_EVIDENCE.md).

What all 984 tests cover and why: [TESTING.md](./TESTING.md).

---

# Part 1 · Get the app running

**Test 1.1 — start the stack**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Put `backend/.env`, `frontend/.env` and `backend/github-app.pem` (all on Canvas) in place. **Both `.env` files must exist before building.** | — |
| 2 | `docker compose up --build` | `OnboardBuddy API listening on http://localhost:3000`, and two `listening on queue …` lines from the worker |
| 3 | Open http://localhost:3000/api/health | `{"status":"ok","service":"onboardbuddy-api"}` |
| 4 | Open http://localhost:5173 | The landing page |

> ℹ️ `IMPORTANT! Eviction policy is optimistic-volatile` in the worker log is a notice from our Redis
> provider, not an error.

**Test 1.2 — sign in**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Sign up with an email and a password of 8+ characters, or use the demo account from the Canvas note | Dashboard, with a first-run tour |
| 2 | **Account Settings → Connect GitHub**, authorise the App | GitHub shows as connected, with your `@username` |

**What you need to analyse:** fork https://github.com/KuanKongy/CourseInsights (a CPSC 310 project)
into your own account, and install the OnboardBuddy GitHub App on it during import. Use your own fork
— Part 5 needs push access.

---

# Part 2 · Import and analyse a repository

**Test 2.1 — import**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Dashboard → **Import repository** | Installation picker, then repository, branch and role |
| 2 | Pick your fork, a branch, and a role → **Create project** | The project overview opens |

> ⚠️ **Known issue #67** — if the App is installed on more than 100 repositories, or the repository has
> more than 30 branches, the pickers cannot reach past that. They are not paginated yet.

**Test 2.2 — cost preview before spending**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | **Analyze…** | A dialog with scope, branch and commit selectors |
| 2 | Expand **"What gets sent to the AI?"** | The project's current privacy mode and what it means |
| 3 | Click **Preview first** | File count, approximate symbols and AI calls, a cost tier, and a privacy summary — before anything is spent |

**Test 2.3 — run an analysis and watch it**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | **Start analysis** | Progress begins and **never moves backwards**: "Analyzing code" 0–70%, then "Generating onboarding" 70–100% |
| 2 | Watch the list below the bar | The current step with a spinner, completed steps with ticks and timestamps, and a ticking "last worker activity Xs ago" |
| 3 | Click **Pause**, then **Resume** | Pause takes effect at the next step boundary; resume continues without redoing finished work |
| 4 | When it completes, expand **Pipeline phases & spend** | Per-phase timings, and total AI calls / tokens / approximate cost |
| 5 | Hover a phase row | A description of what that phase does |

> ℹ️ **Expected timings.** Our own repository (2.3M tokens, 268 files) is the worst case we benchmark:
> **6:41 end-to-end cold, ~$0.36**, against a 10-minute target. A small repository is ~3:40.
> CourseInsights sits between them. The per-phase timings above are how you tell a slow run from a
> stuck one.

---

# Part 3 · The onboarding handbook

> ℹ️ **This is the main M4 deliverable.** At M3 a package was 11 short sections that each pointed at a
> tab — 7,500 words for a large repository, with no guidance on what to read first. It is now 12
> sections in four chapters, 13,800 words on the same repository, and the lookup tables are generated
> from code facts rather than written by the AI.

**Test 3.1 — chapters and reading order**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | **Your Onboarding** → open the package card | The reader, with the sidebar grouped under **Orient / Understand / Do / Consult**, each with a one-line description |
| 2 | Count the sections | 12 |
| 3 | Look at the **"Suggested for you"** rail | The next three *unread* sections in your role's order. Read one — the rail advances. |
| 4 | Open any section | It starts with a **TL;DR** callout |

**Test 3.2 — the lookup tables are exact** *(the highest-value check in this part)*

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Open **Routes & jobs** (Consult) | A table of API routes with **full paths** (e.g. `/api/projects/:id/analyze`, not `/analyze`) and background job types |
| 2 | Pick two rows and check them against the repository | They match exactly |
| 3 | Open **Data model** | Database tables with their foreign-key relationships |
| 4 | Open **Guardrails & ops** | Environment variables and operational guardrails |

> ℹ️ **Why this matters.** These four tables are built deterministically from the code and only
> *annotated* by the AI — it cannot invent a route or a column. At M3 the AI was asked to produce these
> lists from retrieved snippets, and the paths it produced did not exist (bug #58). This test is
> checking that the fix holds.

**Test 3.3 — the practical chapter**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Open **Setup & run** and **Your first change** (Do) | Imperative, followable steps — real commands and file paths, not description |
| 2 | Open **Common tasks** | Recipes derived from this specific repository |

**Test 3.4 — export**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | **Export** | A Markdown file downloads, with chapter headings in the same order as the sidebar |

> ℹ️ **Older packages still work.** A package generated before the M4 redesign opens normally, with its
> sections under a "Previous layout" group.

---

# Part 4 · Trust and transparency

> ℹ️ **What this part checks.** The product's claim is that every statement is backed by code. M4 made
> that claim auditable. This part is you auditing it.

**Test 4.1 — follow a claim to the code**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Find a citation chip inside a section's prose | It sits **at the claim it supports** — not as a raw marker like `[R3]`, and not only in a list at the bottom |
| 2 | Click it | The file, the line range, a scrollable code snippet, and a summary of what that code does |
| 3 | Click **View on GitHub** | The exact file and line range on GitHub, pinned to the analysed commit — check the commit hash in the URL |

**Test 4.2 — honest confidence**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Read the coverage strip under a section title | How much of the section is receipt-backed, and a "known unknowns" tooltip |
| 2 | Hover the confidence badge | A stated **reason**, not just High/Medium/Low |
| 3 | Look for an "unverified" marker | Where a claim could not be verified, it says so inline — the claim was neither deleted nor silently asserted |
| 4 | Open **How this was made** | Model used, retrieval statistics, tokens and cost, and the verification verdicts for that section |

**Test 4.3 — ask a question**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Open the **Ask** panel and ask "where is authentication handled?" | An answer citing receipts you can click through to real code |
| 2 | Ask something the repository cannot answer, e.g. "what is the deploy password?" | It says it does not know — no invented answer |

**Test 4.4 — staleness is real**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Push a commit to your fork that deletes a function cited in a section | — |
| 2 | **Analyze…** → Start | The run reports "N files changed · N symbols changed · N sections stale" |
| 3 | Reopen the section that cited it | A **Stale** badge; the receipt no longer claims to be current |
| 4 | Click **Regenerate** on that section | It rebuilds against the newest commit and the badge clears |
| 5 | Push a whitespace-only change and re-analyse | **Nothing** goes stale |

> ℹ️ **Step 5 is the real test.** Marking everything stale on every push is easy; marking only what
> actually changed is the hard part, and it is what lets a team re-analyse often.

---

# Part 5 · Multiple analyses per project

> ℹ️ **Why this changed.** At M3 a project behaved as if one repository meant one commit — generating a
> new package silently overwrote what everyone was reading, and only one analysis could run at a time.
> This came directly out of M3 feedback.

**Test 5.1 — concurrent analyses**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | **Analyze…** and start a run | It begins |
| 2 | Without waiting, **Analyze…** again with a **different** branch or commit and start it | It also begins — **no error**. Both appear under "Active runs" with their own progress |
| 3 | **Analyze…** a third time with the **same** target as a running job | Rejected, with a link to the run already in progress |

**Test 5.2 — choose what you read**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Generate packages from both analyses | Two package cards, both intact — the second did not overwrite the first |
| 2 | Use the **package selector** in the project header to switch | Architecture, Dependencies, Workflows, Capabilities, Tutorials and the reader all follow your choice |
| 3 | Click the **star** on a package to make it your default | It is remembered for you |
| 4 | Sign in as a different member of the same project | Their default is unaffected by yours |
| 5 | **Overview → Run history** | Every past run with its configuration, duration, cost, and how many sections were generated versus reused from cache |

**Test 5.3 — re-running is cheap** *(the cost story)*

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Regenerate a package without changing the repository | Most sections and all tutorials report **cache hits**; the cost in Run history is a fraction of the first run |

**Test 5.4 — automatic re-analysis on push** *(optional — needs a webhook secret and a tunnel)*

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Without a webhook secret set: `curl -i -X POST localhost:3000/api/webhooks/github` | **503** — the feature is simply off, nothing else affected |
| 2 | With a secret set, enable **Settings → Automation → Re-analyze on push**, then push a commit | An analysis starts on its own |
| 3 | Re-deliver the same webhook from GitHub's UI | No duplicate run |

Setup for step 2 is in [DEVOPS.md](./DEVOPS.md) → "GitHub App webhook". Skip this test if you would
rather not configure a tunnel.

---

# Part 6 · Security mitigations

> ℹ️ **What was found and fixed.** The full assessment is
> [SECURITY_XSS_PROMPT_INJECTION.md](./SECURITY_XSS_PROMPT_INJECTION.md) — 22 input points, 9 findings,
> all closed. These four tests re-check the fixes by hand. Part 0.2 covers the prompt-injection half
> automatically.

**Test 6.1 — script in a stored text field**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Set your display name to `<img src=x onerror="document.title='PWNED'">MARK` and save | It renders as **literal text** in the sidebar and account card; the browser tab title does **not** change |

**Test 6.2 — security headers are actually served**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | DevTools → Network → reload → check response headers on `/`, `/index.html`, `/bootstrap.js`, and any `/assets/*.js` | **All four** carry `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |

> ℹ️ **Why all four paths.** nginx does not merge headers across configuration levels — a per-path rule
> silently discards inherited headers. Our first attempt would have served the JavaScript bundles with
> no policy at all while `curl /` looked perfect. This test is guarding against exactly that.

**Test 6.3 — the policy is enforced, not just present**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | In the console: `document.body.appendChild(Object.assign(document.createElement('script'),{textContent:"window.x=1"}))` | **Blocked**, a CSP violation is logged, and `window.x` is `undefined` |
| 2 | In the console: `new Image().src='https://example.com/favicon.ico'` | **Blocked** — not an allowed image host |
| 3 | Confirm a GitHub avatar still loads | It does — the policy is an allowlist, not a blanket block |

**Test 6.4 — avatar URL allowlist**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Account Settings → set your avatar URL to `https://example.com/x.png` | **Rejected** — only allowlisted hosts are accepted |

---

# Part 7 · Everything else

**Test 7.1 — the four maps**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | **Architecture** | Subsystem clusters with criticality bars; click one for its summary (labelled AI or deterministic) and file list |
| 2 | **Dependencies** | A file map with search; click a node for a symbol summary, signature, a real usage example, and receipts |
| 3 | Click legend entries | Hidden kinds dim rather than disappear |
| 4 | Toggle layout direction, then fullscreen (Escape exits) | The graph refits both times — nothing clipped or off-screen |
| 5 | Drill into a cluster, then press browser **Back** | Back walks the drill path one level at a time; the breadcrumb and "Up one level" both work |
| 6 | Tab to a node and press **Enter** | The detail panel opens — keyboard selection works |
| 7 | **Workflows** | Traced flows and end-to-end journeys; the final step is a **terminal** node, not an edge looping back to the start |
| 8 | **Capabilities** | What the product does, linked to the flows and components that deliver it |
| 9 | **Tutorials** | A step pager with real code, an explanation and receipts at each stop |

> ⚠️ **Known issue #70** — in the grouped Dependencies view every directory reads "imported by 0"
> (drilling in shows correct counts), and searching updates the match count without moving the camera,
> so the canvas can look blank. Both filed, both first-batch M5.

**Test 7.2 — settings and privacy**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Project **Settings** | Privacy mode, analysis depth, spend budget and stop behaviour, analysis model, API key, ranking weights, ignored paths, limits, automation |
| 2 | **Analysis model** | **Auto (default)** plus three named models. On Auto, the run panel names which model was picked and why |
| 3 | Set privacy to **AI disabled** and re-analyse | It completes and **still produces a full 12-section package** from code facts alone, with an "AI explanations are off" banner |
| 4 | Add a project API key | Shows "Key configured by \<email\>" — the value is never displayed again |
| 5 | Move a ranking-weight slider → Save | Applies immediately with no re-analysis; **Revert to defaults** restores |

> ℹ️ **Step 3 is a deliberate design position** — privacy mode decides *how* a document is written,
> never how much the product knows. At M3 the AI-disabled path produced a visibly thinner document from
> the same analysis (bug #55).

**Test 7.3 — permissions**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | **Team** → invite a second account as **Developer** | The invitation is created and appears on their Invitations page |
| 2 | As that Developer, open the project | Can read everything and generate a missing role's package; **cannot** re-run analysis or approve sections |
| 3 | As the Developer, mark sections **read** | Personal reading progress tracks — separate from the owner/admin "Mark reviewed" |

> ⚠️ **Known issue #72** — no invitation email is sent (share the link yourself), Decline is disabled,
> there is no "Leave project", and ownership cannot be transferred. All filed, M5 batch 5.

**Test 7.4 — account management**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Sign out → **Forgot password** → submit your email | Confirmation that a reset link was sent |
| 2 | Open the link, set a new password, sign in | Works. An **expired** link says so rather than spinning forever |
| 3 | Account Settings → change display name and avatar | Both update in the sidebar and account card |
| 4 | **Disconnect GitHub** | Confirm dialog, then disconnected; reconnecting works |
| 5 | **Delete account** with type-to-confirm *(use a throwaway account)* | Account and its project data are removed; you are signed out |

**Test 7.5 — help, keyboard and appearance**

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Press `?` | A shortcuts dialog |
| 2 | Press `[` / `]` and `1`–`9` in a project | Moves between tabs and tutorial steps |
| 3 | Type into a text field and press `]` | The character is typed — shortcuts are correctly suppressed while typing |
| 4 | Open **/help** | A tour picker, a 9-question FAQ, and a privacy section that matches the project's real privacy mode |
| 5 | **Account Settings → Appearance** → Large | The whole app scales; reload and the choice survives with no flash |
| 6 | Change your OS colour scheme without touching the theme toggle | The app follows it. Click the toggle once → it pins your choice and stops following |
| 7 | Toggle dark/light on every tab | Everything stays legible; graphs recolour |

> ⚠️ **Known issue #71** — in **dark theme** specifically, card and input borders are too faint against
> their background (measured, filed), and coloured avatar initials are low-contrast. Light theme was
> fixed in M4; dark theme is M5 batch 4.

**Test 7.6 — resilience** *(optional)*

| # | Do this | You should see |
|---|---------|----------------|
| 1 | Start an analysis, then `docker compose restart backend-worker` mid-run | The run is reconciled to a failed/stalled state with an honest message — it does not animate over a dead worker. **Resume** picks up from where it stopped |
| 2 | Set an unreachably low spend budget and run an analysis | The **job** fails with a budget message; the worker stays up and keeps serving other jobs |

---

# Reporting anything you find

Please note the page, what you did, what you expected, and what happened. Known bugs are listed with
priorities and owners in [BUGS_AND_FIXES.md](./BUGS_AND_FIXES.md) — its roll-up table shows all 26 open
items, and the M5 plan commits every one of them to a fix or an explicit won't-fix before the final
release.
