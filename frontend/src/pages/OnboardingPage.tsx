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
import { useState } from "react";
import { useProject } from "@/contexts/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import {
  MOCK_ONBOARDING_PACKAGES,
  ROLES,
  SECTION_NAV_ORDER,
} from "@/lib/mockOnboardingData";

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
  return c === "high" ? "text-emerald-400" : c === "medium" ? "text-amber-400" : "text-red-400";
}

function confidenceBg(c: ConfidenceLevel) {
  return c === "high"
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
    : c === "medium"
      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
      : "bg-red-500/10 text-red-400 border-red-500/30";
}

// ── sub-components ────────────────────────────────────────────────────────────

function SectionStatusDot({ status }: { status: OnboardingSection["status"] }) {
  if (status === "complete") return <Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" />;
  if (status === "stale")    return <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />;
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
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-mono transition-colors hover:border-primary/50 hover:bg-accent ${
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
        <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />
      )}
    </button>
  );
}

function SectionView({
  section,
  onReceiptClick,
}: {
  section: OnboardingSection;
  onReceiptClick: (r: SourceReceipt) => void;
}) {
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

  return (
    <div className="space-y-6">
      {/* section header */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={`text-[11px] border ${confidenceBg(section.confidence)}`} variant="outline">
          {section.confidence.charAt(0).toUpperCase() + section.confidence.slice(1)} confidence
        </Badge>
        {section.status === "stale" && (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-400">
            <AlertTriangle className="mr-1 h-2.5 w-2.5" />
            Stale
          </Badge>
        )}
        {section.reviewedBy && (
          <span className="text-[11px] text-muted-foreground">
            Reviewed by <span className="font-medium text-foreground">@{section.reviewedBy}</span>
            {section.reviewedAt && ` · ${section.reviewedAt}`}
          </span>
        )}
      </div>

      {/* content blocks */}
      {section.blocks.map((block, bi) => (
        <div key={bi}>
          <h3 className="mb-1.5 text-[13px] font-semibold text-foreground">{block.title}</h3>
          <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">{block.body}</p>
          {block.receipts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {block.receipts.map((r, ri) => (
                <ReceiptChip key={ri} receipt={r} onClick={onReceiptClick} />
              ))}
            </div>
          )}
          {bi < section.blocks.length - 1 && <Separator className="mt-5" />}
        </div>
      ))}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export function OnboardingPage() {
  const { project } = useProject();

  const [selectedRole, setSelectedRole] = useState<string>("general");
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("start-here");
  const [generating, setGenerating] = useState(false);
  const [regeneratingSection, setRegeneratingSection] = useState(false);
  const [markedReviewed, setMarkedReviewed] = useState(false);
  const [receiptModal, setReceiptModal] = useState<SourceReceipt | null>(null);

  const pkg: OnboardingPackage | undefined = MOCK_ONBOARDING_PACKAGES[selectedRole];
  const isMissing = !pkg || pkg.status === "missing";
  const canManage =
    project?.permission_tier === "owner" || project?.permission_tier === "admin";

  const sections = isMissing ? [] : pkg.sections;
  const activeSection = sections.find((s) => s.id === activeSectionId);

  function handleGenerate() {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
    }, 2000);
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sections
          </p>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {SECTION_NAV_ORDER.map((id) => {
            const section = sections.find((s) => s.id === id);
            const label = section?.label ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            const status = section?.status ?? "missing";
            const isActive = activeSectionId === id;

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
                <span className="truncate">{label}</span>
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
            <h1 className="text-sm font-semibold text-foreground">
              {activeSection?.label ?? "Your Onboarding"}
            </h1>
          </div>
          {/* mobile section selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" className="flex gap-1 lg:hidden">
                Sections <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SECTION_NAV_ORDER.map((id) => {
                const section = sections.find((s) => s.id === id);
                const label = section?.label ?? id;
                return (
                  <DropdownMenuItem
                    key={id}
                    disabled={isMissing}
                    onSelect={() => setActiveSectionId(id)}
                  >
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
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
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    This section is stale — source files have changed since it was generated.
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
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
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Package Status
          </p>
          {isMissing ? (
            <Badge variant="destructive" className="text-[11px]">Missing</Badge>
          ) : generating ? (
            <Badge variant="secondary" className="gap-1 text-[11px]">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Generating
            </Badge>
          ) : (
            <Badge variant={statusVariant(pkg.status)} className="text-[11px]">
              {markedReviewed ? "Approved" : statusLabel(pkg.status)}
            </Badge>
          )}
        </div>

        <Separator />

        {/* role selector */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Role
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs" className="w-full justify-between gap-1 text-[12px]">
                <span className="truncate">
                  {ROLES.find((r) => r.key === selectedRole)?.label ?? selectedRole}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {ROLES.map((role) => (
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
                  {MOCK_ONBOARDING_PACKAGES[role.key]?.status === "missing" ||
                  !MOCK_ONBOARDING_PACKAGES[role.key] ? (
                    <span className="text-[10px] text-muted-foreground">Missing</span>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      {statusLabel(MOCK_ONBOARDING_PACKAGES[role.key]!.status)}
                    </Badge>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Separator />

        {/* actions */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

                <Button
                  size="xs"
                  className={`w-full justify-start gap-1.5 ${markedReviewed ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                  onClick={() => setMarkedReviewed(!markedReviewed)}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {markedReviewed ? "Reviewed" : "Mark Reviewed"}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* admin-only */}
        {canManage && !isMissing && (
          <>
            <Separator />
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              Generated {new Date(pkg.generatedAt).toLocaleDateString()}
            </div>
          </>
        )}
      </aside>

      {/* ── receipt modal ── */}
      {receiptModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setReceiptModal(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold text-foreground">
                  {receiptModal.filePath}
                  {receiptModal.lineStart &&
                    ` : ${receiptModal.lineStart}${receiptModal.lineEnd ? `–${receiptModal.lineEnd}` : ""}`}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Source receipt</p>
              </div>
              <Button variant="ghost" size="xs" onClick={() => setReceiptModal(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className={`text-[11px] border ${confidenceBg(receiptModal.confidence)}`} variant="outline">
                {receiptModal.confidence.charAt(0).toUpperCase() + receiptModal.confidence.slice(1)} confidence
              </Badge>
              {receiptModal.staleness === "stale" && (
                <Badge variant="outline" className="border-amber-500/30 text-[11px] text-amber-400">
                  <AlertTriangle className="mr-1 h-2.5 w-2.5" /> Stale
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground">{receiptModal.ageLabel}</span>
            </div>
            <p className="mt-4 text-[12px] text-muted-foreground">
              In the full implementation, clicking a source receipt opens the code viewer at this file/line range.
              <br />
              <span className="font-mono text-[11px]">
                GET /api/projects/:id/onboarding/sections/:sectionId
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
