import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { FileAnalysis, GraphNode } from "@/types/graph";

interface NodeInfoPanelProps {
  node: GraphNode;
  fileAnalysis: FileAnalysis | undefined;
}

const FUNCTION_KINDS = new Set(["function", "arrow-function", "method"]);
const INTERFACE_KINDS = new Set(["interface", "type"]);

export function NodeInfoPanel({ node, fileAnalysis }: NodeInfoPanelProps) {
  const functions = fileAnalysis?.symbols.filter((s) => FUNCTION_KINDS.has(s.kind)) ?? [];
  const interfaces = fileAnalysis?.symbols.filter((s) => INTERFACE_KINDS.has(s.kind)) ?? [];
  const imports = fileAnalysis?.imports ?? [];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col divide-y divide-border md:flex-row md:divide-x md:divide-y-0">
        {/* Column 1: Functions */}
        <div className="flex-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Functions
            </h3>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {functions.length}
            </span>
          </div>
          {functions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No functions exported</p>
          ) : (
            <ul className="space-y-1.5">
              {functions.map((fn) => (
                <li key={fn.name} className="flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div>
                    <span className="text-[12px] font-mono text-foreground">{fn.name}()</span>
                    {fn.signature && (
                      <p className="max-w-[160px] truncate text-[11px] text-muted-foreground" title={fn.signature}>
                        {fn.signature}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {fileAnalysis?.symbols.filter((s) => s.kind === "class").map((cls) => (
            <div key={cls.name} className="mt-3">
              <Separator className="mb-2" />
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Class</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                <span className="text-[12px] font-mono text-foreground">{cls.name}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Column 2: Imports + Interfaces */}
        <div className="flex-1 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground">
            Imports
            <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {imports.length}
            </span>
          </h3>
          {imports.length === 0 ? (
            <p className="text-xs text-muted-foreground">No imports</p>
          ) : (
            <ul className="mb-4 space-y-1.5">
              {imports.map((imp) => (
                <li key={imp.toSpecifier} className="flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                  <div>
                    <span className="text-[12px] font-mono text-muted-foreground">{imp.toSpecifier}</span>
                    {imp.namedImports.length > 0 && (
                      <p className="text-[11px] text-muted-foreground/70">
                        {imp.namedImports.join(", ")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {interfaces.length > 0 && (
            <>
              <Separator className="mb-3" />
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground">
                Interfaces
                <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {interfaces.length}
                </span>
              </h3>
              <ul className="space-y-1.5">
                {interfaces.map((iface) => (
                  <li key={iface.name} className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    <span className="text-[12px] font-mono text-foreground">{iface.name}</span>
                    <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">
                      {iface.kind}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
