# OnboardBuddy — UI/UX Audit: a page-by-page walkthrough

**Date:** 2026-07-25 · supersedes the 2026-07-22 edition (in git history)
**Build:** `Milestone4` working tree, live Docker stack
**Audited as:** a **Developer-tier member** on the real dogfood package (`KuanKongy/OnboardBuddy`,
268 files · 1272 symbols · 76 workflows · 12 Diátaxis sections), plus a **genuinely new account**
created mid-audit to see first-run state.
**HCI assessment:** [Part 9](#part-9--hci-assessment) judges the product on accessibility, usability, utility, comfort, transparency and honesty. Per-project correctness: [PROJECT_SCORECARD.md](./PROJECT_SCORECARD.md).
**Second pass (2026-07-25, same day):** re-run across **all five imported projects** with fresh
analyses, plus a **fabrication check against the real open-source repos**. See
[Part 6](#part-6--the-five-project-pass-and-the-fabrication-check).

---

## Summary — start here

**The one finding that matters most:** on `FloowForge`, OnboardBuddy produced a confident,
fully-cited, 28,661-character onboarding guide describing a **Next.js frontend** — while the repo's
own README says its core is a **FastAPI execution engine**, and the tool's own metadata records
`"unsupported": {"python": 49}`. The words *python*, *fastapi*, *skipped* and *not analyzed* appear
**zero times** in the generated prose. The system knows what it skipped and never says so.
→ [§17.2](#172-the-headline-the-tool-hides-what-it-could-not-read)

**The good news, proven not asserted:** **358 of 358** code receipts across three repos point at
code that really exists, at line ranges that are in bounds, with snippets that match the real files
byte-for-byte. The citation layer is **not** fabricated. → [§17.1](#171-the-fabrication-check)

### Jump to

| | Section | What's in it |
|---|---|---|
| | [How this audit was done, and the mindset](#how-this-audit-was-done-and-the-mindset) | The questions asked of every component; the verdict taxonomy |
| **Part 1** | [The walkthrough](#part-1--the-walkthrough) | 16 pages, component by component |
| 1 | [Landing page](#1-landing-page) | |
| 2 | [Sign up and log in](#2-sign-up-signup-and-log-in-login) | 2 clicks, 2 fields — leaner than most; don't touch it |
| 3 | [Dashboard](#3-dashboard-dashboard) | Stat tiles, project card, recent activity |
| 4 | [Project list](#4-project-list-list) | |
| 5 | [Project shell](#5-project-shell-entering-a-project) | |
| 6 | [Project Overview](#6-project-overview) | |
| 7 | [Your Onboarding — package grid](#7-your-onboarding--the-package-grid) | |
| 8 | [**The onboarding reader**](#8-the-onboarding-reader--the-product) | The product. Trust layer, citations, provenance |
| 9 | [Dependencies](#9-dependencies--the-understand-the-code-tab) | Incl. §9.2, the worst screen in the product |
| 10 | [Architecture](#10-architecture) | |
| 11 | [**Workflows**](#11-workflows--the-layout-problem-measured-and-solved) | The reported layout problem, quantified **and solved** |
| 12 | [Capabilities](#12-capabilities--the-best-surface-in-the-product) | The best surface — and the template for fixing the rest |
| 13 | [Tutorials](#13-tutorials--and-the-dots-question) | |
| 14 | [Account Settings](#14-account-settings) | |
| 15 | [Help & FAQ](#15-help--faq--and-what-its-existence-tells-us) | Its FAQ is a bug backlog |
| 16 | [The first-run tour](#16-the-first-run-tour) | |
| **Part 2** | [Cross-cutting](#part-2--cross-cutting) | Issues that belong to no single page |
| **Part 3** | [The pattern behind the findings](#part-3--the-pattern-behind-the-findings) | Three root causes explain most of it |
| **Part 4** | [What is genuinely good](#part-4--what-is-genuinely-good) | 14 verified strengths |
| **Part 5** | [Counts and priorities](#part-5--counts-and-priorities) | First-pass totals |
| **Part 6** | [**The five-project pass + fabrication check**](#part-6--the-five-project-pass-and-the-fabrication-check) | **New.** Same tabs, five very different codebases |
| 17.1 | [The fabrication check](#171-the-fabrication-check) | 358/358 receipts verified against real repos |
| 17.2 | [The tool hides what it could not read](#172-the-headline-the-tool-hides-what-it-could-not-read) | **The headline finding** |
| 17.3 | [Explanations that are fluent but not correct](#173-explanations-that-are-fluent-but-not-correct) | Where the prose is wrong about the project |
| 17.4 | [The deterministic layer is the wrong one](#174-the-deterministic-layer-is-the-wrong-one) | The backbone contradicts itself and the LLM beats it |
| 17.5 | [Same component, opposite failures](#175-same-component-opposite-failures-1-node-and-21) | 1 node in a void vs 21 in a column |
| 17.6 | [Dependencies across five repos](#176-dependencies-across-five-repos) | "0 imported by" on every node |
| 17.7 | [The reader across five repos](#177-the-reader-across-five-repos) | 20× section-length spread; day-one section is the shortest |
| 17.8 | [Constants pretending to be data](#178-constants-pretending-to-be-data) | Draft, STALE 0, DEVELOPER, and other zero-information UI |
| 17.9 | [New defects found this pass](#179-new-defects-found-this-pass) | Blank 404, non-linkable cards, occluded focus target |
| 17.10 | [What I got wrong, corrected](#1710-what-i-got-wrong-corrected) | False leads killed before they reached this doc |
| 17.11 | [Part 6 counts and priorities](#1711-part-6-counts-and-priorities) | |
| **Part 7** | [**Architectural coverage — what the tool can and cannot see**](#part-7--architectural-coverage-what-the-tool-can-and-cannot-see) | **New.** Why Skribbl found 1 workflow and the portfolio's README was ignored |
| 18.1 | [The detector models the world as HTTP](#181-the-entrypoint-detector-models-the-world-as-http) | `event_listener` has **never** been produced; 20 Socket.IO events → `GET /health` |
| 18.2 | [The README is ingested and then ignored](#182-the-readme-is-ingested-and-then-ignored) | 3 markdown receipts database-wide |
| 18.3 | [When the only bucket is HTTP](#183-when-the-only-bucket-is-http-everything-becomes-http) | A keyboard handler presented as an HTTP endpoint |
| 18.4 | [`Configuration & Deployment: 0 files.`](#184-configuration--deployment-0-files--now-5-of-5) | Wrong on every project audited |
| 18.5 | [Eleven-project coverage matrix](#185-eleven-project-coverage-matrix) | How well the tool covers each style of code |
| 18.6 | [**A failed analysis looks like a successful one**](#186-a-failed-analysis-is-indistinguishable-from-a-successful-one) | **P1.** 3 of 9 runs produced no package; 2 are marked `complete` |
| 18.7 | [**A paused package hides a completed analysis**](#187-a-paused-package-hides-a-completed-analysis--and-only-on-some-tabs) | **P1.** 71 workflows present; the tab says none were traced |
| **Part 8** | [**Reader furniture, graph controls, and a retraction**](#part-8--the-readers-furniture-the-graphs-controls-and-a-retraction) | **New.** Owner-reported complaints, reproduced and traced to source |
| 19.1 | [`Ready` on a fully analyzed project](#191-ready-on-a-project-with-71-workflows-and-a-finished-package) | The card says "hasn't been analyzed yet" |
| 19.2 | [The reader's diagram is static and first](#192-the-readers-architecture-diagram-static-oversized-and-first) | 275px, no zoom, above the TL;DR |
| 19.3 | [Citations: 43 bare file paths](#193-the-citations-footer-43-numbered-file-paths-with-no-names) | 69% of receipts name no file at all |
| 19.4 | [**Known gaps: 34 copies of one sentence**](#194-known-gaps-34-copies-of-one-sentence-63-of-a-section) | **63% of a section**; strip says 5, page shows 34 |
| 19.5 | [An unexplained dotted underline](#195-a-dotted-underline-that-means-unverified-with-nothing-to-say-so) | Same style as tooltip triggers, no tooltip |
| 19.6 | [The product's name is misspelled](#196-the-products-own-name-is-misspelled-throughout-the-document) | "FlowForge" vs `FloowForge` |
| 19.7 | [**Clicking a node discards your view**](#197-clicking-a-node-throws-away-your-view--setcenterzoom-115) | `setCenter(zoom: 1.15)` — a 7.7× jump on the drill-in |
| 19.8 | [**Fullscreen has no visible exit**](#198-fullscreen-has-no-visible-way-out) | `z-50` overlay covers the only toggle |
| 19.9 | [**Retraction: "edges paint before nodes"**](#199-retraction-edges-paint-before-nodes-was-my-instrumentation-not-the-product) | Was my instrumentation, not the product |
| 19.10 | [Part 8 counts](#1910-part-8-counts) | |
| 19.11 | [**The Ask panel — the missing honesty, and 26 blank receipts**](#1911-the-ask-panel-the-honesty-the-section-generator-is-missing--and-26-blank-receipts) | Refuses to guess; the fix for §17.2 already exists in-product |
| 19.12 | [Smaller flows swept](#1912-smaller-flows-swept-in-this-pass) | Falsifiable coverage list + what is not covered |
| **Part 9** | [**HCI assessment**](#part-9--hci-assessment) | **New.** Accessibility, usability, utility, comfort, transparency, honesty |
| 20.1 | [**Permission mismatches — operated, not inferred**](#201-the-real-permission-mismatches--operated-not-inferred) | **Admin→owner privilege escalation, proven live** |
| 20.2 | [**Honesty**](#202-honesty--the-dimension-this-product-is-actually-about) | Honest about evidence, wrong about coverage |
| 20.3 | [Transparency](#203-transparency--does-the-user-know-what-the-system-did) | Strong instrumentation, undermined by constants |
| 20.4 | [Utility](#204-utility--does-it-deliver-what-a-new-developer-needs) | Day-one section is the shortest in the package |
| 20.5 | [Usability](#205-usability--can-they-work-out-how-to-use-it) | Good IA, broken interactions |
| 20.6 | [Accessibility](#206-accessibility) | Good names, poor keyboard and contrast |
| 20.7 | [Comfort](#207-comfort--is-using-this-pleasant-or-exhausting) | The product's bookkeeping leaks into the reading |
| 20.8 | [**Scorecard**](#208-scorecard) | Verdict per dimension + first fix each |

---

## How this audit was done, and the mindset

I walked the product as **the person it exists for**: a developer who just joined, has very little
time, has been told "we use this tool to understand the codebase", and is now deciding whether it
deserves their attention. That person reads every label, because any one of them might be the thing
that unlocks the codebase. They also give up fast.

For every page I asked the same questions, and I asked them of **each component**, of **each pair of
components that sit next to each other**, and of **the page as a whole**:

- What is this element *for*? If I deleted it, what would the user lose?
- Is it telling the truth? Does it agree with the thing next to it?
- Do these two components belong together, or did they just end up adjacent?
- Is this here for the user's comfort, or for ours?
- What would a new developer *think* this means — not what do we mean by it?
- Can I do the thing it appears to invite me to do?
- Is this the most important thing on the page? Is it drawn like it is?
- What happens in the empty case, the failing case, the very-large case?

Every finding was reproduced in the browser, then confirmed at its source — component, API, or
database. Numbers are measured, not estimated. Where something looked wrong I searched the repo for a
rationale **before** calling it a defect, and each finding carries a verdict:

| Verdict | Meaning |
|---|---|
| **`ACCIDENT`** | Nobody decided this. Bug or oversight. |
| **`DELIBERATE, WRONG`** | A real decision, which does not survive contact with a user. |
| **`RIGHT, MISPRESENTED`** | The decision is correct and the UI argues against it. |
| **`WORKS, UNDISCOVERABLE`** | Functions correctly; nothing tells the user so. |
| **`OUR COMFORT, NOT THEIRS`** | Optimised for what was easy to build, not what is easy to use. |
| **`ACCEPTABLE`** | Looks odd, is defensible. Recorded so it stops being re-litigated. |

**Previous edition:** 73 findings, **1 fixed** (nginx gzip, incidentally). The rest are folded in here.

---

# Part 1 — The walkthrough

## 1. Landing page (`/`)

**What you see, signed out:** logo + wordmark, theme toggle, `Log In` / `Sign Up`. A large hero —
*"Onboard developers to any codebase — automatically"* — a two-line subtitle, `Get Started` and
`Learn More`. Below: "Built for engineering teams" with four cards (Deterministic Analysis,
Role-Based Onboarding, Source-Grounded, Always Current), then "How it works" as three numbered steps.

**Component by component.** The hero copy is good and specific — *"AST-powered extraction — not
AI-guessed"* and *"Every claim is linked to real code. No hallucinated documentation"* are exactly
the claims a sceptical developer wants to hear, and they are the product's real differentiators
rather than generic AI copy. The four cards are the right four things. Nothing here is padding.

**Relationships.** The `Get Started` / `Learn More` pair is conventional and fine. But the header and
the hero **disagree about who I am**: signed in, the header becomes `Go to Dashboard` while the hero's
primary CTA still points at `/signup`.

- `[LOW]` **Signed-in users are invited to sign up.** **Verdict: `ACCIDENT`, a side effect of a
  deliberate M4 change.** M4 stopped auto-redirecting signed-in users off this page (bug #59,
  2026-07-16) — correct, they might want to read it. But nobody updated the hero. `/signup` redirects
  back, so it is a pointless round trip rather than a break. *Fix: swap the hero CTA to "Go to
  dashboard" when a session exists.*

**Whole picture.** This page does its job. A developer arrives, learns the tool is extraction-first
rather than prompt-first, and leaves knowing what it claims. **No changes needed beyond the CTA.**

---

## 2. Sign up (`/signup`) and log in (`/login`)

**What you see:** a single centred column — logo mark, "Create an account" / "Get started with
OnboardBuddy", Email, Password (with a show/hide eye), `Minimum 8 characters`, `Create Account`, an
`or` divider, `Sign up with GitHub`, "Already have an account? Sign in", "← Back to home".

**Component by component.** This is the best-composed screen in the app. The show/hide toggle, the
inline `Minimum 8 characters` rule (stated *before* you fail it), the `or` divider, and `Back to home`
are all correct choices. On the login page, `Forgot password?` sits **inline with the Password label**
rather than buried below the button — exactly right.

**On the "does registering take too many clicks" question.** Measured: **intro → `Get Started`
(1 click) → email + password (2 fields) → `Create Account` (1 click).** No name field, no
confirm-password, no ToS checkbox, no email-verification wall before you see the app.

> **Verdict: `ACCEPTABLE` — this is leaner than most comparable products. Do not add friction here.**
> The click count is not the problem on this form. The problems are invisible.

- `[HIGH]` **The highest-stakes form in the app is unlabelled for assistive tech.**
  **Verdict: `ACCIDENT`.** The accessibility tree reports:
  ```
  textbox "you@example.com"   ← accessible name is the PLACEHOLDER, not "Email"
  textbox "••••••••"          ← accessible name is a row of dots
  button                      ← the show/hide toggle has NO accessible name at all
  ```
  `<Label>` is not bound with `htmlFor`/`id`, so the visible labels are decorative. And **zero
  `autoComplete` attributes exist across all four auth pages** (code-verified) — no password manager
  will offer to save or fill. Combined with no confirm-password field, a typo'd password is
  recoverable only via the reset flow.
- `[LOW]` **The password placeholder is a row of dots**, which reads as a pre-filled value.
- `[LOW]` **Signing out lands on `/login`**, a form, rather than the landing page — implying "sign in
  again" to someone who just chose to leave.

**Whole picture.** Visually and structurally excellent; programmatically unfinished. A developer using
a password manager — i.e. most of them — hits friction on their first interaction with the product.

---

## 3. Dashboard (`/dashboard`)

**What you see:** page title + *"All your connected repositories and their analysis status in one
place."* Top-right: `Join Project`, `Add Project`. A full-width row of four stat tiles
(Projects / Analyzing / Up to date / Pending invites). Below-left: "Recent projects" with a `View all`
link and project cards. Below-right: "Recent activity", a list of ~8 rows.

### 3.1 The four stat tiles

Signed in as a new user with two projects, they read `2 / 0 / 1 / 0`.

- `[MED]` **Two of the four tiles carry the same fact.** For anyone with one project, "Projects" and
  "Up to date" are the same number. Two of four read `0`. Four card-shaped elements spanning the full
  width to deliver, effectively, one number. **Verdict: `OUR COMFORT, NOT THEIRS` —** the tiles are
  cheap to build and look like a dashboard; they don't inform.
- `[MED]` **They look clickable and aren't.** Card-shaped, icon + big number, sitting immediately
  above genuinely clickable project cards. `cursor: auto` at least doesn't lie. But "Pending invites 0"
  is the one a user *would* click.
- `[LOW]` **The "Analyzing" tile uses a spinner glyph (`Loader2`) as its resting icon** — a static
  spinner implies activity when the count is zero.
- `[LOW]` `1 Projects` — singular/plural not handled.

*Fix: collapse to a single line of text ("2 projects · 1 up to date · 0 analyzing"), or make each tile
a filter link into the project list. Either reclaims ~90px of the most valuable space on the page.*

### 3.2 The project card — asked component by component

This is the densest small component in the product, so it earns the closest read. Top to bottom:
**repo name · `DEVELOPER` badge · status icon · description · status word · progress bar · language ·
`STALE 0` · `Updated 8d ago`.**

| Element | What a new developer asks | Finding |
|---|---|---|
| `OnboardBuddy` | *Which repo is this?* | `[MED]` Bare repo name, while the activity feed 800px right says `KuanKongy/OnboardBuddy`. Two repos named `api` from different owners would be **indistinguishable**. **`ACCIDENT`.** |
| `DEVELOPER` | *Is this about me or the project?* | `[MED]` Prime position beside the title, **identical on all 4 cards** — zero discriminating value in the most-scanned slot. `tierColors` also has a dead `contributor` key that is not a tier in this app. Owner renders **amber**, which reads as caution. **`ACCIDENT`.** |
| ✓ icon (top-right) | — | `[MED]` **Status is shown twice**, as an icon here and as a word 45px below. Two encodings of one fact. **`ACCIDENT`.** |
| description | *What is this repo?* | `[MED]` **6 of 10 real projects have no description** — the majority case. `min-h-4` reserves the line (deliberate, for grid alignment — good) but there is **no fallback copy**, so most cards show an unexplained blank gap. *"No description on GitHub" costs nothing.* **`RIGHT, MISPRESENTED`.** |
| `Ready` / `Complete` | *Is this good?* | `[MED]` **"Ready" means "nothing has happened yet"** — and its own tooltip says *"This project hasn't been analyzed yet."* The label reads positive; the tooltip corrects it. Scanning a list, "Ready" and "Complete" both look fine. **`ACCIDENT`.** *Fix: "Not analyzed", and the tooltip becomes reinforcement instead of a correction.* |
| progress bar | *Is something running?* | `[MED]` Complete → **100% green bar** (decoration). Idle → **empty 0% track plus a dashed-circle icon**, i.e. **two signals that say "in progress"** for a project where nothing is running. The bar is informative for ~3 minutes of a project's life and is the widest, highest-contrast element on the card in all states. **`ACCIDENT`.** |
| `● TypeScript` | *Is this my stack?* | `ACCEPTABLE`. GitHub's linguist colour convention, with a documented hardcoded palette and a grey fallback. One real project has `NULL` language and correctly omits it. |
| `STALE 0` | *Is something wrong?* | `[MED]` Always rendered, and at zero the number uses **`text-foreground` — the brightest token in the theme**. Maximum visual emphasis on a non-issue, on every card. **`ACCIDENT`.** *Fix: hide below 1.* |
| `Updated 8d ago` | *When did this last change?* | `[MED]` **Three different facts wearing one label**: `repo_pushed_at ?? last_analyzed_at ?? created_at`. **Live proof:** this card says "Updated 8d ago" (last GitHub push) while the activity feed beside it says the analysis completed **13h ago**, and the package regenerated **yesterday**. Two disagreeing answers to "when did this change", on one screen, and the label never says which meaning applies. **`ACCIDENT`.** |
| — | *Which branch/commit?* | `[MED]` **Absent.** M4's headline change made projects branch- and commit-aware; the card shows neither, while the activity feed shows `· main`. |

`[LOW]` The `analyzing` state falls back to a **hardcoded 45%** when the project says "analyzing" but
no live job is found. Not a regression of bug #42 — the live percentage is used when a job exists —
but that fallback now renders **only** in the stuck-job state (#69), i.e. it invents confident
progress exactly when nothing is happening.

### 3.3 Recent activity

- `[MED]` **8 rows, 7 near-identical**: "Incremental update completed · main" ×4, "Analysis completed
  · main" ×3. No aggregation. **Three rows all read "15h ago"** — unorderable. **`ACCIDENT`.**
- **Good:** rows *are* links (`cursor: pointer`, verified), and the first row uses a different icon to
  distinguish "package generated" from "analysis completed" — though there is no legend for that.

### 3.4 The page as a whole

`[MED]` **The dashboard occupies the top ~320px of an 840px viewport** and leaves the rest blank; one
project card fills 21% of its row. A new developer's first authenticated screen is mostly empty, and
what fills it is four numbers and a repetitive log — rather than the one thing they want, which is
*"here is the codebase, start here."*

*Structural fix: put the most recent package's "next unread section" on the dashboard as the primary
CTA. The data already exists (per-user read tracking shipped in M4). That converts the dashboard from
a status board into a continue-reading surface.*

---

## 4. Project list (`/list`)

**What you see:** search box (*"Search projects by name, language or description…"*), filter chips
`All | Active | Stale | Completed | Failed`, a card grid, and a dashed "Add New Repository" card.

- `[MED]` **Card vocabulary and filter vocabulary are different vocabularies.** Cards say
  Ready / In Progress / Complete / Failed. Filters offer All / Active / Stale / Completed / Failed.
  **Only "Failed" matches**, and **no filter finds idle ("Ready") projects** — the most actionable
  segment on the page is unfilterable. **`ACCIDENT`.**
- `[LOW]` **Filter chips carry no counts**, so `Failed` can lead to an empty list — a click that
  could have been prevented.
- `[MED]` **Four names for one action, two visible simultaneously here:** "Add Project" (header),
  "Add New Repository" (grid card), "Import Repository" (dashboard empty state), "Import a repository"
  (the destination page title). **`ACCIDENT`.**
- `[LOW]` The search box offers to search **description** — which 6 of 10 projects don't have.

---

## 5. Project shell (entering a project)

**What you see:** the sidebar changes. Repo name, a `⑂ main` branch badge, a package selector
(*"Latest analysis / auto-follows the newest run"*), then project tabs: Project Overview, Your
Onboarding, Architecture, Dependencies, Capabilities, Workflows, Tutorials, Team, Settings.

- `[HIGH]` **Entering a project deletes all global navigation.** Dashboard / Project list /
  Invitations / Settings / Help are **replaced**. The only ways out are the logo
  (`title="Back to main dashboard"`) or browser Back. There is no breadcrumb and no "All projects".
  **`ACCIDENT`.**

  *On the "is using the logo to go home confusing?" question:* the convention itself is standard and
  fine. The defect is that it is the **sole** exit — and that the **shallower** Account Settings page
  *does* have an explicit "← Back to dashboard" while the **deeper** project shell does not. The
  convention is applied at the wrong depth.

  *Fix: a breadcrumb — `All projects / KuanKongy/OnboardBuddy / Dependencies` — resolves the exit, the
  orientation, and the inconsistency in one component.*

- **Good:** the package selector explains itself in its own subtitle and its tooltip (*"Which package
  every tab shows — branch, commit, scope, and role"*). A data selector needs exactly this and gets it.

---

## 6. Project Overview

**What you see:** `Overview`, then `KuanKongy/OnboardBuddy · General · latest: main@9f4d168 · 268
files · 1272 symbols · 76 workflows`. Three quick-action cards. A `Packages` section with three
filters and a card. Then `Run history` — 20 rows.

- `[HIGH]` **This is an operator's page shown unchanged to the onboardee.** As a Developer, ~60% of
  the page is run history: 20 rows of per-run LLM cost, call counts and durations for operations this
  role **cannot start, pause, or pay for**. Cost is shown to four decimal places (`$0.0224`) twenty
  times, with **no total**. The thing they came for is one small card above it.
  **`OUR COMFORT, NOT THEIRS`** — the page grew for whoever was running analyses, and was never
  re-read as the person receiving them.

  *Fix: gate run history and spend behind owner/admin; for developers put "Continue reading:
  \<section\>" and their read progress in that space.*

- `[MED]` **Quick-action cards contradict themselves.** Title *"Continue onboarding"* + link *"Start
  reading"* — one of the two is always wrong. Same for *"Continue tutorial"* / *"Start a tutorial"*.
  The third is titled *"General Role"* with the action *"View team"* — title and action unrelated.
  **`ACCIDENT`.**
- `[MED]` **Three filter dropdowns above one package**, with the count rendered `1 / 1`. Control-to-
  content ratio inverted. **`ACCIDENT`.**
- `[MED]` **Three date formats on this one page:** `24/07/2026` (package card), `24 Jul, 14:40` (run
  history), `8d ago` (elsewhere). Six across the app.
- `[MED]` **Run history truncates silently at 20** — no count, no pagination, no "load more"
  (verified absent). A project analysed over weeks loses its history with nothing saying so.
- `[MED]` **Nested scroll:** the document never scrolls (`scrollHeight == innerHeight`, `scrollTop`
  stays 0) — an inner container does. Scrolling appears to work, then stops with content below.
- `[LOW]` Failed rows have inconsistent fields — one shows cost and calls but no duration, another
  duration but no cost. And a run that generated nothing renders **"Generated:"** with an empty list.

**The expanded run row is the best-designed component on this page** — `branch main` / `commit
9f4d168` / `general role` chips, `by khanhpronam@gmail.com` attribution, an explicit `Generated:
capabilities, traced flows` (cached-vs-fresh), then a timestamped step log. But:

- `[MED]` **It ends by contradicting itself.** A run marked `complete` ($0.0224, 10 calls, 49s) ends
  with **"No run recorded yet for this snapshot."** Generation runs have no `snapshot_phases` rows, so
  the analysis-phase panel renders anyway and reports absence as "nothing ran". It also prints generic
  boilerplate about privacy modes that is irrelevant to the run being viewed. **`ACCIDENT`.**

---

## 7. Your Onboarding — the package grid

**What you see:** three filter dropdowns, `1 / 1 packages`, one card, `How packages work` link.

- `[MED]` **An interstitial on the critical path.** The user clicked "Your Onboarding" to *read*; they
  got a one-item gallery. **`DELIBERATE, WRONG`** — the grid exists for the many-packages case, which
  is not the common case. *Fix: when exactly one package matches, open it. "← Packages" already exists
  in the reader and works well.*
- `[WITHDRAWN]` ~~**A Developer is offered an action the API forbids** (`Regenerate…` would 403).~~
  **This finding was wrong and is retracted.** It cited `onboarding.ts:26` (the per-**section**
  regenerate route, which is indeed owner/admin) but the card's `Regenerate…` calls
  `POST /projects/:id/onboarding/generate` — `onboarding.ts:107`, which is
  `requireProjectAccess()`, **any member**, deliberately, per the comment at `:103-106`.
  **Developers can regenerate a whole package and it succeeds.** The 403 was inferred from a route
  I never called: the dialog was opened, Confirm was never pressed. Two other ungated-and-allowed
  paths confirm the design is intentional — `OnboardingPage.tsx:1352` ("Retry" on a failed package)
  and `:1515` ("Generate for {Role}") hit the same any-member route.
  The real permission mismatch on this surface is the opposite shape and is recorded in
  [§20.1](#201-the-real-permission-mismatches--operated-not-inferred): the flagship
  "Analyze & generate…" entry points are `canManage`-gated even though the API allows any member,
  so developers are **denied in the UI a capability the backend grants them**.
- `[MED]` **`Draft` is shown to the only role that cannot clear it**, on the primary artifact,
  three times per journey (Overview card, grid card, reader top bar). Reads as "not ready" with no
  available action. **`DELIBERATE, WRONG`.**
- `[LOW]` `2 low confidence` is the only coloured element on the card, so the eye lands on the
  negative before the title.

---

## 8. The onboarding reader — the product

**What you see:** `← Packages`, the section title, `Draft` `General` `Mark as read` `Ask` and two
icon buttons. A trust strip. Left: `SECTIONS 0/12 read`, a `SUGGESTED FOR YOU` box, then four chapter
groups. Right: a confidence pill, then content.

### 8.1 The trust layer — the most important finding in this document

- `[HIGH]` **Confidence is inversely correlated with evidence.** **`ACCIDENT`.** Across all 12
  sections of the live package:

  | | Sections | Receipts | Confidence |
  |---|---|---|---|
  | **With** receipts | 2 (`capabilities`, `traced_flows`) | 12 and 8 | **both `low`** |
  | **Zero** receipts | 10 | 0 | 7×`medium`, **3×`high`** |

  20 receipts in the whole package. `concepts`, `first_change` and `guardrails_ops` are **High with
  zero receipts**. A reader using the badge to decide what to trust is steered **away** from the
  evidenced content. In the reader this is a `Medium Confidence` pill beside the sentence *"no
  receipts — content is not independently verifiable"*; the provenance panel prints that
  contradiction **nine times in one scroll**.

- `[HIGH]` **The deterministic-first design is right and the UI calls it a weakness.**
  **`RIGHT, MISPRESENTED`. Decided 2026-07-24** in
  [ONBOARDING_QUALITY_LATENCY_PLAN.md](./ONBOARDING_QUALITY_LATENCY_PLAN.md) step 2 (*"reference
  sections: uncited backbone claims are the contract"*). Three of the ten zero-receipt sections are
  the CONSULT chapter, whose tables are generated from code facts and only annotated. For these, zero
  receipts is **correct** — the table *is* the evidence, and a generated table is **more** verifiable
  than a cited prose claim. The reader says the opposite, on the three most mechanically verifiable
  sections in the package. *Fix — cheapest high-value change in this document: give reference sections
  their own provenance line ("built from code facts — no model claims to verify") and exempt them from
  the receipt-count framing.*

- `[HIGH]` **The first section every new reader is sent to cites nothing.** The "Suggested for you"
  rail sends everyone to **The Big Picture** first: 0 receipts, no TL;DR, opening with *"Medium
  Confidence · no receipts — content is not independently verifiable"*. The product's first impression
  is a paragraph saying it cannot be checked — while the topology diagram directly above it is derived
  from real Compose config, so **the evidence exists and simply is not attached.**

- `[MED]` **"0/0 claims cited"** (`receiptPresentation.ts:107`) conflates *"we did not track claims"*
  with *"this cannot be verified"*. Different statements; only the first is true.

- `[MED]` **Documentation claims that outran the build.** "Every claim carries a clickable source
  receipt" (10 of 12 have none) and "each section opens with a TL;DR" (7 of 12). **Both corrected in
  the README as part of this audit.**

### 8.2 The trust strip

`Analyzed 268 files (2 unsupported skipped) · cites 23 of 1272 symbols in 15 files · 4 of 76 traced
workflows in sections & tutorials · ranked by 9 signals · 6 known unknowns` — and right-aligned,
`Everything else → Dependencies`.

- `[MED]` **Honest but unframed.** *"cites 23 of 1272 symbols"* is **1.8%**; *"4 of 76 workflows"* is
  5%. A developer deciding whether to trust this doc reads those ratios as "covers 2% of the code".
  The intent is transparency; the effect is self-harm. *Fix: frame it — "cites the 23 symbols the
  ranking put in the critical path" — or express coverage against what was in scope, not the total.*
- **Good:** `Everything else → Dependencies` is a genuinely thoughtful touch — it tells the reader
  where the uncited 98% lives instead of pretending it doesn't exist.

### 8.3 The section navigation

- `[MED]` **27 nav entries for 12 sections.** The `SUGGESTED FOR YOU` box repeats items 1, 2 and 7,
  which are visible **immediately below it in the same 195px column**. **`ACCIDENT`.**
- `[MED]` **4 of 12 titles truncate** — `Traced Flows: End to…`, `Code Map: Files That …`,
  `Capabilities: What It …`, `Routes, Jobs & Webho…`. Root cause: titles written as descriptive
  phrases, then placed in a narrow fixed column. *Fix: short nav forms + full titles in the content.*
- `[MED]` **Red dots mark low-confidence sections with no legend anywhere.** A reader cannot tell
  whether red means unread, error, or low confidence. **`ACCIDENT`.**
- **The `SUGGESTED FOR YOU` blurbs are the best copy in the product** — *"The 10-minute map —
  everything else refers back to it"*, *"Get it running on day one; every later section assumes you
  can"*. They explain **why** to read, not what it is. This is the standard the rest of the app should
  meet.

### 8.4 The top bar

- `[MED]` **`Mark as read` is the most visually prominent control in the reader** — a progress
  checkbox styled as a primary CTA — while **`Ask`**, which is far more valuable to a time-poor
  developer, is a plain ghost button. **`ACCIDENT`.** *Fix: swap the emphasis.*
- **Good:** both icon-only buttons are properly labelled (`aria-label="How this package was made"`,
  `"Export options"`), and there is a `Jump to section` select and a `Next: …` pager.

### 8.5 Inline citations and the receipt viewer

- `[MED]` **Citation chips are the least prominent interactive element on the page** — small numeric
  boxes that read as punctuation — and they are the entry point to the product's best feature.
  Numbering is receipt-id based, so **the same number appears twice and the sequence starts at 2 with
  no 1**, which reads as a bug.

**Then you click one, and the product is suddenly excellent.**

The receipt viewer shows: file path → symbol → `Lines 419–458` → **`(first 40 of 53 lines)`** →
`High` → **`✓ Verified against 9f4d168b`** → `analyzed today` → **What this does** (plain language) →
real code with line numbers → **`This receipt supports:` \<the claim\>** → `View on GitHub`.

That closes the claim→evidence loop, admits its own truncation, and pins verification to a commit.
**This is the product's thesis, working.** But:

- `[MED]` **Half the evidence is off-screen.** The code pane needs **1196px** and gets **628px**,
  inside a dialog capped at **672px in a 1728px viewport**. `overflow-x: auto` exists but the
  scrollbar is invisible in dark mode. **`ACCIDENT`** — the constraint is a max-width, not the
  viewport. *Fix: raise the cap. One value.*
- `[MED]` **No next/prev between a section's 12 receipts.** To see receipt 3 you close, hunt for a
  chip, and reopen. **`ACCIDENT`.**
- `[LOW]` A tooltip (*"How strongly this claim is backed by code evidence."*) renders **over the
  dialog header** on open.
- `[LOW]` The header reads as one run-on string to a screen reader:
  `workflowExtractor.tspersistWorkflowsLines 419–458(first 40 of 53 lines)HighVerified against
  9f4d168banalyzed today`.

### 8.6 The provenance panel — honest to the point of self-indictment

`main@9f4d168 · General Role · depth: standard · privacy: full ai`, then **Models & spend: 528 calls ·
$0.9985**, both tiers itemised with **`3 failed`** surfaced, then a per-section record.

- **This is a credit to the instrumentation** and should not be hidden. It is also where §8.1 is most
  visible: nine rows of `High` / `0 receipts` / *"not independently verifiable"*.
- `[LOW]` **Both tiers show the same model** (`gemini-2.5-flash-lite`) labelled `strong` and `cheap` —
  as displayed, the labels are meaningless.
- `[LOW]` **`section-v5`** — an internal prompt version — is printed to the user.

---

## 9. Dependencies — the "understand the code" tab

**What you see:** `227 files · 4170 edges (grouped)`, `Show all edges`, `LR|TB`, `Files | Classes &
interfaces`, a fullscreen toggle. A notice: *"Large codebase (227 files) — showing directory groups.
Click a group to drill in."* A search box, `8 / 8 groups`. Then 8 large node cards.

### 9.1 The grouped view

- `[HIGH]` **Every node says "0 imported by" while edges are visibly drawn into them.**
  `backend/src/` reads *"392 imports · 0 imported by"* with **two edges terminating on it in the same
  viewport**. The graph refutes its own labels on screen, on the tab whose entire job is showing what
  depends on what. `graph.ts:73` hardcodes `dependentCount: 0` for groups. **`ACCIDENT`.**
- `[HIGH]` **No arrowheads on any edge.** The legend says *"an edge means the source file imports
  (depends on) the target"* — direction is the whole semantic and is **not encoded at all**; both ends
  render as identical small circles. A dependency graph you cannot read the direction of is a
  connectivity graph. **`ACCIDENT`.**
- `[MED]` **Two contradictory instructions on one screen.** The notice says *"Click a group to drill
  in"*; the legend says *"Click a node to select it — its direct neighbors stay lit while everything
  else dims."* Both are true at different levels, but nothing says so. **`ACCIDENT`.**
- `[MED]` **Grouping is one level deep and non-hierarchical.** `frontend/ (2 files)` is a **sibling**
  of `frontend/src/ (89 files)`, so the tree contradicts the filesystem. `./ (1 files)` is opaque.
- `[LOW]` `MODULE` badge on 7 of 8 nodes; `1 files` grammar; 5 of 8 nodes are disconnected singletons,
  so half the canvas shows things with no relationships.
- `[MED]` `227 files` here vs `268 files` in the reader's trust strip — two numbers for one repo.

### 9.2 Drilling in — the worst screen in the product

Click `backend/src/` and you get `Dependencies / backend / src`, `Up one level`, `60 / 60 files`, and
an **unreadable grey hairball**. Measured:

| | Value |
|---|---|
| Nodes / edges | 60 / 155 |
| Graph size | **3282 × 4263px** |
| Pane | **1462 × 764px** |
| `fitView` zoom | **0.15×** |
| Node rendered size | **36 × 16px** (from 240×108) |
| **Label font rendered** | **2.1px** (14px × 0.15) |
| Legible? | **No** — ~4× below the ~9px floor |

- `[HIGH]` **The flagship interaction renders text at 2.1 pixels.** Not "hard to read" — physically
  impossible. **`OUR COMFORT, NOT THEIRS`,** and traceably so: the M4 commit *deliberately* set "an
  explicit low `minZoom` so `fitView` isn't clamped to the default 0.5 floor on large graphs". The
  change was made so the whole graph would **fit**; fitting is our convenience, reading is the user's
  need. See §12.1 for the fix.

### 9.3 Selecting a file — this part works

Clicking a file zooms in, dims non-neighbours, reveals **edge labels** (`TESTS`), and opens a right
panel: file name, path, three icon buttons, `IMPORTANCE ⓘ Adjust weights`, *"Not ranked in this
snapshot"*, `IMPORTS (5)` listed, and *"Part of the **Backend · Tests** component — see the
Architecture tab."*

Good: the cross-link to Architecture, the honest "not ranked", the `ⓘ` ranking explainer, and edge
labels appearing at readable zoom. But:

- `[MED]` **`Adjust weights` is offered to a Developer** — `NodeInfoPanel.tsx:181-188` renders the
  link for every tier; it lands on `ProjectSettingsPage.tsx:569-611` where the sliders are `disabled`
  and both save buttons are hidden. No 403 — a **dead end**, which is a different and milder defect
  than the withdrawn `Regenerate…` claim above. `HelpPage.tsx:188` makes the same promise in prose to
  all tiers. Confirmed by operation in [§20.1](#201-the-real-permission-mismatches--operated-not-inferred).
- `[MED]` **The panel lists `IMPORTS` but never "imported by".** The reverse direction — *"what breaks
  if I change this?"*, the single most valuable question a new developer has — is missing here **and**
  wrong in the grouped view (§9.1).
- `[LOW]` The panel **overlays the canvas**, clipping the neighbour it just highlighted. Node label and
  path both truncate. Three icon-only buttons.
- `[LOW]` `IMPORTS (5)` lists bare filenames — if they aren't links, that's a missed chance to
  navigate the graph by name instead of hunting nodes.

---

## 10. Architecture

**What you see:** `14 components · 50 connections`, a compact horizontal colour key of 8 categories, a
search box, then component cards with a coloured dot, truncated title, category badge, 2-line
description, `N files`, and a small criticality bar.

- `[HIGH]` **The legend promises a colour→category mapping the palette cannot deliver.**
  Source-verified: `CLUSTER_KIND_PALETTE` maps **12 cluster kinds onto 7 colours**, so five colours
  each carry two meanings — `frontend_ui` **and** `frontend_state` are both `--node-ui`; `api_layer`
  and `auth_layer` are both `--node-api`; likewise worker/analysis, integration/devops, shared/other.
  The legend lists them as separate labelled categories each with a dot. **A purple node may be
  Frontend UI or Frontend state** — the two labels most likely to be confused. **`ACCIDENT`.**
  *The palette itself is good (7 well-separated hues, distinct light/dark, wired to `--chart-*`). Fix
  the mapping or add a second channel; do not add hues — 7 is the practical ceiling.*
- `[MED]` **7 of 14 titles truncate**, and three become indistinguishable: `Backend · Mo…`,
  `Frontend · Mo…`, `Modules`.
- `[MED]` **A component contradicts itself:** `Database Schema`'s description reads *"Database Schema:
  0 files."* while its own footer reads **"37 files"**. Flagged in the previous audit; **still there**.
- `[MED]` **Criticality bars are ~30×3px** with no scale, label or tooltip — the only quantitative
  encoding on the tab, and it conveys nothing.
- `[LOW]` 50 edges among 14 nodes with no arrowheads = a crossing-curve hairball in the middle; two
  orphan nodes at the bottom.
- **Good:** the horizontal colour key above the canvas is better placed than Dependencies' 5-line prose
  box, which sits **on top of** the graph.

---

## 11. Workflows — the layout problem, measured and solved

**What you see:** a left rail, `TRACED FLOWS (76) — MOST CRITICAL FIRST`, numbered entries with kind
and step count. Selecting one shows a summary line, a `Why it matters` line, and a vertical graph.

**Good first:** *"Handles POST /api/projects/:id/ask (ui): writes data, responds to the caller"* and
**`Why it matters: Traces HTTP POST through 21 steps · Reaches 14 side-effect steps`** is excellent —
it answers "should I care?" before "what is it?". The rail explains its own ordering. Node kinds do
work on real flows (`TRIGGER`, `TRANSFORM`, `DATA READ`).

### 11.1 The reported problem, quantified

Selecting the 21-step `POST /api/projects/:id/ask` flow:

| | Value |
|---|---|
| Nodes in **one** column | **21 of 21** (`distinctColumns: 1`) |
| Graph size | **224 × 2254px** |
| Pane | **1200 × 824px** |
| Width used | **18.7%** — 81% of the canvas is empty |
| Steps fully visible | **4 of 21** |
| `fitView` zoom | **1.83× — it zoomed *in***, worsening overflow |

- `[HIGH]` **A 1:10 aspect-ratio graph is being laid out in a 1.46:1 landscape pane.** You see 4 steps
  at a time, scroll roughly three pane-heights to read one flow, and 81% of the width is empty
  throughout. **`ACCIDENT`** — `graphLayout.ts` hardcodes `rankdir: TB` for flows, and dagre on a
  linear chain necessarily produces one column.
- `[HIGH]` **Workflows is the only graph tab that received none of M4's layout controls.**
  Code-verified: `GraphPage` and `ArchitecturePage` each have the `LR/TB` toggle **and** fullscreen;
  `WorkflowsPage` has **neither** (0 for both). The tab with the worst layout problem got no layout
  affordances.
- `[MED]` **Journey steps are numbered with gaps** — the auth journey renders `1, 3, 6, 8` while its
  rail entry says "10 steps". Composed journeys render only boundary steps, which is reasonable, but
  visible gaps read as missing data. **`DELIBERATE, WRONG`.**
- `[MED]` **Flow-kind labels mix raw enums and prose in one list:** `journey`, `dev_command`,
  `ci_pipeline`, `message_consumer` beside `UI page`, `HTTP POST`, `HTTP GET`.
- `[LOW]` 6 of 16 visible rail entries truncate. `(ui)` appears raw in the summary line.

### 11.2 How to fix the placement

The answer is not "zoom out" — that is what broke Dependencies (§9.2). It is to **stop laying out a
long chain as a single column.** In priority order:

1. **Wrap the chain into columns sized to the pane (the main fix).** At 224×54 nodes with a 110px
   pitch, a 1200×824 pane holds ~4 columns × ~7 rows = **28 slots** — so **all 21 steps fit at full
   readable scale with no scrolling.** Reading order stays unambiguous because **every node already
   carries its step number**; add a connector from each column's foot to the next column's head.
   This is a layout-function change, not new UI.
2. **Collapse consecutive runs before laying out.** Adjacent steps frequently share a file and kind
   (the tutorial data shows 8 of 14 steps duplicating a neighbour). Collapse them into one node
   badged `×3`, expandable. This typically cuts a 21-step flow to ~10 semantic hops — after which
   even a single column fits.
3. **Reuse the pattern the app already has.** **The Tutorials tab already solved this**: a step rail +
   pager + one detail pane renders a 14-step flow legibly. Workflows renders the same shape of data as
   an unbounded vertical graph. One teammate solved long-sequence display; the other tab didn't adopt
   it. Adding the rail to Workflows is reuse, not new design.
4. **Give Workflows the fullscreen and direction toggles its siblings have** — necessary but not
   sufficient (fullscreen at 824→~1400px still shows only ~7 of 21).
5. **Swimlanes by step kind** as a *secondary* view (trigger → transforms → data → response). It uses
   width meaningfully and teaches the taxonomy, but it breaks strict sequence, so it must not be the
   default.

---

## 12. Capabilities — the best surface in the product

Six cards, each: title, `HIGH CONFIDENCE`, a one-line description, **`When you'll touch it:`**, a
`START HERE` box (file + `#symbol` + why each matters), `FLOWS THAT DELIVER IT` with descriptions,
`WHERE THE CODE LIVES` chips, and `See it on the architecture map →`.

**This is what the other tabs should look like.** It is task-oriented rather than structure-oriented,
it tells a new developer where to begin, and it cross-links. `When you'll touch it` is the single most
user-centered piece of copy in the app.

- `[MED]` **All six cards read `HIGH CONFIDENCE`** — a badge with zero variance — **and this
  contradicts the reader**, where the `capabilities` *section* is rated **Low Confidence**. Same
  underlying data, opposite verdicts on two screens. **`ACCIDENT`.**
- `[MED]` **The first card has no `START HERE` box** while its siblings do — the most useful block is
  missing from the card a reader sees first, leaving a large empty area and ragged 2-column heights.
- `[LOW]` `#ProjectSettingsPage` syntax is never explained; long paths truncate mid-identifier.

---

## 13. Tutorials — and the dots question

**What you see:** a tutorial list (`14 steps · high confidence`), then `Step 1 of 14`, the step's
symbol, a step-dot row with `‹ ›` arrows, a file chip with `Open in Dependencies →`, code on the left,
explanation on the right with `Backed by: file:line`.

**The layout is right:** code and explanation side by side, receipts per step, a cross-link out.

**On the "can you click the dots to jump, or only the arrows?" question — you can:**

Each dot **is** a real `<button>` with `aria-label="Go to step 7: POST /installations/link"`, a
`title`, and a **24×24px hit area** (bug #51's widening held). `Previous` is correctly disabled on
step 1.

- `[MED]` **But `cursor: default` on all 14 dots and both arrows**, and the visible dot is ~4px inside
  its 24px button. Nothing signals interactivity, so a working feature reads as a progress ornament.
  **`WORKS, UNDISCOVERABLE`.** *Fix: `cursor-pointer` plus a hover state — one line, high impact.*
- `[MED]` **8 of 14 step titles duplicate an adjacent step** (3 & 4 both `POST /oauth/complete`;
  12, 13, 14 all `DELETE /connection`). The dot tooltips cannot distinguish them, so jump-to-step is
  unusable across half the flow. Steps 2 and 11 are titled bare `"sign"`.
- `[LOW]` The tutorial is named *"Trace GitHub Repo Import & Connection Flow"* but includes
  `DELETE /connection` steps — disconnecting is not importing.
- `[LOW]` Untested beyond 14 steps; the dot row would overflow or shrink below that.

---

## 14. Account Settings

**What you see:** `Back to dashboard`, then cards: Profile · GitHub Login · Email Login · GitHub App
(Repo Import) · Appearance · Help & privacy · **Danger Zone**.

- `[MED]` **`Sign Out` lives in the Danger Zone**, ~50px from a filled-red `Delete account` — a
  routine, reversible, frequent action adjacent to the only irreversible one, where **account deletion
  is the most visually prominent button on the page**. And there is **no sign-out anywhere else** — not
  in the sidebar, not in the account card — so the only path out of the product runs through the
  destructive block. **`ACCIDENT`.**
- `[LOW]` **No "change password"** anywhere; Email Login offers only `Unlink`. Password change is only
  possible via the forgot-password flow.
- `[LOW]` The base-font-size control spans the full ~470px card for three options needing ~200px,
  leaving an empty track that reads as broken.
- `[LOW]` *"Member since 22 July 2026"* is a **sixth** date format.
- `ACCEPTABLE`: two GitHub cards (`GitHub Login` vs `GitHub App (Repo Import)`) expose an
  implementation distinction, but *"Not connected — required for repo import"* makes it about as clear
  as it can be.

---

## 15. Help & FAQ — and what its existence tells us

**What you see:** `Tours` (a project selector + 4 tours, each with a description and `Start`), then
**nine FAQ questions**, then `Privacy & AI transparency`.

**This is the strongest page in the app for a new developer evaluating the tool.** The nine questions
are the *right* nine: *What happens when I analyze a repo? · What does "Complete" mean? · What is sent
to the AI — is my code used for training? · How is "critical code" ranked? · Why do sections go
"stale"? · How do I use the dependency graph? · What are receipts? · Can I edit the generated text? ·
Where are keyboard shortcuts?* The tours note *"starting one doesn't affect whether it auto-starts
again on its own"* — a considerate detail.

- `[MED]` **But three of those nine questions exist because the UI doesn't answer them.** *"What does
  'Complete' mean?"* is needed because the status vocabulary is ambiguous (§3.2). *"How do I use the
  dependency graph?"* is needed because the graph isn't self-evident (§9). *"What are receipts?"* is
  needed because the citation chips don't look like anything (§8.5). **A FAQ that explains your own
  vocabulary is excellent mitigation and a diagnostic**: each entry marks a place where the interface
  could have been self-explanatory. *Treat the FAQ as a backlog, not just a feature.*

---

## 16. The first-run tour

Created a brand-new account mid-audit: the dashboard tour fired (`1 of 5`, *"Get around"*), and on
first entering a project the project tour fired (`1 of 10`, *"Start at the overview"*). Dismissal is
per-account (bug #49's fix holding).

- `[MED]` **The tour overlay silently swallows the user's first click.** I clicked a workflow; nothing
  happened, because `<div data-tour-overlay class="fixed inset-0 z-[60]">` intercepted it. The dimming
  is subtle enough to miss, so the user's first interaction with a project tab does nothing and they
  are not told why. *(This is also why the project's own Playwright test fails — the same
  interception.)* **`ACCIDENT`.** *Fix: let a click outside the tour card dismiss the tour and pass
  through, or dim harder so the modal state is unmistakable.*
- `[LOW]` The project tour opens by spotlighting **Project Overview in the sidebar while you are on
  the Workflows page** — it starts by pointing somewhere you aren't.
- `[LOW]` The tour card sits bottom-left, **overlapping the account card**.

---

# Part 2 — Cross-cutting

- `[HIGH]` **No page titles, no focus management, no skip link.** Zero `document.title` calls in the
  entire frontend — every tab and history entry reads "OnboardBuddy". No focus reset on route change.
  No skip-to-content, so keyboard users tab through logo, up to nine nav links, tour/shortcut buttons,
  account card and theme toggle on **every** page.
- `[MED]` **A `title` attribute overriding a visible label:** the shortcuts button reads "Keyboard
  shortcuts" on screen but announces **"Also opens with ?"** (`Sidebar.tsx:77`,
  `ProjectLayout.tsx:271`).
- `[MED]` **The sidebar prints a role nobody has.** `AccountCard.tsx:29` falls back to `"Member"` when
  auth metadata has no title — a fabricated global role, since tiers are per-project. Names truncate
  hard: `UX Audit Tester` → `UX Audit Te…`.
- `[MED]` **Six date formats** app-wide: `8d ago` · `24/07/2026` · `24 Jul, 14:40` · `analyzed today`
  · `24/07/2026, 04:31:54` · `Member since 22 July 2026`.
- `[MED]` **Internal vocabulary reaches the reader:** `dev_command`/`ci_pipeline`/`message_consumer`
  beside humanised siblings; `section-v5`; *"the `backend/workers` cluster"* with no link to where
  "cluster" is defined; unexplained `#Symbol` syntax.
- `[MED]` **No `prefers-reduced-motion`** while the app runs perpetual motion (animated flow edges,
  pulsing dots, camera glides). **"Make default" star unreachable by keyboard.**
- **Responsive:** the project's own 390×844 suite passes **10 of 12** — dashboard and most tabs fit a
  phone, and the sidebar drawer works. **But the reader's phone test has been failing since the M4
  content rebuild on a pre-Diátaxis selector** (`getByText('What this service does')`), so the main
  content surface is **unverified** on phones. `md:` is used **twice** in the whole frontend (no tablet
  story), and `AnalysisRunPanel` has **zero** responsive utilities. Detail in
  [UX_VISUAL_AUDIT.md §5](./UX_VISUAL_AUDIT.md).
- **Dark theme:** every structural contrast pair fails WCAG's 3:1 (`card/background` **1.09**,
  `popover/background` **1.18**, `input/card` **1.43**), while every text pair passes. Measured from
  rendered tokens; detail in [UX_VISUAL_AUDIT.md §1](./UX_VISUAL_AUDIT.md).

---

# Part 3 — The pattern behind the findings

Three themes explain most of this document.

**1. The UI states things it cannot support.** "0 imported by" beside a visible inbound edge. `High`
confidence beside "not independently verifiable". "Updated 8d ago" beside "13h ago". "No run recorded"
inside a completed run. `Ready` meaning "nothing happened". "Database Schema: 0 files" beside "37
files". Each is small; collectively they teach a new developer that **the numbers on screen are not
load-bearing** — which is fatal for a product whose only asset is trust.

**2. Actions are offered to people who cannot take them.** `Adjust weights` lands a Developer on a page
of disabled sliders; `Draft` and `Mark reviewed` are shown to someone who cannot review. The sharpest
case is not on this tab at all — **an admin sees `Delete project` on every project card
(`ProjectCard.tsx:209` gates on `canManage`) while `projects.ts:494` is owner-only**, so the API
returns `403 Insufficient permissions` into a dialog that then stays open. *(The `Regenerate…` example
originally cited here was wrong and is withdrawn — see §7. The gating error on that surface runs the
other way: the UI withholds from developers a route the API grants them.)*

**3. Several choices optimise for our convenience over the reader's.** `fitView` zooming to 0.15×
because "everything fits" is easier than paging. A 20-row cost log on the onboardee's landing page
because that's where it was easy to add. A one-item package gallery because the many-package case
needed a grid. Four names for one action because each was written where it was needed.

**The good news:** the product already contains the answer to most of this. The receipt viewer shows
how to present evidence. Capabilities shows how to orient a newcomer. The Tutorials rail shows how to
render a long sequence. The Help FAQ shows the team knows exactly which concepts confuse people. Most
fixes here are **propagating an existing internal pattern**, not inventing one.

---

# Part 4 — What is genuinely good

| | Why it works |
|---|---|
| **Receipt viewer** | Claim→evidence loop closed, self-reported truncation, commit-pinned verification. The thesis, working. |
| **Capabilities tab** | `When you'll touch it` + `START HERE` + cross-links. Task-oriented. The model for every other tab. |
| **"Suggested for you" blurbs** | Explain *why* to read. Best copy in the product. |
| **`Why it matters` on workflows** | Answers "should I care?" before "what is it?". |
| **Help & FAQ** | The right nine questions, plus tours that explain their own auto-start behaviour. |
| **Expanded run row** | Chips, attribution, cached-vs-fresh, timestamped log. |
| **Confidence with a reason** | `12/24 tracked claims cite receipts · 15 downgraded to low` is real accountability. |
| **Provenance panel** | Surfaces `3 failed` calls and its own weaknesses. Fix the label, keep the panel. |
| **Topology diagram** | Real Compose-derived grouping, legible. |
| **Auth forms** | Best-composed screens; inline password rule and reset link. |
| **Lean registration** | 2 clicks, 2 fields. Better than most. **Don't touch it.** |
| **Node selection** | Zoom + dim non-neighbours + edge labels + Architecture cross-link + honest "Not ranked". |
| **Explanatory microcopy** | "Large codebase — showing directory groups", "auto-follows the newest run", "MOST CRITICAL FIRST", "Everything else → Dependencies". |
| **Phone drawer** | Test-verified at 390×844. |

---

# Part 5 — Counts and priorities

**Corrected 2026-07-25.** This table previously read 12 / 40 / 20 = 72. Those numbers did not
reconcile with the document's own tags — the same defect this audit files against the product as P1
**#83** ("the count in the header contradicts the page"). Counted mechanically from the
`` `[HIGH]` ``/`` `[MED]` ``/`` `[LOW]` `` markers in Parts 1–2:

| Severity | Count |
|---|---|
| High | 13 |
| Medium | 55 |
| Low | 27 |
| Withdrawn | 1 |
| **Total (Parts 1–2)** | **95** + 1 withdrawn |

**Whole-corpus total, all parts, so there is one number to quote:**

| Source | Findings |
|---|---|
| Parts 1–2 (page walkthrough + cross-cutting) | 95 |
| Part 6 (five-project pass + fabrication check) | 31 |
| Part 7 (architectural coverage) | 12 |
| Part 8 (reader furniture, graph controls) | 17 |
| `UX_VISUAL_AUDIT.md` | 14 |
| **Total** | **169** |
| *of which withdrawn* | *3 (§7 `Regenerate…`, §17.9 edges-before-nodes, §18.6 MasterPokedex-as-evidence)* |

Plus **16 verified strengths**, and the low-severity tail carried in bug **#74**.

**Method caveat, stated because Part 5 is the number people quote:** these are *finding* counts, not
severity-weighted impact. Roughly 5% of the findings in Parts 1–8 were produced by operating a control;
the rest come from reading the database, the source, or the DOM. That ratio is the reason for the
current exhaustive interaction pass, and Part 9 reports it explicitly.

**If only five things are fixed, in this order:**

1. **§8.1 + §8.2 — make confidence follow evidence, and give reference sections their own provenance
   line.** The second half is a copy change and nearly free. Without this the product's core claim is
   contradicted on its own screens.
2. **§9.2 — stop zooming below legibility; drill one directory level at a time.** Turns the flagship
   interaction from unusable into usable.
3. **§11.2 — wrap the workflow chain into columns.** 4-of-21 visible becomes 21-of-21, no new UI.
4. **§9.1 — fix `dependentCount` and add arrowheads.** Stops the dependency graph refuting itself.
5. **§5 — add a breadcrumb to the project shell.** Fixes the exit, the orientation, and the logo
   concern together.

**Not covered, stated rather than implied:** the Import wizard and Invitations page (needs a GitHub App
installation this audit account lacks), Team and Project Settings beyond a passing look (owner/admin
gated), the Classes & interfaces view, real email confirmation and reset-link expiry (needs a mailbox),
and phone layout by hand (`resize_window` does not change the render viewport here — the Playwright
suite was used instead).

---

*Companion:* [UX_VISUAL_AUDIT.md](./UX_VISUAL_AUDIT.md) — colour, contrast, density, composition,
responsive. *Rubric for content quality:* [DIATAXIS_NOTES.md](./DIATAXIS_NOTES.md).

---

# Part 6 — The five-project pass, and the fabrication check

**Why this pass exists.** The first pass audited one project: our own dogfood repo. That is the
codebase the team knows best, so it is the codebase where the tool looks best. A tool that explains
*your own repo* to *you* is not being tested. So this pass re-ran every tab against **all five
imported projects**, with fresh analyses, and then went further: because all five are open source, I
**cloned each repo at the exact analyzed commit** and checked whether what the app says is *true*.

**What was analyzed.** Five fresh runs, launched through the app's own `prepareAnalysisRun` path:

| Project | Repo files | **Analyzed** | Skipped (unsupported) | Graph nodes | Clusters | Capabilities | Flows / steps | Tutorials | Low-conf sections |
|---|---|---|---|---|---|---|---|---|---|
| CourseInsights | 382 | **42** (11%) | css 2, html 1 | 298 | 6 | 5 | 8 / 67 | 4 | 3 / 12 |
| FloowForge | 167 | **65** (39%) | **python 49**, css 2 | 460 | 9 | 6 | **1 / 3** | 1 | 1 / 12 |
| kuankongy.github.io | 124 | 70 (56%) | css 1, html 1 | 454 | 5 | 3 | 4 / 18 | 4 | **5 / 12** |
| OnboardBuddy | 268 | **222** (83%) | css 1, html 1 | 1884 | 14 | 6 | **76 / 635** | 4 | 2 / 12 |
| Skribbl | 104 | 83 (80%) | css 1, html 1 | 652 | 8 | 5 | 1 / 4 | 1 | **5 / 12** |

Read the "Analyzed" column first. **Our own repo is the best-covered one in the set, by a wide
margin.** Every other project is a codebase the tool only partly read. This single table explains
most of what follows, and it is why auditing one project was not enough.

---

## 17.1 The fabrication check

**Method.** Every `source_receipt` stores `file_path`, `line_start`, `line_end`, a `snippet`, and a
`claim`. I cloned FloowForge, Skribbl and kuankongy.github.io at the exact `commit_hash` recorded on
each snapshot, then for every receipt with a file and a snippet asserted three things: the file
exists at that commit; the line range is within the file; and the stored snippet actually appears in
the real file (whitespace-normalised).

**Result:**

| Repo | Receipts checked | Verified | Missing file | Line range out of bounds | Snippet mismatch |
|---|---|---|---|---|---|
| FloowForge | 178 | **178 (100%)** | 0 | 0 | 0 |
| kuankongy.github.io | 151 | **151 (100%)** | 0 | 0 | 0 |
| Skribbl | 29 | **29 (100%)** | 0 | 0 | 0 |
| **Total** | **358** | **358 (100%)** | **0** | **0** | **0** |

**Verdict: `RIGHT, AND WORTH SAYING SO`.** The citation layer is not hallucinated. When the UI shows
you a file and a line, that file and line are real and contain what it claims. This is the single
strongest thing in the product and it should be stated publicly, because it is the claim a sceptical
new developer will most want tested. It is now tested.

Two caveats that a reviewer will find if we don't say them first:

- **Only 16–27% of "receipts" are checkable at all.** The counts the UI reports are dominated by a
  kind that names no file:

  | Repo | Total receipts | `code_snippet` | `record_reference` | Checkable (file + snippet) |
  |---|---|---|---|---|
  | FloowForge | 662 | 188 | **459** | 178 (**27%**) |
  | kuankongy.github.io | 568 | 151 | **417** | 151 (**27%**) |
  | Skribbl | 185 | 29 | **156** | 29 (**16%**) |

  A `record_reference` points at an internal semantic record, not at code. To a user, evidence that
  cannot be opened is not evidence. **Verdict: `RIGHT, MISPRESENTED`** — one number is doing the work
  of two. Report "N citations (M you can open)".
- **Verifying a citation is not verifying a claim.** A snippet can be real and the sentence around it
  still wrong. §17.3 is about that.

---

## 17.2 The headline: the tool hides what it could not read

**FloowForge's own README, first lines:**

> `web/` — Next.js 15 App Router (UI)
> `api/` — **FastAPI execution engine + REST API**
> `packages/shared/` — Shared TypeScript types
> `supabase/` — SQL migrations and RLS policies

The README calls the FastAPI engine the thing the whole product was rebuilt around: *"rebuilt on a
server-side execution engine so flows can run from anywhere."* Measured in the real repo at the
analyzed commit: **49 `.py` files — more than its 46 `.tsx` files.** Python is 43% of the code files.

**What OnboardBuddy showed instead.** Nine architecture clusters, every one of them frontend or
generic:

`Web · Auth` · `Web · Modules` · `Web · UI` · `Web · Tests` · `Web · Integrations` ·
`Web · Shared Utilities` · `Shared · Shared Utilities` · `Configuration & Deployment` ·
`Database Schema`

There is no execution engine. There is no API. The Dependencies tab reports **"Large codebase (67
files) — showing directory groups"**. Six capabilities, all frontend concerns; the one called *"API
Interaction and Data Fetching"* points at `web/lib/api.ts` — the **client**, not the API.

**The system knew.** The snapshot's own `language_inventory`:

```json
{"supported":{"javascript":2,"typescript":63},
 "unsupported":{"css":2,"python":49},
 "supportedFileCount":65, "unsupportedFileCount":51}
```

**And never said so.** Across **28,661 characters of generated prose in 12 sections**, these strings
appear **zero times**: `python`, `fastapi`, `.py`, `uvicorn`, `pydantic`, `not analyzed`, `not
parsed`, `skipped`, `unsupported`. The snapshot's `warnings` array is `[]`.

**Where the disclosure lives.** `language_inventory` is referenced in exactly **one** frontend file:
`components/PreflightPreview.tsx` — the *import* screen. So coverage is disclosed **once, before
analysis, to the person doing the importing**, and never again to the developer being onboarded.

**Verdict: `OUR COMFORT, NOT THEIRS`** — and the most serious finding in either audit document. The
person who imports the repo knows. The newcomer, who is the entire point of the product, does not.
CourseInsights is worse in raw terms: **382 files, 42 analyzed (11%)** — the remaining files are 269
JSON, 44 other, 10 XML — and it too ships a confident 12-section guide.

**What another developer would have done.** Three fixes, cheapest first:

1. **A coverage line in the reader's trust strip**, beside the existing symbol count: `65 of 116 code
   files analyzed · 49 Python files not parsed`. The strip already reports
   `cites 77 of 435 symbols in 32 files`, so the pattern and the space both exist.
2. **A first-class node on the Architecture map** for unparsed mass — `api/ (49 Python files — not
   analyzed)`, greyed, non-clickable. A visible hole is honest; an invisible hole is a lie of
   omission. This is strictly better than a warning banner because it appears exactly where the
   wrong conclusion would otherwise be drawn.
3. **Push it into `big_picture`'s first paragraph** when `unsupportedFileCount / total > 10%`. The
   generator already receives the inventory; it just isn't told to mention it.

---

## 17.3 Explanations that are fluent but not correct

Receipts being real does not make the prose right. Checked against each repo's actual README and
source:

**Skribbl — correct, and worth recording as the control case.** Full language coverage (83 of 104
files). Generated `concepts` describes `RoomManager` as *"a server-side component responsible for
creating, managing and destroying game rooms… instantiated within `registerHandlers` in
`server/src/handlers.js`"*. Verified in the clone: `server/src/` really contains `roomManager.js`,
`GameRoom.js`, `handlers.js`, and `server/package.json` really declares `express` and `socket.io`.
`big_picture` correctly identifies a real-time Pictionary-style draw-and-guess game with a WebSocket
server and a web client. The package name it cites, `skribbl-clone-server`, is the **real** name in
`server/package.json` — not invented.

**Conclusion that matters: when the tool can read the code, it understands it well.** The failure
mode is not comprehension. It is coverage, and silence about coverage.

**CourseInsights — 2 of 5 "capabilities" are not product capabilities.** The repo processes, queries
and serves UBC course and room data. Generated capabilities, all rated **high**:

| Capability | Verdict |
|---|---|
| Dataset Management | Correct and useful |
| Querying | Correct and useful — the core of the product |
| **Development Environment** | **Not a product capability** — repo toolchain |
| **Continuous Integration and Deployment** | **Not a product capability** — CI config |
| Utility Endpoints | Vague; "utility" tells a newcomer nothing |

A new developer asks *"what does this thing do?"* and 40% of the answer is about the build. **Verdict:
`DELIBERATE, WRONG`** — the extractor treats any coherent code cluster as a capability, so CI configs
become product features. Capabilities should be filtered to clusters that serve an external actor,
and infrastructure surfaced under Guardrails & Ops, where a section already exists for it.

**The hedge-versus-badge contradiction.** On FloowForge's Capabilities tab, cards badged **HIGH
CONFIDENCE** contain the word *"Likely"* in their START HERE explanations — *"Likely fetches and
displays detailed run information"*, *"Likely displays data fetched from an external source or uses an
integration to present information"*. The second is a sentence that survives having its subject
removed; it carries no information. **Verdict: `RIGHT, MISPRESENTED`** — if the prose hedges, the
badge must not say high. Cheapest correct fix: downgrade any card whose text contains a hedge token,
or strip the hedge and let the confidence badge carry the uncertainty. Doing both in the same card
teaches the reader to distrust the badge.

**Same noun, two confidences.** FloowForge's **Capabilities tab** shows 4 HIGH and 2 MEDIUM. The
**`capabilities` section** in the reader for the same snapshot is rated **`low`** and is **324
characters** long. Same concept, two surfaces, opposite trust signals, no cross-reference.

---

## 17.4 The deterministic layer is the wrong one

The documentation's trust story is that deterministic "backbone" facts are reliable and LLM prose is
the soft part. On four of five projects, the backbone is what's broken.

**`Configuration & Deployment: 0 files.` — on 4 of 5 projects.** Measured against
`architecture_cluster_members`:

| Project | Cluster | Members | `deterministic_summary` says |
|---|---|---|---|
| FloowForge | Configuration & Deployment | **14** | "0 files." |
| FloowForge | Database Schema | **9** | "0 files." |
| Skribbl | Configuration & Deployment | — | "0 files." |
| CourseInsights | Configuration & Deployment | — | "0 files." |
| OnboardBuddy | Database Schema | **37** | "0 files." |

And the card's own footer prints the true count. So the FloowForge architecture map shows, in one
card, **"Configuration & Deployment: 0 files."** above **"14 files"** — a self-contradiction inside a
single 225×98px box, twice on one screen. The first pass caught this once on our repo and I treated it
as a one-off. It is systemic. **Verdict: `ACCIDENT`, P1** — and worse than an LLM error, because the
deterministic layer is the one we tell users to trust.

**The classifier is wrong where the prose is right.** Skribbl's Express + Socket.IO server cluster,
`Server · Modules` (7 files, 67 symbols), is classified **`frontend_ui`**. So is `Modules`, and so is
`UI`. Meanwhile the generated prose for the same snapshot correctly and repeatedly calls
`RoomManager` *"server-side"*. **The LLM understood the codebase better than the deterministic
classifier did** — and only the classifier's answer is rendered as a confident coloured badge. On
CourseInsights the same inversion: a repo whose description names a "custom backend" gets
**`API Routes` = 2 files / 12 symbols** as its only `api_layer` cluster, while 37 files across three
clusters are labelled `frontend_ui`.

**The unlabelled bar means the opposite of what it looks like.** Each architecture card ends with
`N files` and, immediately to its right, a small bar. The bar is `critical_score`. Measured on
FloowForge, fill percentage against the DB value:

| Card | Files | Bar fill | `critical_score` |
|---|---|---|---|
| Shared · Shared Utilities | **1** | **40%** | 0.39956 |
| Web · Shared Utilities | 6 | 15% | 0.15375 |
| **Web · UI** | **30** | **13%** | 0.12790 |
| Web · Auth | 4 | 10% | 0.09989 |
| Web · Tests | 4 | **0%** | 0.00000 |
| Configuration & Deployment | 14 | **0%** | 0.00000 |

A bar placed one space to the right of a count reads as a proportion *of that count*. So the 1-file
cluster looks three times more substantial than the 30-file one, and three clusters render an **empty
bar**, which reads as "no data" or "broken". **Verdict: `RIGHT, MISPRESENTED`** — the underlying
ranking is a good idea rendered as an unlabelled mystery. Label it (`criticality 0.40`), or drop it
from the card and keep it as sort order only.

**Three slots, one fact.** The architecture card has four content slots and three carry the same
information, because the description is a template restating the title and the footer count:

```
Web · Modules                          ← title
FRONTEND UI                            ← badge (also encoded as the dot colour, also in the legend)
Web · Modules: Web Modules Cluster      ← "description": the title again
21 files            ▪──────             ← count, then an unlabelled criticality bar
```

`Web · Tests` reads *"Web · Tests: 4 files, 10 symbols."* as its description, above a footer reading
*"4 files"*. **Verdict: `OUR COMFORT, NOT THEIRS`** — the slot was filled because it existed. Spend it
on what the cluster *talks to*, which is the question the page's own subtitle promises to answer
("click a component to see what it does and what it talks to").

---

## 17.5 Same component, opposite failures: 1 node, and 21

The reported complaint was that Workflows stacks nodes vertically and becomes unreadable past ~10.
That is real and quantified in [§11](#11-workflows--the-layout-problem-measured-and-solved). The
five-project pass found the **opposite** failure of the same component, which the first pass missed
because our own repo has 76 flows.

**FloowForge's Workflows tab — measured:**

| | |
|---|---|
| Nodes rendered | **1** |
| Edges rendered | **0** |
| `fitView` zoom | **2.0× — the maximum** |
| Graph box in pane | 448 × 108px in **1200 × 824px** |
| Canvas filled | **4.9%** |
| Connector handles | 2, **both unconnected** |

The summary bar above it reads **"Traces ci_pipeline through 3 steps · Reaches 2 side-effect steps"**.
The canvas shows one node and no arrows. The list beside it is headed **"TRACED FLOWS (1) — MOST
CRITICAL FIRST"**, ranking a list of one. The pill top-right reads **"ci_pipeline · high
confidence"**.

**Why:** all three `workflow_steps` are the same file — `.github/workflows/ci.yml` — with
`symbol_name: null` on all three. There is no traced flow. There is one YAML file counted three
times, presented as a 3-step trace with high confidence.

**This is the moment a new developer decides the tool is fake**, and it is more damaging than the
21-node case, because a crowded diagram looks like a hard problem handled imperfectly, while a single
dot labelled "3 steps, high confidence" looks like a lie.

**`fitView` has no sensible clamp at either end.** Across four measured screens it produced: **2.0×**
(1 node), **1.83×** (21 nodes stacked), **0.93×** (9 clusters), **0.15×** (60 files — where label
text rendered at **2.1px**). The one thing it never produces is a readable, honest view.

**Fixes:**
1. **Clamp `fitView` on both sides** — never above ~1.15× and never below the point where label text
   drops under ~9px. Above the ceiling, stop zooming and centre. Below the floor, crop and pan.
2. **Don't render a "flow" that has no edges.** If a workflow's steps collapse to one node, say so:
   *"This flow's 3 steps are all in `.github/workflows/ci.yml` — there is nothing to trace."* That
   sentence is more useful than the diagram and takes less space.
3. **Suppress ranking language for n=1.** "TRACED FLOWS (1) — MOST CRITICAL FIRST" and "1 of 1 traced
   workflows" should read "1 traced flow".
4. **Reconsider `high confidence` for a single-file, zero-symbol flow.** Confidence should fall when
   step diversity is 1.

---

## 17.6 Dependencies across five repos

**Every node on the default view says "0 imported by".** On FloowForge's grouped view, **6 of 6**
nodes report `0 imported by` while **7 arrows** are drawn between them. The tab is called
Dependencies; its inbound-dependency counter is a constant. Traced to `backend/src/api/routes/graph.ts:73`,
which hardcodes `dependentCount: 0` for directory groups.

Two things make this worse than a stray zero:

- It is the **default view for any repo over the grouping threshold**, so it is the first dependency
  screen most developers ever see.
- **The file-level view proves the data exists** — drilling in shows `utils.ts · 0 imports · 2 imported
  by`. So the number is available and discarded at the grouping step.

**Verdict: `ACCIDENT`, P1.** Highest value-per-line fix in this document: sum members' inbound edges
that originate outside the group.

**"Large codebase (67 files)."** A professional reader's reaction to that sentence is not the one we
want. It is also the third different file count for the same project — see below.

**Three tabs, three answers to "how big is this codebase", none labelled.** FloowForge:

| Surface | Number shown | What it actually counts |
|---|---|---|
| Snapshot / repo | **167 files** | every file in the repo |
| Architecture | **90** (sum of cluster members) | clustered files |
| Dependencies | **67 files** | files in the TS/JS import graph |
| Reader trust strip (Skribbl) | **32 files** | files cited by the package |

Each is defensible alone. Together, with no qualifier on any of them, they teach a newcomer that our
numbers aren't load-bearing. **Fix:** one canonical phrasing everywhere — `67 of 167 files analyzed` —
and never a bare count.

**The Legend panel covers the data.** The floating Legend (`z-index: 5`, 256 × 226px, parked at
top-left) sits exactly where the layout puts its most important node. Measured on the grouped view it
covers the first node in reading order. Worse, on a deep link:

**The single most useful affordance in the product lands on a node you cannot see.** Clicking
`web/lib/api.ts` under START HERE on the Capabilities tab navigates to
`/dependencies?focus=web%2Flib%2Fapi.ts`. The app then does something genuinely well-engineered — it
rewrites the URL to add `&cluster=web%2Flib`, drills into the right directory group, opens the detail
panel, and adds a breadcrumb with "Up one level". And then:

| Node | Covered by Legend | Selected |
|---|---|---|
| **`api.ts`** | **100%** | **yes** |
| server.ts | 0% | no |
| client.ts | 0% | no |
| utils.ts, media.ts, supabase-url.ts | 0% | no |

The node you asked for is the selected one, the right-hand panel describes it, and it is entirely
behind the Legend — while a *different* node appears lit. **Verdict: `ACCIDENT`, P1.** Fix: collapse
the Legend to a single "?" button by default, or offset `fitView` padding by the Legend's bounds, or
move it bottom-right where the minimap already lives. The minimap on a 6-node graph is pointless and
could give up its corner.

**The detail panel contradicts itself 100px apart.** For `api.ts`: the bullet list says **"Imported by
12 files"**; the column header directly beneath says **"IMPORTED BY (8)"** and lists 8. And the list
renders **`page.tsx` six times** with no directory — in a Next.js App Router repo every route folder
has one, so six identical rows look like a rendering bug and convey nothing. Show the parent path.

**`Adjust weights` is offered to a Developer again.** Beside "IMPORTANCE 34 /100 critical-path score".
Third project on which a management-only control is shown to a tier that cannot use it.

**Plural bugs, now a pattern worth one batched issue:** `1 imports` (×3 on one screen), `1 commits in
the last 90 days`, `1 tutorials`, `1 of 1 traced workflows`.

---

## 17.7 The reader across five repos

**Every project got exactly 12 sections** — the Diátaxis structure holds across wildly different
codebases, which is a real win for the deterministic backbone. But section *size* is uncontrolled, and
it fails in the one place that matters most.

**CourseInsights, sections sorted by length:**

| Section | Chapter | Chars | Confidence |
|---|---|---|---|
| **`setup_run`** | **DO — "Get it running on day one"** | **759** | medium |
| `data_model` | CONSULT | 819 | medium |
| `routes_jobs` | CONSULT | 1,647 | high |
| `common_tasks` | DO | 2,006 | medium |
| **`first_change`** | **DO — "Your First Change"** | 2,314 | **low** |
| `capabilities` | UNDERSTAND | 2,408 | **low** |
| … | | | |
| `concepts` | ORIENT | 8,503 | high |
| **`code_map`** | UNDERSTAND | **15,173** | medium |

**A 20× spread, and the day-one section is the shortest thing in the package.** "Set Up & Run It" —
the section whose own chapter blurb says *"Get it running on day one; every later section assumes you
can"* — is 759 characters. Meanwhile `code_map` is 15,173. On FloowForge the same inversion is more
extreme: `routes_jobs` is **208 characters** and `common_tasks` is **531**, while `code_map` is
**8,049**.

**And "Your First Change" is rated `low` confidence** on CourseInsights. The centrepiece of the DO
chapter — the task a new developer is actually trying to accomplish — is the section the tool trusts
least. **Verdict: `DELIBERATE, WRONG`** — generation effort is being allocated by how much code a
section can enumerate, not by how much a newcomer needs it. `setup_run` and `first_change` deserve a
floor (and a retry when they come back thin), funded by capping `code_map`, which is a lookup table
nobody reads top-to-bottom.

**Nav labels truncate.** 4 of 12 items are clipped in the section rail: `Traced Flows: End to E…`,
`Code Map: Files Tha…`, `Capabilities: What It …`, `Routes, Jobs & Webho…`. The rail is ~170px in a
1456px viewport with empty space to spare. These are the titles by which a reader chooses what to
read.

**Five red dots before you read a word.** Low-confidence sections are marked with a red dot in the
nav; the package card advertises **"5 low confidence"** in warning red with no counterweight. On
Skribbl and kuankongy.github.io that is **5 of 12**. Across all 93 sections in the system: 36 high,
36 medium, **21 low (23%)**. The honesty is right and should stay — the *emphasis* is wrong. Show
`7 high · 5 low`, not a lone red number, and let the reader see that most of it is solid.

**The architecture diagram's edge labels are 8 × `imports` and 2 × `calls`.** Ten edges, two distinct
values, rendered as grey boxes nearly as visually heavy as the nodes they connect — in Skribbl's
diagram the word `imports` occupies as much ink as the node `State`. Label the exceptions, not the
rule: drop `imports` and keep `calls`.

**Skribbl's diagram puts tests at the top.** The first visual in the reader shows
`Server · Tests → calls → Server · Modules` in the top-left, the position a top-down diagram reserves
for what matters. A newcomer's first impression of the architecture is that tests drive the server.
Test clusters should be excluded from the reader's overview diagram, or sunk to the bottom.

**The trust strip is the best trust UI in the product** and deserves saying: *"Medium Confidence ·
8/10 tracked claims cite receipts · 2 downgraded to low · 7 receipts"* and *"cites 77 of 435 symbols
in 32 files · 1 of 1 traced workflows · ranked by 9 signals · 3 known unknowns"*. Precise, falsifiable,
unflattering. This is the pattern that should carry the coverage disclosure from §17.2 — it already
reports a ratio of exactly the right shape.

**Two consecutive tours, seven tooltips, before any content.** Opening a project you haven't visited
fires a 4-step tour on the package grid; entering the reader immediately fires a **separate 3-step
tour** with its own `1 of 3` counter. Both **cover the thing they describe** — the package tour's
tooltip completely hides the only package card's title, and the reader tour's tooltip covers the
"Suggested reading path" panel it is explaining. And step 1 of 4 teaches OnboardBuddy's *data model*
("one package per scope, role & commit… packages are never silently discarded") to a person who came
to learn a codebase. **Verdict: `OUR COMFORT, NOT THEIRS`.** Merge the two tours, never cover the
referent, and make step 1 about the user's goal.

---

## 17.8 Constants pretending to be data

A field that never varies is not information; it is furniture that looks like information. Every one
of these was verified across the whole database, not eyeballed.

| Element | Measured | Effect on a newcomer |
|---|---|---|
| **`Draft` badge** | **8 of 8 packages, 93 of 93 sections, 18 of 18 tutorials are `draft`. Nothing has ever left draft.** | Tells every reader their documentation is unfinished. `reviewed_at`/`reviewed_by` columns exist and are never written. |
| **"Any status" filter** | Filters a single-valued field | Dead control |
| **`STALE 0`** | 0 on every project | Loudest text on the project card after the title |
| **`DEVELOPER` badge** | Identical on all 5 cards | Occupies prime position beside the title |
| **`0 imported by`** | 6 of 6 nodes (§17.6) | Discredits the Dependencies tab |
| **`Module` description** | 5 of 6 dependency nodes | Third restatement of the same word |
| **Three filter dropdowns** | Above **one** card, next to "1 / 1 packages" | Overhead where the app generates one package per scope/role/commit |

**Verdict on `Draft`: `RIGHT, MISPRESENTED`, P2.** Either build the review flow the columns imply, or
stop shipping a scarlet letter on every document. The interim fix is one line: don't render the badge
when no alternative state is reachable.

---

## 17.9 New defects found this pass

**A blank page on any unmatched URL.** `App.tsx` has **no `path="*"` route**. Navigating to
`/projects` — the prefix of every project link in the app, and the obvious thing to type when
trimming an id off the address bar — renders `#root` with **0 children** and `document.body.innerHTML`
of **31 characters**. No header, no message, no way back but the browser's Back button. Verified live
and in code. **Verdict: `ACCIDENT`, P1** — a catch-all route with a link home is a five-line fix.

**Project cards are not links.** Each card is a `<div role="link">` with `tabindex="0"`; the entire
project list page contains only **10 anchors, all in the sidebar and header**. So a developer cannot
**cmd-click a project into a new tab** to compare two codebases, gets no URL preview on hover, and
has no "copy link address". `role="link"` without an `href` also announces a destination-less link to
a screen reader. **Verdict: `ACCIDENT`, P2** — any developer would have reached for `<Link>`; this is
the clearest "what would someone else have done differently" in the document, and the fix is
mechanical.

**A false affordance on the status word.** `Ready`/`Complete` on each card renders with
`text-decoration: underline` and **`cursor: help`**, inside a surface that is itself one big click
target. Underline says "link", the help cursor says "tooltip", and the click navigates into the
project. Three signals, three different promises.

**Card rows don't share a baseline.** The one project with a description is **148px** tall and the
others are **132px**; its status line sits at **y=83** inside the card while every other sits at
**y=66**. The description block has no reserved height, so a field that is empty for **3 of 5**
projects silently reshuffles the grid. And that field is the GitHub repo description — a blurb aimed
at outsiders, which the team doesn't control and often hasn't written ("My Portfolio!").

**~~Edges paint before nodes.~~ WITHDRAWN.** This finding claimed the Architecture tab paints edges
before nodes on first load. On re-test it proved to be an artifact of the audit environment: the
automation tab runs **backgrounded** (`visibilityState: "hidden"`, `hasFocus: false`, **0 `requestAnimationFrame`
callbacks in 600ms**), and React Flow cannot measure nodes without rAF. Screenshots force a paint,
which is why they intermittently disagreed with DOM queries taken milliseconds earlier. No render-timing
claim is made anywhere in these documents. Full retraction and its consequences:
[§19.9](#199-retraction-edges-paint-before-nodes-was-my-instrumentation-not-the-product).

**The list has no independent source of truth for status.** The project list renders only the
denormalised `projects.status` column and never consults `analysis_jobs`. Three separate code paths
must remember to write it (`projects.ts:897`, `projects.ts:1166`, `githubWebhook.ts:153`), and
`lib/projectStatus.ts` exists precisely because "no single job may write a terminal project status
blindly". Any missed write surfaces as a **confidently wrong status with no "as of" hint**. I reached
that state during this audit, though by a synthetic enqueue that bypassed the HTTP route — so I am
reporting the fragility, not claiming a user-facing repro. Derive the badge from live jobs, or stamp
it with a timestamp.

**"Active" includes never-analyzed.** `ProjectListPage.tsx:46` filters `status === "analyzing" ||
status === "idle"`, so a repo nothing has ever happened to appears under **Active**, and there is no
filter for the state that actually needs action ("never analyzed"). Meanwhile `Updated 1y ago` on
CourseInsights is the GitHub push date sitting beside analysis fields, on a project whose
`last_analyzed_at` was **null** — so the one date shown describes the repo while everything around it
describes the analysis.

**A worker restart mid-run fails the job with an honest message.** Our first CourseInsights run died:
the worker container was replaced 40s into "Downloading repository", and the new worker's reaper
marked the orphan failed with *"Worker lost this run (restart or crash). Completed phases are
checkpointed — run Analyze… again to resume from cache."* **That message is a model of what a failure
should say** — cause, consequence, and the exact next action. Record it as a strength and copy its
shape elsewhere. The user-facing cost is that the project flips to `Failed` through no fault of the
user's.

---

## 17.10 What I got wrong, corrected

Recorded because a reviewer should be able to see which findings were tested against the possibility
of being wrong.

- **"The list shows Ready while an analysis runs" — retracted as a product bug.** `prepareAnalysisRun`
  doesn't write `projects.status`; the HTTP route does. My synthetic enqueue skipped it. The
  fragility is real and reported as such in §17.9; the repro was mine.
- **"`[[unverified]]` markers leak into the prose" — false.** `lib/receiptMarkers.ts` deliberately
  converts `[[unverified]]…[[/unverified]]` into a `#unverified` link for a dotted-underline render, and
  it's unit-tested. Confirmed no raw marker reaches the DOM. I did not observe a rendered unverified
  span in the reader, so I make no claim about its visual treatment.
- **"kuankongy.github.io generated zero sections" — false.** It had 10 of 12 at the moment I queried;
  the `generate_package` job was still running and finished at 12.
- **"Architecture renders no nodes" — downgraded** from a broken render to a first-paint ordering
  issue, after measuring the settled state.

---

## 17.11 Part 6 counts and priorities

**New or newly-generalised findings in this pass: 31.**
**7 High · 17 Medium · 7 Low.** Part 6 findings only; Part 5's totals stand unchanged.

**The seven that should be fixed first**, in order:

1. **Disclose skipped languages in the reader and on the Architecture map** (§17.2). The product's
   core promise is an honest picture of a codebase; on FloowForge it silently omitted 43% of it.
2. **Fix `dependentCount: 0` for directory groups** (`graph.ts:73`, §17.6). One-line-ish fix,
   restores the credibility of the tab named Dependencies.
3. **Fix `deterministic_summary` "0 files"** (§17.4). The layer we tell users to trust contradicts the
   card it's printed on, on 4 of 5 projects.
4. **Clamp `fitView` at both ends and refuse to draw edgeless "flows"** (§17.5). Kills the 2.1px-text
   screen and the one-dot-labelled-"3 steps" screen together.
5. **Stop the Legend from covering the focused node** (§17.6). Breaks the best navigation path in the
   product.
6. **Add a catch-all route** (§17.9). A blank screen on a guessable URL.
7. **Give `setup_run` and `first_change` a length floor** (§17.7). The day-one section is currently the
   shortest in the package and "Your First Change" is rated low confidence.

**Coverage of this pass, stated rather than implied.** Deep tab-by-tab walkthroughs: **FloowForge**
(Workflows, Architecture, Dependencies incl. drill-in and deep-link, Capabilities) and **Skribbl**
(package grid, reader, both tours). Full data-and-content audit plus fabrication checks on all five:
**CourseInsights, FloowForge, kuankongy.github.io, OnboardBuddy, Skribbl**. Receipt verification
against cloned repos covers three of five — **CourseInsights and OnboardBuddy were not cloned**, so
their citations are unverified against source. Not covered, unchanged from Part 1: the Import wizard
and Invitations page (`github_installations` is **empty — 0 rows**, so no repo can currently be
imported at all), Team and Project Settings beyond a glance, the Classes & interfaces graph view, and
real email confirmation.

---

# Part 7 — Architectural coverage: what the tool can and cannot see

**Why this part exists.** Part 6 audited five projects and found that coverage, not comprehension, was
the problem. This part answers the harder question: **which architectural styles can OnboardBuddy see
at all?** It was prompted by two observations from the product owner, both of which turned out to be
the visible tip of one root cause:

> *"Skribbl has only one workflow, whereas it is supposed to have way more."*
> *"My portfolio literally has in the README the whole of the portfolio and game, but it doesn't have it there."*

Both are correct. Both trace to the same place.

---

## 18.1 The entrypoint detector models the world as HTTP

**The global evidence.** Across every project ever analyzed in this database:

| Entrypoint type | Ever detected | Share |
|---|---|---|
| `http_route` | **167** | 86% |
| `ui_route` | 22 | 11% |
| `package_export` | 5 | 3% |
| `worker_job` | 2 | 1% |
| **`event_listener`** | **0** | **never produced** |
| **`scheduled_job`** | **0** | never produced |
| **`cli`** | **0** | never produced |
| **`serverless_handler`** | **0** | never produced |

`doc/DETECTION_COVERAGE.md:15` advertises eight entrypoint types. **Four have never occurred, and 97%
of all detections are HTTP or UI routes.** The `worker_job` count of 2 is our own BullMQ pipeline.

**Skribbl proves the consequence.** A real-time multiplayer draw-and-guess game:

| | Detected | Real (verified in the clone at the analyzed commit) |
|---|---|---|
| Entrypoints | **1** — `GET /health`, confidence **high** | **20 distinct Socket.IO events** across 22 `socket.on(` sites, plus 52 emits, and exactly 1 Express route — which is `/health` |
| Workflows | **1** — `ci_pipeline` | Room lifecycle, turn lifecycle, drawing sync, guessing, hint reveal, scoring, disconnect handling |

The real events, none of which appear anywhere in the product: `create-room`, `join-room`,
`room-joined`, `start-game`, `select-word`, `word-selected`, `your-word`, `drawing-phase`, `draw-ops`,
`undo`, `clear-canvas`, `chat-message`, `turn-ended`, `game-over`, `leave-room`, `disconnect`, `sync`.

**The detector found the single least meaningful entrypoint in the codebase.** `/health` is a liveness
probe; the game is invisible. And because workflows are composed from entrypoints, the only thing left
to call a "traced flow" was the CI YAML file — which is why the Workflows tab renders one node and
claims "TRACED FLOWS (1) — MOST CRITICAL FIRST · high confidence" ([§17.5](#175-same-component-opposite-failures-1-node-and-21)).

**The precise cause.** `worker/engine/entrypointDetector.ts:140` gates event-handler detection on the
**file path**:

```ts
if (relativePath.match(/worker|listener|consumer|jobs?\//i)) {
  for (const sym of fa.symbols) {
    if (sym.exported && (sym.kind === 'function' || sym.kind === 'arrow-function')
        && HANDLER_NAME.test(sym.name)) { … kind: 'event_handler' … }
```

Skribbl registers its events as **inline closures inside `server/src/handlers.js`**, called from
`registerHandlers()`. That fails both conditions: `handlers.js` does not match
`worker|listener|consumer|jobs/`, and the handlers are not exported named symbols. So a file whose
entire purpose is handling events is skipped by the event-handler detector.

**The tell is in our own comments.** Twenty lines below, the BullMQ detector explains its own
existence:

> *BullMQ-style queue consumers: `new Worker(QUEUE, handler)` registers the product's background
> pipeline with an inline closure — invisible to the named-export heuristic above, **which is why the
> analyze pipeline never traced as a workflow (audit P2 §15)**.*

So the identical failure — **inline closures are invisible to a named-export heuristic** — was found
once, on our own repo, and fixed *only for our own pattern*. Nobody applied the lesson to
`socket.on`, `emitter.on`, `process.on`, or `addEventListener`.

**Verdict: `DELIBERATE, WRONG`.** `DETECTION_COVERAGE.md` documents the gap honestly —
*"Event listeners … ⚠️ type exists; coverage of socket.io/ws unproven"* and *"WebSocket/SSE emit … ❌
(P2)"*. The gap was known and deprioritized. What was never done is assess its **user-facing
consequence**: nobody connected "socket.io unproven" to "a real-time game will present its CI file as
its only traced flow, at high confidence." A known limitation became a confident false statement.

**This is the structural risk in dogfooding a single codebase.** Every detector that exists maps to a
pattern present in OnboardBuddy: Express routes, Next-style UI routes, BullMQ workers, package
exports. The tool covers *our* architecture well and other architectures poorly, and it reports the
same confidence either way.

**Fixes, cheapest first:**
1. **Drop the path gate; detect the call, not the filename.** Match `X.on('event', …)` /
   `addEventListener` / `process.on` / `emitter.on` at any path, taking the string literal as the
   entrypoint name — exactly as the BullMQ detector already takes its queue name. Skribbl's 20 events
   would be found by the pattern that already exists for queues.
2. **Never rate a lone `/health` route as a high-confidence entrypoint set.** A denylist of
   health/readiness/metrics paths, plus: if the only entrypoints found are infra probes and CI, say
   *"no application entrypoints detected"* rather than presenting the probe as the system's entry.
3. **Make the unimplemented types visible.** Four of eight declared types have never fired. Either
   implement them or stop advertising eight, because the schema is currently a promise the detector
   does not keep.
4. **Report entrypoint coverage like language coverage** — `1 entrypoint detected · 22 event
   registrations not classified`. The count already exists; nothing surfaces it.

---

## 18.2 The README is ingested and then ignored

**The product owner's observation, tested.** `kuankongy.github.io`'s README documents the project
thoroughly: what it is (a portfolio with a playable 3D Tetris-with-physics game), a Quick start
(`npm install`, `npm run dev`), a four-row script table (`dev`, `build`, `preview`, `typecheck`), an
operational caveat about hard-refreshing to bust stale Vite HMR cache, and the full stack (Vite 5,
React 18, TypeScript 5, three ^0.163, WebGLRenderer, EffectComposer, ShaderMaterial).

**What the generated `setup_run` section says:**

> *"There are **no specific commands for running the project** in a development or production
> environment **documented**. The available scripts in `package.json` are: …"*

**Measured across all 12 generated sections for that project:** `npm run dev` = **0** occurrences,
`vite` = **0**, `tetris` = **0**, `shader` = **0**.

**Database-wide: only 3 source receipts cite a `.md` file, across every project ever analyzed.**
Markdown is counted in `language_inventory.evidenceOnly` — so it is discovered, listed, and then
almost never used as evidence for anything.

**Verdict: `ACCIDENT`, P1.** The single richest, most human-authored, most trustworthy description of
any repository is the README, and the pipeline treats it as a file-type census entry. The section that
suffers most is `setup_run` — the DO chapter's day-one section, already the shortest in the package on
several projects ([§17.7](#177-the-reader-across-five-repos)). Two independent findings meet here: the
most important section for a newcomer is the shortest **and** the one whose source material is being
discarded.

**Fix:** feed `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md` and `docs/**` into the `setup_run`,
`big_picture` and `first_change` prompts as first-class context, and cite them as receipts. FloowForge
even ships an `ARCHITECTURE.md` that would have named the FastAPI engine the tool missed entirely
([§17.2](#172-the-headline-the-tool-hides-what-it-could-not-read)). The evidence to prevent this
audit's headline finding was sitting in the repo, ingested, unread.

---

## 18.3 When the only bucket is HTTP, everything becomes HTTP

The portfolio is a **static Vite site on GitHub Pages with no server whatsoever.** Its four "traced
workflows":

| Workflow | What it actually is | Verdict |
|---|---|---|
| `ci_pipeline` — CI: on push, workflow_dispatch | Real, trivial | Correct but not a product flow |
| **`HTTP handler` — HTTP `InputController.onKeyDown`** | **A keyboard listener in a Three.js game** | **Wrong. There is no HTTP.** |
| **`HTTP handler` — HTTP `InputController.clearRepeat`** | **Same keyboard controller** | **Wrong** |
| `export` — `export: createCharacter` | A function export | Not a workflow |

A new developer reading *"HTTP InputController.onKeyDown"* concludes the portfolio runs a web server.
It does not. This is not a random hallucination — it is the taxonomy's fault: with `event_listener`
never firing and `http_route` accounting for 86% of detections, a keydown handler has nowhere else to
go. **Fixing §18.1 fixes this too**, which is why the detector is the highest-leverage change in this
document.

Note the fair half: the portfolio's **capabilities are good** — *"Game Rendering and Scene
Management"*, *"User Input and Game Logic"*, *"Application State Management"*, with `three` mentioned
28 times and `physics` 8 times across the sections. The semantic layer understood it is a 3D game from
the code alone. **The LLM understood the project; the deterministic classifiers mislabelled it** — the
same inversion found in [§17.4](#174-the-deterministic-layer-is-the-wrong-one), now on a third
project.

---

## 18.4 `Configuration & Deployment: 0 files.` — now 5 of 5

Adding kuankongy.github.io to the tally from [§17.4](#174-the-deterministic-layer-is-the-wrong-one),
this deterministic summary is wrong on **every project audited**. It is no longer a bug to triage; it
is a broken code path that ships on every analysis. P1.

---

## 18.5 Eleven-project coverage matrix

Six more repositories were imported and analyzed to widen the sample beyond web CRUD apps. The
result isolates the two independent failures — **language coverage** and **entrypoint detection** —
and shows that the second is far more damaging.

**Run health matters here** — three of the nine new analyses did not produce a usable package, so their
numbers are annotated rather than quietly averaged in. Only rows marked ✅ had a clean
`analyze` + `generate_package` pair.

| Project | Run | Files | Analyzed | Entrypoints | **Workflows** | What the repo actually is |
|---|---|---|---|---|---|---|
| OnboardBuddy | ✅ | 268 | **222 (83%)** | **93** | **76** | **Our own repo** |
| StudyFlow | ⚠️ analyze **failed @98%** | 186 | 102 | 66 | 50 | HTTP-route heavy; extraction landed, package never generated |
| NationalPokedex | ⚠️ package **paused** | 92 | 44 | 71 | 71 | HTTP-route heavy — detector over-fires |
| CourseInsights | ✅ | 382 | 42 (11%) | 7 | 8 | Course-data API + React client |
| kuankongy.github.io | ✅ | 124 | 70 | 3 | 4 | Static 3D portfolio + game — **no server at all** |
| Skribbl | ✅ | 104 | 83 (80%) | **1** (`GET /health`) | **1** (`ci_pipeline`) | Real-time multiplayer game, **20 Socket.IO events** |
| FloowForge | ✅ | 167 | 65 (39%) | 1 | **1** (`ci_pipeline`) | Next.js + **FastAPI engine (49 .py files, unseen)** |
| **Multiplayer-Tetris** | ✅ | 52 | 32 | 2 | **0** | Real-time multiplayer game |
| **UBCPSS** | ✅ | 40 | 25 | 1 | **0** | — |
| **DeepRecall** | ✅ | 46 | 19 | **0** | 1 (`ci_pipeline`) | — |
| **MasterPokedex** | ✅ *(after restart)* | 107 | **90 (84%)** | **0** | **0** | **Best-read repo in the set — and still nothing traceable** |

**Three readings of this table, in order of importance.**

**1. Workflow counts range from 0 to 76 across comparable repositories.**
`0, 0, 0, 1, 1, 1, 4, 8, 50, 71, 76`. The product's second-most-prominent tab either doesn't exist or
overflows, with almost nothing usable in between, and which one you get is determined by whether the
codebase speaks HTTP. **Three of the six newly imported projects have a completely empty Workflows
tab**, and two more show only their CI file. The four repos at the top (50–76) are all HTTP-route
applications; every repo that isn't one lands at 0–4.

**2. Coverage is not the bottleneck — detection is.** Three **clean** runs establish this without
relying on the failed ones. `Multiplayer-Tetris` (32 of 52 files analyzed) yields **2 entrypoints and 0
workflows**; `UBCPSS` (25 of 40) yields **1 entrypoint and 0 workflows**; `DeepRecall` (19 of 46) yields
**0 entrypoints** and only its CI file as a "flow". None of these was starved of files — they were read
and nothing traceable was found in them, because nothing in them is an HTTP route. `Skribbl` is the
proof with a named cause: 83 of 104 files read, **20 real Socket.IO events**, **1 detected entrypoint**,
and the exact code path that skips them ([§18.1](#181-the-entrypoint-detector-models-the-world-as-http)).
Fixing language support would not have helped any of these four.

**`MasterPokedex` is now the cleanest case of all.** Its first run died at 98% so its zeros were
initially discarded as artifacts (see [§18.6](#186-a-failed-analysis-is-indistinguishable-from-a-successful-one)).
It was restarted and completed fully — `analyze_scope` 100%, `generate_package` 100%, all 12 sections —
and it **still produces 0 entrypoints and 0 workflows** on a repo where **90 of 107 files (84%) were
analyzed**, the best coverage in the entire set. The files were read. Nothing in them is an HTTP route,
so nothing was found.

**3. Our own repo is the outlier at the top.** OnboardBuddy: **93 entrypoints, 76 workflows** — more
than every other project combined. It is also the only repo whose architecture the detectors were
grown against ([§18.1](#181-the-entrypoint-detector-models-the-world-as-http)). This is what
single-repo dogfooding looks like measured from the outside.

**Independent confirmation of the socket blindness.** `Multiplayer-Tetris` — a second real-time
multiplayer game, imported after the Skribbl finding — reproduces it: **2 entrypoints, 0 workflows**.
Two real-time codebases, two collapses, same cause.

### The empty state is well-written and makes a claim it cannot support

MasterPokedex's Workflows tab:

> ⚠️ **No workflows traced yet**
> *Workflows are traced from entry points during analysis. If the repo has no detectable entry points,
> none can be traced — that's reported honestly, not invented.* `[Retry]`

The instinct is right and the tone is right. **The content is wrong in three ways:**

- **It relocates the blame to the repo.** "If the repo has no detectable entry points" reads as a
  statement about MasterPokedex. MasterPokedex is the best-read repo in the set. The repo has entry
  points; the detector has four patterns.
- **"not invented" is reputational credit the product doesn't earn here.** On Skribbl the same
  pipeline presented a CI YAML file as *the* traced flow at **high confidence**; on the portfolio it
  presented **two keyboard handlers as HTTP endpoints**. Claiming honesty in the empty case, while
  inventing in the populated case, is the wrong way round.
- **"yet" and `Retry` both promise change that cannot come.** Re-analysis is deterministic here; the
  button spends real money and time to produce an identical screen.

**The honest version, which is also more useful:**

> **No entry points matched our detectors.** We currently detect HTTP routes, Next.js-style pages,
> BullMQ queue consumers and package exports. **Event listeners (`socket.on`, `emitter.on`), CLI
> commands and scheduled jobs are not yet detected** — if this repo uses those, its flows won't appear
> here. `[What we detect →]`

That version tells a developer something true, tells them what to distrust, and removes the false
`Retry` affordance. **Verdict: `RIGHT, MISPRESENTED`** — and the cheapest credibility win in this
document, because it needs no detector work at all.

### A nonexistent project id claims a permissions problem

Navigating to a well-formed but nonexistent project id renders, in red: **"You are not a member of
this project"** with a `Back to Dashboard` button. The project does not exist. A developer who
mistypes an id, or follows a link to a deleted project, is told they have an access problem and may go
ask a teammate for permission to something that isn't there. Not revealing existence is a defensible
privacy choice — but then the copy should be neutral ("This project isn't available"), not a false
positive claim about membership.

Note the inconsistency with [§17.9](#179-new-defects-found-this-pass): an invalid project **id** gets a
styled screen with a recovery button, while an invalid **route** (`/projects`) gets a completely blank
page with no recovery at all. The good pattern already exists; it just isn't wired to the router.

### What this means for the milestone

The honest summary for a reviewer: **OnboardBuddy works well on codebases shaped like OnboardBuddy.**
Its citation layer is genuinely trustworthy ([§17.1](#171-the-fabrication-check): 358/358 verified),
its Diátaxis structure holds across all eleven projects (every one produced 12 sections), and its
semantic layer understands code it can read — it correctly identified a Three.js game, a Socket.IO
game server, and a course-data API from source alone. The failures are concentrated in two places, both
fixable, and both currently **silent**:

1. **Languages it cannot parse are not disclosed after import** ([§17.2](#172-the-headline-the-tool-hides-what-it-could-not-read)).
2. **Architectural styles it cannot detect are attributed to the repo, not to the tool** ([§18.1](#181-the-entrypoint-detector-models-the-world-as-http), §18.5).

Neither requires new intelligence. Both require saying out loud what the system already knows.

---

## 18.6 A failed analysis is indistinguishable from a successful one

Found while verifying the numbers above, and the most serious defect in Part 7. Of **nine** fresh
analyses run on newly imported repositories, **three never produced a usable onboarding package** — and
in two of those three, **nothing in the product says so.**

| Project | `analyze_scope` | `generate_package` | `analysis_snapshots.status` | Sections |
|---|---|---|---|---|
| MasterPokedex | **failed @ 98%** — `canceling statement due to statement timeout` | **never enqueued** | **`complete`** | **0** |
| StudyFlow | **failed @ 98%** — `canceling statement due to statement timeout` | **never enqueued** | **`complete`** | **0** |
| NationalPokedex | complete | **paused @ 0%** — LLM structured output failed validation after retry (`Expected ',' or ']' after array element in JSON at position 8439`) | `paused` | **0** |

**The bug: a failed job leaves its snapshot marked `complete`.** MasterPokedex's and StudyFlow's
`analyze_scope` jobs both died at 98% on a Postgres statement timeout, no package generation was ever
enqueued, and **both snapshots are recorded as `status = 'complete'` with zero package sections.**

Because the project list renders the denormalised scalar status ([§17.9](#179-new-defects-found-this-pass)),
these projects present as analyzed. A developer opens **Your Onboarding** and finds nothing — with no
error, no warning, and no indication that the run failed 98% of the way through. The
`recomputeProjectStatus` helper explicitly encodes *"anything ever completed ⇒ complete"*, so a
snapshot wrongly marked complete propagates straight to the card.

**Verdict: `ACCIDENT`, P1** — and it is worse than an ordinary crash, because a visible failure is
recoverable (the worker-restart message in [§17.9](#179-new-defects-found-this-pass) is a model of
that) while a silent one is not. The user has no reason to retry and no signal that anything is wrong.

**Fixes:**
1. **Only a run that completes every phase may mark its snapshot `complete`.** A run that dies at 98%
   must leave `failed` or `partial`, never `complete`.
2. **Treat "0 package sections" as a failure state in the UI**, independent of any status column. If a
   project is `complete` and its package has no sections, the onboarding tab should say so and offer
   the retry — the data is already there to detect it.
3. **Surface `paused` distinctly.** NationalPokedex is at least honest (`paused`), but the reason lives
   only in `analysis_jobs.error_message`, where no screen shows it.

**Two secondary findings worth their own issues:**

- **A 22% hard-failure rate on fresh imports, all at the same place.** Two of nine analyses died at
  **98%** with the identical Postgres error — `canceling statement due to statement timeout`. Both were
  mid-size repos (186 and 107 files). A statement timeout at the final persistence step suggests one
  oversized write (bulk insert of records or embeddings) that scales with repo size and is not batched
  or chunked to fit the pooler's statement timeout. Worth reproducing directly against
  `DIRECT_DATABASE_URL` to identify the statement.
- **LLM structured-output validation can pause a whole package at 0%.** NationalPokedex's package
  generation failed on malformed JSON *after* a retry (truncation at byte 8439 looks like an output-token
  limit, not a model mistake). One bad section blocked all twelve. Sections generate in parallel
  already — a single section that fails validation should be marked low-confidence or omitted with a
  visible gap, not halt the package.

**Correction to §18.5, recorded rather than quietly fixed.** My first reading of this data used
MasterPokedex — "the best-covered repo produces zero entrypoints" — as the proof that detection rather
than language coverage is the bottleneck. That was wrong: its analysis **failed at 98%**, so its zeros
are plausibly truncation artifacts and cannot support any claim. The argument is now carried by three
clean runs (Multiplayer-Tetris, UBCPSS, DeepRecall) plus Skribbl's named code path, which is stronger
evidence anyway. The MasterPokedex **empty-state screenshot and its wording critique still stand** —
that screen is exactly what a user sees.

---

## 18.7 A paused package hides a completed analysis — and only on some tabs

Found while restarting the failed runs from [§18.6](#186-a-failed-analysis-is-indistinguishable-from-a-successful-one).
This is the sharpest single defect in Part 7 because every claim in it is measured on one snapshot.

**The snapshot.** `KuanKongy/NationalPokedex`, snapshot `998a15b7`, `status = 'paused'`:

| Table | Rows present |
|---|---|
| `entrypoints` | **71** |
| `workflows` | **71** |
| `architecture_clusters` | 6 |
| `capabilities` | 4 |

Its `analyze_scope` job is **`complete` at 100%**. Only `generate_package` is unfinished. Every piece of
extraction succeeded.

**What the four tabs say about that one snapshot:**

| Tab | Data in DB | What the user sees |
|---|---|---|
| Architecture | 6 clusters | ✅ renders |
| Dependencies | 298 nodes | ✅ renders |
| **Workflows** | **71 workflows** | ❌ *"**No workflows traced yet.** Workflows are traced from entry points during analysis. **If the repo has no detectable entry points, none can be traced** — that's reported honestly, not invented."* |
| **Capabilities** | **4 capabilities** | ❌ *"**No capabilities extracted yet**"* |

**Two distinct defects, stacked.**

**1. A paused *package generation* suppresses *analysis* results that are complete.** The two phases share
one `analysis_snapshots.status`, so an unfinished LLM write-up blanks out deterministic extraction that
finished cleanly. The sidebar even shows the truth — *"Generating onboardin… 86%"* — while the tab
asserts nothing was found.

**2. The tabs disagree with each other.** Architecture and Dependencies read the paused snapshot happily;
Workflows and Capabilities refuse it. **Four tabs, one snapshot, two contradictory answers about whether
the data exists.** There is no policy here, only per-tab divergence — and the two tabs that refuse are
the two that carry the product's headline claims.

**3. The empty state is now provably false, not merely unfair.** [§18.5](#185-eleven-project-coverage-matrix)
criticised *"if the repo has no detectable entry points"* for quietly blaming the repo. On
NationalPokedex the repo has **71 detected entrypoints**, and the sentence still appears. One generic
string is standing in for three unrelated situations, each needing a different message and a different
user action:

| Real situation | Example | What it should say |
|---|---|---|
| Detector matched nothing | Multiplayer-Tetris | "No entry points matched our detectors (HTTP routes, Next pages, BullMQ, package exports). Event listeners and CLI commands are not yet detected." |
| Analysis failed | MasterPokedex | "This analysis failed before completing. Re-run it." |
| **Data exists, snapshot not readable yet** | **NationalPokedex** | **"Still generating — 71 flows found, write-up in progress."** |

**Verdict: `ACCIDENT`, P1.** Filed as Bug #80. The fix is small: gate tab content on whether the rows
exist, not on the snapshot's package status, and make the empty state name which of the three cases it
is. The information needed to tell them apart is already in `analysis_jobs`.

### The blanking is permanent, not transient

The restart settled this. NationalPokedex's `generate_package` finished — **`complete` at 100%, all 12
sections written** — and its snapshot **is still `status = 'paused'`**. So the blanking in the table above
is not a passing state during generation: a resumed package that completes successfully never returns its
snapshot to `complete`, and **Workflows and Capabilities stay empty indefinitely** on a project that has
71 workflows, 71 entrypoints and a finished 12-section package. The "Still generating" message proposed
above is therefore not sufficient on its own — the status transition itself is broken and must be fixed
with it. Escalated in Bug #80.

**Restart outcome, for the record.** All four failed/paused runs were resumed on their existing job rows
through the same code path the API's resume endpoint uses, so completed phases came from cache — the
resumed NationalPokedex package reported *"Generated section: guardrails_ops (1/2)"*, i.e. it picked up
the two outstanding sections rather than regenerating twelve. **Checkpoint-resume works, and it is a
genuine strength**; it is only invisible because nothing surfaces the failure that makes it necessary
([§18.6](#186-a-failed-analysis-is-indistinguishable-from-a-successful-one)).

One process note worth recording against my own work: the resume query swept every failed job in the
window, which re-ran an already-superseded CourseInsights failure and spent a few cents re-analyzing a
repo that had already succeeded via a later job. Scope a resume to the *current* run per project.

---

# Part 8 — The reader's furniture, the graph's controls, and a retraction

Driven by a specific list of complaints from the product owner. Every item below was reproduced; two
were reproduced and then **traced to a cause in the source**, and one earlier finding is **withdrawn**.

---

## 19.1 `Ready` on a project with 71 workflows and a finished package

The status chain behind [§18.7](#187-a-paused-package-hides-a-completed-analysis--and-only-on-some-tabs),
now followed to the card:

1. `generate_package` completes (100%, all 12 sections written)
2. **the snapshot stays `status = 'paused'`** — nothing transitions it back
3. `recomputeProjectStatus` looks for a snapshot with `status = 'complete'`, finds none, and falls
   through its `ELSE` branch to **`idle`**
4. `ProjectCard` renders `idle` as **`Ready`**, with the hint *"This project hasn't been analyzed yet."*

Verified in the UI — the project list shows:

| Project | Card status |
|---|---|
| **NationalPokedex** | **`Ready`** |
| MasterPokedex, UBCPSS, CourseInsights, kuankongy.github.io, Skribbl, FloowForge, OnboardBuddy | `Complete` |

**The one project displaying "hasn't been analyzed yet" is the project with the most workflows in the
entire set (71) and a complete 12-section package.** Same root cause as #80; the card is the most
visible symptom and the one a reviewer will hit first.

---

## 19.2 The reader's architecture diagram: static, oversized, and first

The diagram is the **first element in the reader**, above the TL;DR — a newcomer's first contact with the
document is a picture, not a sentence.

| Property | Measured |
|---|---|
| Height | **275px**, spanning the full content width |
| Position | Above the TL;DR and all prose |
| Interaction | **None** — static Mermaid SVG. No zoom, no pan, no fullscreen, no click-through |
| Edge labels | **~11 edges carrying 2 distinct values** (`imports` ×8, `calls` ×2 on Skribbl) |
| Label weight | Grey label chips render nearly as heavy as the nodes they connect — on Skribbl the word `imports` occupies as much ink as the node `State` |
| Content | The same clusters as the Architecture tab, including **`Web · Tests` as a top-level node** |

**Three problems, in order:**

1. **It cannot be enlarged.** At 7 nodes it is *just* legible. The Architecture *tab* for the same data
   gets pan, zoom, fullscreen, a minimap and a search box; the reader's copy gets none of them. On a
   14-cluster project (our own repo) or anything larger, the reader's diagram is unreadable **with no
   recourse** — the user has to leave the document and go find the tab.
2. **The edge labels are noise.** Two distinct values across ~11 edges, drawn at near-node weight. Label
   the exception, not the rule: drop `imports` entirely and keep `calls`.
3. **Tests lead the diagram.** A top-down graph reserves its top-left for what matters, and on Skribbl
   that slot holds `Server · Tests → calls → Server · Modules`. A newcomer's first impression of the
   architecture is that tests drive the server. Exclude test clusters from the reader's overview, or sink
   them.

**Verdict: `OUR COMFORT, NOT THEIRS`** — the diagram was placed first because it is the most impressive
artifact, not because it is the most useful opening. The TL;DR is the better opening and it is already
written; put the diagram after it, cap its height, and make it click-through to the Architecture tab.

---

## 19.3 The citations footer: 43 numbered file paths with no names

At the foot of `code_map` on FloowForge:

```
… 39 web/components/editor/use-topo-order.ts   40 web/components/ui/button.tsx
   41 web/lib/api.ts   42 web/lib/supabase/server.ts   43 web/lib/supabase/supabase-url.ts
```

Each chip is a number plus a **bare file path** — measured DOM text is literally
`28packages/shared/src/index.ts`. **No symbol name, no line range, no claim.** 43 of them, wrapping
across rows, all rendered at once with no collapse.

And the database explains why so many carry no name at all. On FloowForge:

| Receipt kind | Total | No symbol | No file path | No claim |
|---|---|---|---|---|
| `code_snippet` | 188 | 0 | 0 | 91 |
| `config_snippet` | 11 | 0 | 0 | 0 |
| `workflow_step` | 4 | 3 | 0 | 3 |
| **`record_reference`** | **459** | **459** | **459** | **443** |

**`record_reference` is 69% of all 662 receipts and has no file, no symbol and (in 443 cases) no claim.**
It points at an internal semantic record. To a reader, a citation you cannot open is not evidence — and
it is inflating the very number the product uses to demonstrate trustworthiness.

**Fixes:** report two numbers (`43 citations · 21 you can open`); show `file.ts:120–134 · symbolName`
on the chip instead of a bare path, since [§17.1](#171-the-fabrication-check) proved those line ranges
are accurate; collapse the list behind `Sources (43)` and expand on demand; and de-duplicate — several
chips repeat the same file.

---

## 19.4 Known gaps: 34 copies of one sentence, 63% of a section

The worst single element in the product. FloowForge's **Guardrails & Operations** ends with **34
consecutive lines**, each identical except for a variable name:

```
gap — There are no documented guardrails for `API_RATE_LIMIT_ENABLED`.
gap — There are no documented guardrails for `CONTEXT_MAX_TOKENS`.
gap — There are no documented guardrails for `SUPABASE_URL`.
…×34
```

| Measured | |
|---|---|
| Gap lines | **34**, all sharing the prefix *"There are no documented guardrails for"* |
| The word `gap` | Repeated **34 times** as a dim prefix, doing no work |
| Block height | **996px** |
| Share of the section's 1,572px | **63%** |

The headings immediately above name the source: *"Environment variables (api/.env.example — names only,
values never analyzed)"* and the same for `web/.env.example`. So the pipeline read two `.env.example`
files, listed their variable names, and emitted **one "gap" per variable**.

**This is one finding rendered 34 times.** It is also arguably not a finding at all — `SUPABASE_URL`,
`REDIS_URL` and `OPENAI_API_KEY` do not need "documented guardrails". It is noise presented as
diligence, and it buries the section's actual 1,875 characters of guardrails prose.

**`code_map` shows the same shape differently.** 16 entries, every one starting with the word
**`Unknown`**, every one a statement about *the tool's own evidence* rather than about the codebase:

> *Unknown — The evidence for `web/lib/api.ts` does not contain snippet information to support claims
> about its specific functions like `formatError` or its role in token refresh logic beyond the general
> description.*

**Three of the 16 are byte-identical apart from the filename** — *"does not contain direct snippet
information."* full stop. A newcomer reads 595px of the product discussing its own pipeline and learns
nothing about FloowForge.

**And the count in the header contradicts the page.** The trust strip says **"5 known unknowns"** while
`guardrails_ops` renders **34** and `code_map` renders **16**; the twelve sections hold **89** in total.
The strip's number matches neither the section nor the package.

**Fixes:**
1. **Group by kind and collapse:** `No documented guardrails for 34 environment variables (show)`. One
   line, expandable — the information is preserved and the section becomes readable.
2. **Drop gaps that restate the absence of documentation for config names.** They are generated
   mechanically from a name list, so they are all or nothing.
3. **Never emit a gap whose text is identical to another's modulo an identifier** — dedupe on the
   template, not the rendered string.
4. **Reconcile the strip with the page**, and say what it counts.
5. **Reframe the voice.** Gaps should describe the *codebase* ("no rate-limit config found for the public
   webhook route"), not the *pipeline* ("the evidence does not contain snippet information").

---

## 19.5 A dotted underline that means "unverified", with nothing to say so

The opening paragraph of `big_picture` — the document's one-sentence answer to *what is this system* —
renders with a **dotted underline**. Measured on the page: `title` is `null`, there is no `aria-label`,
and no legend or key anywhere in the reader explains it. It is the `[[unverified]]` marker from
`lib/receiptMarkers.ts`, correctly transformed and correctly styled — and completely unexplained.

Worse, **the same dotted style is used for two different things**. The only three dotted elements on the
page are:

| Element | Meaning | Behaviour |
|---|---|---|
| `ranked by 9 signals` | tooltip trigger | hover reveals an explanation |
| `5 known unknowns` | tooltip trigger | hover reveals an explanation |
| **the opening paragraph** | **"this claim cites nothing"** | **no hover, no explanation** |

A reader who learns that dotted = "hover me" from the first two will hover the third and get nothing.
**Verdict: `WORKS, UNDISCOVERABLE`.** Give the unverified span its own treatment and a hover that says
*"No source receipt backs this sentence"* — the underlying mechanic is good and deserves to be legible.

---

## 19.6 The product's own name is misspelled throughout the document

The repo is **`FloowForge`** (sidebar, breadcrumb and repo name all render it correctly). The generated
prose calls it **`FlowForge`** — in the TL;DR (*"This document explains the FlowForge system"*) and in the
opening paragraph (*"FlowForge is a platform for creating and managing automated workflows"*).

A newcomer's first two sentences misname the product they were hired to work on, on the same screen as
the correct spelling in the sidebar. Small, cheap to fix, and exactly the kind of detail that decides
whether a reader trusts the rest. **Fix:** pass the repo name as a fixed string into the section prompts
and post-validate it, the way the deterministic backbone already validates identifiers.

---

## 19.7 Clicking a node throws away your view — `setCenter(zoom: 1.15)`

Reproduced at runtime (viewport transform went `0.93843` → `1.15` with a pan) and then traced to source.

`components/graph/ViewportFocus.tsx`:

```ts
zoom = 1.15,                                   // default, line 23
…
setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom, duration: 500 });  // line 59
```

**All three callers use the default** — `ArchitecturePage:266`, `WorkflowsPage:329`,
`DependencyGraphView:196` pass `fitPadding`/`fitMinZoom`/`ownsInitialFit` but never `zoom`. So selecting
any node in any graph animates the viewport to an **absolute 1.15×** over 500ms.

**Why this is the wrong behaviour:**

1. **It is absolute, not relative.** Whatever you had panned and zoomed to is discarded. On the
   Dependencies drill-in, where `fitView` lands at **0.15×** ([§9.2](#92-drilling-in--the-worst-screen-in-the-product)),
   one click is a **7.7× jump** — from the whole graph to one node with no surroundings.
2. **Selection is also how you inspect.** There is no way to read a node's details without losing your
   overview, and no way to get the overview back except deselecting, which closes the details. **You can
   have context or detail, never both.**
3. **It fires simultaneously with a 320px canvas loss.** `ArchitecturePage.tsx:246` switches the
   container to `grid lg:grid-cols-[1fr_320px]` when something is selected, so the pane narrows at the
   same instant the zoom rises — two compounding reductions in visible context.
4. **It defeats the feature it serves.** The legend promises *"its direct neighbors stay lit while
   everything else dims"* — a neighbourhood view. Centring on the node at 1.15× frequently pushes those
   neighbours off-screen, so the dimming has nothing left to contrast against.

**Fixes:** don't change zoom on selection at all — pan the minimum distance to bring the node inside the
*remaining* pane and leave the scale alone (`setCenter` accepts the current zoom via `getZoom()`); if the
node is already visible, do nothing. Reserve an explicit "zoom to this" affordance for the detail panel,
where the user asks for it.

---

## 19.8 Fullscreen has no visible way out

Reproduced from source, and the product owner's description is exact.

- `ArchitecturePage.tsx:246` — on fullscreen the graph container becomes
  **`fixed inset-0 z-50 bg-background p-3`**: an opaque overlay across the whole viewport.
- The **only** fullscreen toggle lives in `PageHeader`'s `actions` (`:180–187`), rendered in normal
  document flow at the top of the page.
- **`PageHeader` sets no `z-index` and no positioning**, so it creates no stacking context and the
  `z-50` overlay paints straight over it.

So entering fullscreen hides the button that exits it. The button's own `title` reads *"Exit fullscreen
(Esc)"* and the Escape handler works (`:64–70`) — but the tooltip documenting the escape hatch is
attached to the element that just became invisible. `GraphPage.tsx:325–328` has the identical structure.

**Verdict: `ACCIDENT`, P1** — a modal state with no visible exit. **Fix:** render an exit control *inside*
the fullscreen container (top-right, over the canvas), and/or give the header `relative z-[60]` so it
stays above the overlay. A visible "Esc to exit" hint on entry costs one line and removes the trap.

---

## 19.9 Retraction: "edges paint before nodes" was my instrumentation, not the product

[§17.9](#179-new-defects-found-this-pass) reported that the Architecture tab paints edges before nodes on
first load, producing a visible nest of unlabelled curves. **That finding is withdrawn.**

While re-testing it I measured the automation context directly:

```
visibilityState: "hidden"   hasFocus: false   rafCallbacksFiredIn600ms: 0
```

The tab driving this audit is **backgrounded**, so `requestAnimationFrame` never fires. React Flow
measures node dimensions via rAF/`ResizeObserver` and cannot lay out until it does — and taking a
screenshot forces a paint, which is why screenshots intermittently showed a settled graph while a
DOM query milliseconds earlier reported nine empty node shells, zero edges and an identity transform.

Everything I observed is consistent with a throttled background tab and **not** evidence of a product
defect. Two intermediate conclusions drawn from the same instrumentation — a multi-second "settle
window" and then an indefinite "hang" — were also wrong and are not recorded as findings.

**What this means for the rest of the audit.** Findings resting on *measured DOM values* (contrast
ratios, node counts, bounding boxes, transforms, text content, class names) and on *source code* are
unaffected. The one class of claim this environment cannot support is **render timing**, so no timing
claim is made anywhere else in these documents. The node-click zoom in
[§19.7](#197-clicking-a-node-throws-away-your-view--setcenterzoom-115) survived precisely because it was
re-derived from source after the runtime measurement, rather than resting on it.

---

## 19.10 Part 8 counts

**17 findings: 5 High · 8 Medium · 4 Low**, plus **1 retraction** and **2 verified strengths** (the Ask panel's refusal contract; 61 reader controls with zero missing accessible names).

Ranked:

1. **Fullscreen trap** (§19.8) — modal with no visible exit, on two tabs. P1.
2. **`Ready` on a fully analyzed project** (§19.1) — the most visible symptom of #80. P1.
3. **Node-click discards the viewport** (§19.7) — breaks graph exploration on all three graph tabs. P1.
4. **Known-gaps bloat** (§19.4) — 34 copies of one sentence, 63% of a section. P1.
5. **Unopenable citations counted as evidence** (§19.3) — 69% of receipts name no file. P2.
6. **Reader diagram cannot be enlarged** (§19.2) — and is placed first. P2.
7. **Unexplained dotted underline** (§19.5), sharing a style with tooltip triggers. P2.
8. **Product name misspelled in the prose** (§19.6). P3, but trivially cheap.

---

## 19.11 The Ask panel: the honesty the section generator is missing — and 26 blank receipts

Never exercised in either previous audit. It is simultaneously **the best trust behaviour in the
product** and **the clearest instance of receipt bloat**.

**The test.** I asked FloowForge's reader: *"What language is the backend execution engine written in?"*
The true answer is Python/FastAPI, and it lives entirely in the **49 `.py` files the analysis skipped**
([§17.2](#172-the-headline-the-tool-hides-what-it-could-not-read)). This is the question the product is
most likely to get wrong by guessing.

**It refused to guess:**

> **NOT ANSWERABLE FROM THE EVIDENCE**
> *The language of the backend execution engine is not mentioned in the provided documentation or code
> snippets.*

Measured: the word `python` appears nowhere in the response. The panel's own tagline — *"Answers come
from the analyzed evidence with numbered receipts — gaps are stated, not guessed"* — is **earned**.

**This matters more than any other strength in these documents, because it is the fix for the headline
finding, already implemented one component away.** Faced with the same evidence gap:

| Surface | Behaviour |
|---|---|
| **Ask panel** | *"NOT ANSWERABLE FROM THE EVIDENCE"* — refuses, names the gap |
| **Section generator** | Produces 28,661 characters describing a Next.js app, never mentioning that 43% of the code was unread |

The section generator should adopt the Ask path's refusal contract. The prompt discipline, the verdict
vocabulary and the UI treatment all exist; they are simply not applied to the twelve sections.

**And now the bloat, in its clearest form.** The answer is accompanied by **40 numbered receipt chips**:

| Chips | Content |
|---|---|
| **1–14** | Real: `web/app/auth/google/route.ts 12–51`, `web/lib/api.ts 63–71`, `web/middleware.ts 219–247` … |
| **15–40** | **Blank — a number and a file icon, nothing else.** No path, no line range, no name |

**26 of 40 chips (65%) are empty placeholders**, filling four full rows of a 565px-wide dialog. The
proportion matches the database exactly: `record_reference` receipts are **69% of FloowForge's 662** and
carry **no `file_path`, no `symbol_name`** ([§19.3](#193-the-citations-footer-43-numbered-file-paths-with-no-names)).
The UI renders them because they exist, not because they can be read.

**Fix:** filter to receipts that resolve to a file before rendering, and report the rest as a count if at
all — `14 sources (26 internal references omitted)`. This is the same one-line filter that fixes the
reader's citation footer.

**The same message, three times.** The panel states its uncertainty in three places stacked vertically:

1. a `Low Confidence` badge beside the echoed question,
2. the answer paragraph — *"The provided evidence does not contain information about the programming
   language used for the backend execution engine"*,
3. the `NOT ANSWERABLE FROM THE EVIDENCE` callout — *"…is not mentioned in the provided documentation or
   code snippets."*

(2) and (3) are near-verbatim restatements. Keep the callout, drop the badge and the paragraph.

**The placeholder is written for our own repo.** The example question is
`e.g. "Where does an analyze request enter the worker?"` — *analyze request* and *worker* are
OnboardBuddy's own nouns. On FloowForge, a Tetris portfolio or a Pokédex it is meaningless, and it is the
one piece of copy that teaches a new user what the feature is for. Generate the example from the
project's own capabilities, which are already extracted and named.

---

## 19.12 Smaller flows swept in this pass

Each of these was checked directly and is recorded so the coverage claim is falsifiable.

| Flow | Result |
|---|---|
| **Reader accessible names** | **61 interactive controls, 0 unnamed** — a genuine strength, and far better than the login form ([§2](#2-sign-up-signup-and-log-in-login)). Citation buttons carry real labels (*"Source reference 3: web/middleware.ts"*). |
| **Duplicate accessible names** | **`"Click to view the code snippet"` × 12** — twelve controls with an identical name. A screen-reader user hears the same label a dozen times with no way to tell them apart, while sibling citation buttons are properly named. Reuse the `Source reference N: <path>` pattern already in use. |
| **Role switching in the reader** | **Not possible.** The role renders as a **static badge** (`General`) — verified non-interactive. The package grid has an "All roles" filter, so to read the backend reading order you must leave the reader, return to the grid, and re-enter. The reader is where you'd want it. |
| **Export** | Works; **Markdown only** (`onboarding-{role}.md`). Reasonable for M4 — worth stating in the UI, since "Export options" (plural) implies a choice of formats and offers one. |
| **`Jump to section` control** | Exists in the reader top bar (`aria-expanded`) — a second navigation affordance alongside the 12-item rail and the "SUGGESTED FOR YOU" panel. **Three concurrent ways to choose a section**, and the suggested panel duplicates items 1, 2 and 7 from the rail directly above it. |
| **Nonexistent project id** | *"You are not a member of this project"* — false claim, with a `Back to Dashboard` recovery ([§18.5](#185-eleven-project-coverage-matrix)). |
| **Unmatched route** | Blank page, no recovery ([§17.9](#179-new-defects-found-this-pass)). The good recovery pattern exists one route away. |

**Not covered, and why.** Render-timing behaviour of any kind — the audit tab is backgrounded and
`requestAnimationFrame` never fires ([§19.9](#199-retraction-edges-paint-before-nodes-was-my-instrumentation-not-the-product)),
so animation, transition and first-paint claims are not measurable here and none are made. Radix
dropdown menus (`Export options`) could not be opened via synthetic events in this environment, so their
menu contents are read from source rather than observed. Still outstanding from earlier passes: the
Import wizard and Invitations (blocked — `github_installations` has **0 rows**), Project Settings and Team
beyond a glance (owner/admin gated), the Classes & interfaces graph view, light-theme contrast
measurement, and real email confirmation.

---

# Part 9 — HCI assessment

Parts 1–8 catalogue defects. This part asks the question those defects are evidence *for*: **can a new
developer actually use this, and does it deserve their trust?** Six dimensions, each with a verdict and
the measurement behind it. Where a claim rests on operating a control it carries its ledger `cid`;
where it rests on the database or the source, it says so.

**The thesis, in one sentence:**

> **OnboardBuddy is scrupulously honest about its evidence and quietly dishonest about its coverage** —
> every citation it shows you is real, and almost every number describing *how much it read* is wrong in
> its own favour.

That single split explains most of what follows. A developer who checks a citation comes away trusting
the product. A developer who checks the *scope* comes away not trusting it. The second developer is the
one the product was built for.

---

## 20.1 The real permission mismatches — operated, not inferred

Every item here was produced by calling the API or clicking the control, after the previous edition
filed a permission finding that turned out to be wrong (§7, withdrawn).

**A privilege escalation, proven live.** The same boundary is enforced on one path and absent on the
other — and the unguarded path grants the *higher* tier:

| Path, as an **admin** | Result |
|---|---|
| `PATCH /projects/:id/members/:userId` → promote a developer to **admin** | **403** — *"Admins cannot promote members above developer"* (`members.ts:167-170`) |
| `POST /projects/:id/members/invitations` with `permission_tier: "owner"` | **201 Created** — row minted with `permission_tier: "owner"` |

`members.ts:57-95` validates presence and duplicate-pending, and never compares the granted tier to the
caller's. `invitations.ts:128` then copies the tier verbatim on accept. **So an admin can invite an
address they control as `owner` — the one tier that can delete the project.** The probe row was removed
immediately; 0 owner-tier invitations remain. **`ACCIDENT`, P0-adjacent.** Fix: reject any granted tier
above the caller's, in the invitation handler, mirroring the rule the promote handler already applies.

Also confirmed while there: **invitations never expire** — the only invitation in the database has
`expires_at: null`, and the accept path treats NULL as valid forever.

**An admin is offered a button the API refuses.** `ProjectCard.tsx:209` gates the `Delete project` menu
on `canManage` (owner **or** admin), but `projects.ts:494` is `requireProjectAccess("owner")`. The
error lands as small red text inside the dialog, which stays open, on a card that stays put. The same
product gets this right 400 lines away — `ProjectSettingsPage.tsx:658` gates the identical action on
`=== "owner"`, and its dialog additionally requires typing the repo name.

**A dead end offered to every tier.** `NodeInfoPanel.tsx:181-188` renders `Adjust weights` for
developers; it lands on `ProjectSettingsPage.tsx:569-611`, where all seven sliders are `disabled` and
both save buttons are unrendered. No 403 — just a page you cannot use, with nothing saying why.
`HelpPage.tsx:188` makes the same promise in prose.

**The gating error on the reader runs the opposite way.** `POST /onboarding/generate` is
`requireProjectAccess()` — any member, deliberately (`onboarding.ts:103-107`) — yet the flagship
"Analyze & generate…" entry points are `canManage`-gated (`OnboardingPage.tsx:927`, `:1018`). **A
developer is denied in the UI a capability the backend grants them.**

**Developers are never told their documentation is stale.** `OnboardingPage.tsx:1523` gates the amber
"source files changed" banner on `canManage`. The tier that reads the docs is the tier that isn't
warned they're out of date — while the tier that can regenerate them is.

**No tier is ever explained.** The only two strings in the product describing what a tier permits —
`TeamPage.tsx:288-290` and `:491-493` — both live inside owner/admin-only UI. A developer can never
read either. They get a `DEVELOPER` badge, ~20 greyed controls, and no sentence.

---

## 20.2 Honesty — the dimension this product is actually about

**Verdict: split, and the split is the finding.** Strong on evidence, weak on scope.

**What it gets right, and should say publicly:**

| Claim | Evidence |
|---|---|
| Citations are real | **220/220** sampled receipts across all 11 repos: file present at the analyzed commit, line range in bounds, snippet matching real bytes |
| Citations resolve | **413/413** distinct inline `[[receipt:…]]` markers resolve. Zero dangling |
| It refuses to guess | Asked what language FloowForge's backend engine is — answerable only from the 49 skipped Python files — the Ask panel returned **"NOT ANSWERABLE FROM THE EVIDENCE"** and never guessed |
| It reports its own downgrades | *"8/10 tracked claims cite receipts · 2 downgraded to low · 7 receipts"* |
| It marks unverified prose | `[[unverified]]` spans render with a dotted underline rather than being silently dropped |

**Where it is not honest:**

- **The coverage number is wrong, in its favour.** `onboarding.ts:661` sets
  `coverage.files.analyzed = snapMeta.file_count` — the **total** repo file count, not the parsed count.
  FloowForge's reader renders **"Analyzed 167 files (51 unsupported skipped)"** when **65** were parsed.
  **CourseInsights overstates by 9×** (382 claimed, 42 parsed). This is the single place the product
  accounts for its own limits, and it is arithmetically false. **P1.**
- **Skipped languages are never named in prose — 0 of 11 projects.** Fifteen phrasings (`skip`,
  `not analyzed`, `unsupported`, `known gap`, …) return **zero hits across all 132 generated sections**.
- **Two projects are described as the wrong kind of software.** FloowForge — *"a `web` service
  responsible for the user interface and core application logic"* — is a FastAPI execution engine with
  49 Python files. DeepRecall, a **Flask/Whisper video-transcription API**, is described as *"a frontend
  interface… handling theme customization and displaying notifications"*, and all three of its
  capabilities describe shadcn scaffolding. Its root cause is `unsupported: {python: 1}` — **one file,
  which is the entire product.**
- **It invents prerequisites.** UBCPSS and Multiplayer-Tetris are told to install **Docker**; neither
  repo contains a single Docker file. FloowForge is told to run `docker compose up`; there is no compose
  file. This is fabrication, not omission, and it is the failure most corrosive to trust.
- **Confidence does not follow evidence.** A FloowForge flow rendering **one node and zero edges** is
  labelled **"high confidence"**; the Capabilities *tab* shows 4 HIGH / 2 MEDIUM while the `capabilities`
  *section* for the same snapshot is rated **low**.
- **The empty state blames the repo.** *"If the repo has no detectable entry points, none can be
  traced — that's reported honestly, not invented"* — shown on MasterPokedex, the **best-read repo in
  the set (84%)**. The detector has four patterns; the repo has entry points.

---

## 20.3 Transparency — does the user know what the system did?

**Verdict: excellent instrumentation, undermined by constants and silence.**

The provenance panel, the trust strip, per-section confidence, commit pinning (`main@855b6f1`), *"ranked
by 9 signals"*, *"3 known unknowns"* — this is more self-disclosure than most commercial tools attempt,
and the strip's shape (`cites 77 of 435 symbols in 32 files`) is exactly the right idiom.

Against that:

- **Constants pretending to be data.** `Draft` on **8/8 packages, 93/93 sections, 18/18 tutorials** —
  nothing has ever left draft, and `reviewed_at`/`reviewed_by` are never written. `STALE 0` on every
  project. `DEVELOPER` on every card. A field that never varies is furniture that looks like information.
- **The counts contradict the page.** The strip says **"5 known unknowns"** while `guardrails_ops`
  renders **34** and `code_map` renders **16**; the twelve sections hold **89**.
- **There is no toast system.** Zero `toast` references repo-wide; three live regions exist, all on
  Login/Signup. So a successful mutation — saving settings, revoking an invite — is confirmed by
  nothing. The harness flags this class as `SILENT-MUTATION` by construction, and caught it on
  Project Settings: clicking **`Save weights`** fired
  `PUT /projects/:id/ranking-weights/backend` with **no alert and no text change anywhere on the page**.

  Traced to source, and it is an inconsistency *within a single page* — `ProjectSettingsPage` has
  three independent save mechanisms and only one of them says anything:

  | Control | Request | Confirmation |
  |---|---|---|
  | `Save changes` (page footer) | `PUT /settings` (`:179`) | **`setSaved(true)`** → button reads **"Saved!"** for 2s (`:183-185`, rendered `:688`) |
  | **`Save weights`** | `PUT /ranking-weights/:role` (`:236`) | **none** — awaits, refetches, returns |
  | **`Save key` / `Remove`** | `PUT`/`DELETE /llm-key` (`:198`, `:215`) | **none** |

  So a user drags seven sliders, presses `Save weights`, and **nothing on screen changes** — there is no
  way to tell success from failure. Compounding it, the footer `Cancel` only calls `refetch()` of
  *settings*, while slider state lives in `weightRoles` (`:114`), so **`Cancel` does not revert moved
  sliders either.** The user can neither confirm the save nor undo it. **`ACCIDENT`, P2** — reuse the
  existing `saved` pattern on all three, or add the missing live region.
- **The unverified marker is unexplained.** Dotted underline, `title: null`, no legend — and the *same*
  dotted style is used on `ranked by 9 signals` and `5 known unknowns`, which **are** hover targets. One
  visual treatment, two meanings, one of them silent.

---

## 20.4 Utility — does it deliver what a new developer needs?

**Verdict: it optimises for what it can enumerate, not for what a newcomer needs.**

The clearest evidence is where the effort went:

| Section | Chapter | CourseInsights length | Confidence |
|---|---|---|---|
| **`setup_run`** — *"Get it running on day one"* | **DO** | **759 chars** — the shortest in the package | medium |
| **`first_change`** — *"Your First Change"* | **DO** | 2,314 | **low** |
| `code_map` | CONSULT | **15,173** | medium |

**A 20× spread, with the day-one section the shortest and the first-change section the least trusted.**
On FloowForge, `routes_jobs` is **208 characters**. Generation effort tracks how much code a section can
list, not how much a newcomer needs it.

- **The tab that answers "how does this system work" is empty or overflowing, rarely useful.** Workflow
  counts across eleven comparable repos: `0, 0, 0, 1, 1, 1, 4, 8, 50, 71, 76`. Three of the six newly
  imported projects have a **completely empty** Workflows tab; two more show only their CI file. The four
  at the top are all HTTP-route apps.
- **`event_listener` has never been emitted** — 245 entrypoint rows across all projects are only
  `http_route`, `ui_route`, `package_export`, `worker_job`. Skribbl: **1 of 12** inbound socket handlers
  detected. MasterPokedex: **0 of 6** React routes.
- **The FAQ is a backlog.** Three of its nine questions — *"What does 'Complete' mean?"*, *"How do I use
  the dependency graph?"*, *"What are receipts?"* — exist because the UI doesn't answer them.
- **What genuinely works:** the Capabilities tab (plain-language description, *"When you'll touch it"*,
  START HERE with per-file reasons, cross-links) is the best surface in the product and is the template
  the other tabs should copy.

---

## 20.5 Usability — can they work out how to use it?

**Verdict: strong information architecture, repeatedly undone at the interaction layer.**

The Diátaxis chapter structure (ORIENT / UNDERSTAND / DO / CONSULT, each with a one-line purpose) holds
across all eleven projects and is a real achievement. What breaks is what happens when you touch things:

- **Fullscreen is a trap — measured, not read.** Hit-testing the toggle at its own centre before and
  after: **not covered → covered, by `react-flow__pane`**, with its label correctly swapping to
  *"Exit fullscreen (Esc)"*. **No control is rendered inside the overlay**, and the string "Esc" appears
  **nowhere on screen**. Escape does exit — but the only thing documenting it is the tooltip of the
  button the canvas just covered.
- **Selecting a node throws your view away.** `ViewportFocus.tsx:23` defaults `zoom = 1.15` and all three
  callers use the default, so every selection animates to an **absolute** 1.15×. On the dependency
  drill-in, where `fitView` lands at **0.15×**, one click is a **7.7× jump**. The 320px detail panel
  opens at the same moment, so the canvas shrinks as the zoom rises. **You can have context or detail,
  never both.**
- **The Legend covers the thing you asked for.** Following START HERE → `?focus=web/lib/api.ts` drills
  correctly into the right cluster, opens the panel, adds a breadcrumb — and the focused node is
  **100% occluded** by the Legend panel, while a different node appears lit.
- **The tour overlay eats the first click.** Found by hand earlier, and independently reproduced by the
  harness: `[data-tour-overlay]` is `fixed inset-0 z-[60]` and intercepts pointer events, so a new
  user's first interaction does nothing and they are not told why.

  **This also silently degrades the team's own test suite.** `lib/tourState.ts:19` keys dismissal as
  `` `${prefix}:${userId}` ``, but `e2e/fixtures.ts` sets the **bare prefixes**
  (`onboardbuddy:project-tour-dismissed`), which never match — so the project tour has been running
  during every existing Playwright spec, and `phase10-ui.spec.ts` has been screenshotting through a
  live coach-mark overlay. Measured effect on this audit's instrument before the keys were corrected:
  **199 of 356 clicks required `force: true`, 71 failed outright, and 214 `OCCLUDED` / 201
  `FOCUS-LOST` flags were raised** — all artefacts of the overlay. After correcting the key format:
  **5 forced, 11 failed.** Fixed in `e2e/fixtures.ts` as part of this pass so the team's specs stop
  inheriting it.
- **Two tours, seven tooltips, before any content** — and both cover the thing they describe. Step 1 of
  4 teaches OnboardBuddy's *data model* to someone who came to learn a codebase.
- **A typo'd URL is a blank page.** `App.tsx` has no `path="*"`; `/projects` — the prefix of every
  project link — renders `#root` with 0 children and 31 characters of HTML. Meanwhile a nonexistent
  project **id** gets a styled screen with a recovery button that says the wrong thing: *"You are not a
  member of this project."*
- **Project cards are `<div role="link">`.** The list page holds 10 anchors, all in the chrome. A
  developer cannot cmd-click two projects open to compare them.
- **One bad endpoint destroys the page.** `DashboardPage` reads `activity.length` unguarded; a malformed
  `/projects/activity` response replaces the entire dashboard with *"Something went wrong"*. Error
  handling is all-or-nothing.

---

## 20.6 Accessibility

**Verdict: good naming discipline, poor keyboard and contrast reality.**

- **Naming is genuinely good where it was checked:** 61 reader controls, **0 without an accessible
  name**, and citation buttons carry real labels (*"Source reference 3: web/middleware.ts"*). But
  `"Click to view the code snippet"` is reused **12 times** on one screen — twelve identical
  announcements with nothing to distinguish them.
- **Native `title` tooltips are keyboard-invisible.** The codebase carries **58** of them and only 3
  `data-testid`s. A `title` never appears on focus, only on hover — so every affordance explained only by
  a `title` (including the graph's LR/TB and fullscreen toggles) is unreachable without a mouse. The
  harness flags this as `TIP-NATIVE`.
- **Dark theme has no structural contrast.** Every structural pair fails WCAG 3:1 — card/background
  **1.09**, popover/background **1.18**, sidebar-border **1.27**, input/card **1.43**. Text pairs all
  pass. So the *content* is readable and the *containers* are not: cards, fields and modals have no
  visible edge. (Light theme is **not measured** — the earlier "crisp" claim was eyeball judgement and
  has been withdrawn.)
- **A quarter of the product cannot be reached by keyboard.** Measured by the harness across **678
  censused controls on 24 surfaces**:

  | Measure | Count | Share |
  |---|---|---|
  | Interactive elements **not in the tab order at all** | **162** | **24%** |
  | Controls whose only tooltip is a native `title` (never shown on focus) | **259** | **38%** |
  | Controls with **no accessible name** | **1** | 0.1% |

  **The graph tabs are the worst, and they are the flagship surfaces.** Keyboard-unreachable controls
  per surface: `dependencies` **29 of 77**, `dependencies-classes` **29 of 77**, `workflows` **18 of
  50**, `architecture` **14 of 48** — roughly 38% of each. A keyboard user cannot enter the canvas,
  select a node, or reach the LR/TB and fullscreen toggles, which are themselves `title`-only. So the
  three tabs the product exists to deliver are effectively mouse-only, while the naming discipline
  everywhere is near-perfect (1 unlabelled control in 678). **The accessibility failure is not
  labelling; it is reachability.**

  These two figures are stable across two independent full sweeps (678 controls / 24 surfaces, then
  508 / 21) at **24%** and **38%**, which is why they are quoted.

  *Deliberately not quoted as defect counts: `FOCUS-LOST` (166) and `OCCLUDED` (42). After the
  instrument was fixed these are measurable — forced clicks fell from 199 to 5 and click failures from
  71 to 11 — but each still needs per-control confirmation before it counts as a defect, and the
  fullscreen case ([§20.5](#205-usability--can-they-work-out-how-to-use-it)) shows why: it was
  confirmed only after the occluder turned out to be the canvas rather than the header.*
- **Hotkeys die silently.** `useHotkeys.ts:19` suppresses every shortcut while
  `document.querySelector('[role="dialog"]')` matches — **any** dialog node in the DOM, open or not. A
  lingering Radix portal disables `[`, `]`, `1`–`9` and `?` with no indication.
- **No `prefers-reduced-motion`** anywhere, in a product with 500ms viewport animations and perpetual
  spinners.

---

## 20.7 Comfort — is using this pleasant, or exhausting?

**Verdict: the reader asks the user to absorb a great deal of the product's own bookkeeping.**

- **34 identical sentences.** FloowForge's Guardrails section ends with 34 consecutive lines of
  *"gap — There are no documented guardrails for `X`."* — **996px, 63% of the section** — generated one
  per variable from two `.env.example` files. Several are not gaps at all (`SUPABASE_URL` needs no
  "documented guardrail").
- **16 paragraphs about the tool's own evidence.** `code_map`'s KNOWN GAPS are all of the form *"The
  evidence for X does not contain snippet information…"* — **3 byte-identical apart from the filename**.
  A newcomer reads ~595px of the pipeline discussing itself.
- **26 of 40 receipt chips are blank** in the Ask panel — a number and an icon, nothing else — because
  `record_reference` receipts (**69%** of FloowForge's 662) carry no file path. The same pattern gives
  the reader 43 bare numbered paths with no symbol or line.
- **The same message three times.** The Ask panel states its uncertainty as a `Low Confidence` badge, an
  answer paragraph, and a `NOT ANSWERABLE` callout that restates the paragraph.
- **Three concurrent ways to choose a section** — the 12-item rail, "SUGGESTED FOR YOU" (which repeats
  items 1, 2 and 7 from the rail directly beneath it), and a "Jump to section" dropdown.
- **Discouraging framing.** The only documentation available is badged **`Draft`** with **"5 low
  confidence"** in warning red and no counterweight, and 5 of 12 nav items carry a red dot. The honesty
  is right; the emphasis is inverted. `7 high · 5 low` would be equally true and far less deflating.

---

## 20.8 Scorecard

| Dimension | Verdict | The one thing to fix first |
|---|---|---|
| **Honesty** | **Split — excellent on evidence, failing on coverage** | `onboarding.ts:661` — report `supportedFileCount`, not `file_count` |
| **Transparency** | Strong instrumentation, undermined by constants | Stop rendering `Draft`/`STALE 0` when no other value is reachable |
| **Utility** | Optimised for what it can enumerate | Give `setup_run` and `first_change` a length floor, funded by capping `code_map` |
| **Usability** | Good IA, broken interactions | Fullscreen exit, node-click zoom, Legend occlusion — all three are small |
| **Accessibility** | **Near-perfect naming, 24% unreachable by keyboard** | Make the graph canvases focusable; replace 259 `title` attributes with real tooltips |
| **Comfort** | Bookkeeping leaks into the reading experience | Collapse repeated gaps; hide receipts that resolve to nothing |

**The encouraging conclusion:** every one of these fixes is small, and the product already contains its
own answer in each case. The Ask panel refuses to guess — the section generator should. Capabilities
shows how to orient a newcomer — the other tabs should. The trust strip already reports ratios of
exactly the right shape — it just needs the correct numerator. **Nothing here requires new intelligence;
it requires the product to apply, in its prose and its chrome, the standards it already applies to its
citations.**

---

## 20.9 The Import wizard, finally walked — on live data

Unreachable in all three previous passes because `github_installations` was empty. The GitHub App was
reconnected for the audit account (`OnboardBuddy455`, 3 repositories visible), so this is `src:live`:
real API, real GitHub, real session, no mocks.

**It is one of the better-designed surfaces in the product, and it had never been audited.**

| Stage | Controls | Comboboxes present |
|---|---|---|
| Initial | 20 | `Select account` |
| After choosing an account | 21 | `OnboardBuddy455`, **`Select repository`** |
| After choosing a repository | 24 | account, repo, **`main`**, **`General`** |
| Ignored-paths panel opened | 26 | — |

**What it gets right:**

- **It is progressive.** Repository only appears once an account is chosen; branch and role only once a
  repository is. The user is never shown a field they cannot yet answer — the opposite of the reader,
  which shows three ways to pick a section at once ([§20.7](#207-comfort--is-using-this-pleasant-or-exhausting)).
- **It fills in what it can infer.** Branch auto-selects the repo's `default_branch` (`main`) and role
  defaults to `General`, so the minimum path is account → repository → Import.
- **It states its own preconditions.** *"GitHub App linked to @OnboardBuddy455"* sits at the top, and
  the subtitle — *"Step 1 of 2 — connect a GitHub repository. The analysis is configured in the next
  step"* — tells the user what this step is and is not. The footer adds *"Nothing is analyzed yet."*
- **Zero console errors** across the entire live walk.

**What it gets wrong:**

- **A required choice with exactly one answer.** `Select account` opens to a single option
  (`OnboardBuddy455`). The wizard already demonstrates the right behaviour one field later, where it
  auto-selects the only sensible branch — it should do the same here, or render the account as a
  statement rather than a control. Same shape as the `SINGLETON-MENU` flag raised on `Export options`
  and the Help page's tour-project picker: **three separate one-item pickers across the product.**
- **Nothing distinguishes a private repository.** `OnboardBuddy455/CourseInsights` is private, and the
  option list renders it identically to the public ones — while privacy is exactly the axis a user is
  being asked to think about on this screen, which carries its own privacy notice further down.

**Verdict: `ACCEPTABLE`, and worth saying so.** After three passes recording this surface as "not
covered", the honest result is that it is better than most of the product. The finding is not that the
wizard is bad — it is that **the audit had been treating an unmeasured surface as an unknown risk when
it was in fact a strength**, which is its own lesson about declaring coverage gaps rather than guessing.
