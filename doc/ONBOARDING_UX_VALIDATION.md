# Onboarding UX Validation — Content, Trust & Transparency Audit

**Date:** 2026-07-23
**Artifact audited:** the dogfood analysis of `KuanKongy/OnboardBuddy` (fork of this repo) — snapshot `03e837f4` @ `main@9f4d168` (2026-07-16), 289 files · 1305 symbols · 66 workflows; `general`-role package `a1484e79` (11 sections, 4 tutorials), generated for $0.337 / 610 LLM calls / `gpt-4o-mini` on both tiers.
**Method:** full DB dump of the generated package (sections, receipts, workflows, capabilities, clusters, tutorial steps); claim-by-claim fact-check against a worktree at `9f9f469` (same-day sibling of the analyzed commit) with drift cross-checked against current `main`; live browser walkthrough of the reader and all five tabs as a Developer-tier user; pipeline code trace (prompts → retrieval → validation → serialization); external research on trust-UX patterns (DeepWiki, Sourcegraph, Swimm, NotebookLM, Copilot) and program-comprehension literature (Ko ICSE'07, Sillito FSE'06, LaToza, SWE-at-Google ch.10, Diátaxis). Complements `doc/UX_AUDIT_FINDINGS.md` (app-level bugs); this document is about the **onboarding content experience** itself.

---

## 1. Executive verdict

The user-facing questions this audit was asked to answer, answered bluntly:

**"Does reading the first section tell you what this project is and what's being done?" — No.**
`start_here` opens with interchangeable marketing prose ("a powerful system designed to facilitate project onboarding and management through seamless integration and enhanced user interaction… improving overall efficiency and user satisfaction"). After 3,086 characters a reader still does not know: it's a TS monorepo; React SPA + Express API + BullMQ worker; Supabase Postgres + pgvector; Redis queue; OpenRouter LLM; runs with `docker compose up --build`; tests with one command. Every one of those facts was available deterministically (package.json, docker-compose.yml, the language inventory the pipeline itself computed). The repo's own hand-written README explains the system better in one paragraph than the section does in eight — for the exact repo this product analyzes best. That is the benchmark the generator lost to.

**"Is reading the whole onboarding enough to understand the repo and make changes right away?" — Not today.**
The interactive tabs (Dependencies, Tutorials, Workflows, Architecture, Capabilities) genuinely move a newcomer toward "I know where things are." The 11 prose sections mostly don't — four are low-confidence, two have zero receipts, three contain confirmed hallucinations, and none tell you how to run, test, or safely change anything. There is **no build/run/test content anywhere in the package** (grep across all 11 sections: zero mentions of docker/npm/compose). A senior engineer's first three questions — how do I run it, how do I run the tests, where does a request enter — are answered nowhere, partially, and misleadingly, respectively.

**"Is it faster than reading the whole repo?" — Only if trust holds, and trust doesn't hold.**
The full section text is ~36k chars ≈ 25 minutes of careful reading — vs. days for 289 files. That's a real 100× reading-time win *on paper*. But the moment a reader hits one visible falsehood, they start re-verifying everything, and the speedup inverts (the documented DeepWiki dismissal pattern: "given the need to confirm whatever an AI says… it's hard to say that when it was correct it would have been faster"). This package hands a senior engineer a falsehood within the first screen (`worker/index.ts` described as "utility functions" — it's the 807-line pipeline orchestrator) and a dead citation label within the first paragraph ("receipt r14" — resolvable to nothing). The landing page promises "Every claim is linked to real code. No hallucinated documentation." The dogfood package breaks that promise on sections 1, 3, 8, and 9.

**The core diagnosis** — and the actually good news: the *deterministic* layer is sound. The fact-check verified 30 receipt/tutorial citations and found **zero fabricated snippets**; fan-in numbers are accurate to ±3; every cited route exists; the OAuth tutorial mirrors the real call chain step-for-step. The product's foundation — symbol graph, traces, receipts, confidence machinery, unknowns, cost audit — is exactly the right architecture, and it is ahead of DeepWiki on provenance design. The failure is concentrated in three places:

1. **The LLM prose layer squanders the evidence** — vague, template-y, sometimes wrong, systematically highlighting the wrong things.
2. **The citation UX is broken end-to-end** — inline labels point at nothing, chips are unnumbered and dumped at section bottom, the reader endpoint fakes freshness and drops claims.
3. **The ranking and extraction pipeline leaks noise** — test fixtures ranked as critical code, sub-router route names, hairball diagrams — and the "critical 25%" story is never actually told (no denominator, no coverage, no "here's what we left out and why that's safe").

Everything below is the itemized case, with evidence and fixes.

---

## 2. Section-by-section scorecard

Confidence/receipts are what shipped in the dogfood package. "Verdict" = what to do with the section type.

| # | Section | Conf. | Receipts | What it actually delivers | Verdict |
|---|---------|-------|----------|---------------------------|---------|
| 1 | `start_here` | high | 6 | Marketing overview; subsystem list that's just file names; "Read These First" = 5 UI pages + worker/index.ts mislabeled "utility functions" | **Rewrite spec** — must lead with stack, runtime topology, run/test commands, then oriented reading list |
| 2 | `architecture` | high | 1 | Deterministic cluster inventory restated with vapid "Role:" lines; generic any-app "Request Flow"; unreadable 15-node/60-edge mermaid hairball; 1 receipt = the analyzed repo's own ArchitecturePage.tsx (irrelevant) | **Shrink & defer to tab** — narrative "how a request actually flows" + link into Architecture tab; kill the mermaid dump |
| 3 | `entry_points` | high | 6 | 10 of 12 items are projects.ts CRUD; routes named without mount prefix ("GET /", "POST /"); two invented purpose lines (receipts route "validates user receipt submissions" — false; /validate — misleading) | **Rebuild deterministically** — full-path route table grouped by router + worker/queue/webhook/frontend entries; LLM only annotates |
| 4 | `critical_25` | low | 6 | Lists login/signup/dashboard pages as the critical 25%; the analysis pipeline (640 symbols, the product's core) absent; receipts contradict prose (chips point at semanticReranker/evidenceGraphBuilder — the *actual* critical files); 4 uncited claims still rendered as body text | **Fix ranking first, then rewrite as an ordered path** (it's titled "Learning Path" but is a taxonomy inventory: prompt literally orders "by category (symbols, files, workflows, clusters)" — `sectionSpecs.ts:151`) |
| 5 | `capability_map` | low | 0 | 5 real capabilities, but renders "**User Value:** N/A" five times and leaks `wf:`/`cluster:` internal IDs as dead chips; the Capabilities *tab* shows the same data properly with links and HIGH confidence — contradicting this section's LOW | **Kill as prose** — replace with capability cards deep-linking to the tab (or embed the tab's component) |
| 6 | `workflow_guide` | high | 15 | 4 of 66 workflows, mostly trivial reads (GET /, accept invite, a page render, a 2-step GET); the analyze→pipeline→generate flow — the product — absent; traces cite a **test fixture SQL file** as a data source; invitation-accept trace labels its defining writes as "Data Read"; sequence diagrams chain files into fictional call sequences (button.tsx → badge.tsx) | **Rewrite selection + diagram generator** (see §5, §7) |
| 7 | `role_path` | high | 6 | For role=general: the product's *end-user page journey* (Intro → Login → Dashboard → Settings…), not a developer learning path — LLM confused "onboarding users of the app" with "onboarding developers to the code"; `wf:` pseudo-links dead | **Merge into critical_25's ordered path**; one "your first week" narrative per role |
| 8 | `data_schema` | low | 0 | 25 table names each followed by the identical file path — and the count is **false** (37 tables; the 12 dropped are the app's own core: packages, sections, receipts, tutorials, embeddings…); retrieval returned zero candidates and validation hard-failed, yet it shipped; internal bookkeeping ("## Claims", "## Used Receipt IDs — r3") rendered to the reader; the mermaid renders as a 20-screen column of disconnected cylinders | **Rebuild 100% deterministically** — tables + columns + FK edges are in the migration; LLM adds only "source of truth" narrative, or the section states it couldn't and says so |
| 9 | `safety_rails` | high | 6 | Right concept, wrong content: risk lines are generic ("Database writes that may affect user invitations"); cites "r13" (doesn't exist; 6 receipts); one hallucination (lib/github.ts "database writes" — file has zero DB access); .env.example flagged as a secrets risk (it's the template); misses the repo's real dangers (LLM spend paths, prompt-injection surface, cross-tenant scoping — which the security audit proved real) | **Rewrite spec** — anchor to side_effects + churn + test-coverage deterministic data; each risk must name the specific hazard, not restate "writes to DB" |
| 10 | `dependency_graph` | low | 5 | The best prose section: real fan-in numbers (±3 accurate), keystone framing, coupling risks. Still: cites "[r3]" bundle-style, validator logged 4 claims naming files with no receipt from them, and it duplicates the Dependencies tab | **Keep, tighten** — add "what breaks if you change db.ts's query() signature" concreteness; link nodes into the tab |
| 11 | `doc_health` | high | 4 | Novel and genuinely differentiating idea, but currently confusing meta-content: "flagged records" list is the pipeline critiquing *its own* generated records ("rejected due to missing receipts") presented as if the repo's docs conflict with code; lists a doc file that the analyzed-era commit had just deleted (drift, fair) and bare importance scores (0.88) with no scale | **Keep concept, re-ground it** — doc inventory + staleness vs. commits + coverage of critical symbols; move self-critique to an internal QA view |

**Net:** 2 sections worth keeping近-as-is (dependency_graph, doc_health-concept), 4 needing spec rewrites, 3 needing deterministic rebuilds, 2 that should stop being prose sections at all. Nobody should conclude the *section list* is wrong — overview, architecture, entry points, critical path, schema, safety, doc health is a defensible curriculum. What's wrong is that the LLM is asked to *author* content the pipeline already knows, instead of *narrating* content the pipeline injects.

---

## 3. Where trust breaks — the citation & receipt system

This is the product's spine — "grounded in verified code references" — and it is broken at six points in series. A senior engineer only needs to hit one.

**3.1 Inline citation labels point at nothing.**
`sectionGenerator.ts:112-117` aliases the evidence bundle's receipts as `r1…r40` for the prompt. The structured `claims[].receiptIds` are translated back to UUIDs (`:135`), but the aliases the model writes into `contentMarkdown` — "(receipt r14)", "(r7)", "[r3]" — are **never translated, stripped, or rendered**. The reader shows them as plain text. Only the ~6 `usedReceiptIds` survive as chips, unnumbered, so "r14" in a 6-chip section is unfalsifiable noise that *looks* like a fabricated citation even when the underlying claim was validated. Same defect in every section; `data_schema` even cites "r3" while having **zero** stored receipts.
*Fix (P0):* post-process `contentMarkdown`: map each `rN` → stored receipt → render as a numbered interactive chip at the claim site; strip aliases with no surviving receipt (and log them as unknowns). Store the alias map in `generation_context` (it already exists at generation time).

**3.2 Receipts are section-level endnotes, not claim-level anchors.**
`onboarding.ts:443-459` collapses each section into one content block with all receipts attached at the bottom. The per-claim `adjustedClaims` (claim → receiptIds → confidence) that `citationValidator` produces is stored in `generation_context` — and never exposed. So the UI *cannot* answer "which line of this section does this receipt support?", which is the only question a skeptic asks. NotebookLM/Sourcegraph both moved citations inline precisely because verification happens at the point of doubt.
*Fix (P0):* serve `adjustedClaims`; render chips inline (3.1) and a per-claim hover that shows the snippet. The data model already supports it — this is serialization + rendering work.

**3.3 The reader fakes freshness.**
`onboarding.ts:455` hardcodes `staleness: "current"` and `ageLabel: "recent"` on every receipt served to the reader, and drops `sr.claim`. The ReceiptViewer therefore *always* shows a green "Current / recent" badge — including on receipts whose line numbers have drifted 255 lines (see 3.5) — and never shows "This receipt supports: …". The staleness machinery (`stale_flags`, `node_hash`) exists and the graph/tutorial routes serve real values; the flagship reader lies. For a trust product, a fake "Current" badge is worse than no badge.
*Fix (P0):* wire real staleness (compare `node_hash`/`stale_flags`), return `claim`, delete the `ageLabel` placeholder until it's real.

**3.4 Receipts don't match the prose they decorate.**
The `critical_25` section's chips point at `semanticReranker.ts`, `evidenceGraphBuilder.ts`, `retrievalService.ts` — the correct answer to "what's critical" — while the prose above them declares IntroPage and LoginPage critical. The `architecture` section's sole receipt is `ArchitecturePage.tsx` of the analyzed repo (the UI page that *renders* architecture, cited as evidence *about* architecture). `db.ts#query` L23-26 appears as receipt #1 in seven different sections — a universal donor citation that supports everything and therefore nothing. Receipt *presence* is currently uncorrelated with claim *support*, and readers notice.
*Fix (P1):* validator must check topical linkage (claim mentions file F ⇒ cite a receipt from F — partially exists at `citationValidator.ts:104` but only *logs* the issue into `generation_context.validation.issues` where no user sees it); surface per-section validation issues in an author/review view; stop attaching the retrieval bundle's generic receipts to sections that didn't use them.

**3.5 Line numbers drift with no lifecycle.**
Fact-check: 7/12 sampled receipts match exactly; 4 drifted 1–3 lines; one (projects.ts `POST /:id/analyze`) is off by **255 lines**. Snippets are all real (nothing invented), so this is staleness, not fabrication — but the UI presents drifted receipts with the same authority as fresh ones (and per 3.3, stamps them "Current"). Swimm's model is the benchmark: a receipt is *verified at commit X*, re-verified on change, and visibly flips to "Review required" when the anchor moves.
*Fix (P1):* on package view (or nightly), re-anchor receipts against HEAD via `node_stable_key`/hash: match → "verified against `<sha>`", moved → update lines + show "re-anchored", gone → mark stale. This is cheap AST work the pipeline already knows how to do (`incrementalAnalyzer.diffSymbols`).

**3.6 Confidence labels aren't earned where users can check.**
`architecture` is "high confidence" on the strength of **one** (irrelevant) receipt and 2 tracked claims — while its body asserts ~40 untracked statements (14 cluster roles, a 6-step request flow). Meanwhile the Capabilities *tab* labels the same capability data HIGH while the capability_map *section* says LOW with zero receipts. Two surfaces, same facts, contradictory verdicts — the reader can't calibrate either. Research is clear (Microsoft HAX G2; UMAP'25): miscalibrated confidence, once noticed, cuts trust below having no label.
*Fix (P1):* confidence must come with its reason inline ("high — traced statically from 14 receipts" / "low — inferred, 0 receipts") and must be computed over *all* claims in the section (claim extraction currently tracks only what the model chose to list). Align section vs. tab computation.

**3.7 Receipt granularity destroys spot-checkability.** `ProjectSettingsPage.tsx 69–627` (559 lines) and `ImportPage.tsx 83–619` are "receipts" in name only — nobody verifies a 550-line citation. Cap receipt spans (~40 lines) at extraction time or slice to the referenced member.

**3.8 Receipt summaries import slop into the evidence layer.** The db.ts#query ReceiptViewer summary reads: "Execute a database query… **crucial for managing data interactions that enhance user engagement** and backend processes." A 4-line SQL helper does not enhance user engagement. When even the receipt modal — the "here's the proof" surface — editorializes, the whole provenance story reads as theater. Symbol summaries must be voice-controlled (see §6) or facts-only.

---

## 4. The "Critical 25%" is the flagship — and it currently points away from the code that matters

**4.1 The ranking itself is biased toward UI pages.** Direct DB query of `criticality_scores` (role=general, symbols): the top 12 are *all* frontend pages — `OnboardingPage` 1.000, `ProjectSettingsPage` 0.901, `ProjectOverviewPage` 0.866, `TeamPage` 0.814 … `ProjectListPage` 0.730. Not one backend symbol in the top 12 of a codebase whose value is a 640-symbol backend pipeline. Root cause is legible in `candidateRanker.ts` weights: every page is an `entrypoint` (+0.10 normalized per-type), pages import many components (fan/centrality picks it up), and `general`-role file-pattern weighting doesn't counterweight. Meanwhile in the UI: the **Backend · Workers cluster shows "CRITICALITY 13%"** with a near-empty bar, and `aiClient.ts` — budgets, privacy, kill-switch — shows "**Not ranked in this snapshot**." The prose sections then faithfully amplify the biased ranking (critical_25, role_path, doc_health's "critical undocumented areas", start_here's Read-These-First are all the same eight pages). A senior engineer who knows *any* codebase will see login pages ranked above the job orchestrator and write the whole ranking off. The file-level ranking, notably, is much saner (db.ts, projects.ts, onboarding.ts, github.ts top) — the bias is concentrated in symbol-level scores that the sections consume.
*Fix (P0 for credibility):* dampen the UI-page entrypoint bonus for non-frontend roles (or normalize page components as one entrypoint class); blend file-rank into symbol projection; assert-test the dogfood ranking ("worker pipeline symbols must occupy ≥N of top 25 for role=general/backend") as a regression gate; make "Not ranked" impossible for symbols in the gated set users can click.

**4.2 The 25% has no denominator, no coverage, no method — so the honesty story the team wants to tell is untellable today.** Nowhere does the package say: what 25% *of* (symbols? files? this package cites 47 of 1305 symbols); what the other 75% is and why it's safe to defer; what was excluded from analysis entirely (css/html/python files — it's in `language_inventory`, shown nowhere in the reader); how ranking works (signals exist as human-readable `reasons[]` in the DB — shown only in the Dependencies node panel, never in the section that's *named after* the ranking). The claim "critical 25% covers what you need" is exactly the kind of claim engineers respect *when quantified* (docstring-coverage-style meters are a native convention) and dismiss when asserted.
*Fix (P1):* a coverage strip at the top of the package and on critical_25: "Analyzed 240/289 files (excluded: 3 unsupported, fixtures). This path covers 47 symbols ≈ top 25% by composite criticality; they participate in 58/66 traced workflows. Signals: fan-in, workflow participation, side effects, churn [weights]. Everything else remains browsable in Dependencies." Every number above already exists in the DB.

**4.3 It's a "Learning Path" with no path.** The prompt (`sectionSpecs.ts:151`) mandates taxonomy ("by category: symbols, files, workflows, clusters"), so the output is an inventory. The literature (Hashimoto's "trace down, learn up"; Sillito's question progression) and the product's own tutorial engine argue for an *ordered* path: run it → trace one real workflow end-to-end → then subsystems. The package has all three ingredients (commands are derivable, workflows are traced, clusters exist) and never sequences them.
*Fix (P1):* restructure the spec as: Step 0 run/test commands → Steps 1–3 one traced workflow per architectural layer (deep-linking Tutorials) → then the ranked symbol groups with reasons. Numbered, ordered, checkable-off (user_progress already exists).

---

## 5. Garbage in the evidence stream: fixtures, route names, and the workflow list

**5.1 Test fixtures are analyzed as product code.** `PUT /dataset/:id/:kind` — a route from `worker/fixtures/classServer/src/rest/Server.ts` (the CPSC310 fixture app used to test the analyzer) — is workflow #12 "most critical first." `fixtures/classServer/.../InsightFacade.ts` ranks #11 among *all files* (0.273), above `capabilities.ts`. Workflow traces and tutorial step 15 cite the app's `users` table to `worker/fixtures/mixed/migrations/001_init.sql` (a fixture that happens to declare same-named tables) instead of the real schema. The "python 1" in the language inventory is a fixture too. To a reader: the tool says a homework fixture is more critical than the capabilities API, and that production reads come from test SQL. This single class of noise contaminates rankings, workflows, diagrams, entry points, and tutorials at once.
*Fix (P0, cheap):* default ignore globs (`**/fixtures/**`, `**/__fixtures__/**`, `**/testdata/**`) surfaced in Settings → ignored paths; tag remaining test-adjacent evidence `trust=tests` and exclude from criticality and workflow extraction by default; when two schema files define the same table, prefer the one outside test paths (or the one migrations actually run).

**5.2 Route names without mount points are systematically ambiguous.** The workflow rail contains "GET /" **seven times**, "POST /" and "PUT /" twice each; entry_points lists "GET /" (projects) while workflow_guide's "GET /" is onboarding's — even the generator confuses them, and `capabilities` labels "GET /" as "Handles requests to generate onboarding content" (it doesn't). Express sub-routers are the cause; the mount table lives in `routes/index.ts`.
*Fix (P0, mechanical):* resolve full paths at extraction time (`/api/projects/:id/onboarding` etc.) and use them everywhere — rail, sections, tutorials, capabilities. This one change fixes dozens of confusing strings at once.

**5.3 Workflow selection optimizes for triviality.** Of 66 traced flows, the four chosen for `workflow_guide` include a 2-step GET and a page render, while `POST /:id/analyze` → queue → worker pipeline → generation — the flow every contributor must understand, which the tracer *did* trace (receipt #2 of the section is literally `projects.ts#POST /:id/analyze`) — is absent from every section and every tutorial. Same for tutorials: 4 exist, all shallow CRUD/OAuth traces, one titled "Trace a POST request for **project inquiries**" — a concept that appears nowhere in the codebase (it's the internal Q&A `ask.ts` route, mislabeled). Selection should be by criticality × side-effect richness × layer diversity, with titles derived from route/symbol names, not invented phrasing.

**5.4 The invitation-accept trace mislabels its writes.** The UPDATE + INSERT that *are* the workflow (invitations.ts:117–129) appear as "Data Read" steps. Step-kind classification must distinguish reads from writes when the SQL is statically visible — side-effect detection already exists (`sideEffectDetector.ts`), it just doesn't inform workflow step kinds.

---

## 6. The prose voice disqualifies the product with its target audience

Quantified across the 11 sections: "crucial" ×16, "essential" ×15, "seamless" ×4, "vital" ×4, plus "powerful", "enhance user engagement", "boosting user onboarding", "enhancing usability". Every critical_25 item follows the identical three-bullet template, ending in consequences like "leading to a poor first impression and potential user drop-off" — product-manager fiction attached to code symbols. Purposes restate names in corporate diction ("DELETE /:id — Enables the deletion of a project, essential for project lifecycle management"). This is precisely the "AI slop" register that makes senior engineers close the tab (Stack Overflow 2025: "almost right, but not quite" is the #1 AI frustration; the docs-rot literature is unanimous that one paragraph of filler primes distrust of every subsequent claim).

The generator's output rules (`sectionGenerator.ts:158-160`) constrain *citations* but say nothing about *register*. Add a voice contract to every section prompt: state facts in flat declarative sentences; ban the adjective list (crucial/essential/seamless/vital/robust/powerful/comprehensive); no consequences unless mechanically derivable ("47 files import this; a signature change breaks them" is allowed, "users may face frustration" is not); every sentence must either carry a receipt or state a mechanism. Then lint the output: reject-and-retry on banned-phrase hits (the single stricter-retry loop already exists — `sectionGenerator.ts:93-99` — this is one more check in it). And given quality expectations, `gpt-4o-mini` as the "strong" tier is a false economy at $0.34/run; route section+tutorial generation to a genuinely strong model and keep mini for symbol summaries.

Also in this category: internal vocabulary leaking into reader-facing surfaces — `wf:`/`cluster:` pseudo-IDs rendered as chips (capability_map, role_path), "## Claims / ## Used Receipt IDs" rendered as markdown (data_schema), and Known-Gaps entries in raw pipeline-ese ("no semantic matches — no embeddings matched views [operations, dependency]"). Every unknown `kind` needs a human sentence; every internal ID needs to become a link or be deleted before persistence.

---

## 7. Diagrams: currently anti-evidence

- **Architecture mermaid** (section): 15 clusters × ~60 undifferentiated edges (including tests→everything and both directions of api↔workers) rendered into a ~170px box — an unreadable hairball that *coexists with* the good interactive Architecture tab. Prompt even declares this diagram "authoritative" (`sectionSpecs.ts` architecture spec).
- **Sequence diagrams** (workflow_guide): participants are *files*, and arrows chain each step to the next step's file, fabricating interactions — `001_init.sql ->> 001_initial_schema.sql: graph_nodes` (a fixture SQL file messaging a schema file), `button.tsx ->> badge.tsx`. Any engineer who reads sequence diagrams sees invented message-passing.
- **Schema mermaid** (data_schema): 20 disconnected cylinders stacked into multiple screens of vertical scroll, then a `touches_schema` edge swarm with the label repeated ~30 times and symbol names truncated mid-identifier ("assertGithubAccountCanB").

*Fix (P1):* diagram rules in the deterministic generator (`diagrams.ts`): cap nodes (≤8) and edges (≤12) per diagram, drop test/fixture clusters and edge-label repetition; sequence diagrams must use the real caller as the actor for every arrow (hub-and-spoke from the trace's entry symbol — the trace data has this) or be rendered as a numbered step list instead; schema diagram grouped per domain with FK edges (derivable from the migration), or simply link to the Dependencies tab. Every diagram node should deep-link to its symbol (the "handwavy diagrams" complaint is the #2 DeepWiki dismissal trigger after inaccuracy).

---

## 8. Sections vs. tabs: the IA question answered

Measured against "which surface would actually make a newcomer productive":

| Surface | Verdict | Evidence |
|---|---|---|
| **Tutorials tab** | **Best asset.** Real code + explanation side-by-side, per-step "Backed by" chips that highlight lines, goal statements, deterministic fallback | 14/18 snippets exact; call chain verified correct. Needs: named steps instead of 21 anonymous dots, coverage of the analyze pipeline, honest titles (5.3) |
| **Dependencies tab** | **Strong.** Symbol docs with importance + reasons, real call-site examples, GitHub links, receipts | Still shows "0 imported by" on every directory group (known bug, live), "Not ranked" on load-bearing files (4.1) |
| **Architecture tab** | **Good bones.** Clusters, provenance line ("AI summary (high confidence)" vs "Derived from code structure — no AI involved") is exactly the right pattern | Criticality % misleading (13% on Workers); "Database Schema: 0 files." vs "40 files" contradiction; kind badge wrong on Backend·Modules ("FRONTEND UI") |
| **Workflows tab** | **Useful once names are fixed** | "GET /" ×7 in the rail; fixture workflows; "most critical first" ordering inherits ranking bias |
| **Capabilities tab** | **Keep** — it's the capability_map section done right (When-you'll-touch-it, Start-here with reasons, flow links) | Confidence contradicts the section's (3.6) |
| **11 prose sections** | 5 duplicate a tab (worse); see scorecard | — |

**Recommended shape:** collapse the *package* to five to six narrative sections that do what only narrative can — **(1) What this is & how to run it** (deterministic stack/topology/commands + oriented prose), **(2) How a request becomes a result** (one real end-to-end trace, the analyze pipeline, embedded tutorial), **(3) The Critical 25% path** (ordered, quantified, per-role), **(4) Data & source of truth** (deterministic schema + narrative), **(5) Safety rails** (mechanized risks: side effects, spend paths, auth boundaries, "which tests protect you"), **(6) Doc health** (re-grounded). Architecture/dependencies/capabilities/workflows become *tab deep-links with one-paragraph framings*, not parallel prose retellings. This directly answers "were the sections needed": the curriculum was right; five of its eleven implementations produce negative value versus linking to the tab that already exists.

Reader mechanics worth fixing while at it: duplicated titles (page header + h1 + h2 stack on every section); "Mark reviewed" invisible to Developer-tier users, so the tour's "progress tracker" promise is false for the people actually onboarding (prior audit §E7 — same root cause); Known Gaps disconnected from the claims they refer to (render the downgraded sentence with a dotted underline + "unverified" inline, not only as a footer list); export exists but ships the same broken rN labels.

---

## 9. What already works (don't lose it in the rewrite)

- **Receipts as a first-class table** with trust levels, stable keys, node hashes, commit hash — nothing in the competitive set stores provenance this completely. Zero invented snippets in 30 checks.
- **Honest-unknowns machinery** — `uncited_claim` downgrade + Known Gaps rendering is a genuine differentiator; it caught all three of the worst hallucinations *before shipment* (the failure was shipping anyway / burying the flag away from the claim).
- **AI-vs-deterministic provenance labels** in Architecture/NodeInfo panels — exactly the right pattern; extend it to sections.
- **`ai_generation_runs`** — full per-call model/token/cost audit; the Overview's "$0.3073 · 590 calls" run history is quantified honesty most tools can't produce. (Minor: "560m 7s" duration formatting; budget-pause time counted as run time.)
- **Commit pinning everywhere** (`main@9f4d168`, "behind latest" badges) and the incremental staleness design.
- **Privacy modes enforced mechanically** (`stripSnippetsDeep`), not by prompt.
- The **preflight cost preview**, package cards' stale/low-confidence rollups, and the deterministic fallback tutorials.

The strategy this audit supports: *shrink the LLM's authority to narration over injected facts, and spend the saved credibility on surfacing the deterministic layer you already built.*

---

## 10. Prioritized fix list

**P0 — trust integrity (a senior engineer hits these in the first five minutes):**
1. Translate/strip `rN` aliases in `contentMarkdown`; numbered inline receipt chips (§3.1, §3.2).
2. Stop hardcoding `staleness/ageLabel`; serve `claim` in reader receipts (`onboarding.ts:455`) (§3.3).
3. Default-ignore fixtures in analysis; de-rank test-trust evidence (§5.1).
4. Full route paths everywhere (§5.2).
5. Deterministic facts must be injected, never asked: table counts, file lists, run/test commands (kills the "25 tables" class) (§2 #8, §4.2).
6. Ranking regression gate on the dogfood repo; damp UI-page symbol bias (§4.1).

**P1 — content quality:**
7. Rewrite section specs per §2/§8 (esp. start_here leads with stack + `docker compose up --build` + test command; critical_25 becomes an ordered, quantified path).
8. Voice contract + slop lint in the retry loop; upgrade the strong-tier model (§6).
9. Coverage strip with real denominators (§4.2); confidence-with-reason, aligned across section/tab (§3.6).
10. Receipt re-anchoring lifecycle ("verified against `<sha>`") (§3.5); cap receipt spans (§3.7).
11. Diagram rules: hub-and-spoke sequences, node/edge caps, no fixture participants, linked nodes (§7).
12. Inline "unverified" markers at downgraded claims; humanize unknown kinds; never render `wf:`/`cluster:`/bookkeeping headings (§6, §8).

**P2 — the senior-engineer wow:**
13. Per-package "how this was made" panel (models, calls, cost, retrieval stats, validation issues — all already stored).
14. Surface the grounded Q&A (`POST /:id/ask` exists, internal-only) inside the reader with the same receipts — DeepWiki's only praised surface is Q&A, and you already built a citation-validated one.
15. Tutorial for the analyze pipeline; named step rails; role packages that differ by *path ordering*, not adjectives.
16. Time-to-first-change framing: end the critical path with "make this small real change, verify with this test" per role.

---

## 11. External patterns referenced

- Sourcegraph Deep Search — inline clickable citations that highlight the exact snippet; per-answer process log. https://sourcegraph.com/changelog/verify-deep-search-answers-with-inline-citations
- NotebookLM — inline numbered chips; hover = passage preview; click = scroll-to-highlight. https://support.google.com/notebooklm/answer/16179559
- Swimm — receipts as a lifecycle: auto-sync / "Review required" on code change; PR check. https://docs.swimm.io/continuous-documentation/
- GitHub Copilot code referencing — quantified honesty framing. https://github.blog/news-insights/product-news/introducing-code-referencing-for-github-copilot/
- DeepWiki + documented failures (LibreOffice Buck, LLVM omissions, invented VS Code extension; "hallucinated an alternate reality") — the dismissal patterns §3–§7 are designed against. https://blopker.com/writing/12-deepwiki/ · https://news.ycombinator.com/item?id=45002092
- Program comprehension: Ko et al. ICSE'07 (hardest needs = intent/rationale); Sillito FSE'06 (44 developer questions — a ready rubric for section specs); Mitchell Hashimoto, "Contributing to Complex Projects" (run → trace down → learn up). https://mitchellh.com/writing/contributing-to-complex-projects
- SWE at Google ch.10 — freshness dates + owners; seekers vs. stumblers. https://abseil.io/resources/swe-book/html/ch10.html
- Diátaxis (tutorial/how-to/reference/explanation — label sections by mode). https://diataxis.fr/
- Microsoft HAX G2 / Google PAIR — confidence displays must be actionable and calibrated or they backfire. https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-how-well-the-system-can-do-what-it-can-do/
- Coverage conventions engineers already trust: `interrogate` docstring coverage meters. https://interrogate.readthedocs.io/

---

*Verification data for this audit (full section dumps, receipts, rankings, fact-check worktree) was gathered from the live DB and `git worktree` at `9f9f469`; per-claim verdicts are reproducible via the queries in the audit session. Zero content in this document is based on the generated package's own self-description.*
