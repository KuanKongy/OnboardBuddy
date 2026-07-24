# Diátaxis notes & evaluation rubric

Condensed from a full read of https://diataxis.fr (all pages, 2026-07-24). Purpose: the standing reference for writing OnboardBuddy's section specs and for **evaluating generated onboarding packages** — after any content evaluation, score findings against the rubric at the bottom.

## The framework in one table

Two axes: **action ↔ cognition** (doing vs knowing) × **acquisition ↔ application** (study vs work). Four modes, one per quadrant — the matrix is *complete*: every documentation need falls in exactly one quadrant, which is why there are four modes, not three or five.

| Mode | Quadrant | Answers | Serves | Analogy |
| --- | --- | --- | --- | --- |
| **Tutorial** | action × acquisition | "Can you teach me to…?" | a *learner* at study | teaching a child to cook |
| **How-to guide** | action × application | "How do I…?" | a *competent practitioner* at work | a recipe |
| **Reference** | cognition × application | "What is…?" | a worker needing *certainty* | a map; food-packaging info |
| **Explanation** | cognition × acquisition | "Why…?" | a learner in *reflection* | culinary-history reading |

**The compass** (when unsure where content belongs): does it inform *action* or *cognition*? does it serve *acquisition* or *application*? The two answers name the quadrant. Apply at any granularity — a sentence can be in the wrong quadrant.

**User journey**: learning → goal-pursuit → information-seeking → reflection → deeper learning. Readers enter anywhere, but expertise grows by cycling. (Implication for onboarding: interleave — a new joiner needs a tutorial *early*, not after all the explanation.)

## Per-mode writing rules (spec-level requirements)

### Tutorial (setup_run, first_change, guided tours)
- The teacher carries ALL responsibility; the learner's only job is to follow. **Every promised result must occur, reliably** — no step that can fail silently.
- Concrete over abstract; a single unbranching path; no options, alternatives, or "you could also…".
- Visible results early and often (build cause-and-effect confidence); verify checkpoint after every step: "The output should look like…".
- **Minimal explanation** — one basic sentence at most, then LINK out; "a tutorial is not the place for explanation."
- Language: first-person plural ("In this tutorial, we will…"), unambiguous imperatives ("First, do x. Now, do y."), running commentary ("Notice that…", "Remember that…"), close by naming what they accomplished.
- Anti-patterns: abstraction, generalization, choices, teaching principles before practice.

### How-to guide (common_tasks)
- For someone who already knows what they want; **assume competence** — never explain basics, never teach.
- Address a real-world goal, not a feature: guides are "about goals, projects and problems, not about tools." Title states the goal: "How to add an API route."
- Sequence for flow; branch where reality branches ("If you need X, do Y") — *conditional imperatives*.
- Practical usability over completeness; link to reference for full option lists.
- Anti-patterns: explanation digressions, novice-level narration, exhaustive option dumps, describing the obvious.

### Reference (routes_jobs, data_model, guardrails_ops)
- "Austere and uncompromising": neutral, factual, complete, consistent. Describe — never instruct, never opine, never market.
- **Structure mirrors the product** (route tables mirror route mounting; table docs mirror schema organization) so users navigate code and docs in parallel.
- Consistency via standard patterns — same fields, same order, every entry (our micro-format: name · one-liner · params · returns · gotcha).
- Examples allowed if purely illustrative; warnings in directive language ("You must…").
- Contamination risk: examples that grow into explanations. Cut and link instead.
- (OnboardBuddy corollary: generate reference facts deterministically from the graph/SQL; the LLM annotates only.)

### Explanation (big_picture, concepts, architecture_deep, traced_flows, capabilities)
- Understanding-oriented, read in *reflection*, away from the keyboard; it "joins things together" so knowledge isn't fragmented.
- **About-ness test**: the title should survive the prefix "About …" ("About the analysis pipeline").
- Bound each piece with an implicit *why* question; resist unbounded scope.
- Make connections, give context and history, explain design decisions and constraints; **admitting opinion and weighing alternatives is proper here** ("W is better than Z because…", "Some prefer X because…, but…").
- Anti-patterns: instruction creep, reference creep, indefinite scope.

## Architecture guidance

- Blur at quadrant boundaries degrades both neighbors; the classic collapse is tutorial↔how-to ("follow these steps" content that neither teaches nor serves a goal).
- The four modes need NOT be top-level nav: choose **mode-first** or **user-first** by whether user experiences genuinely differ. (OnboardBuddy: chapters are mode-first; roles differ in *path*, not content → role reading order is an overlay, which is the user-first dimension.)
- **Landing/contents pages must read like overviews**, not link lists; lists over ~7 items are unreadable without inherent order. (Chapters: 2–4 sections each ✓; chapter headers carry an intro blurb, not just links.)
- Apply iteratively, "from the inside": pick a piece → assess → one smallest improvement → publish → repeat. Never build empty scaffolding first.

## Quality model (the evaluation frame)

**Functional quality** — measurable, independent constraints; failing any is failing:
accuracy (matches the system) · completeness · consistency · usefulness · precision.
**Deep quality** — unmeasurable but recognizable, interdependent: flow, fit to real needs, anticipation of expectations, pleasantness. **Deep quality is conditional on functional quality** — inaccurate docs cannot be "nice to read" into goodness.
Diátaxis's role: it *exposes* functional lapses (structure makes gaps visible) and *enables* deep quality (mode purity protects rhythm and fit); it does not substitute for domain knowledge or skilled writing.

OnboardBuddy mapping: functional quality is what our machinery enforces (receipts, citation validator, critique, deterministic reference facts, staleness); deep quality is what the redesign buys (mode purity, journey-ordered reading, anchor diagrams, depth contracts).

## Post-evaluation rubric (use this after every content eval)

Per section, in order:
1. **Quadrant check (compass)**: which single need does this section serve? Does every paragraph belong to that quadrant? Flag mode-blends with the specific sentences.
2. **Functional gates** (hard fails): accuracy — claims match receipts/code; completeness — covers what its purpose promises at the repo's scale; consistency — micro-formats and terminology uniform; precision — no vague filler ("handles business logic").
3. **Mode-specific tests**:
   - Tutorial: could a newcomer succeed unattended? Does every step verify? Any explanation longer than a sentence? Any forks?
   - How-to: does the title name a real goal? Would a competent dev find any sentence patronizing or any digression skippable?
   - Reference: is it austere? Does structure mirror the product? Is any sentence an instruction or opinion? Would regeneration produce the same tables?
   - Explanation: does it pass the about-ness test? Does it say *why* (decisions, trade-offs, constraints) or merely re-describe? Does it link out instead of absorbing reference/instruction?
4. **Journey fit**: does the section's position in the role reading order match when the reader actually needs it?
5. **Deep-quality impressions** (only if functional passed): does it flow? Does it anticipate the reader's next question? Would you enjoy reading it?
6. **Verdict per finding**: name the smallest single change that produces an immediate improvement (Diátaxis workflow), not a rewrite wish-list.
