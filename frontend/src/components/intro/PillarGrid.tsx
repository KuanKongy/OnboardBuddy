import { BookOpen, FileCode2, Layers, Network, Route, Terminal } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Reveal } from "@/components/intro/Reveal";
import { SectionShell } from "@/components/intro/SectionShell";
import { CLUSTER_KIND_LABELS, CLUSTER_KIND_PALETTE } from "@/lib/architectureData";
import { SECTION_GROUPS } from "@/lib/onboardingData";
import { cn } from "@/lib/utils";

/** The four real chapters; the legacy blurb-less group is navigation cruft. */
const CHAPTERS = SECTION_GROUPS.filter((group) => group.blurb);

/** Real architecture layer kinds, colored exactly like the architecture map. */
const LAYER_KINDS = ["frontend_ui", "api_layer", "worker_layer", "database_layer"] as const;

export function PillarGrid() {
  return (
    <SectionShell
      id="product"
      eyebrow="What you get"
      title="Six views of a codebase, one source of truth"
      deck="Everything below is generated from the same evidence graph, so the handbook, the maps and the tutorials can never disagree with each other."
    >
      <div className="grid gap-4 md:grid-cols-6">
        <SpotCard index={0} className="md:col-span-4">
          <PillarTitle icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}>
            A handbook, not a wiki
          </PillarTitle>
          <p className="max-w-lg text-[0.875rem] leading-relaxed text-muted-foreground">
            Twelve sections in four chapters, written per role and per analyzed commit. When the
            code moves on, affected sections are marked stale instead of silently rewritten.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {CHAPTERS.map((chapter) => (
              <div
                key={chapter.label}
                className="flex items-baseline justify-between rounded-lg border border-foreground/10 bg-background/50 px-3.5 py-2.5 dark:border-white/10"
              >
                <span className="text-[0.8125rem] font-semibold text-foreground">{chapter.label}</span>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {chapter.ids.length} sections
                </span>
              </div>
            ))}
          </div>
        </SpotCard>

        <SpotCard index={1} className="md:col-span-2">
          <PillarTitle icon={<Network className="h-4 w-4" aria-hidden="true" />}>
            A dependency map you can walk
          </PillarTitle>
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">
            Files and classes grouped by folder, arrows you can follow, entry points marked.
          </p>
          <svg viewBox="0 0 200 88" aria-hidden="true" className="mt-5 w-full">
            <g stroke="color-mix(in oklab, var(--foreground) 22%, transparent)" strokeWidth="1">
              <path d="M46 24 L96 42" />
              <path d="M46 64 L96 46" />
              <path d="M108 40 L156 24" />
              <path d="M108 46 L156 64" />
            </g>
            {(
              [
                [40, 22, "api", true],
                [40, 62, "ui", false],
                [102, 44, "shared", false],
                [162, 22, "data", false],
                [162, 62, "worker", false],
              ] as const
            ).map(([x, y, token, entry]) => (
              <g key={`${x}-${y}`}>
                <circle
                  cx={x}
                  cy={y}
                  r="8"
                  fill={`color-mix(in oklab, var(--node-${token}) 26%, var(--card))`}
                  stroke={`var(--node-${token})`}
                  strokeWidth="1.5"
                />
                {entry ? <path d={`M${x - 2.5} ${y - 3} l5 3 l-5 3 z`} fill={`var(--node-${token})`} /> : null}
              </g>
            ))}
          </svg>
        </SpotCard>

        <SpotCard index={0} className="md:col-span-2">
          <PillarTitle icon={<Layers className="h-4 w-4" aria-hidden="true" />}>
            Architecture, derived
          </PillarTitle>
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">
            Modules clustered into named layers; open one to list its files, most critical first.
          </p>
          <div className="mt-5 space-y-2">
            {LAYER_KINDS.map((kind) => {
              const token = CLUSTER_KIND_PALETTE[kind];
              return (
                <div
                  key={kind}
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
                  style={{
                    borderColor: `color-mix(in oklab, var(--node-${token}) 40%, transparent)`,
                    background: `color-mix(in oklab, var(--node-${token}) 9%, transparent)`,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ background: `var(--node-${token})` }}
                  />
                  <span className="text-xs font-medium text-foreground">{CLUSTER_KIND_LABELS[kind]}</span>
                </div>
              );
            })}
          </div>
        </SpotCard>

        <SpotCard index={1} className="md:col-span-2">
          <PillarTitle icon={<Route className="h-4 w-4" aria-hidden="true" />}>
            Workflows traced end to end
          </PillarTitle>
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">
            From an entry point through every function to its side effects, ranked by how critical
            they are.
          </p>
          <div className="mt-5 space-y-1.5 font-mono text-xs">
            <div className="text-foreground">POST /projects/:id/analyze</div>
            <div className="pl-3 text-muted-foreground">→ enqueueAnalysis()</div>
            <div className="pl-6 text-muted-foreground">→ worker.runPipeline()</div>
            <div className="pl-9 text-primary">⇒ snapshot, spend ledger</div>
          </div>
        </SpotCard>

        <SpotCard index={2} className="md:col-span-2">
          <PillarTitle icon={<Terminal className="h-4 w-4" aria-hidden="true" />}>
            Tutorials that run
          </PillarTitle>
          <p className="text-[0.875rem] leading-relaxed text-muted-foreground">
            Walkthroughs read real code line by line; task guides bring the stack up and prove it.
          </p>
          <div className="mt-5 space-y-1.5">
            <MiniStep label="Do this" mono>
              docker compose up -d
            </MiniStep>
            <MiniStep label="You should see">API answering on :3000/health</MiniStep>
            <MiniStep label="Check it worked" mono>
              curl localhost:3000/health
            </MiniStep>
          </div>
        </SpotCard>

        <SpotCard index={0} className="md:col-span-6">
          <div className="items-start gap-10 md:flex">
            <div className="max-w-md">
              <PillarTitle icon={<FileCode2 className="h-4 w-4" aria-hidden="true" />}>
                Receipts on every claim
              </PillarTitle>
              <p className="text-[0.875rem] leading-relaxed text-muted-foreground">
                Every sentence in a package cites the file and line it came from, with a confidence
                level and a staleness flag. Ask a question and the answer cites the same receipts;
                unknowns stay unknowns instead of being guessed.
              </p>
            </div>
            <div className="mt-6 flex-1 space-y-3 md:mt-1">
              <div className="flex flex-wrap gap-1.5">
                <ReceiptChip file="queue.ts" line={56} />
                <ReceiptChip file="index.ts" line={288} />
                <ReceiptChip file="sectionValidator.ts" line={11} />
              </div>
              <div className="rounded-lg border border-foreground/10 bg-background/50 p-3.5 dark:border-white/10">
                <p className="text-xs font-medium text-foreground">Where does an analysis actually run?</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Never inside a request: the API enqueues a job and a worker process executes the
                  pipeline <ReceiptChip file="queue.ts" line={56} />
                </p>
              </div>
            </div>
          </div>
        </SpotCard>
      </div>
    </SectionShell>
  );
}

/** Spotlight bento card: hover lift, border glow, and a mouse-following glow
 *  via the --mx/--my custom properties the .spot-card pseudo-element reads. */
function SpotCard({ children, className, index }: { children: ReactNode; className?: string; index: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <Reveal index={index} className={className}>
      <div
        ref={ref}
        onMouseMove={(event) => {
          const el = ref.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
          el.style.setProperty("--my", `${event.clientY - rect.top}px`);
        }}
        className="spot-card group h-full rounded-xl border border-foreground/10 bg-card/70 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#2659f4]/40 hover:shadow-lg hover:shadow-[#2659f4]/10 dark:border-white/10"
      >
        {children}
      </div>
    </Reveal>
  );
}

function PillarTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-foreground/10 bg-gradient-to-br from-[#2659f4]/15 to-transparent text-primary dark:border-white/10">
        {icon}
      </span>
      <h3 className="text-[0.9375rem] font-semibold text-foreground">{children}</h3>
    </div>
  );
}

/** The real tutorial step anatomy from the Tutorials tab, miniaturized. */
function MiniStep({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-foreground/10 px-3 py-2 dark:border-white/10">
      <span className="mr-2 text-[0.625rem] font-semibold uppercase tracking-wider text-primary">{label}</span>
      <span className={cn("text-xs text-muted-foreground", mono && "font-mono text-foreground")}>{children}</span>
    </div>
  );
}

/**
 * A citation chip for static examples. A span, not the real ReceiptChip
 * button: there is no snapshot behind the landing page, and no title
 * attribute because the e2e audit census counts [title] elements as controls.
 */
function ReceiptChip({ file, line }: { file: string; line: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-foreground/15 bg-muted/40 px-1.5 py-0.5 align-baseline font-mono text-[0.6875rem] text-foreground dark:border-white/15">
      <FileCode2 className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {file}:{line}
    </span>
  );
}
