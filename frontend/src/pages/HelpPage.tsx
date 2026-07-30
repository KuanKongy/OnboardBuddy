import { ChevronDown, ExternalLink, HelpCircle, Route, Shield, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import type { Project } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { activityTime } from "@/pages/DashboardPage";
import { PRIVACY_MODES } from "@/pages/ProjectSettingsPage";
import { RANKING_EXPLANATION } from "@/lib/rankingCopy";
import { scrollBehavior } from "@/lib/motion";
import { requestTour, type TourName } from "@/lib/tourState";
import { useProjects } from "@/lib/useProjects";
import { cn } from "@/lib/utils";

interface TourRow {
  name: TourName;
  title: string;
  description: string;
  hint?: string;
  /** The dashboard and import tours need no project; the other three do. */
  projectScoped: boolean;
  path: (projectId: string) => string;
}

const TOUR_ROWS: TourRow[] = [
  {
    name: "dashboard",
    title: "Dashboard tour",
    description: "Where to find your projects, stats, and how to import a new repo.",
    projectScoped: false,
    path: () => "/dashboard",
  },
  {
    name: "project",
    title: "Project tour",
    description: "What each project tab does — overview, onboarding, architecture, dependencies, workflows.",
    projectScoped: true,
    path: (id) => `/projects/${id}`,
  },
  {
    name: "import",
    title: "Import tour",
    description: "Configuring the first analysis — branch, commit, scope, and the cost preview.",
    hint: "Starts on step 2, once a repository has been imported.",
    projectScoped: false,
    path: () => "/import",
  },
  {
    name: "onboardingLifecycle",
    title: "Package lifecycle tour",
    description: "How packages, regeneration, and stale badges work.",
    projectScoped: true,
    path: (id) => `/projects/${id}/onboarding`,
  },
  {
    name: "onboardingReader",
    title: "Reader tour",
    description: "How to read a generated package — sections, receipts, and review status.",
    hint: "Starts when you open a generated package's reader.",
    projectScoped: true,
    path: (id) => `/projects/${id}/onboarding`,
  },
];

interface FaqItem {
  question: string;
  answer: React.ReactNode;
}

function scrollToAnchor(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
}

function FaqSection({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="space-y-0.5">
      {items.map((item, i) => {
        const isOpen = open.has(i);
        return (
          <div key={item.question} className="border-b border-border/60 last:border-b-0">
            <button
              type="button"
              onClick={() => toggle(i)}
              aria-expanded={isOpen}
              className="-mx-1 flex w-full items-center gap-2 rounded px-1 py-2 text-left transition-colors hover:bg-accent/40"
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150", !isOpen && "-rotate-90")}
              />
              <span className="min-w-0 flex-1 text-[0.8125rem] font-medium text-foreground">{item.question}</span>
            </button>
            <div className={cn("grid transition-[grid-template-rows] duration-200 ease-in-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <div className="overflow-hidden" inert={!isOpen}>
                <div className="mb-3 pl-5.5 text-[0.78125rem] leading-relaxed text-muted-foreground">{item.answer}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * /help is reachable signed out (see `HelpRoute` in App.tsx), so the projects
 * fetch has to be skippable: with no session `GET /projects` is a guaranteed
 * 401 whose only effect is a red line in a visitor's console. Splitting the
 * hook into a wrapper keeps it out of the signed-out render entirely rather
 * than firing it and swallowing the failure.
 */
export function HelpPage({ signedOut = false }: { signedOut?: boolean }) {
  return signedOut ? <HelpPageView projects={[]} signedOut /> : <AuthedHelpPage />;
}

function AuthedHelpPage() {
  const { projects } = useProjects();
  return <HelpPageView projects={projects} signedOut={false} />;
}

function HelpPageView({ projects, signedOut }: { projects: Project[]; signedOut: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => activityTime(b) - activityTime(a)),
    [projects],
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  useEffect(() => {
    if (!selectedProjectId && sortedProjects.length > 0) setSelectedProjectId(sortedProjects[0]!.id);
  }, [sortedProjects, selectedProjectId]);

  // Deep link support: /help#faq, /help#privacy, /help#tours.
  useEffect(() => {
    const hash = location.hash.replace("#", "");
    if (hash) scrollToAnchor(hash);
  }, [location.hash]);

  function startTour(row: TourRow) {
    if (row.projectScoped && !selectedProjectId) return;
    requestTour(row.name);
    navigate(row.projectScoped ? row.path(selectedProjectId) : row.path(""));
  }

  const faqItems: FaqItem[] = [
    {
      question: "What happens when I analyze a repo?",
      answer: (
        <>
          A 16-phase pipeline runs against the repo: deterministic parsing and graph-building phases
          run first, then AI phases (skipped entirely if the project's privacy mode disables them).
          The full phase list is visible live on the project Overview while a run is in progress.
        </>
      ),
    },
    {
      question: 'What does "Complete" mean?',
      answer: (
        <>
          Analysis produced a parsed snapshot — file, symbol, and workflow counts — plus any
          generated onboarding packages. From there: read a package, explore the Architecture or
          Dependencies views, or invite teammates.
        </>
      ),
    },
    {
      question: "What is sent to the AI — is my code used for training?",
      answer: (
        <>
          <p className="mb-1.5">Depends on the project's privacy mode:</p>
          <ul className="mb-1.5 list-disc space-y-0.5 pl-4">
            <li><strong className="text-foreground">Full AI:</strong> code snippets + facts go to the LLM.</li>
            <li><strong className="text-foreground">Facts-only:</strong> no code leaves the system — only extracted facts and structure.</li>
            <li><strong className="text-foreground">AI disabled:</strong> no LLM calls at all.</li>
          </ul>
          <p className="mb-1.5">
            LLM calls go through{" "}
            <a href="https://openrouter.ai/docs/features/privacy-and-logging" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              OpenRouter <ExternalLink className="inline h-2.5 w-2.5" />
            </a>{" "}
            — see their retention/training policy for what a given model provider does with the data.
            The hard guarantee: choose Facts-only or AI-disabled and your code never reaches a model.
          </p>
          <button type="button" onClick={() => scrollToAnchor("privacy")} className="text-primary hover:underline">
            See the full privacy breakdown below ↓
          </button>
        </>
      ),
    },
    {
      question: 'How is "critical code" ranked?',
      answer: (
        <>
          {RANKING_EXPLANATION} Adjust the weights per developer role in Project Settings → Ranking weights.
        </>
      ),
    },
    {
      question: 'Why do sections go "stale" and what does Regenerate do?',
      answer: (
        <>
          When a new commit is analyzed, sections whose underlying code evidence actually changed
          get flagged stale (whitespace-only edits flag nothing). Regenerate rebuilds a section or
          whole package in place at the same commit — it doesn't create a new package, and review
          history is kept.
        </>
      ),
    },
    {
      question: "How do I use the dependency graph?",
      answer: (
        <>
          Entry points are marked with a ▶ badge. The legend in the top-left shows each file kind's
          color — click a swatch to hide/show that kind. Use the search box to filter by name, and
          "Strongest edges only" (the default) keeps dense repos readable by drawing each file's top
          3 connections per direction. Click a node for its evidence panel, including a link to view
          the file on GitHub.
        </>
      ),
    },
    {
      question: "What are receipts?",
      answer: (
        <>
          Every claim in a generated package cites file:line evidence — a "receipt" — with a
          confidence level and a staleness indicator (whether the source has changed since the
          claim was written). Click a citation chip to inspect the underlying code, or follow it
          straight to GitHub.
        </>
      ),
    },
    {
      question: "Can I edit the generated text?",
      answer: (
        <>
          Not directly yet. Regenerate a section or a whole package to have it rewritten from the
          latest analysis, and use the review status (draft/approved) to track what's been checked.
        </>
      ),
    },
    {
      question: "Where are keyboard shortcuts?",
      answer: (
        <>
          Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[0.6875rem]">?</kbd> anywhere
          in the app, or open them from the "Keyboard shortcuts" button in the sidebar.
        </>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      {signedOut ? (
        // PageHeader leads with the sidebar toggle, and there is no sidebar on
        // the public route — the same title block without a control that
        // toggles nothing.
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-title">Help &amp; FAQ</h1>
            <div className="page-subtitle">
              Tours, frequently asked questions, and what OnboardBuddy sends to the AI.
            </div>
          </div>
        </div>
      ) : (
        <PageHeader
          title="Help & FAQ"
          subtitle="Tours, frequently asked questions, and what OnboardBuddy sends to the AI."
        />
      )}

      <div className="space-y-4">
        <Card id="tours">
          <CardContent className="p-4">
            <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Route className="h-4 w-4 text-primary" /> Tours
            </h2>
            <p className="mb-3 text-[0.78125rem] text-muted-foreground">
              Re-run any guided tour any time — starting one doesn't affect whether it auto-starts
              again on its own.
            </p>

            {signedOut ? (
              <p className="mb-3 text-[0.71875rem] text-muted-foreground/80">
                Tours run inside the app —{" "}
                <Link to="/login" className="text-primary hover:underline">
                  log in
                </Link>{" "}
                or{" "}
                <Link to="/signup" className="text-primary hover:underline">
                  sign up
                </Link>{" "}
                to start one.
              </p>
            ) : (
              sortedProjects.length === 0 && (
                <p className="mb-3 text-[0.71875rem] text-muted-foreground/80">
                  Project-scoped tours need a project to open — import one first.
                </p>
              )
            )}
            {sortedProjects.length > 0 && (
              <div className="mb-3">
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger className="h-8 w-full text-[0.8125rem] sm:w-72" aria-label="Project for project-scoped tours">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-[0.8125rem]">
                        {p.repo_owner}/{p.repo_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              {TOUR_ROWS.map((row) => {
                // Every tour target sits behind ProtectedRoute, so a signed-out
                // visitor pressing Start would only be bounced to /login.
                const disabled = signedOut || (row.projectScoped && sortedProjects.length === 0);
                return (
                  <div key={row.name} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[0.8125rem] font-medium text-foreground">{row.title}</p>
                      <p className="text-[0.71875rem] text-muted-foreground">{row.description}</p>
                      {row.hint && <p className="mt-0.5 text-[0.65625rem] text-muted-foreground">{row.hint}</p>}
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      className="shrink-0"
                      disabled={disabled}
                      title={
                        signedOut
                          ? "Log in to start a tour"
                          : disabled
                            ? "Import a project first"
                            : undefined
                      }
                      onClick={() => startTour(row)}
                    >
                      <HelpCircle className="mr-1 h-3 w-3" />
                      Start
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card id="faq">
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Frequently asked questions</h2>
            <FaqSection items={faqItems} />
          </CardContent>
        </Card>

        <Card id="privacy">
          <CardContent className="p-4">
            <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Shield className="h-4 w-4 text-primary" /> Privacy &amp; AI transparency
            </h2>
            <p className="mb-3 text-[0.78125rem] text-muted-foreground">
              Exactly what leaves the system, by privacy mode. Each project picks its own mode in
              Project Settings.
            </p>

            <div className="mb-3 overflow-hidden rounded-md border border-border">
              <table className="w-full text-left text-[0.75rem]">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[0.6875rem] uppercase text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">Mode</th>
                    <th className="px-3 py-1.5 font-medium">What leaves the system</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-1.5 font-medium text-foreground">{PRIVACY_MODES[0]!.label}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">Extracted facts + code snippets</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-1.5 font-medium text-foreground">{PRIVACY_MODES[1]!.label}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">Facts and structure only — no code</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 font-medium text-foreground">{PRIVACY_MODES[2]!.label}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">Nothing — zero LLM calls, deterministic outputs only</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mb-3 text-[0.78125rem] leading-relaxed text-muted-foreground">
              <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
              AI calls go through OpenRouter; models are configurable per project. Embeddings use an
              OpenAI-compatible endpoint. Provider data handling is governed by{" "}
              <a href="https://openrouter.ai/docs/features/privacy-and-logging" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                OpenRouter's policy <ExternalLink className="inline h-2.5 w-2.5" />
              </a>
              . With a project-level API key, calls run under your own account instead of the shared one.
            </p>

            <p className="mb-1 text-[0.78125rem] font-medium text-foreground">How to limit exposure</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[0.78125rem] text-muted-foreground">
              <li>
                Switch to Facts-only or AI-disabled privacy mode
                {selectedProjectId && (
                  <>
                    {" — "}
                    <Link to={`/projects/${selectedProjectId}/settings`} className="text-primary hover:underline">
                      open Project Settings
                    </Link>
                  </>
                )}
                .
              </li>
              <li>Exclude paths from analysis with <code className="rounded bg-muted px-1 py-0.5 text-[0.6875rem]">ignored_paths</code> in Project Settings.</li>
              <li>Bring your own OpenRouter API key so calls run under your account, not the shared one.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
