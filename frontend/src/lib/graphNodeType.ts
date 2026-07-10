export interface NodeTypeInfo {
  type: string;
  colorClasses: string;
  description: string;
}

export function inferNodeType(filePath: string, exportedSymbols: string[]): NodeTypeInfo {
  const p = filePath.toLowerCase();

  if (p.includes(".test.") || p.includes(".spec.") || p.includes("/test") || p.includes("/__tests__")) {
    return { type: "TEST", colorClasses: "bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/40", description: "Test suite" };
  }
  if (p.includes("/utils/") || p.includes("/helpers/") || p.includes("/util/")) {
    return { type: "UTIL", colorClasses: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400 border-cyan-500/40", description: "Utility functions" };
  }
  if (p.includes("/routes/") || p.includes("/router") || p.includes("/api/")) {
    return { type: "API", colorClasses: "bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/40", description: "Express routing layer" };
  }
  if (p.includes("/services/") || p.includes("service")) {
    return { type: "SERVICE", colorClasses: "bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/40", description: "Business logic service" };
  }
  if (p.includes("/middleware/") || p.includes("middleware")) {
    return { type: "MIDDLEWARE", colorClasses: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40", description: "Request middleware" };
  }
  if (p.includes("/db/") || p.includes("/database/") || p.includes("repositor")) {
    return { type: "DATA", colorClasses: "bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/40", description: "Database layer" };
  }
  if (p.includes("config") || p.includes(".env") || p.includes("/env/")) {
    return { type: "ENV", colorClasses: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/40", description: "App configuration" };
  }
  if (p.includes("index") || p.includes("main")) {
    return { type: "ENTRY", colorClasses: "bg-primary/20 text-primary border-primary/40", description: "Application entry point" };
  }

  const desc = exportedSymbols.length > 0 ? `Exports ${exportedSymbols[0]}` : "Module";
  return { type: "MODULE", colorClasses: "bg-slate-500/20 text-slate-700 dark:text-slate-400 border-slate-500/40", description: desc };
}

export function inferComplexity(importCount: number, dependentCount: number, symbolCount: number): string | null {
  const score = importCount * 2 + dependentCount + symbolCount;
  if (score >= 8) return "High Complexity";
  if (score >= 5) return "Med Complexity";
  return null;
}

