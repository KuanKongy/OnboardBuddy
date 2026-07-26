# OnboardBuddy — Onboarding & Tabs Rework

Living plan. Phases 1–3 are **delivered** and carry their measured before/after numbers;
everything from 3.5 on is planned. Developer role first — other roles follow once the developer
experience is confirmed.

---

## Why this rework exists

The M4 audit operated 497 of 506 controls across 21 surfaces and checked generated output
against the real open-source repos it describes. Receipts and citations hold up (220/220
receipts verify, 413/413 citations resolve, 0 dangling). What did not hold up was **what the
pipeline identifies**, **how it orders things**, and **how the graphs behave when used**.

Three root causes explained most per-project failures:

1. **`exported` came from syntax modifiers only.** `astParser.ts:80-83` reads
   `ts.getModifiers()`. `export default Index;` is an `ExportAssignment` — pushed into
   `exports[]` and never back-patched onto the symbol. So `const Index = () => {}; export
   default Index;` yielded `exported: false` while `export default function X()` yielded `true`.
   Identical `src/pages/` layouts, opposite outcomes. This one flag gated `ui_route`,
   `cli_command`, `event_handler` and the `exportedSurface` ranking signal.

2. **Ranking rewarded length, not importance.** `importanceScore` was
   `(steps*0.1 + effectSteps*0.2) * uiPenalty` — a 20-step trace outranked a 4-step login.
   Capabilities were ordered `ORDER BY c.name`. Anything with `<2 steps || 0 effects` was
   **dropped**, so the list was never "all flows".

3. **Clicking a node zoomed.** `ViewportFocus.tsx:59` fired `setCenter(…, {zoom: 1.15})` on
   every selection — the only viewport writer in the frontend. Selection felt like navigation
   while real navigation (drill-down) had no motion at all. "Up one level" was
   `segments.slice(0,-1)` on a path string: a guess at a parent, not the level you came from.

**Scope decisions:** shared foundation first, then tab by tab · TS/JS made correct with honest
disclosure for everything else (no new parser) · Workflows becomes one ranked list with three
labeled tiers · stop after each tab for review.

---

## TA / manager feedback (M3 — 14/20)

The graded feedback lands almost entirely on a dimension the original plan did **not** cover.
Phases 1–3 fix what is *detected* and how it is *ordered*. The feedback is about what is *said*.

| Feedback | Where it is now addressed |
| --- | --- |
| "criticality does not make sense based on the project I imported" | 3.1b (ranking) + **3.5a** (showing why) |
| "be transparent about these numbers … based on which criteria" | **3.5a** — the number contract |
| "the architecture part does not make sense to me" | **Phase 4** narrative rework |
| "Capabilities section also does not make sense" | **Phase 6** — evidence-bound, or honestly absent |
| "tutorial is not effective … no difference with writing sections" | **Phase 7** — procedural, not prose |
| "prompts may not generalize well … test versus various projects" | **3.5c** golden harness, 5 repo shapes |
| "changing to no-AI in setting does not work" | **3.5d** |
| "show number of tests for each part … docker command" | **3.5e** |
| "only works on some TypeScript projects is a bad limitation" | **3.5f** (disclose up front) + **Open conflict — see below** |

### The unresolved scope conflict

The TA asks for generalization beyond TypeScript; the team scoped Python out. Both cannot hold.

This plan keeps the team's decision — no new parser — and instead attacks the *reason* the
limitation reads badly, at both ends of the run:

- **Before** (3.5f): the import wizard states what OnboardBuddy can and cannot read, and
  preflight says what *this* repo will lose, before the user commits to a run.
- **After** (3.5d, shipped): generated prose must name the unread stack. FloowForge's package
  never once said "Python" despite 49 of its 167 files being a FastAPI backend; a reader
  finished it believing the repo was a frontend.

That converts a silent failure into a disclosed one at both boundaries. It is defensible, and it
is still not what was asked for. Spending the marks on a real second parser is roughly a phase on
its own — say the word and I will re-plan.

### The explanation contract

Every explanation the product emits — section prose, cluster summary, capability description,
workflow purpose, tutorial step — must satisfy four rules, enforced by a validator rather than
by hoping the model complies:

1. **Say what this is, at this level.** A cluster summary describes the cluster, not the repo.
2. **Ground every claim in evidence**, with a receipt. No receipt, no claim.
3. **Name the gap.** What it could not determine is part of the explanation, not an omission.
4. **Do not narrate the screen.** "This diagram shows five components" is not an explanation —
   the reader can see five components. Say what they are *for*.

### The number contract

Every number rendered anywhere carries, on hover and in the provenance panel: the **formula**,
the **inputs with their actual values**, and **one line on what would change it**. Criticality
0.71 must be able to say "workflow participation 3 × 0.20, distinct side effects 2 × 0.15,
fan-in 12 damped to 4.2 × 0.15 …". This is cheap: `score_breakdown` is already computed and
stored, and simply never shown.

---

## Sequencing

| # | Phase | Gate | Status |
|---|---|---|---|
| 1 | Foundation — parser, coverage, cluster typing | Truth-diff on 3 repos | **done** |
| 2 | Graph interaction core, hosted in Dependencies | Click-through + drill spec | **done** |
| 3 | **Workflows** — tiered ranking + serpentine | Ordering review + truth-diff | **done** |
| 3.5 | **Explanation & transparency foundation** | Golden-output harness on 5 repos | in progress |
| 4 | **Architecture** — drill, kinds, *and its narrative* | Click-through + explanation review | |
| 5 | **Dependencies** — full ladder, truncation honesty | Click-through | |
| 6 | **Capabilities** — evidence-bound, or honestly absent | Explanation review | |
| 7 | **Tutorials** — procedural, not prose | Can a newcomer follow it? | |
| 8 | **Onboarding package & reader** | Truth-diff + reader walk | |
| 9 | Cross-cutting UI / a11y sweep | Full harness sweep | |
| 10 | Other roles (prompts, weights, reading orders) | After developer role is confirmed | |

Explanation quality is **not** a phase at the end. Each tab phase from 4 onward owns the prose
for its own surface, because "the architecture part does not make sense" is a defect in the
Architecture tab, not in a generic writing step.

Phase 2 was hosted in Dependencies because it was the only tab with levels — the engine got
built against a working case before three tabs depended on it.

---

## Phase 1 — Foundation ✅

**1.1 Export reconciliation** — `backend/src/worker/engine/symbolExtractor.ts`
Reconcile `exports[]` against `symbols[]` after extraction: `export default <ident>`,
`export { Foo }`, `export { Foo as Bar }`, `export { X as default }`, and HOC-wrapped defaults
(`memo(Index)`). Re-exports deliberately excluded — that name belongs to another module.

**1.2 Widen `ui_route`** — `entrypointDetector.ts`
Added Next App Router (`app/**/page.tsx`), Remix/SvelteKit (`routes/*.tsx`), and router-config
extraction (`<Route path element>`, `createBrowserRouter`, nested + parent-joined). `app/` and
`routes/` are shared with server conventions, so a JSX extension is required there — this keeps
`src/routes/authRoutes.ts` out of the UI bucket. `layout.tsx` is excluded: it wraps a route
without being navigable. One `ui_route` per page file (was `.slice(0, 2)`, which double-counted).

**1.3 Honest coverage** — the number was wrong *in LLM prompts*, not just on screen
`analysis_snapshots.file_count` is every file in scope, images and markdown included. Added
`parsed_file_count` (migration `002`) and surfaced `{parsed, supported, inScope, unsupported}`.
Fixed `evidenceContext.ts` and `sectionSpecs.ts`, which injected the false count into prompts.

**1.4 Cluster typing + counts** — `engine/architectureClusterer.ts`
`fallbackKind` read a **repo-wide** framework set, so any repo containing React typed every
unmatched bucket `frontend_ui` — including `Backend · Modules`. Replaced with per-cluster
evidence: JSX majority, then the imports those files actually make, then the scope's own
`package.json`. Collapsed four disagreeing file counts into one; wrapped the member insert in a
transaction; clusters are now described by their dominant member type.

**1.5 Truth fixtures** — `backend/test/truth/*.json` + `npm run truth`
Hand-labeled entrypoints, routes and paths for 3 repos. The accuracy gate for every later phase.

### Delivered

| | before | after |
|---|---|---|
| Skribbl exported symbols | 43 | **312** |
| MasterPokedex exported symbols | 67 | **349** |
| Skribbl / MasterPokedex / FloowForge `ui_route` | 0 / 0 / 0 | **2 / 8 / 14** |
| Truth-gate checks | 4/24 | **24/24** |

UI counts are exact matches to hand-verified ground truth. Coverage was overstated **1.2×–8.7×**
across all 13 snapshots — CourseInsights claimed "Analyzed 382 files" having parsed 44.
Two distinct root causes: Skribbl/MasterPokedex were *export-style* blind (the whole
`components/ui/*` design system was invisible); FloowForge was *directory-convention* blind.

**Socket.IO** was added after this phase on request: anchored on `.on('connection', cb)` and
only `.on` calls lexically inside that callback, so `process.on`/`emitter.on` are never matched
(verified: 12 `.on(` sites in this repo's backend, **zero** false positives). Skribbl went from
3 entrypoints / 1 workflow to **15 / 10**.

---

## Phase 2 — Graph interaction core ✅

New: `frontend/src/lib/drillStack.ts`, `hooks/useDrillStack.ts`, `hooks/useGraphDrill.ts`,
`components/graph/GraphCanvas.tsx`, `components/graph/DrillCamera.tsx`.

**Selection stops zooming.** `ViewportFocus` gained `mode: "pan-into-view" | "frame"`, default
`pan-into-view`: if the node's projected rect already intersects the canvas inset 32px, do
nothing; otherwise pan at the *current* zoom. `frame` is retained solely for `?focus=` deep
links, where there is no viewport the user chose.

**Zoom became the drill transition.**

```
idle → zoom-in (400ms, setCenter on the clicked node at zoom × 2.6)
     → waiting (child fetch, 6s timeout → cancel)
     → swap  (commit child data, push frame, setViewport at zoom × 0.45)
     → settle (450ms fitView, gated on useNodesInitialized) → idle
```

Drill-up plays it in reverse. `prefers-reduced-motion` sets every duration to 0 while keeping
the phase sequence identical. Mid-transition clicks are ignored; Escape cancels; a `runIdRef`
counter discards stale resolutions on unmount.

**A real drill stack.** URL stays the source of truth:
`?drill=cluster,src%2Flib,lib|file,src%2Flib%2Fapi.ts,api.ts`. Both delimiters are escaped by
`encodeURIComponent` — note `~` is **not** (RFC 3986 unreserved), which would have torn a path
like `src/weird~name.ts` into two frames. `pop()` calls `navigate(-1)` when this session pushed
the frame, so the button and browser Back are one motion. Restore viewports live in
`history.state`, not the URL. Breadcrumbs are visited levels, not path prefixes.

Ladders: Architecture `cluster → files → symbols` · Dependencies `cluster → nested cluster →
file → symbols` · Workflows `workflow → step → callees`.
**Classes stays a sibling view, not a level** — `/graph/classes` is project-wide with no file
scope, so making it a level would assert containment that does not exist.

`GraphCanvas` replaced three copy-pasted `onNodeClick`/`onSelectionChange`/`onPaneClick` triples
and renders `data-drill-phase` / `data-drill-depth` so Playwright waits on state, not timeouts.

### Delivered

6 browser tests (zoom-unchanged-on-select measured from React Flow's `scale()`, drill
transition, Back, mid-transition click ignored, reload survives, legacy `?cluster=` links),
119 unit tests, 100% of controls operated on all four graph tabs.

---

## Phase 3 — Workflows ✅

**3.1 List all, in three tiers.** Stopped dropping traces with `<2 steps || 0 effects`; they are
now `surface`-tier entries, listed but explicitly labelled as having no traced effects. Surface
entries are exempt from near-duplicate suppression — two routes can share a handler, and
suppressing them would delete real endpoints from the inventory that tier exists to provide.

Replaced `importanceScore` with tier + score. Signals: user-triggered entrypoint, changes stored
state, auth-guard reached, **distinct** side-effect kinds (breadth, not length), route pattern
known, and a **penalty past 8 steps** because a long trace has usually wandered into shared
utilities. The blanket `uiPenalty = 0.5` was removed — a page that writes to the database *is* a
user flow, and halving it was a server-centric bias in a list meant to be ordered by importance
to a user. A small tie-break prior toward the server route remains.

**3.1b Critical 25%.** `fanCentrality = fanIn + fanOut*0.5` handed a top-quartile score to any
utility every file imports. It is now damped to 0.35 for modules carrying no behaviour (no
effects, no workflow, no route or schema) — damped, not zeroed, because a genuinely central
shared module is still worth knowing, just not before the login flow. `sideEffects` became
distinct kinds. The same length-is-importance bug existed a second time in `candidateRanker`'s
*workflow* scoring (`workflowParticipation: wf.steps.length`) and was fixed there too.

**3.2 Serpentine layout.** `frontend/src/lib/serpentine.ts`. Spine = longest path from an
in-degree-0 root; the back-edge guard contributes **nothing** to the path (returning the node
would duplicate it and corrupt the spine index). `perRow` derived from `TARGET_ASPECT`, clamped
[3,8], then re-scored across `base±1` to avoid a remainder of 1 — one node alone on the last row
is the lopsided shape this layout exists to prevent. Even rows L→R, odd rows R→L, **short final
row centred**. Branches hang below their anchor with the row band grown so they cannot collide.

`StepNode` went from 2 handles to 8 (four sides × source/target) — a horizontal snake cannot be
drawn otherwise. Turns are routed from spine adjacency rather than from dx/dy, because a centred
final row can sit further sideways than below, which a pure geometric rule misreads.
`shouldSerpentine` = spine ≥ 6 && nodes ≤ 60 && branch ratio < 0.5; auto/snake/column toggle.

**3.3 Parity.** Workflows had no minimap, search or fullscreen — the tab with the longest graphs.
All three added.

### Delivered

Skribbl: **16 workflows, up from 1**. Core tier is real user actions (`join-room`, `draw-ops`,
`create-room`); `GET /health` sits in Endpoints & pages at the bottom. A 20-step page now ranks
**9th**, below a 2-step handler — the inversion that motivated the rework. Critical 25%'s top 14
is entirely behavioural, with no `utils`/`cn`/types file present.

**Known issue:** CI/journey flows still use the old `maxMemberScore + 1.5` scale, so their score
reads ~1.5 against core scores in the 0–1 range. Tier ordering means the *list* is correct, but
cross-tier score comparison is meaningless until normalized.

**Known limitation:** four real Skribbl game actions (`chat-message`, `start-game`,
`leave-room`, `word-selected`) sit in `surface` because their handlers call `GameRoom` methods
the traversal does not follow. That is a tracing limitation, honestly labelled, not a ranking
bug — worth attacking in a later phase.

---

## Phase 3.5 — Explanation & transparency foundation

Shared machinery every later phase depends on. The difference between "criticality 0.71" and
"criticality 0.71, and here is why".

**3.5a Number provenance, end to end.** `criticality_scores.score_breakdown` and `reasons` are
computed, stored, then largely discarded at the API boundary. Surface them: every score reaching
a screen carries `{formula, inputs, weights, whatWouldChangeThis}`. One `<ScoreProvenance>`
primitive renders identically on Architecture criticality, workflow rank, Critical 25% and the
coverage strip, replacing the single static `RANKING_EXPLANATION` tooltip that says the same
sentence regardless of the number it is attached to. A score with no stored breakdown must say
the derivation is unavailable — never show a plausible-looking guess.

**3.5b The explanation validator.** `voiceLint.ts` catches marketing tone only. Add checks for
the four contract rules: level-appropriateness, receipt coverage per claim, an explicit unknowns
statement, and a **screen-narration detector** — text describing the picture instead of the
system, which is the specific failure mode behind "does not make sense". Failures re-prompt
once, then downgrade confidence and mark the gap rather than shipping filler.

**3.5c Generalization harness.** `backend/test/golden/` — generated output for **5 deliberately
different repo shapes** (TS SPA with react-router; TS/JS mixed with a plain-JS Express+Socket.IO
server; Next App Router with an unparseable Python backend; a TS monorepo; a repo with few or no
detectable entrypoints), scored on *properties* not exact text: names the repo's real domain
nouns, every claim carries a receipt, discloses what was not read, trips no narration finding.
The regression net for every prompt change after it.

**3.5d "No AI" actually does nothing AI.** `summaryWorker.ts` reads
`COALESCE(ps.privacy_mode, s.privacy_mode) AS effective_privacy_mode`, so the live setting *is*
read — the failure is downstream. Trace every LLM call site against all three modes;
`ai_disabled` must produce the deterministic backbone with an explicit "AI is off, this is
structural only" label; `facts_only_ai` must genuinely strip snippets. One test per mode
asserting **zero** provider calls where none are permitted.

**3.5e Per-part test counts in the one-command run.**
`docker compose -f docker-compose.test.yml run --rm test` must print a per-area summary
(backend unit / backend analysis / frontend unit / e2e) with real parsed counts, not one opaque
total. Any area failing must fail the command with a non-zero exit and say which area.

**3.5f Say what can be analysed — BEFORE the analysis runs.**

The honest answer to *"only works on some TypeScript projects is a bad limitation"* is not to hide
the limit; it is to state it before someone spends a run discovering it. Today a user picks a
repo, waits several minutes, and only then finds out that most of it was never read.

The machinery half-exists and has three concrete defects:

- **The warning is threshold-gated and misses real cases.** `preflightService.ts:113` only warns
  when `unsupportedFileCount > supportedFileCount`. FloowForge is 51 unsupported against 65
  supported — so it does *not* warn, despite 29% of the repo being a Python backend nothing
  reads. A minority is still a hole; the threshold should be "enough to change what you would
  conclude", the same rule `unreadStacks.mustDisclose` already applies (≥10% or ≥20 files).
- **It is absent from the import wizard entirely.** `ImportPage.tsx` never calls preflight, so
  the moment a user actually chooses a repository — the one moment the information would change
  their decision — nothing is said.
- **It states what was excluded, never what is supported.** A user cannot tell whether their
  stack is in scope until after the fact.

Build, in the import wizard and the Analyze dialog, before the run starts:

1. **A standing capability statement**, independent of any repo: OnboardBuddy parses TypeScript
   and JavaScript (`.ts .tsx .js .jsx .mjs .cjs`). Everything else — Python, Go, Java, Ruby, C#,
   PHP, Rust — is inventoried and named but never read, so nothing describes it. It detects HTTP
   routes, UI pages (Next App Router, Remix/SvelteKit `routes/`, React Router configs), queue
   consumers, Socket.IO events, SQL schema in migrations, and Docker/CI config.
2. **A per-repo verdict from preflight**, shown before the button: which languages were found,
   how many files of each, what fraction will actually be read, and — stated plainly — what will
   therefore be missing from the result. A repo whose backend is Python must say "the backend
   will not be described" *before* the user pays for the run.
3. **A blocking case.** `supportedFileCount === 0` already fails the run
   (`worker/index.ts:407`); the wizard should refuse earlier and explain, rather than accepting
   the import and failing minutes later.

This is the mitigation the scope conflict above depends on. It does not make the product analyse
Python — it makes the product stop pretending the question never came up.

---

## Phases 4–7 — each tab owns its own explanation

**Architecture** — cluster nodes drill into member files in-graph instead of only opening an
aside with link-outs. Correct kinds and counts from 1.4 become visible. Fix the empty guard
(`clusters: []` currently renders "0 components" over a blank canvas) and refetch on run
completion — deps are `[id, selectedPackageId]` only, so a finished analysis never appears.
**Narrative rework:** a cluster summary currently reads "Auth services: 9 files, 40 symbols" —
an inventory, not an explanation. It must say what this part of the system is responsible for,
what crosses its boundary, and why it is separate, using cluster edges and workflow crossings
that are already computed and unused. Criticality gets the 3.5a treatment, because that specific
number is what the TA called out.

**Dependencies** — full ladder. Disclose truncation: `MAX_GRAPH_NODES = 60` silently cuts a
drilled cluster with more files. Same empty-canvas guard as Architecture.

**Capabilities** — root cause is `capabilityPass.ts:100`, which asks a model to "extract 2-8
business capabilities". That is a **quota**, so it always returns some, inventing them when
evidence is thin. Rework: capabilities are **derived from evidence and then named**, not named
and then justified. A capability must bind to ≥1 entrypoint, ≥1 traced flow, and the schema or
external service it touches; anything that cannot bind is not emitted. **Zero capabilities is a
valid, honest answer** and the tab must say so instead of padding. Ranked by the Phase 3 model
rather than `ORDER BY c.name`, with a drillable capability → flows → code view.

**Tutorials** — *"tutorial is currently has no difference with writing sections"* is accurate:
both call the same section generator with a different prompt, so both produce essays. A tutorial
is not an explanation, it is a **procedure**. Each step must carry a concrete action (a command
to run, a file and line to open, an edit to make), an expected observable result, and a way to
verify it. If the evidence cannot support a real procedure, the tab says so rather than emitting
prose that looks like a section. Also: route/label mismatch (`/walkthrough` vs "Tutorials"),
disclose the `DEFAULT_MAX_TUTORIALS = 4` cap, realign selection scoring to the new tiers.

---

## Phase 8 — Onboarding package & reader

- **Accuracy** — prompts receive corrected coverage (1.3) and cluster kinds (1.4). Rewrite the
  two role-interpolated retrieval tasks for developer role: `code_map` and `first_change`.
- **Precision** — `[[unverified]]` handling and known-gap rendering; gaps/citations bloat (#83).
- **Resilience** — one invalid section pauses the whole package (#77); a paused package blanks
  every tab (#80); a failed analysis is marked `complete` (#75, reproduced live); statement
  timeouts hit 22% of runs (#76).
- **Utility** — reading order, suggested rail, resume behaviour against the corrected ranking.

## Phase 9 — Cross-cutting UI / a11y

Measured twice on independent sweeps: **24% of controls are not in the tab order** (worst on the
graph tabs, ~38% each — the three surfaces the product exists to deliver are effectively
mouse-only) and **38% use a native `title` as their only tooltip** (114 raw `title=` attributes,
several in files that already import the Tooltip primitive). Add the missing primitives
(skeleton, popover, accordion, sheet, empty-state), adopt `ui/tabs.tsx` (imported by zero files),
fix the `react-flow__pane` fullscreen occluder (#81), route the Import tour through `tourState`
instead of its own key, and delete the dead `ArchitectureComponent` model.

## Phase 10 — Other roles

Only after the developer role is confirmed. `ROLE_READING_ORDER`, `DEFAULT_ROLE_WEIGHTS`
(5 roles × 7 views), per-role retrieval tasks and per-role tier weighting. Collapse the three
divergent role lists into one union type.

---

## Verification

Every gate runs the same steps, then stops for review:

1. **Truth-diff** — re-run analysis on the imported repos, diff against
   `backend/test/truth/*.json` (`npm run truth`). Regressions block.
2. **Golden-output review** (from 3.5c on) — regenerate for the 5 harness repos and score the
   prose on the contract properties. A phase that improves detection while making the
   explanation worse does not pass. Defects are reported as findings with the offending sentence
   quoted, not as a pass/fail number.
3. **Harness sweep** — `frontend/e2e/audit/probe.spec.ts` (census + state fingerprint +
   `elementFromPoint` hit-test). Gate: ≥95% of controls operated, 0 console errors **on live
   data**. Mock-shape artifacts do not count — that mistake produced 7 false findings in the
   M4 audit. `frontend/e2e/audit/drill.spec.ts` waits on `[data-drill-phase="idle"]`.
4. **Manual click-through** — one page at a time, click and hover every control before moving on.
5. **Evidence report** — what changed, the numbers before and after, and what could not be
   verified.

Run Playwright with `USE_DOCKER_STACK=1` (its `webServer` is then `undefined`) in a **foreground**
tab — React Flow cannot measure nodes in a backgrounded tab, so layouts never settle.

### Known environment constraints

- Two concurrent analyses exhaust the Postgres pool (`PG_POOL_MAX=10`) and both die with
  `timeout exceeded when trying to connect`. Run solo. Pre-existing, not caused by this rework.
- 6 Playwright specs fail on `main` independently of this work (reader rendering, the project
  tour, mobile viewport). Verified by rebuilding with the rework's `src/` changes stashed —
  identical failures. Not regressions.

### Outstanding audit cleanup

Unrelated to this plan, still open: revert the Skribbl admin promotion, remove
`budget_overrides` from 9 projects, ~12 `project_members` rows across two audit accounts, the
throwaway account, cloned repos, and `/app/*.cjs` helpers in the API container.
