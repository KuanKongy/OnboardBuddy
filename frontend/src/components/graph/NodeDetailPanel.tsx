import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { FileAnalysis, GraphNode } from "@/types/graph";

interface NodeDetailPanelProps {
  node: GraphNode;
  fileAnalysis: FileAnalysis | undefined;
  onClose: () => void;
}

export function NodeDetailPanel({ node, fileAnalysis, onClose }: NodeDetailPanelProps) {
  return (
    <Card className="w-full max-w-sm gap-3 py-3">
      <CardContent className="px-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{node.label}</h3>
            <p className="mt-0.5 break-all text-xs text-muted-foreground">{node.id}</p>
          </div>
          <Button variant="ghost" size="xs" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Separator className="my-2" />

        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Exported symbols
        </h4>
        {node.metadata.exportedSymbols.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {node.metadata.exportedSymbols.map((symbol) => (
              <Badge key={symbol} variant="secondary" className="text-[11px]">
                {symbol}
              </Badge>
            ))}
          </div>
        )}

        <h4 className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Imports
        </h4>
        {!fileAnalysis || fileAnalysis.imports.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-1">
            {fileAnalysis.imports.map((imp) => (
              <li key={imp.toSpecifier} className="text-xs text-foreground">
                <span className="text-muted-foreground">{imp.toSpecifier}</span>
                {imp.namedImports.length > 0 && (
                  <span> · {imp.namedImports.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <h4 className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Symbols in file
        </h4>
        {!fileAnalysis || fileAnalysis.symbols.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-1.5">
            {fileAnalysis.symbols.map((symbol) => (
              <li key={symbol.name} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">{symbol.name}</span>
                  <Badge variant="outline" className="text-[11px]">
                    {symbol.kind}
                  </Badge>
                </div>
                {symbol.signature && (
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">
                    {symbol.signature}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
