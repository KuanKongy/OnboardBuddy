import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEVELOPER_ROLES,
  FALLBACK_ROLE,
  ROLE_OPTIONS,
  isDeveloperRole,
  roleLabel,
  roleTitle,
} from "@/lib/roles";
import { ROLE_READING_ORDER, ROLE_SECTION_WHY, SECTION_NAV_ORDER, readingOrderFor, sectionWhy } from "@/lib/onboardingData";

/**
 * Every surface that offers a role must offer the SAME roles.
 *
 * This used to be six lists in six files with three field names and three
 * labels per role, and the drift was invisible because each list rendered
 * correctly on its own screen. A runtime assertion cannot catch a seventh copy
 * appearing next week, so the consumers are checked at the source level: each
 * must import the shared module, and none may carry a role list of its own.
 * That is the only form of this test that fails when someone re-forks the list.
 */
const CONSUMERS = [
  "src/lib/onboardingData.ts",
  "src/components/AnalyzeConfigForm.tsx",
  "src/pages/ImportPage.tsx",
  "src/pages/ProjectSettingsPage.tsx",
  "src/pages/InvitationsPage.tsx",
  "src/pages/TeamPage.tsx",
  "src/pages/OnboardingPage.tsx",
  "src/pages/ProjectOverviewPage.tsx",
  "src/components/PackageSelector.tsx",
  "src/components/ProvenancePanel.tsx",
  "src/pages/DashboardPage.tsx",
];

/** Vitest runs with the package root as cwd (vite.config.ts lives there). */
const sourceOf = (relPath: string): string => readFileSync(resolve(process.cwd(), relPath), "utf8");

describe("developer roles — one list", () => {
  it("exposes exactly the roles the backend weight table knows", () => {
    // Mirrors DeveloperRole in backend/src/worker/semantic/projections.ts.
    expect([...DEVELOPER_ROLES]).toEqual(["backend", "frontend", "devops", "qa", "general"]);
    expect(ROLE_OPTIONS.map((o) => o.value)).toEqual([...DEVELOPER_ROLES]);
    expect(new Set(ROLE_OPTIONS.map((o) => o.value)).size).toBe(ROLE_OPTIONS.length);
    expect(DEVELOPER_ROLES).toContain(FALLBACK_ROLE);
  });

  it("labels every role in both registers, and passes unknown roles through", () => {
    for (const option of ROLE_OPTIONS) {
      expect(roleLabel(option.value)).toBe(option.label);
      expect(roleTitle(option.value)).toBe(option.title);
      expect(option.description.length).toBeGreaterThan(0);
    }
    expect(roleLabel("mobile")).toBe("mobile");
    expect(roleTitle(null)).toBe("");
    expect(isDeveloperRole("qa")).toBe(true);
    expect(isDeveloperRole("mobile")).toBe(false);
  });

  it("drives every role-offering surface — no file keeps its own list", () => {
    for (const file of CONSUMERS) {
      const source = sourceOf(file);
      expect(source, `${file} must import the shared role module`).toContain('from "@/lib/roles"');
      // A re-forked list, in any of the shapes that existed before: an array
      // of role literals, or hardcoded <SelectItem value="backend">.
      expect(source, `${file} declares its own role list`).not.toMatch(/\{\s*(?:value|key):\s*"(?:backend|frontend|devops|qa|general)"/);
      expect(source, `${file} hardcodes role options`).not.toMatch(/value="(?:backend|frontend|devops|qa)"/);
      // Phase 10 invariant (doc/REWORK_PLAN.md): nothing hardcodes `general`.
      expect(source, `${file} hardcodes the "general" role`).not.toMatch(/"general"/);
    }
  });
});

describe("role reading order and WHY copy", () => {
  it("gives every role a full permutation of the shelf", () => {
    for (const role of DEVELOPER_ROLES) {
      const order = ROLE_READING_ORDER[role];
      expect([...order].sort(), `${role} reading order`).toEqual([...SECTION_NAV_ORDER].sort());
      expect(readingOrderFor(role)).toEqual(order);
    }
    // Unknown / legacy roles fall back to the superset role, not to nothing.
    expect(readingOrderFor("mobile")).toEqual(ROLE_READING_ORDER[FALLBACK_ROLE]);
    expect(readingOrderFor(null)).toEqual(ROLE_READING_ORDER[FALLBACK_ROLE]);
  });

  it("overlays per-role WHY copy on real sections and falls through otherwise", () => {
    for (const [role, overlay] of Object.entries(ROLE_SECTION_WHY)) {
      expect(DEVELOPER_ROLES, `${role} is not a role`).toContain(role);
      for (const [sectionId, line] of Object.entries(overlay ?? {})) {
        expect(SECTION_NAV_ORDER, `${role}/${sectionId}`).toContain(sectionId);
        expect(line).not.toBe(sectionWhy(sectionId as never, FALLBACK_ROLE));
      }
    }
    // An overlaid line differs by role; a non-overlaid one is shared verbatim.
    expect(sectionWhy("routes-jobs", "frontend")).toMatch(/components call/);
    expect(sectionWhy("routes-jobs", "backend")).not.toBe(sectionWhy("routes-jobs", "frontend"));
    expect(sectionWhy("big-picture", "qa")).toBe(sectionWhy("big-picture", FALLBACK_ROLE));
  });
});
