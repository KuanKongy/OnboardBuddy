# What our tests cover

**906 automated tests — 759 backend, 147 frontend** — plus 68 Playwright browser specs that the
one-command run reports as *skipped* rather than pretending to have run them. This document explains
what each group protects, why it exists, and how it runs. For the hands-on walkthrough of Milestone 4,
see [TESTPLAN.md](./TESTPLAN.md).

## Run everything

```bash
docker compose -f docker-compose.test.yml run --rm test   # needs only Docker
# — or, with Node 22 installed —
npm install && npm test
```

Both run the same suites through the same script and print the same summary. Roughly a minute. No
`.env` file, no cloud services and no running app — the suites carry everything they need: the
database layer is stubbed, the API boots in-process, sample repositories ship in the repo, and AI
calls are answered by a scripted stand-in.

> If you have run this before, add `--build` so Docker picks up the current tree rather than an old
> cached image: `docker compose -f docker-compose.test.yml run --rm --build test`.

### The per-area summary

The run ends with a breakdown of **how many tests passed in each part of the system**, so you can see
at a glance where the coverage is and what broke. This is the literal, unedited tail of a run:

```text
══════════════════════════════════════════════════════════════════════════════════════════
  OnboardBuddy — automated tests passing, by area
══════════════════════════════════════════════════════════════════════════════════════════

  AREA                                                  PASSED   FAILED  SKIPPED    RESULT
  ────────────────────────────────────────────────────────────────────────────────────────
  Backend · security (hostile input)                        83        0        0      PASS
  Backend · analysis pipeline                              245        0        0      PASS
  Backend · AI, caching & model routing                     89        0        0      PASS
  Backend · document generation                            167        0        0      PASS
  Backend · API & auth (HTTP)                              156        0        0      PASS
  Backend · unit (libs, queue, crypto)                      19        0        0      PASS
  Frontend · unit (components, pages, safe rendering)      147        0        0      PASS
  E2E · Playwright (browser)                                 0        0       68   SKIPPED
  ────────────────────────────────────────────────────────────────────────────────────────
  TOTAL                                                    906        0       68      PASS

  Counts are parsed from each runner's own machine-readable output:
    mocha      → /tmp/onboardbuddy-test-results/backend-mocha.json  (759 tests across 68 files, exit 0)
    vitest     → /tmp/onboardbuddy-test-results/frontend-vitest.json  (147 tests across 21 files, exit 0)
    playwright → not run — no browser in this image; on a host: npx playwright install chromium && RUN_E2E=1 npm test

  Overall: PASS — 906 tests passed, 0 failed. Exit code 0.
```

The full spec output from both runners still scrolls past above it; the table is only the summary.

**Where the numbers come from.** Nothing in that table is written down anywhere — every figure is
parsed from the test runners' own machine-readable output by
[`scripts/test-summary.mjs`](../scripts/test-summary.mjs):

| Source | How |
|--------|-----|
| Backend | mocha runs **once**, through [`scripts/mocha-spec-json.cjs`](../scripts/mocha-spec-json.cjs) — a reporter that prints the normal spec output *and* writes one JSON record per test, including the file it came from. The areas are buckets over those file paths. |
| Frontend | vitest's built-in `json` reporter (`--reporter=json --outputFile.json=…`), one record per test. |
| E2E | `playwright test --list --reporter=json`, which enumerates the specs **without** launching a browser. |

**It refuses to guess.** The script cross-checks its own arithmetic and stops being polite if anything
does not line up — if the per-area counts do not add up to the runner's own total, if a runner exits
without writing its JSON, if a runner exits non-zero while reporting no failing test, or if a test file
matches no area rule, it prints `COUNTS CANNOT BE TRUSTED` with the reason and exits non-zero. A
broken run can never look like a passing run with a comfortable zero.

**A failure anywhere fails the command.** The area is marked `FAIL`, the failing tests are listed under
the table with their file and assertion message, and the exit code is 1:

```text
  Backend · API & auth (HTTP)                              156        1        0      FAIL
  ...
  TOTAL                                                    871        4       68      FAIL

  4 FAILING TEST(S):

  ▸ Backend · API & auth (HTTP)
      ✗ summary failure demo deliberately fails so the per-area summary can be checked
        test/api/zz-summary-failure-demo.test.ts
        expected 2 to equal 3
```

**Which files feed which area** — the rules live in `BACKEND_AREAS` in `scripts/test-summary.mjs`:

| Area | Test files |
|------|-----------|
| Backend · security (hostile input) | `markdownSanitizer`, `promptInjection`, `zipSafety`, `githubRefSafety` |
| Backend · analysis pipeline | `src/worker/engine/**`, `src/worker/__tests__/**`, `test/analysis/**`, `test/ranking/**`, `test/incremental-reanalysis/**` |
| Backend · AI, caching & model routing | `src/worker/ai/**`, `src/worker/semantic/**`, `test/ai/**` |
| Backend · document generation | `src/worker/generation/**` (minus the two security files above), `test/golden/**` |
| Backend · API & auth (HTTP) | `test/api/**` |
| Backend · unit (libs, queue, crypto) | `src/lib/**`, `test/lib/**`, `test/worker/**` |
| Frontend · unit | `frontend/src/**/*.test.{ts,tsx}` |
| E2E · Playwright | `frontend/e2e/**/*.spec.ts` |

**Why E2E says SKIPPED.** The test image is `node:22-alpine` with no browser in it, so the Playwright
specs genuinely cannot run there — reporting them as passed would be a lie, and omitting them would
hide 68 tests. They are counted (by asking Playwright) and marked skipped. To actually run them, on a
machine with a browser:

```bash
npx playwright install chromium     # once
RUN_E2E=1 npm test                  # summary then executes them and reports real pass/fail
```

**Growth:** M2 `137 + 20` → M3 `321 + 25` → M4 `759 + 147`. The M4 jump is the security suite, the
rebuilt document generation, and a regression test for every bug fixed during the sprint. The table is
regenerated on every run, so the numbers above are a snapshot — the command always prints the current
ones.

## Two things worth knowing about how these are written

**They call the real code.** The unit tests are not a parallel test-only implementation — they invoke
the same functions the production worker invokes, against small sample repositories committed to the
repo. So a test passing means the shipped code path works, not that a mock does.

**Failures we have actually had get their own test.** Every bug fixed in M4 left a test behind. Three
of them are worth naming because they were *silent* failures — an empty document served from a cache,
a subsystem that traced to nothing, a security fix that only worked on a laptop. Silent failures are
the ones a manual pass will not catch, so they are the ones most worth automating.

---

# Backend — 820 tests

## 1. Reading the code (167 tests)

**What:** turning a repository into structured facts — every symbol and its signature, what imports
what, where execution starts, what it touches, the flows from entry point to side effect, and which
files matter most.

**Why:** this is the foundation everything else stands on. Whatever the extraction misses, every later
stage is confidently wrong about — and confidently wrong is worse than silent, because it looks like
an answer.

**How:** the real parser runs over sample repositories in the repo, chosen to include the shapes that
have broken us before — a background worker whose handler is passed by reference (bug #59), routers
nested two levels deep behind middleware (bug #58), and a Docker Compose plus CI setup.

| Tests | Group | Covers |
|------:|-------|--------|
| 85 | Symbols and dependencies | Symbol extraction, the dependency graph, the evidence graph, repository ingestion with its size and language guardrails |
| 23 | Where execution starts and what it touches | Entry points including background jobs, side effects — database writes, network calls, authentication, external services, process execution — and the fallback that records anything unrecognised instead of dropping it |
| 39 | Flows and journeys | Call-graph flow tracing, full route paths through nested routers, Docker/CI configuration read as its own flow layer, and joining flows across queue boundaries into end-to-end journeys |
| 20 | What matters most | Composite ranking, per-role weighting, depth gating, subsystem clustering, and cost preview before a run |

## 2. Using AI safely and affordably (47 tests)

**What:** everything around the AI calls rather than the calls themselves — retries, structured-output
validation, spend budgets, the stop switch, the three privacy modes, and picking which model to use.

**Why:** this is where a bug costs real money or leaks real code. A runaway retry loop, a budget that
does not stop anything, or a privacy mode that still sends snippets are all invisible until the bill
or the incident arrives.

**How:** the real orchestration code runs against a scripted stand-in model, so we can force failures
on demand — malformed output, a budget trip mid-run, a provider that stops responding.

| Tests | Covers |
|------:|--------|
| 40 | Structured-output validation and retry, model tiers and their failure behaviour, budget limits and counters, the kill switch, key resolution, privacy modes (including that `facts_only_ai` really does strip code snippets), spend auditing, caching, checkpoint/resume |
| 7 | Model selection: filtering providers on capability and context size, ranking on measured throughput, keeping the incumbent unless a rival is meaningfully faster, and falling back to a default if the probe fails |

## 3. Not paying twice for the same work (37 tests)

**What:** the caches that make a re-analysis cheap — per-symbol AI results keyed on the code itself,
carried forward when a file has not changed.

**Why:** it is the difference between $0.36 and $2 a run, and between 7 minutes and 25.

**How:** the real cache code with a stubbed database, asserting both that unchanged work is reused and
that *changed* work is not.

| Tests | Covers |
|------:|--------|
| 29 | The content-keyed result cache, layering by depth, supersede rules, batching, and facts-only mode |
| 8 | Carry-forward across snapshots and the bulk database operations added to cut analysis latency |

## 4. Writing a document we can defend (177 tests)

**What:** generating the handbook — the citation validator, the deterministically-built lookup tables,
the completeness gates, diagram limits, tutorial selection, and the writing-style contract per section
type.

**Why:** this is the product. The specific risk is a section that *reads* authoritative while being
unsupported, so most of these tests are about catching that rather than about formatting.

**How:** the real generation code against sample evidence, including deliberately weak model output to
confirm the gates fire.

| Tests | Group | Covers |
|------:|-------|--------|
| 19 | Citation validation | All eight trust rules — unknown receipts, stale code, claim/file mismatch, uncited statements downgraded rather than deleted, documentation-only claims capped |
| 50 | The prose contract | The good-prose guard: text that describes the pipeline instead of the repository, an inventory pasted in place of an explanation, and narration that talks about itself rather than the code |
| 29 | Facts we generate rather than ask for | The deterministic lookup tables (routes, queue jobs, database tables with their foreign-key chains, environment variables) and the coverage gate that catches a model shipping a summary instead of the enumeration |
| 24 | Golden fixtures for generalisation | Guards the five labelled reference repositories the generalisation harness runs against — that every fixture field is well-formed, and that the five are genuinely five *different* shapes, since a harness whose repos all look alike proves nothing |
| 18 | Citations reaching the reader | Rewriting the model's short references into stable markers and back into clickable citations, round-tripped |
| 19 | Content quality gates | Keeping test fixtures out of the "most critical files" list, tutorial selection by importance and variety, diagram size caps, and the per-section writing-style contract |
| 8 | Privacy modes at generation time | `ai_disabled` makes exactly zero provider calls, `facts_only_ai` strips snippets before anything leaves the process, and switching modes cannot serve the other mode's cached output |
| 10 | Receipts and documentation drift | Receipt span limits and re-anchoring when code moves; comparing routes and environment variables asserted in a repo's own docs against what the code actually has |

## 5. Security (83 tests)

**What:** the four mitigations from the security assessment, each tested at the layer it operates on.

**Why:** these defend against untrusted third-party repositories, which is unavoidable — ingesting
them is the product. And a security fix that is never exercised silently rots.

**How:** deliberately hostile inputs through the real code. Two choices are worth calling out:

- The prompt tests **simulate an AI that has already been compromised** and obeys every injected
  instruction — because no prompt can guarantee a model refuses, so the question worth answering is
  whether the layers behind it hold.
- The archive tests **build real malicious archives byte by byte**, including the streaming form
  GitHub produces. A mock would not have caught bug #64, which is exactly the class of defect here.

| Tests | Covers |
|------:|--------|
| 33 | Sanitising AI output before it is stored: images and off-allowlist links removed everywhere, including the Markdown export; code blocks never touched, because those are repository evidence; known sanitiser-bypass shapes |
| 26 | The untrusted-data boundary in prompts, at all three prompt sites, plus the cache versioning that stops content generated under the old prompts from ever being reused |
| 13 | Path-traversal-safe archive extraction, against archives written three different ways |
| 11 | Branch-name validation, asserted against the URL that actually leaves the process rather than the string we intended to build |

## 6. Keeping up with a changing repository (14 tests)

**What:** what a new commit invalidates, and what it must not.

**Why:** get this wrong in one direction and the document silently goes out of date; wrong in the other
and every push costs a full re-analysis.

**How:** simulated commits against a sample repository.

| Tests | Covers |
|------:|--------|
| 6 | A changed function body propagating up through file → module → subsystem; a whitespace-only change invalidating **nothing**; removed files and symbols; stale flags |
| 5 | Regression tests for the M4 graph fixes: flows terminate instead of looping back, near-duplicate flows suppressed, page loads ranked below server flows, repeated imports not inflating dependency counts |
| 3 | The watchdog that detects a worker which has stopped consuming and recreates it |

## 7. The API: permissions and contracts (167 tests)

**What:** every route — who may call it, what it accepts, what it returns, and what it refuses.

**Why:** this is where a mistake becomes a data leak or a stuck project. It is also the layer the
frontend trusts, so a changed shape breaks the UI silently.

**How:** the real Express app via HTTP, with authentication and the database stubbed, so tests are
fast and need no credentials.

| Tests | Group | Covers |
|------:|-------|--------|
| 31 | Auth and GitHub | Signup/login validation, session guards, account deletion cascading correctly, GitHub App and repository routes, and the push webhook — signature verification, disabled-without-a-secret, and redelivery not causing a duplicate run |
| 23 | Projects and runs | Project CRUD permissions, analysis start with its concurrency rule (identical target conflicts, different targets do not), and run progress reporting — monotonic percentage, stage labels, stalled detection |
| 48 | Onboarding and packages | Package resolution order (explicit choice → your default → latest), section and receipt routes, export, review permissions, on-demand generation, and the receipt presentation logic that used to return hardcoded values (bug #57) |
| 39 | Everything else | Graph and workflow route guards, grounded Q&A including its error taxonomy, bring-your-own API keys (asserting the key value is never returned), team and invitation permissions, health check |
| 15 | Score provenance | The "why is this file ranked here" payload — per-candidate provenance, the mean it is compared against, and the weight table the reader is shown |
| 11 | Token encryption | Round-trip, unique initialisation vectors, and correct failure on tampering, malformed input, and a wrong-length key |

## 8. End-to-end on a real repository (27 tests)

**What:** whole-pipeline runs over a sample repository — ingest, filter, extract, trace, rank, generate.

**Why:** the unit tests prove each stage works in isolation; these prove the stages fit together. Most
of our worst bugs lived in the seams.

**How:** the full pipeline in-process against the sample repository, database stubbed, AI scripted.

| Tests | Covers |
|------:|--------|
| 12 | A full pipeline run — inventory, privacy filtering, extraction, flow discovery, evidence and receipt shape — plus composite ranking end to end |
| 10 | Evidence assembly for generation, citation validation, the AI-disabled path, draft status, and stale detection across a re-analysis |
| 5 | Job plumbing: queue URL parsing, job payloads, retry policy, step logs |

## 9. Does the shipped artefact still match the analysis? (40 tests)

**What:** three checks that compare what the reader is finally shown against what the analysis
actually found.

**Why:** every stage above can be individually correct and the result still wrong, because the last
step disagrees with the one before it. These are the tests that catch a subsystem labelled one thing
in the graph and another in the document, or an export that quietly drops what the reader saw.

**How:** real analysis output over the sample repositories, compared field by field.

| Tests | Covers |
|------:|--------|
| 22 | Export reconciliation — the exported document carries the same sections, citations and receipts as the one served in the app |
| 10 | Workflow ranking — which journeys surface first, and that the ordering is stable rather than incidental |
| 8 | Architecture cluster typing — clusters get the right kind label and the right member counts |

---

# Frontend — 147 tests

Vitest with Testing Library. Supabase and every API call are mocked, so no backend is needed.

| Tests | Group | What / why / how |
|------:|-------|------------------|
| 40 | **Rendering untrusted content safely** | The highest-value frontend tests. They render the **real** markdown configuration and inspect the resulting DOM — raw HTML escaped, dangerous URL schemes stripped, remote images dropped, off-allowlist links removed. One is a standing guard that fails if anyone introduces a second place in the codebase that writes raw HTML, or takes the diagram renderer out of strict mode. Plus the avatar host allowlist, including lookalike hostnames. |
| 13 | **The reader** | Turning citation markers in section text into clickable chips; code snippet rendering with line highlighting and a height cap |
| 24 | **Graphs** | Graph rendering, search filtering, the detail panel, the classes view, drilling into a cluster and back out via the breadcrumb, the drill-stack that remembers the level you came from rather than a path prefix, and the shared layout/edge-capping logic |
| 22 | **Architecture diagram layout** | The serpentine layout maths — row packing, direction alternation, no overlapping boxes at any node count — and the architecture data model it draws from |
| 12 | **Auth and routing** | Protected routes actually redirect, login and signup render and submit, the check-your-email path |
| 11 | **Preferences** | Theme follows the OS until pinned, then stops; keyboard shortcuts fire — and are correctly suppressed while typing, while a modifier is held, and while a dialog or tour is open, so they cannot hijack a form |
| 10 | **Project workspace** | Active-package resolution, the package selector and its default-package control, project card status and delete confirmation |
| 10 | **Score provenance panel** | The "why this rank" panel a reader opens on a file — the candidate rows, the comparison mean, and the weight table |
| 5 | **Feature flows** | Import chain, role-specific packages, walkthrough steps, graph tabs and review status, against a mocked API |

---

# The security evidence report

```bash
npm run security:report -w backend              # verdicts; exits non-zero on regression
npm run security:report -w backend -- --write   # also regenerates doc/SECURITY_TEST_EVIDENCE.md
```

Separate from the test suite because it produces a **document, not a pass/fail**. It runs the real
generation code over a hostile sample repository (5 files, 10 attack payloads) and prints, for each
one: the attack as it sits on disk, the actual prompt that would be sent, the actual output that would
be stored, and a verdict. No network or AI calls.

It exists so the defences can be *checked* rather than believed — the output in
[SECURITY_TEST_EVIDENCE.md](./SECURITY_TEST_EVIDENCE.md) is generated, not written. Because it exits
non-zero on a regression it also works as a CI gate. The assessment it defends, including what we are
*not* claiming to have solved, is [SECURITY_XSS_PROMPT_INJECTION.md](./SECURITY_XSS_PROMPT_INJECTION.md).

---

# Browser tests (counted, not executed by the one-command run)

They need a browser, which the `node:22-alpine` test image does not have — so the summary counts them
by asking Playwright and marks the area **SKIPPED** rather than claiming a pass. They are how we catch
layout and theme regressions that unit tests cannot see.

```bash
npx playwright install chromium                 # once
RUN_E2E=1 npm test                              # whole summary, with e2e actually executed

# or individually, from frontend/
npx playwright test e2e/phase10-ui.spec.ts      # every tab, dark + light theme
npx playwright test e2e/mobile-ui.spec.ts       # 390×844, asserts no horizontal scroll anywhere
```

With `RUN_E2E=1` the summary runs Playwright and reports its real pass/fail counts in the same table,
parsed from Playwright's own `--reporter=json` stats. The first spec renders every project tab in both
themes against a mocked API, exercises the first-run tour and the detail panels, checks the progress
bar behaves (correct stage label, never goes backwards), and captures full-page screenshots.
`npm run test:stack` additionally smoke-tests a running Docker stack.

# Other checks

```bash
npm run lint     # ESLint across the monorepo — 0 errors
npm run build    # TypeScript + production build — clean
```
