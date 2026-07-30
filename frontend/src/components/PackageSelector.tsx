import { Check, ChevronsUpDown, GitBranch, Package as PackageIcon, Star } from "lucide-react";
import type { KeyboardEvent } from "react";
import { usePackages } from "@/contexts/PackagesContext";
import { roleTitle } from "@/lib/roles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PackageCard } from "@/types/onboarding";

/**
 * Sidebar package selector: which (branch @ commit · scope · role) package
 * every tab shows. "Latest analysis" follows the newest complete run; a
 * pinned package stays put even when newer ones are generated. The star is
 * the member default — where the selection starts next session.
 */

const STATUS_DOT: Record<string, string> = {
  approved: "bg-success",
  draft: "bg-secondary-foreground/50",
  stale: "bg-warning",
  generating: "bg-info animate-pulse",
  failed: "bg-danger",
};

/**
 * The star was mouse-only (#74/#71 item 4). It is a nested `<button>` inside a
 * Radix `DropdownMenuItem`, and Radix's menu roves focus between items with the
 * arrow keys and traps Tab — probed against this component: with the menu open,
 * Tab leaves focus on the highlighted menuitem and never reaches the button, so
 * there was no keyboard path to your own default package at all.
 *
 * The item itself takes the keypress instead. `*` rather than a mnemonic letter
 * because Radix runs typeahead on every single printable character it sees on
 * the content, so `d` would jump the highlight to a `dev@…` row on the way; `*`
 * matches no branch name (git refs cannot contain it) and reads as the star.
 * `aria-keyshortcuts` on the item is how it is announced, which costs no pixels
 * — the menu label was deliberately not lengthened, since a second wrapped line
 * would move the list. ShortcutsHelpDialog carries it for sighted users.
 */
const SET_DEFAULT_KEY = "*";

function packageLine(pkg: PackageCard): string {
  const scope = pkg.path_prefix ? `${pkg.path_prefix}/` : pkg.scope_name || "whole repo";
  return `${pkg.branch}@${pkg.analyzed_commit.slice(0, 7)} · ${scope} · ${roleTitle(pkg.role)}`;
}

export function PackageSelector() {
  const {
    packages,
    selectedPackage,
    selectedPackageId,
    selectPackage,
    defaultPackageId,
    setDefaultPackage,
    defaultPackageError,
  } = usePackages();

  if (!packages || packages.length === 0) return null;

  const defaultKeyHandler = (id: string | null) => (e: KeyboardEvent) => {
    if (e.key !== SET_DEFAULT_KEY) return;
    // Stopped here so Radix's typeahead on the content never sees the key.
    e.preventDefault();
    e.stopPropagation();
    void setDefaultPackage(id);
  };

  return (
    <div data-tour="package-selector" className="mt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left transition-colors hover:border-primary/40"
            title="Which package every tab shows — branch, commit, scope, and role"
          >
            <PackageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              {selectedPackage ? (
                <>
                  <span className="flex items-center gap-1 truncate font-mono text-[0.6875rem] text-foreground">
                    <GitBranch className="h-2.5 w-2.5 shrink-0" />
                    {selectedPackage.branch}@{selectedPackage.analyzed_commit.slice(0, 7)}
                    {!selectedPackage.is_latest_commit && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                        </TooltipTrigger>
                        <TooltipContent side="right">Behind the latest analyzed commit on this branch</TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                  <span className="block truncate text-[0.625rem] text-muted-foreground">
                    {selectedPackage.path_prefix ? `${selectedPackage.path_prefix}/` : "whole repo"} · {roleTitle(selectedPackage.role)}
                  </span>
                </>
              ) : (
                <>
                  <span className="block truncate text-[0.6875rem] font-medium text-foreground">Latest analysis</span>
                  <span className="block truncate text-[0.625rem] text-muted-foreground">auto-follows the newest run</span>
                </>
              )}
            </span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-[0.6875rem] font-normal text-muted-foreground">
            Every tab follows this selection · ★ = your default
          </DropdownMenuLabel>
          {/* #74/H7: a failed PUT used to say nothing at all. Sized down to the
              dropdown rather than restyled, so it is the one banner shape. */}
          {defaultPackageError && (
            <ErrorBanner className="mx-1 mb-1 px-2 py-1 text-[0.625rem]">
              Couldn&apos;t save your default — it is unchanged.
            </ErrorBanner>
          )}
          <DropdownMenuItem
            onSelect={() => selectPackage(null)}
            onKeyDown={defaultKeyHandler(null)}
            aria-keyshortcuts={SET_DEFAULT_KEY}
            className="gap-2"
          >
            <Check className={cn("h-3.5 w-3.5 shrink-0", selectedPackageId === null ? "opacity-100" : "opacity-0")} />
            <span className="flex-1 text-[0.75rem]">Latest analysis (auto)</span>
            {defaultPackageId === null ? (
              <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
            ) : (
              <button
                className="rounded p-0.5 text-muted-foreground/50 hover:text-warning"
                aria-label="Make 'latest analysis' your default package"
                title="Make 'latest' your default"
                // Mouse affordance only — the keyboard path is the item's `*`.
                tabIndex={-1}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void setDefaultPackage(null);
                }}
              >
                <Star className="h-3.5 w-3.5" />
              </button>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {packages.map((pkg) => (
            <DropdownMenuItem
              key={pkg.id}
              onSelect={() => selectPackage(pkg.id)}
              onKeyDown={defaultKeyHandler(pkg.id)}
              aria-keyshortcuts={SET_DEFAULT_KEY}
              className="gap-2"
            >
              <Check className={cn("h-3.5 w-3.5 shrink-0", selectedPackageId === pkg.id ? "opacity-100" : "opacity-0")} />
              {/* #74/G7: the dot's colour was the only carrier of the package's
                  state, and a `title` on a bare span is not an accessible name.
                  The tooltip stays for the mouse; the word rides along sr-only. */}
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[pkg.status] ?? "bg-muted-foreground/40")}
                title={pkg.status}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[0.6875rem]">{packageLine(pkg)}</span>
                <span className="sr-only">status: {pkg.status}</span>
                {!pkg.is_latest_commit && (
                  <span className="block text-[0.625rem] text-warning">behind latest on {pkg.branch}</span>
                )}
              </span>
              {defaultPackageId === pkg.id ? (
                <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
              ) : (
                <button
                  className="rounded p-0.5 text-muted-foreground/50 hover:text-warning"
                  aria-label={`Make ${packageLine(pkg)} your default package`}
                  title="Make this your default package"
                  tabIndex={-1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    void setDefaultPackage(pkg.id);
                  }}
                >
                  <Star className="h-3.5 w-3.5" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
