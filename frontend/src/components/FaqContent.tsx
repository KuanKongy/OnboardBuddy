import { ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { RANKING_EXPLANATION } from "@/lib/rankingCopy";
import { cn } from "@/lib/utils";

/**
 * The FAQ answers, shared by the public /faq page and the signed-in /help tab
 * so the two can never drift into telling a visitor and a user different things
 * about what reaches a model. The items are module-level and pure on purpose:
 * they must render identically outside the app shell, with no session, no
 * project selection, and no fetch behind them. Copy rule: no em dashes.
 */

export interface FaqItem {
  question: string;
  answer: React.ReactNode;
}

export function FaqSection({ items }: { items: FaqItem[] }) {
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

export const FAQ_ITEMS: FaqItem[] = [
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
        Analysis produced a parsed snapshot (file, symbol, and workflow counts) plus any generated
        onboarding packages. From there: read a package, explore the Architecture or Dependencies
        views, or invite teammates.
      </>
    ),
  },
  {
    question: "What is sent to the AI, and is my code used for training?",
    answer: (
      <>
        <p className="mb-1.5">Depends on the project's privacy mode:</p>
        <ul className="mb-1.5 list-disc space-y-0.5 pl-4">
          <li><strong className="text-foreground">Full AI:</strong> code snippets + facts go to the LLM.</li>
          <li><strong className="text-foreground">Facts-only:</strong> no code leaves the system; only extracted facts and structure.</li>
          <li><strong className="text-foreground">AI disabled:</strong> no LLM calls at all.</li>
        </ul>
        <p className="mb-1.5">
          LLM calls go through{" "}
          <a href="https://openrouter.ai/docs/features/privacy-and-logging" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            OpenRouter <ExternalLink className="inline h-2.5 w-2.5" />
          </a>
          . See their retention and training policy for what a given model provider does with the
          data. The hard guarantee: choose Facts-only or AI-disabled and your code never reaches a
          model.
        </p>
        {/* Was an in-page jump to the /help privacy card, which does not exist
            on the public page; the full breakdown is its own route. */}
        <Link to="/privacy" className="text-primary hover:underline">
          See the full privacy breakdown
        </Link>
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
        <p className="mb-1.5">
          When a new commit is analyzed, sections whose underlying code evidence actually changed
          get flagged stale (whitespace-only edits flag nothing). Regenerate rebuilds a section or
          whole package in place at the same commit; it does not create a new package, and review
          history is kept.
        </p>
        <p className="mb-1.5">
          Staleness is scoped to a branch. Re-analyzing a branch only re-checks packages built
          from that branch, so work on one branch never flags another branch's packages.
        </p>
        <p>
          Rebuilding stale content can happen two ways: turn on "Auto-regenerate stale sections"
          in Project Settings and each new analysis rebuilds what it flagged, or leave it off and
          use "Regenerate only the stale sections" on the package card when you want it.
        </p>
      </>
    ),
  },
  {
    question: "How do I use the dependency graph?",
    answer: (
      <>
        Entry points are marked with a ▶ badge. The legend in the top-left shows each file kind's
        color. Click a swatch to hide/show that kind. Use the search box to filter by name, and
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
        Every claim in a generated package cites file:line evidence, a "receipt", with a confidence
        level and a staleness indicator (whether the source has changed since the claim was
        written). Click a citation chip to inspect the underlying code, or follow it straight to
        GitHub.
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
