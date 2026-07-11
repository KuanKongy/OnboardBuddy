import { apiFetch } from "@/lib/api";
import { MOCK_ONBOARDING_PACKAGES } from "@/lib/mockOnboardingData";
import type { OnboardingPackage, PackageCard, SectionId } from "@/types/onboarding";

/** Reading order for the eleven section types. */
export const SECTION_NAV_ORDER: readonly SectionId[] = [
  "start-here",
  "architecture",
  "entry-points",
  "critical-25",
  "capability-map",
  "workflows",
  "role-path",
  "data-schema",
  "safety-rails",
  "dependency-graph",
  "doc-health",
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
  role: string,
): Promise<OnboardingPackage | null> {
  try {
    const data = await apiFetch(
      `/projects/${projectId}/onboarding?role=${encodeURIComponent(role)}`,
    );
    return (data.package ?? data) as OnboardingPackage;
  } catch {
    if (import.meta.env.DEV) {
      const mock = MOCK_ONBOARDING_PACKAGES[role];
      return mock ? { ...mock, projectId } : null;
    }
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
