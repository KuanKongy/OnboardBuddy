import { apiFetch } from "@/lib/api";
import { MOCK_ONBOARDING_PACKAGES } from "@/lib/mockOnboardingData";
import type { OnboardingPackage } from "@/types/onboarding";

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
