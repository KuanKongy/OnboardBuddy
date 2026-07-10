import type { FileAnalysis } from '../types/analysis.js';
import { query } from '../../lib/db.js';

export interface DetectedEntrypoint {
  /** File-level key (relative path) — used by workflow traversal. */
  nodeStableKey: string;
  kind: 'http_route' | 'cli_command' | 'event_handler' | 'cron_job' | 'message_consumer' | 'export';
  method?: string;
  routePattern?: string;
  filePath: string;
  symbolName?: string;
  /** Symbol-level key (`path#Symbol`) when the handler symbol is known. */
  symbolStableKey?: string;
}

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

const _EXPRESS_PATTERNS = [
  /\.(get|post|put|patch|delete|all|use)\s*\(\s*['"`]/,
  /router\.(get|post|put|patch|delete|all|use)\s*\(/,
  /app\.(get|post|put|patch|delete|all|use)\s*\(/,
];

const _EVENT_PATTERNS = [
  /\.on\s*\(\s*['"`]/,
  /addEventListener\s*\(/,
  /\.subscribe\s*\(/,
];

const _CLI_PATTERNS = [
  /\.command\s*\(/,
  /program\.action\s*\(/,
  /yargs/,
];

export function detectEntrypoints(fileAnalyses: FileAnalysis[]): DetectedEntrypoint[] {
  const entrypoints: DetectedEntrypoint[] = [];

  for (const fa of fileAnalyses) {
    const relativePath = fa.relativePath;
    let foundEntrypoint = false;

    // Check ALL symbols (not just exported) for route method calls
    for (const sym of fa.symbols) {
      if (sym.callsSymbols) {
        for (const call of sym.callsSymbols) {
          const methodMatch = call.match(/\.(get|post|put|patch|delete|all|use)$/i);
          if (methodMatch && ROUTE_METHODS.has(methodMatch[1]!.toLowerCase())) {
            entrypoints.push({
              nodeStableKey: relativePath,
              kind: 'http_route',
              method: methodMatch[1]!.toUpperCase(),
              filePath: relativePath,
              symbolName: sym.name,
              symbolStableKey: `${relativePath}#${sym.name}`,
            });
            foundEntrypoint = true;
          }
        }
      }
    }

    // Detect based on file naming conventions
    if (!foundEntrypoint && (relativePath.match(/routes?\//i) || relativePath.match(/controller/i))) {
      const routeSymbols = fa.symbols.filter((s) => s.kind === 'variable' && s.name.toLowerCase().includes('router'));
      if (routeSymbols.length > 0) {
        for (const rs of routeSymbols) {
          entrypoints.push({
            nodeStableKey: relativePath,
            kind: 'http_route',
            filePath: relativePath,
            symbolName: rs.name,
            symbolStableKey: `${relativePath}#${rs.name}`,
          });
        }
        foundEntrypoint = true;
      } else {
        // File is in a routes/controller directory — treat as entrypoint even without explicit router symbols
        entrypoints.push({
          nodeStableKey: relativePath,
          kind: 'http_route',
          filePath: relativePath,
        });
        foundEntrypoint = true;
      }
    }

    // CLI entrypoints
    if (relativePath.match(/cli|bin|command/i)) {
      for (const sym of fa.symbols) {
        if (sym.exported) {
          entrypoints.push({
            nodeStableKey: relativePath,
            kind: 'cli_command',
            filePath: relativePath,
            symbolName: sym.name,
            symbolStableKey: `${relativePath}#${sym.name}`,
          });
          break;
        }
      }
    }

    // Event handlers (worker files, listeners)
    if (relativePath.match(/worker|listener|handler|consumer/i)) {
      for (const sym of fa.symbols) {
        if (sym.exported && (sym.kind === 'function' || sym.kind === 'arrow-function')) {
          entrypoints.push({
            nodeStableKey: relativePath,
            kind: 'event_handler',
            filePath: relativePath,
            symbolName: sym.name,
            symbolStableKey: `${relativePath}#${sym.name}`,
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
  cli_command: 'cli',
  event_handler: 'event_listener',
  cron_job: 'scheduled_job',
  message_consumer: 'worker_job',
  export: 'package_export',
};

export async function persistEntrypoints(
  snapshotId: string,
  entrypoints: DetectedEntrypoint[],
  nodeIdMap: Map<string, string>,
): Promise<void> {
  for (const ep of entrypoints) {
    // Prefer the symbol-level node; fall back to the file node.
    const nodeId =
      (ep.symbolStableKey ? nodeIdMap.get(ep.symbolStableKey) : undefined) ??
      nodeIdMap.get(ep.nodeStableKey);
    if (!nodeId) continue;

    await query(
      `INSERT INTO entrypoints (snapshot_id, node_id, trigger_type, method, route_path, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        snapshotId,
        nodeId,
        TRIGGER_TYPE_BY_KIND[ep.kind],
        ep.method ?? null,
        ep.routePattern ?? null,
        JSON.stringify({ symbolName: ep.symbolName }),
      ],
    );
  }
}
