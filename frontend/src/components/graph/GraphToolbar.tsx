import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface GraphToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
  /** What the counted nodes are ("files", "groups", "classes"). */
  noun?: string;
}

export function GraphToolbar({
  search,
  onSearchChange,
  matchCount,
  totalCount,
  noun = "files",
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

      <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">
        {matchCount} / {totalCount} {noun}
      </span>
    </div>
  );
}
