import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  FileCode2,
  FileText,
  FlaskConical,
  GitCommitHorizontal,
  HelpCircle,
  Layers,
  Loader2,
  MessageSquare,
  RefreshCw,
  Route,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AnalyzeDialog } from "@/components/AnalyzeDialog";
import { AppTour, type TourStep } from "@/components/AppTour";
import { useHotkeys } from "@/hooks/useHotkeys";
import { PageHeader } from "@/components/PageHeader";
import { SidebarToggle } from "@/components/SidebarShell";
import { useFullBleedMain } from "@/components/MainRegion";
import { useAuth } from "@/contexts/AuthContext";
import { useProject } from "@/contexts/ProjectContext";
import { usePackages } from "@/contexts/PackagesContext";
import { ApiError, apiFetch } from "@/lib/api";
// This one call bypasses `apiFetch` because it needs the raw Response (blob
// download), so it composes the API origin itself — from runtime config, not
// from a build-time constant.
import { runtimeConfig } from "@/lib/runtimeConfig";
import { consumeTourRequest, dismissTour, tourDismissed } from "@/lib/tourState";
import { useProgress } from "@/lib/useProgress";
import {
  SECTION_GROUPS,
  SECTION_NAV_ORDER,
  fetchOnboardingPackage,
  readingOrderFor,
  regenerateSection,
  sectionWhy,
} from "@/lib/onboardingData";
import { FALLBACK_ROLE, ROLE_OPTIONS, roleLabel, roleTitle } from "@/lib/roles";
import { receiptNumberById, renderReceiptMarkers } from "@/lib/receiptMarkers";
import { AskPanel } from "@/components/AskPanel";
import { DiagramFrame } from "@/components/reader/DiagramFrame";
import { SourceMark } from "@/components/reader/SourceMark";
import { SectionMarkdown, type MarkdownComponents } from "@/components/reader/SectionMarkdown";
import { receiptAnchor } from "@/components/reader/receiptAnchor";
import { ProvenancePanel } from "@/components/ProvenancePanel";
import { ReceiptChip } from "@/components/ReceiptChips";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageSpinner } from "@/components/ui/page-spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ConfidenceLevel,
  LanguageInventory,
  OnboardingPackage,
  OnboardingSection,
  PackageCard,
  PackageCoverage,
  SectionGapGroup,
  SectionId,
  SourceReceipt,
} from "@/types/onboarding";
import { ReceiptViewer } from "@/components/ReceiptViewer";
import { ScoreProvenance } from "@/components/ScoreProvenance";
import { cn } from "@/lib/utils";

// ── helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  approved: "border-success/40 bg-success-soft text-success",
  draft: "border-border bg-secondary text-secondary-foreground",
  stale: "border-warning/40 bg-warning-soft text-warning",
  generating: "border-info/40 bg-info-soft text-info",
  failed: "border-danger/40 bg-danger-soft text-danger",
};

function StatusBadge({ status }: { status: string }) {
  // E6/§17.8 "constants pretending to be data": 8/8 packages and 93/93
  // sections in the system are `draft` and no reachable action clears it, so
  // the badge told every reader their documentation is unfinished. States
  // that never vary render nothing; real states (stale/generating/failed/
  // approved) keep their badge.
  if (status === "draft") return null;
  return (
    <Badge variant="outline" className={cn("text-[0.6875rem] capitalize", STATUS_STYLE[status] ?? "")}>
      {status}
    </Badge>
  );
}

const CONFIDENCE_TONE: Record<ConfidenceLevel, string> = {
  high: "text-success",
  medium: "text-warning",
  low: "text-danger",
};

/**
 * One option row in the regenerate dialog. Every option stays on screen even
 * when it is unusable, so the disabled state has to drop the hover affordance
 * too: `hover:` rules still fire on a disabled button, which lit up a row that
 * cannot be clicked.
 */
const OPTION_CLASS =
  "w-full rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent";

/** The grade as a sentence opener, so "low confidence" is not shouted in caps. */
const CONFIDENCE_WORD: Record<ConfidenceLevel, string> = { high: "High", medium: "Medium", low: "Low" };

/**
 * What each grade means, mirroring the thresholds in the backend's
 * citationValidator: high = nothing downgraded and most claims high, low = a
 * large share of claims low or untracked, medium = in between, or the model's
 * own self-assessment capped it.
 */
const CONFIDENCE_MEANING: Record<ConfidenceLevel, string> = {
  high: "Every tracked claim held up in validation, and most cite receipts from the code itself. Nothing had to be downgraded.",
  medium:
    "The section held up overall, but some claims lean on weaker support, such as docs instead of code, or confidence was capped because the validator was less sure. Keep the receipts nearby.",
  low: "A sizeable share of claims failed validation: they cited nothing, cited support that could not be verified, or were not tracked at all. Verify against the cited files before relying on this.",
};

/**
 * Grades with no claim ledger behind them still have to draw something. These
 * are the fractions the three words stand for, not measurements: a full circle
 * for high, a little over half for medium, a quarter for low.
 */
const LEVEL_FRACTION: Record<ConfidenceLevel, number> = { high: 1, medium: 0.55, low: 0.25 };

/**
 * The grade as a filled circle: how much of this section's tracked claims cite
 * a receipt. The word alone ("medium confidence") never said what it was
 * measured from, and the reason string next to it is the one thing readers
 * skip. `claims` null means the generation predates the ledger, so the pie
 * shows the grade's own fraction rather than a made-up ratio.
 */
function ConfidencePie({
  level,
  claims,
}: {
  level: ConfidenceLevel;
  claims?: { total: number; cited: number; low: number } | null;
}) {
  const measured = claims && claims.total > 0;
  const fraction = measured ? claims.cited / claims.total : LEVEL_FRACTION[level];
  const label = measured
    ? `${CONFIDENCE_WORD[level]} confidence: ${claims.cited} of ${claims.total} claims cite receipts`
    : `${CONFIDENCE_WORD[level]} confidence`;

  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("h-4 w-4 shrink-0", CONFIDENCE_TONE[level])}
      role="img"
      aria-label={label}
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={3.5}
      />
      {/* `pathLength` normalises the circumference to 100 so the dash array is
          the percentage itself; the rotation puts 0% at twelve o'clock. A full
          ring is drawn WITHOUT a dash array: the two ends of a 100-unit dash
          meet at twelve o'clock and antialias into a visible pale seam (seen
          at 96px, a hairline at the real 16px). */}
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.5}
        pathLength={100}
        strokeDasharray={fraction >= 1 ? undefined : `${fraction * 100} 100`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

const UNKNOWN_LABELS: Record<string, string> = {
  uncited_claim: "A statement couldn't be backed by evidence and was downgraded",
  budget_degraded: "Generation stopped early because the analysis budget ran out",
  facts_only_privacy: "Code snippets were withheld under this project's privacy mode",
  no_workflows_found: "No workflows could be traced in this codebase",
  unsupported_languages: "Some files are in languages the analyzer doesn't parse yet",
  docs_conflict_with_code: "Documentation disagrees with the code, and the code was trusted",
  unexplained_step: "A step in a flow couldn't be explained from the available evidence",
  ai_disabled: "Generated without AI (privacy mode: AI disabled): deterministic facts only",
  noReceipt: "No citable evidence was available for this topic",
  docs_only_support: "This claim rests on documentation alone (docs may lag the code)",
  // Retrieval internals, translated: raw "no embeddings matched views […]"
  // used to render verbatim to onboarding readers.
  no_semantic_matches:
    "The semantic index had nothing relevant for this section, so it is based on structural facts only",
  workflow: "A referenced workflow couldn't be fully resolved from the trace evidence",
  data: "Supporting data for part of this section wasn't available in the evidence",
  // Kinds that used to render as raw pipeline telemetry (READER_REDESIGN.md
  // N8): the reader speaks to a newcomer, not to the validator.
  unsupported_language: "Part of this repository is in a language the analyzer doesn't parse",
  prompt_injection_attempt: "Repo content tried to steer the AI (prompt injection); it was fenced and ignored",
  incomplete_coverage: "This section doesn't yet cover every file it maps. Regenerate to fill it in",
  critique_contradiction: "An internal consistency check flagged one of this section's statements",
  env_var_documentation_missing: "Some environment variables have no documented purpose in .env.example",
  missing_test_for_area: "No existing test could be found covering this change area",
};

/**
 * Gap kinds whose `detail` is written in the pipeline's own instruction voice
 * ("INCOMPLETE: you covered 0 of 36 required mapped files…") — the translated
 * label above carries the reader-facing meaning; the raw text stays in the
 * provenance trail, not the document (N8).
 */
const DETAIL_SUPPRESSED_KINDS = new Set(["incomplete_coverage"]);

type DetectionUnknown = NonNullable<PackageCoverage["detectionUnknowns"]>[number];

/** One detection gap in a sentence — shared by the tooltip and the panel. */
function describeDetectionUnknown(u: DetectionUnknown): string {
  if (u.kind === "trace_dead_ends") return `${u.count ?? "?"} traces reached no effect`;
  if (u.kind === "unknown_external_calls")
    return `calls into unmodeled packages: ${(u.packages ?? []).slice(0, 5).join(", ")}`;
  if (u.kind === "journey_gap") return `journey not composed: ${u.expected}${u.queue ? ` (${u.queue})` : ""}`;
  if (u.kind === "doc_conflict")
    return `docs out of date: ${(u as { doc?: string }).doc ?? "?"} mentions ${(u as { claim?: string }).claim ?? "?"} (${(u as { class?: string }).class ?? "claim"} not found)`;
  return u.kind.replace(/_/g, " ");
}

/** Section gaps rolled up by kind, with the sections that raised each one. */
function packageGapRows(
  sections: OnboardingSection[],
): Array<{ kind: string; count: number; sections: string[] }> {
  const byKind = new Map<string, { kind: string; count: number; sections: string[] }>();
  for (const section of sections) {
    // `unknownGroups` is the deduped view; fall back for payloads without it.
    const groups: Array<{ kind: string; count: number }> = section.unknownGroups?.length
      ? section.unknownGroups
      : (section.unknowns ?? []).map((u) => ({ kind: u.kind, count: 1 }));
    for (const group of groups) {
      const row = byKind.get(group.kind) ?? { kind: group.kind, count: 0, sections: [] };
      row.count += group.count;
      if (!row.sections.includes(section.label)) row.sections.push(section.label);
      byKind.set(group.kind, row);
    }
  }
  return [...byKind.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/**
 * Tooltip keeps the arithmetic, the panel carries the items — split in two
 * because the coverage strip is `lg:flex-nowrap`: a `w-full` panel inside it
 * would either wrap the strip (breaking the 31px the sidebar divider is
 * aligned to) or scroll sideways with the counts. The toggle stays in the
 * strip, the panel is its own band under it, the page owns the open state.
 */
export function PackageGapsToggle({
  coverage,
  open,
  onToggle,
}: {
  coverage: PackageCoverage;
  open: boolean;
  onToggle: () => void;
}) {
  const total = coverage.gaps?.total ?? coverage.detectionUnknowns?.length ?? 0;
  if (total === 0) return null;
  const detection = coverage.detectionUnknowns ?? [];

  return (
    <>
      <span aria-hidden>·</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls="package-known-gaps"
            className="inline-flex items-center gap-1 rounded text-warning underline decoration-dotted underline-offset-2 hover:text-warning/80"
          >
            <ChevronDown
              className={cn("h-3 w-3 shrink-0 transition-transform duration-150", !open && "-rotate-90")}
              aria-hidden
            />
            {total} known gap{total === 1 ? "" : "s"} in this package
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-80">
          {coverage.gaps && (
            <p className="mb-1 font-medium">
              {coverage.gaps.total} things this analysis knows it could not determine, across the
              whole package: {coverage.gaps.sections} raised while writing the sections (each section
              lists its own share under &ldquo;known gaps in this section&rdquo;; grouped into{" "}
              {coverage.gaps.groups} kinds in total)
              {coverage.gaps.detection > 0 ? ` and ${coverage.gaps.detection} found by detection:` : "."}
            </p>
          )}
          {detection.map(describeDetectionUnknown).join(" · ")}
        </TooltipContent>
      </Tooltip>
    </>
  );
}

/** The items behind the count, in a band of their own below the strip. */
export function PackageGapsPanel({
  coverage,
  sections,
}: {
  coverage: PackageCoverage;
  sections: OnboardingSection[];
}) {
  const total = coverage.gaps?.total ?? coverage.detectionUnknowns?.length ?? 0;
  if (total === 0) return null;
  const rows = packageGapRows(sections);
  const detection = coverage.detectionUnknowns ?? [];

  return (
    <div className="border-b bg-muted/20 px-3 py-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground sm:px-4 lg:px-5">
      {/* A dot per row: at 85ch a row with several section names wraps, and a
          wrapped row with no start marker ran into the one below it. */}
      <ul id="package-known-gaps" className="space-y-1">
        {rows.map((row) => (
          <li key={row.kind} className="flex max-w-[85ch] items-start gap-1.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
            <span className="min-w-0">
              <span className="font-medium text-foreground/80">
                {UNKNOWN_LABELS[row.kind] ?? row.kind.replace(/_/g, " ")}
              </span>
              <span className="ml-1.5 rounded bg-muted px-1 tabular-nums">× {row.count}</span>
              {/* Which sections raised it — the section footers hold the wording. */}
              <span className="ml-1.5">in {row.sections.join(", ")}</span>
            </span>
          </li>
        ))}
        {detection.map((u, ui) => (
          <li key={`detection-${ui}`} className="flex max-w-[85ch] items-start gap-1.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
            <span className="min-w-0">
              <span className="font-medium text-foreground/80">{describeDetectionUnknown(u)}</span>
              <span className="ml-1.5">found by detection</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * CONSULT sections are deterministic reference tables. Zero receipts is their
 * CORRECT state — "the table is the evidence" (audit §8.1/A13) — so they get
 * a provenance sentence instead of the self-indicting "no receipts; content
 * is not independently verifiable" framing.
 *
 * Superseded by the served `generationMode`, which reads the generator's own
 * stamp instead of guessing from an id list: this set named four sections and
 * an AI-disabled package makes ALL twelve deterministic. Kept only as the
 * fallback for packages fetched from an API build that predates the field.
 */
const REFERENCE_SECTION_IDS = new Set<string>(["routes-jobs", "data-model", "guardrails-ops", "data-schema"]);

/**
 * The coverage sentence, stated in terms of what was actually read.
 *
 * This line used to say "Analyzed N files" using the count of every file in
 * scope — assets, markdown and lockfiles included — which overstated coverage
 * by up to 9x on audited projects and read as a claim that the whole repo had
 * been understood. It now leads with the parsed count, names the languages
 * that were skipped instead of burying them in an "unsupported" total, and
 * says "unknown" for snapshots taken before the parsed count was recorded
 * rather than substituting the old inflated number.
 */
function CoverageFiles({
  files,
  languages,
}: {
  files: PackageCoverage["files"];
  languages: LanguageInventory | null;
}) {
  const skipped = Object.entries(languages?.unsupported ?? {})
    .sort((a, b) => b[1] - a[1]);
  const skippedLabel = skipped.slice(0, 3).map(([lang, n]) => `${lang} ${n}`).join(", ");
  const skippedRest = skipped.length > 3 ? ` +${skipped.length - 3} more` : "";

  if (files.parsed === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2">
            File coverage unknown for this snapshot
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-80">
          This analysis predates coverage measurement. {files.inScope} files were in scope, but how
          many were parsed was not recorded. Re-analyze to measure it.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2">
          Parsed <span className="font-medium text-foreground">{files.parsed}</span> of {files.inScope} files
          {files.unsupported ? ` · ${files.unsupported} skipped` : ""}
          {skippedLabel ? ` (${skippedLabel}${skippedRest})` : ""}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-80">
        Everything in this package is derived from the {files.parsed} files the parser read
        {files.supported !== null ? `, of ${files.supported} counted as source in a supported language` : ""}.
        The rest of the {files.inScope} files in scope are assets, docs, lockfiles, and languages
        OnboardBuddy does not parse. Nothing here describes them.
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * "How packages work" tour: the transparency contract for package lifecycle.
 * What identifies a package, when regenerating updates one in place, what a
 * new commit does on its own (re-check, never rewrite), and what the AI &
 * privacy setting changes. Bodies are split into paragraphs with a blank
 * line: AppTour renders each as its own <p>, and these are the longest
 * bodies in the app.
 */
const LIFECYCLE_TOUR_STEPS: TourStep[] = [
  {
    target: "onboarding-header",
    title: "What makes a package a package",
    body: "A package is one generated reading path, and its identity is the whole of branch, scope, role, and analysis depth. Change any one of those and you get a different package, not an edited version of this one.\n\nEach package is also pinned to the exact commit it was analyzed at, so a card always tells you which code it describes.",
  },
  {
    target: "onboarding-cards",
    title: "Regenerating updates a card in place",
    body: "Generating the same package again at the same commit rewrites its sections in place and keeps the same card. Nothing is discarded and no second card appears.\n\nUnchanged content comes from cache, so a regeneration pays for the parts that actually changed.",
  },
  {
    target: "onboarding-cards",
    title: "A new commit re-checks, then you generate",
    body: "Analyzing a new commit re-checks the packages you already have: only sections whose underlying code evidence changed get a stale badge, and whitespace-only edits flag nothing. Staleness is branch-scoped, so re-analyzing a feature branch never stale-flags your main package.\n\nThe card for the new commit appears once you generate at that commit. Older cards stay, marked 'behind latest', so what your team already read is still there. Rebuilding is your call: a card with stale content offers 'Regenerate only the stale sections', or you can turn on 'Auto-regenerate stale sections' in project settings.",
  },
  {
    target: "onboarding-filters",
    title: "Privacy decides HOW, not WHETHER",
    body: "The AI & privacy setting applies to the very next generation, with no re-analysis needed.\n\nFull AI narrates with code snippets, facts-only sends no code to the model, and AI-disabled builds deterministic fact sheets with zero LLM calls.",
  },
];

/** First visit to the READER: how to move through and track a package. */
const READER_TOUR_STEPS: TourStep[] = [
  {
    target: "reader-sections",
    title: "Your reading path",
    body: "Sections are ordered for onboarding, so work top-down (or use ← / →). A warning icon means a section went stale after a newer analysis.",
  },
  {
    target: "reader-review",
    title: "Track what you've read",
    body: "Mark each section as you finish it; your personal reading progress shows in the section list, whatever your role.\n\nOwners and admins also get a separate 'Mark reviewed' button, an editorial signal to the whole team. If a regeneration changes a section it drops back to draft, so everyone knows to re-read it.",
  },
  {
    target: "reader-actions",
    title: "Export or refresh",
    body: "Download the whole package as Markdown here. Owners and admins can also rebuild a single section against the newest analysis with 'Regenerate section'.",
  },
];

// ── section reader ────────────────────────────────────────────────────────────

/**
 * The reader already shows the section title in the sticky top bar; when the
 * generated markdown opens with the same heading, drop it — the audit's
 * "page header + h1 + h2 stack" is three copies of one string.
 */
function stripLeadingDuplicateHeading(body: string, title: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const m = lines[i]?.match(/^#{1,3}\s+(.*?)\s*$/);
  if (!m) return body;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(m[1]!) === norm(title) ? lines.slice(i + 1).join("\n") : body;
}

function initialBlockExpansion(section: OnboardingSection): boolean[] {
  return section.blocks.map((_, i) => i === 0);
}

/**
 * The generator opens every section with a "**TL;DR:** …" paragraph
 * (Diátaxis presentation rule 2); the reader renders it as a callout box
 * instead of body prose. Returns null when the body doesn't start with one.
 */
function splitTldr(body: string): { tldr: string; rest: string } | null {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith("**TL;DR:**")) return null;
  // The TL;DR paragraph ends at a blank line OR at the next line that starts
  // a heading — generators sometimes emit "### Heading" straight after the
  // TL;DR with only a single newline, and slicing on blank lines alone
  // rendered a literal "### Table groups" inside the callout
  // (READER_REDESIGN.md N5, seen live on MasterPokedex data_model).
  const m = /\n[\t ]*\n|\n(?=#{1,6}\s)/.exec(trimmed);
  let tldrPara = m ? trimmed.slice(0, m.index) : trimmed;
  let rest = m ? trimmed.slice(m.index).replace(/^\s+/, "") : "";
  // The same failure squeezed onto ONE line: "…relationships. ### Table groups".
  const inlineHeading = tldrPara.search(/\s#{1,6}\s/);
  if (inlineHeading > -1) {
    rest = [tldrPara.slice(inlineHeading).trim(), rest].filter(Boolean).join("\n\n");
    tldrPara = tldrPara.slice(0, inlineHeading);
  }
  return { tldr: tldrPara.replace(/^\*\*TL;DR:\*\*\s*/, ""), rest };
}

/**
 * Owner feedback K1: known gaps and the per-block citation lists "should be
 * there, but should only show up on demand". Nothing is deleted — each list
 * moves behind a button that names its size, so the reader can see that N
 * gaps / N citations exist without the detail taking over the page (the audit
 * measured one gaps block at 63% of its section — §19.4 — and a 43-chip
 * citation footer rendered all at once — §19.3).
 */
function DisclosureButton({
  open,
  onToggle,
  label,
  icon,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  icon?: ReactNode;
  controls: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="-mx-1 inline-flex items-center gap-1.5 rounded px-1 py-1 text-[0.71875rem] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
    >
      <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform duration-150", !open && "-rotate-90")} />
      {icon}
      {label}
    </button>
  );
}

/**
 * Sections that retell what an interactive tab already shows link to it
 * (audit §8): the prose is the narrative, the tab is the reference.
 */
/**
 * The handoff from "read about it" to "go look at it".
 *
 * This only ever listed the LEGACY section ids (`architecture`,
 * `dependency-graph`, `capability-map`, `workflows`, `data-schema`). None of
 * them is one of the twelve ids a current package actually contains, so every
 * package generated against the Diátaxis schema silently lost the link out to
 * the interactive tab — the sections are deliberately the narrative and the
 * tabs are deliberately the complete data, and the bridge between them was
 * pointing at a schema that no longer ships.
 *
 * Current ids first; the legacy entries stay because legacy packages are still
 * rendered.
 */
const TAB_FOR_SECTION: Partial<Record<SectionId, { path: string; label: string }>> = {
  // ── current (Diátaxis) ──────────────────────────────────────────────────
  "architecture-deep": { path: "architecture", label: "Explore the interactive cluster map in the Architecture tab" },
  "traced-flows": { path: "workflows", label: "See every traced flow, ranked, in the Workflows tab" },
  "code-map": { path: "dependencies", label: "Browse the full symbol graph in the Dependencies tab" },
  capabilities: { path: "capabilities", label: "Open the Capabilities tab for flows and starting points" },
  "routes-jobs": { path: "workflows", label: "See these entry points as traced flows in the Workflows tab" },
  "data-model": { path: "dependencies", label: "Trace table accessors in the Dependencies tab" },
  // ── legacy (11-section packages still render) ───────────────────────────
  architecture: { path: "architecture", label: "Explore the interactive cluster map in the Architecture tab" },
  "dependency-graph": { path: "dependencies", label: "Browse the full symbol graph in the Dependencies tab" },
  "capability-map": { path: "capabilities", label: "Open the Capabilities tab for flows and starting points" },
  workflows: { path: "workflows", label: "See every traced flow in the Workflows tab" },
  "data-schema": { path: "dependencies", label: "Trace table accessors in the Dependencies tab" },
};

/** Exported for the reader disclosure test (K1). */
export function SectionView({
  section,
  projectId,
  onReceiptClick,
}: {
  section: OnboardingSection;
  projectId?: string;
  onReceiptClick: (r: SourceReceipt) => void;
}) {
  const [expanded, setExpanded] = useState<boolean[]>(() => initialBlockExpansion(section));
  // K1: citations per block and the gaps list start collapsed on every
  // section, so switching sections never re-opens them.
  const [citationsOpen, setCitationsOpen] = useState<boolean[]>(() => section.blocks.map(() => false));
  const [gapsOpen, setGapsOpen] = useState(false);
  // A10: the API dedupes gaps onto their templates. Payloads generated before
  // it shipped carry only the flat list — degrade to one row per entry rather
  // than hiding gaps we cannot group.
  const gapGroups: SectionGapGroup[] = section.unknownGroups?.length
    ? section.unknownGroups
    : (section.unknowns ?? []).map((u) => ({
        kind: u.kind,
        count: 1,
        variants: [
          { signature: u.kind, count: 1, detail: u.detail ?? null, members: u.detail ? [u.detail] : [] },
        ],
      }));

  useLayoutEffect(() => {
    setExpanded(initialBlockExpansion(section));
    setCitationsOpen(section.blocks.map(() => false));
    setGapsOpen(false);
  }, [section.id, section.sectionId]);

  if (section.status === "missing") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <XCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
        <h2 className="text-sm font-medium text-foreground">Section not generated</h2>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          This section hasn't been generated yet. Generate the full package or regenerate this section individually.
        </p>
      </div>
    );
  }

  const hasSecondaryBlocks = section.blocks.length > 1;
  const secondaryExpanded = expanded.slice(1);
  const allSecondaryExpanded = secondaryExpanded.length > 0 && secondaryExpanded.every(Boolean);

  const leadBlock = section.blocks[0];
  const leadBody = leadBlock ? stripLeadingDuplicateHeading(leadBlock.body, section.label) : "";
  const leadSplit = leadBlock ? splitTldr(leadBody) : null;

  // A13: deterministic reference sections aren't "unverifiable AI prose" —
  // zero receipts is their CORRECT state (the table is the evidence), and the
  // old pill said the opposite on the three most mechanically verifiable
  // sections in the package. The API now says which generator wrote each
  // section; the id-list heuristic only runs for payloads served before it.
  const totalReceipts = section.blocks.reduce((n, b) => n + b.receipts.length, 0);
  const referenceProvenance = section.generationMode
    ? section.generationMode === "deterministic"
    : REFERENCE_SECTION_IDS.has(section.id) && totalReceipts === 0;
  const displayReason = referenceProvenance
    ? // "The tables are the source" is true of the CONSULT sections and of
      // nothing else. Now that any section can come back deterministic — an
      // AI-off package makes all twelve — the other nine get the sentence
      // that is actually true of them, in the package banner's own words.
      REFERENCE_SECTION_IDS.has(section.id)
      ? "built from code facts, the tables are the source"
      : "built from code facts, extracted directly by static analysis"
    : section.confidenceReason;

  // One `a` override shared by the TL;DR callout and every block body.
  const anchorComponents = (receipts: SourceReceipt[]): MarkdownComponents => ({
    a: receiptAnchor(receipts, onReceiptClick),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {referenceProvenance ? (
          <>
            {/* The "Reference" badge said what KIND of section this was and
                buried who made it in a tooltip on the sentence beside it. The
                chip says who made it, in the same two tones every other
                surface uses, and carries that sentence itself. */}
            <SourceMark
              source="code"
              tip="Deterministic reference facts, generated from the analyzed code, not narrated by the model"
            />
            {displayReason && (
              // The grade's mechanical basis, inline (audit §3.6) — a label
              // without its reason reads as theater.
              <span className="text-[0.6875rem] text-muted-foreground">{displayReason}</span>
            )}
          </>
        ) : (
          <>
            {/* Two different facts, so two marks: the pie says how well cited
                the prose is, the chip says a model wrote it. Collapsing them
                loses one of the two questions a reader actually asks. */}
            <SourceMark source="ai" />
            {/* The pie IS the grade: the word "medium" told nobody what was
                measured, while the ratio it stands for (claims that cite a
                receipt) was sitting unread in the reason string beside it. One
                tooltip for both, so the picture always arrives with its sentence. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex cursor-help items-center gap-1.5 rounded-sm">
                  <ConfidencePie level={section.confidence} claims={section.claims} />
                  {displayReason && (
                    <span className="text-[0.6875rem] text-muted-foreground">{displayReason}</span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72 text-left">
                <p className="font-medium">{CONFIDENCE_WORD[section.confidence]} confidence</p>
                {/* The reason string is already visible in the trigger beside the
                    pie, so the tooltip carries what the grade means instead. */}
                <p className="mt-0.5">{CONFIDENCE_MEANING[section.confidence]}</p>
              </TooltipContent>
            </Tooltip>
          </>
        )}
        {section.status === "stale" && (
          <Badge variant="outline" className={cn("text-[0.6875rem]", STATUS_STYLE.stale)}>
            <AlertTriangle className="mr-1 h-2.5 w-2.5" />
            Stale
          </Badge>
        )}
        {section.reviewedBy && (
          <span className="text-xs text-muted-foreground">
            Reviewed by <span className="font-medium text-foreground">{section.reviewedBy}</span>
          </span>
        )}
        {hasSecondaryBlocks && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            onClick={() =>
              setExpanded(allSecondaryExpanded ? initialBlockExpansion(section) : section.blocks.map(() => true))
            }
          >
            {allSecondaryExpanded ? "Collapse all" : "Expand all"}
          </Button>
        )}
      </div>

      {/* Sentence before picture (READER_REDESIGN.md §2): the lead block's
          TL;DR opens the section — J1's "headline first" — and the anchor
          diagram follows it, height-clamped with an Enlarge lightbox
          (E2/N12) instead of being the unexplained first thing a newcomer
          sees. */}
      {leadBlock && leadSplit && (
        <div className="max-w-[75ch] rounded-md border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-[0.875rem] leading-relaxed text-foreground">
          <span className="mr-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-primary/80">TL;DR</span>
          <SectionMarkdown
            components={{ ...anchorComponents(leadBlock.receipts), p: ({ children }) => <span>{children}</span> }}
          >
            {renderReceiptMarkers(leadSplit.tldr, leadBlock.receipts)}
          </SectionMarkdown>
        </div>
      )}
      {(section.diagrams ?? []).map((d, i) => (
        <DiagramFrame key={i} code={d.mermaid} label={`${d.kind.replace(/_/g, " ")} diagram`} projectId={projectId} />
      ))}

      {section.blocks.map((block, bi) => {
        const isLead = bi === 0;
        const canCollapse = hasSecondaryBlocks && !isLead;
        const isOpen = isLead || expanded[bi];
        // A11/N7: chips render only receipts that actually open somewhere.
        // Internal record references (no file path) are counted honestly in
        // the label instead of rendering as blank number-chips.
        const openable = block.receipts.filter((r) => !!r.filePath);
        const internalRefs = block.receipts.length - openable.length;
        const numberOf = receiptNumberById(block.receipts);
        // A11 / §19.3: state both numbers the way the audit asked for them —
        // "43 citations · 21 you can open". 69% of receipts on the audited
        // package were internal record references with no file at all, and
        // counting them as evidence inflated the trust signal.
        const citationLabel =
          openable.length > 0
            ? `${block.receipts.length} citation${block.receipts.length === 1 ? "" : "s"}${
                internalRefs > 0 ? ` · ${openable.length} you can open` : ""
              }`
            : `${internalRefs} internal reference${internalRefs === 1 ? "" : "s"} · none you can open`;
        return (
          <div key={bi}>
            {canCollapse ? (
              <button
                type="button"
                onClick={() => setExpanded((prev) => prev.map((v, i) => (i === bi ? !v : v)))}
                aria-expanded={isOpen}
                className="-mx-1 mb-1.5 flex w-full items-center gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-accent/40"
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150", !isOpen && "-rotate-90")}
                />
                <h2 className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold text-foreground">{block.title}</h2>
                {block.receipts.length > 0 && (
                  <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                    {block.receipts.length} source ref{block.receipts.length === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            ) : (
              // The lead block's title always equals the section label shown
              // in the sticky top bar — rendering it again is the duplicated
              // title stack the audit flagged.
              !isLead && <h2 className="mb-1.5 text-[0.875rem] font-semibold text-foreground">{block.title}</h2>
            )}

            <div className={cn("grid transition-[grid-template-rows] duration-200 ease-in-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <div className="overflow-hidden" inert={!isOpen}>
                {/* Reading measure (READER_REDESIGN.md §1.6): 15px/1.75 body
                    capped at ~70ch — the old 13.5px across the full column ran
                    ~110 characters per line. Tables and code stay full-width
                    ("artifact stage") and scroll inside their own containers. */}
                <div className="prose prose-sm dark:prose-invert mb-3 max-w-none text-[0.9375rem] leading-[1.75] text-muted-foreground prose-headings:max-w-[70ch] prose-headings:text-[1.0625rem] prose-headings:font-semibold prose-headings:text-foreground prose-p:max-w-[70ch] prose-p:my-2 prose-ul:max-w-[70ch] prose-ul:my-1.5 prose-ol:max-w-[70ch] prose-li:my-1 prose-strong:text-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.8125rem] prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:max-h-72 prose-pre:overflow-auto">
                  <SectionMarkdown components={anchorComponents(block.receipts)}>
                    {renderReceiptMarkers(isLead ? (leadSplit?.rest ?? leadBody) : block.body, block.receipts)}
                  </SectionMarkdown>
                </div>
                {/* K1: the full source list, on demand — the inline [N]
                    markers inside the prose stay where they are. */}
                {block.receipts.length > 0 && (
                  <div>
                    <DisclosureButton
                      open={!!citationsOpen[bi]}
                      onToggle={() => setCitationsOpen((prev) => prev.map((v, i) => (i === bi ? !v : v)))}
                      controls={`citations-${section.id}-${bi}`}
                      label={citationLabel}
                      icon={<FileCode2 className="h-3 w-3 shrink-0" aria-hidden />}
                    />
                    {citationsOpen[bi] &&
                      (openable.length > 0 ? (
                        <div id={`citations-${section.id}-${bi}`} className="mt-1.5 flex flex-wrap gap-1.5">
                          {openable.map((r, ri) => (
                            <ReceiptChip
                              key={ri}
                              receipt={r}
                              onClick={onReceiptClick}
                              index={numberOf.get(r.bundleReceiptId ?? "") ?? ri + 1}
                            />
                          ))}
                        </div>
                      ) : (
                        <p id={`citations-${section.id}-${bi}`} className="mt-1.5 text-[0.71875rem] text-muted-foreground">
                          These references point at internal analysis records with no file location, so there is nothing to open here.
                        </p>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Honest unknowns: gaps stated plainly instead of invented content.
          K1 — kept in full, but behind a disclosure whose label states the
          count, so their existence is visible and their bulk is not (the
          audit measured a 33-row gaps wall re-quoting its own section —
          §19.4 / READER_REDESIGN.md §1.4). */}
      {(section.unknowns ?? []).length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-2">
          <DisclosureButton
            open={gapsOpen}
            onToggle={() => setGapsOpen((v) => !v)}
            controls={`gaps-${section.id}`}
            // VISUAL QA M4 #6: this said "6 known gaps" while the trust
            // strip at the top of the same screen said "66 known gaps".
            // Both were right — this counts THIS section, the strip counts
            // the whole package — but neither said which, so one word
            // described two populations. Each number now names its scope.
            label={`${section.unknowns!.length} known gap${section.unknowns!.length === 1 ? "" : "s"} in this section${
              gapGroups.length < section.unknowns!.length
                ? ` · ${gapGroups.length} kind${gapGroups.length === 1 ? "" : "s"}`
                : ""
            }`}
            icon={<HelpCircle className="h-3 w-3 shrink-0" aria-hidden />}
          />
          {gapsOpen && (
            // A10 / §19.4: one row per gap KIND with its count, not one row
            // per entry. The audited section shipped 34 lines that differed
            // only by an env-var name; the API groups them on their template
            // (`api/lib/gapSummary.ts`, deterministic) so that becomes one
            // `× 34` row whose names sit inside it. Nothing is dropped — the
            // counts still sum to the disclosure label.
            <ul id={`gaps-${section.id}`} className="mt-1.5 space-y-1.5">
              {gapGroups.map((group, gi) => (
                <li key={gi} className="max-w-[75ch] text-[0.75rem] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground/80">
                    {UNKNOWN_LABELS[group.kind] ?? group.kind.replace(/_/g, " ")}
                  </span>
                  {group.count > 1 && (
                    <span className="ml-1.5 rounded bg-muted px-1 text-[0.6875rem] tabular-nums text-muted-foreground">
                      × {group.count}
                    </span>
                  )}
                  {!DETAIL_SUPPRESSED_KINDS.has(group.kind) && (
                    <ul className="mt-0.5 space-y-0.5 pl-3">
                      {group.variants.map((variant, vi) => {
                        const detail = (variant.detail ?? "").trim();
                        if (detail === "") return null;
                        // Details are stored truncated at a fixed length and
                        // used to render cut mid-word ("…processing throug") —
                        // an ellipsis marks the cut honestly until the backend
                        // stores full text (READER_REDESIGN.md N3).
                        const clipped = !/[.!?)\]"'`]$/.test(detail);
                        // Same sentence, different identifier: name them
                        // inline rather than repeating the sentence per name.
                        const others = variant.members.slice(1);
                        return (
                          // A dot per item: these details run to several lines
                          // at reading width, and indentation alone gave a
                          // wrapped item no start marker, so two gaps read as
                          // one paragraph.
                          <li key={vi} className="flex items-start gap-1.5 text-muted-foreground">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                            <span className="min-w-0">
                              {detail}
                              {clipped ? "…" : ""}
                              {variant.count > 1 && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  (× {variant.count}
                                  {others.length > 0
                                    ? `: ${others.slice(0, 8).join(", ")}${others.length > 8 ? `, +${others.length - 8} more` : ""}`
                                    : ""}
                                  )
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tab deep-link: prose narrates, the tab is the reference (audit §8) */}
      {projectId && TAB_FOR_SECTION[section.id] && (
        <Link
          to={`/projects/${projectId}/${TAB_FOR_SECTION[section.id]!.path}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[0.78125rem] font-medium text-primary transition-colors hover:border-primary/50 hover:bg-accent/40"
        >
          {TAB_FOR_SECTION[section.id]!.label}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

// ── package cards ─────────────────────────────────────────────────────────────

export function PackageCardView({
  card,
  to,
  onOpen,
  onSelect,
  onRegenerate,
}: {
  card: PackageCard;
  /** Absolute reader URL for this package. The scope name is a real link, so
   *  middle-click, Cmd-click and "open in new tab" work here like on any other
   *  row, and the keyboard reaches the card through it rather than through a
   *  div wearing role="button" (ProjectCard's precedent). */
  to: string;
  onOpen: () => void;
  /** Pin the sidebar selection to this package. The link owns navigation, so
   *  this runs the part of `onOpen` a plain href cannot do. */
  onSelect: () => void;
  onRegenerate?: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        // The card body stays clickable, but it is a surface, not a control:
        // the scope link and the Regenerate button handle their own clicks,
        // and selecting text inside the card (a commit sha, a scope name)
        // must not navigate out from under the selection.
        if ((e.target as Element).closest("a,button")) return;
        if (window.getSelection()?.toString()) return;
        onOpen();
      }}
      className="group flex cursor-pointer select-text flex-col rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-foreground">
            <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Link
              to={to}
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              className="truncate rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {card.scope_name}
            </Link>
          </p>
          <p className="mt-0.5 text-[0.71875rem] text-muted-foreground">
            {roleTitle(card.role)}
          </p>
        </div>
        <StatusBadge status={card.status} />
      </div>

      <div className="mt-3 flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
        <GitCommitHorizontal className="h-3 w-3" />
        <span className="truncate font-mono">{card.branch}@{card.analyzed_commit.slice(0, 7)}</span>
        {card.is_latest_commit ? (
          <span className="text-success">latest</span>
        ) : (
          <span className="text-warning">behind latest</span>
        )}
        <span className="ml-auto shrink-0">{new Date(card.updated_at).toLocaleDateString()}</span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-[0.71875rem] tabular-nums text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3 w-3" /> {card.section_count} sections
        </span>
        <span className="inline-flex items-center gap-1">
          <Route className="h-3 w-3" /> {card.tutorial_count} tutorials
        </span>
        {card.stale_sections > 0 && (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3 w-3" /> {card.stale_sections} stale
          </span>
        )}
        {onRegenerate && (
          <Button
            variant="ghost"
            size="xs"
            className="-my-1 ml-auto text-muted-foreground hover:text-foreground"
            disabled={card.status === "generating"}
            onClick={(e) => {
              e.stopPropagation();
              onRegenerate();
            }}
          >
            <RefreshCw className={cn("h-3 w-3", card.status === "generating" && "animate-spin")} />
            {card.status === "generating" ? "Generating…" : "Regenerate…"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export function OnboardingPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { project, refetch } = useProject();
  const {
    packages: cards,
    packagesError,
    refreshPackages,
    selectPackage,
    selectedPackageId,
    registerSessionJob,
  } = usePackages();

  const view = searchParams.get("view") ?? "cards";
  // The reader draws its own wall-to-wall dividers (top bar, coverage strip,
  // section rail), which the shell's <main> padding would inset. The cards
  // view is an ordinary padded page.
  useFullBleedMain(view === "reader");
  const selectedRole = searchParams.get("role") ?? project?.developer_role ?? FALLBACK_ROLE;
  // ?package=<id> pins the reader to one exact package (set when opening a
  // card); legacy ?role= links keep the old "latest for role" behavior.
  const selectedPackageParam = searchParams.get("package");

  const cardsLoading = cards === null;
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [freshFilter, setFreshFilter] = useState("all");

  // Deep link / resume: ?section= opens the reader at a specific section.
  // The default is the new layout's opener; a loaded package whose sections
  // don't include the active id snaps to its first present section below
  // (covers legacy packages and stale deep links).
  const [activeSectionId, setActiveSectionId] = useState<SectionId>(
    () => (searchParams.get("section") as SectionId) ?? "big-picture",
  );
  const [pkg, setPkg] = useState<OnboardingPackage | null>(null);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeInitialRole, setAnalyzeInitialRole] = useState<string | undefined>(undefined);
  // Per-package regeneration dialog (opened from a package card).
  const [regenCard, setRegenCard] = useState<PackageCard | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenError, setRegenError] = useState("");
  // Reader-level generate/regenerate failures — silently swallowing these
  // made "Regenerate" look like it did nothing (e.g. permission errors).
  const [actionError, setActionError] = useState("");
  // "How packages work" lifecycle tour (cards view).
  const [lifecycleTourOpen, setLifecycleTourOpen] = useState(false);
  const { user } = useAuth();
  const [receiptModal, setReceiptModal] = useState<SourceReceipt | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  // Bug #68: three distinct states the reader used to collapse into one.
  // `pkgError` holds the failure message (null = no failure); `pkgLoading` is
  // true until the first fetch of the CURRENT selection resolves. Without the
  // second one the "No package — Generate" pane painted for a beat on every
  // load and every package switch, because `pkg` starts null.
  const [pkgError, setPkgError] = useState<{ message: string; gone: boolean } | null>(null);
  const [pkgLoading, setPkgLoading] = useState(true);
  // Bug #22: the live "sections are landing" poll gave up silently. These two
  // make giving up visible and undoable — `livePollAttempt` re-arms the effect.
  const [livePollStalled, setLivePollStalled] = useState(false);
  const [livePollAttempt, setLivePollAttempt] = useState(0);
  const generateRolePollRef = useRef<number | null>(null);
  // Bug #68 (4): the regenerate-section poll was a local `setInterval` handle,
  // so navigating away mid-regeneration left it firing every 4s for the full
  // two-minute timeout, against an unmounted component.
  const regenPollRef = useRef<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  // Lives here, not in the strip: the toggle sits inside the nowrap coverage
  // strip and the panel it opens is a band below it, so the two halves need a
  // shared owner.
  const [pkgGapsOpen, setPkgGapsOpen] = useState(false);
  const {
    items: progressItems,
    loaded: progressLoaded,
    loadError: progressLoadError,
    save: saveProgress,
  } = useProgress(id);

  // Per-user read tracking (any tier): which sections of THIS package this
  // member has marked as read. Lives in user_progress.position — the same
  // row that powers "Continue onboarding" — so no schema is involved.
  // null = not initialized yet; saving before init would wipe stored marks.
  const [readSections, setReadSections] = useState<string[] | null>(null);
  // Which package readSections currently describes. State, not a ref, so the
  // save effect below sees a consistent (marks, package) pair within a commit:
  // on a package switch it stands down for one render instead of filing the
  // old package's marks under the new id.
  const [readSectionsPkg, setReadSectionsPkg] = useState<string | null>(null);
  useEffect(() => {
    if (!pkg?.id || !progressLoaded) return;
    const item = progressItems.find((p) => p.kind === "onboarding" && p.ref_id === pkg.id);
    const stored = Array.isArray(item?.position?.readSections)
      ? (item!.position.readSections as string[])
      : [];
    if (readSectionsPkg === pkg.id) {
      // Same package: a progress refetch can lag marks made locally between
      // saves, so merge instead of dropping them.
      setReadSections((prev) => [...new Set([...(prev ?? []), ...stored])]);
    } else {
      // First init or a package switch: the stored marks ARE the state.
      // Merging here bled one package's marks into the next, and the save
      // effect then persisted that union under the new package's id.
      setReadSections(stored);
      setReadSectionsPkg(pkg.id);
    }
  }, [pkg?.id, progressItems, progressLoaded, readSectionsPkg]);

  // Remember where the reader is so "Continue onboarding" resumes here.
  useEffect(() => {
    if (view !== "reader" || !pkg?.id || pkg.status === "missing" || readSections === null) return;
    // Marks that describe a different package must never be written under
    // this one's id (the render right after a package switch).
    if (readSectionsPkg !== pkg.id) return;
    saveProgress("onboarding", pkg.id, {
      sectionType: activeSectionId,
      role: pkg.role ?? selectedRole,
      packageId: pkg.id,
      readSections,
    });
  }, [view, pkg?.id, pkg?.role, pkg?.status, activeSectionId, selectedRole, readSections, readSectionsPkg, saveProgress]);

  // `replace` by default — a role or package tweak refines the current view. Only a
  // view boundary passes `{ replace: false }`, or Back leaves the tab entirely.
  function setParams(next: Record<string, string | null>, options?: { replace?: boolean }) {
    setSearchParams((prev) => {
      for (const [k, v] of Object.entries(next)) {
        if (v === null) prev.delete(k);
        else prev.set(k, v);
      }
      return prev;
    }, { replace: options?.replace ?? true });
  }

  // Package list + its while-generating refresh live in PackagesContext (the
  // one shared poll); this page only re-requests on explicit actions.
  const loadCards = refreshPackages;

  const loadPkg = useCallback(() => {
    if (!id || view !== "reader") return;
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setPkgError(null);
    setPkgLoading(true);
    fetchOnboardingPackage(id, { packageId: selectedPackageParam, role: selectedRole })
      .then((data) => { if (!controller.signal.aborted) setPkg(data); })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // A pinned `?package=` that 404s is a genuinely gone package, not a
        // transient fault — retrying it forever cannot help, so that case
        // gets its own copy and sends the reader back to the package list.
        const gone = err instanceof ApiError && err.status === 404;
        setPkgError({
          message: err instanceof Error ? err.message : "Failed to load this package",
          gone,
        });
        // Do not leave stale content from a previous selection on screen
        // under an error banner that describes a different package.
        setPkg(null);
      })
      .finally(() => { if (!controller.signal.aborted) setPkgLoading(false); });
  }, [id, selectedRole, selectedPackageParam, view]);

  useEffect(() => {
    loadPkg();
    return () => { fetchAbortRef.current?.abort(); };
  }, [loadPkg]);

  // ── M3: the reader follows the sidebar package chooser ────────────────────
  // The reader read only its own `?package=` param, so picking a different
  // package (or "Latest analysis") in the chooser that promises "every tab
  // follows this selection" changed nothing here — no refetch, no re-render,
  // verified live on 2026-07-26. On entering the reader the URL wins once (a
  // resume/deep link is an explicit request for THAT package, and it is
  // adopted as the project-wide selection so the other tabs agree); after
  // that the chooser drives the URL, which drives `loadPkg`.
  const readerSelectionSynced = useRef(false);
  useEffect(() => {
    if (view !== "reader") { readerSelectionSynced.current = false; return; }
    if (cards === null) return;
    if (!readerSelectionSynced.current) {
      readerSelectionSynced.current = true;
      if (selectedPackageParam && selectedPackageParam !== selectedPackageId) {
        selectPackage(selectedPackageParam);
      }
      return;
    }
    if ((selectedPackageId ?? null) !== (selectedPackageParam ?? null)) {
      setParams({ package: selectedPackageId });
    }
  }, [view, cards, selectedPackageId, selectedPackageParam, selectPackage]);

  useEffect(() => {
    setGenerating(project?.status === "analyzing");
  }, [project?.status]);

  // Ensure the generate-role and regenerate-section polls (below) never keep
  // running after unmount.
  useEffect(() => () => {
    if (generateRolePollRef.current) window.clearInterval(generateRolePollRef.current);
    if (regenPollRef.current) window.clearInterval(regenPollRef.current);
  }, []);

  // Sections persist one by one while the package is generating — poll so
  // they appear as they land instead of only after the whole run finishes.
  //
  // Bug #22: this poll's ancestor (the per-role status poll) carried a bare
  // `.catch(() => {})`, so a poll that could no longer reach the server went
  // on running forever, reporting nothing. The contract now is the one the
  // bug asked for — *show an error or stop polling* — and it does both, but
  // only after the failure is real: a single dropped tick is normal mid-run,
  // so one failure is ignored and the sections on screen are left alone.
  // Three consecutive failures stop the interval and say so, with a retry.
  // Nothing here ever clears `pkg`: this poll must not be able to invent an
  // empty state (#68). The failure that matters on first paint is `loadPkg`'s.
  useEffect(() => {
    if (!id || view !== "reader") return;
    if (pkg?.status !== "generating" && !generating) return;
    let consecutiveFailures = 0;
    const timer = window.setInterval(() => {
      fetchOnboardingPackage(id, { packageId: selectedPackageParam, role: selectedRole })
        .then((data) => {
          consecutiveFailures = 0;
          setLivePollStalled(false);
          setPkg(data);
          if (data.status !== "generating" && data.status !== "missing") loadCards();
        })
        .catch(() => {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 3) {
            window.clearInterval(timer);
            setLivePollStalled(true);
          }
        });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [id, view, selectedRole, selectedPackageParam, pkg?.status, generating, livePollAttempt]);

  // First visit to the package grid: auto-run the "How packages work" tour —
  // but only after the project-level tour was dismissed, so two spotlight
  // overlays never stack on a brand-new account's first project visit.
  useEffect(() => {
    if (view === "reader" || cardsLoading || !user) return;
    if (consumeTourRequest("onboardingLifecycle")) { setLifecycleTourOpen(true); return; }
    if (!tourDismissed("project", user.id)) return;
    if (tourDismissed("onboardingLifecycle", user.id)) return;
    setLifecycleTourOpen(true);
  }, [view, cardsLoading, user]);

  function finishLifecycleTour() {
    if (user) dismissTour("onboardingLifecycle", user.id);
    setLifecycleTourOpen(false);
  }

  const canManage = project?.permission_tier === "owner" || project?.permission_tier === "admin";
  // Bug #68: `isMissing` still means "nothing to render" for the chrome that
  // needs a package, but it is no longer the same thing as "no package
  // exists". The content pane below picks apart the three reasons it can be
  // true — still loading, the request failed, or the package really is absent
  // — and only the last one offers the billed Generate button.
  const isMissing = !pkg || pkg.status === "missing";
  const sections = isMissing ? [] : pkg.sections;
  const activeSection = sections.find((s) => s.id === activeSectionId);
  const markedReviewed = activeSection?.reviewStatus === "approved";
  const isSectionRead = readSections?.includes(activeSectionId) ?? false;

  // Personal read mark — every member gets a progress tracker (the reader
  // tour promises one; owner/admin "Mark reviewed" is an editorial action,
  // not this). Saved via the auto-save effect above.
  function handleToggleRead() {
    if (readSections === null) return;
    setReadSections((prev) => {
      const cur = prev ?? [];
      return cur.includes(activeSectionId)
        ? cur.filter((s) => s !== activeSectionId)
        : [...cur, activeSectionId];
    });
  }

  // First reader visit: a 3-step coach mark (reading path → mark reviewed →
  // export/regenerate). Only after the project tour, and only with content.
  const [readerTourOpen, setReaderTourOpen] = useState(false);
  useEffect(() => {
    if (view !== "reader" || isMissing || sections.length === 0 || !user) return;
    if (consumeTourRequest("onboardingReader")) { setReaderTourOpen(true); return; }
    if (!tourDismissed("project", user.id)) return;
    if (tourDismissed("onboardingReader", user.id)) return;
    setReaderTourOpen(true);
  }, [view, isMissing, sections.length, user]);
  function finishReaderTour() {
    if (user) dismissTour("onboardingReader", user.id);
    setReaderTourOpen(false);
  }

  // ← / → move through the present sections while reading, in the same
  // order they appear in the grouped nav (SECTION_GROUPS), so hotkeys, the
  // nav numbering, and the prev/next pager all agree on adjacency.
  const presentSectionIds = SECTION_GROUPS.flatMap((g) => g.ids).filter((navId) => sections.some((s) => s.id === navId));
  // Active id not in this package (legacy layout, stale deep link) — snap to
  // the package's first section instead of rendering an empty reader.
  useEffect(() => {
    if (presentSectionIds.length > 0 && !presentSectionIds.includes(activeSectionId)) {
      setActiveSectionId(presentSectionIds[0]!);
    }
    // Deps are deliberately the JOINED id list, not the array: a new array
    // identity every render would re-run this on every render. (This carried an
    // eslint-disable for react-hooks/exhaustive-deps, but that plugin is not in
    // this project's eslint config, so the directive itself was the lint error.)
  }, [presentSectionIds.join(","), activeSectionId]);
  const moveSection = (delta: number) => {
    const idx = presentSectionIds.indexOf(activeSectionId);
    const next = presentSectionIds[Math.min(Math.max((idx === -1 ? 0 : idx) + delta, 0), presentSectionIds.length - 1)];
    if (next && next !== activeSectionId) setActiveSectionId(next);
  };
  /**
   * The reader's place, written back to the URL it was read from.
   *
   * `?section=` was honoured on load but never updated, so every sidebar click
   * and every ←/→ moved the reader without moving the address bar: a refresh
   * or a copied link reopened at the package's first section, and the reader
   * lost the page they were on. Written from the active id itself rather than
   * from each of the six call sites that can change it.
   *
   * REPLACE, like every other param this page writes: pushing would put one
   * history entry per arrow key between the reader and wherever they came
   * from. Only a view boundary (Packages / opening a card) pushes.
   */
  useEffect(() => {
    if (view !== "reader") return;
    if (searchParams.get("section") === activeSectionId) return;
    setParams({ section: activeSectionId });
  }, [view, activeSectionId, searchParams]);

  // Opening a section always starts at its top. The content pane is one
  // scroll container shared by every section, and switching sections used to
  // inherit the previous offset — click a section in the rail from the bottom
  // of another and you landed on its citations footer, title never seen
  // (READER_REDESIGN.md N2, reproduced 5/5 on the live audit).
  const readerScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    readerScrollRef.current?.scrollTo({ top: 0 });
  }, [activeSectionId]);
  function sectionLabelFor(navId: SectionId): string {
    return sections.find((s) => s.id === navId)?.label
      ?? navId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  useHotkeys(
    {
      ArrowRight: () => moveSection(1),
      ArrowLeft: () => moveSection(-1),
    },
    view === "reader" && !isMissing && presentSectionIds.length > 0,
  );

  // Full re-analysis goes through the guarded AnalyzeDialog (config +
  // preview + explicit start) — never a bare POST that silently re-runs
  // the whole pipeline. Watching the job makes its finished package the
  // user's selection and returns them to the overview.
  function handleAnalysisStarted(jobId: string) {
    setGenerating(true);
    registerSessionJob(jobId, { navigateOnDone: true });
    refetch();
  }

  // Whole-package regeneration from a card: rebuilds THAT package in place
  // (same snapshot, branch, and role — no repo re-analysis; unchanged
  // content is served from the content-addressed cache).
  async function handleRegeneratePackage() {
    if (!id || !regenCard) return;
    setRegenBusy(true);
    setRegenError("");
    try {
      const data = (await apiFetch(`/projects/${id}/onboarding/generate`, {
        method: "POST",
        body: JSON.stringify({ role: regenCard.role, package_id: regenCard.id }),
      })) as { job?: { id: string } };
      if (data.job?.id) registerSessionJob(data.job.id, { navigateOnDone: false });
      setRegenCard(null);
      loadCards();
    } catch (err: unknown) {
      setRegenError(err instanceof Error ? err.message : "Failed to start regeneration");
    } finally {
      setRegenBusy(false);
    }
  }

  // The cheap half of the same dialog: rebuild ONLY the sections and tutorials
  // the last re-analysis flagged stale, against the newest analysis. Everything
  // else keeps its current text and costs nothing, so this is the option to
  // reach for when a push touched two sections out of twelve.
  async function handleRegenerateStale() {
    if (!id || !regenCard) return;
    setRegenBusy(true);
    setRegenError("");
    try {
      const data = (await apiFetch(`/projects/${id}/onboarding/generate`, {
        method: "POST",
        body: JSON.stringify({ role: regenCard.role, package_id: regenCard.id, only_stale: true }),
      })) as { job?: { id: string } };
      if (data.job?.id) registerSessionJob(data.job.id, { navigateOnDone: false });
      setRegenCard(null);
      loadCards();
    } catch (err: unknown) {
      setRegenError(err instanceof Error ? err.message : "Failed to start regeneration");
    } finally {
      setRegenBusy(false);
    }
  }

  // On-demand per-role generation against the selected package's snapshot
  // (falls back to the latest analysis), so only this role's package is paid
  // for — no repo re-analysis, no fan-out.
  async function handleGenerateRole() {
    if (!id) return;
    setGenerating(true);
    setActionError("");
    try {
      const data = (await apiFetch(`/projects/${id}/onboarding/generate`, {
        method: "POST",
        body: JSON.stringify({
          role: selectedRole,
          package_id: selectedPackageParam ?? undefined,
        }),
      })) as { job?: { id: string } };
      if (data.job?.id) registerSessionJob(data.job.id, { navigateOnDone: false });
      const started = Date.now();
      generateRolePollRef.current = window.setInterval(async () => {
        // `fetchOnboardingPackage` rejects now (bug #68), and an async
        // setInterval callback that throws is an unhandled rejection, not a
        // caught error — a blip mid-generation would kill the poll without
        // stopping it. A failed tick is ignored; the timeout still fires.
        let polled: OnboardingPackage | null = null;
        try {
          polled = await fetchOnboardingPackage(id, { role: selectedRole });
        } catch { /* transient — the next tick retries */ }
        const timedOut = Date.now() - started > 300_000;
        const landed = polled !== null && polled.status !== "missing";
        if (landed || timedOut) {
          if (generateRolePollRef.current) window.clearInterval(generateRolePollRef.current);
          generateRolePollRef.current = null;
          setGenerating(false);
          if (landed) {
            setPkg(polled);
            setPkgError(null);
            // Pin the reader to the package that just landed — and make it the
            // sidebar selection too, or the M3 sync effect below would treat
            // the URL as drifting from the chooser and put it straight back.
            if (polled!.id) {
              selectPackage(polled!.id);
              setParams({ package: polled!.id });
            }
          } else if (timedOut) {
            setActionError("Generation is taking longer than expected. Check the Overview page for job status, or try again.");
          }
          loadCards();
        }
      }, 5000);
    } catch (err: unknown) {
      setGenerating(false);
      setActionError(err instanceof Error ? err.message : "Failed to start generation");
    }
  }

  async function handleRegenerateSection() {
    if (!id || !activeSection?.sectionId) return;
    setRegenerating(true);
    setActionError("");
    try {
      await regenerateSection(id, activeSection.sectionId);
      // Poll until the regenerated section lands (worker replaces the row).
      const oldId = activeSection.sectionId;
      const started = Date.now();
      // Held in a ref (not a local) so the unmount effect above can clear it —
      // bug #68 (4): navigating away used to leave this firing for two minutes.
      if (regenPollRef.current) window.clearInterval(regenPollRef.current);
      const stop = () => {
        if (regenPollRef.current) window.clearInterval(regenPollRef.current);
        regenPollRef.current = null;
      };
      regenPollRef.current = window.setInterval(async () => {
        let data: OnboardingPackage | null = null;
        try {
          data = await fetchOnboardingPackage(id, { packageId: selectedPackageParam, role: selectedRole });
        } catch { /* transient — the next tick retries; the timeout still fires */ }
        const fresh = data?.sections.find((s) => s.id === activeSectionId);
        if (data && fresh && fresh.sectionId !== oldId) {
          stop();
          setRegenerating(false);
          setPkg(data);
          setPkgError(null);
          loadCards();
        } else if (Date.now() - started > 120_000) {
          stop();
          setRegenerating(false);
          setActionError("Regeneration is taking longer than expected. The section will replace itself when the worker finishes. Check the Overview page for job status.");
        }
      }, 4000);
    } catch (err: unknown) {
      setRegenerating(false);
      setActionError(err instanceof Error ? err.message : "Failed to start regeneration");
    }
  }

  async function handleToggleReview() {
    if (!id || !activeSection?.sectionId) return;
    const newStatus = activeSection.reviewStatus === "approved" ? "draft" : "approved";
    setActionError("");
    try {
      await apiFetch(`/projects/${id}/onboarding/sections/${activeSection.sectionId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ review_status: newStatus }),
      });
      // The PATCH succeeded; this refetch only picks up the new badge. If it
      // fails, say so instead of leaving an unhandled rejection and a stale
      // review state that looks like the toggle did nothing (bug #68).
      await fetchOnboardingPackage(id, { packageId: selectedPackageParam, role: selectedRole })
        .then((data) => { setPkg(data); })
        .catch(() => setActionError("Review status saved, but the page could not be refreshed. Reload to see it."));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update review status");
    }
  }

  async function handleExport() {
    if (!id) return;
    setExporting(true);
    setActionError("");
    try {
      const exportQs = selectedPackageParam
        ? `package_id=${encodeURIComponent(selectedPackageParam)}`
        : `role=${encodeURIComponent(selectedRole)}`;
      const response = await fetch(
        `${runtimeConfig.apiUrl}/projects/${id}/onboarding/export?${exportQs}`,
        {
          headers: {
            Authorization: `Bearer ${(await (await import("@/lib/supabase")).supabase.auth.getSession()).data.session?.access_token}`,
          },
        },
      );
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `onboarding-${pkg?.role ?? selectedRole}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to export package");
    } finally {
      setExporting(false);
    }
  }

  // ── cards view ──────────────────────────────────────────────────────────────
  if (view !== "reader") {
    const filtered = (cards ?? []).filter(
      (c) =>
        (roleFilter === "all" || c.role === roleFilter) &&
        (statusFilter === "all" || c.status === statusFilter) &&
        (freshFilter === "all" || (freshFilter === "latest" ? c.is_latest_commit : !c.is_latest_commit)),
    );

    const analyzeBusy = generating || project?.status === "analyzing";
    // Tutorials can be the only stale content on a card, so the stale option's
    // gate counts both populations — same arithmetic as the API's 409 guard.
    const staleCount = regenCard ? regenCard.stale_sections + regenCard.stale_tutorials : 0;
    return (
      <div>
        <div data-tour="onboarding-header">
          <PageHeader
            title="Your onboarding"
            subtitle="Generated onboarding packages, one per scope, role, and analyzed commit."
            actions={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-muted-foreground"
                      onClick={() => setLifecycleTourOpen(true)}
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                      How packages work
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-left">
                    When packages update, when new ones appear, and when stale badges show up
                  </TooltipContent>
                </Tooltip>
                {canManage && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => { setAnalyzeInitialRole(undefined); setAnalyzeOpen(true); }}
                    disabled={analyzeBusy}
                  >
                    {analyzeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {analyzeBusy ? "Analyzing…" : "Analyze & generate…"}
                  </Button>
                )}
              </>
            }
          />
        </div>

        {cards && cards.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2" data-tour="onboarding-filters">
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger aria-label="Filter by role" className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filter by status" className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {["draft", "approved", "stale", "generating", "failed"].map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={freshFilter} onValueChange={setFreshFilter}>
              <SelectTrigger aria-label="Filter by commit freshness" className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any commit</SelectItem>
                <SelectItem value="latest">Latest commit</SelectItem>
                <SelectItem value="behind">Behind latest</SelectItem>
              </SelectContent>
            </Select>
            <span className="ml-auto text-[0.6875rem] tabular-nums text-muted-foreground">
              {filtered.length} / {cards.length} packages
            </span>
          </div>
        )}

        {cardsLoading ? (
          packagesError ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-danger/40 bg-danger-soft py-20 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft">
                <AlertTriangle className="h-6 w-6 text-danger" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Couldn't load your packages</h2>
              <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                Something went wrong fetching your onboarding packages. Check your connection and try again.
              </p>
              <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={refreshPackages}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : (
            <PageSpinner className="py-20" label="Loading your onboarding" />
          )
        ) : !cards || cards.length === 0 ? (
          packagesError ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-danger/40 bg-danger-soft py-20 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft">
                <AlertTriangle className="h-6 w-6 text-danger" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Couldn't load your packages</h2>
              <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                Something went wrong refreshing your onboarding packages. Check your connection and try again.
              </p>
              <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={refreshPackages}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <BookOpen className="h-6 w-6 text-muted-foreground" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">No onboarding packages yet</h2>
              <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                Run an analysis to generate role-based onboarding: entry points, critical files,
                workflows, tutorials, and safety notes, every claim backed by code receipts.
              </p>
              {/* E10: the empty state offered only the admin-only re-analysis,
                  so a developer saw a dead end — yet POST /onboarding/generate
                  is `requireProjectAccess()` (any member,
                  api/routes/onboarding.ts:110). Members now get the action the
                  backend actually grants: generate their role's package from
                  the analysis that already exists. Re-analysing the repo stays
                  owner/admin because POST /projects/:id/analyze is
                  (projects.ts:1133). */}
              {canManage ? (
                <Button
                  size="sm"
                  className="mt-4 gap-1.5"
                  onClick={() => { setAnalyzeInitialRole(undefined); setAnalyzeOpen(true); }}
                  disabled={generating || project?.status === "analyzing"}
                >
                  {generating || project?.status === "analyzing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {generating || project?.status === "analyzing" ? "Analyzing…" : "Analyze & generate…"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="mt-4 gap-1.5"
                  onClick={handleGenerateRole}
                  disabled={generating || project?.status === "analyzing"}
                >
                  {generating || project?.status === "analyzing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {generating || project?.status === "analyzing"
                    ? "Generating…"
                    : `Generate for ${roleLabel(selectedRole)}`}
                </Button>
              )}
            </div>
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-tour="onboarding-cards">
            {filtered.map((card) => (
              <PackageCardView
                key={card.id}
                card={card}
                to={`/projects/${id}/onboarding?view=reader&package=${card.id}&role=${card.role}`}
                onSelect={() => selectPackage(card.id)}
                onOpen={() => {
                  // Opening a card pins the reader to that exact package and
                  // makes it the sidebar selection so every tab follows.
                  selectPackage(card.id);
                  // A view boundary — pushed so Back returns to the grid.
                  setParams({ view: "reader", package: card.id, role: card.role }, { replace: false });
                }}
                onRegenerate={() => {
                  setRegenError("");
                  setRegenCard(card);
                }}
              />
            ))}
          </div>
        )}

        {/* Per-package regeneration: the whole package now, only the sections a
            re-analysis flagged stale, or a fresh analysis at a new commit
            first. Single sections regenerate in the reader. */}
        <Dialog open={regenCard !== null} onOpenChange={(open) => !open && setRegenCard(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">
                Regenerate {roleLabel(regenCard?.role)} package
              </DialogTitle>
            </DialogHeader>

            {regenError && (
              <ErrorBanner>{regenError}</ErrorBanner>
            )}

            {/* All three options are always on screen, including the ones this
                package or this member cannot use. Hiding them made the dialog
                change shape per card, so nobody learned that the cheap option
                exists until a package happened to be stale. */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleRegeneratePackage}
                disabled={regenBusy}
                className={OPTION_CLASS}
              >
                <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-foreground">
                  {regenBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Regenerate all sections (same commit)
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Rebuilds every section and tutorial of this package from the analysis you already
                  have. No repo re-analysis, and unchanged content comes from cache.
                  {regenCard && !regenCard.is_latest_commit &&
                    " This package is behind the latest analysis, so this also brings it up to date."}
                </p>
              </button>

              <button
                type="button"
                onClick={handleRegenerateStale}
                disabled={regenBusy || staleCount === 0}
                className={OPTION_CLASS}
              >
                <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-foreground">
                  {regenBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  Regenerate only the stale sections
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {staleCount === 0 || !regenCard ? (
                    "Nothing is stale right now. Sections go stale when a newer analysis shows their underlying code changed."
                  ) : (
                    <>
                      Rebuilds just the content a newer analysis flagged (
                      {[
                        regenCard.stale_sections > 0 &&
                          `${regenCard.stale_sections} section${regenCard.stale_sections === 1 ? "" : "s"}`,
                        regenCard.stale_tutorials > 0 &&
                          `${regenCard.stale_tutorials} tutorial${regenCard.stale_tutorials === 1 ? "" : "s"}`,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      ). Everything else keeps its current text and costs nothing.
                    </>
                  )}
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAnalyzeInitialRole(regenCard?.role);
                  setRegenCard(null);
                  setAnalyzeOpen(true);
                }}
                disabled={!canManage}
                className={OPTION_CLASS}
              >
                <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  Regenerate all sections (new commit)
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {canManage
                    ? "Pick branch, commit, and scope with a cost preview; a fresh analysis runs and this role's package is generated from it."
                    : "Owners and admins only. Re-analyzing the repository is a billed run."}
                </p>
              </button>
            </div>

            <p className="text-[0.6875rem] text-muted-foreground">
              Need just one section? Open the package and use "Regenerate section" inside the
              reader. It rebuilds only that section against the newest analysis.
            </p>
          </DialogContent>
        </Dialog>

        {project && (
          <AnalyzeDialog
            project={project}
            open={analyzeOpen}
            onOpenChange={setAnalyzeOpen}
            onStarted={handleAnalysisStarted}
            initialRole={analyzeInitialRole}
          />
        )}

        {lifecycleTourOpen && (
          <AppTour steps={LIFECYCLE_TOUR_STEPS} onDone={finishLifecycleTour} />
        )}
      </div>
    );
  }

  // ── reader view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar: sidebar toggle, back to the package list, the section title
          and the reader's actions on one row, in a full-width band so the
          divider reaches both window walls.

          At lg the band and the coverage strip below it are pinned to 70px
          (4.375rem) and 31px (1.9375rem) — 101px, which is the project
          sidebar's 100px header block PLUS its 1px Separator. The extra pixel
          matters: the sidebar's line occupies the row BELOW its 100px block,
          so a 100px reader chrome puts the strip's border-b in the row above
          it — two adjacent lines, a visible one-pixel stagger at Retina or
          zoom. At 101px the strip's border-b and the Separator share the same
          pixel row. Both heights are rem, so a font-size preference or a
          browser zoom scales the reader and the sidebar together. The
          asymmetric padding (22 top / 15 bottom around a 32px content line)
          keeps the toggle's top edge at every other page's 22px — the shell's
          lg:p-5 plus the PageHeader's mt-0.5 — so switching tabs never jogs
          it. A control taller than that line no longer grows the band either:
          forced back to ui/select's own 36px, the role Select of a reader
          opened without ?package= bleeds 2px into each padding and the toggle
          and the strip stay where they are, so the `data-[size=default]:h-7`
          below is now belt and braces rather than the only thing holding the
          divider in place.

          `lg:flex-nowrap` is the other half of it, because a wrapped row is
          taller than whatever height it is pinned to. The h1 truncates to
          absorb the width; the strip scrolls sideways instead. Honest number:
          the strip's content is wider than its pane on any real package —
          1302px against 1216px at a 1440 window, against 800px at lg-min — so
          the last counts are reached by scrolling the strip, at every width.
          Nothing is dropped and nothing is hidden behind a menu, but it is a
          scroll. Same constraint is why the known-gaps panel opens as its own
          band BELOW the strip rather than on a second line inside it.

          Two accepted departures: while the generation banner below or the
          sidebar's own active-job pill is up, that side sits lower on purpose.

          Measured in Chrome (live app, dpr 2): band 70, strip 31, the strip's
          border-b colinear with the Separator's [100, 101] row; stable at
          browser zoom 90 / 110 / 125%. Under a font-size preference the pair
          drifts by half a pixel at most, from the sidebar's side of the sum,
          which is not all rem. At 150% zoom a 1440 window falls under lg,
          where none of this applies and the sidebar is a drawer anyway. */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 pb-2.5 pt-3.5 sm:px-4 sm:pt-[1.125rem] lg:h-[4.375rem] lg:flex-nowrap lg:px-5 lg:pb-[0.9375rem] lg:pt-[1.375rem]">
        <SidebarToggle />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setParams({ view: null, package: null, section: null }, { replace: false })}
          className="gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Packages
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">
          {activeSection?.label ?? "Onboarding"}
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 lg:flex-nowrap">
          {!isMissing && <StatusBadge status={generating ? "generating" : pkg.status} />}
          {selectedPackageParam ? (
            // Pinned to one exact package — role is part of its identity.
            <Badge variant="outline" className="h-7 px-2 text-xs">
              {roleLabel(pkg?.role ?? selectedRole)}
            </Badge>
          ) : (
            <Select value={selectedRole} onValueChange={(r) => setParams({ role: r })}>
              {/* data-[size=default]:h-7 because the ui trigger's own h-9 size
                  variant outranks a bare h-7, and at h-9 this is the tallest
                  thing in the band. The pinned band height now absorbs that
                  (measured: 36px here still leaves band 69 / strip 31); this
                  keeps it the same size as the badge it replaces. */}
              <SelectTrigger aria-label="Select role" className="h-7 w-[150px] text-xs data-[size=default]:h-7"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {!isMissing && (
            <>
              {/* Always-visible per-section regeneration (owner/admin — the
                  endpoint enforces the same tiers). The stale banner keeps
                  its own contextual copy of this action. */}
              {canManage && activeSection?.sectionId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="xs"
                      variant="outline"
                      className="gap-1.5"
                      onClick={handleRegenerateSection}
                      disabled={regenerating}
                      aria-label={regenerating ? "Regenerating…" : "Regenerate section"}
                    >
                      {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      {/* Labels drop below xl: this row's content measured
                          ~985px against a ~760px pane at lg, so the last
                          buttons clipped. aria-label mirrors the visible text
                          exactly, so the name is the same at every width. */}
                      <span className="hidden xl:inline">{regenerating ? "Regenerating…" : "Regenerate section"}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Rebuild this section against the newest analysis</TooltipContent>
                </Tooltip>
              )}
              {canManage && activeSection?.sectionId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="xs"
                      variant={markedReviewed ? "secondary" : "outline"}
                      aria-label={markedReviewed ? "Reviewed" : "Mark reviewed"}
                      className={cn(
                        "gap-1.5",
                        markedReviewed && "border-success/40 bg-success-soft text-success",
                      )}
                      onClick={handleToggleReview}
                    >
                      {markedReviewed ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                      <span className="hidden xl:inline">{markedReviewed ? "Reviewed" : "Mark reviewed"}</span>
                    </Button>
                  </TooltipTrigger>
                  {/* xl:hidden because below xl this is a bare circle icon and
                      needs naming; at xl+ the label is right there and a
                      tooltip that repeats it is noise. */}
                  <TooltipContent side="bottom" className="xl:hidden">
                    {markedReviewed ? "Reviewed" : "Mark reviewed"}
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Personal progress, every tier: this used to be `!canManage`,
                  so owners and admins had no way to record a read mark at all
                  and their rail sat at "0/12 read" forever. "Mark reviewed"
                  above is the separate editorial signal, not this. */}
              {activeSection && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* Focusable in BOTH off-states: a disabled button takes no
                        pointer or keyboard events, so without this wrapper the
                        tooltip explaining WHY it is disabled is unreachable. */}
                    <span tabIndex={readSections === null ? 0 : -1} className="inline-flex">
                      <Button
                        size="xs"
                        variant={isSectionRead ? "secondary" : "outline"}
                        data-tour="reader-review"
                        disabled={readSections === null}
                        aria-label={isSectionRead ? "Read" : "Mark as read"}
                        className={cn(
                          "gap-1.5",
                          isSectionRead && "border-success/40 bg-success-soft text-success",
                        )}
                        onClick={handleToggleRead}
                      >
                        {readSections === null && !progressLoadError ? (
                          // Spinner only while the GET is in flight. On a failed
                          // GET the icon stays a static Circle: this state does
                          // not resolve without a reload, and a spinner would
                          // promise a recovery that never arrives.
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : isSectionRead ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Circle className="h-3 w-3" />
                        )}
                        <span className="hidden xl:inline">{isSectionRead ? "Read" : "Mark as read"}</span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {/* Both off-states get copy. An owner reported this control as
                      broken ("you can only mark as read if you mark as
                      reviewed") because clicking it during the progress round
                      trip did nothing and said nothing — the disabled state was
                      only ever explained when the fetch had already failed.
                      Bug #68 is the failure branch: it stays disabled on
                      purpose, since writing marks against a history we could
                      not read would erase it. */}
                  {progressLoadError ? (
                    <TooltipContent side="bottom" className="max-w-xs text-left">
                      Your reading progress couldn&apos;t be loaded, so marks are paused for this
                      visit: saving now would overwrite the sections you have already read.
                      Reload the page to try again.
                    </TooltipContent>
                  ) : readSections === null ? (
                    <TooltipContent side="bottom" className="max-w-xs text-left">
                      Loading your reading progress.
                    </TooltipContent>
                  ) : (
                    // Working state: names the icon-only button below xl only.
                    <TooltipContent side="bottom" className="max-w-xs text-left xl:hidden">
                      {isSectionRead ? "Read" : "Mark as read"}
                    </TooltipContent>
                  )}
                </Tooltip>
              )}
              {/* E8: the emphasis used to be inverted — "Mark as read" (a
                  progress checkbox) wore the only primary ring in the top bar
                  while Ask, the reader's highest-value action, was a ghost.
                  Ask is the emphasized control now; the read/review marks are
                  quiet outlines. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="xs" variant="default" className="gap-1.5" onClick={() => setAskOpen(true)}>
                    <MessageSquare className="h-3 w-3" />
                    Ask
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-left">
                  Ask a question about this codebase, answered from the analyzed evidence with receipts
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="xs"
                    variant="outline"
                    className="gap-1"
                    onClick={() => setProvenanceOpen(true)}
                    aria-label="How this package was made"
                  >
                    <FlaskConical className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-left">
                  How this package was made: models, calls, cost, validation
                </TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="xs"
                    variant="outline"
                    className="gap-1"
                    data-tour="reader-actions"
                    aria-label="Export options"
                    disabled={exporting}
                  >
                    {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem className="text-xs" onSelect={handleExport} disabled={exporting}>
                    <FileText className="mr-2 h-3 w-3" /> Markdown file
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* How this package was built. Sits above the coverage strip because it
          changes how everything below should be read: a structural-only
          package has no explanation in it by design, and without this banner
          switching privacy to "AI disabled" produced a package that looked
          broken rather than deliberately different — the reported "changing to
          no-AI does not do anything" was partly that the change was invisible.
          While it is up the coverage strip sits below the sidebar's divider
          rather than level with it: the banner outranks the alignment. The
          sidebar's own active-job pill drifts the same way, deliberately. */}
      {!isMissing && pkg.generation?.label && pkg.generation.kind !== "ai" && (
        <div
          className="flex items-start gap-2 border-b bg-muted/30 px-3 py-2 text-[0.6875rem] leading-relaxed text-muted-foreground sm:px-4 lg:px-5"
          role="status"
        >
          {/* This banner exists to say "no model wrote this", and it opened
              with the sparkle — the app's own icon for AI — which read as the
              exact opposite of the sentence beside it. The code chip carries
              the same tone as every deterministic mark in the reader, and the
              full disclosure sentence rides in its tooltip as well as inline. */}
          <SourceMark source="code" tip={pkg.generation.label} className="mt-0.5" />
          <p className="flex-1">
            <span className="font-medium text-foreground">
              {pkg.generation.kind === "deterministic" ? "Built without AI" : "Partly built without AI"}
            </span>{" "}
            {pkg.generation.label}
            {pkg.generation.kind === "mixed" && (
              <>
                {" "}
                <span className="tabular-nums">
                  ({pkg.generation.deterministicSections} of {pkg.generation.totalSections} sections)
                </span>
              </>
            )}
          </p>
        </div>
      )}

      {/* Coverage strip (audit §4.2): what was analyzed, what this package
          actually cites, and the signals behind the ranking — the honest
          denominators the "critical 25%" story needs. All counts, no prose. */}
      {!isMissing && pkg.coverage && (
        <>
          {/* One line at lg: `whitespace-nowrap` is inherited by every child
              (Tooltip content portals out of here, so it is unaffected) and
              `min-width:auto` on a nowrap flex item keeps the counts from
              being squished, so no child needs its own shrink-0 — only the
              ml-auto Link keeps one, to stay whole at the end of the scroll. */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b bg-muted/20 px-3 py-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground sm:px-4 lg:h-[1.9375rem] lg:flex-nowrap lg:overflow-x-auto lg:whitespace-nowrap lg:px-5 lg:py-0 lg:[scrollbar-width:thin]">
            <CoverageFiles files={pkg.coverage.files} languages={pkg.coverage.languages} />
            <span aria-hidden>·</span>
            <span>
              cites <span className="font-medium text-foreground">{pkg.coverage.symbols.cited}</span> of{" "}
              {pkg.coverage.symbols.total} symbols in {pkg.coverage.files.cited} files
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="font-medium text-foreground">{pkg.coverage.workflows.covered}</span> of{" "}
              {pkg.coverage.workflows.total} traced workflows in sections & tutorials
            </span>
            {/* The weight table with its formula, served by the API. This line
                used to restate the ranker's signal names in the frontend and
                print the weights with no formula around them — two places to
                keep in sync, and no way to tell what the percentages summed to. */}
            {pkg.coverage.rankingProvenance && (
              <>
                <span aria-hidden>·</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2">
                      ranked by{" "}
                      {pkg.coverage.rankingProvenance.available
                        ? pkg.coverage.rankingProvenance.inputs.length
                        : "?"}{" "}
                      signals
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-sm text-left">
                    <ScoreProvenance data={pkg.coverage.rankingProvenance} variant="tooltip" />
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            {/* Honesty rule (DETECTION_COVERAGE.md): what the analysis KNOWS it
                doesn't know — dead-end traces, unmodeled packages, journey
                gaps. Findable work, never silent holes.

                A10: this used to print `detectionUnknowns.length` alone and
                call it "6 known unknowns" while the sections below it listed
                89 gap entries under the same word — the strip contradicted its
                own page. One population now: "known gaps" means anything the
                analysis recorded as undetermined, the number is the sum of
                both provenances (API `coverage.gaps`), and the tooltip says
                which is which. Pre-`gaps` payloads fall back to the detection
                count. */}
            <PackageGapsToggle
              coverage={pkg.coverage}
              open={pkgGapsOpen}
              onToggle={() => setPkgGapsOpen((v) => !v)}
            />
            <Link
              to={`/projects/${id}/dependencies`}
              className="ml-auto shrink-0 font-medium text-primary hover:underline"
            >
              Everything else → Dependencies
            </Link>
          </div>
          {/* Below the strip, not inside it: the strip is one pinned line at
              lg, and the rule under it stays level with the sidebar divider
              whether this is open or shut. */}
          {pkgGapsOpen && <PackageGapsPanel coverage={pkg.coverage} sections={pkg.sections} />}
        </>
      )}

      {/* Bug #22: when the live poll gives up, say so where it was reporting
          progress. The generation itself is unaffected — only this page's
          view of it stopped updating, which is exactly the distinction the
          silent catch destroyed. */}
      {!isMissing && pkg.status === "generating" && livePollStalled && (
        <div
          className="flex items-center justify-between gap-3 border-b border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning sm:px-4 lg:px-5"
          role="alert"
        >
          <span>
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
            Live updates stopped: the last three checks couldn&apos;t reach the server. Generation
            is still running; this page just stopped following it.
          </span>
          <Button
            size="xs"
            variant="outline"
            className="shrink-0 gap-1.5 border-warning/50 text-warning hover:bg-warning-soft"
            onClick={() => { setLivePollStalled(false); setLivePollAttempt((n) => n + 1); loadPkg(); }}
          >
            <RefreshCw className="h-3 w-3" /> Resume updates
          </Button>
        </div>
      )}
      {!isMissing && pkg.status === "generating" && !livePollStalled && (
        <div className="flex items-center gap-2 border-b bg-info-soft px-3 py-2 text-xs text-info sm:px-4 lg:px-5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating: sections appear here as each one finishes ({sections.length}/{SECTION_NAV_ORDER.length} so far).
        </div>
      )}
      {!isMissing && pkg.status === "failed" && (
        <div className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger sm:px-4 lg:px-5">
          <span>
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
            Generation failed, so some sections may be missing or incomplete.
          </span>
          <Button
            size="xs"
            variant="outline"
            className="shrink-0 border-danger/50 text-danger hover:bg-danger-soft"
            onClick={handleGenerateRole}
            disabled={generating}
          >
            {generating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
            Retry
          </Button>
        </div>
      )}

      {actionError && (
        <div className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger sm:px-4 lg:px-5">
          <span>
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
            {actionError}
          </span>
          <button className="shrink-0 opacity-70 hover:opacity-100" onClick={() => setActionError("")} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Mobile section picker — the section nav aside is desktop-only. Same
          inset scale as the strips above, minus the lg step: this row is
          lg:hidden. */}
      {!isMissing && sections.length > 0 && (
        <div className="border-b px-3 py-2 sm:px-4 lg:hidden">
          <Select value={activeSectionId ?? undefined} onValueChange={(v) => setActiveSectionId(v as typeof activeSectionId)}>
            <SelectTrigger aria-label="Jump to section" className="h-8 w-full text-[0.8125rem]"><SelectValue placeholder="Jump to section" /></SelectTrigger>
            <SelectContent>
              {presentSectionIds
                .map((navId, idx) => (
                  <SelectItem key={navId} value={navId} className="text-[0.8125rem]">
                    {idx + 1}. {sectionLabelFor(navId)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* section nav */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r py-3 pl-5 pr-2 lg:block" data-tour="reader-sections">
          <p className="section-label mb-2 px-2">Sections</p>
          {readSections !== null && presentSectionIds.length > 0 && (
            <p className="mb-2 px-2 text-[0.625rem] tabular-nums text-muted-foreground">
              {presentSectionIds.filter((navId) => readSections.includes(navId)).length}/
              {presentSectionIds.length} read
            </p>
          )}
          {/* Suggested for you (step-3 overlay): the role's reading order —
              journeys interleave modes, so the shelf order below is NOT the
              reading order. Next 3 unread, resume-aware. */}
          {!isMissing && readSections !== null && (() => {
            const order = readingOrderFor(pkg?.role);
            const nextUp = order
              .filter((id) => presentSectionIds.includes(id) && !readSections.includes(id))
              .slice(0, 3);
            if (nextUp.length === 0) return null;
            return (
              <div className="mb-3 rounded-md border border-primary/20 bg-primary/5 px-2 py-2">
                <p className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-primary/80">
                  Suggested for you{pkg?.role && pkg.role !== FALLBACK_ROLE ? ` (${roleLabel(pkg.role)})` : ""}
                </p>
                <div className="space-y-1">
                  {nextUp.map((id) => (
                    <button
                      key={id}
                      onClick={() => setActiveSectionId(id)}
                      className="block w-full rounded px-1.5 py-1 text-left hover:bg-primary/10"
                    >
                      <span className="block text-[0.75rem] font-medium text-foreground">{sectionLabelFor(id)}</span>
                      {/* Why THIS reader is being sent here: the role's
                          overlay line where it has one, the shared line
                          otherwise. */}
                      {sectionWhy(id, pkg?.role) && (
                        <span className="block text-[0.6875rem] leading-snug text-muted-foreground">{sectionWhy(id, pkg?.role)}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          <nav className="space-y-3">
            {(() => {
              // Missing packages preview only the current 12-section layout;
              // the legacy tail group appears solely when an old package
              // actually contains those sections.
              const filteredNavIds = SECTION_GROUPS.flatMap((g) => g.ids).filter((navId) =>
                isMissing ? SECTION_NAV_ORDER.includes(navId) : sections.some((s) => s.id === navId));
              return SECTION_GROUPS.map((group) => {
                const idsInGroup = group.ids.filter((gid) => filteredNavIds.includes(gid));
                if (idsInGroup.length === 0) return null;
                return (
                  <div key={group.label}>
                    <p className="mb-1 px-2 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </p>
                    {group.blurb && (
                      <p className="mb-1 px-2 text-[0.625rem] leading-snug text-muted-foreground">{group.blurb}</p>
                    )}
                    <div className="space-y-0.5">
                      {idsInGroup.map((navId) => {
                        const idx = filteredNavIds.indexOf(navId);
                        const section = sections.find((s) => s.id === navId);
                        const label = sectionLabelFor(navId);
                        const isActive = activeSectionId === navId;
                        return (
                          <button
                            key={navId}
                            onClick={() => setActiveSectionId(navId)}
                            disabled={isMissing}
                            aria-current={isActive ? "true" : undefined}
                            className={cn(
                              "flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] font-medium transition-colors disabled:opacity-40",
                              isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                            )}
                          >
                            <span className="w-4 shrink-0 text-right text-[0.6875rem] tabular-nums leading-5 text-muted-foreground">{idx + 1}</span>
                            {/* H1: no tooltip that repeats the label. It only
                                existed because 4 of 12 titles truncated in the
                                narrow rail (§8.3/§17.7) — wrapping shows the
                                whole title, which removes the truncation AND
                                the restating tooltip. */}
                            <span className="min-w-0 flex-1 leading-5">{label}</span>
                            {section?.status === "stale" && <AlertTriangle className="mt-1 h-3 w-3 shrink-0 text-warning" />}
                            {readSections?.includes(navId) && (
                              <CheckCircle2 className="mt-1 h-3 w-3 shrink-0 text-success/70" aria-label="Read" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </nav>
        </aside>

        {/* content */}
        <div ref={readerScrollRef} className="min-w-0 flex-1 overflow-y-auto px-5 py-5 lg:px-8">
          {/* Centered measure: the column sits mid-pane like a document page;
              max-w-3xl still caps the line length. */}
          <div className="mx-auto max-w-3xl">
            {isMissing ? (
              // Bug #68, the expensive one. Order matters: loading first (so
              // the empty state never flashes before the first response),
              // then the failure, and only then real absence. Nothing but the
              // last branch may show a button that starts a billed run.
              pkgLoading ? (
                <div
                  className="flex flex-col items-center justify-center py-24 text-center"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <p className="mt-3 text-xs text-muted-foreground">Loading this package…</p>
                </div>
              ) : pkgError ? (
                <div className="flex flex-col items-center justify-center py-24 text-center" role="alert">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft">
                    <AlertTriangle className="h-6 w-6 text-danger" />
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {pkgError.gone ? "This package no longer exists" : "Couldn't load this package"}
                  </h2>
                  <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                    {pkgError.gone
                      ? "The package this link points to has been deleted or replaced. Pick another one from the package list. Nothing has been generated or charged."
                      : "This is a failure to load it, not a sign that it is missing. Your existing package is untouched. Retry before generating anything, so you are not charged for a package you already have."}
                  </p>
                  <p className="mt-2 max-w-sm break-words text-[0.6875rem] text-muted-foreground/80">
                    {pkgError.message}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    {!pkgError.gone && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={loadPkg}>
                        <RefreshCw className="h-3.5 w-3.5" /> Retry
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={pkgError.gone ? "default" : "ghost"}
                      className="gap-1.5"
                      onClick={() => setParams({ view: null, package: null, section: null }, { replace: false })}
                    >
                      <BookOpen className="h-3.5 w-3.5" /> Back to packages
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">
                    No package for {roleLabel(selectedRole)}
                  </h2>
                  <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                    Generate this role's package from the latest analysis: role-specific entry
                    points, critical files, workflows, and safety notes. Other roles are unaffected.
                  </p>
                  <Button size="sm" className="mt-4 gap-1.5" onClick={handleGenerateRole} disabled={generating}>
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {generating ? "Generating…" : `Generate for ${roleLabel(selectedRole)}`}
                  </Button>
                </div>
              )
            ) : activeSection ? (
              <>
                {/* E10: this banner used to be `canManage`-gated, so the tier
                    that actually reads the docs was never told they were
                    stale — the warning went only to the people who don't need
                    it. Everyone sees the state; only the action stays gated,
                    because POST /sections/:id/regenerate really is owner/admin
                    (api/routes/onboarding.ts:28). */}
                {activeSection.status === "stale" && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2">
                    <p className="text-xs text-warning">
                      <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                      Stale: source files changed since this was written.{" "}
                      {canManage
                        ? "Regenerating rebuilds it against the newest analysis."
                        : "An owner or admin can regenerate it against the newest analysis."}
                    </p>
                    {canManage && (
                      <Button
                        size="xs"
                        variant="outline"
                        className="shrink-0 border-warning/50 text-warning hover:bg-warning-soft"
                        onClick={handleRegenerateSection}
                        disabled={regenerating}
                      >
                        {regenerating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
                        {regenerating ? "Regenerating…" : "Regenerate"}
                      </Button>
                    )}
                  </div>
                )}
                <SectionView section={activeSection} projectId={id} onReceiptClick={setReceiptModal} />
                {(() => {
                  const navIdx = presentSectionIds.indexOf(activeSectionId);
                  const prevId = navIdx > 0 ? presentSectionIds[navIdx - 1] : null;
                  const nextId = navIdx !== -1 && navIdx < presentSectionIds.length - 1 ? presentSectionIds[navIdx + 1] : null;
                  if (!prevId && !nextId) return null;
                  return (
                    <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
                      {prevId ? (
                        <button
                          onClick={() => setActiveSectionId(prevId)}
                          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                        >
                          <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">Previous: {sectionLabelFor(prevId)}</span>
                        </button>
                      ) : <span />}
                      {nextId && (
                        <button
                          onClick={() => setActiveSectionId(nextId)}
                          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-right text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                        >
                          <span className="truncate">Next: {sectionLabelFor(nextId)}</span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <X className="mb-2 h-6 w-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">This section isn't part of the {selectedRole} package.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {receiptModal && <ReceiptViewer receipt={receiptModal} onClose={() => setReceiptModal(null)} />}
      {id && (
        <AskPanel
          projectId={id}
          packageId={pkg?.id ?? selectedPackageParam}
          open={askOpen}
          onClose={() => setAskOpen(false)}
          onReceiptClick={setReceiptModal}
        />
      )}
      {id && (
        <ProvenancePanel
          projectId={id}
          packageId={pkg?.id ?? selectedPackageParam}
          open={provenanceOpen}
          onClose={() => setProvenanceOpen(false)}
        />
      )}
      {readerTourOpen && <AppTour steps={READER_TOUR_STEPS} onDone={finishReaderTour} />}
    </div>
  );
}
