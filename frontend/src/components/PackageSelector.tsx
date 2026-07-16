import { Check, ChevronsUpDown, GitBranch, Package as PackageIcon, Star } from "lucide-react";
import { usePackages } from "@/contexts/PackagesContext";
import { ROLES } from "@/lib/onboardingData";
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

function roleLabel(role: string): string {
  return ROLES.find((r) => r.key === role)?.label ?? role;
}

function packageLine(pkg: PackageCard): string {
  const scope = pkg.path_prefix ? `${pkg.path_prefix}/` : pkg.scope_name || "whole repo";
  return `${pkg.branch}@${pkg.analyzed_commit.slice(0, 7)} · ${scope} · ${roleLabel(pkg.role)}`;
}

export function PackageSelector() {
  const {
    packages,
    selectedPackage,
    selectedPackageId,
    selectPackage,
    defaultPackageId,
    setDefaultPackage,
  } = usePackages();

  if (!packages || packages.length === 0) return null;

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
                  <span className="flex items-center gap-1 truncate font-mono text-[11px] text-foreground">
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
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {selectedPackage.path_prefix ? `${selectedPackage.path_prefix}/` : "whole repo"} · {roleLabel(selectedPackage.role)}
                  </span>
                </>
              ) : (
                <>
                  <span className="block truncate text-[11px] font-medium text-foreground">Latest analysis</span>
                  <span className="block truncate text-[10px] text-muted-foreground">auto-follows the newest run</span>
                </>
              )}
            </span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
            Every tab follows this selection · ★ = your default
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => selectPackage(null)} className="gap-2">
            <Check className={cn("h-3.5 w-3.5 shrink-0", selectedPackageId === null ? "opacity-100" : "opacity-0")} />
            <span className="flex-1 text-[12px]">Latest analysis (auto)</span>
            {defaultPackageId === null ? (
              <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
            ) : (
              <button
                className="rounded p-0.5 text-muted-foreground/50 hover:text-warning"
                title="Make 'latest' your default"
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
            <DropdownMenuItem key={pkg.id} onSelect={() => selectPackage(pkg.id)} className="gap-2">
              <Check className={cn("h-3.5 w-3.5 shrink-0", selectedPackageId === pkg.id ? "opacity-100" : "opacity-0")} />
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[pkg.status] ?? "bg-muted-foreground/40")}
                title={pkg.status}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px]">{packageLine(pkg)}</span>
                {!pkg.is_latest_commit && (
                  <span className="block text-[10px] text-warning">behind latest on {pkg.branch}</span>
                )}
              </span>
              {defaultPackageId === pkg.id ? (
                <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
              ) : (
                <button
                  className="rounded p-0.5 text-muted-foreground/50 hover:text-warning"
                  title="Make this your default package"
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
