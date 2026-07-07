import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={edgeFilter === f.key ? "default" : "outline"}
            onClick={() => onEdgeFilterChange(f.key)}
            className="h-8 px-3 text-xs"
          >
            {f.label}
          </Button>
        ))}
      </div>

      <span className="ml-1 whitespace-nowrap text-[11px] text-muted-foreground">
        {matchCount} / {totalCount} modules
      </span>
    </div>
  );
}
