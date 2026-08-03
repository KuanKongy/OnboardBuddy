import { FileCode2 } from "lucide-react";
import type { ReactNode } from "react";
import { Reveal } from "@/components/intro/Reveal";
import { SectionShell } from "@/components/intro/SectionShell";

/**
 * Real output shapes with real citations: the file:line values below point at
 * actual lines in this repository (the dogfood run's own numbers). Chips are
 * spans without title attributes: there is no snapshot behind the landing
 * page, and the audit census counts [title] elements as controls.
 */
export function ShowcaseSection() {
  return (
    <SectionShell
      id="showcase"
      eyebrow="See what you get"
      title="A page of the handbook, a step of a tutorial"
      deck="Example output from OnboardBuddy analyzing its own repository."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Reveal>
          <div className="h-full rounded-xl border border-foreground/10 bg-card/70 p-5 backdrop-blur-sm dark:border-white/10">
            <p className="section-label mb-3">Package section &middot; Backend architecture</p>
            <div className="mb-3 rounded-md border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-foreground">
              <span className="mr-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-primary/80">
                TL;DR
              </span>
              Analysis never runs inside a request; the API enqueues a job and a worker process
              executes the pipeline.
            </div>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              Starting an analysis writes a job row and pushes it onto the analysis queue{" "}
              <Citation file="queue.ts" line={56} />. The worker picks it up{" "}
              <Citation file="index.ts" line={288} /> and runs the phases in order, deterministic
              first <Citation file="evidenceGraphBuilder.ts" line={52} />, recording each one's
              status and spend as it goes.
            </p>
          </div>
        </Reveal>

        <Reveal index={1}>
          <div className="h-full rounded-xl border border-foreground/10 bg-card/70 p-5 backdrop-blur-sm dark:border-white/10">
            <p className="section-label mb-3">Tutorial &middot; 3 of 6 in the package</p>
            <h3 className="mb-4 text-[0.9375rem] font-semibold text-foreground">
              Resume analysis job and export onboarding package
            </h3>
            <ol className="space-y-3">
              <SampleStep n={1} file="projects.ts" line={837}>
                The API verifies the job's status and the caller's role, then re-enqueues it.
              </SampleStep>
              <SampleStep n={2} file="index.ts" line={288}>
                The worker consumes the job from the analysis queue and resumes the pipeline at the
                phase it stopped on.
              </SampleStep>
              <SampleStep n={3} file="sectionValidator.ts" line={11}>
                Every citation in the package is re-checked against the snapshot before it can be
                exported.
              </SampleStep>
            </ol>
          </div>
        </Reveal>
      </div>

      <Reveal index={2}>
        <p className="mt-6 text-center text-[0.8125rem] text-muted-foreground">
          That run produced <span className="font-semibold text-foreground">12 sections</span>,{" "}
          <span className="font-semibold text-foreground">6 tutorials</span>, and{" "}
          <span className="font-semibold text-foreground">103 traced workflows</span>.
        </p>
      </Reveal>
    </SectionShell>
  );
}

function Citation({ file, line }: { file: string; line: number }) {
  return (
    <span className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-foreground/15 bg-muted/40 px-1.5 py-0.5 align-baseline font-mono text-[0.6875rem] text-foreground dark:border-white/15">
      <FileCode2 className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {file}:{line}
    </span>
  );
}

function SampleStep({ n, file, line, children }: { n: number; file: string; line: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[0.6875rem] font-semibold text-muted-foreground">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{children}</p>
        <div className="mt-1.5">
          <Citation file={file} line={line} />
        </div>
      </div>
    </li>
  );
}
