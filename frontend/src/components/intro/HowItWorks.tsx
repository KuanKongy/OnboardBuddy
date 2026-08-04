import { GitBranch, Users, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { Reveal } from "@/components/intro/Reveal";
import { SectionShell } from "@/components/intro/SectionShell";

export function HowItWorks() {
  return (
    <SectionShell
      id="how"
      eyebrow="How it works"
      title="Three steps, no surprises"
      deck="Nothing is analyzed until you press Start, and nothing is claimed without a citation."
    >
      <Reveal className="relative">
        {/* The connecting line draws itself once the section reveals; the
            arbitrary variant keys off the Reveal wrapper gaining .reveal-in. */}
        <div
          aria-hidden="true"
          className="absolute left-[16%] right-[16%] top-6 hidden h-px origin-left scale-x-0 bg-gradient-to-r from-[#2659f4]/50 via-[#7c66f0]/40 to-[color:var(--node-ui)]/50 transition-transform duration-1000 ease-out [transition-delay:350ms] sm:block [.reveal-in_&]:scale-x-100"
        />
        <div className="grid gap-10 sm:grid-cols-3 sm:gap-6">
          <Step
            n={1}
            icon={<GitBranch className="h-5 w-5" aria-hidden="true" />}
            title="Connect a repository"
          >
            Install the GitHub App and pick a repository and branch. Read-only access, secrets
            filtered, and nothing runs until you press Start.
          </Step>
          <Step
            n={2}
            icon={<Workflow className="h-5 w-5" aria-hidden="true" />}
            title="The pipeline runs"
          >
            Deterministic phases parse the code, build the evidence graph and trace workflows
            before any model is asked. A cost preview comes first; a budget caps every run.
          </Step>
          <Step n={3} icon={<Users className="h-5 w-5" aria-hidden="true" />} title="Your team reads">
            Each developer gets a role-based handbook with tutorials and maps, versioned per
            commit and marked stale when the code moves on.
          </Step>
        </div>
      </Reveal>
    </SectionShell>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="group relative text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-foreground/10 bg-card text-primary shadow-sm transition-colors duration-300 group-hover:border-[#2659f4]/40 group-hover:bg-card/80 dark:border-white/10">
        {icon}
      </div>
      <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-primary">Step {n}</p>
      <h3 className="mb-1.5 text-[0.9375rem] font-semibold text-foreground">{title}</h3>
      <p className="mx-auto max-w-xs text-[0.875rem] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
