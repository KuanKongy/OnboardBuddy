import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface GraphToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
  /** What the counted nodes are ("files", "groups", "classes"). */
  noun?: string;
  /** Optional trailing detail after the noun count, e.g. "12 relationships". */
  extra?: string;
}

export function GraphToolbar({
  search,
  onSearchChange,
  matchCount,
  totalCount,
  noun = "files",
  extra,
}: GraphToolbarProps) {
  const trimmed = search.trim();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[160px] flex-1">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files, classes or methods..."
          aria-label={`Search ${noun}`}
          className="h-8 pl-8 pr-7 text-xs"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {trimmed && matchCount === 0 && (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          No matches for "{trimmed}"
        </span>
      )}

      <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">
        {matchCount} / {totalCount} {noun}
        {extra ? ` · ${extra}` : ""}
      </span>
    </div>
  );
}
