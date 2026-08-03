import { Reveal } from "@/components/intro/Reveal";
import { SECTION_GROUPS, SECTION_NAV_ORDER } from "@/lib/onboardingData";
import { PHASE_ORDER } from "@/lib/pipelinePhases";
import { PRIVACY_MODES } from "@/lib/privacyModes";
import { DEVELOPER_ROLES } from "@/lib/roles";

/**
 * Real numbers, computed from the modules that define them, never typed by
 * hand: a phase or section change updates the marketing (and its unit test)
 * automatically. The legacy "Previous layout" section group has no blurb and
 * is deliberately excluded from the chapter count.
 */
const STATS = [
  { value: PHASE_ORDER.length, label: "pipeline phases" },
  { value: SECTION_NAV_ORDER.length, label: "handbook sections" },
  { value: SECTION_GROUPS.filter((group) => group.blurb).length, label: "chapters" },
  { value: PRIVACY_MODES.length, label: "privacy modes" },
  { value: DEVELOPER_ROLES.length, label: "developer roles" },
] as const;

export function StatStrip() {
  return (
    <section aria-label="Product facts" className="px-4 py-8 sm:px-6">
      <Reveal className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-12 gap-y-5">
        {STATS.map((stat) => (
          <div key={stat.label} className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">{stat.value}</span>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {stat.label}
            </span>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
