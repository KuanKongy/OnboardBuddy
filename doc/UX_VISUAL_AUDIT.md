# OnboardBuddy — Visual, Colour, Layout & Responsive Audit

**Date:** 2026-07-25 · supersedes the 2026-07-22 edition
**Build:** `Milestone4` working tree, live Docker stack, dark theme primary with light-theme comparison
**Companion to** [UX_AUDIT_FINDINGS.md](./UX_AUDIT_FINDINGS.md) (function and content). This document
judges **appearance**: colour, contrast, density, composition, typography, and phone behaviour.

## Jump to

| Section | Headline |
|---|---|
| [1. The dark theme has no structure](#1-the-dark-theme-has-no-structure--measured) | Every structural contrast pair fails 3:1 — card/bg is **1.09** |
| [2. Colour as an encoding](#2-colour-as-an-encoding) | 12 cluster kinds → 7 colours; badges that never vary |
| [3. Composition](#3-composition--do-these-things-belong-together) | Do these things belong together? |
| [3.5 Two layouts fight their container](#35-high-two-layouts-fight-their-own-container--measured) | 2.1px label text at one end, 4.9% canvas fill at the other |
| [4. Typography and truncation](#4-typography-and-truncation) | |
| [5. Responsive and phone](#5-responsive-and-phone) | `10 passed, 2 failed`; the reader is **untested** on phones |
| [6. What looks good — keep it](#6-what-looks-good--keep-it) | |
| [7. Counts and priorities](#7-counts-and-priorities) | |

**Second pass (2026-07-25).** A five-project re-run added visual findings that live in the companion
document because they are inseparable from the data behind them: an **unlabelled criticality bar**
that reads as a proportion of the file count beside it and means the opposite (1 file → 40% fill, 30
files → 13%); a **Legend panel that 100%-occludes the node a deep link just focused**; and **10 diagram
edges carrying 2 distinct labels** (`imports` ×8, `calls` ×2) rendered as heavily as the nodes. See
[UX_AUDIT_FINDINGS.md Part 6](./UX_AUDIT_FINDINGS.md#part-6--the-five-project-pass-and-the-fabrication-check).

## Retractions

This document previously listed **"edges painting before nodes on first load of the Architecture tab"**
in the paragraph above. **That finding is withdrawn.** It was an artifact of the audit environment: the
automation tab ran backgrounded (`visibilityState: "hidden"`, `hasFocus: false`, **0
`requestAnimationFrame` callbacks in 600ms**), and React Flow cannot measure nodes without rAF, so
screenshots — which force a paint — disagreed with DOM queries taken milliseconds earlier. Full account:
[UX_AUDIT_FINDINGS.md §19.9](./UX_AUDIT_FINDINGS.md#199-retraction-edges-paint-before-nodes-was-my-instrumentation-not-the-product).

**Consequence for this document: no render-timing, animation or first-paint claim appears anywhere in
it.** Contrast, palette, geometry and truncation findings are unaffected — they are static measurements.

**Method.** Contrast ratios are **computed from the live rendered tokens** — each OKLCH value painted
to a canvas, read back as sRGB, converted to relative luminance and compared per WCAG 2.1. They are
measurements, not estimates. Palette findings are traced to the source map that produces them.
Responsive findings come from the project's own 390×844 Playwright suite plus a static sweep of
breakpoint usage, because `resize_window` does not change the render viewport in this environment
(the same limitation the previous edition hit — now worked around rather than skipped).

---

## 1. The dark theme has no structure — measured

**This is the highest-impact visual finding and it is not a matter of taste.**

WCAG 2.1 requires **3:1** for the boundary of a UI component and **4.5:1** for body text. Live values:

| Pair | Ratio | Needs | Verdict |
|---|---:|---:|---|
| `card` / `background` | **1.09** | 3.0 | **FAIL** −1.91 |
| `popover` / `background` | **1.18** | 3.0 | **FAIL** −1.82 |
| `sidebar-border` / `sidebar` | **1.27** | 3.0 | **FAIL** −1.73 |
| `border` / `card` | **1.43** | 3.0 | **FAIL** −1.57 |
| `input` / `card` | **1.43** | 3.0 | **FAIL** −1.57 |
| `border` / `background` | **1.56** | 3.0 | **FAIL** −1.44 |
| `foreground` / `background` (text) | 16.51 | 4.5 | PASS |
| `muted-foreground` / `background` | 7.47 | 4.5 | PASS |
| `muted-foreground` / `card` | 6.86 | 4.5 | PASS |
| `primary` / `background` | 5.97 | 3.0 | PASS |
| text on `primary` | 6.28 | 4.5 | PASS |
| `success` / `warning` / `info` / `destructive` text | 8.88 / 10.16 / 8.50 / 5.17 | 4.5 | PASS |
| focus `ring` / `background` | 5.97 | 3.0 | PASS |

**Every text pair passes. Every structural pair fails.** That asymmetry explains how this survived:
Phase 6 of the M4 audit workstream fixed the **light** theme's `--success`, `--warning` and `--border`
using a proper OKLCH→sRGB→WCAG calculation, and left the dark theme alone on the correct observation
that its *text* contrast was fine. Dark **structural** contrast was never measured.

**What it looks like in use.** Cards do not read as raised surfaces (1.09 is visually identical).
Text inputs and textareas look like floating placeholder text rather than fields — verified on Project
Settings. The sidebar divider is effectively invisible. And **modals barely separate from the page**:
at 1.18, the "Regenerate package" dialog registers mainly through its backdrop dim, not its own
surface. **Light mode was not measured** — see the note below; the dark-theme ratios above stand on
their own and are the actionable half.

**Two of these are new**, not in the previous edition: `input`/`card` (1.43) and `popover`/`background`
(1.18) — i.e. the two component classes where a missing boundary is most consequential, form fields
and dialogs.

*Fix:* raise dark `--border` and `--input` until each clears 3.0 against `--card`, lift `--card` and
`--popover` a few L\* points off `--background`, and give `--input` a fill distinct from `--card`.
Every screen already reads from these tokens, so the fix propagates without touching a single page —
the same reason the light-theme fix was cheap. **Measure, do not eyeball**: Phase 6 caught its own
approximation error exactly this way.

---

## 2. Colour as an encoding

### 2.1 `[HIGH]` The architecture legend promises a mapping the palette cannot deliver

**Source-verified** in `frontend/src/lib/architectureData.ts`. `CLUSTER_KIND_PALETTE` maps **12
cluster kinds onto 7 colours**, so five colours each carry two meanings:

| Colour token | Cluster kinds sharing it |
|---|---|
| `--node-ui` | `frontend_ui` **and** `frontend_state` |
| `--node-api` | `api_layer` **and** `auth_layer` |
| `--node-worker` | `worker_layer` **and** `analysis_engine` |
| `--node-config` | `integration_layer` **and** `devops_layer` |
| `--node-shared` | `shared_module` **and** `other` |

The legend lists these as **separate labelled categories, each with a dot** — telling the reader that
colour identifies category. It does not. A purple node may be Frontend UI or Frontend state, and those
are the two labels most likely to be confused in the first place.

**The palette itself is good** — seven well-separated hues at sensible chroma, with distinct light and
dark values, wired through to `--chart-*`. The defect is the **mapping**, not the colours.

*Fix:* either collapse the legend to the 7 real visual categories (so it stops promising precision it
doesn't have), or add a second channel — outline style, icon, or a small kind glyph — to separate the
paired kinds. Do not add more hues: 7 is already at the practical ceiling for categorical encoding.

### 2.2 `[MED]` Encodings too small to read

- **Criticality bars** on architecture nodes are roughly **30×3px**, with no axis, no scale, no label
  and no tooltip. At that size a bar length difference is imperceptible, so the only quantitative
  encoding on the tab conveys nothing. Either give it a number or remove it.
- **Inline citation chips** in section prose are small numeric boxes that read as punctuation. They
  are the entry point to the product's best feature (the receipt viewer) and are the least prominent
  interactive element on the page.
- **Tutorial step dots** render a ~4px visible dot inside a 24px button. The hit area is correct; the
  visual target is not.

### 2.3 `[MED]` Badges that never vary

A badge earns its position by discriminating. These do not:

| Badge | Observed |
|---|---|
| `MODULE` on dependency nodes | 7 of 8 nodes |
| `DEVELOPER` on project cards | 4 of 4 cards |
| `HIGH CONFIDENCE` on capability cards | 6 of 6 cards |
| `TRANSFORM` on journey steps | 3 of 4 steps |

Each occupies the top-right of its container — the second-most-scanned position — while carrying no
information. `TRANSFORM` is the worst case: it is applied to `POST /login`, `GET /me` and
`POST /logout` alike, so the step-kind taxonomy collapses to "not the trigger".

### 2.4 `[MED]` Emphasis pointed at the wrong things

- **`STALE 0`** renders the zero in `text-foreground` — the **brightest** token in the theme
  (`ProjectCard.tsx:261`). Maximum visual weight on a non-issue, repeated on every card.
- **`2 low confidence`** is the only coloured element on the package card, so the eye lands on the
  negative before the title.
- **`Delete account`** is a filled red button and the single most prominent control on Account
  Settings, ~50px from the routine `Sign Out`.
- **`Mark as read`** is the most emphasised control in the reader's top bar — a progress checkbox
  styled as a primary CTA, while `Ask` (higher value) is a ghost button.

### 2.5 `[LOW]` Inverted tooltips in a dark UI

Tooltips render as light boxes with dark text while everything else is dark. Inverted tooltips are a
legitimate convention, but nothing else in this app inverts, so they read as foreign — and the
"Complete" tooltip on a project card is positioned **over the card's own title and description**.

---

## 3. Composition — do these things belong together?

### 3.1 `[MED]` Status told twice, two different ways, 45px apart

Every project card shows a status **icon** in the top-right and a status **word** above the progress
bar. Two encodings of one fact, neither of which needs the other.

### 3.2 `[MED]` Progress bars where there is no progress

A completed project shows a **100%-filled green bar**; an un-analysed one shows an **empty 0% track**
plus a **dashed-circle** icon. The bar is only informative during the ~3 minutes a run is active, yet
it is the widest, highest-contrast element on the card in all states — and in the idle state both the
bar and the icon actively suggest something is running.

### 3.3 `[MED]` Controls that outweigh their content

- **Package grid:** three filter dropdowns and a `1 / 1 packages` counter above **one** card.
- **Reader nav:** 27 entries for 12 sections, because the "Suggested for you" rail repeats items 1, 2
  and 7 that are visible immediately below it in the same 195px column.
- **Base font-size control:** a segmented control spanning the full ~470px card for three options that
  need ~200px, leaving an empty track that reads as broken.
- **Minimaps:** rendered on graphs with 8 and 14 nodes, where they map nothing useful, in low-contrast
  grey with no viewport indicator.

### 3.4 `[MED]` Empty space where the content should be

The dashboard and project list both occupy the **top ~320px of an 840px viewport** and leave the rest
blank. One project card fills 21% of its row. Meanwhile the receipt dialog — whose code content needs
**1196px** — is capped at **672px in a 1728px viewport**, clipping the evidence horizontally. The app
is simultaneously too empty in its overviews and too cramped in its detail views.

### 3.5 `[HIGH]` Two layouts fight their own container — measured

The two graph tabs fail in **opposite** directions, and both come down to laying out a graph whose
aspect ratio has nothing to do with the pane's.

**Workflows — a 1:10 graph in a 1.46:1 pane.** A 21-step flow lays out as **21 nodes in one column**:
graph **224 × 2254px**, pane **1200 × 824px**. It uses **18.7% of the width**, needs 2.7× the height,
and `fitView` responds by zooming **in** to 1.83×. You see **4 of 21 steps** and scroll three
pane-heights to read one flow while 81% of the canvas stays empty.

**Dependencies drill-in — the opposite failure.** 60 files, 155 edges: graph **3282 × 4263px** in a
**1462 × 764px** pane, so `fitView` zooms to **0.15×**. Nodes render **36 × 16px** and **label text
renders at 2.1px** against a ~9px legibility floor. Everything fits and nothing can be read.

These are the same mistake twice: **the layout optimises for "it all fits in one view" rather than
"the user can read it."** Fitting is our convenience. In Dependencies it was even deliberate — the M4
commit set "an explicit low `minZoom` so `fitView` isn't clamped to the default 0.5 floor on large
graphs."

*Fixes are different per tab and are set out in [UX_AUDIT_FINDINGS.md §11.2](./UX_AUDIT_FINDINGS.md)
(wrap the chain into pane-sized columns; collapse repeated runs; reuse the Tutorials rail) and §9.2
(never zoom below a legibility floor — crop and pan instead; drill one directory level at a time
rather than straight to 60 leaves).*

### 3.6 `[LOW]` Graph canvases dominated by disconnected nodes

Dependencies renders **5 of 8** nodes as unconnected singletons in a grid; Architecture leaves two
orphans at the bottom. Half the canvas shows things with no relationships, while the related nodes
compress into a corner with crossing edges.

---

## 4. Typography and truncation

Truncation is not a rendering detail here — it is destroying identifying information.

| Surface | Truncated | Consequence |
|---|---|---|
| Architecture node titles | **7 of 14** | `Backend · Mo…`, `Frontend · Mo…` and `Modules` become indistinguishable |
| Reader section nav | **4 of 12** | `Capabilities: What It …`, `Routes, Jobs & Webho…` |
| Workflows rail | **6 of 16** visible | `Queue consumer: SUMMA…` vs `Queue consumer: ANALYS…` |
| Sidebar account name | always | `UX Audit Tester` → `UX Audit Te…` at 224px |
| Capability `START HERE` paths | frequently | truncates mid-identifier: `#generateDeterministicSect…` |

The root cause is a mismatch of intent: section and component titles were written as **descriptive
phrases** ("Capabilities: What It Does", "Backend · Shared Utilities") and then placed in **narrow
fixed columns**. Either the titles need short forms for navigation, or the columns need to be wider or
wrap to two lines.

Also: `1 files` / `1 Projects` — singular/plural not handled in at least two places.

---

## 5. Responsive and phone

**How this was verified.** `resize_window` reports success but does not change the render viewport in
this environment, so hand-checking phone layout was not possible — the previous edition simply recorded
that and moved on. Instead this pass ran the project's **own** `e2e/mobile-ui.spec.ts`, which sets a
real **390×844** viewport against mocked APIs and asserts `scrollWidth − clientWidth ≤ 1`.

### 5.1 Result: `10 passed, 2 failed`

**Passing — real evidence that phone layout works.** The dashboard and the project tabs fit 390px with
no horizontal scroll, and **the sidebar-as-drawer behaviour on phones passes**. The Phase 3 drawer work
(Escape to close, focus trap, scroll lock, auto-close past the breakpoint) is holding. This is a
genuine strength and better than the previous edition assumed.

### 5.2 `[HIGH]` The onboarding reader has had no phone coverage since the Diátaxis rebuild

**Verdict: test rot, not a proven layout bug — and that distinction matters.**

The `onboarding-reader fits a phone screen` test fails **before** reaching its scroll assertion:

```
Locator: getByText('What this service does')  →  element(s) not found
```

`"What this service does"` is a **pre-Diátaxis section title**. The M4 content rebuild renamed every
section and this spec's readiness selector was never updated, so the test has been failing on a stale
string ever since — meaning **the reader, the product's main content surface, is currently unverified
on phones**. It is not shown to be broken; it is shown to be untested.

*Fix:* update the selector to a current section title (e.g. "The Big Picture") and then find out
whether it actually fits. Given §5.4 below, expect it not to.

### 5.3 `[LOW]` The second failure is a test-fragility artifact

`sidebar collapses and restores on desktop` fails with
`<div data-tour-overlay="true" class="fixed inset-0 z-[60]"> intercepts pointer events` — the
first-run tour is open and swallowing the click. Correct behaviour for a spotlight tour; the spec just
never dismisses it. Worth fixing in the spec so the suite stops carrying two red tests that mean
different things.

### 5.4 `[MED]` Structurally, the heavy surfaces have no phone adaptation

A sweep of responsive utility usage:

| Breakpoint | Uses across the app |
|---|---:|
| `sm:` | 53 |
| `md:` | **2** |
| `lg:` | 26 |
| `xl:` | 5 |
| `2xl:` | 0 |

**`md:` is used twice in the entire frontend**, so there is effectively no tablet story — the layout
jumps from phone to desktop and 768–1024px (iPad portrait) falls into whichever bucket it lands in.

And the most complex components carry almost no responsive utilities at all:

| Component | Responsive utilities |
|---|---:|
| `AnalysisRunPanel.tsx` | **0** |
| `GraphPage.tsx` | 1 |
| `ArchitecturePage.tsx` | 1 |
| `ReceiptViewer.tsx` | 1 |
| `WorkflowsPage.tsx` | 2 |
| `WalkthroughTab.tsx` | 3 |
| `OnboardingPage.tsx` | 6 |

Combined with fixed widths that cannot shrink — `w-72` (288px) ×8, `w-64` ×5, `w-[240px]` ×3, `w-80`
(320px) ×2 — a 390px phone has very little room left once one of these renders. The reader in
particular is a **three-column layout** (188px global sidebar + 195px section nav + content), which
needs ~600px before the content column gets anything.

*Fix:* collapse the reader's section nav into the drawer or a top dropdown below `lg:`, let the receipt
dialog go full-screen on phones, and give the graph canvases and run panel explicit small-screen
treatment rather than relying on overflow.

---

## 6. What looks good — keep it

| | Why |
|---|---|
| **The colour system's foundations** | OKLCH throughout, separate light/dark values per token, semantic naming (`--node-*`, `--chart-*`), and a light theme whose contrast was properly computed. The dark-theme problem in §1 is three token values, not an architecture. |
| **Light theme** | **Not measured — claim withdrawn.** Earlier editions asserted "every boundary that fails in dark is crisp here", which was eyeball judgement in a document whose method is *"measurements, not estimates"*. Light-theme token ratios were never computed. Scheduled for the current pass, where the theme toggle can be operated under Playwright. |
| **The receipt viewer's layout** | Clear hierarchy: path → symbol → line range → confidence → summary → code → "this receipt supports" → action. Nothing competes for attention. Only defect is its width cap (§3.4). |
| **Capability cards** | Consistent internal rhythm (`When you'll touch it` → `START HERE` → `FLOWS THAT DELIVER IT` → `WHERE THE CODE LIVES`), so all six scan identically. |
| **Architecture's horizontal colour key** | Compact, above the canvas, doesn't overlay content — better placed than Dependencies' 5-line prose box sitting on top of the graph. |
| **Auth pages** | Well-proportioned single column, logo, "Welcome back", inline "Forgot password?", show/hide toggle, clear `or` divider. The best-composed screens in the app. |
| **Topology diagram** | Real grouping (internal services boxed, external dependencies boxed separately), legible labels, sensible arrow. |
| **Expanded run row** | Chips for branch/commit/role, attribution, then a monospace timestamped log — a clean data-dense pattern. |
| **Phone drawer** | Test-verified working at 390×844. |
| **`prefers-color-scheme`** | Follows the OS until pinned, with a no-flash boot script. |

---

## 7. Counts and priorities

**Corrected 2026-07-25.** This table previously read 4 / 14 / 5 = 23, which did not reconcile with the
document's own tags and included the finding since withdrawn (see [Retractions](#retractions)). Counted
mechanically from the `` `[HIGH]` ``/`` `[MED]` ``/`` `[LOW]` `` markers:

| Severity | Count |
|---|---|
| High | 3 |
| Medium | 8 |
| Low | 3 |
| **Total** | **14** |

Corpus total across both documents: **169** — see
[UX_AUDIT_FINDINGS.md Part 5](./UX_AUDIT_FINDINGS.md#part-5--counts-and-priorities).

**Ordered by impact ÷ effort:**

1. **§3.5 — the two graph layouts.** Workflows shows 4 of 21 steps; the Dependencies drill-in renders
   text at 2.1px. Both are the flagship "understand the code" interactions and both are currently
   unusable at real repository size.
2. **§1 — three dark-theme token values.** Fixes invisible cards, fields and modals across every
   screen, with no page-level changes. Highest leverage item in either audit document.
3. **§5.2 — update one stale test selector.** Restores phone coverage of the main content surface, and
   tells us whether §5.4 is theoretical or real.
4. **§3.4 — raise the receipt dialog's max-width.** One value; stops clipping the product's core
   evidence.
5. **§2.1 — reconcile the architecture legend with its 7 real colours.** Stops the graph making a
   promise it cannot keep.
6. **§2.3/§2.4 — drop the invariant badges, hide `STALE` at zero.** Pure subtraction; reclaims the
   most-scanned position on four surfaces.

---

*The functional and content companion is [UX_AUDIT_FINDINGS.md](./UX_AUDIT_FINDINGS.md), whose §1
(the trust layer contradicting itself) is the single most important finding across both documents.*
