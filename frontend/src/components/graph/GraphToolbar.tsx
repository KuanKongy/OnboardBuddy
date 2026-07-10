import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";


type EdgeFilter = "imports" | "exports";

interface GraphToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  edgeFilter: EdgeFilter;
  onEdgeFilterChange: (filter: EdgeFilter) => void;
  matchCount: number;
  totalCount: number;
}

const FILTERS: { key: EdgeFilter; label: string }[] = [
  { key: "imports", label: "Imports" },
  { key: "exports", label: "Exports" },
];

export function GraphToolbar({
  search,
  onSearchChange,
  edgeFilter,
  onEdgeFilterChange,
  matchCount,
  totalCount,
}: GraphToolbarProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[160px] flex-1">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files, classes or methods..."
          className="h-8 pl-8 text-xs"
        />
      </div>

      <div className="flex items-center gap-1">

        {FILTERS.map((f) => {
          const isEdgeFilter = f.key === "imports" || f.key === "exports";
          const isActive = isEdgeFilter && edgeFilter === f.key;
          const isDisabled = !isEdgeFilter;

          const button = (
            <Button
              size="sm"
              variant={isActive ? "default" : "outline"}
              disabled={isDisabled}
              onClick={() => isEdgeFilter && onEdgeFilterChange(f.key as EdgeFilter)}
              className={cn(
                "h-8 px-3 text-xs",
                isDisabled && "cursor-not-allowed opacity-40",
              )}
              title={isDisabled && f.key !== "coverage" ? "Coming soon" : undefined}
            >
              {f.label}
            </Button>
          );

          if (f.key === "coverage") {
            return (
              <Tooltip key={f.key}>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex cursor-help">{button}</span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  Once enabled, highlights files with low or missing test coverage. Coming soon.
                </TooltipContent>
              </Tooltip>
            );
          }

          return <span key={f.key}>{button}</span>;
        })}
        
      </div>

      <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">
        {matchCount} / {totalCount} modules
      </span>
    </div>
  );
}
