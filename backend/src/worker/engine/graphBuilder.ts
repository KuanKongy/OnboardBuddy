import * as path from 'path';
import type {
  FileAnalysis,
  GraphNode,
  GraphEdge,
  DependencyGraph,
  ImportRecord,
} from '../types/analysis.js';

// ─── Path resolution ──────────────────────────────────────────────────────────

function resolveSpecifier(
  fromFile: string,
  specifier: string,
  rootPath: string,
  allRelativePaths: Set<string>,
): string | null {
  // skip node_modules and bare specifiers
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;

  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(rootPath, fromDir, specifier);
  const relResolved = path.relative(rootPath, resolved);

  const candidates: string[] = [];

  // Handle NodeNext ESM .js/.jsx specifiers -> .ts/.tsx source files
  if (relResolved.endsWith('.js')) {
    const base = relResolved.slice(0, -3);
    candidates.push(`${base}.ts`, `${base}.tsx`);
  } else if (relResolved.endsWith('.jsx')) {
    const base = relResolved.slice(0, -4);
    candidates.push(`${base}.tsx`, `${base}.jsx`);
  }

  // Standard resolution: exact, then with extensions
  candidates.push(
    relResolved,
    `${relResolved}.ts`,
    `${relResolved}.tsx`,
    `${relResolved}/index.ts`,
    `${relResolved}/index.tsx`,
    `${relResolved}.js`,
    `${relResolved}/index.js`,
  );

  for (const c of candidates) {
    if (allRelativePaths.has(c)) return c;
  }

  return null;
}

// ─── Graph construction ───────────────────────────────────────────────────────

export function buildDependencyGraph(
  fileAnalyses: FileAnalysis[],
  rootPath: string,
): DependencyGraph {
  const allRelativePaths = new Set(fileAnalyses.map((fa) => fa.relativePath));
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  // Build one node per file
  for (const fa of fileAnalyses) {
    const nodeId = fa.relativePath;
    const exportedSymbols = [
      ...fa.exports.flatMap((e) => e.namedExports),
      ...fa.symbols.filter((s) => s.exported).map((s) => s.name),
    ];

    nodeMap.set(nodeId, {
      id: nodeId,
      label: path.basename(fa.relativePath, path.extname(fa.relativePath)),
      kind: 'module',
      filePath: fa.filePath,
      metadata: {
        exportedSymbols: [...new Set(exportedSymbols)],
        importCount: fa.imports.length,
        dependentCount: 0,
      },
    });
  }

  // Build import edges
  for (const fa of fileAnalyses) {
    for (const imp of fa.imports) {
      const resolvedRel = resolveSpecifier(
        fa.relativePath,
        imp.toSpecifier,
        rootPath,
        allRelativePaths,
      );
      if (!resolvedRel) continue;

      const edgeId = `${fa.relativePath}→${resolvedRel}`;
      if (edgeSet.has(edgeId)) continue;
      edgeSet.add(edgeId);

      edges.push({
        id: edgeId,
        source: fa.relativePath,
        target: resolvedRel,
        kind: 'imports',
        weight: 1,
      });

      // increment dependentCount on target
      const targetNode = nodeMap.get(resolvedRel);
      if (targetNode) {
        targetNode.metadata.dependentCount += 1;
      }
    }
  }

  const nodes = Array.from(nodeMap.values());
  const entryPoints = detectEntryPoints(nodes, edges);

  return { nodes, edges, entryPoints };
}

// ─── Entry point detection ────────────────────────────────────────────────────

function detectEntryPoints(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const hasInbound = new Set(edges.map((e) => e.target));

  // Files nobody imports + match common entry point names
  const ENTRY_PATTERNS = [/index\.(ts|tsx|js)$/, /main\.(ts|js)$/, /server\.(ts|js)$/, /app\.(ts|js)$/];

  return nodes
    .filter(
      (n) =>
        !hasInbound.has(n.id) ||
        ENTRY_PATTERNS.some((p) => p.test(n.id)),
    )
    .map((n) => n.id);
}

// ─── Resolve import paths back onto FileAnalysis records ──────────────────────

export function annotateResolvedImports(
  fileAnalyses: FileAnalysis[],
  rootPath: string,
): void {
  const allRelativePaths = new Set(fileAnalyses.map((fa) => fa.relativePath));
  const relativeToAbs = new Map(fileAnalyses.map((fa) => [fa.relativePath, fa.filePath]));

  for (const fa of fileAnalyses) {
    for (const imp of fa.imports) {
      const resolvedRel = resolveSpecifier(fa.relativePath, imp.toSpecifier, rootPath, allRelativePaths);
      if (resolvedRel) {
        (imp as ImportRecord).resolvedPath = relativeToAbs.get(resolvedRel);
      }
    }
  }
}
