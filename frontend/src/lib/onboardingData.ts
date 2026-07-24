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
 * The four Diátaxis chapters (mode-first shelf). The legacy tail keeps
 * packages generated before the redesign navigable until they regenerate.
 */
export const SECTION_GROUPS: ReadonlyArray<{ label: string; ids: readonly SectionId[] }> = [
  { label: "Orient", ids: ["big-picture", "concepts"] },
  { label: "Understand", ids: ["architecture-deep", "traced-flows", "code-map", "capabilities"] },
  { label: "Do", ids: ["setup-run", "first-change", "common-tasks"] },
  { label: "Consult", ids: ["routes-jobs", "data-model", "guardrails-ops"] },
  {
    label: "Previous layout",
    ids: [
      "start-here", "architecture", "entry-points", "critical-25", "capability-map",
      "workflows", "role-path", "data-schema", "safety-rails", "dependency-graph", "doc-health",
    ],
  },
];

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
