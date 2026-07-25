import type { FileAnalysis, SymbolInfo } from '../types/analysis.js';
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

/** A JSX-capable extension — the cheapest reliable "this renders UI" signal. */
const JSX_EXT = /\.(tsx|jsx)$/i;

/**
 * Whether a file holds a routable page.
 *
 * `pages/`, `views/` and `screens/` are unambiguous. `app/` and `routes/` are
 * NOT: Next's App Router puts API handlers at `app/**\/route.ts`, and Express
 * projects keep their HTTP handlers in `src/routes/`. Requiring a JSX
 * extension there keeps `src/routes/authRoutes.ts` out of the UI bucket while
 * admitting Remix/SvelteKit/TanStack route components.
 */
function isPageFile(relativePath: string): boolean {
  if (/(^|\/)(pages|views|screens)\//i.test(relativePath)) return true;
  if (!JSX_EXT.test(relativePath)) return false;
  // Next App Router: only `page` is navigable. `layout` wraps a route without
  // being one — listing layouts as entrypoints would put a second, unreachable
  // "page" beside every real one.
  if (/(^|\/)app\//i.test(relativePath)) return isAppRouterPage(relativePath);
  return /(^|\/)routes?\//i.test(relativePath);
}

/**
 * A Next App Router page file. The optional `(.*\/)?` matters: the root page
 * is `app/page.tsx` with nothing between, so requiring a slash before `page.`
 * silently excluded every site's landing page.
 */
function isAppRouterPage(relativePath: string): boolean {
  return /(^|\/)app\/(.*\/)?page\.(tsx|jsx)$/i.test(relativePath);
}

/**
 * URL a Next App Router file serves, derived from its directory — the router
 * IS the file tree there, so unlike React Router there is no config to read
 * and the path exists nowhere else. Route groups `(marketing)` are organisational
 * and do not appear in the URL; `[id]` and `[...slug]` become `:id` / `:slug`.
 *
 *   web/app/page.tsx                        -> /
 *   web/app/app/flows/[flowId]/page.tsx     -> /app/flows/:flowId
 *   src/app/(marketing)/about/page.tsx      -> /about
 */
function appRouterPath(relativePath: string): string | null {
  const parts = relativePath.split('/');
  const appIdx = parts.indexOf('app');
  if (appIdx < 0) return null;
  const segments = parts
    .slice(appIdx + 1, -1)
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => (s.startsWith('[') && s.endsWith(']') ? `:${s.slice(1, -1).replace(/^\.{3}/, '')}` : s));
  return `/${segments.join('/')}`.replace(/\/{2,}/g, '/');
}

/**
 * The page component in a page file: its default export, which is the
 * convention in every file-based router. Falls back to an exported PascalCase
 * component for the `function Profile() {}; export { Profile }` style.
 *
 * Returns at most ONE symbol. The previous `.slice(0, 2)` emitted two
 * entrypoints whenever a page file also exported a helper component, which
 * double-counted pages in the workflow list.
 */
function pageComponentOf(fa: FileAnalysis): SymbolInfo | undefined {
  const componentish = fa.symbols.filter(
    (s) => s.exported && (s.kind === 'function' || s.kind === 'arrow-function'),
  );
  return componentish.find((s) => s.isDefault) ?? componentish.find((s) => /^[A-Z]/.test(s.name));
}

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

/**
 * Component name -> declared route path, gathered from every router config in
 * the repo. A name claimed by two different paths is dropped rather than
 * guessed at: a wrong path is worse than no path.
 */
function buildDeclaredUiRoutes(fileAnalyses: FileAnalysis[]): Map<string, string> {
  const claims = new Map<string, Set<string>>();
  for (const fa of fileAnalyses) {
    if (isTestOrFixturePath(normalizePath(fa.relativePath))) continue;
    for (const decl of fa.uiRouteDeclarations ?? []) {
      if (!decl.componentName) continue;
      const seen = claims.get(decl.componentName);
      if (seen) seen.add(decl.routePath);
      else claims.set(decl.componentName, new Set([decl.routePath]));
    }
  }
  const resolved = new Map<string, string>();
  for (const [name, paths] of claims) {
    if (paths.size === 1) resolved.set(name, [...paths][0]!);
  }
  return resolved;
}

export function detectEntrypoints(fileAnalyses: FileAnalysis[]): DetectedEntrypoint[] {
  const entrypoints: DetectedEntrypoint[] = [];
  const mountPrefixes = buildMountPrefixes(fileAnalyses);
  // A router config names its pages explicitly — that beats the directory
  // convention both for the path and for finding pages the convention misses.
  const declaredUiRoutes = buildDeclaredUiRoutes(fileAnalyses);

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
    // JSX files are excluded: `routes/` is also where Remix and SvelteKit put
    // page components, and calling those HTTP handlers put phantom endpoints
    // in the workflow list for every frontend route.
    if (
      !foundEntrypoint &&
      !JSX_EXT.test(relativePath) &&
      (relativePath.match(/routes?\//i) || relativePath.match(/controller/i))
    ) {
      entrypoints.push({
        nodeStableKey: relativePath,
        kind: 'http_route',
        filePath: relativePath,
      });
      foundEntrypoint = true;
    }

    // UI pages: the page component of a routable page file, OR any exported
    // component this repo's router config names — the config is authoritative,
    // so a page under `src/features/billing/` counts just as much as one under
    // `pages/`.
    {
      const page = pageComponentOf(fa);
      const declaredHere = fa.symbols.find(
        (s) => s.exported && declaredUiRoutes.has(s.name) && (s.kind === 'function' || s.kind === 'arrow-function'),
      );
      const chosen = isPageFile(relativePath) ? (page ?? declaredHere) : declaredHere;
      if (chosen) {
        // A router config is authoritative where one exists; App Router encodes
        // the path in the directory instead, and nothing else records it.
        const declaredPath =
          declaredUiRoutes.get(chosen.name) ??
          (isAppRouterPage(relativePath) ? appRouterPath(relativePath) : null) ??
          undefined;
        entrypoints.push({
          nodeStableKey: relativePath,
          kind: 'ui_route',
          filePath: relativePath,
          symbolName: chosen.name,
          symbolStableKey: symbolKey(relativePath, chosen.name),
          ...(declaredPath ? { routePattern: declaredPath } : {}),
        });
        foundEntrypoint = true;
      }
    }

    // Socket.IO events. For a realtime app these are the interaction surface —
    // Skribbl has eleven of them and one HTTP route (a health check), so
    // detecting only HTTP made the entire product look inert.
    for (const handler of fa.socketHandlers ?? []) {
      const handlerPath = handler.handlerRelativePath ?? relativePath;
      entrypoints.push({
        nodeStableKey: relativePath,
        kind: 'event_handler',
        // `socket:` distinguishes these from queue/job handlers in the UI
        // without needing a new DB enum value.
        routePattern: `socket:${handler.event}`,
        filePath: relativePath,
        ...(handler.handlerSymbolName
          ? {
              symbolName: handler.handlerSymbolName,
              symbolStableKey: symbolKey(handlerPath, handler.handlerSymbolName, handler.handlerParentName),
            }
          : {}),
      });
      foundEntrypoint = true;
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
    // path-like is a worker_threads script, not a queue. When the second
    // argument is a bare identifier (`new Worker(Q, processJob)`), the
    // referenced function is the real seed: the const holding the Worker
    // has no outgoing call edges, so seeding it traced one step and the
    // whole consumer workflow was dropped (the SUMMARY-consumer gap,
    // doc/DETECTION_COVERAGE.md §1).
    const seenQueues = new Set<string>();
    for (const sym of fa.symbols) {
      const src = `${sym.initializer ?? ''} ${sym.snippet ?? ''}`;
      if (!src.includes('new Worker')) continue;
      for (const m of src.matchAll(
        /new\s+Worker\s*(?:<[^>]*>)?\s*\(\s*(?:['"`]([\w:.-]+)['"`]|([A-Z_][A-Z0-9_]*))\s*,\s*([A-Za-z_$][\w$]*)?/g,
      )) {
        const queueName = m[1] ?? m[2]!;
        if (queueName.includes('/') || seenQueues.has(queueName)) continue;
        seenQueues.add(queueName);
        const handlerName = m[3] && m[3] !== 'async' && m[3] !== 'function'
          ? m[3] : undefined;
        const handlerSym = handlerName
          ? fa.symbols.find((s) => s.name === handlerName)
          : undefined;
        entrypoints.push({
          nodeStableKey: relativePath,
          kind: 'message_consumer',
          routePattern: queueName,
          filePath: relativePath,
          symbolName: handlerSym?.name ?? sym.name,
          symbolStableKey: symbolKey(relativePath, handlerSym?.name ?? sym.name),
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

/**
 * Returns each persisted entrypoint's row id (workflows reference it).
 * One multi-VALUES INSERT — the per-row loop cost a round trip per
 * entrypoint against the remote pooler (latency overhaul Track C).
 */
export async function persistEntrypoints(
  snapshotId: string,
  entrypoints: DetectedEntrypoint[],
  nodeIdMap: Map<string, string>,
): Promise<Map<DetectedEntrypoint, string>> {
  const idMap = new Map<DetectedEntrypoint, string>();
  const persistable = entrypoints
    .map((ep) => ({
      ep,
      nodeId:
        (ep.symbolStableKey ? nodeIdMap.get(ep.symbolStableKey) : undefined) ??
        nodeIdMap.get(ep.nodeStableKey),
    }))
    .filter((e): e is { ep: DetectedEntrypoint; nodeId: string } => e.nodeId !== undefined);
  if (persistable.length === 0) return idMap;

  const CHUNK = 500;
  for (let i = 0; i < persistable.length; i += CHUNK) {
    const part = persistable.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = part.map(({ ep, nodeId }, j) => {
      values.push(snapshotId, nodeId, TRIGGER_TYPE_BY_KIND[ep.kind], ep.method ?? null,
        ep.routePattern ?? null, JSON.stringify({ symbolName: ep.symbolName }));
      const base = j * 6;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });
    const result = await query(
      `INSERT INTO entrypoints (snapshot_id, node_id, trigger_type, method, route_path, metadata)
       VALUES ${tuples.join(', ')}
       RETURNING id`,
      values,
    );
    const rows = result.rows as Array<{ id: string }>;
    if (rows.length !== part.length) {
      throw new Error(`persistEntrypoints: inserted ${rows.length} rows for ${part.length} entrypoints`);
    }
    rows.forEach((row, j) => idMap.set(part[j]!.ep, row.id));
  }
  return idMap;
}
