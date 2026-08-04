import { Search, Shield, Wallet } from "lucide-react";
import { IconRow } from "@/components/intro/IconRow";
import { Reveal } from "@/components/intro/Reveal";
import { SectionShell } from "@/components/intro/SectionShell";

/** Mirrors DEPTH_BUDGET_DEFAULTS in ProjectSettingsPage.tsx (which mirrors
 *  backend engine/budgets.ts). Hardcoded rather than imported: the landing
 *  page must not pull the authed settings page into its import graph. */
const DEPTH_BUDGETS = [
  { depth: "Cheap", calls: "100 AI calls", tokens: "1M tokens" },
  { depth: "Standard", calls: "300 AI calls", tokens: "4M tokens" },
  { depth: "Full", calls: "1,500 AI calls", tokens: "20M tokens" },
];

export function CostSection() {
  return (
    <SectionShell
      id="costs"
      eyebrow="Transparent costs"
      title="No run spends money without saying so"
      deck="Every AI call is counted, priced and attributed before, during and after a run."
    >
      <div className="grid gap-4 md:grid-cols-5">
        <Reveal className="md:col-span-3">
          <div className="h-full rounded-xl border border-foreground/10 bg-card/70 p-6 backdrop-blur-sm transition-colors duration-300 hover:border-[#2659f4]/30 hover:bg-card dark:border-white/10">
            <ul className="space-y-3.5">
              <IconRow icon={<Wallet className="h-4 w-4" aria-hidden="true" />}>
                A preflight preview prices the run at import time: analyzable files, estimated AI
                calls and a cost tier, before anything starts.
              </IconRow>
              <IconRow icon={<Shield className="h-4 w-4" aria-hidden="true" />}>
                A budget caps each run before it starts; a run that would exceed its budget pauses
                instead of overspending.
              </IconRow>
              <IconRow icon={<Search className="h-4 w-4" aria-hidden="true" />}>
                Every run carries its own cost, AI call count and token counts in the run history,
                and the project's total spend is always visible in its settings.
              </IconRow>
            </ul>
          </div>
        </Reveal>
        <Reveal index={1} className="md:col-span-2">
          <div className="h-full rounded-xl border border-foreground/10 bg-card/70 p-6 backdrop-blur-sm transition-colors duration-300 hover:border-[#2659f4]/30 hover:bg-card dark:border-white/10">
            <p className="section-label mb-4">Budget defaults by depth</p>
            <div className="space-y-2.5">
              {DEPTH_BUDGETS.map((row) => (
                <div
                  key={row.depth}
                  className="flex items-center justify-between rounded-lg border border-foreground/10 px-3.5 py-2.5 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#2659f4]/30 dark:border-white/10"
                >
                  <span className="text-[0.8125rem] font-semibold text-foreground">{row.depth}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.calls} &middot; {row.tokens}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}
