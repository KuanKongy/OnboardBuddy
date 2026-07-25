# Onboarding redesign: Diátaxis architecture + quality + latency (2026-07-24)

Scope: the **Validation/Onboarding Quality** pain points from `doc/M4_PLAN.md` (lines 51–62) and the bench targets written there ("300k 5min / 2m 10min"). Framework: [Diátaxis](https://diataxis.fr/) — four documentation modes on two axes (action↔cognition × acquisition↔application): **tutorial** (learn by doing), **how-to** (accomplish a goal), **reference** (look up facts), **explanation** (understand why). Core rule: one mode per document; blending modes serves none. Full framework summary, per-mode writing rules, and the **post-evaluation rubric** live in `doc/DIATAXIS_NOTES.md` (from a complete read of the site) — specs and content evals both work from that file.

Decisions made with the user (2026-07-24): 4-chapter/12-section layout · Common Tasks auto-derived from the repo · reference sections deterministic-first with LLM annotation only · chaptered sidebar with role-driven reading order.

## Why restructure (diagnosis)

- Most current sections are mode blends written as tab-teasers (specs literally said "Keep it short: this section is the narrative companion to the interactive tab") — measured result: the full 11-section package on the ≈2.3M-token dogfood repo totals **7,500 words** (architecture: 1,021 chars). A single timed Claude-produced onboarding doc over the same repo carried ~3,500 words with far more per-word substance.
- The **how-to quadrant doesn't exist** — M4's most practical asks ("easily followed when actually performing tasks", "dummy starter task", "input your responsibility, exercise") live exactly there.
- Reference material (routes, schema) is LLM prose — the mode where hallucination risk is highest and value of prose lowest (gemini's validator issues concentrated exactly there: entry_points 31, safety_rails 17).
- A new joiner is in *acquisition* mode; nothing about the current flat 11-list tells them what to read, in what order, or why.

## The new architecture — 4 chapters, 12 sections

Every section keeps today's receipts/citations/confidence machinery. `[anchor]` = the diagram that opens the section, per the rule **anchor diagram first** (readers want the picture before the prose refers to it).

### ORIENT — read first, ~10 minutes, pure explanation
1. **`big_picture`** — What this system is, the subsystems, how data flows between them, and why it's shaped this way. [anchor: system-level mermaid — clusters + arrows, deterministic from architecture_clusters/_edges]. Sources: system/service records, cluster edges, workflow crossings. Voice: discursive explanation; no instructions, no tables; links forward to Consult for details.
2. **`concepts`** — The load-bearing vocabulary the code uses (for OnboardBuddy: snapshot, scope, package, record, receipt, capability, criticality view…). Each term: what it means here, where it lives (table + module), one receipt. Sources: schema comments, record summaries, naming clusters. New joiners fail conversations without these nouns; nothing serves this today.

### UNDERSTAND — the deep middle, explanation + annotated reference
3. **`architecture_deep`** — Per-subsystem: responsibility, boundaries, what crosses them, design decisions and trade-offs visible in the evidence (e.g. "transaction-mode pooler ⇒ no session state ⇒ every lock is a row lock"). [anchor: per-subsystem mermaid, deterministic]. Absorbs the old dependency_graph narrative; the interactive graph tab stays the drill-down surface, deep-linked.
4. **`traced_flows`** — 3–5 end-to-end walkthroughs chosen by workflow rank + diversity (request flow, background pipeline, auth, data write). Per flow: [anchor: sequence diagram, deterministic from workflow steps] → then step-by-step narrative naming real functions in order, one code excerpt per hop (receipt snippet, `path:line` header), and a "why this design" note per non-obvious hop. M4: "explain process and reason behind process; show code."
5. **`code_map`** — The files that matter, **grouped by subsystem** (ranking selects the ~25–40 entries; grouping presents them — answers M4's "why have a ranking in an onboarding doc?"). Per file: why it matters (1–2 sentences), key functions in the familiar format `name(signature) — one-liner · params · returns · gotcha` (M4 line 57, straight from symbol-record inputs_outputs), what calls it / what it calls. Per-file narratives are M4 line 60 verbatim.
6. **`capabilities`** — What the system does for its users, each capability mapped to the clusters/files that implement it, with the 1–2 seams you'd touch to extend it. Sources: capabilities + members + records.

### DO — practical, tutorial + how-to voice (imperative, verifiable steps, no theory detours)
7. **`setup_run`** — Guaranteed-success first run: prerequisites, env, run, **verify checkpoint after every step** ("you should see…"). Failure-mode boxes for the 2–3 most likely breaks (from docs + config evidence). Tutorial mode: the reader must succeed.
8. **`first_change`** — A starter exercise auto-derived from the repo: a small, real, safe change (the kind of file the repo itself changes most often, with tests adjacent), exact files to touch, expected diff shape, how to verify, and what reviewing it teaches. M4 lines 53/61.
9. **`common_tasks`** — The how-to quadrant, auto-derived: mine graph_edges/entrypoints/side_effects/test edges for this repo's recurring change patterns (add an API route, add a table/migration, add a queue job, write a test for X, add a UI page…) and emit the 4–6 most common as goal-titled recipes: steps, the real files each step touches, an existing example to copy from, verification. Recipes cite the exemplar files as receipts.

### CONSULT — reference: austere, deterministic-first, byte-stable
10. **`routes_jobs`** — [anchor: route-group map]. Tables generated **from SQL/graph facts, not the LLM**: HTTP route → method → auth tier → handler file:line; queues → job types → processor; webhooks. LLM writes ONLY the intro paragraph and one-line purpose annotations per group. Regenerations are byte-identical where facts are unchanged.
11. **`data_model`** — [anchor: ER mermaid, deterministic from the schema]. Per table: purpose annotation (LLM, one line), key columns, relationships, the invariant comments that matter (from migration comments). Same deterministic-first contract.
12. **`guardrails_ops`** — Budgets/kill switches/privacy modes/secret filtering/env vars: a table of every guardrail — what it protects, where enforced (file:line), how to configure. Deterministic backbone from config/code facts; LLM annotates.

### Overlays (not sections)
- **Role reading order** (replaces `role_path` as a content silo): per role, an ordered path over the 12 sections with per-item "why you specifically" one-liners; drives the sidebar's "Suggested for you" rail and resume position (user_progress already exists).
- **Trust panel** (absorbs `doc_health`): staleness/coverage/confidence lives in the existing provenance/trust UI; doc-vs-code staleness diffing (M4 line 62: flag outdated docs — compare doc/*.md claims against deterministic facts: routes, table names, env vars) feeds it.

### Reading order ≠ shelf order (from the full Diátaxis read — see doc/DIATAXIS_NOTES.md)

The chapters are the *shelf* (mode-first, so each section stays mode-pure). But Diátaxis's user journey is a cycle (learning → goal-pursuit → information-seeking → reflection), so the **role reading order interleaves modes** — a new joiner needs a tutorial early, not after all the explanation. Default general-role order:
`big_picture` → `setup_run` (do something on day one) → `concepts` → `traced_flows` → `first_change` → `code_map` (their subsystems first) → `common_tasks` → `architecture_deep` → `capabilities` → Consult as needed. Roles reorder/emphasize (devops pulls `guardrails_ops` forward, frontend pulls the UI flow trace forward).

Two more rules the full read adds:
- **Chapter headers are overviews, not link lists**: each chapter gets a 2–3 sentence intro blurb in the sidebar/landing ("lists longer than ~7 items are unreadable"; our 2–4 per chapter passes, but the blurb is what makes the landing "read like an overview").
- **Reference structure mirrors the product**: routes_jobs organizes by router mount order (as in `routes/index.ts`), data_model by the schema file's own section order — so readers navigate code and docs in parallel.

## Presentation rules (encoded in every spec)

1. **Anchor diagram first** — the section's mermaid opens the body; prose refers back to it. Deterministic generation; inserted via `[[diagram:kind]]` markers replaced post-generation so the LLM can't corrupt mermaid.
2. **TL;DR box** at top: 2–3 sentences + "after reading you can …".
3. **Mode purity** — per-chapter base system prompts with the mode's voice: explanation = discursive why; tutorial = imperative + verify steps, zero theory detours; how-to = goal-first recipe; reference = tables + one-liners, no narrative. (Diátaxis's own style prescriptions.)
4. **Code-forward** — every substantive claim block shows the excerpt it's about (receipt snippet, path:line header).
5. **Familiar micro-format** everywhere functions appear: signature · one-liner · params · returns · gotcha.
6. **Ranking invisible** — selection/grouping signal only; never scores in prose.
7. **Depth contract** — per-section output budget `base + k × min(symbolCount, cap)`; large sections shard into parallel calls (code_map by subsystem, traced_flows per flow, common_tasks per recipe) and concatenate deterministically — depth scales, wall-clock doesn't.
8. **Cross-links, not repetition** — sections link to each other and deep-link into tabs; a fact lives in one mode and is referenced from the others.

## Consistency + accuracy machinery

- **Section cache**: key = (snapshot, section type, spec prompt version, evidence-bundle hash). Unchanged evidence ⇒ byte-identical section (M4 line 52's stochasticity complaint) and ⇒ regeneration cost ≈ 0.
- **Section critique** (cheap tier): claims vs cited receipts, exactly like record critique; rejected paragraphs regenerate once with the critique attached.
- Deterministic-first reference sections eliminate the highest-risk hallucination surface outright.
- Existing voice lint + citation validator + confidence-with-unknowns stay; low-confidence sections state "what would raise this".

## The rest of the product surface through the Diátaxis lens

The tabs already map cleanly onto quadrants — the redesign strengthens the mapping rather than fighting it:

- **Architecture / Dependencies / Classes / Workflows tabs** = interactive *reference* (Diátaxis's map analogy, literally). Keep them austere and data-true; sections deep-link in (exists). The M4 "no way back after drill-down" item is a reference-usability bug worth fixing when touched.
- **Tutorials tab** = tutorial quadrant. Aligned fix (also in M4): **remove the role chooser there** — a tutorial is a single unbranching path; role relevance belongs to the reading-order overlay, not a filter inside the lesson.
- **Ask panel** = on-demand how-to/reference. Pleasant alignment: `askService.classifyIntent` already implements the compass — extend it so the *answer voice* matches the classified mode (a "how do I" question gets conditional-imperative steps; a "what is" question gets an austere factual answer; a "why" question gets explanation).
- **Onboarding landing** = the chapter-overview rule above (overview prose, not a link list).

## Schema & frontend impact

- `package_sections.type` CHECK constraint — **DONE 2026-07-24**: `001_initial_schema.sql` now lists the 12 new ids alongside the legacy ids (so current generators keep working until the new specs ship); the user applies the schema. Drop the legacy block once the redesigned specs replace the old ones.
- `sectionSpecs.ts` is the main implementation surface (specs = deterministic SQL + instructions + diagrams already); add chapter metadata per spec.
- OnboardingPage: chaptered sidebar (Orient/Understand/Do/Consult), "Suggested for you (role)" ordered rail, resume position; section renderer gains the TL;DR box and inline-diagram placement.
- Export (markdown) mirrors chapter order.

## Latency: 2M ≤ 10 min — GATE PASSED (2026-07-24)

Measured on gemini-2.5-flash-lite, fully cold (fresh DB, zero cache), **two repos concurrently on one worker**:

| | OnboardBuddy (≈2.3M tokens, 268 files) | FloowForge (small) |
| --- | --- | --- |
| analyze | **6:04** (symbols 61s · synthesis 55s · capabilities 25s · refinement 11s · critique 34s · rerank 15s · embeddings 121s) | 2:53 |
| generate | **0:37** | 0:47 |
| end-to-end | **6:41** | 3:40 |

- M4 gate (2M ≤ 10:00): **PASS at 6:41, cold and concurrent** (solo is faster).
- Claude-baseline gate: timed Claude agent over this repo = **6:16** (45 files, ~179k tokens); +2:00 grace = 8:16 → **PASS**.
- Quality on gemini: critique rejected 7/695 (**1.0%**; deepseek 3.5%, scout 3.4%), 0 failed symbols, 0 unreceipted claims, **$0.36/cold run**.
- The redesign's cost model: deeper sections ship as parallel shards (≤ ~90s generation fresh at ~3× depth); deterministic reference sections and the section cache make re-generation nearly free. Next knob if needed: embeddings are now the longest phase (121s).

## Sequencing

0. ~~**Data acquisition first — journeys + coverage**~~ — **DONE (2026-07-24)**: consumer handler-reference seeding (`entrypointDetector.ts` — the SUMMARY-consumer root cause was `new Worker(Q, handlerRef)` bare references), auth/identity + external-service + process-exec sinks with enqueue queue-hints (`sideEffectDetector.ts`), the honesty rule (`unknown_external` fallback + `TraceDeadEnd` recording + snapshot `unknowns` rollup; no schema change — unknowns ride `external_integration` + `metadata.detectorKind`), config-as-flow (`configFlowExtractor.ts`: compose topology stamped on the compose config node, dev/test/CI journeys as `dev_command`/`ci_pipeline` workflow rows), journey composition (`journeyComposer.ts`: queue-boundary pipelines via normalized queue tokens, auth group, OAuth/import chain with terminal POST; journeys are workflow rows `trigger_type='journey'` — ranking/selection/tabs consume them with zero new machinery), the golden-journey gate (`journeyGate.ts`, shape-conditional, gaps → snapshot `unknowns`), and journey-first tutorial selection (bonus in `tutorialGenerator.selectWorkflows`). Suite 486 green; fixtures extended (bare-reference consumer, supabase-auth routes, compose/CI in mixed).
1. ~~Schema: new type ids into 001's CHECK~~ — done (legacy ids kept during transition; user applies).
2. ~~Spec rewrite~~ — **DONE (2026-07-24)**: 12 specs shipped (`sectionSpecs.ts` full rewrite: chapter+mode per spec, per-mode voice scaffolds in `sectionGenerator.ts`, TL;DR rule, depth contract via size-classed output budgets); CONSULT backbones deterministic (`referenceBackbones.ts` — route/queue/webhook tables, table inventory with parsed FKs, env-var + guardrail tables — spliced at `[[backbone]]`, byte-stable, model annotates only); anchors first (topology diagram from compose+env for big_picture — `topologyDiagram`/`erDiagram` in `diagrams.ts`, FK extraction added to `configScanner.ts`); traced_flows draws from journeys with per-journey sequence anchors; deterministic receipts merged into every bundle (`collectSectionReceipts`) so prose about deterministic facts is citable; mode-aware citation validation (reference sections: uncited backbone claims are the contract); **deterministic completeness check** with targeted retry (gemini ships TL;DR-only ~50% on enumeration sections — "you covered 0 of 4" retries fixed it: capabilities 303→5.4k chars, common_tasks 605→3.8k); legacy sections/orphaned tutorials cleaned at full generation. Verified on the dogfood repo: 12/12 sections, 71.6k chars ≈ **13.8k words (was 7.5k)**, all four anchor kinds render, routes/data-model/guardrails tables complete with job names and FK chains. **Deviation from plan:** no sharding — at measured 1.3-1.5k tok/s decode, the largest section fits one call; sharding deferred until a repo needs >17k output tokens in one section. Residual for step 5 (section critique): the uncited-claims tail on explanation sections (traced_flows/architecture_deep grade low with file-naming issues).
3. ~~Overlays~~ — **DONE (2026-07-24)**: role reading order shipped as a frontend overlay (`ROLE_READING_ORDER`/`SECTION_WHY` in onboardingData.ts + "Suggested for you" rail: next 3 unread in the role's interleaved order, resume-aware; chapter blurbs render under the nav group headers). Trust panel absorbed doc_health: deterministic doc-vs-code staleness (`docHealthCheck.ts` — routes and env-var claims in docs compared against extracted facts, file-path/prose false positives filtered) feeds snapshot `unknowns` → coverage strip "known unknowns" tooltip. Verified live on the dogfood repo: 3 precise conflicts (DEVOPS.md documents `OPENROUTER_MODEL`/`OPENROUTER_MODEL_STRONG`, absent from the fork's env template). role_path/doc_health prose specs were retired in step 2.
   **Also landed (user directive, 2026-07-24): auto model rotation.** Provider throughput on OpenRouter swings intra-day (measured: gemini 108→113tps, scout 37→48tps between two runs 20 min apart), so `modelSelector.ts` probes `/api/v1/models/:id/endpoints` for gemini/deepseek/scout before each job, filters endpoints on structured-output support + ≥200k context + uptime, ranks by p50 throughput, and picks the winner — privacy first via request-level `provider.data_collection='deny'` (the only machine-enforceable policy signal; the endpoints/providers APIs expose no retention fields). Record-cache stickiness: the incumbent model keeps the slot unless a rival is ≥1.25× faster (semantic records key on model id — flips invalidate the cache). Settings "Analysis model" gains **Auto (default)** + scout; explicit pins bypass selection. Selection is visible in the run panel ("Model: … (live throughput pick)") and cached 5 min so analyze→generate→ask share one pick. Failure of the probe falls back to env defaults, never blocks a job.
4. ~~Frontend~~ — **DONE (2026-07-24)**: chaptered sidebar with blurbs + suggested rail landed with steps 2–3; this pass added the **TL;DR callout** (the generator's leading `**TL;DR:**` paragraph renders as a styled box, receipt markers intact) and **export mirrors chapter order** (sections sorted by the 12-type shelf order with chapter headings + blurbs; legacy types sort after).
5. ~~Section cache + section critique~~ — **DONE (2026-07-24)**: cache key = sha256 of the DETERMINISTIC inputs (prompt version v5, spec instructions/mode/role, depth budget, deterministic facts, spliced backbone). Retrieval records/receipts are deliberately EXCLUDED — measured: the top-K set wobbles run-to-run and turned the cache into a coin flip (9/12 → 5/12 across runs); keyed on facts it hit **11/12** with the miss explained by a pause hole. Hits clone content byte-identically + re-attach receipt copies; warm regeneration = ~3 section LLM calls instead of ~30. **Section critique** (cheap tier, `section_critique` audit rows): every cited claim judged supported/unsupported/contradicted against its receipt snippets; unsupported-majority or any contradiction triggers ONE critique-driven rewrite (observed live: traced_flows 16/20 unsupported → rewrite); residual contradictions downgrade confidence + land in unknowns. Verdicts persist in generation_context. **Also hardened**: the dead-consumer watchdog (lib/queueWatchdog.ts, in-process close+recreate on two zombie samples — fired live and self-healed in ~2 min) and worker crash guards (a dangling BudgetExceededError from the tutorials fan-out killed the process once; rejections now marked handled at creation + process-level log-don't-die guards). Privacy upgraded to **ZDR-only routing** (`provider.zdr: true`, verified live for all three rotation models). Not cached yet: tutorials (~4 calls/regen).
6. ~~Re-bench + content re-audit~~ — **DONE (2026-07-24)**.
   **Bench (concurrent forced re-runs, one worker, auto-selected gemini):** OnboardBuddy analyze 1:04 + generate 0:50 = **1:55 end-to-end**; FloowForge 1:47 + 1:45 = 3:32; both together ≈ **$0.13**. Fully-warm regeneration: 10/12 sections + 4/4 tutorials cache-hit ⇒ **6 section + 4 critique LLM calls total, zero tutorial calls**. (Cold analyze gates stand from the 2026-07-24 cold bench — 6:41 vs the 10:00 M4 gate — the semantic pipeline is unchanged; deterministic additions measure in-phase at seconds.) FloowForge proves generality: 12 sections, its 1 workflow + 1 config journey, journey gate demanded nothing its shape can't have.
   **Golden checklist (automated assertions on the live package): 17/19.** All CONSULT tables (routes incl. both queues' job types, data-model chain users→snapshots→receipts, env names), all anchors (topology/ER/4 sequences/cluster map), setup_run's verified single-path tutorial, ≥3 how-to recipes, 20-file code_map, big_picture journeys+services, traced_flows walking the pipeline AND auth with anchors. The two misses, with smallest-fix verdicts per the rubric: **concepts** names 9 solid terms but skips "snapshot"/"receipt" (fix: weight referenced-BY tables into the must-define stems); **architecture_deep** describes structure without decision→consequence language (fix: feed the decision-bearing config/doc comments — pooler mode, queue split — into its receipts).
   **Audit-driven fixes shipped during step 6:** cache quality gates (a crash-window EMPTY section had been cloned forward — now length/confidence/coverage-gated, and cached content is re-judged against TODAY'S completeness rules before reuse); tutorials cache clone-order + same-package keep (unique-index violation made every same-package hit silently fail); concepts completeness extended with schema-derived must-stems.
   **Rubric reading (tutorial + reference modes):** setup_run passes the tutorial gates ("we" voice, one unbranching path, "You should see:" with real ports, honest evidence limits); routes_jobs passes reference austerity (byte-stable fact tables, no instruction/opinion).
