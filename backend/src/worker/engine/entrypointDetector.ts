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

export function detectEntrypoints(fileAnalyses: FileAnalysis[]): DetectedEntrypoint[] {
  const entrypoints: DetectedEntrypoint[] = [];

  for (const fa of fileAnalyses) {
    const relativePath = normalizePath(fa.relativePath);
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
        routePattern: route.routePath,
        filePath: relativePath,
        symbolName: route.handlerSymbolName,
        symbolStableKey: route.handlerSymbolName && route.handlerRelativePath
          ? symbolKey(route.handlerRelativePath, route.handlerSymbolName)
          : undefined,
      });
      foundEntrypoint = true;
    }

    // Routes/controllers by convention only when nothing was AST-detected.
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
