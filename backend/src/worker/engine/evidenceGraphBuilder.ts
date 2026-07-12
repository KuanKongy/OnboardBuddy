import type { PoolClient } from 'pg';
import * as path from 'node:path';
import type {
  FileAnalysis,
  RepoFileRecord,
  EvidenceNode,
  EvidenceEdge,
  EvidenceGraph,
  EvidenceNodeType,
  SymbolInfo,
} from '../types/analysis.js';
import type { DetectedEntrypoint } from './entrypointDetector.js';
import type { DetectedSideEffect } from './sideEffectDetector.js';
import type { DocsIngestResult } from './docsIngester.js';
import { symbolKey, externalKey, normalizePath } from './stableKeys.js';
import { deriveBehaviorSignals, derivePurposeSignals } from './behaviorSignals.js';
import { schemaTableIndex } from './configScanner.js';
import { collectPathAliases, resolveAlias, type CollectedAliases } from './tsconfigPaths.js';

/**
 * Builds the full symbol-level evidence graph (doc/Pipeline.md "Code
 * Evidence Graph"): file + symbol + method nodes, doc/config/schema evidence
 * nodes, `external` boundary nodes for anything imported from outside the
 * scope, and typed edges — all with mechanical trust levels.
 *
 * NOTE (interim): file nodes keep type 'module' because the current graph
 * API/frontend filter on it; Phase 10 renames them to 'file' when the UI
 * moves to cluster-backed views.
 */

const SYMBOL_NODE_TYPE: Record<string, EvidenceNodeType> = {
  class: 'class',
  interface: 'interface',
  type: 'type',
  function: 'function',
  'arrow-function': 'function',
  method: 'method',
  variable: 'variable',
  enum: 'enum',
};

export interface BuildEvidenceGraphInput {
  fileAnalyses: FileAnalysis[];
  fileRecords: RepoFileRecord[];
  entrypoints: DetectedEntrypoint[];
  sideEffects: DetectedSideEffect[];
  configNodes: EvidenceNode[];
  docs: DocsIngestResult;
  rootPath: string;
}

export function buildEvidenceGraph(input: BuildEvidenceGraphInput): EvidenceGraph {
  const nodes = new Map<string, EvidenceNode>();
  const edges: EvidenceEdge[] = [];

  const recordByPath = new Map(input.fileRecords.map((r) => [r.relativePath, r]));
  const parsedPaths = new Set(input.fileAnalyses.map((fa) => normalizePath(fa.relativePath)));
  const aliases = collectPathAliases(input.rootPath);

  const addNode = (n: EvidenceNode) => {
    if (!nodes.has(n.stableKey)) nodes.set(n.stableKey, n);
    return nodes.get(n.stableKey)!;
  };
  const edgeByKey = new Map<string, EvidenceEdge>();
  /**
   * Returns true when a new edge was inserted (counts key on this, so
   * repeated import statements don't inflate them). Duplicate `imports`
   * edges instead strengthen the existing edge's weight — the UI's
   * "strongest edges" filter sorts on it.
   */
  const addEdge = (e: EvidenceEdge): boolean => {
    const key = `${e.sourceKey}→${e.targetKey}:${e.type}`;
    if (e.sourceKey === e.targetKey) return false;
    const existing = edgeByKey.get(key);
    if (existing) {
      if (e.type === 'imports') {
        existing.metadata.weight = Number(existing.metadata.weight ?? 1) + 1;
      }
      return false;
    }
    if (e.type === 'imports') e.metadata.weight = 1;
    edgeByKey.set(key, e);
    edges.push(e);
    return true;
  };

  // ── 1. File nodes (+ symbol/method nodes + contains edges) ────────────────
  for (const fa of input.fileAnalyses) {
    const relPath = normalizePath(fa.relativePath);
    const record = recordByPath.get(relPath);
    const isTest = record?.category === 'test';
    const fileTrust = isTest ? 'tests' : 'code';

    const exportedSymbols = [
      ...fa.exports.flatMap((e) => e.namedExports),
      ...fa.symbols.filter((s) => s.exported).map((s) => s.name),
    ];

    addNode({
      stableKey: relPath,
      type: 'module', // interim: 'file' after Phase 10 (see header note)
      name: path.posix.basename(relPath),
      filePath: relPath,
      hash: record?.hash ?? null,
      trustLevel: fileTrust,
      metadata: {
        exportedSymbols: [...new Set(exportedSymbols)],
        importCount: 0, // distinct internal imports, filled below from deduped edges
        externalImportCount: 0, // distinct third-party/boundary imports, filled below
        dependentCount: 0, // distinct internal importers, filled below
        lineCount: record?.lineCount ?? null,
        category: record?.category ?? 'source',
      },
    });

    for (const sym of fa.symbols) {
      const symKey = sym.stableKey ?? symbolKey(relPath, sym.name);
      addNode(symbolNode(symKey, sym, relPath, fileTrust));
      addEdge({ sourceKey: relPath, targetKey: symKey, type: 'contains', confidence: 'high', metadata: {} });

      // Class methods become their own nodes under `path#Class.method`.
      if (sym.kind === 'class' && sym.methods) {
        for (const m of sym.methods) {
          const mKey = symbolKey(relPath, m.name, sym.name);
          addNode({
            stableKey: mKey,
            type: 'method',
            name: `${sym.name}.${m.name}`,
            filePath: relPath,
            lineStart: m.lineStart ?? null,
            lineEnd: m.lineEnd ?? null,
            hash: m.bodyHash ?? null,
            signatureHash: m.signatureHash ?? null,
            bodyHash: m.bodyHash ?? null,
            trustLevel: fileTrust,
            exported: sym.exported,
            snippet: m.snippet ?? null,
            metadata: {
              signature: m.signature,
              returnType: m.returnType,
              accessibility: m.accessibility,
              isAsync: m.isAsync,
              isTrivial: m.isTrivial ?? false,
              parentClass: sym.name,
            },
          });
          addEdge({ sourceKey: symKey, targetKey: mKey, type: 'contains', confidence: 'high', metadata: {} });
        }
      }
    }
  }

  // ── 2. Import edges (file -> file) + external boundary nodes ──────────────
  // Counts are distinct-file counts keyed on deduped edges: two import
  // statements from A to B (e.g. a value import + `import type`) are one
  // dependency, not two "used by".
  const dependentCount = new Map<string, number>();
  const internalImportCount = new Map<string, number>();
  const externalImportCount = new Map<string, number>();
  for (const fa of input.fileAnalyses) {
    const relPath = normalizePath(fa.relativePath);
    for (const imp of fa.imports) {
      const resolved = resolveImport(relPath, imp.toSpecifier, parsedPaths, aliases);
      if (resolved.kind === 'internal') {
        const inserted = addEdge({
          sourceKey: relPath,
          targetKey: resolved.target,
          type: 'imports',
          confidence: 'high',
          metadata: { specifier: imp.toSpecifier },
        });
        if (inserted) {
          dependentCount.set(resolved.target, (dependentCount.get(resolved.target) ?? 0) + 1);
          internalImportCount.set(relPath, (internalImportCount.get(relPath) ?? 0) + 1);
        }

        // Test files -> tests edges onto the files they import.
        if (recordByPath.get(relPath)?.category === 'test') {
          addEdge({ sourceKey: relPath, targetKey: resolved.target, type: 'tests', confidence: 'medium', metadata: { detectedFrom: 'test_import' } });
        }
      } else {
        // Outside the scope (third-party package or cross-boundary path):
        // an honest `external` node instead of a guessed edge.
        const extKey = externalKey(resolved.target);
        addNode({
          stableKey: extKey,
          type: 'external',
          name: resolved.target,
          filePath: null,
          trustLevel: 'code',
          metadata: { specifier: imp.toSpecifier, boundary: resolved.boundary },
        });
        const inserted = addEdge({
          sourceKey: relPath,
          targetKey: extKey,
          type: 'references_external',
          confidence: 'high',
          metadata: { specifier: imp.toSpecifier },
        });
        if (inserted) {
          externalImportCount.set(relPath, (externalImportCount.get(relPath) ?? 0) + 1);
        }
      }
    }
  }
  for (const [target, count] of dependentCount) {
    const node = nodes.get(target);
    if (node) node.metadata.dependentCount = count;
  }
  for (const [source, count] of internalImportCount) {
    const node = nodes.get(source);
    if (node) node.metadata.importCount = count;
  }
  for (const [source, count] of externalImportCount) {
    const node = nodes.get(source);
    if (node) node.metadata.externalImportCount = count;
  }

  // ── 3. Calls edges (symbol -> symbol, TypeChecker-resolved) ──────────────
  for (const fa of input.fileAnalyses) {
    const relPath = normalizePath(fa.relativePath);
    for (const sym of fa.symbols) {
      const sourceKey = sym.stableKey ?? symbolKey(relPath, sym.name);
      addCallEdges(sourceKey, sym.resolvedCalls ?? [], nodes, addEdge);
      if (sym.kind === 'class' && sym.methods) {
        for (const m of sym.methods) {
          addCallEdges(symbolKey(relPath, m.name, sym.name), m.resolvedCalls ?? [], nodes, addEdge);
        }
      }
    }
  }

  // ── 4. extends / implements edges ─────────────────────────────────────────
  const symbolIdsByName = new Map<string, string[]>();
  for (const n of nodes.values()) {
    if (n.type === 'class' || n.type === 'interface') {
      symbolIdsByName.set(n.name, [...(symbolIdsByName.get(n.name) ?? []), n.stableKey]);
    }
  }
  const bareName = (name: string) => name.split('<')[0]!.trim();
  const resolveParent = (name: string, fromFile: string): string | null => {
    const candidates = symbolIdsByName.get(bareName(name)) ?? [];
    if (candidates.length === 0) return null;
    const sameFile = candidates.find((id) => id.startsWith(`${fromFile}#`));
    if (sameFile) return sameFile;
    return candidates.length === 1 ? candidates[0]! : null;
  };

  for (const fa of input.fileAnalyses) {
    const relPath = normalizePath(fa.relativePath);
    for (const sym of fa.symbols) {
      if (sym.kind !== 'class' && sym.kind !== 'interface') continue;
      const sourceKey = sym.stableKey ?? symbolKey(relPath, sym.name);
      const parents: Array<{ name: string; type: 'extends' | 'implements' }> = [];
      if (sym.kind === 'class') {
        if (sym.extendsClass) parents.push({ name: sym.extendsClass, type: 'extends' });
        for (const i of sym.implements ?? []) parents.push({ name: i, type: 'implements' });
      } else {
        for (const p of sym.extends ?? []) parents.push({ name: p, type: 'extends' });
      }
      for (const p of parents) {
        const target = resolveParent(p.name, relPath);
        if (target) addEdge({ sourceKey, targetKey: target, type: p.type, confidence: 'high', metadata: {} });
      }
    }
  }

  // ── 5. Entrypoint handles_route edges (file -> handler symbol) ────────────
  for (const ep of input.entrypoints) {
    if (!ep.symbolStableKey || !nodes.has(ep.symbolStableKey)) continue;
    const fileKeyNorm = normalizePath(ep.nodeStableKey);
    if (!nodes.has(fileKeyNorm)) continue;
    addEdge({
      sourceKey: fileKeyNorm,
      targetKey: ep.symbolStableKey,
      type: 'handles_route',
      confidence: 'medium',
      metadata: { triggerKind: ep.kind, method: ep.method ?? null },
    });
  }

  // ── 6. Doc + config + schema evidence nodes ───────────────────────────────
  for (const n of input.configNodes) addNode(n);
  for (const n of input.docs.nodes) addNode(n);
  for (const e of input.docs.edges) {
    if (nodes.has(e.targetKey)) addEdge(e);
  }

  // ── 7. touches_schema edges (symbol -> schema node by table mention) ──────
  const tables = schemaTableIndex(input.configNodes);
  if (tables.size > 0) {
    for (const fa of input.fileAnalyses) {
      const relPath = normalizePath(fa.relativePath);
      for (const sym of fa.symbols) {
        const callsStr = [
          ...(sym.callsSymbols ?? []),
          sym.snippet ?? '',
        ].join(' ');
        if (!callsStr) continue;
        for (const [table, schemaNodeKey] of tables) {
          if (mentionsTable(callsStr, table)) {
            addEdge({
              sourceKey: sym.stableKey ?? symbolKey(relPath, sym.name),
              targetKey: schemaNodeKey,
              type: 'touches_schema',
              confidence: 'medium',
              metadata: { table, detectedFrom: 'query_text' },
            });
          }
        }
      }
    }
  }

  // ── 8. Behavior/purpose signals stamped into symbol metadata ──────────────
  const stampSignals = (key: string, source: Parameters<typeof deriveBehaviorSignals>[0], relPath: string, name: string): void => {
    const node = nodes.get(key);
    if (!node) return;
    const behavior = deriveBehaviorSignals(source);
    const purpose = derivePurposeSignals(relPath, { name });
    if (behavior.length > 0) node.metadata.behaviorSignals = behavior;
    if (purpose.length > 0) node.metadata.purposeSignals = purpose;
  };
  for (const fa of input.fileAnalyses) {
    const relPath = normalizePath(fa.relativePath);
    for (const sym of fa.symbols) {
      stampSignals(sym.stableKey ?? symbolKey(relPath, sym.name), sym, relPath, sym.name);
      // Method nodes carry their own calls/snippet — signal them individually
      // so workflow traces classify `Server.echo` by what echo does, not by
      // what the whole class does.
      if (sym.kind === 'class' && sym.methods) {
        for (const m of sym.methods) {
          stampSignals(symbolKey(relPath, m.name, sym.name), m, relPath, m.name);
        }
      }
    }
  }

  return { nodes: [...nodes.values()], edges };
}

function symbolNode(stableKey: string, sym: SymbolInfo, relPath: string, trust: 'code' | 'tests'): EvidenceNode {
  return {
    stableKey,
    type: SYMBOL_NODE_TYPE[sym.kind] ?? 'variable',
    name: sym.name,
    filePath: relPath,
    lineStart: sym.start.line,
    lineEnd: sym.end.line,
    hash: sym.bodyHash ?? null,
    signatureHash: sym.signatureHash ?? null,
    bodyHash: sym.bodyHash ?? null,
    trustLevel: trust,
    exported: sym.exported,
    snippet: sym.snippet ?? null,
    metadata: {
      ...(sym.signature ? { signature: sym.signature } : {}),
      ...(sym.returnType ? { returnType: sym.returnType } : {}),
      ...(sym.parameters ? { params: sym.parameters.map((p) => p.name) } : {}),
      ...(sym.jsDoc ? { jsdoc: sym.jsDoc.slice(0, 2000) } : {}),
      isTrivial: sym.isTrivial ?? false,
      isDefault: sym.isDefault,
    },
  };
}

function addCallEdges(
  sourceKey: string,
  resolvedCalls: NonNullable<SymbolInfo['resolvedCalls']>,
  nodes: Map<string, EvidenceNode>,
  addEdge: (e: EvidenceEdge) => void,
): void {
  for (const call of resolvedCalls) {
    const targetKey = call.targetParentName
      ? symbolKey(call.targetRelativePath, call.targetName, call.targetParentName)
      : symbolKey(call.targetRelativePath, call.targetName);
    if (!nodes.has(targetKey) || targetKey === sourceKey) continue;
    addEdge({
      sourceKey,
      targetKey,
      type: 'calls',
      confidence: 'high',
      metadata: { detectedFrom: 'CallExpression', expression: call.callee },
    });
  }
}

function mentionsTable(text: string, table: string): boolean {
  // from('table') / .from("table") style, or SQL keyword adjacency.
  return (
    new RegExp(`from\\s*\\(\\s*['"\`]${table}['"\`]`, 'i').test(text) ||
    new RegExp(`(insert\\s+into|update|delete\\s+from|from|join)\\s+(public\\.)?${table}\\b`, 'i').test(text)
  );
}

// ─── Import resolution (scope-aware) ─────────────────────────────────────────

type ImportResolution =
  | { kind: 'internal'; target: string }
  | { kind: 'external'; target: string; boundary: 'package' | 'out_of_scope' };

function withExtensionCandidates(resolved: string): string[] {
  const candidates: string[] = [];
  if (resolved.endsWith('.js')) candidates.push(`${resolved.slice(0, -3)}.ts`, `${resolved.slice(0, -3)}.tsx`);
  else if (resolved.endsWith('.jsx')) candidates.push(`${resolved.slice(0, -4)}.tsx`, `${resolved.slice(0, -4)}.jsx`);
  candidates.push(
    resolved,
    `${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`, `${resolved}/index.tsx`,
    `${resolved}.js`, `${resolved}/index.js`,
  );
  return candidates;
}

function resolveImport(
  fromFile: string,
  specifier: string,
  parsedPaths: Set<string>,
  aliases: CollectedAliases,
): ImportResolution {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    // Try tsconfig path aliases first — `@/components/x` is a repo file,
    // not a package, when a tsconfig maps it.
    const aliasTargets = resolveAlias(aliases, specifier);
    if (aliasTargets) {
      for (const target of aliasTargets) {
        const normalized = path.posix.normalize(target);
        for (const c of withExtensionCandidates(normalized)) {
          if (parsedPaths.has(c)) return { kind: 'internal', target: c };
        }
      }
    }
    // Bare specifier: third-party package. Keep the package root only.
    const parts = specifier.split('/');
    const pkg = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
    return { kind: 'external', target: pkg, boundary: 'package' };
  }

  const fromDir = path.posix.dirname(fromFile);
  const resolved = path.posix.normalize(path.posix.join(fromDir, specifier));

  for (const c of withExtensionCandidates(resolved)) {
    if (parsedPaths.has(c)) return { kind: 'internal', target: c };
  }
  // Relative import that resolves outside the parsed scope: boundary node.
  return { kind: 'external', target: resolved, boundary: 'out_of_scope' };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const INSERT_CHUNK = 200;

/**
 * Persists the evidence graph inside the caller's transaction. Returns the
 * stableKey -> node uuid map the detectors and rankers key on.
 */
export async function persistEvidenceGraph(
  client: PoolClient,
  snapshotId: string,
  graph: EvidenceGraph,
): Promise<Map<string, string>> {
  const nodeIdMap = new Map<string, string>();

  for (let i = 0; i < graph.nodes.length; i += INSERT_CHUNK) {
    const chunk = graph.nodes.slice(i, i + INSERT_CHUNK);
    const values: unknown[] = [];
    const rows: string[] = [];
    chunk.forEach((n, j) => {
      const base = j * 12;
      rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`);
      values.push(
        snapshotId, n.stableKey, n.type, n.name, n.filePath,
        n.lineStart ?? null, n.lineEnd ?? null,
        n.hash ?? null, n.signatureHash ?? null, n.bodyHash ?? null,
        n.trustLevel, JSON.stringify(n.metadata),
      );
    });
    const result = await client.query<{ id: string; stable_key: string }>(
      `INSERT INTO graph_nodes
         (snapshot_id, stable_key, type, name, file_path, line_start, line_end,
          hash, signature_hash, body_hash, trust_level, metadata)
       VALUES ${rows.join(', ')}
       RETURNING id, stable_key`,
      values,
    );
    for (const row of result.rows) nodeIdMap.set(row.stable_key, row.id);
  }

  // exported + snippet are dedicated columns; set them in a second pass to
  // keep the hot insert narrow.
  const exportedKeys = graph.nodes.filter((n) => n.exported).map((n) => n.stableKey);
  if (exportedKeys.length > 0) {
    await client.query(
      `UPDATE graph_nodes SET exported = true WHERE snapshot_id = $1 AND stable_key = ANY($2)`,
      [snapshotId, exportedKeys],
    );
  }
  const withSnippets = graph.nodes.filter((n) => n.snippet);
  for (let i = 0; i < withSnippets.length; i += INSERT_CHUNK) {
    const chunk = withSnippets.slice(i, i + INSERT_CHUNK);
    await client.query(
      `UPDATE graph_nodes AS g SET snippet = s.snippet
       FROM (SELECT unnest($2::text[]) AS stable_key, unnest($3::text[]) AS snippet) s
       WHERE g.snapshot_id = $1 AND g.stable_key = s.stable_key`,
      [snapshotId, chunk.map((n) => n.stableKey), chunk.map((n) => n.snippet)],
    );
  }

  for (let i = 0; i < graph.edges.length; i += INSERT_CHUNK) {
    const chunk = graph.edges.slice(i, i + INSERT_CHUNK);
    const values: unknown[] = [];
    const rows: string[] = [];
    let idx = 0;
    for (const e of chunk) {
      const sourceId = nodeIdMap.get(e.sourceKey);
      const targetId = nodeIdMap.get(e.targetKey);
      if (!sourceId || !targetId) continue;
      const base = idx * 6;
      rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
      values.push(snapshotId, sourceId, targetId, e.type, e.confidence, JSON.stringify(e.metadata));
      idx++;
    }
    if (rows.length === 0) continue;
    await client.query(
      `INSERT INTO graph_edges (snapshot_id, source_node_id, target_node_id, type, confidence, metadata)
       VALUES ${rows.join(', ')}
       ON CONFLICT (snapshot_id, source_node_id, target_node_id, type) DO NOTHING`,
      values,
    );
  }

  return nodeIdMap;
}

/** Persists the scoped repository file inventory for incremental diffs. */
export async function persistRepositoryFiles(
  client: PoolClient,
  snapshotId: string,
  records: RepoFileRecord[],
): Promise<void> {
  for (let i = 0; i < records.length; i += INSERT_CHUNK) {
    const chunk = records.slice(i, i + INSERT_CHUNK);
    const values: unknown[] = [];
    const rows: string[] = [];
    chunk.forEach((r, j) => {
      const base = j * 9;
      rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`);
      values.push(
        snapshotId, r.relativePath, r.relativePath, r.language, r.category,
        r.supported, r.trustLevel, r.sizeBytes, r.hash,
      );
    });
    await client.query(
      `INSERT INTO repository_files
         (snapshot_id, stable_key, file_path, language, category, supported, trust_level, size_bytes, hash)
       VALUES ${rows.join(', ')}
       ON CONFLICT (snapshot_id, stable_key) DO NOTHING`,
      values,
    );
  }

  // line_count in a second narrow pass (kept out of the hot insert).
  const withLines = records.filter((r) => r.lineCount != null);
  for (let i = 0; i < withLines.length; i += INSERT_CHUNK) {
    const chunk = withLines.slice(i, i + INSERT_CHUNK);
    await client.query(
      `UPDATE repository_files AS f SET line_count = s.line_count
       FROM (SELECT unnest($2::text[]) AS stable_key, unnest($3::int[]) AS line_count) s
       WHERE f.snapshot_id = $1 AND f.stable_key = s.stable_key`,
      [snapshotId, chunk.map((r) => r.relativePath), chunk.map((r) => r.lineCount)],
    );
  }
}
