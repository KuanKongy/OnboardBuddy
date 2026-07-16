import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  FileCode2,
  FileText,
  GitCommitHorizontal,
  HelpCircle,
  Layers,
  Loader2,
  RefreshCw,
  Route,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AnalyzeDialog } from "@/components/AnalyzeDialog";
import { AppTour, type TourStep } from "@/components/AppTour";
import { useHotkeys } from "@/hooks/useHotkeys";
import { PageHeader } from "@/components/PageHeader";
import { SidebarToggle } from "@/components/SidebarShell";
import { useAuth } from "@/contexts/AuthContext";
import { useProject } from "@/contexts/ProjectContext";
import { usePackages } from "@/contexts/PackagesContext";
import { apiFetch } from "@/lib/api";
import { dismissTour, tourDismissed } from "@/lib/tourState";
import { useProgress } from "@/lib/useProgress";
import {
  ROLES,
  SECTION_NAV_ORDER,
  fetchOnboardingPackage,
  regenerateSection,
} from "@/lib/onboardingData";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  OnboardingPackage,
  OnboardingSection,
  PackageCard,
  SectionId,
  SourceReceipt,
} from "@/types/onboarding";
import { ReceiptViewer } from "@/components/ReceiptViewer";
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
  return (
    <Badge variant="outline" className={cn("text-[11px] capitalize", STATUS_STYLE[status] ?? "")}>
      {status}
    </Badge>
  );
}

function confidenceStyle(c: ConfidenceLevel) {
  return c === "high"
    ? "border-success/40 bg-success-soft text-success"
    : c === "medium"
      ? "border-warning/40 bg-warning-soft text-warning"
      : "border-danger/40 bg-danger-soft text-danger";
}

const UNKNOWN_LABELS: Record<string, string> = {
  uncited_claim: "A statement couldn't be backed by evidence and was downgraded",
  budget_degraded: "Generation stopped early because the analysis budget ran out",
  facts_only_privacy: "Code snippets were withheld under this project's privacy mode",
  no_workflows_found: "No workflows could be traced in this codebase",
  unsupported_languages: "Some files are in languages the analyzer doesn't parse yet",
  docs_conflict_with_code: "Documentation disagrees with the code — the code was trusted",
  unexplained_step: "A step in a flow couldn't be explained from the available evidence",
  ai_disabled: "Generated without AI (privacy mode: AI disabled) — deterministic facts only",
  noReceipt: "No citable evidence was available for this topic",
  docs_only_support: "This claim rests on documentation alone (docs may lag the code)",
};

/**
 * "How packages work" tour: the transparency contract for package lifecycle —
 * when a package is updated in place, when a new one appears, when nothing is
 * ever silently discarded, when stale badges (the diff signal) show up, and
 * what the AI & privacy setting changes.
 */
const LIFECYCLE_TOUR_STEPS: TourStep[] = [
  {
    target: "onboarding-header",
    title: "One package per scope, role & commit",
    body: "Every package is pinned to the exact commit it was analyzed at. Generating the same role at the same commit UPDATES that package in place — packages are never silently discarded.",
  },
  {
    target: "onboarding-cards",
    title: "When a package updates vs. multiplies",
    body: "Regenerate rebuilds sections in place for the same commit. Analyzing a NEW commit re-checks existing packages and stale-flags only what changed; a new card appears once you generate or regenerate a package at that commit. Older cards stay, marked 'behind latest'.",
  },
  {
    target: "onboarding-cards",
    title: "Stale badges are your diff signal",
    body: "Push commits, then re-analyze: only sections whose underlying code evidence actually changed get a stale badge (whitespace-only edits flag nothing). A stale section shows a banner in the reader — Regenerate rebuilds it against the newest analysis while review history is kept.",
  },
  {
    target: "onboarding-filters",
    title: "Privacy decides HOW, not WHETHER",
    body: "The AI & privacy setting applies to the very next generation — no re-analysis needed. Full AI narrates with code snippets, facts-only sends no code to the model, and AI-disabled builds deterministic fact sheets with zero LLM calls.",
  },
];

/** First visit to the READER: how to move through and track a package. */
const READER_TOUR_STEPS: TourStep[] = [
  {
    target: "reader-sections",
    title: "Your reading path",
    body: "Sections are ordered for onboarding — work top-down (or use ← / →). A warning icon means a section went stale after a newer analysis; a red dot means low confidence.",
  },
  {
    target: "reader-review",
    title: "Track what you've read",
    body: "Mark each section reviewed as you finish it — that's your progress tracker AND a signal to teammates that the content was checked. If a regeneration changes a section, it drops back to draft so you know to re-read it.",
  },
  {
    target: "reader-actions",
    title: "Export or refresh",
    body: "Download the whole package as Markdown here. Owners and admins can also rebuild a single section against the newest analysis with 'Regenerate section'.",
  },
];

// ── section reader ────────────────────────────────────────────────────────────

function ReceiptChip({ receipt, onClick }: { receipt: SourceReceipt; onClick: (r: SourceReceipt) => void }) {
  const lineRange = receipt.lineStart
    ? ` ${receipt.lineStart}${receipt.lineEnd ? `–${receipt.lineEnd}` : ""}`
    : "";
  return (
    <button
      onClick={() => onClick(receipt)}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11.5px] transition-colors hover:border-primary/50 hover:bg-accent",
        receipt.staleness === "stale" ? "border-warning/40 bg-warning-soft" : "border-border bg-muted/40",
      )}
      title={receipt.snippet ? "Click to view the code snippet" : receipt.filePath}
    >
      <FileCode2 className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-foreground">{receipt.filePath}</span>
      {lineRange && <span className="shrink-0 text-muted-foreground">{lineRange}</span>}
      {receipt.staleness === "stale" && <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-warning" />}
    </button>
  );
}

function initialBlockExpansion(section: OnboardingSection): boolean[] {
  return section.blocks.map((_, i) => i === 0);
}

function SectionView({
  section,
  onReceiptClick,
}: {
  section: OnboardingSection;
  onReceiptClick: (r: SourceReceipt) => void;
}) {
  const [expanded, setExpanded] = useState<boolean[]>(() => initialBlockExpansion(section));

  useLayoutEffect(() => {
    setExpanded(initialBlockExpansion(section));
  }, [section.id]);

  if (section.status === "missing") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <XCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
        <h3 className="text-sm font-medium text-foreground">Section not generated</h3>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          This section hasn't been generated yet. Generate the full package or regenerate this section individually.
        </p>
      </div>
    );
  }

  const hasSecondaryBlocks = section.blocks.length > 1;
  const secondaryExpanded = expanded.slice(1);
  const allSecondaryExpanded = secondaryExpanded.length > 0 && secondaryExpanded.every(Boolean);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("text-[11px] capitalize", confidenceStyle(section.confidence))}>
          {section.confidence} confidence
        </Badge>
        {section.status === "stale" && (
          <Badge variant="outline" className={cn("text-[11px]", STATUS_STYLE.stale)}>
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

      {section.blocks.map((block, bi) => {
        const isLead = bi === 0;
        const canCollapse = hasSecondaryBlocks && !isLead;
        const isOpen = isLead || expanded[bi];
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
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{block.title}</h3>
                {block.receipts.length > 0 && (
                  <span className="shrink-0 text-[11px] text-muted-foreground/60">
                    {block.receipts.length} source ref{block.receipts.length === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            ) : (
              <h3 className="mb-1.5 text-[13px] font-semibold text-foreground">{block.title}</h3>
            )}

            <div className={cn("grid transition-[grid-template-rows] duration-200 ease-in-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <div className="overflow-hidden" inert={!isOpen}>
                <div className="prose prose-sm dark:prose-invert mb-3 max-w-none text-[13.5px] leading-relaxed text-muted-foreground prose-headings:text-foreground prose-headings:text-[13.5px] prose-headings:font-semibold prose-strong:text-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-li:my-0.5 prose-p:my-1.5 prose-ul:my-1 prose-pre:max-h-72 prose-pre:overflow-auto">
                  <ReactMarkdown>{block.body}</ReactMarkdown>
                </div>
                {block.receipts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {block.receipts.map((r, ri) => (
                      <ReceiptChip key={ri} receipt={r} onClick={onReceiptClick} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Deterministic diagrams (Mermaid) embedded in this section */}
      {(section.diagrams ?? []).map((d, i) => (
        <MermaidDiagram key={i} code={d.mermaid} label={`${d.kind.replace(/_/g, " ")} diagram`} />
      ))}

      {/* Honest unknowns: gaps stated plainly instead of invented content */}
      {(section.unknowns ?? []).length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
          <p className="section-label mb-1.5 flex items-center gap-1.5">
            <HelpCircle className="h-3 w-3" /> Known gaps
          </p>
          <ul className="space-y-1">
            {section.unknowns!.map((u, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-muted-foreground">
                {UNKNOWN_LABELS[u.kind] ?? u.kind.replace(/_/g, " ")}
                {u.detail ? <span className="text-muted-foreground/70"> — {u.detail}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── package cards ─────────────────────────────────────────────────────────────

export function PackageCardView({ card, onOpen, onRegenerate }: { card: PackageCard; onOpen: () => void; onRegenerate?: () => void }) {
  return (
    // A div-with-role instead of <button> so the nested Regenerate button
    // stays valid HTML.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{card.scope_name}</span>
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {ROLES.find((r) => r.key === card.role)?.label ?? card.role}
          </p>
        </div>
        <StatusBadge status={card.status} />
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <GitCommitHorizontal className="h-3 w-3" />
        <span className="truncate font-mono">{card.branch}@{card.analyzed_commit.slice(0, 7)}</span>
        {card.is_latest_commit ? (
          <span className="text-success">latest</span>
        ) : (
          <span className="text-warning">behind latest</span>
        )}
        <span className="ml-auto shrink-0">{new Date(card.updated_at).toLocaleDateString()}</span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-[11.5px] tabular-nums text-muted-foreground">
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
        {card.low_confidence_sections > 0 && (
          <span className="text-danger">{card.low_confidence_sections} low confidence</span>
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
  const { packages: cards, refreshPackages, selectPackage, registerSessionJob } = usePackages();

  const view = searchParams.get("view") ?? "cards";
  const selectedRole = searchParams.get("role") ?? project?.developer_role ?? "general";
  // ?package=<id> pins the reader to one exact package (set when opening a
  // card); legacy ?role= links keep the old "latest for role" behavior.
  const selectedPackageParam = searchParams.get("package");

  const cardsLoading = cards === null;
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [freshFilter, setFreshFilter] = useState("all");

  // Deep link / resume: ?section= opens the reader at a specific section.
  const [activeSectionId, setActiveSectionId] = useState<SectionId>(
    () => (searchParams.get("section") as SectionId) ?? "start-here",
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
  const { save: saveProgress } = useProgress(id);

  // Remember where the reader is so "Continue onboarding" resumes here.
  useEffect(() => {
    if (view !== "reader" || !pkg?.id || pkg.status === "missing") return;
    saveProgress("onboarding", pkg.id, {
      sectionType: activeSectionId,
      role: pkg.role ?? selectedRole,
      packageId: pkg.id,
    });
  }, [view, pkg?.id, pkg?.role, pkg?.status, activeSectionId, selectedRole, saveProgress]);

  function setParams(next: Record<string, string | null>) {
    setSearchParams((prev) => {
      for (const [k, v] of Object.entries(next)) {
        if (v === null) prev.delete(k);
        else prev.set(k, v);
      }
      return prev;
    }, { replace: true });
  }

  // Package list + its while-generating refresh live in PackagesContext (the
  // one shared poll); this page only re-requests on explicit actions.
  const loadCards = refreshPackages;

  useEffect(() => {
    if (!id || view !== "reader") return;
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    fetchOnboardingPackage(id, { packageId: selectedPackageParam, role: selectedRole })
      .then((data) => { if (!controller.signal.aborted) setPkg(data); })
      .catch(() => {});
    return () => { controller.abort(); };
  }, [id, selectedRole, selectedPackageParam, view]);

  useEffect(() => {
    setGenerating(project?.status === "analyzing");
  }, [project?.status]);

  // Sections persist one by one while the package is generating — poll so
  // they appear as they land instead of only after the whole run finishes.
  useEffect(() => {
    if (!id || view !== "reader") return;
    if (pkg?.status !== "generating" && !generating) return;
    const timer = window.setInterval(() => {
      fetchOnboardingPackage(id, { packageId: selectedPackageParam, role: selectedRole })
        .then((data) => {
          if (!data) return;
          setPkg(data);
          if (data.status !== "generating" && data.status !== "missing") loadCards();
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [id, view, selectedRole, selectedPackageParam, pkg?.status, generating]);

  // First visit to the package grid: auto-run the "How packages work" tour —
  // but only after the project-level tour was dismissed, so two spotlight
  // overlays never stack on a brand-new account's first project visit.
  useEffect(() => {
    if (view === "reader" || cardsLoading || !user) return;
    if (!tourDismissed("project", user.id)) return;
    if (tourDismissed("onboardingLifecycle", user.id)) return;
    setLifecycleTourOpen(true);
  }, [view, cardsLoading, user]);

  function finishLifecycleTour() {
    if (user) dismissTour("onboardingLifecycle", user.id);
    setLifecycleTourOpen(false);
  }

  const canManage = project?.permission_tier === "owner" || project?.permission_tier === "admin";
  const isMissing = !pkg || pkg.status === "missing";
  const sections = isMissing ? [] : pkg.sections;
  const activeSection = sections.find((s) => s.id === activeSectionId);
  const markedReviewed = activeSection?.reviewStatus === "approved";

  // First reader visit: a 3-step coach mark (reading path → mark reviewed →
  // export/regenerate). Only after the project tour, and only with content.
  const [readerTourOpen, setReaderTourOpen] = useState(false);
  useEffect(() => {
    if (view !== "reader" || isMissing || sections.length === 0 || !user) return;
    if (!tourDismissed("project", user.id)) return;
    if (tourDismissed("onboardingReader", user.id)) return;
    setReaderTourOpen(true);
  }, [view, isMissing, sections.length, user]);
  function finishReaderTour() {
    if (user) dismissTour("onboardingReader", user.id);
    setReaderTourOpen(false);
  }

  // ← / → move through the present sections while reading.
  const presentSectionIds = SECTION_NAV_ORDER.filter((navId) => sections.some((s) => s.id === navId));
  const moveSection = (delta: number) => {
    const idx = presentSectionIds.indexOf(activeSectionId);
    const next = presentSectionIds[Math.min(Math.max((idx === -1 ? 0 : idx) + delta, 0), presentSectionIds.length - 1)];
    if (next && next !== activeSectionId) setActiveSectionId(next);
  };
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
      const poll = window.setInterval(async () => {
        const polled = await fetchOnboardingPackage(id, { role: selectedRole });
        if ((polled && polled.status !== "missing") || Date.now() - started > 300_000) {
          window.clearInterval(poll);
          setGenerating(false);
          if (polled) {
            setPkg(polled);
            // Pin the reader to the package that just landed.
            if (polled.id) setParams({ package: polled.id });
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
      const poll = window.setInterval(async () => {
        const data = await fetchOnboardingPackage(id, { packageId: selectedPackageParam, role: selectedRole });
        const fresh = data?.sections.find((s) => s.id === activeSectionId);
        if (fresh && fresh.sectionId !== oldId) {
          window.clearInterval(poll);
          setRegenerating(false);
          if (data) setPkg(data);
          loadCards();
        } else if (Date.now() - started > 120_000) {
          window.clearInterval(poll);
          setRegenerating(false);
          setActionError("Regeneration is taking longer than expected — the section will replace itself when the worker finishes. Check the Overview page for job status.");
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
    try {
      await apiFetch(`/projects/${id}/onboarding/sections/${activeSection.sectionId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ review_status: newStatus }),
      });
      fetchOnboardingPackage(id, { packageId: selectedPackageParam, role: selectedRole })
        .then((data) => { if (data) setPkg(data); });
    } catch (err) {
      console.error("Review update error:", err);
    }
  }

  async function handleExport() {
    if (!id) return;
    try {
      const exportQs = selectedPackageParam
        ? `package_id=${encodeURIComponent(selectedPackageParam)}`
        : `role=${encodeURIComponent(selectedRole)}`;
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/projects/${id}/onboarding/export?${exportQs}`,
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
      console.error("Export error:", err);
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
    return (
      <div>
        <div data-tour="onboarding-header">
          <PageHeader
            title="Your onboarding"
            subtitle="Generated onboarding packages — one per scope, role, and analyzed commit."
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => setLifecycleTourOpen(true)}
                  title="When packages update, when new ones appear, and when stale badges show up"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  How packages work
                </Button>
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
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ROLES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {["draft", "approved", "stale", "generating", "failed"].map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={freshFilter} onValueChange={setFreshFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any commit</SelectItem>
                <SelectItem value="latest">Latest commit</SelectItem>
                <SelectItem value="behind">Behind latest</SelectItem>
              </SelectContent>
            </Select>
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
              {filtered.length} / {cards.length} packages
            </span>
          </div>
        )}

        {cardsLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : !cards || cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <BookOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">No onboarding packages yet</h2>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              Run an analysis to generate role-based onboarding: entry points, critical files,
              workflows, tutorials, and safety notes — every claim backed by code receipts.
            </p>
            {canManage && (
              <Button
                size="sm"
                className="mt-4 gap-1.5"
                onClick={() => { setAnalyzeInitialRole(undefined); setAnalyzeOpen(true); }}
                disabled={generating || project?.status === "analyzing"}
              >
                {generating || project?.status === "analyzing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {generating || project?.status === "analyzing" ? "Analyzing…" : "Analyze & generate…"}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-tour="onboarding-cards">
            {filtered.map((card) => (
              <PackageCardView
                key={card.id}
                card={card}
                onOpen={() => {
                  // Opening a card pins the reader to that exact package and
                  // makes it the sidebar selection so every tab follows.
                  selectPackage(card.id);
                  setParams({ view: "reader", package: card.id, role: card.role });
                }}
                onRegenerate={() => {
                  setRegenError("");
                  setRegenCard(card);
                }}
              />
            ))}
          </div>
        )}

        {/* Per-package regeneration: whole package now, or a fresh analysis
            at a new commit first. Single sections regenerate in the reader. */}
        <Dialog open={regenCard !== null} onOpenChange={(open) => !open && setRegenCard(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">
                Regenerate {ROLES.find((r) => r.key === regenCard?.role)?.label ?? regenCard?.role} package
              </DialogTitle>
            </DialogHeader>

            {regenError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {regenError}
              </div>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleRegeneratePackage}
                disabled={regenBusy}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 disabled:opacity-60"
              >
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                  {regenBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Regenerate from the current analysis
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Rebuilds every section and tutorial of this package against the latest analyzed
                  commit — no repo re-analysis; unchanged content comes from cache.
                  {regenCard && !regenCard.is_latest_commit &&
                    " This package is behind the latest analysis, so this also brings it up to date."}
                </p>
              </button>

              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setAnalyzeInitialRole(regenCard?.role);
                    setRegenCard(null);
                    setAnalyzeOpen(true);
                  }}
                  className="w-full rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                    Re-analyze at a new commit first…
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Pick branch, commit, and scope with a cost preview; a fresh analysis runs and
                    this role's package is generated from it.
                  </p>
                </button>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Need just one section? Open the package and use "Regenerate section" inside the
              reader — it rebuilds only that section against the newest analysis.
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
    <div className="flex min-h-full flex-col">
      {/* compact top bar: navigation + role + actions in one row */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background px-1 pb-2.5">
        <SidebarToggle />
        <Button variant="ghost" size="xs" onClick={() => setParams({ view: null, package: null })} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Packages
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-foreground">
            {activeSection?.label ?? "Onboarding"}
          </h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {!isMissing && <StatusBadge status={generating ? "generating" : pkg.status} />}
          {selectedPackageParam ? (
            // Pinned to one exact package — role is part of its identity.
            <Badge variant="outline" className="h-7 px-2 text-xs">
              {ROLES.find((r) => r.key === (pkg?.role ?? selectedRole))?.label ?? (pkg?.role ?? selectedRole)}
            </Badge>
          ) : (
            <Select value={selectedRole} onValueChange={(r) => setParams({ role: r })}>
              <SelectTrigger className="h-7 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {!isMissing && (
            <>
              {/* Always-visible per-section regeneration (owner/admin — the
                  endpoint enforces the same tiers). The stale banner keeps
                  its own contextual copy of this action. */}
              {canManage && activeSection?.sectionId && (
                <Button
                  size="xs"
                  variant="outline"
                  className="gap-1.5"
                  onClick={handleRegenerateSection}
                  disabled={regenerating}
                  title="Rebuild this section against the newest analysis"
                >
                  {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {regenerating ? "Regenerating…" : "Regenerate section"}
                </Button>
              )}
              <Button
                size="xs"
                variant={markedReviewed ? "secondary" : "default"}
                data-tour="reader-review"
                className={cn(
                  "gap-1.5",
                  markedReviewed
                    ? "border-success/40 bg-success-soft text-success"
                    : "ring-2 ring-primary/30",
                )}
                onClick={handleToggleReview}
              >
                {markedReviewed ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                {markedReviewed ? "Reviewed" : "Mark reviewed"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="outline" className="gap-1" data-tour="reader-actions">
                    <Download className="h-3 w-3" />
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem className="text-xs" onSelect={handleExport}>
                    <FileText className="mr-2 h-3 w-3" /> Markdown file
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {!isMissing && pkg.status === "generating" && (
        <div className="flex items-center gap-2 border-b bg-info-soft px-5 py-2 text-xs text-info">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating — sections appear here as each one finishes ({sections.length}/11 so far).
        </div>
      )}

      {actionError && (
        <div className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger-soft px-5 py-2 text-xs text-danger">
          <span>
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
            {actionError}
          </span>
          <button className="shrink-0 opacity-70 hover:opacity-100" onClick={() => setActionError("")} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Mobile section picker — the section nav aside is desktop-only. */}
      {!isMissing && sections.length > 0 && (
        <div className="border-b px-4 py-2 lg:hidden">
          <Select value={activeSectionId ?? undefined} onValueChange={(v) => setActiveSectionId(v as typeof activeSectionId)}>
            <SelectTrigger className="h-8 w-full text-[13px]"><SelectValue placeholder="Jump to section" /></SelectTrigger>
            <SelectContent>
              {SECTION_NAV_ORDER
                .filter((navId) => sections.some((s) => s.id === navId))
                .map((navId, idx) => {
                  const section = sections.find((s) => s.id === navId);
                  return (
                    <SelectItem key={navId} value={navId} className="text-[13px]">
                      {idx + 1}. {section?.label ?? navId}
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* section nav */}
        <aside className="hidden w-52 shrink-0 border-r py-3 pr-2 lg:block" data-tour="reader-sections">
          <p className="section-label mb-2 px-2">Sections</p>
          <nav className="space-y-0.5">
            {SECTION_NAV_ORDER
              .filter((navId) => isMissing || sections.some((s) => s.id === navId))
              .map((navId, idx) => {
              const section = sections.find((s) => s.id === navId);
              const label = section?.label ?? navId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
              const isActive = activeSectionId === navId;
              return (
                <button
                  key={navId}
                  onClick={() => setActiveSectionId(navId)}
                  disabled={isMissing}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors disabled:opacity-40",
                    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/50">{idx + 1}</span>
                  <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
                  {section?.status === "stale" && <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />}
                  {section?.confidence === "low" && section.status !== "stale" && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" title="Low confidence" />
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* content */}
        <div className="min-w-0 flex-1 px-5 py-5 lg:px-8">
          <div className="mx-auto max-w-3xl">
            {isMissing ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <FileText className="h-6 w-6 text-muted-foreground" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">
                  No package for {ROLES.find((r) => r.key === selectedRole)?.label ?? selectedRole}
                </h2>
                <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                  Generate this role's package from the latest analysis — role-specific entry
                  points, critical files, workflows, and safety notes. Other roles are unaffected.
                </p>
                <Button size="sm" className="mt-4 gap-1.5" onClick={handleGenerateRole} disabled={generating}>
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {generating ? "Generating…" : `Generate for ${ROLES.find((r) => r.key === selectedRole)?.label ?? selectedRole}`}
                </Button>
              </div>
            ) : activeSection ? (
              <>
                {activeSection.status === "stale" && canManage && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2">
                    <p className="text-xs text-warning">
                      <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                      Stale — source files changed since this was written. Regenerating rebuilds it against the newest analysis.
                    </p>
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
                  </div>
                )}
                <SectionView section={activeSection} onReceiptClick={setReceiptModal} />
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
      {readerTourOpen && <AppTour steps={READER_TOUR_STEPS} onDone={finishReaderTour} />}
    </div>
  );
}
