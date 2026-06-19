import { apiFetch } from "@/lib/api";
import { MOCK_ONBOARDING_PACKAGES } from "@/lib/mockOnboardingData";
import type { OnboardingPackage } from "@/types/onboarding";

// Attempts the real onboarding endpoint, falling back to mock data while the
// backend route is still pending (there is no GET /projects/:id/onboarding yet).
// Once the analysis pipeline ships that endpoint, this starts returning real
// packages with no further frontend changes.
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
    // Endpoint not live yet — fall back to mock so the UI still renders.
    const mock = MOCK_ONBOARDING_PACKAGES[role];
    return mock ? { ...mock, projectId } : null;
  }
}
