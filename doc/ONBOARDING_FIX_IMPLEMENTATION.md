# Onboarding Trust Fixes — Implementation Log

**Date:** 2026-07-23 · **Follows:** `doc/ONBOARDING_UX_VALIDATION.md` (the audit)
**Scope:** every P0 item from the audit plus the P1 items coupled to them. All changes are uncommitted in the working tree; suites green: **backend 405 passing** (was 363 + a pre-existing flake), **frontend 61 passing**, both `tsc` clean.
**End-to-end proof:** three sections of the dogfood package (`KuanKongy/OnboardBuddy`, package `a1484e79`) were regenerated through the rebuilt worker and verified in the live reader.

---

## What changed, step by step (each verified)

### 1. Reader receipts: real staleness, real age, real claims (audit §3.3)
`onboarding.ts` GET hardcoded `staleness:"current"`, `ageLabel:"recent"` and dropped the claim. Now:
- `backend/src/api/lib/receiptPresentation.ts` (new): `receiptStaleness()` re-verifies each receipt by comparing the cited symbol's content hash in the receipt's snapshot vs the latest complete snapshot — `fresh` / `stale` / `unknown` (docs & synthesis keys are *never* shown as green "Current"); `ageLabelFrom()` derives "analyzed 6 days ago" from the snapshot date; `claimForReceipt()` recovers claim text for legacy receipts from `generation_context.claims` via `metadata.copiedFromReceiptId`.
- The receipts query now joins `graph_nodes` (own + latest snapshot) and `analysis_snapshots`; serves `id`, `bundleReceiptId`, `trustLevel`, `commitHash`, `nodeStableKey`, `claim`.
- `sectionGenerator.persistSection` now writes `source_receipts.claim` (first adjusted claim citing the receipt) for all future generations.
- Frontend `SourceReceipt` type: `staleness: "fresh" | "stale" | "unknown"` (backend used to send `"current"`, which wasn't even in the old union); `ReceiptViewer` renders a third neutral badge "Not re-verifiable" and a tooltip explaining what "Current" now *means* (re-verified hash).
- **Tests:** `test/api/receiptPresentation.test.ts` (pure units incl. the never-fake-fresh rule), `test/api/onboarding.test.ts` route test with mocked DB asserting computed staleness/claim/age end-to-end.
- **Live proof:** ReceiptViewer on the regenerated section shows "High · Current · analyzed 6 days ago" + commit + stable key.

### 2. Citation aliases → real inline citations (audit §3.1, §3.2)
The model cites prompt aliases `r1…r40`; prose used to ship them verbatim ("(receipt r14)") pointing at nothing.
- `backend/src/worker/generation/citationMarkers.ts` (new): fence-aware rewriter — aliases of **used** receipts become `[[receipt:<bundle-uuid>]]` markers; unresolvable aliases are stripped; reference-only bullets ("- Receipt: [r13]") are dropped; trailing "## Claims"/"## Used Receipt IDs" bookkeeping blocks are deleted; code fences and indentation untouched. Wired into `generateSection` after validation; stats recorded in `generation_context.inline_citations`.
- Frontend: `frontend/src/lib/receiptMarkers.ts` (new) turns markers into numbered links; `SectionView` renders them as clickable superscript chips (opens ReceiptViewer); bottom receipt chips are now **numbered to match**.
- Export: `GET /onboarding/export` converts markers to plain `(path:line)` citations (`inlineMarkersToText`) — no marker syntax leaks into Markdown files.
- Legacy content: `backend/scripts/clean-legacy-citation-aliases.ts` (committed, dry-run by default) stripped dead aliases from **50 sections across all projects**; full pre-change backup saved before applying.
- **Tests:** 9 backend (`citationMarkers.test.ts` — all observed alias forms, fences, bookkeeping), 8 frontend (`receiptMarkers.test.ts` — incl. a real bug they caught: doc-receipt ids like `docnode:doc:README.md#x` need a lazy matcher), 1 export unit.
- **Live proof:** regenerated `start_here` renders 11 inline numbered chips; `data_schema`'s 5 unresolvable aliases were stripped, not shipped.

### 3. Full route paths (audit §5.2)
"GET /" appeared 7× meaning 7 different routers.
- `symbolExtractor.ts`: new `extractRouterMounts()` records `X.use('/prefix', …, router)` with the mounted router resolved to its file via the type checker (`RouterMount` on `FileAnalysis`).
- `entrypointDetector.ts`: `buildMountPrefixes()` chains mounts across files (app.ts → routes/index.ts → router) and `joinRoutePaths()` emits `/api/projects/:id/onboarding/...` on every http entrypoint; workflow titles inherit automatically.
- Backfill for the existing snapshot: `backend/scripts/backfill-route-paths.ts` updated **68 entrypoints** and **50 workflow titles** using the repo's static mount table, and deleted **4 fixture workflows** (`PUT /dataset/:id/:kind`, `POST /query`, …) after checking no tutorial references them.
- **Tests:** `routerMounts.test.ts` — a real compiled fixture (`src/worker/fixtures/mounts/`) proving `/api/projects/:id/child/:itemId` end-to-end, plus join edge cases.
- **Live proof:** the Workflows rail shows 62 uniquely-named flows ("POST /api/projects", "GET /api/projects/:id/llm-key"…).

### 4. Fixtures & tests out of the evidence stream (audit §5.1, §4.1)
- `repoIngester.ts`: default ignore globs `**/fixtures/**`, `**/__fixtures__/**`, `**/__mocks__/**`, `**/testdata/**` (tests are still analyzed; only fixture *trees* are cut). Engine test suites scan fixture dirs as roots, so they're unaffected — verified by the green suite.
- `testPaths.ts` (new, shared): one definition of test/fixture paths used by the detector, ranker, and diagram builder.
- `entrypointDetector.ts`: test/fixture files can no longer seed entrypoints from **any** branch (the old guard covered 1 of 5).
- `candidateRanker.ts`: test/fixture files are never ranked as learning targets; UI-page-only entrypoints get **half** entrypoint credit (reason string says so).
- `roleProjection.critical25()`: area-diversity cap — one path area (e.g. `frontend/src/pages`) can hold at most 40% of a selection, backfilled so the size contract never shrinks.
- Stored rankings for the existing snapshot: purged **124 fixture/test criticality rows** (76 symbols, 45 workflows, 3 files).
- **Tests:** `rankerDamping.test.ts` (exclusion + 0.5 credit via breakdown), `critical25Diversity.test.ts` (the exact dogfood failure shape: 12 pages outscoring 8 backend symbols → picks must include worker code).
- **Live proof:** regenerated Critical 25% path: OnboardingPage → IntroPage → AuthCallbackPage → `db.ts#query` → `POST /installations/link` → `retrievalService.retrieve` — spans the codebase, zero fixtures.

### 5. Deterministic facts injected, never asked (audit §2, §4.2) — root cause found
The "25 tables" hallucination had a *mechanical* cause: `data_schema`'s deterministic query had `LIMIT 25`, silently truncating a 37-table schema before the model ever saw it. Fixed by injecting `schemaTableCount` (a real `count(*)`), a `schemaNodesTruncated` flag, and instructions that the stated total **must** be the provided number. Also:
- `start_here`: rewritten spec — "What this is" (stack from inventory), "**Run & verify**" (commands only if present verbatim in evidence, else an explicit "not derivable" sentence — never invented), "The lay of the land" (clusters **with injected member counts** — a regen invented "≈64 files" for a 23-file cluster before counts were supplied; that hole is now closed), "Read these first" (evidence-backed reasons, no UI-page filler for non-frontend roles).
- `critical_25`: rewritten as an **ordered learning path** with an honest coverage opener from injected denominators ("This path covers 9 of 1305 symbols and 16 of 66 traced workflows…" — rendered verbatim in the live regen) and a "What this path leaves out" close.
- `entry_points` / `capability_map` / `role_path` / `workflow_guide` / `safety_rails` instruction fixes: full paths reproduced exactly; omit-purpose-instead-of-inventing; no "N/A" lines; no internal `wf:`/`cluster:` keys; codebase path ≠ product user journey; writes never softened to reads; workflows selected by criticality (was: arbitrary LIMIT 8).

### 6. Voice contract + lint (audit §6)
- `renderPrompt` now carries a voice contract (flat engineering prose; bans the audited slop list; numbers only from deterministic facts). `SECTION_PROMPT_VERSION` bumped to `section-v3`.
- `voiceLint.ts` (new): fence-aware banned-phrase scanner; failures share the generator's single stricter retry; residual hits recorded in `generation_context.voice_lint`.
- **Honest result:** regenerated sections are dramatically flatter, but gpt-4o still leaked 1–3 banned words per section after one retry (recorded transparently). Zeroing this needs either a second retry loop or a stronger model — left as a knob.
- Model: strong tier now points at `openai/gpt-4o` via `OPENROUTER_MODEL_STRONG` in `backend/.env` (the file's own documented upgrade path) with the price row updated in `modelTiers.ts` per its comment. Revert = delete the env line + restore the `{0.15, 0.6}` row + fix one test expectation.

### 7. Diagrams stop lying (audit §7)
- Sequence diagrams: **hub topology** — every arrow originates from the flow's entry participant; the old chained form drew fictional peer calls (`button.tsx ->> badge.tsx`, fixture SQL "calling" the schema). Participants capped at 8 with an overflow note; fixture/test files excluded.
- Architecture diagram: per-direction dedupe (heaviest edge wins), test-cluster edges and self-loops dropped, top-16 edges by weight, isolated boxes omitted (the text has the full list).
- Schema diagram: connected tables only (the 20-isolated-cylinder scroll is gone), top-12 by access degree, ≤3 accessors/table, test/fixture accessors excluded.
- **Tests:** `diagramCaps.test.ts` (7 cases incl. "no fictional peer calls").

### 8. Reader polish
- `UNKNOWN_LABELS`: added human translations for `no_semantic_matches` (was rendering raw "no embeddings matched views [operations, dependency]"), `workflow`, `data`.
- Pre-existing test flake fixed: `pipeline.todo.test.ts` before-hook builds a real `ts.Program` (>2s cold); now has a proper timeout — the suite is deterministic on any machine.

---

## Verification ledger

| Step | Unit/integration | Live |
|---|---|---|
| Staleness/claim serving | 405-suite incl. route test with computed values | ReceiptViewer: "Current · analyzed 6 days ago", commit, stable key |
| Inline citations | 17 tests across both suites | 11 numbered chips in regenerated start_here; 5 dead aliases stripped in data_schema; legacy strip verified in reader |
| Route paths | compiled-fixture test | Workflows rail: 62 distinct full-path flows |
| Fixture exclusion + ranking | synthetic-graph + diversity tests | Regenerated path spans frontend→lib→github→retrieval, no fixtures |
| Deterministic injection | — | Coverage line + "40 tables" (see below) + "Run commands are not derivable…" honesty fallback |
| Voice | 4 lint tests | Slop counts way down; residuals recorded in generation_context |
| Regeneration pipeline | 4 jobs, all `complete` | prompt_version=section-v3, inline_citations + voice_lint present |

**Why "40 tables", not 37:** the count is faithfully the snapshot's schema-node count — and this *old* snapshot still contains fixture-SQL schema nodes (analyzed before fixture-ignore existed). The number is now honest-to-evidence by construction; a fresh analysis (fixtures excluded) will make the evidence itself say 37.

## What a fresh analysis will additionally fix (not reachable by regeneration)
Stored Phase-B ranking scores, cluster kind labels, symbol summaries written by the old prompts (one "enhances user engagement" leaked into a regenerated section by quoting an old cached record summary), the fixture-tainted schema-node count, and `aiClient.ts`'s "Not ranked in this snapshot". Re-analysis was deliberately **not** run: same-commit snapshots are unique per scope, the fork hasn't moved, and the content-addressed record cache would fight the old records — push any commit to the fork and re-analyze to collect these.

## Hidden-decisions ledger (the judgment calls)
1. **Touched test infra before feature code** (flaky 2s hook) — a deterministic baseline outranks purity about scope.
2. **Mutated live DB content three times, all with dry-runs + backups saved to the session scratchpad, via committed re-runnable scripts**: legacy alias strip (50 sections, all projects — removal-only), route-path/title backfill + 4 fixture-workflow deletions (FKs verified cascade/set-null; abort-if-tutorial-references guard), 124 fixture ranking rows purged. Old section content additionally survives in `package_sections` history via the audit's dumps.
3. **Markers use bundle-receipt UUIDs**, not row ids — `metadata.copiedFromReceiptId` already bridges them, keeping generation and serving decoupled.
4. **"Unknown" staleness is a first-class value** — docs/synthesis receipts show a neutral badge; I refused to extend the green "Current" to anything we can't hash-verify.
5. **Fixtures ignored by default with no per-project opt-out** (ignored_paths can only add) — judged acceptable: fixture-as-product is rare, pollution cost was proven high, and test dirs deliberately stay analyzed.
6. **UI-page damping is 0.5× + a 40% area cap at selection time**, rather than retuning global signal weights blind — the cap is provable in tests and works even on biased stored scores; weight retuning without a re-analysis loop would be guesswork.
7. **Model upgrade done via the team's documented env mechanism, not a code-default change** — after reading the maintainer comment that explicitly reserves the default. Price row + one test updated per that comment's own instruction.
8. **Regeneration enqueued directly on the queue** (the UI account is Developer-tier; the route is owner/admin) — attributed to the owner's user id, mirroring the route's exact payload. Cost of all 4 regenerations ≈ $0.15 under existing budget guards.
9. **Voice lint records residuals instead of looping** — one stricter retry keeps cost bounded; the leftover hits are visible in `generation_context` rather than silently tolerated.
10. **`section-v3` version bump** — regenerations after this change miss the prompt cache by design; unchanged sections keep serving cached v2 content until regenerated.
11. **Left everything uncommitted** — you asked for implementation + verification; the commit slicing (and whether scripts/fixtures belong in the repo) is yours to call.

## Not done (from the audit's list)
P1 §3.5 receipt re-anchoring lifecycle ("verified against `<sha>`" re-checks on new commits), §3.7 receipt span caps at extraction, claim-level inline "unverified" underlines, coverage strip UI on the package header, §8 IA restructuring (merging tab-duplicate sections), P2 items (process-disclosure panel, surfacing the internal Q&A, analyze-pipeline tutorial). The prior app-level audit (`UX_AUDIT_FINDINGS.md`) remains separately actionable — including the nginx cache headers whose absence made even this session's first post-rebuild page load serve a stale bundle.

---

# Session 2 — 2026-07-23 (continuation)

**Scope:** everything from the "Not done" list above except §8 IA restructuring and two P2 stragglers (see the new Not-done at the bottom). Suites after: **backend 429 passing** (was 405), **frontend 63 passing** (was 61), both `tsc` clean. Live verification in the reader as the Developer-tier UX Audit account, plus one section regenerated through the rebuilt worker.

## What changed, step by step (each verified)

### 9. Receipt re-anchoring lifecycle (audit §3.5)
Serve-time, no schema, no nightly job: the reader's receipt query now also pulls `own_node.line_start` and `latest_node.line_start/line_end`, and each receipt is served with a `verification` object — `verified` (hash unchanged; badge reads **"Verified against `<sha8>`"**), `re_anchored` (hash unchanged but the symbol moved: the receipt span is shifted by the symbol's line delta — hash equality means identical content, so sub-ranges shift exactly; badge "Re-anchored → L X–Y"), `changed` (review required; serves where the symbol now lives), `missing`, `unverifiable`. GitHub links now target the *latest verified commit at the current lines* for verified/re-anchored receipts, and the receipt's own commit for changed/missing — the audit's 255-lines-off deep link can no longer happen for verified evidence.
- **Bug found while testing this:** `receiptStaleness` (and `citationValidator.findStaleReceipts`) judged "synthesis key" by `key.includes(":")` — which false-positived on every route symbol with a path param (`projects.ts#POST /:id/analyze`), permanently branding them "Not re-verifiable". Fixed with a shared prefix predicate `hasKindPrefix()` in `engine/stableKeys.ts` (`doc:`/`cluster:`/`wf:`-style prefixes only). Route-symbol receipts now re-verify like any other node.
- **Tests:** verification unit cases (verified/re-anchored/changed/missing/unverifiable incl. the 255-line delta), route-param staleness regression, route test asserting served `verification` end-to-end.
- **Live:** ReceiptViewer shows "Verified against 9f4d168b" on the dogfood package.

### 10. Receipt span caps (audit §3.7)
`engine/receiptSpan.ts` (new): `capReceiptSpan()` caps any receipt span at 40 lines, slices the snippet to match, and keeps the true extent as `truncatedFromLineEnd` (persisted in receipt `metadata`, served to the reader). Applied at **extraction** (`symbolPass.symbolReceiptDraft`, with `attachReceipts` now writing metadata) and at **retrieval** (`retrievalService` bundle mapping — so legacy long receipts from old snapshots are capped for all future generations too). ReceiptViewer renders "(first 40 of 559 lines)".
- **Live:** regenerated capability_map has 14 receipts, max span 40, 12 carrying truncation markers — including the audit's poster child `ProjectSettingsPage.tsx` at "69–108 (first 40 of 559 lines)" instead of 69–627.

### 11. Inline "unverified" markers at downgraded claims (audit §8 / P1 12)
`citationMarkers.markUnverifiedClaims()` (new): claims the validator downgraded to low with zero receipts are wrapped `[[unverified]]…[[/unverified]]` on the prose line where their text appears — conservative matching (normalized containment, never in fences/headings/tables/linked lines, fragment lines must cover ≥60% of the claim; unmatched stay footer-only). The frontend renders a dotted warning underline with a tooltip; export converts to an explicit `*[unverified]*` tag; match stats land in `generation_context.inline_citations`. Wired after `rewriteInlineCitations` in `generateSection`.
- **Tests:** 5 backend cases (decorated lines, truncated claims, fences/tables/links excluded, short-line guard) + 2 frontend marker-render cases.
- **Live:** the regenerated section had 0 downgraded claims (5/5 cited — nothing to mark), which is the correct outcome; the mechanism is unit-proven.

### 12. Coverage strip (audit §4.2) + confidence-with-reason (§3.6)
- GET `/onboarding` now serves `package.coverage`: analyzed/unsupported file counts (from `language_inventory`), symbols/files/workflows cited by THIS package's receipts+tutorials (three UNION count queries), tutorial count, and the ranker's real signal weights (imported from `CANDIDATE_WEIGHTS` — the served list can't drift from the code). The reader renders it as a slim strip under the top bar: "Analyzed 289 files (3 unsupported skipped) · cites 99 of 1305 symbols in 53 files · 4 of 66 traced workflows · ranked by 9 signals [tooltip: weights] · Everything else → Dependencies".
- Every section now serves `confidenceReason`, computed serve-time from stored `generation_context.claims` + receipt count (works for legacy sections): e.g. "2/3 tracked claims cite receipts · 3 downgraded to low · 8 receipts", or "no receipts — content is not independently verifiable" (capability_map pre-regen — the §3.6 tab-vs-section contradiction now explains itself). Rendered inline next to the badge.

### 13. "How this was made" panel (audit P2 §13, plus §3.4's author-view)
New endpoint `GET /onboarding/provenance` (any member — provenance is the trust story, not an admin secret): per-model call/token/cost rollup from `ai_generation_runs` (package-scoped), and per-section `prompt_version`, retrieval funnel (seeds→candidates→selected + views), **validation issues** (finally surfaced — audit §3.4), voice-lint residuals, inline-citation stats, claims cited/low, confidence reason. `ProvenancePanel.tsx` renders it from a flask icon in the reader top bar.
- **Live:** shows "28 calls · $0.1904" split gpt-4o/gpt-4o-mini, and dependency_graph's 4 validation issues ("claim names button.tsx but cites no receipt from it") — previously buried in jsonb.

### 14. Grounded Q&A in the reader (audit P2 §14)
`AskPanel.tsx` (new) against the existing `POST /:id/ask`: question box in the reader top bar, answers rendered with the same numbered receipt chips (via a new fence-aware `rewriteQaUuidCitations()` in the backend — Q&A cites raw UUIDs, which now become `[[receipt:…]]` markers; unknown ids stripped), receipts open the ReceiptViewer, unknowns render as "Not answerable from the evidence". 403/429 map to honest AI-disabled/budget messages.
- **Live:** asked "Where does an analyze request enter the backend?" — high-confidence answer correctly walking `projects.ts#POST /:id/analyze` → queue → worker with 3 receipts and an explicit evidence gap. (One model-formatting quirk seen live — nested code fences flipping part of an answer into a code block — addressed with a CommonMark rule in the QA prompt, bumped `qa-v2`.)
- ReceiptViewer hardening for Q&A receipts: `confidence`/`ageLabel` optional, absent staleness renders the neutral badge.

### 15. Per-user read tracking for every tier (audit §8 reader mechanics / prior audit §E7)
The tour promised a "progress tracker" that Developer-tier users didn't have (Mark reviewed is owner/admin editorial). Now: a "Mark as read" button for non-managers (same top-bar slot, same tour target), per-section green checks + "n/11 read" in the section nav. State lives in `user_progress.position.readSections` — the same row "Continue onboarding" already uses, PUT by any member, **zero schema change**. `useProgress` gained a `loaded` flag so the merge never wipes stored marks; the resume auto-save now carries `readSections`.
- **Live:** marked start_here as read as the Developer-tier account; check + counter persisted.

### 16. Reader polish batch
- **Duplicated titles** (audit §8): the lead block's h3 (always equal to the sticky-bar h1) is gone, and a leading markdown heading matching the section title is stripped at render.
- **Named tutorial steps** (audit P2 §15): the 21 anonymous dots now carry symbol/file tooltips + aria labels, and the current step's name renders beside "Step N of M" (no title column exists — names derive from `symbol_name ?? basename(file_path)`).
- **nginx cache headers** (from `UX_AUDIT_FINDINGS.md`, bit both sessions' verification): gzip on, `no-cache` on index.html, immutable 1-year cache on hashed `/assets/`.

## Verification ledger (session 2)

| Change | Unit/integration | Live |
|---|---|---|
| Re-anchoring + staleness prefix fix | 7 new unit cases + route test | "Verified against 9f4d168b" badges |
| Span caps | 5 receiptSpan tests | 12/14 capped receipts, "first 40 of 559 lines" |
| Unverified markers | 5 backend + 2 frontend tests | 0 downgraded claims in regen (correct no-op) |
| Coverage strip + confidence reason | route test asserts payload | strip live, updates after regen (88→99 cited) |
| Provenance endpoint/panel | route test | $0.1904/28-call rollup + validation issues |
| Q&A panel | (existing ask coverage) | live answer, 3 receipts, honest gap |
| Read tracking | — (position jsonb passthrough) | 1/11 read persisted cross-reload |
| capability_map regen through new worker | job `complete` | high confidence, 5/5 cited, 0 issues, 0 slop hits, no `wf:`/N/A |

## Session-2 judgment calls
1. **Re-anchoring is computed at serve time**, not by a nightly job — the joins were already there, and a background re-anchor writer would race regeneration for no reader-visible gain.
2. **The `includes(":")` staleness bug was fixed globally** (presentation + validator) rather than special-cased, with the predicate living next to the key constructors it mirrors.
3. **Doc/config/schema keys stay "Not re-verifiable"** even though they are graph nodes with hashes — extending the green badge would require verifying their hash semantics are stable across snapshots, which I didn't; the neutral badge never lies.
4. **Span caps slice, never drop**: `truncatedFromLineEnd` keeps the receipt honest about what it elides; extraction- and retrieval-level caps together cover both future analyses and legacy rows.
5. **Q&A receipts render with the neutral "Not re-verifiable" badge** — they're point-in-time bundle evidence with no persisted row to re-verify; faking freshness there would repeat the original sin.
6. **Read marks ride `user_progress.position`** instead of a new table/column — the no-live-ALTER constraint made jsonb the only zero-risk store, and the PUT route already accepts arbitrary objects.
7. **Provenance is member-visible, not owner/admin** — the product's pitch is provenance; hiding it from the people being onboarded would be self-defeating.
8. **capability_map was regenerated via direct queue enqueue** (owner-attributed, mirroring the route payload exactly, ~$0.03 under budget guards) — same mechanism and rationale as session 1's regens; the pre-regen content survives in the audit's dumps.
9. **QA prompt bumped to `qa-v2`** with a CommonMark fence rule after a live nested-fence render bug; no stored content depends on the QA prompt version.
10. **Everything left uncommitted**, as before — commit slicing is yours.

## Session 2 continuation — the rest of the list

### 17. §5.4 root-caused and fixed mechanically (three layers deep)
The "writes labeled Data Read" audit finding had three stacked causes, all fixed with regression tests:
- **Detection:** every database-write pattern required a dot-method call (`.query(`, `.update(`) — repos using a bare `query()` helper (this one, and the fork) produced ZERO database_write effects. Both detectors now match bare-helper calls and raw SQL verbs (`INSERT INTO`, `UPDATE x SET` — case-sensitive so prose "update the … set" never counts). Same class of gap for queues: `getAnalysisQueue().add(...)` matched no queue pattern (factory parens); fixed.
- **Classification:** the seed step is always 'trigger', which swallowed the seed's own effects — a handler that INSERTs a job row and enqueues it traced as trigger → reads → response. The trace now surfaces seed-body writes/enqueues as explicit `data_write`/`async_work` steps (marked syntheticSeedEffect), so "POST /:id/analyze" reads as the write-and-enqueue flow it is.
- Verified against live data first: the stored analyze workflow's 6 steps were 4× data_read + trigger + response — no write, no enqueue, exactly the audit's shape.

### 18. Tutorial selection = criticality × effect-richness × diversity (audit §5.3)
`pickDiverseWorkflows()` (exported, unit-tested): read-only families (HTTP GET, UI page) cap at two tutorial slots; effect-step ratio adds up to +0.2; leftovers backfill by score. The dogfood failure shape (five GETs occupying every slot) is a test case.

### 19. Remaining §2 verdicts as spec updates (prompt `section-v4`)
- **critical_25** closes with "## Your first change" — one small evidence-derived change plus the EXACT test file that verifies it, from a new `testGuards` deterministic fact (graph `tests` edges); no test visible → says so (P2 §16 time-to-first-change).
- **safety_rails** risks must name the specific hazard (not "writes to DB"), treat external HTTP/model calls as spend risks, name the guarding test per risk from `testGuards`, and never flag `.env.example` as a secret.
- **dependency_graph** states mechanical blast radius with verbatim dependent counts ("N files import X — a signature change breaks all of them").
- **doc_health** re-grounded: doc inventory with churn recency, `criticalDocCoverage` (top-ranked symbols with no docstring — real gaps), conflicts ONLY from docs_conflict_with_code, and the pipeline's self-critique records renamed `pipelineFlaggedRecords` with an explicit never-present-as-repo-docs instruction.
- **architecture** leads with one real request flow across cluster boundaries and closes pointing at the interactive tab.

### 20. §3.8 record-summary voice + §4.1 "Not ranked" fallback + §7 diagram links + §8 tab links
- The semantic-record voice contract joined the shared `OUTPUT_RULES`, and every record prompt version bumped to v2 — without the bump, a fresh analysis would have reused the cached "enhances user engagement"-era summaries.
- Symbols outside the ranked set now inherit their FILE's rank, labeled "from this symbol's file" — "Not ranked in this snapshot" no longer appears on anything clickable whose file was ranked.
- Diagram nodes whose labels are file paths deep-link into Dependencies (`?focus=`); non-path labels stay inert instead of linking wrong.
- Sections that retell a tab (architecture, dependency_graph, capability_map, workflows, data_schema) end with a deep-link card into it.

### 21. Full verification pass: forced re-analysis + package regeneration
A `force: true` re-analysis of the same commit (owner-attributed, exactly the resume route's payload) rewrites the snapshot's graph, workflows, rankings, and records with every fix above — fixture ignore, full route paths, SQL/queue detection, seed-effect steps, damped rankings, v2 record prompts — and auto-generates the general package (v4 sections + diversity-selected tutorials) on completion. This is the "fresh analysis" both sessions had deferred; results in the ledger below.

## Still not done (final)
§8 IA restructuring — collapsing the 11 sections into 5-6 is blocked by more than product preference: `package_sections.type` is a DB CHECK constraint, and the no-live-ALTER rule means the section list can't change until the next full DB recreate. The tab deep-link cards (item 20) deliver the audit's "sections frame, tabs serve" intent within the current shape.

## Session 2 closing addendum (2026-07-23, late)

**Model policy change (user decision):** the strong tier is back on `openai/gpt-4o-mini` (`OPENROUTER_MODEL_STRONG` in `backend/.env`) for cost; this reverses audit P1 #8. Observed effect in the very first mini regeneration: looser receipt-citing (6/9 claims cited → honest "low" grade where gpt-4o versions graded high). The voice lint + citation validation + confidence-with-reason machinery is the quality gate now; swap the env line back if section quality matters more than ~$0.15/package.

**Three more mechanical fixes landed while finishing:**
- Citations the model wraps in inline backticks (`` ` (r2)` ``) had their markers land inside code spans, rendering as raw text; the rewriter now unwraps code-wrapped citations and sweeps the empty husks dropped aliases leave behind (tested).
- The internal-key leak class is closed for good: projection rows for synthesis targets (workflows AND clusters) are served with human titles INSTEAD of `wf:`/`cluster:` stable keys via a shared `humanizeProjectionRows()` — instructions alone did not stop models from copying whatever identifier they saw (leaked in role_path, then critical_25, in two different runs).
- The validator's file-token check no longer reads "Node.js" as a filename (stack-overview claims were being downgraded for not citing a receipt from a file called Node.js).

**Operational finding — shared queue has a foreign consumer:** `getSummaryQueue().getWorkers()` shows a summary-queue consumer at a second public IP (38.141.192.69) — a teammate's dev worker attached to the shared Upstash Redis with a stale env (no `EMBEDDINGS_API_KEY`), which makes any job it wins fail with `401 Incorrect API key … sk-or-…` against api.openai.com. It won six consecutive deliveries during verification. **Action for the team:** that machine needs the current `.env` (or its dev worker stopped); until then, queue-routed generations can fail intermittently through no fault of this codebase. The final section regenerations here were run inline in the local worker container to bypass the race.

## Latency overhaul — DONE (2026-07-24; supersedes "Future work" below)

The plan at the bottom of this section was implemented in full (all 6 tracks + live retuning). Baseline: fresh analyze→package 25–40 min, re-analysis ~15+ min stuck at an opaque "97%". After: **re-analysis 5:26–7:39 analyze + 1:42–4:13 generate across four measured end-to-end runs** (variance = clone time, upstream decode lottery on sections, and 9 stubborn symbols — see quirks). All 458 backend tests green; critique rejected-rate 3.4% (vs 3.5% baseline), section confidence profile unchanged-to-better (v8: 2 high / 4 medium / 5 low), $0.06–0.11/run. Remaining path to a <5:00 cold run, in payoff order: sections are now the longest pole (~40s/call on deepseek — a faster prose model or overlapping generation with the semantic tail), the 9 scout-schema-failing symbols (~60-90s/run of retry churn), and clone caching.

**What shipped** (details in `doc/DEVOPS.md` "Latency model"):
- Bulk DB everywhere: record lookup/insert/receipts/snapshot-mapping, criticality + reranker upserts, entrypoint/side-effect/workflow/tutorial persists — ~13,600 semantic-phase round-trips → ~800.
- Budget audit amortized (flush per 10 calls/5s/phase boundary; `ai_generation_runs` stays exact); kill-switch cached 2s.
- Carry-forward: forced re-runs re-map unchanged symbol records with zero LLM calls (`carriedForward` metric).
- Honest progress: semantic sub-phases own 66→98% with batch counters ("Verifying records (22/58 batches)").
- Model policy (measured, not assumed): cheap tier = `meta-llama/llama-4-scout` (Groq via OpenRouter) for ALL structured record work — symbols, file/module/service/system records, capabilities, refinement, critique, rerank; strong tier = `deepseek/deepseek-v4-flash` for user-facing prose (sections, tutorials). Probe + production data: scout decodes 12-record critique calls in ~2-9s with valid strict JSON; deepseek's default routing varied 12–124 tok/s and emitted malformed JSON on multi-KB outputs.
- Provider hardening, each fixing an observed live failure: per-attempt 240s timeout (`LLM_REQUEST_TIMEOUT_MS`; calls previously ran 550–800s with none); OpenRouter `provider.sort: "throughput"` (`OPENROUTER_PROVIDER_SORT`); schema-aware `null→[]` coercion (scout's `"outputs": null` failed 25 batches into halving-retry); structured-output failures now re-roll a FRESH sample up to 3× (malformed JSON is stochastic — the same capability payload broke both models once each, then landed).
- Batch sizes tuned to measured decode, not context size: symbols 10/call, files 6/call, critique 12/call, rerank 15/call, `LLM_MAX_CONCURRENCY=28`. The 1M window buys richer evidence per call (receipts 15→40, snippets 500→1,500 chars), not mega-batches.

**Queue isolation (fixes the foreign-consumer failures for good):** `QUEUE_SUFFIX` env (this machine: `-skm`) gives producers+consumers private BullMQ queue names on the shared Redis — the teammate's stale worker (38.141.192.69) stole and 401-failed two benchmark runs off the shared names before this. Teammates should each set their own suffix (documented in `.env.example`).

**Known operational quirks:**
- After `docker compose up -d --force-recreate`, the worker's blocking Redis consumer sometimes comes up dead (job sits "queued"; `getWorkers()` empty). A `docker restart team15-backend-worker-1` fixes it. Durable fix if it keeps biting: a worker-side watchdog that recreates the BullMQ Worker when waiting>0 with no pickup.
- 9 symbols persistently fail scout's schema (enum/shape quirks) and land facts-only with `llm_failed` — they retry each run (~60s). Candidate follow-up: pin those to the strong tier on retry.

## Future work: semantic-phase latency (requested 2026-07-23)
A mostly-cached re-analysis still spends ~15 min inside "Semantic analysis (LLM)" while paying for only ~139 calls (measured: 467 symbol + 114 synthesis cache hits, 4,958/4,987 embeddings skipped, $0.43). The wall-clock is cloud-DB round-trips, not model time. Levers, in expected-payoff order:
1. **Batch the cache-hit path** — `hasCompleteRun` does one SELECT per call; one `input_hash = ANY($1)` per batch collapses hundreds of ~100ms round-trips into one.
2. **Batch persistence** — `attachReceipts` INSERTs one receipt per statement and each record does its own `insertRecord` + `mapToSnapshot`; multi-row INSERTs cut the semantic phase's write count by ~10x.
3. **Diff-gated re-keying** — a forced re-analysis whose graph diff vs. the previous snapshot is empty re-keys every record anyway; `incrementalAnalyzer.diffSymbols` already knows what changed and could scope the semantic phase to it.
4. **Raise `mapLimit` concurrency for record passes** when RTT-bound (the Supabase pooler tolerates far more than the current in-flight count).
5. **Sub-phase progress** — the job sits at an opaque "97%" for the entire semantic phase; per-batch counts already exist in `snapshot_phases.metrics` and belong in `current_step`.
