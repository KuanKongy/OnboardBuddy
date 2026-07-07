import type {
  ArchitectureComponent,
  ArchitectureComponentType,
  ArchitectureEdge,
  ArchitectureGraph,
  GraphEdge,
  GraphNode,
} from "@/types/graph";

// How many directory segments identify one architecture component.
// "backend/src/api/routes/graph.ts" and "backend/src/api/middleware/auth.ts"
// both land in "backend/src/api"; grouping deeper than this produces one box
// per folder and the map stops reading as architecture.
const MAX_GROUP_DEPTH = 3;

const MAX_EXPORT_SAMPLES = 6;

// Directory names that indicate a component's architectural role.
// Checked from the innermost segment outward; first hit wins.
const TYPE_BY_SEGMENT: Array<{ type: ArchitectureComponentType; segments: Set<string> }> = [
  { type: "tests", segments: new Set(["test", "tests", "__tests__", "spec", "specs", "e2e"]) },
  { type: "gateway", segments: new Set(["routes", "route", "api", "controllers", "controller", "gateway", "middleware", "endpoints"]) },
  { type: "service", segments: new Set(["services", "service", "domain", "usecases"]) },
  { type: "database", segments: new Set(["db", "database", "models", "model", "repositories", "repository", "migrations", "prisma", "schemas", "schema", "entities"]) },
  { type: "worker", segments: new Set(["worker", "workers", "jobs", "job", "queue", "queues", "cron", "tasks"]) },
  { type: "frontend", segments: new Set(["components", "component", "pages", "page", "views", "view", "ui", "hooks", "contexts", "frontend", "client", "screens", "layouts"]) },
  { type: "utility", segments: new Set(["utils", "util", "helpers", "helper", "lib", "libs", "shared", "common", "tools", "types"]) },
  { type: "config", segments: new Set(["config", "configs", "env", "settings"]) },
];

// Segments too generic to name a component after ("src/index.ts" should not
// produce a box called "Src").
const GENERIC_SEGMENTS = new Set(["src", "source", "app", "apps", "packages", "."]);

export const COMPONENT_TYPE_LABELS: Record<ArchitectureComponentType, string> = {
  entry: "Entry point",
  gateway: "API / gateway",
  service: "Service",
  database: "Data layer",
  worker: "Worker / jobs",
  frontend: "Frontend module",
  utility: "Utilities",
  config: "Configuration",
  tests: "Tests",
  module: "Module",
};

export const COMPONENT_TYPE_DESCRIPTIONS: Record<ArchitectureComponentType, string> = {
  entry: "Application entry point — where execution starts",
  gateway: "Routing / API layer that receives external requests",
  service: "Business logic services",
  database: "Data models and persistence layer",
  worker: "Background workers and scheduled jobs",
  frontend: "UI pages, components and client state",
  utility: "Shared helpers used across the codebase",
  config: "Application configuration",
  tests: "Automated test suites",
  module: "General module",
};

function componentKey(filePath: string): string {
  const segments = filePath.split("/");
  const dirSegments = segments.slice(0, -1);
  if (dirSegments.length === 0) return ".";
  return dirSegments.slice(0, MAX_GROUP_DEPTH).join("/");
}

function inferComponentType(directory: string): ArchitectureComponentType {
  const segments = directory.toLowerCase().split("/");
  for (let i = segments.length - 1; i >= 0; i--) {
    for (const rule of TYPE_BY_SEGMENT) {
      if (rule.segments.has(segments[i]!)) return rule.type;
    }
  }
  return "module";
}

function componentLabel(directory: string): string {
  const segments = directory.split("/").filter((s) => !GENERIC_SEGMENTS.has(s.toLowerCase()));
  const name = segments[segments.length - 1];
  if (!name) return "Root";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Collapses the file-level dependency graph into a high-level architecture
 * map: one component per directory group, typed by directory-name heuristics,
 * with import edges aggregated (weighted) between components.
 */
export function deriveArchitectureGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  entryPoints: string[],
): ArchitectureGraph {
  const entryPointSet = new Set(entryPoints);
  const componentsById = new Map<string, ArchitectureComponent>();
  const fileToComponent = new Map<string, string>();

  for (const node of nodes) {
    const id = componentKey(node.id);
    fileToComponent.set(node.id, id);

    let component = componentsById.get(id);
    if (!component) {
      component = {
        id,
        label: componentLabel(id),
        directory: id,
        type: inferComponentType(id),
        files: [],
        exportedSymbols: [],
        importCount: 0,
        dependentCount: 0,
      };
      componentsById.set(id, component);
    }
    component.files.push(node.id);
    for (const symbol of node.metadata.exportedSymbols) {
      if (component.exportedSymbols.length >= MAX_EXPORT_SAMPLES) break;
      if (!component.exportedSymbols.includes(symbol)) component.exportedSymbols.push(symbol);
    }
  }

  const entryComponentIds: string[] = [];
  for (const component of componentsById.values()) {
    const containsEntry = component.files.some((f) => entryPointSet.has(f));
    if (containsEntry) {
      entryComponentIds.push(component.id);
      if (component.type === "module") component.type = "entry";
    }
  }

  const edgesById = new Map<string, ArchitectureEdge>();
  for (const edge of edges) {
    const source = fileToComponent.get(edge.source);
    const target = fileToComponent.get(edge.target);
    if (!source || !target || source === target) continue;

    const id = `${source}→${target}`;
    const existing = edgesById.get(id);
    if (existing) {
      existing.weight += 1;
    } else {
      edgesById.set(id, { id, source, target, kind: edge.kind, weight: 1 });
      componentsById.get(source)!.importCount += 1;
      componentsById.get(target)!.dependentCount += 1;
    }
  }

  return {
    components: Array.from(componentsById.values()),
    edges: Array.from(edgesById.values()),
    entryComponentIds,
  };
}
