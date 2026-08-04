/**
 * The developer roles, in one place.
 *
 * There were five copies of this list — `onboardingData.ts`,
 * `AnalyzeConfigForm.tsx`, `ImportPage.tsx`, `InvitationsPage.tsx`, and a set
 * of hardcoded `<SelectItem>`s in `ProjectSettingsPage.tsx` — and they had
 * already drifted: three field names for the same key (`key` / `value` /
 * neither), and three different labels for the same role ("QA", "QA Engineer",
 * "QA Automation"). A user could pick "QA Automation" on an invitation and be
 * shown "QA Engineer" on the package it generated.
 *
 * `DEVELOPER_ROLES` mirrors `DeveloperRole` in
 * `backend/src/worker/semantic/projections.ts`, which is the schema the API
 * validates against and the key of `DEFAULT_ROLE_WEIGHTS`. Adding a role means
 * changing both, in that order — and nothing here may assume `general` is the
 * only role a surface can be built for (doc/REWORK_PLAN.md Phase 10).
 *
 * Two label registers, because the same role is named in two voices and
 * flattening them would make one of the two read wrong:
 *   - `label` — the short filter word in a form control ("Backend").
 *   - `title` — the person, where the role names a reader ("Backend Developer").
 *
 * Both registers are display text and can be reworded. The VALUES cannot: they
 * are stored in Postgres, validated by the API and keyed on by the weight
 * table, so `general` stays `general` on the wire while it reads "Full-stack"
 * on screen. Rendering a stored value raw (or through CSS `capitalize`, which
 * would write "Full-Stack") is what these helpers exist to prevent.
 */

export const DEVELOPER_ROLES = ["backend", "frontend", "devops", "qa", "general"] as const;

export type DeveloperRole = (typeof DEVELOPER_ROLES)[number];

export interface RoleOption {
  value: DeveloperRole;
  /** Short form for form controls and filters. */
  label: string;
  /** Long form where the role names a person or a package's audience. */
  title: string;
  /** One line on what the role owns — shown where a chooser needs context. */
  description: string;
}

export const ROLE_OPTIONS: readonly RoleOption[] = [
  { value: "backend", label: "Backend", title: "Backend Developer", description: "Server-side logic & APIs" },
  { value: "frontend", label: "Frontend", title: "Frontend Developer", description: "UI & client-side code" },
  { value: "devops", label: "DevOps", title: "DevOps Engineer", description: "Infrastructure & deployments" },
  { value: "qa", label: "QA", title: "QA Engineer", description: "Testing & quality assurance" },
  { value: "general", label: "Full-stack", title: "Full-stack Developer", description: "The whole stack, end to end" },
];

/**
 * What a surface falls back to when a package predates roles or names one this
 * build does not know. It is the SUPERSET role, not a default: nothing may use
 * it as the role to rank, score or generate for (doc/REWORK_PLAN.md Phase 10 —
 * "nothing in Phases 1–7 may hardcode `general`").
 *
 * It reads as "Full-stack" everywhere a person sees it; the stored value is
 * frozen, so use this constant rather than typing the value into a surface.
 */
export const FALLBACK_ROLE: DeveloperRole = "general";

const BY_VALUE = new Map<string, RoleOption>(ROLE_OPTIONS.map((option) => [option.value, option]));

export function isDeveloperRole(value: string | null | undefined): value is DeveloperRole {
  return value != null && BY_VALUE.has(value);
}

/** Short label; unknown roles render as themselves rather than as "Unknown". */
export function roleLabel(role: string | null | undefined): string {
  return (role && BY_VALUE.get(role)?.label) || role || "";
}

/** Long label; unknown roles render as themselves. */
export function roleTitle(role: string | null | undefined): string {
  return (role && BY_VALUE.get(role)?.title) || role || "";
}
