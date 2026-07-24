import type { FileAnalysis } from '../types/analysis.js';
import { symbolKey, normalizePath } from './stableKeys.js';
import { query } from '../../lib/db.js';

export interface DetectedEntrypoint {
  /** File-level key (relative path) — used by workflow traversal. */
  nodeStableKey: string;
  kind: 'http_route' | 'ui_route' | 'cli_command' | 'event_handler' | 'cron_job' | 'message_consumer' | 'export';
  method?: string;
  routePattern?: string;
  filePath: string;
  symbolName?: string;
  /** Symbol-level key (`path#Symbol`) when the handler symbol is known. */
  symbolStableKey?: string;
}

/** Exported worker/consumer symbols that actually look like job handlers. */
const HANDLER_NAME = /^(process|handle|consume|on[A-Z])/;

import { isTestOrFixturePath } from './testPaths.js';

/** '/api' + '/projects/:id' -> '/api/projects/:id'; prefix + '/' -> prefix. */
export function joinRoutePaths(prefix: string, routePath: string): string {
  const joined = `${prefix}${routePath}`.replace(/\/{2,}/g, '/');
  if (joined.length > 1 && joined.endsWith('/')) return joined.slice(0, -1);
  return joined || '/';
}

/**
 * Full mount prefix per file, chained through `use()` mounts recorded by the
 * extractor: onboarding.ts <- routes/index.ts ('/projects/:id/onboarding')
 * <- app.ts ('/api') gives '/api/projects/:id/onboarding'. Unmounted files
 * (the app root) contribute ''. First mount wins when a file is mounted more
 * than once; chains are depth-capped against cycles.
 */
export function buildMountPrefixes(fileAnalyses: FileAnalysis[]): Map<string, string> {
  const mountOf = new Map<string, { prefix: string; parent: string }>();
  for (const fa of fileAnalyses) {
    const parent = normalizePath(fa.relativePath);
    for (const m of fa.routerMounts ?? []) {
      const child = normalizePath(m.targetRelativePath);
      if (child !== parent && !mountOf.has(child)) {
        mountOf.set(child, { prefix: m.prefix, parent });
      }
    }
  }
  const full = new Map<string, string>();
  const resolve = (file: string, depth: number): string => {
    if (full.has(file)) return full.get(file)!;
    const mount = mountOf.get(file);
    const prefix = !mount || depth <= 0 ? '' : `${resolve(mount.parent, depth - 1)}${mount.prefix}`;
    full.set(file, prefix);
    return prefix;
  };
  for (const file of mountOf.keys()) resolve(file, 6);
  return full;
}

export function detectEntrypoints(fileAnalyses: FileAnalysis[]): DetectedEntrypoint[] {
  const entrypoints: DetectedEntrypoint[] = [];
  const mountPrefixes = buildMountPrefixes(fileAnalyses);

  for (const fa of fileAnalyses) {
    const relativePath = normalizePath(fa.relativePath);
    // Test and fixture code never triggers anything a newcomer should be
    // pointed at — no branch below may seed entrypoints from it.
    if (isTestOrFixturePath(relativePath)) continue;
    let foundEntrypoint = false;

    // HTTP routes: precise AST-detected registrations (`router.get('/x', h)`)
    // with the real route pattern and handler symbol as the seed. The old
    // `*.get(...)` name matching flagged every `map.get()` as a route.
    const seenRoutes = new Set<string>();
    for (const route of fa.routeRegistrations ?? []) {
      const dedupe = `${route.method} ${route.routePath}`;
      if (seenRoutes.has(dedupe)) continue;
      seenRoutes.add(dedupe);
      entrypoints.push({
        nodeStableKey: relativePath,
        kind: 'http_route',
        method: route.method,
        // Full path via the file's mount chain — "GET /" on a sub-router is
        // ambiguous seven different ways in this very repo.
        routePattern: joinRoutePaths(mountPrefixes.get(relativePath) ?? '', route.routePath),
        filePath: relativePath,
        symbolName: route.handlerParentName
          ? `${route.handlerParentName}.${route.handlerSymbolName}`
          : route.handlerSymbolName,
        symbolStableKey: route.handlerSymbolName && route.handlerRelativePath
          ? symbolKey(route.handlerRelativePath, route.handlerSymbolName, route.handlerParentName)
          : undefined,
      });
      foundEntrypoint = true;
    }

    // Routes/controllers by convention only when nothing was AST-detected.
    // (Test/fixture paths were already skipped at the top of the loop.)
    if (!foundEntrypoint && (relativePath.match(/routes?\//i) || relativePath.match(/controller/i))) {
      entrypoints.push({
        nodeStableKey: relativePath,
        kind: 'http_route',
        filePath: relativePath,
      });
      foundEntrypoint = true;
    }

    // UI pages: exported PascalCase components under pages/views/screens.
    if (relativePath.match(/(^|\/)(pages|views|screens)\//i)) {
      const pageComponents = fa.symbols
        .filter((s) => s.exported && /^[A-Z]/.test(s.name) && (s.kind === 'function' || s.kind === 'arrow-function'))
        .slice(0, 2);
      for (const page of pageComponents) {
        entrypoints.push({
          nodeStableKey: relativePath,
          kind: 'ui_route',
          filePath: relativePath,
          symbolName: page.name,
          symbolStableKey: symbolKey(relativePath, page.name),
        });
        foundEntrypoint = true;
      }
    }

    // CLI entrypoints
    if (relativePath.match(/(^|\/)(cli|bin|commands?)\//i)) {
      const first = fa.symbols.find((s) => s.exported);
      if (first) {
        entrypoints.push({
          nodeStableKey: relativePath,
          kind: 'cli_command',
          filePath: relativePath,
          symbolName: first.name,
          symbolStableKey: symbolKey(relativePath, first.name),
        });
      }
    }

    // Event/job handlers: worker-ish files, but only symbols that look like
    // handlers — not every exported function in a `*worker*` path.
    if (relativePath.match(/worker|listener|consumer|jobs?\//i)) {
      for (const sym of fa.symbols) {
        if (
          sym.exported &&
          (sym.kind === 'function' || sym.kind === 'arrow-function') &&
          HANDLER_NAME.test(sym.name)
        ) {
          entrypoints.push({
            nodeStableKey: relativePath,
            kind: 'event_handler',
            filePath: relativePath,
            symbolName: sym.name,
            symbolStableKey: symbolKey(relativePath, sym.name),
          });
        }
      }
    }

    // BullMQ-style queue consumers: `new Worker(QUEUE, handler)` registers
    // the product's background pipeline with an inline closure — invisible
    // to the named-export heuristic above, which is why the analyze
    // pipeline never traced as a workflow (audit P2 §15). The first
    // argument is a string literal or an UPPER_SNAKE constant; anything
    // path-like is a worker_threads script, not a queue.
    const seenQueues = new Set<string>();
    for (const sym of fa.symbols) {
      const src = `${sym.initializer ?? ''} ${sym.snippet ?? ''}`;
      if (!src.includes('new Worker')) continue;
      for (const m of src.matchAll(
        /new\s+Worker\s*(?:<[^>]*>)?\s*\(\s*(?:['"`]([\w:.-]+)['"`]|([A-Z_][A-Z0-9_]*))\s*,/g,
      )) {
        const queueName = m[1] ?? m[2]!;
        if (queueName.includes('/') || seenQueues.has(queueName)) continue;
        seenQueues.add(queueName);
        entrypoints.push({
          nodeStableKey: relativePath,
          kind: 'message_consumer',
          routePattern: queueName,
          filePath: relativePath,
          symbolName: sym.name,
          symbolStableKey: symbolKey(relativePath, sym.name),
        });
        foundEntrypoint = true;
      }
    }

    // Main entry files (only if no other entrypoint was already detected for this file)
    if (!foundEntrypoint && (relativePath.match(/(^|\/)index\.(ts|js|tsx|jsx)$/) || relativePath.match(/(^|\/)main\.(ts|js)$/))) {
      entrypoints.push({
        nodeStableKey: relativePath,
        kind: 'export',
        filePath: relativePath,
      });
    }
  }

  return entrypoints;
}

// Maps detector kinds onto the entrypoints.trigger_type enum
const TRIGGER_TYPE_BY_KIND: Record<DetectedEntrypoint['kind'], string> = {
  http_route: 'http_route',
  ui_route: 'ui_route',
  cli_command: 'cli',
  event_handler: 'event_listener',
  cron_job: 'scheduled_job',
  message_consumer: 'worker_job',
  export: 'package_export',
};

/** Returns each persisted entrypoint's row id (workflows reference it). */
export async function persistEntrypoints(
  snapshotId: string,
  entrypoints: DetectedEntrypoint[],
  nodeIdMap: Map<string, string>,
): Promise<Map<DetectedEntrypoint, string>> {
  const idMap = new Map<DetectedEntrypoint, string>();

  for (const ep of entrypoints) {
    // Prefer the symbol-level node; fall back to the file node.
    const nodeId =
      (ep.symbolStableKey ? nodeIdMap.get(ep.symbolStableKey) : undefined) ??
      nodeIdMap.get(ep.nodeStableKey);
    if (!nodeId) continue;

    const result = await query(
      `INSERT INTO entrypoints (snapshot_id, node_id, trigger_type, method, route_path, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        snapshotId,
        nodeId,
        TRIGGER_TYPE_BY_KIND[ep.kind],
        ep.method ?? null,
        ep.routePattern ?? null,
        JSON.stringify({ symbolName: ep.symbolName }),
      ],
    );
    if (result.rows.length > 0) idMap.set(ep, result.rows[0].id as string);
  }

  return idMap;
}
