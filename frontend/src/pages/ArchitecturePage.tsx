import { AlertTriangle, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ArchitectureMapView } from "@/components/graph/ArchitectureMapView";
import { COMPONENT_TYPE_COLORS } from "@/components/graph/ArchitectureNode";
import { ComponentInfoPanel } from "@/components/graph/ComponentInfoPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchArchitectureSource } from "@/lib/architectureData";
import { COMPONENT_TYPE_LABELS, deriveArchitectureGraph } from "@/lib/architectureGraph";
import type { GraphResponse } from "@/lib/graphData";
import type { ArchitectureComponentType } from "@/types/graph";
import { cn } from "@/lib/utils";

export function ArchitecturePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);

  function loadArchitecture() {
    if (!id) return;
    setLoading(true);
    setError("");
    setSelectedComponentId(null);
    fetchArchitectureSource(id)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadArchitecture(); }, [id]);

  const architecture = useMemo(() => {
    if (!data) return null;
    return deriveArchitectureGraph(
      data.graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        metadata: {
          exportedSymbols: (n.metadata?.exportedSymbols as string[]) ?? [],
          importCount: (n.metadata?.importCount as number) ?? 0,
          dependentCount: (n.metadata?.dependentCount as number) ?? 0,
        },
      })),
      data.graph.edges,
      data.graph.entryPoints,
    );
  }, [data]);

  const visibleComponents = useMemo(() => {
    if (!architecture) return [];
    const query = search.trim().toLowerCase();
    if (!query) return architecture.components;
    return architecture.components.filter(
      (c) =>
        c.label.toLowerCase().includes(query) ||
        c.directory.toLowerCase().includes(query) ||
        c.files.some((f) => f.toLowerCase().includes(query)) ||
        c.exportedSymbols.some((s) => s.toLowerCase().includes(query)),
    );
  }, [architecture, search]);

  const visibleEdges = useMemo(() => {
    if (!architecture) return [];
    const visibleIds = new Set(visibleComponents.map((c) => c.id));
    return architecture.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  }, [architecture, visibleComponents]);

  const presentTypes = useMemo(() => {
    const types = new Set<ArchitectureComponentType>();
    for (const c of architecture?.components ?? []) types.add(c.type);
    return Array.from(types);
  }, [architecture]);

  const selectedComponent = architecture?.components.find((c) => c.id === selectedComponentId);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Architecture map</h1>
        {architecture && (
          <Badge variant="outline" className="text-[10px]">
            {architecture.components.length} components · {data?.totalNodes ?? 0} files
          </Badge>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {(error || (!data && !loading)) && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {error || "No architecture data available yet"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The architecture map is generated from the first successful analysis. Run an analysis
              first, or retry if analysis has completed.
            </p>
          </div>
          <Button variant="outline" size="xs" onClick={loadArchitecture}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {architecture && !loading && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search components, directories or symbols..."
                className="h-8 pl-8 text-xs"
              />
            </div>
            <span className="ml-1 whitespace-nowrap text-[11px] text-muted-foreground">
              {visibleComponents.length} / {architecture.components.length} components
            </span>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {presentTypes.map((type) => (
              <span
                key={type}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                  COMPONENT_TYPE_COLORS[type],
                )}
              >
                {COMPONENT_TYPE_LABELS[type]}
              </span>
            ))}
          </div>

          <div className="h-[300px] w-full rounded-xl border border-border sm:h-[400px] md:h-[480px]">
            <ArchitectureMapView
              components={visibleComponents}
              edges={visibleEdges}
              entryComponentIds={architecture.entryComponentIds}
              selectedComponentId={selectedComponentId}
              onSelectComponent={setSelectedComponentId}
            />
          </div>

          {selectedComponent && (
            <ComponentInfoPanel
              component={selectedComponent}
              components={architecture.components}
              edges={architecture.edges}
            />
          )}
        </>
      )}
    </div>
  );
}
