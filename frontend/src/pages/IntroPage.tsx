import {
  ArrowRight,
  Code2,
  EyeOff,
  FileCode2,
  GitBranch,
  KeyRound,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PublicPageHeader } from "@/components/PublicPageHeader";
import { PHASE_ORDER } from "@/components/AnalysisRunPanel";
import { PRIVACY_MODES } from "@/pages/ProjectSettingsPage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Icon per privacy mode, in PRIVACY_MODES order (full → facts-only → off). */
const PRIVACY_MODE_ICONS = [Sparkles, ShieldCheck, EyeOff];

/**
 * The phases worth naming on a landing page — 9 of the 16 in PHASE_ORDER.
 * Labels and descriptions are imported, never retyped, so what a visitor is
 * promised here and what the live run panel reports can't drift apart.
 */
const SHOWCASE_PHASE_KEYS = [
  "ingest", "parse", "graph", "workflows",
  "semantic_symbols", "critique", "embeddings", "generation", "validation",
];

/**
 * Which of those phases reach a model, checked against the backend rather than
 * inferred from the label — the "AI:" prefix is not a reliable marker and
 * getting this wrong on a transparency page is a false privacy claim.
 *
 * `embeddings` is in `SEMANTIC_PHASES` (semanticPipeline.ts:25), so
 * `ai_disabled` skips it along with the rest (worker/index.ts:794) even though
 * its label doesn't say "AI". `generation` is the other exception in the other
 * direction: it is not skipped under `ai_disabled` but runs LLM-free
 * (summaryWorker.ts:286, `mode: 'deterministic'`), so it makes no model calls
 * in that mode. `validation` only re-checks citations against the source.
 */
const AI_PHASE_KEYS = new Set(["semantic_symbols", "critique", "embeddings", "generation"]);

/** The badge beside the label already says "AI"; drop the prefix PHASE_ORDER
 *  carries for the run panel, and recase what it left mid-sentence. */
function stripAiPrefix(label: string): string {
  const stripped = label.replace(/^AI: /, "");
  return stripped === label ? label : stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function IntroPage() {
  // Filtered, not asserted: renaming a phase key in AnalysisRunPanel should
  // cost this list one row, not white-screen the public landing page.
  const showcasePhases = SHOWCASE_PHASE_KEYS
    .map((key) => PHASE_ORDER.find((p) => p.key === key))
    .filter((p) => p !== undefined);

  return (
    <div className="min-h-screen bg-background">
      {/* Signed-in visitors are NOT auto-redirected — the landing page stays
          readable; the header offers the way into the app instead. (The login
          and signup pages are the ones that bounce a signed-in user on.) */}
      <PublicPageHeader />

      {/* Two columns so the showcase card is above the fold. It was MOVED here, not
          copied — the section further down carries the tutorial example instead. */}
      <section className="px-4 pb-16 pt-14 sm:pb-20 sm:pt-16">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div className="text-center lg:text-left">
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
              Onboard developers to any codebase&nbsp;&mdash; automatically
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base lg:mx-0">
              OnboardBuddy analyzes your repository, extracts critical workflows, and
              generates role-specific onboarding packages grounded in real code evidence.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3 lg:justify-start">
              <Button size="sm" asChild>
                <Link to="/signup">
                  Get Started
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="#features">Learn More</a>
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-4">
              <p className="section-label mb-2">Package section &middot; Backend architecture</p>
              <div className="mb-3 max-w-[75ch] rounded-md border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-foreground">
                <span className="mr-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-primary/80">
                  TL;DR
                </span>
                Analysis never runs inside a request &mdash; the API enqueues a job and a worker
                process executes the pipeline.
              </div>
              <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                Starting an analysis writes a job row and pushes it onto the analysis queue
                <SampleCitation file="backend/src/lib/queue.ts" line="56" />, so the HTTP response
                returns while the work is still queued. The worker picks the job up
                <SampleCitation file="backend/src/worker/index.ts" line="288" /> and runs the
                phases in order, recording each one's status and spend as it goes. The
                deterministic phases come first &mdash; the evidence graph is built from parsed
                imports and calls
                <SampleCitation file="backend/src/worker/engine/evidenceGraphBuilder.ts" line="52" />{" "}
                before any model is asked a question, which is why an AI-disabled project still
                gets a graph, workflows and rankings.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="features" className="border-t border-border bg-card px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-xl font-bold text-foreground sm:text-2xl">
            Built for engineering teams
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Code2 className="h-4 w-4" />}
              title="Deterministic Analysis"
              description="AST-powered extraction — not AI-guessed. Reliable, reproducible results every time."
            />
            <FeatureCard
              icon={<Users className="h-4 w-4" />}
              title="Role-Based Onboarding"
              description="Tailored paths for Backend, Frontend, DevOps, and QA engineers."
            />
            <FeatureCard
              icon={<Search className="h-4 w-4" />}
              title="Source-Grounded"
              description="Every claim is linked to real code. No hallucinated documentation."
            />
            <FeatureCard
              icon={<RefreshCw className="h-4 w-4" />}
              title="Always Current"
              description="Incremental updates when code changes. Never stale onboarding."
            />
          </div>
        </div>
      </section>

      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-center text-xl font-bold text-foreground sm:text-2xl">
            How it works
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <StepCard
              step={1}
              icon={<GitBranch className="h-4 w-4" />}
              title="Connect your GitHub repo"
              description="Install the OnboardBuddy GitHub App and select repositories to analyze."
            />
            <StepCard
              step={2}
              icon={<Shield className="h-4 w-4" />}
              title="We analyze & extract workflows"
              description="Our deterministic pipeline parses your code, maps dependencies, and identifies critical paths."
            />
            <StepCard
              step={3}
              icon={<Users className="h-4 w-4" />}
              title="Your team gets personalized onboarding"
              description="Each developer receives a role-specific package with walkthroughs and architecture context."
            />
          </div>
        </div>
      </section>

      <section id="privacy" className="border-t border-border bg-card px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-2 text-center text-xl font-bold text-foreground sm:text-2xl">
            Your code, your rules
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
            Each project chooses how much of it &mdash; if any &mdash; reaches a model. The mode is
            set per project and applies to every run.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {PRIVACY_MODES.map((mode, i) => {
              const Icon = PRIVACY_MODE_ICONS[i] ?? Shield;
              return (
                <FeatureCard
                  key={mode.key}
                  icon={<Icon className="h-4 w-4" />}
                  title={mode.label}
                  description={mode.hint}
                />
              );
            })}
          </div>

          <Card className="mt-3">
            <CardContent className="p-4">
              <ul className="space-y-2.5">
                <GuaranteeRow icon={<Lock className="h-4 w-4" />}>
                  Read-only access &middot; secrets filtered &middot; no full repository stored.
                </GuaranteeRow>
                <GuaranteeRow icon={<Sparkles className="h-4 w-4" />}>
                  AI calls run through OpenRouter with{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">
                    data_collection: deny
                  </code>
                  , and zero-data-retention routing is requested by default &mdash; what a given
                  model provider then does with a request is governed by their policy.
                </GuaranteeRow>
                <GuaranteeRow icon={<KeyRound className="h-4 w-4" />}>
                  Bring your own OpenRouter key and calls run under your account, not a shared one.
                </GuaranteeRow>
              </ul>
              <Link
                to="/help#privacy"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Full privacy breakdown, mode by mode
                <ArrowRight className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-2 text-center text-xl font-bold text-foreground sm:text-2xl">
            What actually runs
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
            Parsing, the evidence graph and workflow tracing all finish before a model is asked
            anything. With AI disabled, the phases below marked AI make no model calls at all and
            the package is assembled from the deterministic output instead.
          </p>

          <Card>
            <CardContent className="p-4">
              <ol className="space-y-2">
                {showcasePhases.map((phase, i) => {
                  const isAi = AI_PHASE_KEYS.has(phase.key);
                  return (
                    <li key={phase.key} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-[0.625rem] font-semibold text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[0.8125rem] font-semibold text-foreground">
                            {stripAiPrefix(phase.label)}
                          </span>
                          <span
                            className={cn(
                              "rounded px-1 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide",
                              isAi ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                            )}
                          >
                            {isAi ? "AI" : "Deterministic"}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">{phase.desc}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                {showcasePhases.length} of the {PHASE_ORDER.length} phases. The full list streams
                live on the project Overview while a run is in progress, each with its own status
                and spend.
              </p>
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardContent className="p-4">
              <GuaranteeRow icon={<FileCode2 className="h-4 w-4" />}>
                Every claim in a generated package cites file:line evidence &mdash; a receipt &mdash;
                with a confidence level and a staleness indicator. Click a citation to inspect the
                code it came from.
              </GuaranteeRow>
              <Link
                to="/help"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                How the pipeline and receipts work
                <ArrowRight className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="border-t border-border bg-card px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-2 text-center text-xl font-bold text-foreground sm:text-2xl">
            Transparent costs
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
            No run spends money without saying so.
          </p>
          <Card>
            <CardContent className="p-4">
              <ul className="space-y-2.5">
                <GuaranteeRow icon={<Wallet className="h-4 w-4" />}>
                  Every run carries its own cost, AI call count and token counts in the project's run
                  history.
                </GuaranteeRow>
                <GuaranteeRow icon={<Shield className="h-4 w-4" />}>
                  A budget caps each run before it starts, and an estimate is shown at import &mdash;
                  a run that would exceed its budget pauses instead of overspending.
                </GuaranteeRow>
                <GuaranteeRow icon={<Search className="h-4 w-4" />}>
                  The project's total AI spend is always visible in Project Settings.
                </GuaranteeRow>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-2 text-center text-xl font-bold text-foreground sm:text-2xl">
            See what you get
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
            Example output &mdash; OnboardBuddy analyzing its own repository.
          </p>

          {/* One card, so no grid — a lone card in a 2-track grid sits adrift. */}
          <div className="mx-auto max-w-2xl">
            <Card>
              <CardContent className="p-4">
                <p className="section-label mb-2">Tutorial &middot; 3 of 6 in the package</p>
                <h3 className="mb-3 text-[0.8125rem] font-semibold text-foreground">
                  Resume analysis job and export onboarding package
                </h3>
                <ol className="space-y-2.5">
                  <SampleStep
                    step={1}
                    text="The API verifies the job's status and the caller's role, then re-enqueues it."
                    file="backend/src/api/routes/projects.ts"
                    line="837"
                  />
                  <SampleStep
                    step={2}
                    text="The worker consumes the job from the analysis queue and resumes the pipeline at the phase it stopped on."
                    file="backend/src/worker/index.ts"
                    line="288"
                  />
                  <SampleStep
                    step={3}
                    text="Every citation in the package is re-checked against the snapshot before it can be exported."
                    file="backend/src/worker/engine/sectionValidator.ts"
                    line="11"
                  />
                </ol>
              </CardContent>
            </Card>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            That run produced{" "}
            <span className="font-semibold text-foreground">12 sections</span> &middot;{" "}
            <span className="font-semibold text-foreground">6 tutorials</span> &middot;{" "}
            <span className="font-semibold text-foreground">103 traced workflows</span>.
          </p>
        </div>
      </section>

      <footer className="border-t border-border px-4 py-6">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
            <Link to="/help" className="text-muted-foreground hover:text-foreground hover:underline">
              Help &amp; FAQ
            </Link>
            <Link
              to="/help#privacy"
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              Privacy &amp; AI transparency
            </Link>
          </div>
          <div className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} OnboardBuddy. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
        <h3 className="mb-1 text-[0.8125rem] font-semibold text-foreground">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

/** One icon + one sentence, for the guarantee lists in the transparency bands. */
function GuaranteeRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-primary">
        {icon}
      </span>
      <span className="text-[0.8125rem] leading-relaxed text-muted-foreground">{children}</span>
    </li>
  );
}

/**
 * A citation chip for the static example only. Deliberately a <span>, not the
 * real ReceiptChip button: there is no snapshot behind the landing page, so a
 * chip that looked clickable would be promising a drill-down that can't
 * happen here. The line numbers are real ones in this repository.
 */
function SampleCitation({ file, line }: { file: string; line: string }) {
  return (
    <span
      className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 align-baseline font-mono text-[0.6875rem] text-foreground"
      title={`${file}:${line}`}
    >
      <FileCode2 className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
      {file.split("/").pop()}:{line}
    </span>
  );
}

/** One numbered step of the static example tutorial. */
function SampleStep({
  step,
  text,
  file,
  line,
}: {
  step: number;
  text: string;
  file: string;
  line: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-[0.625rem] font-semibold text-muted-foreground">
        {step}
      </span>
      <div className="min-w-0">
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{text}</p>
        <div className="mt-1">
          <SampleCitation file={file} line={line} />
        </div>
      </div>
    </li>
  );
}

function StepCard({
  step,
  icon,
  title,
  description,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-primary">
        Step {step}
      </div>
      <h3 className="mb-1 text-[0.8125rem] font-semibold text-foreground">{title}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
