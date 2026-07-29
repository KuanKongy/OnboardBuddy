import { apiFetch } from "@/lib/api";
import { FALLBACK_ROLE, isDeveloperRole, type DeveloperRole } from "@/lib/roles";
import type { OnboardingPackage, PackageCard, SectionId } from "@/types/onboarding";

/** Shelf order for the 12 Diátaxis sections (chapter order). */
export const SECTION_NAV_ORDER: readonly SectionId[] = [
  "big-picture",
  "concepts",
  "architecture-deep",
  "traced-flows",
  "code-map",
  "capabilities",
  "setup-run",
  "first-change",
  "common-tasks",
  "routes-jobs",
  "data-model",
  "guardrails-ops",
];

/**
 * The four Diátaxis chapters (mode-first shelf) with their overview blurbs
 * ("chapter headers are overviews, not link lists"). The legacy tail keeps
 * packages generated before the redesign navigable until they regenerate.
 */
export const SECTION_GROUPS: ReadonlyArray<{ label: string; blurb?: string; ids: readonly SectionId[] }> = [
  {
    label: "Orient",
    blurb: "What this system is and the vocabulary it thinks in — read first.",
    ids: ["big-picture", "concepts"],
  },
  {
    label: "Understand",
    blurb: "Subsystems, end-to-end flows, the files that matter, and what the product does.",
    ids: ["architecture-deep", "traced-flows", "code-map", "capabilities"],
  },
  {
    label: "Do",
    blurb: "Hands on: run it, make your first change, follow this repo's recipes.",
    ids: ["setup-run", "first-change", "common-tasks"],
  },
  {
    label: "Consult",
    blurb: "Lookup tables from code facts — routes, data model, guardrails.",
    ids: ["routes-jobs", "data-model", "guardrails-ops"],
  },
  {
    label: "Previous layout",
    ids: [
      "start-here", "architecture", "entry-points", "critical-25", "capability-map",
      "workflows", "role-path", "data-schema", "safety-rails", "dependency-graph", "doc-health",
    ],
  },
];

/**
 * Role reading order (the plan's "reading order ≠ shelf order"): journeys
 * interleave modes — a new joiner does something on day one, then studies.
 * Roles reorder emphasis; content is identical.
 *
 * Typed by `DeveloperRole` so a new role cannot be added to the union without
 * an order to read it in, and `general` is one key among five rather than a
 * hardcoded fallback (doc/REWORK_PLAN.md Phase 10). Every column is a
 * permutation of the same 12 sections — nothing is hidden from any role; a
 * role that drops a section from its rail would be a role that never learns
 * it exists.
 */
export const ROLE_READING_ORDER: Record<DeveloperRole, readonly SectionId[]> = {
  // The superset reader: orient, run it, then study in shelf order.
  general: [
    "big-picture", "setup-run", "concepts", "traced-flows", "first-change",
    "code-map", "common-tasks", "architecture-deep", "capabilities",
    "routes-jobs", "data-model", "guardrails-ops",
  ],
  // Route table and schema are day-one lookups for someone adding an endpoint,
  // so they come before the wider architecture reading.
  backend: [
    "big-picture", "setup-run", "concepts", "traced-flows", "first-change",
    "code-map", "routes-jobs", "data-model", "common-tasks", "architecture-deep",
    "capabilities", "guardrails-ops",
  ],
  // Flows before vocabulary: a UI developer meets the system through a page
  // that already works. `routes-jobs` moves up to 8th (general has it 10th) —
  // it is the contract their components call, not a reference-shelf lookup.
  frontend: [
    "big-picture", "setup-run", "traced-flows", "concepts", "first-change",
    "code-map", "common-tasks", "routes-jobs", "capabilities",
    "architecture-deep", "data-model", "guardrails-ops",
  ],
  // Guardrails third: an operator's first question is what can be turned off
  // and what it costs, and topology comes before any single flow.
  devops: [
    "big-picture", "setup-run", "guardrails-ops", "concepts", "architecture-deep",
    "traced-flows", "routes-jobs", "first-change", "code-map", "common-tasks",
    "capabilities", "data-model",
  ],
  // Recipes third: the test-writing recipe is the fastest route to a first
  // useful contribution, and the traced flows are the surfaces to cover.
  qa: [
    "big-picture", "setup-run", "common-tasks", "traced-flows", "first-change",
    "concepts", "routes-jobs", "code-map", "capabilities", "architecture-deep",
    "data-model", "guardrails-ops",
  ],
};

/** One-liner "why you specifically" per section, shown in the suggested rail. */
export const SECTION_WHY: Partial<Record<SectionId, string>> = {
  "big-picture": "The 10-minute map — everything else refers back to it.",
  "setup-run": "Get it running on day one; every later section assumes you can.",
  "concepts": "The nouns you need before any code review makes sense.",
  "traced-flows": "The product's real end-to-end paths, hop by hop.",
  "first-change": "A safe, verified change to break the ice.",
  "code-map": "The files you'll actually open, grouped by subsystem.",
  "common-tasks": "This repo's recipes for the changes you'll make weekly.",
  "architecture-deep": "Why the system is shaped this way — decisions and tensions.",
  "capabilities": "What the product does for users, mapped to the code.",
  "routes-jobs": "Look up any route, queue, or webhook.",
  "data-model": "Tables, relationships, and who touches them.",
  "guardrails-ops": "Budgets, kill switches, env config — before you operate it.",
};

/**
 * Per-role overlay on `SECTION_WHY` — the copywriting half of role
 * differentiation (doc/ROLE_DIFFERENTIATION_PLAN.md: "Role belongs in *order*
 * … and in per-role `SECTION_WHY` overlay strings").
 *
 * Deliberately an overlay and not a full table: sections are shared, cached
 * artifacts, so the only thing a role may change about a section is why THIS
 * reader is being sent to it. A role overrides a line only where its reason
 * genuinely differs from the general one; everything else falls through, so
 * there is exactly one copy of every sentence a role does not need to change.
 */
export const ROLE_SECTION_WHY: Partial<Record<DeveloperRole, Partial<Record<SectionId, string>>>> = {
  backend: {
    "routes-jobs": "Every endpoint and queue you will extend — the surface you own.",
    "data-model": "The tables your handlers write, and the constraints that will reject you.",
    "traced-flows": "Where a request becomes a job and a job becomes rows.",
    "code-map": "The handlers, workers and services you will open first.",
    "guardrails-ops": "The budgets and kill switches your code has to respect.",
  },
  frontend: {
    "routes-jobs": "The API surface your components call — payloads, methods, mounted paths.",
    "capabilities": "What users can do, and which screen delivers each one.",
    "traced-flows": "What happens after your click, all the way to the write.",
    "code-map": "The pages, components and hooks you will open first.",
    "data-model": "The shapes behind the JSON your views render.",
  },
  devops: {
    "guardrails-ops": "Budgets, kill switches, secrets and env config — your first read, not your last.",
    "setup-run": "The services, ports and env this repo actually needs to boot.",
    "architecture-deep": "Process topology and boundaries — what runs where, and what crosses.",
    "routes-jobs": "The queues and workers you will scale, and the routes you will front.",
    "code-map": "The config, compose and pipeline files that decide how it runs.",
  },
  qa: {
    "common-tasks": "The repo's own test recipes — the pattern to copy, not invent.",
    "traced-flows": "The end-to-end paths worth covering, with their effect steps named.",
    "first-change": "Your first change is a test: the missing assertion on a real flow.",
    "routes-jobs": "Every endpoint that needs a case, in one table.",
    "capabilities": "What the product promises — the acceptance criteria behind each promise.",
  },
};

/**
 * The role's reading order, falling back to the superset role.
 *
 * `pkg.role` arrives from the API as a plain string, so indexing the record
 * with it directly is an implicit `any` — which then leaked into every
 * callback over the result (5 `noImplicitAny` errors at the one call site).
 * `isDeveloperRole` narrows it against the one role list.
 */
export function readingOrderFor(role: string | null | undefined): readonly SectionId[] {
  return ROLE_READING_ORDER[isDeveloperRole(role) ? role : FALLBACK_ROLE];
}

/**
 * The role's line for a section, falling back to the shared one — the
 * `SECTION_WHY` overlay resolved for one reader.
 */
export function sectionWhy(sectionId: SectionId, role: string | null | undefined): string | undefined {
  const overlay = isDeveloperRole(role) ? ROLE_SECTION_WHY[role]?.[sectionId] : undefined;
  return overlay ?? SECTION_WHY[sectionId];
}

/**
 * Load one onboarding package. **Rejects** when the request fails.
 *
 * Bug #68: this used to `catch { return null }`, and the comment called that
 * "the honest missing state" — it is the opposite. Absence is not an error
 * here and never was: when a role has no package the API answers `200` with
 * `{ package: { status: "missing", sections: [] } }` (api/routes/onboarding.ts).
 * So `null` only ever meant "the request failed", and the reader rendered it
 * as *"No package for Backend — Generate for Backend"*. A 500 or a dropped
 * connection told the user their existing package did not exist and offered
 * them a **billed** generation to rebuild something that was already there.
 * Errors now propagate and each caller decides; only `status: "missing"`
 * reaches the empty state.
 */
export async function fetchOnboardingPackage(
  projectId: string,
  opts: { role?: string; packageId?: string | null },
): Promise<OnboardingPackage> {
  // An explicit package id pins the exact package; role is the legacy
  // "latest for role" path.
  const qs = opts.packageId
    ? `?package_id=${encodeURIComponent(opts.packageId)}`
    : opts.role
      ? `?role=${encodeURIComponent(opts.role)}`
      : "";
  const data = await apiFetch(`/projects/${projectId}/onboarding${qs}`);
  return (data.package ?? data) as OnboardingPackage;
}

export async function fetchPackageCards(projectId: string): Promise<PackageCard[]> {
  const data = await apiFetch(`/projects/${projectId}/onboarding/packages`);
  return (data.packages ?? []) as PackageCard[];
}

/** Queues regeneration of one section; stale sections rebuild against the newest snapshot. */
export async function regenerateSection(projectId: string, sectionId: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/onboarding/sections/${sectionId}/regenerate`, {
    method: "POST",
  });
}

/**
 * Bug #36: queues regeneration of ONE tutorial. Same contract as
 * `regenerateSection` — a stale tutorial rebuilds against the newest complete
 * snapshot of its scope, and the rest of the package is neither rebuilt nor
 * paid for.
 */
export async function regenerateTutorial(projectId: string, tutorialId: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/tutorials/${tutorialId}/regenerate`, {
    method: "POST",
  });
}
