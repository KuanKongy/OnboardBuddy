Nam is currently working on:
Read the repo, code. The issue: right now projects are based on user + repo, packages are based on user+repo+branch+commit+role+scope, other features like architecture, dependency, capabilities, workflows, tutorials are all connected to the package, so when you generate new package, those features get overwritten as top to be retrieved and you can swtich them, even through previous package is available. I want to rework UI/UX of project dashboard to be based on different branch/scope/commit, as right now it uses old design that assumed one commit=one project. And you could only have one package, whereas you now could have several. New design should know that there may be several generations running at the same time. Meaning you will also have to rework analysis status. You will also have to remove role chooser in tutorial tab. What I mostly don't like about project overview is that you can only have one unchangable branch/scope/commit unless you overwrite it by generating new package. You should be able to change it and choose default package. Can you also fix analysis status snapshots, I want to open the previous runs, scroll and see it. Actions taken, generated section or whole package. See the whole cost. Also, when you drill down in dependency graph, you don'y have a button to come back, drill up.

Scalability (configuration of limit), efficiency; large repo graph scaling
Webhook: on push commit in github, re-analyse (not on by default, turn on in settings) - make sure to consider Git concurrency (updated when analysing and other cases)
UI hover that highlight line in code snippets
AI disabled - more thorough generation of package, maybe give the same evidence that would’ve been given to Full AI version and more polished package for understanding.
Reviewed button in onboarding is not intuitive that it should be clicked for review, maybe add to the tour or make the button puffy.
Tie dark/light theme of app to browser’s current theme
In the dependency graph, it is not intuitive that you clicked on a node and how to get out. So animation of zooming in/out of nodes.
Keyboard hotkeys, to change tabs, move nodes/steps in tutorial, think of where is useful
Introduce option in account settings to disconnect GitHub, delete account, change name, avatar. Also, add the option in “sign in/out” for “forgot the password” to reset password. Also in “sign in/on” add the option to go back to the intro page. Change transfer page functions, if you are signed in, when on intro you don’t get transferred to dashboard, but when clicked/on sign in/on page, you get transferred.

Chat to create tutorial, ask navigation on package; RAG on dashboard



M4 (Red is questionable addition) (Blue means research):
XSS Security, Documentation, Bug list, Test coverage:

UI Polish/UX/Quality of Life:
- Remove sensitive info, guarantee won't be used to train
- Transparency about privacy
- Dependency graph placement/size; cluttered; config; back/accent colour
- Lot of dead space; pagination and subject groupings for pages
- Code snippet, linking (to code or render in app)
- Have those hyperlinks after each claim
- Usability: tours (choose tour), FAQ, font size
- What is analysis complete? Complexity, coverage, test
- Ranking, config
- Sequence diagram, dataflow diagram, user stories, usage stories
- Change package/edit
- Write data to folder to be smarter
- Own API Key
- Windsurf Code Maps: execution flow, component relationship
- Our task is to replace or supplement documentation
- Responsiveness, speed, status
- Different branch, scope, config
- AI Providers expansion, config


Bug fixes:
- In GitHub issues
- What happens when I regenerate the thing I'm currently generating?
- Lost access to GitHub app, should have refresh token
- Refresh query doesn’t refresh repos
- Bug in analysis run tooltip shows results, shouldn’t do that
Preflight preview


Validation/Onboarding Quality (Blue means research):
- Building on the above, I'm unclear on what steps are in place to prevent onboarding packages from being largely different from each other. This could create friction between employees onboarded at different times i.e. with different versions of the repositories if the packages are highly different. In essence, what measures are in place to stop the LLMs' stochasticity to produce largely different (even if accurate in substance) summaries?
- A more general endpoint is easily followed when actually performing tasks. A dummy starter task might also be helpful when onboarding.
- More thorough tutorial
- Why have a ranking of importance in an onboarding doc?
- Clarity/transparency: confidence (clear trust signals)
- Adhering to a format that developers are familiar with will improve it to (i.e. one-line summary, parameters (and any types), returns)
- Onboarding package is graphs and step by step workflows. Explain process and reason behind process. Show code, examples, example usage
- Overwhelming amount of info
- Show what the specific file is doing, what a function does, what sequence of functions it uses to produce result
- Input your responsibility, exercise.
- Flag outdated documentation

Harder tasks/testing:
- Scope testing (result scalability): microservice
- Multiple languages/frameworks
- Workflow detection should be a Call graph
- Accuracy (dependency[imports, module], then functions, then call graph) - file detection
- Hallucination prevention
- Level of sophistication, Technical jargon
300k 5min
2m 10min

M5 (Orange is in the plan):
Maybe:
Maybe just have a single github connection on signup if you are using it, instead of having to connect to your github when adding the repo and signing up.
Stretch: BitBucket, Confluent, Notion, local/bedrock/enterprise models, other providers.
Deployment


---

# Status of the M4 working documents (written 2026-07-25, end of sprint)

Everything above is the plan as written at the start of M4. This section records **where each working
document actually ended up**, so nothing is assumed done that isn't. Verified against source on
2026-07-25, not from memory.

| Document | What it is | Status |
| --- | --- | --- |
| `UX_AUDIT_FINDINGS.md` | 73 functional findings | **Not started** — 0 of 73 done |
| `UX_VISUAL_AUDIT.md` | 20 visual/contrast findings | **Not started** — 1 of 20 done, incidentally |
| `SECURITY_XSS_PROMPT_INJECTION.md` | 9 security findings | **Complete** — 9 of 9 mitigated and verified |
| `SECURITY_TEST_EVIDENCE.md` | generated evidence | **Live** — regenerates from code, CI gate |
| `ONBOARDING_UX_GOALS.md` | the content bar | **Met** — 19 of 19 golden checks |
| `ONBOARDING_QUALITY_LATENCY_PLAN.md` | the architecture plan | **Complete** — all 7 steps, latency gate passed |
| `ONBOARDING_FIX_IMPLEMENTATION.md` | implementation log | **Complete** — 21 items; 1 superseded, not skipped |
| `ONBOARDING_UX_VALIDATION.md` | 16 prioritised content fixes | **Complete** — 16 of 16 addressed |
| `DETECTION_COVERAGE.md` | detector taxonomy + gaps | **P0 + P1 done, P2 not started** |

---

## 1. The two UX audits — re-run 2026-07-25; nothing from the previous edition implemented

> **Update 2026-07-25.** Both audit documents were **re-run from scratch** against the live stack as a
> Developer-tier member on the real dogfood package, with contrast measured from rendered tokens, counts
> queried from the database, and every questionable design traced to its rationale in the repo before
> being called a defect. Both files were rewritten:
> [UX_AUDIT_FINDINGS.md](./UX_AUDIT_FINDINGS.md) (43 findings + 12 verified strengths) and
> [UX_VISUAL_AUDIT.md](./UX_VISUAL_AUDIT.md) (21 findings + 10 strengths, incl. a real 390×844 phone run).
>
> **The new pass found a class of problem the July-22 audits missed entirely:** the trust layer
> contradicts itself. Confidence labels are *inversely* correlated with evidence — the only two sections
> carrying receipts are the only two rated `low`, while three sections rated `high` carry none. That is
> now the top-priority item in either document, and it invalidated two claims in our own README (since
> corrected). See [UX_AUDIT_FINDINGS.md §1](./UX_AUDIT_FINDINGS.md#1-the-trust-layer-contradicts-itself--start-here).
>
> **Also newly found:** a Developer is shown a `Regenerate…` action the API forbids (the symptom was
> patched in M4, not the cause); `Sign Out` sits inside the "Danger Zone" beside `Delete account` and
> exists nowhere else; the architecture legend promises a colour→category mapping that the palette
> cannot deliver (12 kinds, 7 colours, 5 collisions — source-verified); and the reader's phone test has
> been failing on a **pre-Diátaxis section title** since the M4 content rebuild, so the product's main
> content surface has had **no mobile coverage** since then.
>
> **Verified strengths worth protecting** (an audit that only lists defects gives no signal about what
> not to break): the receipt viewer, the Capabilities tab, the "Suggested for you" blurbs, the expanded
> run row, confidence-with-a-reason, the provenance panel, the login form, and a registration flow that
> takes **2 clicks and 2 fields** — leaner than most comparable products and not to be "improved".

### Status of the July-22 edition — nothing implemented

**Both documents are dated 2026-07-22 and neither has been worked.** 93 findings total (73 functional
+ 20 visual). They were written at the *end* of the sprint, after which the remaining time went to the
onboarding rebuild and the security work — so this is a backlog we created deliberately and then did
not get to, not one we lost track of.

Verified open on 2026-07-25 by checking source, not by recollection:

| Section | Findings | Spot-checked and still open |
| --- | --- | --- |
| A — Security & tenant isolation | 8 | All 4 HIGH: three routes look up child objects by id with no project scoping; `POST /api/auth/signup` still auto-confirms any email. Plus: invitation tier unvalidated, no rate limiting, invitations inserted with no `expires_at`. |
| B — Onboarding data-state | 3 | `fetchOnboardingPackage` still swallows all errors → a failed fetch still renders "no package — Generate". Regeneration poll still leaks past unmount. |
| C — Import & GitHub flow | 6 | Preflight acknowledgment checkbox still frozen; repo/branch listings still unpaginated; orphan reconciler still only rescues `running` jobs; `attempts: 2` still a no-op. |
| D — Auth & account flow | 6 | Reset page still never reads the expired-link error → infinite spinner. GitHub sign-in still drops the deep link. **Zero `autoComplete` attributes** on any of the four auth pages. |
| E — Invitations & team | 6 | No decline endpoint, no leave-project, no ownership transfer, no email. |
| F — Graph & architecture | 8 | Directory groups still hardcode `dependentCount: 0`. Search still doesn't recenter. No `AbortController` in `WorkflowsPage`. Dead commented code still in `ModuleNode.tsx`. |
| G — Accessibility & keyboard | 11 | **Zero `document.title` calls in the whole frontend.** No skip-to-content anchor. `role="status"` on spinners in 1 page out of ~14. No `prefers-reduced-motion` anywhere. |
| H — Error handling & lifecycle | 8 | Global error handler still ignores `err.status`. No UUID param validation → non-UUID id still 500s. No shared 401 handler in `api.ts`. |
| I — Deployment, perf, polish | 5 | **One fixed** (see below). API origin still baked into the bundle. No `compression()` middleware. No `<meta name="description">`. |
| J — Copy & terminology | 4 | The import action still has **five** different labels in the UI ("Add Project", "Add New Repository", "Import Repository", "Import repository", "Import a repository"). |
| Visual audit | 20 | Both HIGH items open: dark-theme structural contrast measures 1.09–1.56 against a 3.0 threshold; avatar initials measure 2.15–2.54. |

**The one exception:** `I3` (nginx `gzip` + `Cache-Control` on `index.html` and hashed assets) is done —
picked up as a side effect of building the Content-Security-Policy, since that work rewrote the same
nginx config. It was not deliberate audit follow-up.

**A number that will confuse anyone reading both:** Eugene's six-phase UI/UX workstream closed
**93 findings** during M4, and these two audits also total **93 findings**. Different sets — the audits
explicitly excluded anything the six phases had already fixed. The coincidence is not meaningful.

**Where this backlog now lives:** batched into bug tracker issues **#65–#74** in
`BUGS_AND_FIXES.md` — 9 issues covering the ~20 findings that matter, plus **#74** as a single tracker
for the 49-item low-severity tail. The M5 plan sequences them, tenant isolation first.

---

## 2. Security / XSS — complete

**All 9 findings mitigated, verified, and defended by tests.** This is the only workstream in M4 that
finished cleanly.

- 3 High (no CSP, no untrusted-data boundary in prompts, unsanitised model output), 3 Medium, 3 Low.
- Fixed at three independent layers so no single one has to hold: a prompt boundary, sanitisation that
  does not depend on the model behaving, and a CSP behind both.
- **83 automated tests** now cover these paths, and the tests deliberately simulate an AI that has
  already been compromised.
- The CSP was verified **in a real browser against the production build**, not asserted from config.
- `SECURITY_TEST_EVIDENCE.md` is generated by `npm run security:report -w backend`, which exits
  non-zero on regression — so it is a CI gate, not a document that can quietly go stale.

**Two things worth carrying forward rather than filing as done:**

1. **Fixing this introduced three defects of our own**, all caught by the new tests before merge — one
   would have broken every repository import in production (bug #64). The reason it was caught is that
   the security suite runs inside the deployment image in CI. Keep it that way.
2. **Residual risk is documented, not solved** (§7.5 of the report). A prompt boundary is best-effort;
   sanitisation cannot detect an *omission*, and one of our own payloads asks the model to leave out a
   real finding. A generated onboarding document is not a security review of the repository it
   describes, and we should not let that claim drift.

---

## 3. The four onboarding documents — goals met

These four are a chain: **goals** define the bar, **plan** designs for it, **implementation** logs the
work, **validation** audits the result. All four closed.

### `ONBOARDING_UX_GOALS.md` — the bar. **Met.**

The bar was that a new developer can name and trace the product's core user journeys within minutes of
reading, with OnboardBuddy itself as the permanent golden test repository.

- **All four golden journeys extract** (auth, repo import, analysis→generation across both queues,
  local dev/test) — all four were missing or fragmented before this sprint.
- **Golden gate: 5 passes, 0 gaps.** Honesty holding: 2 trace dead-ends recorded, 10 unmodelled
  packages declared rather than silently dropped.
- **Step-6 audit: 17/19 automated golden checks**, and both misses were fixed the same day → **19/19**.
  Worth noting *why* they missed: both were narration-layer failures over clean extraction — the data
  was right and the prose under-used it. The fixes worked by handing the section its ranked data plus a
  mechanical gate, not by asking the prompt more loudly.

### `ONBOARDING_QUALITY_LATENCY_PLAN.md` — the plan. **Complete.**

All seven sequencing steps (0–6) done. Measured outcomes against the targets written in this file:

| Target | Result |
| --- | --- |
| 2M-token repo ≤ 10 min | **6:41** end-to-end, cold, two repos concurrently on one worker |
| Beat a timed Claude agent + 2 min grace (8:16) | **PASS** |
| Content depth | 7,500 → **13,800 words** on the same repository |
| Cost | **$0.36** per cold run; ~$0.13 for a re-run |
| Warm regeneration | 10/12 sections + 4/4 tutorials cache-hit ⇒ ~6 model calls instead of ~30 |

**One documented deviation:** no output sharding. At measured decode speed the largest section fits a
single call, so it was deferred rather than built — recorded in the plan, not quietly dropped.

### `ONBOARDING_FIX_IMPLEMENTATION.md` — implementation. **Complete, with one item superseded.**

21 numbered items across two sessions plus the latency overhaul, each verified end-to-end on the
dogfood repository.

**The one item logged as "still not done" was `§8` IA restructuring** — collapsing 11 sections into
5–6. It was blocked at the time by a database `CHECK` constraint on `package_sections.type` under a
no-live-ALTER rule. **The Diátaxis redesign superseded it:** the section list was replaced wholesale
with 12 chaptered types and the constraint updated with it. So the intent shipped in a better form than
the original item described. Nothing from this document is outstanding.

### `ONBOARDING_UX_VALIDATION.md` — the audit. **16 of 16 addressed.**

| Priority | Items | Status |
| --- | --- | --- |
| **P0** — trust integrity | 6 | **All done.** Citation aliases → inline chips; hardcoded staleness/age removed; fixtures out of the evidence stream; full route paths; deterministic facts injected rather than asked; ranking damped and gated. |
| **P1** — content quality | 6 | **All done.** Section specs rewritten; voice contract + lint; coverage strip with real denominators; confidence-with-reason; receipt re-anchoring + span caps; diagram rules; inline "unverified" markers. |
| **P2** — the "senior-engineer wow" | 4 | **All addressed.** Provenance panel; grounded Q&A surfaced in the reader; analysis-pipeline tutorial (now a journey tutorial); first-change framing per role. *Partial:* "named step rails" from item 15 was not built as a distinct feature — role reading order covers the intent. |

---

## 4. `DETECTION_COVERAGE.md` — P0 and P1 done, P2 untouched

Of **34 pattern families** catalogued: **23 detected** (15 pre-existing, 8 added this sprint),
**6 unproven**, **5 not supported**.

**P0 — correctness for this repository's journeys: all shipped.** Consumer detection unified (the root
cause was handler *references* — `new Worker(Q, processJob)` — which killed the trace at one step and
made a whole subsystem look empty); auth/identity SDK sinks; queue-boundary stitching; and the honesty
rule.

**P1 — DevOps and dev-workflow: shipped, with one gap.** Compose, Dockerfile, package scripts and CI
now extract as flows; topology diagram; environment reference read from `.env.example` names (never
values). **Not done: frontend→API call edges** — a page calling `apiFetch('/projects/…')` does not yet
link to the route it hits, so UI cannot be stitched into a journey. Also open: `enqueues_job → consumer`
as a traversable hop (the journey composer works around this with queue-token matching), and
`route → middleware` chains for per-route auth visibility.

**P2 — breadth for other repositories: not started.** ORMs (Prisma/TypeORM/Drizzle/Knex/Sequelize/
Mongoose), HTTP clients beyond `fetch`/`axios`, WebSocket/SSE emit, framework inventory
(Fastify/Nest/Next/tRPC/GraphQL), Terraform/K8s. Webhooks are detected as HTTP routes but **not flagged
as webhooks**, so their external-trigger semantics are lost to journey composition.

**Unproven (⚠️) — type exists, coverage not demonstrated:** scheduled jobs, CLI commands, event
listeners, cache breadth beyond BullMQ, filesystem coverage of `fs/promises` + streams,
`process.env` reads.

**Why the gaps are tolerable and what they cost.** The honesty rule is the mitigation: an unmatched but
graph-connected symbol becomes a low-confidence `unknown_external` and a trace that ends nowhere records
a dead end, both rolled up and shown in the reader. So an undetected pattern degrades to *declared
unknown* rather than silence — which is the failure mode that matters, because silence reads downstream
as "this code does nothing". The honest limitation: on a repository built on an ORM we do not detect,
the data-flow picture will be thin and will say so.

---

## 5. Effort triage of the open bug list

26 open issues in `BUGS_AND_FIXES.md`. This splits them by **effort**, not priority, because the two
are almost inverted here — several of the highest-priority items are the cheapest fixes, and most of the
remaining cost sits in low-priority work. Estimates are half-day units of one person's time and assume
the fix carries a test.

| Bucket | Issues | Effort |
| --- | --- | --- |
| **A. Mechanical — pattern already exists in the codebase** | #65, #66, #69, #70, #3, #4, #5, #7, #8, #10, #14, #15, #22, #25 | ~3 days total |
| **B. Real work — needs design or investigation** | #67, #68, #71, #72, #73, #1, #6, #9 | ~7 days total |
| **C. Blocked or needs a decision, not code** | #37, #24, #36, part of #72 | decision, then ~0–1 day |
| **D. Open-ended by nature** | #74 | as much or little as we choose |

---

### A. Mechanical fixes — the pattern already exists somewhere in the repo

These are cheap because **we are not inventing anything**: for each one there is already a correct
example in the codebase to copy. This is the bucket to clear first, and it includes the two most
important issues on the list.

| Issue | P | Why it is cheap | Est. |
| --- | --- | --- | --- |
| **#65** three unscoped routes | P2 | The correct query shape already exists — the regenerate route joins through the parent and filters on `project_id`. Three routes, same edit, one test each asserting 404 for a foreign id. **The most important issue on the list is also one of the cheapest.** | ½ day |
| **#66** auth surface | P2 | Three independent small changes: **delete** `POST /api/auth/signup` (dead code — the frontend uses the Supabase client, so deleting it is subtraction, not refactoring), whitelist the invitation tier with a 400, add `express-rate-limit` to `/api/auth/*`. | ½ day |
| **#69** stuck / non-retried jobs | P2 | Two small edits to existing logic: extend the reconciler's `WHERE` to cover `queued`, and only stamp `failed` on the final attempt. The reconciler, heartbeats and attempt counter all already exist from M3. | ½ day |
| **#70** graph counts + blank search | P2 | Aggregate inbound edges into the group count (the per-file version is already correct — the grouped view just never got it), and call the existing viewport-fit machinery after a search resolves. | ½ day |
| **#3** GitHub routes crash on missing key | **P1** | `getPrivateKey()` ends in `fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH!)` — a non-null assertion with no guard, so a missing file throws and every GitHub route 500s. Check both sources, fail once at startup with a clear message. **Cheapest P1 on the list.** | 1 hour |
| **#4, #5** signup validation | P3 | Server-side signup checks only that email and password are *present*; the frontend enforces 8 characters. **Note: #66 deletes this endpoint** — so both of these disappear for free. Keep them filed to confirm on close. | 0 (absorbed) |
| **#7** `Content-Type` on GET | P4 | One conditional in `apiFetch`. | 15 min |
| **#8** `installation_id=0` rejected | P3 | Confirmed still present in two places (`github.ts:176`, `github.ts:236`): the guard treats a falsy value as missing, so a legitimate `0` is rejected. Replace the truthiness check with an explicit integer test, or accept `0` if GitHub can issue it. Two lines, one test. *(In practice GitHub installation ids are never 0, so this is correctness hygiene rather than an observed failure — worth being honest that it is unlikely to be hit.)* | 30 min |
| **#10** delete relies on CASCADE | P3 | Add a post-delete assertion and a test; the constraints are already correct. | 1 hour |
| **#14** invitation error persists | P3 | Clear the error state at the start of each operation. | 15 min |
| **#15** CORS falls back to localhost | P3 | `process.env.CORS_ORIGIN ?? "http://localhost:5173"` — make it required and fail loudly in production. | 30 min |
| **#22** swallowed role-status errors | P4 | Same fix as the rest of #68's family; do it in that pass. | 15 min |
| **#25** test could pass vacuously | P5 | Already effectively superseded — the graph tests now assert exact counts. Verify and close. | 15 min |

**Total: about 3 days, and it closes 14 of 26 issues including both of the two that matter most.** The
useful insight is that #65 and #66 are top of the M5 queue on *risk*, and they also happen to be
half-day jobs — there is no tension to manage between "important" and "achievable" here.

---

### B. Real work — needs design, investigation, or touching several places

These are the actual cost of M5. None is hard in a research sense; each needs more than a copied
pattern.

| Issue | P | Why it costs more | Est. |
| --- | --- | --- | --- |
| **#67** repo import | P2 | Four defects in one flow, and only the checkbox is trivial. **Pagination is the real work:** exhausting GitHub's `Link` headers for both repositories and branches, plus a type-to-filter search, plus deciding what to show while several hundred repositories load. Then badging already-imported repos means cross-referencing the project list, and surviving a refresh on step 2 means moving wizard state into the URL. | 2 days |
| **#68** errors look like empty results | P2 | The individual fix is small; the **scope** is the cost. Roughly ten call sites swallow errors, and each needs a decision about what the failed pane should show. It also needs one shared shape — a discriminated result from the data layer — or the next fetch added will reintroduce the bug. Best done as one deliberate pass, not ten patches. | 1½ days |
| **#71** accessibility + contrast | P3 | Five unrelated things in one issue. Page titles and focus management are a single route effect (~2 hours). Skip-to-content is trivial. **The contrast half needs measurement, not judgement** — recompute the dark-theme tokens through OKLCH → sRGB → WCAG luminance, as Phase 6 did for the light theme, because that pass caught its own approximation error exactly this way. Reduced-motion means auditing every animation site. | 1½ days |
| **#72** team lifecycle | P3 | Four features, not one bug: decline endpoint, expiry filtering, leave-project, ownership transfer. Ownership transfer is the one with real design in it — it is a two-row transactional change with a "cannot strand a project" invariant and a confirmation flow. Invitation emails are the part that is blocked (see bucket C). | 2 days |
| **#73** deployment / baked API origin | P3 | The one-line version (a build argument) works but leaves the origin baked per image. The version worth having proxies `/api` through the frontend's nginx, which also lets the CSP tighten from naming `localhost:3000` to `'self'`. **Then it has to actually be deployed and verified** — auth redirect URLs, CORS origin, webhook URL — which is where the time goes, not the code. | 1 day + deploy |
| **#1** `encrypt('')` round-trip | P4 | Small but needs a **decision first**: is an empty string a valid input to reject, or a value to round-trip? Wrong answer changes token-storage behaviour, so it needs a moment's thought and a test either way. | 2 hours |
| **#6** missing `useCallback` deps | P3 | Adding the dependency is one line; the risk is a re-fetch loop if the identity is unstable. Needs verification against the live page, not just a lint fix. | 2 hours |
| **#9** fragile dynamic SQL | P2 | Confirmed real: `UPDATE project_settings SET ${setClauses.join(", ")}`. **Values are already parameterised — this is not an injection hole**, it is a maintainability one. Rewriting it to a fixed column list with `COALESCE` touches every settings field, so it needs care and a test per field to be worth doing at all. | 1 day |

**Total: about 7 days.** #67 and #68 are the two that most affect what a reviewer experiences, so they
should lead this bucket.

---

### C. Blocked, or needs a decision rather than code

| Issue | Situation | What unblocks it |
| --- | --- | --- |
| **#37** GitHub sign-up identity conflict | **P1, and not our code.** The user-facing half is fixed — the error now gets a plain-language explanation instead of raw provider wording. The rest is a known limitation in the auth provider's identity linking. | Decision: close as external, or spend time on a workaround (pre-checking the email before starting OAuth). Recommend closing as external and keeping the explanation. |
| **Invitation emails** (part of #72) | No email provider is provisioned, and provisioning one for a course project is disproportionate. | Decision: relabel the action "Create invitation" with a "no email is sent — share the link yourself" hint, and close the email half Won't-Fix. Decline and leave-project still ship. |
| **#24** per-route error boundaries | P5. The router-level boundary plus per-page error states already cover the failure modes we see. | Decision: close Won't-Fix with that reasoning. |
| **#36** regenerate one stale tutorial | P5. Cheaper to fix than to justify — now that the tutorial cache works, regenerating the set costs ~4 model calls. | Decision: close Won't-Fix; per-tutorial granularity is not worth the surface area. |

**These four cost almost no engineering time and a small amount of judgement.** Making the calls early
is what stops them being "discovered" as won't-fixes at the M5 deadline.

---

### D. Open-ended by nature

**#74 — the polish tail (49 low-severity findings).** Not estimable as a unit and should not be treated
as one. Work it as a checklist against the two audit documents, in this order:

1. **Naming and terminology first** — the import action has five different labels, the invitations
   screen has four. Reviewers notice inconsistent naming immediately and it costs an hour.
2. **Backend hygiene** — non-UUID ids returning 500 instead of 404, the error handler ignoring status
   codes, missing response compression. Half a day, and it removes a class of confusing 500s.
3. **The accessibility tail** — labels, alert roles, spinner text. Pairs naturally with #71.
4. **Everything else** — as time allows.

Anything not done by the freeze gets closed **Won't-Fix with its specific reason**, so the tracker ends
clean rather than open.

---

### The shape of it

- **~10 days of work** clears all 26, plus four decisions that cost no engineering time.
- **Front-load bucket A.** Three days closes half the list and both of the issues that actually carry
  risk. Nothing in it is blocked by anything in bucket B.
- **Two issues absorb others.** #66 deletes the endpoint that #4 and #5 are about; #68's shared error
  shape covers #22. Sequencing matters more than the individual estimates.
- **The expensive work is not the risky work.** #67, #68, #71 and #72 are P2/P3 polish and completeness;
  the P2 security items are half-day fixes. If M5 runs short, cut from bucket B — never from A.
- **One correction found while writing this:** **#11 was already fixed** and had been sitting Open. The
  frontend calls `/projects/:id/members/:userId` with a single `/members/` segment; it was fixed
  incidentally during the M4 UI work and nobody closed it. Now closed and verified — which is an
  argument for re-verifying an old bug before estimating it, not only before fixing it.

---

## What this means for M5

| Priority | Work | Source |
| --- | --- | --- |
| **1** | Tenant isolation + auth surface — 3 unscoped routes, the auto-confirming signup endpoint, tier validation, rate limiting | UX audit §A → bugs #65, #66 |
| **2** | The rest of the UX audit backlog, sequenced by user impact | both audits → bugs #67–#74 |
| **3** | Deployment to a public URL (blocked on the baked API origin) | bug #73 |
| **—** | Detection P2 breadth, frontend→API edges | `DETECTION_COVERAGE.md` — **explicitly not M5 scope**; the honesty rule covers the gap, and one language done well beats two done badly |

Onboarding content and security need no further work in M5 beyond not regressing — both have automated
gates (the golden checklist and the security report) that fail loudly if they do.
