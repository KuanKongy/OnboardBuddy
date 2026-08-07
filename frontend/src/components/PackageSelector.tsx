import { ChevronsUpDown, Package as PackageIcon, Star } from "lucide-react";
import { usePackages } from "@/contexts/PackagesContext";
import { useProject } from "@/contexts/ProjectContext";
import { roleLabel } from "@/lib/roles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PackageCard } from "@/types/onboarding";

/**
 * Sidebar package selector: which (branch @ commit · scope · role) package
 * every tab of this project shows. "Latest analysis" follows the newest
 * complete run.
 *
 * The closed button names a package even when nothing is selected: the server
 * resolves the no-selection case to one particular package (see
 * PackagesContext's resolvedPackage), and that is what the tabs are actually
 * showing. Which row is selected stays readable in the menu, where "Latest
 * analysis (auto)" carries the mark and the star.
 *
 * Two different things live in this menu and they are deliberately separate:
 * clicking a row selects it FOR THIS BROWSER TAB (another tab on the same
 * project keeps its own), while the star PINS it as what a new tab opens on
 * and freezes it against generations landing. See PackagesContext for the
 * storage and the precedence.
 */

const STATUS_DOT: Record<string, string> = {
  approved: "bg-success",
  draft: "bg-secondary-foreground/50",
  stale: "bg-warning",
  generating: "bg-info animate-pulse",
  failed: "bg-danger",
};

/**
 * The privacy modes of lib/privacyModes.ts in a shorter register for the row
 * tooltip, whose second line is already a run's settings ("standard depth ·
 * …"). "AI disabled" there reads as a run that broke; "No AI" reads as the
 * setting it is. Keep the keys in step with PRIVACY_MODES.
 */
const AI_POLICY: Record<string, string> = {
  full_ai: "Full AI",
  facts_only_ai: "Facts-only AI",
  ai_disabled: "No AI",
};

/** Beyond this the subject stops being a summary and starts wrapping the
 *  tooltip into a paragraph; GitHub's own soft limit is 72. */
const COMMIT_SUBJECT_MAX = 80;

function packageScope(pkg: PackageCard): string {
  return pkg.path_prefix ? `${pkg.path_prefix}/` : pkg.scope_name || "Whole repo";
}

/**
 * What this commit was, for the row tooltip. Packages analyzed before the
 * message was recorded carry null, and there the short sha is still worth more
 * than nothing: it is what tells two runs of the same branch apart.
 */
function commitSubject(pkg: PackageCard): string {
  const message = pkg.commit_message?.trim();
  if (!message) return pkg.analyzed_commit.slice(0, 7);
  return message.length > COMMIT_SUBJECT_MAX ? `${message.slice(0, COMMIT_SUBJECT_MAX)}…` : message;
}

/**
 * Selected-row marking. Not a Check column: it cost every row 14px of width on
 * a menu where long branch names already wrap to two lines, and it marked the
 * row twice over once the left rule existed. `aria-checked` is not valid on
 * role="menuitem" either, and carrying it properly would mean menuitemradio,
 * which re-parents the rows in a way the PinStar guards below are not tuned
 * for. So the state rides on aria-current, which menuitem accepts.
 */
const ROW_MARK = "border-l-2 border-transparent";
const ROW_MARK_SELECTED = "border-primary bg-primary/5";

/**
 * Pin toggle living inside a Radix DropdownMenuItem, which otherwise treats a
 * press anywhere in the row as "select this row and close the menu". Stopping
 * the CLICK is the whole guard, and stopping only the click is deliberate —
 * the obvious extra `onPointerDown` stopPropagation makes things worse, twice
 * over (both verified against a real browser, not just jsdom):
 *   - MenuItem sets an isPointerDown flag from its own pointerdown handler and,
 *     if pointerup arrives without it, fires `event.currentTarget.click()` on
 *     the ROW. A click the row dispatches on itself never passes through this
 *     button, so it selects anyway — the guard defeats itself.
 *   - DismissableLayer marks "the pointer went down inside me" in a capture
 *     handler and clears it in a document-level bubble handler. Swallow the
 *     pointerdown and the flag stays stuck on, and the next click OUTSIDE the
 *     menu is eaten instead of closing it.
 *
 * Accepted limitation: the star is mouse-first. Radix's menu owns keyboard
 * focus with a roving tabindex over the items, so Tab never lands on a nested
 * button and there is no keyboard route to pinning from this menu. Selection —
 * the thing that changes what you read — stays fully keyboard-operable.
 */
function PinStar({ pinned, label, onToggle }: { pinned: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="-my-0.5 -mr-1 shrink-0 rounded p-0.5 transition-colors hover:bg-accent"
    >
      <Star
        className={cn(
          "h-3.5 w-3.5",
          pinned ? "fill-warning text-warning" : "text-muted-foreground/50 hover:text-muted-foreground",
        )}
      />
    </button>
  );
}

export function PackageSelector() {
  const { packages, selectedPackage, selectedPackageId, selectPackage, resolvedPackage, pinnedPackageId, pinPackage } =
    usePackages();
  const { project } = useProject();
  const repoName = project?.repo_name ?? "";
  const repoOwner = project?.repo_owner ?? "";

  // With no selection the tabs are not showing "some latest run" in the
  // abstract, they are showing one particular package, and the server is the
  // only one who knows which. Naming it is the difference between the sidebar
  // describing the screen and the sidebar describing a policy.
  const displayPackage = selectedPackage ?? resolvedPackage;

  /**
   * A project with no packages yet (never analyzed, or every run failed) used
   * to render NOTHING here, and this pill is the only place any project page
   * names the project — so the whole app sat on an unnamed project until the
   * first package landed. The name does not depend on a package: it is the
   * repo and the branch the project was imported on. Only the chooser does,
   * so only the chooser is withheld.
   */
  if (!packages || packages.length === 0) {
    if (!repoName) return null;
    return (
      // Same box, same two-line stack, same load-bearing height as the button
      // below — see the arithmetic comment there before touching the leading.
      <div data-tour="package-selector" className="-mx-1 mt-2">
        <div className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left">
          <PackageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[0.6875rem] leading-[0.875rem] text-foreground">
              {repoName} / {project?.branch}
            </span>
            <span className="block truncate text-[0.625rem] leading-3 text-muted-foreground">
              {/* `null` is "the list has not arrived", not "there are none" —
                  saying "No package yet" during that round trip flashed the
                  wrong answer on every project that has one. */}
              {packages === null ? "Loading packages…" : "No package yet"}
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    // -mx-1 buys the card 8px of width back out of the sidebar header's px-3
    // without editing ProjectLayout, whose padding is shared with the logo row.
    <div data-tour="package-selector" className="-mx-1 mt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left transition-colors hover:border-primary/40"
            title="Which package every tab shows: branch, commit, scope, and role"
          >
            {/* ⚠ HEIGHT IS LOAD-BEARING. py-1.5 plus the explicit line heights
                on both lines (14px / 12px, where the inherited normal leading
                landed at ~13.3 / ~12.1) are the arithmetic behind the sidebar's
                100px header block, and the reader's chrome is cut to sit level
                with the Separator below it (see OnboardingPage's band comment).
                Change the CONTENT of these two lines freely; leave
                leading-[0.875rem], leading-3 and py-1.5 exactly as they are, or
                the reader's coverage strip goes a pixel out of true. The icon
                is shorter than the two-line stack it sits beside, so it rides
                inside the existing height rather than setting it. */}
            <PackageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              {displayPackage ? (
                <>
                  <span className="flex items-center gap-1 font-mono text-[0.6875rem] leading-[0.875rem] text-foreground">
                    {repoName && (
                      // shrink-[4]: when the pair does not fit, the repo name
                      // gives up width four times faster than the branch — the
                      // repo is context you already know, the branch is the
                      // thing being chosen. The separator rides INSIDE this
                      // span so it leaves with it; as its own element it
                      // survived the repo being squeezed to nothing and the
                      // sidebar read "/ feature/very-long-br…".
                      <span className="shrink-[4] truncate">{repoName} /</span>
                    )}
                    <span className="truncate">{displayPackage.branch}</span>
                    {!displayPackage.is_latest_commit && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                        </TooltipTrigger>
                        <TooltipContent side="right">Behind the latest analyzed commit on this branch</TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                  <span className="block truncate text-[0.625rem] leading-3 text-muted-foreground">
                    {displayPackage.path_prefix ? `${displayPackage.path_prefix}/` : "Whole repo"} · {roleLabel(displayPackage.role)}
                  </span>
                </>
              ) : (
                <>
                  <span className="block truncate text-[0.6875rem] font-medium leading-[0.875rem] text-foreground">Latest analysis</span>
                  <span className="block truncate text-[0.625rem] leading-3 text-muted-foreground">auto-follows the newest run</span>
                </>
              )}
            </span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="font-normal">
            {/* owner/repo, because a bare repo name is ambiguous across the
                forks and same-named repos one account can have imported. */}
            <span className="block truncate font-mono text-[0.6875rem] text-foreground">
              {repoOwner ? `${repoOwner}/${repoName}` : repoName}
            </span>
            <span className="block text-[0.625rem] leading-4 text-muted-foreground">
              Every project tab follows this selection, per browser tab
            </span>
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => selectPackage(null)}
            aria-current={selectedPackageId === null ? "true" : undefined}
            className={cn("gap-2", ROW_MARK, selectedPackageId === null && ROW_MARK_SELECTED)}
          >
            <span className="flex-1 text-[0.75rem]">Latest analysis (auto)</span>
            <PinStar
              pinned={pinnedPackageId === null}
              label="Follow the newest analysis by default in new tabs"
              onToggle={() => pinPackage(null)}
            />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {packages.map((pkg) => (
            <DropdownMenuItem
              key={pkg.id}
              onSelect={() => selectPackage(pkg.id)}
              aria-current={selectedPackageId === pkg.id ? "true" : undefined}
              className={cn("items-start gap-2", ROW_MARK, selectedPackageId === pkg.id && ROW_MARK_SELECTED)}
            >
              {/* A `title` on a bare span is not an accessible name, so the tooltip
                  is for the mouse and the word rides along sr-only. mt-[0.3125rem]
                  centres the 6px dot on the 16px first line. */}
              <span
                className={cn("mt-[0.3125rem] h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[pkg.status] ?? "bg-muted-foreground/40")}
                title={pkg.status}
                aria-hidden="true"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="min-w-0 flex-1">
                    {/* Wraps to a second line rather than truncating: a long
                        branch name truncated at the same place as its
                        neighbours is unreadable, and the hash is what
                        distinguishes two runs of the same branch. */}
                    <span className="line-clamp-2 break-all font-mono text-[0.6875rem] leading-4">
                      {pkg.branch}@{pkg.analyzed_commit.slice(0, 7)}
                    </span>
                    <span className="sr-only">status: {pkg.status}</span>
                    <span className="block truncate text-[0.625rem] text-muted-foreground">
                      {packageScope(pkg)} · {roleLabel(pkg.role)}
                    </span>
                    {!pkg.is_latest_commit && (
                      <span className="block text-[0.625rem] text-warning">behind latest on {pkg.branch}</span>
                    )}
                  </span>
                </TooltipTrigger>
                {/* What the commit WAS beats what the commit IS: the row
                    already shows the sha, and the analyzed date told nobody
                    anything they could act on. */}
                <TooltipContent side="right" className="max-w-64">
                  <span className="block">{commitSubject(pkg)}</span>
                  <span className="block">
                    {pkg.semantic_depth} depth · {AI_POLICY[pkg.privacy_mode] ?? pkg.privacy_mode}
                  </span>
                </TooltipContent>
              </Tooltip>
              <PinStar
                pinned={pinnedPackageId === pkg.id}
                label={`Pin ${pkg.branch} as this project's default`}
                onToggle={() => pinPackage(pinnedPackageId === pkg.id ? null : pkg.id)}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
