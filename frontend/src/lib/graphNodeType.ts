export interface NodeTypeInfo {
  type: string;
  colorClasses: string;
  description: string;
}

/**
 * One canonical color + label per inferred node kind. Badge styling (shown
 * on the node itself) and swatch styling (shown in the legend) both derive
 * from this single record so a new kind can't be added to one and silently
 * missed in the other.
 */
export interface NodeKindInfo {
  type: string;
  /** Short legend label, e.g. "Test". */
  label: string;
  /** Longer description shown in the node's own tooltip. */
  description: string;
  /** Full badge classes (background + text + border) for the on-node chip. */
  badgeClasses: string;
  /** Swatch classes (background + border only) for the legend dot. */
  swatchClasses: string;
}

export const NODE_KIND_INFO: Record<string, NodeKindInfo> = {
  TEST: {
    type: "TEST",
    label: "Test",
    description: "Test suite",
    badgeClasses: "bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/40",
    swatchClasses: "bg-purple-500/20 border-purple-500/40",
  },
  UTIL: {
    type: "UTIL",
    label: "Util",
    description: "Utility functions",
    badgeClasses: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400 border-cyan-500/40",
    swatchClasses: "bg-cyan-500/20 border-cyan-500/40",
  },
  API: {
    type: "API",
    label: "API",
    // Stack-neutral: the analyzed repo may not be Express (or even Node).
    description: "Routing layer",
    badgeClasses: "bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/40",
    swatchClasses: "bg-green-500/20 border-green-500/40",
  },
  SERVICE: {
    type: "SERVICE",
    label: "Service",
    description: "Business logic service",
    badgeClasses: "bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/40",
    swatchClasses: "bg-blue-500/20 border-blue-500/40",
  },
  MIDDLEWARE: {
    type: "MIDDLEWARE",
    label: "Middleware",
    description: "Request middleware",
    badgeClasses: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40",
    swatchClasses: "bg-amber-500/20 border-amber-500/40",
  },
  DATA: {
    type: "DATA",
    label: "Data",
    description: "Database layer",
    badgeClasses: "bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/40",
    swatchClasses: "bg-orange-500/20 border-orange-500/40",
  },
  ENV: {
    type: "ENV",
    label: "Env/config",
    description: "App configuration",
    badgeClasses: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/40",
    swatchClasses: "bg-yellow-500/20 border-yellow-500/40",
  },
  ENTRY: {
    type: "ENTRY",
    label: "Index/main",
    description: "Application entry point",
    badgeClasses: "bg-primary/20 text-primary border-primary/40",
    swatchClasses: "bg-primary/20 border-primary/40",
  },
  MODULE: {
    type: "MODULE",
    label: "Module",
    description: "Module",
    badgeClasses: "bg-slate-500/20 text-slate-700 dark:text-slate-400 border-slate-500/40",
    swatchClasses: "bg-slate-500/20 border-slate-500/40",
  },
};

function toNodeTypeInfo(kind: string): NodeTypeInfo {
  const info = NODE_KIND_INFO[kind]!;
  return { type: info.type, colorClasses: info.badgeClasses, description: info.description };
}

/**
 * True when `token` is its own path segment (a directory, or a dot/dash/
 * underscore-separated filename part) or the basename starts with it.
 * Anchors the classification heuristics below to path/name boundaries
 * instead of an unanchored substring search — e.g. "config" no longer
 * matches inside an unrelated "webConfigValidator.ts".
 */
function hasPathToken(path: string, token: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? "";
  if (segments.slice(0, -1).some((seg) => seg === token || seg === `${token}s`)) return true;
  if (basename.startsWith(token)) return true;
  return basename.split(/[.\-_]/).includes(token);
}

export function inferNodeType(filePath: string, exportedSymbols: string[]): NodeTypeInfo {
  const p = filePath.toLowerCase();

  if (
    p.includes(".test.") ||
    p.includes(".spec.") ||
    hasPathToken(p, "test") ||
    hasPathToken(p, "tests") ||
    p.includes("/__tests__")
  ) {
    return toNodeTypeInfo("TEST");
  }
  if (p.includes("/utils/") || p.includes("/helpers/") || p.includes("/util/")) {
    return toNodeTypeInfo("UTIL");
  }
  if (p.includes("/routes/") || hasPathToken(p, "router") || hasPathToken(p, "routers") || p.includes("/api/")) {
    return toNodeTypeInfo("API");
  }
  if (p.includes("/services/") || hasPathToken(p, "service")) {
    return toNodeTypeInfo("SERVICE");
  }
  if (p.includes("/middleware/") || hasPathToken(p, "middleware")) {
    return toNodeTypeInfo("MIDDLEWARE");
  }
  if (p.includes("/db/") || p.includes("/database/") || hasPathToken(p, "repository") || hasPathToken(p, "repositories")) {
    return toNodeTypeInfo("DATA");
  }
  if (hasPathToken(p, "config") || p.includes(".env") || p.includes("/env/")) {
    return toNodeTypeInfo("ENV");
  }
  if (hasPathToken(p, "index") || hasPathToken(p, "main")) {
    return toNodeTypeInfo("ENTRY");
  }

  const description = exportedSymbols.length > 0 ? `Exports ${exportedSymbols[0]}` : "Module";
  return { ...toNodeTypeInfo("MODULE"), description };
}

// Complexity is a heuristic measure of how coupled a module is in the dependency graph.
// score = (importCount × 2) + dependentCount + symbolCount
//   importCount   — how many modules this file imports (double-weighted: more deps = harder to isolate)
//   dependentCount — how many modules import this file (high = wide blast radius on change)
//   symbolCount   — how many symbols this file exports (surface area exposed to the rest of the codebase)
// Thresholds (score >= 8 → High, >= 5 → Med) are arbitrary — chosen by feel, not data.
// Consider replacing with percentile-based cutoffs derived from the actual score distribution.
export function inferComplexity(importCount: number, dependentCount: number, symbolCount: number): string | null {
  const score = importCount * 2 + dependentCount + symbolCount;
  if (score >= 8) return "High Complexity";
  if (score >= 5) return "Med Complexity";
  return null;
}
