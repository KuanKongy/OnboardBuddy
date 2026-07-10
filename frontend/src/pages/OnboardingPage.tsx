import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Download,
  Eye,
  FileCode2,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useProject } from "@/contexts/ProjectContext";
import { apiFetch } from "@/lib/api";
import { fetchOnboardingPackage } from "@/lib/onboardingData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  ConfidenceLevel,
  OnboardingPackage,
  OnboardingSection,
  PackageStatus,
  SectionId,
  SourceReceipt,
} from "@/types/onboarding";
import { ROLES, SECTION_NAV_ORDER } from "@/lib/mockOnboardingData";
import { ReceiptViewer } from "@/components/ReceiptViewer";

// ── helpers ──────────────────────────────────────────────────────────────────

function statusVariant(s: PackageStatus) {
  switch (s) {
    case "approved": return "default";
    case "draft":    return "secondary";
    case "stale":    return "outline";
    case "generating": return "secondary";
    default:         return "destructive";
  }
}

function statusLabel(s: PackageStatus) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function confidenceColor(c: ConfidenceLevel) {
  return c === "high"
    ? "text-emerald-600 dark:text-emerald-400"
    : c === "medium"
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
}

function confidenceBg(c: ConfidenceLevel) {
  return c === "high"
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
    : c === "medium"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
      : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30";
}

// ── sub-components ────────────────────────────────────────────────────────────

function SectionStatusDot({ status }: { status: OnboardingSection["status"] }) {
  if (status === "complete") return <Circle className="h-2 w-2 fill-emerald-600 text-emerald-600 dark:fill-emerald-400 dark:text-emerald-400" />;
  if (status === "stale")    return <AlertTriangle className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400" />;
  return <X className="h-2.5 w-2.5 text-muted-foreground/60" />;
}

function ReceiptChip({
  receipt,
  onClick,
}: {
  receipt: SourceReceipt;
  onClick: (r: SourceReceipt) => void;
}) {
  const lineRange =
    receipt.lineStart && receipt.lineEnd
      ? ` ${receipt.lineStart}–${receipt.lineEnd}`
      : receipt.lineStart
        ? ` ${receipt.lineStart}`
        : "";

  return (
    <button
      onClick={() => onClick(receipt)}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-mono transition-colors hover:border-primary/50 hover:bg-accent ${
        receipt.staleness === "stale"
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-border bg-muted/40"
      }`}
    >
      <FileCode2 className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
      <span className="text-foreground">{receipt.filePath}</span>
      {lineRange && (
        <span className="text-muted-foreground">{lineRange}</span>
      )}
      <span className={`font-sans capitalize ${confidenceColor(receipt.confidence)}`}>
        {receipt.confidence.charAt(0).toUpperCase() + receipt.confidence.slice(1)}
      </span>
      <span className="text-muted-foreground/60">{receipt.ageLabel}</span>
      {receipt.staleness === "stale" && (
        <AlertTriangle className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400" />
      )}
    </button>
  );
}

function MarkReviewedButton({
  reviewed,
  onClick,
  className = "",
}: {
  reviewed: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="xs"
          variant={reviewed ? "secondary" : "outline"}
          className={`gap-1.5 ${
            reviewed ? "border border-emerald-600/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400" : ""
          } ${className}`}
          onClick={onClick}
          aria-label={reviewed ? "Reviewed. Click to mark as not reviewed." : "Mark as reviewed"}
        >
          {reviewed ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
          {reviewed ? "Reviewed" : "Mark as reviewed"}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {reviewed
          ? "Click to mark as not reviewed."
          : "Marks this section as reviewed for you on this device. Team-wide review sharing is coming soon."}
      </TooltipContent>
    </Tooltip>
  );
}

// Blocks after the first render collapsed by default; the first block is the
// lead concept for the section and always starts expanded.
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

  // Local expansion state is per-section only — reset whenever the user
  // switches sections (no persistence needed). Layout effect so a section
  // with a different block count never paints against the old array.
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

  // Only sections with more than one block get collapse chrome — a single
  // block has nothing secondary to hide.
  const hasSecondaryBlocks = section.blocks.length > 1;
  const secondaryExpanded = expanded.slice(1);
  const allSecondaryExpanded = secondaryExpanded.length > 0 && secondaryExpanded.every(Boolean);

  function toggleBlock(bi: number) {
    setExpanded((prev) => prev.map((v, i) => (i === bi ? !v : v)));
  }

  function toggleAll() {
    setExpanded(
      allSecondaryExpanded ? initialBlockExpansion(section) : section.blocks.map(() => true),
    );
  }

  return (
    <div className="space-y-6">
      {/* section header */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={`text-xs border ${confidenceBg(section.confidence)}`} variant="outline">
          {section.confidence.charAt(0).toUpperCase() + section.confidence.slice(1)} confidence
        </Badge>
        {section.status === "stale" && (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mr-1 h-2.5 w-2.5" />
            Stale
          </Badge>
        )}
        {section.reviewedBy && (
          <span className="text-xs text-muted-foreground">
            Reviewed by <span className="font-medium text-foreground">@{section.reviewedBy}</span>
            {section.reviewedAt && ` · ${section.reviewedAt}`}
          </span>
        )}
        {hasSecondaryBlocks && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            onClick={toggleAll}
          >
            {allSecondaryExpanded ? "Collapse all" : "Expand all"}
          </Button>
        )}
      </div>

      {/* content blocks */}
      {section.blocks.map((block, bi) => {
        const isLead = bi === 0;
        const canCollapse = hasSecondaryBlocks && !isLead;
        const isOpen = isLead || expanded[bi];

        return (
          <div key={bi}>
            {canCollapse ? (
              <button
                type="button"
                onClick={() => toggleBlock(bi)}
                aria-expanded={isOpen}
                className="mb-1.5 flex w-full items-center gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-accent/40 -mx-1"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${
                    isOpen ? "" : "-rotate-90"
                  }`}
                />
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                  {block.title}
                </h3>
                {block.receipts.length > 0 && (
                  <span className="shrink-0 text-[11px] text-muted-foreground/60">
                    {block.receipts.length} source ref{block.receipts.length === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            ) : (
              <h3 className="mb-1.5 text-[13px] font-semibold text-foreground">{block.title}</h3>
            )}

            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden" inert={!isOpen}>
                <div className="prose prose-sm dark:prose-invert mb-3 max-w-none text-[13px] leading-relaxed text-muted-foreground prose-headings:text-foreground prose-headings:text-[13px] prose-headings:font-semibold prose-strong:text-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:text-foreground prose-li:my-0.5 prose-p:my-1.5 prose-ul:my-1">
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
            {bi < section.blocks.length - 1 && <Separator className="mt-5" />}
          </div>
        );
      })}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export function OnboardingPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { project, refetch } = useProject();

  const initialRole = searchParams.get("role") ?? project?.developer_role ?? "general";
  const [selectedRole, setSelectedRole] = useState<string>(initialRole);
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("start-here");
  const [pkg, setPkg] = useState<OnboardingPackage | null>(null);
  const [generating, setGenerating] = useState(false);
  const [regeneratingSection, setRegeneratingSection] = useState(false);
  const [markedReviewed, setMarkedReviewed] = useState(false);
  const [receiptModal, setReceiptModal] = useState<SourceReceipt | null>(null);
  const [roleStatuses, setRoleStatuses] = useState<Record<string, string>>({});
  const fetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    fetchOnboardingPackage(id, selectedRole)
      .then((data) => { if (!controller.signal.aborted) setPkg(data); })
      .catch(() => {});

    return () => { controller.abort(); };
  }, [id, selectedRole]);

  useEffect(() => {
    if (!id) return;
    ROLES.forEach((role) => {
      fetchOnboardingPackage(id, role.key)
        .then((data) => {
          setRoleStatuses((prev) => ({ ...prev, [role.key]: data?.status ?? "missing" }));
        })
        .catch(() => {
          setRoleStatuses((prev) => ({ ...prev, [role.key]: "missing" }));
        });
    });
  }, [id, project?.status]);

  // Analysis runs at the project level, so a project that's analyzing means a
  // package is being (re)generated. Keep the generating UI in sync with it.
  useEffect(() => {
    setGenerating(project?.status === "analyzing");
  }, [project?.status]);

  const isMissing = !pkg || pkg.status === "missing";
  const canManage =
    project?.permission_tier === "owner" || project?.permission_tier === "admin";

  const sections = isMissing ? [] : pkg.sections;
  const activeSection = sections.find((s) => s.id === activeSectionId);

  // Lightweight prioritization cue: the first section in reading order that's
  // actually generated gets a "Start here" nudge — no reordering, no scores.
  const startHereSectionId = SECTION_NAV_ORDER.find((navId) => {
    const s = sections.find((sec) => sec.id === navId);
    return s && s.status !== "missing";
  });

  async function handleGenerate() {
    if (!id) return;
    setGenerating(true);
    try {
      await apiFetch(`/projects/${id}/analyze`, { method: "POST" });
      refetch(); // project.status flips to analyzing; the effect keeps `generating` in sync
      fetchOnboardingPackage(id, selectedRole).then(setPkg);
    } catch {
      setGenerating(false);
    }
  }

  function handleRegenerateSection() {
    setRegeneratingSection(true);
    setTimeout(() => setRegeneratingSection(false), 1500);
  }

  function handleExport(format: "markdown" | "pdf") {
    // In real impl: GET /api/projects/:id/onboarding/export?role=...&format=...
    const filename = `onboarding-${selectedRole}.${format === "pdf" ? "pdf" : "md"}`;
    alert(`Exporting ${filename} (mock — real endpoint: GET /api/projects/:id/onboarding/export?role=${selectedRole}&format=${format})`);
  }

  return (
    <div className="flex min-h-full gap-0">
      {/* ── left section nav ── */}
      <aside className="sticky top-0 hidden h-screen w-48 shrink-0 flex-col overflow-y-auto border-r lg:flex">
        <div className="px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sections
          </p>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {SECTION_NAV_ORDER.map((id, idx) => {
            const section = sections.find((s) => s.id === id);
            const label = section?.label ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            const status = section?.status ?? "missing";
            const isActive = activeSectionId === id;
            const isStartHere = id === startHereSectionId;

            return (
              <button
                key={id}
                onClick={() => setActiveSectionId(id)}
                disabled={isMissing}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors disabled:opacity-40 ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <SectionStatusDot status={status} />
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">
                  {idx + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
                {isStartHere && (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-primary/30 bg-primary/5 px-1 py-0 text-[11px] font-normal text-primary"
                  >
                    Start here
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── main content ── */}
      <div className="flex min-w-0 flex-1 flex-col border-r">
        {/* top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-2.5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {activeSection?.label ?? "Your Onboarding"}
              </h1>
              <p className="text-xs text-muted-foreground">
                Your role-based reading path through this codebase.
              </p>
            </div>
          </div>
          {/* mobile section selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" className="flex gap-1 lg:hidden">
                Sections <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SECTION_NAV_ORDER.map((id, idx) => {
                const section = sections.find((s) => s.id === id);
                const label = section?.label ?? id;
                return (
                  <DropdownMenuItem
                    key={id}
                    disabled={isMissing}
                    onSelect={() => setActiveSectionId(id)}
                  >
                    {idx + 1}. {label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Compact controls for non-xl screens (role, status, actions) */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2 xl:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs" className="gap-1 text-[12px]">
                <span
                  className="max-w-[100px] truncate"
                  title={ROLES.find((r) => r.key === selectedRole)?.label ?? selectedRole}
                >
                  {ROLES.find((r) => r.key === selectedRole)?.label ?? selectedRole}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {ROLES.map((role) => {
                const rs = roleStatuses[role.key] ?? "missing";
                return (
                  <DropdownMenuItem
                    key={role.key}
                    onSelect={() => {
                      setSelectedRole(role.key);
                      setActiveSectionId("start-here");
                      setMarkedReviewed(false);
                    }}
                    className="text-xs"
                  >
                    <span className="flex-1">{role.label}</span>
                    {rs === "missing" ? (
                      <span className="text-[11px] text-muted-foreground">Not generated</span>
                    ) : rs === "generating" ? (
                      <Badge variant="secondary" className="text-[11px]">Generating</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[11px]">
                        {statusLabel(rs as PackageStatus)}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {isMissing ? (
            <Badge variant="destructive" className="text-xs">Missing</Badge>
          ) : generating ? (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Generating
            </Badge>
          ) : (
            <Badge variant={statusVariant(pkg.status)} className="text-xs">
              {markedReviewed ? "Reviewed" : statusLabel(pkg.status)}
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-1">
            {isMissing ? (
              <Button size="xs" className="gap-1" onClick={handleGenerate} disabled={generating}>
                {generating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {generating ? "Generating…" : "Generate"}
              </Button>
            ) : (
              <>
                <MarkReviewedButton
                  reviewed={markedReviewed}
                  onClick={() => setMarkedReviewed(!markedReviewed)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="xs" variant="outline" className="gap-1">
                      <Download className="h-3 w-3" />
                      <span className="hidden sm:inline">Export</span>
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem className="text-xs" onSelect={() => handleExport("markdown")}>
                      <FileText className="mr-2 h-3 w-3" /> Markdown file
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-xs" onSelect={() => handleExport("pdf")}>
                      <FileCode2 className="mr-2 h-3 w-3" /> PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        {/* body */}
        <div className="flex-1 px-5 py-5">
          {isMissing ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">
                No onboarding package for{" "}
                {ROLES.find((r) => r.key === selectedRole)?.label ?? selectedRole}
              </h2>
              <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                Generate a package to get role-specific entry points, critical files, workflows, and safety notes.
              </p>
              <Button
                size="sm"
                className="mt-4 gap-1.5"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generating ? "Generating…" : "Generate Package"}
              </Button>
            </div>
          ) : activeSection ? (
            <>
              {/* stale section regen (owner/admin) */}
              {activeSection.status === "stale" && canManage && (
                <div className="mb-4 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    This section is stale — source files have changed since it was generated.
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                    onClick={handleRegenerateSection}
                    disabled={regeneratingSection}
                  >
                    {regeneratingSection ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                    )}
                    Regenerate
                  </Button>
                </div>
              )}
              <SectionView
                section={activeSection}
                onReceiptClick={(r) => setReceiptModal(r)}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* ── right action panel ── */}
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col gap-4 overflow-y-auto border-l px-4 py-4 xl:flex">
        {/* package status */}
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Package Status
          </p>
          {isMissing ? (
            <Badge variant="destructive" className="text-xs">Missing</Badge>
          ) : generating ? (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Generating
            </Badge>
          ) : (
            <Badge variant={statusVariant(pkg.status)} className="text-xs">
              {markedReviewed ? "Reviewed" : statusLabel(pkg.status)}
            </Badge>
          )}
        </div>

        <Separator />

        {/* role selector */}
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Role
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs" className="w-full justify-between gap-1 text-[12px]">
                <span
                  className="truncate"
                  title={ROLES.find((r) => r.key === selectedRole)?.label ?? selectedRole}
                >
                  {ROLES.find((r) => r.key === selectedRole)?.label ?? selectedRole}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {ROLES.map((role) => {
                const rs = roleStatuses[role.key] ?? "missing";
                return (
                  <DropdownMenuItem
                    key={role.key}
                    onSelect={() => {
                      setSelectedRole(role.key);
                      setActiveSectionId("start-here");
                      setMarkedReviewed(false);
                    }}
                    className="text-xs"
                  >
                    <span className="flex-1">{role.label}</span>
                    {rs === "missing" ? (
                      <span className="text-[11px] text-muted-foreground">Not generated</span>
                    ) : rs === "generating" ? (
                      <Badge variant="secondary" className="text-[11px]">Generating</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[11px]">
                        {statusLabel(rs as PackageStatus)}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Separator />

        {/* actions */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Actions
          </p>
          <div className="space-y-1.5">
            {isMissing ? (
              <Button
                size="xs"
                className="w-full gap-1.5"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {generating ? "Generating…" : "Generate"}
              </Button>
            ) : (
              <>
                <Button size="xs" variant="outline" className="w-full justify-start gap-1.5">
                  <Eye className="h-3 w-3" /> Review
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="xs" variant="outline" className="w-full justify-between gap-1.5">
                      <span className="flex items-center gap-1.5">
                        <Download className="h-3 w-3" /> Export
                      </span>
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem className="text-xs" onSelect={() => handleExport("markdown")}>
                      <FileText className="mr-2 h-3 w-3" /> Markdown file
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-xs" onSelect={() => handleExport("pdf")}>
                      <FileCode2 className="mr-2 h-3 w-3" /> PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <MarkReviewedButton
                  reviewed={markedReviewed}
                  onClick={() => setMarkedReviewed(!markedReviewed)}
                  className="w-full justify-start"
                />
              </>
            )}
          </div>
        </div>

        {/* admin-only */}
        {canManage && !isMissing && (
          <>
            <Separator />
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Admin Only
              </p>
              <Button
                size="xs"
                variant="ghost"
                className="w-full justify-start gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Re-analyse repo
              </Button>
            </div>
          </>
        )}

        {/* last generated */}
        {!isMissing && pkg.generatedAt && (
          <>
            <Separator />
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              Generated {new Date(pkg.generatedAt).toLocaleDateString()}
            </div>
          </>
        )}
      </aside>

      {/* ── receipt viewer ── */}
      {receiptModal && (
        <ReceiptViewer
          receipt={receiptModal}
          onClose={() => setReceiptModal(null)}
        />
      )}
    </div>
  );
}
