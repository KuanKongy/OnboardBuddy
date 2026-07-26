import { Star } from "lucide-react";
import { Handle, Position, type NodeProps } from "reactflow";
import { inferNodeType } from "@/lib/graphNodeType";
import { cn } from "@/lib/utils";

export interface ModuleNodeData {
  label: string;
  kind: string;
  filePath: string;
  exportedSymbols: string[];
  /** Distinct internal files this file imports (matches drawn edges). */
  importCount: number;
  /** Distinct third-party imports — not drawn as edges. */
  externalImportCount?: number;
  /** Distinct internal files importing this file (matches drawn edges). */
  dependentCount: number;
  symbolCount: number;
  /**
   * What this file does, one line, from the stored FILE semantic record.
   * Null when the analyzer wrote no record for it.
   */
  summary?: string | null;
  /** The record's own classification: "route file", "service", "config glue". */
  role?: string | null;
  /** Group nodes only — the files folded into this box. */
  fileCount?: number;
  /** What `fileCount` counts when the box does not stand for files ("classes"). */
  groupNoun?: string;
  /** Group nodes only — links with both ends inside the box, so undrawn. */
  internalImportCount?: number;
  isEntryPoint: boolean;
  dimmed: boolean;
  selected: boolean;
}

/**
 * A file (or a directory group) on the Dependencies canvas.
 *
 * NO TOOLTIPS. Owner E2/C1/D3: "remove that tooltip. Nobody asked for it" —
 * every hover popup on this card is gone, including the ones a previous pass
 * converted from `title=` to Tooltip primitives. Owner H1 is the general rule
 * they broke: a tooltip must carry information the screen does not already
 * show, and these restated the label, the type description and the counts
 * printed two lines below them. Anything worth saying is now printed.
 */
export function ModuleNode({ data }: NodeProps<ModuleNodeData>) {
  const typeInfo = inferNodeType(data.filePath, data.exportedSymbols);
  const isGroup = data.fileCount !== undefined;
  // A class card's label is a bare name ("SnapshotWriter"), which two files can
  // both declare; the path is the only thing that tells them apart, and it is
  // the file-shape guess below that would otherwise fill the line describing
  // the FILE as if it described the class.
  const isSymbol = data.kind === "class" || data.kind === "interface";

  return (
    <div
      className={cn(
        "w-[240px] rounded-lg border border-l-4 bg-card px-3 py-2.5 shadow-md transition-opacity",
        typeInfo.accentClass,
        data.selected
          ? "border-primary ring-2 ring-ring"
          : "border-border hover:border-muted-foreground/40",
        data.dimmed && "opacity-20",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground" />

      <div className="mb-1 flex items-center gap-1.5">
        <span className="flex-1 truncate text-[0.8125rem] font-semibold text-foreground">
          {data.label}
        </span>
        {data.selected && <Star className="h-3 w-3 flex-shrink-0 fill-primary text-primary" />}
        <span
          className={cn(
            "shrink-0 rounded border px-1 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide",
            typeInfo.colorClasses,
          )}
        >
          {isGroup ? "GROUP" : typeInfo.type}
        </span>
      </div>

      {/* What the file DOES, in the analyzer's words. Owner E3: "The
          dependencies should also have explanation of what file does." The
          path-shape guess below is the fallback, and says it is one. */}
      {!isGroup && data.summary ? (
        <>
          <p className="mb-1 line-clamp-3 text-[0.71875rem] leading-snug text-foreground/90">
            {data.summary}
          </p>
          {data.role && (
            <p className="mb-2 truncate text-[0.625rem] uppercase tracking-wide text-muted-foreground/70">
              {data.role}
            </p>
          )}
        </>
      ) : (
        <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">
          {isGroup
            ? `${data.fileCount} ${data.groupNoun ?? "files"} in this folder`
            : isSymbol
              // No record worth showing: the type badge above already says
              // "class", so restating that would be the tooltip mistake in
              // card form. The file it is declared in is not on the card yet,
              // so that is what the line spends itself on.
              ? `Declared in ${data.filePath}`
              : typeInfo.description}
        </p>
      )}
      {!isGroup && isSymbol && data.summary && (
        <p className="mb-2 truncate font-mono text-[0.625rem] text-muted-foreground/70">{data.filePath}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.6875rem] text-muted-foreground">
        {/* A group's two numbers count links CROSSING its boundary — the arrows
            drawn on this canvas. They used to be the members' summed import
            counts and a hardcoded zero (AUDIT C1 / SC F7), so a group read
            "392 imports · 0 imported by" with arrows landing on it. */}
        <span>{data.importCount} {isGroup ? "out" : "imports"}</span>
        <span className="text-border">·</span>
        <span>{data.dependentCount} {isGroup ? "in" : "imported by"}</span>
        {isGroup && (data.internalImportCount ?? 0) > 0 ? (
          <>
            <span className="text-border">·</span>
            <span>{data.internalImportCount} inside</span>
          </>
        ) : null}
        {!isGroup && data.externalImportCount ? (
          <>
            <span className="text-border">·</span>
            <span>{data.externalImportCount} external</span>
          </>
        ) : null}
        {!isGroup && data.symbolCount > 0 ? (
          <>
            <span className="text-border">·</span>
            <span>{data.symbolCount} symbols</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
