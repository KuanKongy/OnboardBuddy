import { apiFetch } from "@/lib/api";
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
 */
export const ROLE_READING_ORDER: Record<string, readonly SectionId[]> = {
  general: [
    "big-picture", "setup-run", "concepts", "traced-flows", "first-change",
    "code-map", "common-tasks", "architecture-deep", "capabilities",
    "routes-jobs", "data-model", "guardrails-ops",
  ],
  backend: [
    "big-picture", "setup-run", "concepts", "traced-flows", "first-change",
    "code-map", "routes-jobs", "data-model", "common-tasks", "architecture-deep",
    "capabilities", "guardrails-ops",
  ],
  frontend: [
    "big-picture", "setup-run", "traced-flows", "concepts", "first-change",
    "code-map", "common-tasks", "capabilities", "architecture-deep",
    "routes-jobs", "data-model", "guardrails-ops",
  ],
  devops: [
    "big-picture", "setup-run", "guardrails-ops", "concepts", "architecture-deep",
    "traced-flows", "routes-jobs", "first-change", "code-map", "common-tasks",
    "capabilities", "data-model",
  ],
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

export const ROLES = [
  { key: "backend", label: "Backend Developer" },
  { key: "frontend", label: "Frontend Developer" },
  { key: "devops", label: "DevOps Engineer" },
  { key: "qa", label: "QA Engineer" },
  { key: "general", label: "General" },
];

export async function fetchOnboardingPackage(
  projectId: string,
  opts: { role?: string; packageId?: string | null },
): Promise<OnboardingPackage | null> {
  try {
    // An explicit package id pins the exact package; role is the legacy
    // "latest for role" path.
    const qs = opts.packageId
      ? `?package_id=${encodeURIComponent(opts.packageId)}`
      : opts.role
        ? `?role=${encodeURIComponent(opts.role)}`
        : "";
    const data = await apiFetch(`/projects/${projectId}/onboarding${qs}`);
    return (data.package ?? data) as OnboardingPackage;
  } catch {
    // No mock fallback: a failed load shows the honest missing state.
    return null;
  }
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
