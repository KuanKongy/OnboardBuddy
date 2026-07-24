# OnboardBuddy — Visual / Color / Layout Audit

**Date:** 2026-07-22
**Build:** `main` @ `dda6d28`, live Docker stack (`:5173`)
**Method:** Hands-on click-through of every screen in **both themes** (landing, auth, dashboard, project list, import, project overview, onboarding reader, architecture, dependencies, workflows, capabilities, project settings, team, account settings), reading each screen as a first-time user would, plus **exact WCAG 2.1 contrast math computed from the real OKLCH design tokens** (script converts OKLCH→sRGB→relative luminance; verified against WebAIM references). This is a *design/perception* companion to the functional findings in `UX_AUDIT_FINDINGS.md` — different lens, no overlap.

**How to read:** tagged **[HIGH]/[MED]/[LOW]** by user-visible impact, with the token/file location and measured numbers where relevant.

---

## Overall impression — how it feels

OnboardBuddy reads as a **competent, clean, developer-flavored SaaS** — near-black surfaces, monospace metadata, restrained type. For the target audience (engineers) the aesthetic is credible and calm. But three things hold it back from feeling *polished and confident*:

1. **It's very dark and very monochromatic.** The dark theme's background sits at CIE L\*≈4.4 — darker than GitHub or Material dark (L\*≈12–20) — and the entire palette is essentially *near-black + grays + one blue accent*, with color appearing only in small status chips. The result is sleek but **low-energy and a little austere**; screens can feel dim and flat rather than crisp.

2. **Surfaces and inputs don't separate.** Because everything hugs black, cards barely lift off the page and form fields are nearly borderless (measured below). On the form-heavy screens this makes the UI look slightly *unfinished* — you hunt for where an input begins.

3. **Content floats in empty space.** Several core screens put a narrow column of content in a wide dark void (big empty right half; the reader has a ~200px empty left gutter). It reads as "unfinished layout," and it's clearly fixable because one screen (Capabilities) fills the width beautifully.

The richer screens — **Capabilities, the onboarding reader, the graph views** — feel genuinely valuable and well-crafted. The weakness is concentrated in the chrome (surfaces, inputs, spacing) and a handful of color/state inconsistencies. Net: 70% of the way to feeling premium; the gap is structural contrast + layout density + a few color decisions.

---

## The "is it too dark?" verdict — measured

**Dark theme surface ladder** (CIE L\*, and adjacent-surface contrast):

| Surface | Hex | CIE L\* | vs. previous |
|---------|-----|--------:|--------------|
| background | `#0c0f16` | **4.4** | — |
| card | `#151922` | 8.9 | contrast **1.09** |
| popover | `#1c202a` | 12.4 | contrast 1.08 |

- **Yes, objectively dark.** A background at L\*=4.4 is near the bottom of what shipping dark themes use; it's the kind of black that makes bright white text (foreground contrast 16.5:1) feel slightly harsh and makes every panel edge disappear.
- **The three-surface "ladder" is perceptually sensible** (ΔL\* ≈ 4.5 then 3.5) — the *idea* is right — but at these luminances the actual contrast between adjacent surfaces is only ~1.09, i.e. invisible without help from borders or shadows, and (see below) the borders don't help either.
- **Recommendation:** lift `--background` (dark) from L\*≈4.4 to roughly **L\*≈8–10** (e.g. `oklch(0.19–0.21 …)`) and `--card` a step above that. Text contrast has enormous headroom (AAA everywhere) to spend on a less abyssal canvas, and it immediately improves surface separation.

**Dark-theme text is a genuine strength — leave it alone.** Every text and semantic pair measured **AA or AAA**: foreground/bg 16.5, muted-foreground/bg 7.4, primary/bg 6.0, and all semantic colors 6–10:1. Nothing fails. The darkness problem is *structural*, not legibility.

---

## Color & contrast findings

- **[HIGH] Dark-theme structure fails the 3.0 UI-contrast threshold across the board.** Measured against their own surfaces: `card`/`background` **1.09**, `border`/`card` **1.43**, `input`/`card` **1.43**, `border`/`background` **1.56**, `sidebar-border`/`sidebar` **1.26**. *Effect (confirmed live on Project Settings):* cards read as barely-raised, the "Ignored paths" textarea and the Max-LLM-calls/token number inputs look like floating placeholder text, and the sidebar divider is nearly invisible. *Fix:* raise `--border` (dark) to ~L\*20+ so it clears 3.0 on card, give inputs a slightly lighter fill than card, and lift `--card`/`--popover` a few L\* points. (`styles.css` dark block, lines 74–124)
- **[HIGH] Avatar initials are illegible — white text on Tailwind-500 fills.** Measured: white on **amber-500 2.15**, **cyan-500 2.43**, **emerald-500 2.54**, rose 3.67, red 3.76 — all fail AA-normal; amber/cyan/emerald fail even the 3.0 large-text bar. *Effect:* the colored initial bubbles on Team/account cards are muddy and hard to read. *Fix:* use the `-700` shade for the fill, or dark text on the light hues. (`TeamPage.tsx:340` palette)
- **[MED] Light-mode "soft chip" text fails AA-normal.** Colored text on its own soft tint: success/success-soft **3.93**, warning/warning-soft **3.90**, danger/danger-soft **4.04**, info/info-soft **3.69** — all below 4.5, so any status chip using colored text under ~18px is sub-AA in light mode. Plain `info`/background is **4.37**, also failing as body text. (Dark mode is fine — 5.6–8:1.) *Fix:* darken the light-theme semantic tokens ~5–8%, or render chip text in `foreground` (which is AAA on every soft chip) rather than the semantic hue. (`styles.css` light block, lines 36–43)
- **[MED] Graph edges are too faint to follow.** On the near-black canvas the dependency/architecture connection lines are low-opacity gray; with 56 crossing edges you can't trace a single dependency at rest. *Effect:* the graph's core job — "see how changes ripple" — is visually hard. *Fix:* raise edge opacity/width, or dim non-hovered edges so the hovered path stands out. (graph edge styling)
- **[MED] Two near-identical purples in the graph legend.** "Frontend UI" and "Frontend state" are both violets sitting a few hue-degrees apart; on the small node dots they're effectively the same color. *Fix:* move one to a clearly distinct hue (the palette has room — e.g. push "Frontend state" toward magenta/pink or teal). (node/cluster palette)
- **[LOW] Light-mode node colors work as swatches but not as small labels.** All node fills clear 3.0 as dots (good) but most land 3.5–4.4 on the page background, so any small text tinted with a node color in light mode is sub-4.5. Keep them for fills; don't use them for small text.

---

## Component & state findings

- **[MED] The "Analyzing" dashboard tile spins forever at count 0.** The tile's icon is an animated loader that keeps rotating even when nothing is analyzing (0). *Effect:* perpetual motion signals "work happening" when the system is idle — mildly anxiety-inducing and a needless moving element. *Fix:* show a static icon when the count is 0; only animate while a job is actually running. (`DashboardPage` stat tiles)
- **[MED] "Complete" project status is styled as a clickable link.** On the project card it renders as **green, dotted-underlined text** above the progress bar — it looks like an actionable link but it's just a status. *Fix:* render it as a status pill/label (no underline), consistent with the other badges. (`ProjectCard`)
- **[LOW] Disabled primary button isn't clearly disabled.** On Import, the disabled "Import repository" (muted blue) sits right next to the enabled "Connect…" (bright blue); the two are close enough that the disabled state doesn't read as disabled. *Fix:* stronger disabled treatment (lower opacity + `not-allowed` cursor + no gradient). (`ImportPage`)
- **[LOW] Implausible/hard-to-parse duration.** Run history shows **"560m 7s"** (≈9.3 h) as a raw minute count. *Effect:* looks like a bug and forces mental division. *Fix:* format long durations as `9h 20m` (and consider excluding queued/paused idle time). (`ProjectOverviewPage` run history)
- **[LOW] Inert "receipt" references in the reader.** Inline "(receipt r1)…(receipt r8)" are plain muted text; clicking does nothing. *Effect:* they look like the evidence links that are the product's whole "source-grounded" promise, but they're dead. *Fix:* make them jump to / open the receipt, or drop the parenthetical. (`OnboardingPage` reader)

---

## Consistency findings

- **[MED] "Complete" is green in one place, blue in another.** The project card shows completion in **green**; run-history "complete" badges are **blue** (info/primary). Same concept, two semantic colors — and green is the conventional "success," so the blue badge reads as merely "informational." *Fix:* use `success` (green) for completed runs; reserve blue for selected/info. (`ProjectOverviewPage` run rows vs `ProjectCard`)
- **[MED] Code/file references are styled three different ways.** Blue underlined links (Capabilities — clearest), dark monospace chips (onboarding reader body), and inert muted parentheticals (reader receipts). A reader can't tell which file references are clickable. *Fix:* one treatment for "clickable code reference" (the blue-link pattern) app-wide.
- **[LOW] Aggressive truncation from redundant prefixes.** Architecture nodes read "Backend · Mo…", "Backend · Configur…"; workflow steps "getInstalla…", "downloadZip…". The distinguishing part gets cut because a repeated "Backend · " prefix eats the width. *Fix:* drop the cluster prefix inside a cluster (or widen the node/allow two lines). (graph `ModuleNode`, workflow step nodes)
- **[LOW] A node is mis-tagged in Architecture.** "Backend · Modules" carries a purple **"FRONTEND UI"** tag — the category label contradicts the name and looks wrong to a reader. (data/classification, but surfaces visually)

---

## Layout & spacing findings

- **[MED] Content floats in a wide empty canvas on several core screens.** Dashboard, Import, Overview, and Project Settings put a ~640px column against a large empty right half (and Import centers a small card in an ocean of dark). It reads as unbalanced/unfinished. **Capabilities proves the app can fill the width** (clean 2-column grid) — the pattern just isn't applied consistently. *Fix:* widen content, adopt the 2-column card grid where there's a list, or center-balance the single-column pages.
- **[MED] The onboarding reader has a ~200px empty left gutter** between the section rail and the prose, so the reading column looks misaligned with the nav and the receipts have nowhere to live. *Fix:* either dock a persistent receipts/source panel in that gutter, or pull the prose left to sit against the section rail.
- **[LOW] The landing hero is sparse.** Big bold headline, then a lot of empty vertical space and no product imagery/screenshot — it under-sells a visually rich product. *Fix:* add a product screenshot or a small live graph preview to the hero.
- **[LOW] Near-empty screens don't degrade gracefully.** With one project, Dashboard/List show a single card adrift above a large void. *Fix:* constrain max-width or add a right-column module (getting-started checklist, tips) so sparse states feel intentional.

---

## What works well (keep it)

- **Capabilities screen** — the best-composed page: fills the width, strong hierarchy ("When you'll touch it" / "START HERE" / "FLOWS THAT DELIVER IT" / "WHERE THE CODE LIVES"), blue file links that clearly read as clickable, category tags. Use it as the template for the others.
- **Onboarding reader typography** — clear heading hierarchy, readable body, tasteful monospace code chips, green "High Confidence" — the actual reading experience is good.
- **Dark-theme text contrast** — AA/AAA on every pair; genuinely excellent legibility.
- **Semantic color discipline** — "4 low confidence" in red, confidence badges in green, category tags as colored-text-on-soft-tint — meaningful, consistent, restrained.
- **Information density done right** — the mono `main@9f4d168 · 289 files · 1305 symbols · 66 workflows` header and the run-history cost/latency breakdown are the kind of detail engineers trust.

---

## Priority recommendations

1. **Lift the dark canvas and fix structural contrast** (biggest perceived-quality win): raise `--background`/`--card` a few L\* points and strengthen `--border`/`--input` so cards, inputs, and dividers actually separate (target ≥3.0 vs their surface). This single change addresses "too dark," "flat panels," and "invisible inputs" at once.
2. **Fix the avatar and light-soft-chip contrast** — darker avatar fills; darker light-mode semantic tokens or `foreground` chip text.
3. **Standardize completion color (green) and code-reference styling (blue links)**, and make receipt references real links.
4. **Apply the Capabilities-style full-width layout** to Dashboard/Overview/Settings; close the reader's empty gutter.
5. **Kill the idle "Analyzing" spinner, de-linkify the "Complete" status, and format long durations.**

### Count by severity

| Severity | Count |
|----------|-------|
| High     | 2     |
| Medium   | 9     |
| Low      | 9     |
| **Total**| **20**|

*The two High items (dark structural contrast, avatar legibility) are measured, not subjective. Fixing recommendation #1 is the highest leverage — it's a token change, not a redesign, and it lifts the whole app's perceived polish.*
