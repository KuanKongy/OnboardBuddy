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

// ─── Class/interface graph ────────────────────────────────────────────────────

export interface ClassGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Builds symbol-level nodes for classes and interfaces plus
 * extends/implements edges. Node ids are `relativePath#SymbolName` so they
 * never collide with the file-level module nodes. Parent names are resolved
 * same-file first, then by unique match across the repo; unresolvable
 * parents (external libraries) produce no edge.
 */
export function buildClassGraph(fileAnalyses: FileAnalysis[]): ClassGraph {
  const nodeMap = new Map<string, GraphNode>();
  const idsByName = new Map<string, string[]>();

  for (const fa of fileAnalyses) {
    for (const s of fa.symbols) {
      if (s.kind !== 'class' && s.kind !== 'interface') continue;
      const id = `${fa.relativePath}#${s.name}`;
      if (nodeMap.has(id)) continue;

      const memberNames =
        s.kind === 'class'
          ? (s.methods?.map((m) => m.name) ?? [])
          : (s.properties?.map((p) => p.name) ?? []);

      nodeMap.set(id, {
        id,
        label: s.name,
        kind: s.kind,
        filePath: fa.filePath,
        metadata: {
          exportedSymbols: memberNames,
          importCount: 0,
          dependentCount: 0,
        },
      });
      idsByName.set(s.name, [...(idsByName.get(s.name) ?? []), id]);
    }
  }

  // `Base<T>` → `Base`
  const bareName = (name: string) => name.split('<')[0]!.trim();

  function resolveParent(name: string, fromFile: string): string | null {
    const candidates = idsByName.get(bareName(name)) ?? [];
    if (candidates.length === 0) return null;
    const sameFile = candidates.find((id) => id.startsWith(`${fromFile}#`));
    if (sameFile) return sameFile;
    return candidates.length === 1 ? candidates[0]! : null;
  }

  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  function addEdge(sourceId: string, parentName: string, kind: 'extends' | 'implements', fromFile: string) {
    const targetId = resolveParent(parentName, fromFile);
    if (!targetId || targetId === sourceId) return;
    const edgeId = `${sourceId}→${targetId}:${kind}`;
    if (edgeSet.has(edgeId)) return;
    edgeSet.add(edgeId);
    edges.push({ id: edgeId, source: sourceId, target: targetId, kind, weight: 1 });

    nodeMap.get(targetId)!.metadata.dependentCount += 1;
    nodeMap.get(sourceId)!.metadata.importCount += 1;
  }

  for (const fa of fileAnalyses) {
    for (const s of fa.symbols) {
      if (s.kind !== 'class' && s.kind !== 'interface') continue;
      const sourceId = `${fa.relativePath}#${s.name}`;

      if (s.kind === 'class') {
        if (s.extendsClass) addEdge(sourceId, s.extendsClass, 'extends', fa.relativePath);
        for (const iface of s.implements ?? []) addEdge(sourceId, iface, 'implements', fa.relativePath);
      } else {
        for (const parent of s.extends ?? []) addEdge(sourceId, parent, 'extends', fa.relativePath);
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
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
