import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileAnalysis, MethodInfo, SymbolInfo } from '../types/analysis.js';
import { symbolKey, normalizePath } from './stableKeys.js';
import { detectSideEffects } from './sideEffectDetector.js';
import { query } from '../../lib/db.js';
import { withStatementTimeoutRetry } from '../../lib/pgRetry.js';

export interface DetectedEntrypoint {
  /** File-level key (relative path) — used by workflow traversal. */
  nodeStableKey: string;
  kind: 'http_route' | 'ui_route' | 'ui_action' | 'cli_command' | 'event_handler' | 'cron_job' | 'message_consumer' | 'export';
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

/**
 * Action handlers a person triggers from the UI.
 *
 * A page is a place, not a thing you do. In an app whose server is a managed
 * backend — or which has no server at all — every user-meaningful action lives
 * in a callback inside a rendering file, and the only entry surface the
 * detector recognised was the page itself. The whole product therefore
 * appeared as a list of `Page: X` and nothing a user actually does was ever a
 * workflow, a capability, or a Critical-25 entry.
 *
 * The rule is structural, not conventional — nothing here names a framework, a
 * directory or a verb:
 *   1. the file renders UI (it has a JSX extension),
 *   2. the symbol is a function whose name is camelCase, i.e. it is NOT the
 *      PascalCase component and NOT a hook, so it can only be a callback the
 *      component wires to an interaction, and
 *   3. it reaches a recognised effect — its own, or one hop into a symbol that
 *      has one. Without an effect it is presentation, and presentation is not
 *      a workflow.
 *
 * Capped per file so a component with a dozen small callbacks contributes its
 * few most substantial ones rather than drowning the list.
 */
const MAX_UI_ACTIONS_PER_FILE = 4;
const HOOK_NAME = /^use[A-Z]/;

function detectUiActions(
  fa: FileAnalysis,
  relativePath: string,
  effectfulSymbolNames: Set<string>,
  ownEffects: Set<string>,
): DetectedEntrypoint[] {
  if (!JSX_EXT.test(relativePath)) return [];
  const found: DetectedEntrypoint[] = [];
  for (const sym of fa.symbols) {
    if (sym.kind !== 'function' && sym.kind !== 'arrow-function') continue;
    if (HOOK_NAME.test(sym.name)) continue;
    // A rendering unit that performs an effect IS the interaction: React and
    // its peers keep callbacks nested inside the component, so the component is
    // the outermost symbol the parser can see for a form submit or a delete
    // button. A camelCase sibling is admitted on one hop too, for the codebases
    // that hoist their handlers out.
    const reaches = ownEffects.has(sym.name)
      || (/^[a-z]/.test(sym.name)
          && (sym.callsSymbols ?? []).some((c) => effectfulSymbolNames.has(c.split('.').pop() ?? c)));
    if (!reaches) continue;
    found.push({
      nodeStableKey: relativePath,
      kind: 'ui_action',
      filePath: relativePath,
      symbolName: sym.name,
      symbolStableKey: symbolKey(relativePath, sym.name),
    });
    if (found.length >= MAX_UI_ACTIONS_PER_FILE) break;
  }
  return found;
}

// ─── Package manifest surface ────────────────────────────────────────────────
//
// Two archetypes declare their entry surface in the manifest rather than in the
// code: a library publishes it as `main`/`module`/`exports`, and a CLI as `bin`.
// Neither was ever read, so both were detected by directory convention alone —
// which is why a library reported one `index.ts` and a CLI reported one symbol
// per file. Nothing here names a framework: `main`, `exports` and `bin` are
// npm's own fields, and a `#!` line is the OS's own executable marker.

/** Repo-relative parsed paths a manifest publishes, plus its `bin` commands. */
interface ManifestSurface {
  /** Files named by `main` / `module` / `exports` — the package's public roots. */
  entryFiles: Set<string>;
  /** Repo-relative file -> the command names `bin` maps onto it. */
  binByFile: Map<string, string[]>;
}

/** Ancestor depth searched for a package.json — covers `packages/x/`, `apps/y/`. */
const MANIFEST_PROBE_DEPTH = 3;
/** Hard stop on manifest stat calls so a wide monorepo cannot turn into a scan. */
const MAX_MANIFEST_PROBES = 64;

/**
 * The repo root, recovered from any file's absolute path minus its relative
 * one. Reconstructing it here keeps the detector's signature unchanged and
 * keeps every caller — worker, truth-diff, tests — working without a new
 * argument to thread. Synthetic `FileAnalysis` objects have neither path and
 * simply yield null, which disables every disk-backed branch below.
 */
function repoRootOf(fileAnalyses: FileAnalysis[]): string | null {
  for (const fa of fileAnalyses) {
    const abs = fa.filePath;
    const rel = fa.relativePath;
    if (typeof abs !== 'string' || typeof rel !== 'string' || !rel || !abs.endsWith(rel)) continue;
    return abs.slice(0, abs.length - rel.length).replace(/[\\/]+$/, '');
  }
  return null;
}

/** Directories that could hold a package.json for the analysed files. */
function packageDirsOf(fileAnalyses: FileAnalysis[]): string[] {
  const dirs = new Set<string>(['']);
  for (const fa of fileAnalyses) {
    const parts = normalizePath(fa.relativePath ?? '').split('/');
    for (let d = 1; d < Math.min(parts.length, MANIFEST_PROBE_DEPTH + 1); d++) {
      dirs.add(parts.slice(0, d).join('/'));
      if (dirs.size >= MAX_MANIFEST_PROBES) return [...dirs];
    }
  }
  return [...dirs];
}

/** Every path-like string leaf of `main` / `module` / `exports`. */
function manifestEntrySpecifiers(pkg: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of ['main', 'module'] as const) {
    if (typeof pkg[field] === 'string') out.push(pkg[field] as string);
  }
  // `exports` is a tree: a string, a subpath map, or a condition map nested
  // arbitrarily ({".": {"import": {"types": "...", "default": "..."}}}).
  // Every string leaf that looks like a path is a published entry.
  const walk = (node: unknown, depth: number): void => {
    if (depth > 5) return;
    if (typeof node === 'string') { if (node.startsWith('.')) out.push(node); return; }
    if (Array.isArray(node)) { for (const v of node) walk(v, depth + 1); return; }
    if (node && typeof node === 'object') {
      for (const v of Object.values(node as Record<string, unknown>)) walk(v, depth + 1);
    }
  };
  walk(pkg.exports, 0);
  return out;
}

/** `bin` as command-name -> specifier pairs, for both the string and map forms. */
function manifestBinEntries(pkg: Record<string, unknown>): Array<[string, string]> {
  const bin = pkg.bin;
  if (typeof bin === 'string') {
    // `"bin": "./cli.js"` means "install me under my own package name".
    const name = typeof pkg.name === 'string' ? pkg.name.split('/').pop()! : 'cli';
    return [[name, bin]];
  }
  if (bin && typeof bin === 'object' && !Array.isArray(bin)) {
    return Object.entries(bin as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === 'string');
  }
  return [];
}

const SOURCE_EXT = /\.[cm]?[jt]sx?$/i;

/**
 * Maps a manifest specifier onto a file that was actually parsed.
 *
 * Manifests point at BUILT output (`dist/index.js`) while analysis sees source
 * (`src/index.ts`), so a literal lookup finds nothing on most real packages.
 * The structural relationship that survives the build is the path SUFFIX: the
 * build step rewrites the leading directory and the extension, not the rest.
 * So leading segments are dropped one at a time until a parsed file matches,
 * and the shallowest match wins — `dist/index.js` finds `src/index.ts` ahead of
 * `src/internal/index.ts`.
 */
function resolveManifestTarget(spec: string, pkgDir: string, parsedPaths: string[]): string | undefined {
  const segs = spec
    .replace(/^\.\/|^\//, '')
    .replace(/(\.d)?\.[cm]?[jt]sx?$/i, '')
    .split('/')
    .filter((s) => s && s !== '.');
  if (segs.length === 0) return undefined;
  const scope = pkgDir ? `${pkgDir}/` : '';
  const inScope = parsedPaths.filter((p) => p.startsWith(scope));
  for (let start = 0; start < segs.length; start++) {
    const suffix = segs.slice(start).join('/');
    const matches = inScope.filter((p) => {
      const extless = p.replace(SOURCE_EXT, '');
      return extless === suffix || extless.endsWith(`/${suffix}`)
        || extless === `${suffix}/index` || extless.endsWith(`/${suffix}/index`);
    });
    if (matches.length > 0) {
      return matches.sort((a, b) =>
        a.split('/').length - b.split('/').length || a.length - b.length || a.localeCompare(b))[0];
    }
  }
  return undefined;
}

function readManifestSurface(fileAnalyses: FileAnalysis[], root: string | null): ManifestSurface {
  const surface: ManifestSurface = { entryFiles: new Set(), binByFile: new Map() };
  if (!root) return surface;
  const parsedPaths = fileAnalyses.map((fa) => normalizePath(fa.relativePath ?? ''));
  for (const dir of packageDirsOf(fileAnalyses)) {
    let pkg: Record<string, unknown>;
    try {
      const raw = fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') continue;
      pkg = parsed as Record<string, unknown>;
    } catch {
      continue; // no manifest here, or an unreadable one — neither is an error
    }
    for (const spec of manifestEntrySpecifiers(pkg)) {
      const hit = resolveManifestTarget(spec, dir, parsedPaths);
      if (hit) surface.entryFiles.add(hit);
    }
    for (const [name, spec] of manifestBinEntries(pkg)) {
      const hit = resolveManifestTarget(spec, dir, parsedPaths);
      if (!hit) continue;
      const existing = surface.binByFile.get(hit);
      if (existing) { if (!existing.includes(name)) existing.push(name); }
      else surface.binByFile.set(hit, [name]);
    }
  }
  return surface;
}

/**
 * `#!` in the first two bytes — the OS's own "this file is executed, not
 * imported" marker, and the one CLI signal that needs no manifest and no
 * directory convention. Two bytes per file, so this stays negligible beside
 * the TypeScript program the same pass already built.
 */
function hasShebang(absPath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(2);
    return fs.readSync(fd, buf, 0, 2, 0) === 2 && buf[0] === 0x23 && buf[1] === 0x21;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already gone */ } }
  }
}

// ─── DOM / event-listener surfaces ───────────────────────────────────────────
//
// `addEventListener` is the platform's registration call, not a library's. A
// file that registers one has an interaction surface, and it is an EVENT one:
// kuankongy.github.io's `InputController` shipped its two keyboard handlers as
// `HTTP InputController.onKeyDown` / `HTTP …clearRepeat`, because the only
// branch that would claim the file was the routes/controllers path guess.
// Detecting the listener does both halves of the fix — it types the handler
// correctly AND marks the file as claimed, so the HTTP guess can never see it.

/** Prefix on a DOM listener's `routePattern`, beside the existing `socket:`. */
const DOM_EVENT_PREFIX = 'dom:';

/** A platform event registered on this file's own DOM/EventTarget objects. */
function isDomEvent(ep: DetectedEntrypoint): boolean {
  return ep.kind === 'event_handler' && (ep.routePattern?.startsWith(DOM_EVENT_PREFIX) ?? false);
}

/** `<target>.addEventListener('<event>', <handler>)`, handler optional/inline. */
const DOM_LISTENER = /\.addEventListener\s*\(\s*['"`]([\w:.-]+)['"`]\s*,\s*(?:(this|[A-Za-z_$][\w$]*)\.)?([A-Za-z_$][\w$]*)?/g;
/**
 * A member whose entire body forwards to another member of the same class:
 * `boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);`. Anchored at the
 * end so only a one-expression forwarder matches — a real body that happens to
 * end in a `this.x()` call has statements between the arrow and that call.
 */
const MEMBER_FORWARDER = /=>\s*\{?\s*(?:return\s+)?this\.([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*;?\s*\}?\s*;?\s*$/;
/** An inventory of a file's listeners, not a transcript of every one. */
const MAX_DOM_LISTENERS_PER_FILE = 6;

/**
 * The symbol a `this.x` handler reference really runs. Class members are
 * commonly bound through a thin arrow property (`boundKeyDown = (e) =>
 * this.onKeyDown(e)`) purely to fix `this`; naming the forwarder instead of the
 * method it forwards to would make every such workflow start one hop short of
 * the code a reader wants.
 */
function resolveMemberHandler(cls: SymbolInfo, memberName: string): MethodInfo | undefined {
  const member = cls.methods?.find((m) => m.name === memberName);
  if (!member) return undefined;
  const forwarded = MEMBER_FORWARDER.exec(member.snippet ?? member.signature ?? '')?.[1];
  return (forwarded && cls.methods?.find((m) => m.name === forwarded)) || member;
}

function detectDomListeners(fa: FileAnalysis, relativePath: string): DetectedEntrypoint[] {
  const found: DetectedEntrypoint[] = [];
  // One entry per event per file. Snippets nest — a class's snippet contains
  // its constructor's — so the same registration is seen more than once, and a
  // file that binds `keydown` twice is still one keyboard surface.
  const seen = new Set<string>();
  for (const sym of fa.symbols) {
    const src = `${sym.initializer ?? ''}\n${sym.snippet ?? ''}`;
    if (!src.includes('addEventListener')) continue;
    for (const m of src.matchAll(DOM_LISTENER)) {
      const event = m[1]!;
      if (seen.has(event)) continue;
      seen.add(event);
      const receiver = m[2];
      const handlerName = m[3];
      // `this.x` resolves against the class the registration sits in; a bare
      // identifier against the file's own top-level symbols. Anything else
      // (an inline closure, an imported handler) leaves the file as the seed.
      const handler = receiver === 'this' && sym.kind === 'class' && handlerName
        ? resolveMemberHandler(sym, handlerName)
        : undefined;
      const topLevel = !receiver && handlerName
        ? fa.symbols.find((s) => s.name === handlerName)
        : undefined;
      found.push({
        nodeStableKey: relativePath,
        kind: 'event_handler',
        // `dom:` reads beside the existing `socket:` prefix and keeps the two
        // event families apart without a new enum value.
        routePattern: `${DOM_EVENT_PREFIX}${event}`,
        filePath: relativePath,
        ...(handler
          ? { symbolName: `${sym.name}.${handler.name}`, symbolStableKey: symbolKey(relativePath, handler.name, sym.name) }
          : topLevel
            ? { symbolName: topLevel.name, symbolStableKey: symbolKey(relativePath, topLevel.name) }
            : {}),
      });
      if (found.length >= MAX_DOM_LISTENERS_PER_FILE) return found;
    }
  }
  return found;
}

// ─── CLI commands ────────────────────────────────────────────────────────────
//
// A CLI's unit of work is a COMMAND, not a file. The old rule took the first
// exported symbol of anything under `cli|bin|commands/`, so a tool with one
// entry file and fifteen subcommands reported exactly one entrypoint and a
// tool with no such directory reported none at all.

/** Directory convention, kept as a third signal beside `bin` and `#!`. */
const CLI_DIR_RE = /(^|\/)(cli|bin|commands?)\//i;
/**
 * `<builder>.command('build …')` — the registration shape shared by every CLI
 * builder because it is named after the thing itself. The captured literal may
 * carry an argument spec (`'add <file>'`); the first token is the name.
 */
const COMMAND_REGISTRATION = /\.command\s*\(\s*['"`]([^'"`]+)['"`]/g;
/** `.action(handler)` following a registration — the function that command runs. */
const COMMAND_ACTION = /\.action\s*\(\s*(?:async\s+)?(?:function\s+)?([A-Za-z_$][\w$]*)\s*\)/;
/** Chars scanned after a registration for its `.action`, across a fluent chain. */
const ACTION_LOOKAHEAD = 600;
/** Cap per entry file — an inventory of commands, not of every export. */
const MAX_CLI_COMMANDS_PER_FILE = 12;
/** Files above this are generated bundles; their text is not worth reading. */
const MAX_CLI_SOURCE_BYTES = 400_000;

/**
 * The CLI entry file's own text. Command registrations are top-level statements
 * that belong to no symbol, so per-symbol snippets can miss them entirely; this
 * is read for the handful of files already identified as CLI entries, never for
 * the repo at large. Falls back to snippets when there is no file to read
 * (synthetic analyses in tests).
 */
function cliSourceText(fa: FileAnalysis): string {
  try {
    if (typeof fa.filePath === 'string' && fa.filePath && fs.statSync(fa.filePath).size <= MAX_CLI_SOURCE_BYTES) {
      return fs.readFileSync(fa.filePath, 'utf8');
    }
  } catch { /* unreadable — snippets below are still evidence */ }
  return fa.symbols.map((s) => `${s.initializer ?? ''}\n${s.snippet ?? ''}`).join('\n');
}

function isCallable(sym: SymbolInfo): boolean {
  return sym.kind === 'function' || sym.kind === 'arrow-function' || sym.kind === 'class';
}

/**
 * The declaration a `.action(x)` reference points at. A CLI entry script
 * almost always IMPORTS its handlers — `commands/build.ts` holds the work and
 * the entry file only wires it up — so resolving locally alone leaves every
 * command sharing the entry file as its seed, and five commands then trace one
 * identical flow.
 */
function resolveCommandHandler(
  fa: FileAnalysis,
  relativePath: string,
  name: string,
  byPath: Map<string, FileAnalysis>,
): { filePath: string; symbolName: string } | undefined {
  const local = fa.symbols.find((s) => s.name === name);
  if (local) return { filePath: relativePath, symbolName: local.name };
  for (const imp of fa.imports ?? []) {
    const named = imp.namedImports?.find((n) => (n.alias ?? n.name) === name);
    const isDefault = imp.defaultImport === name;
    if (!named && !isDefault) continue;
    const target = resolveRelativeModule(imp.toSpecifier, relativePath, byPath);
    if (!target) return undefined;
    if (!isDefault) return { filePath: target, symbolName: named!.name };
    const declared = byPath.get(target)?.symbols.find((s) => s.isDefault);
    return declared ? { filePath: target, symbolName: declared.name } : undefined;
  }
  return undefined;
}

function detectCliCommands(
  fa: FileAnalysis,
  relativePath: string,
  binNames: string[] | undefined,
  byPath: Map<string, FileAnalysis>,
  declaresCommands: boolean,
): DetectedEntrypoint[] {
  const found: DetectedEntrypoint[] = [];
  const source = cliSourceText(fa);
  const seen = new Set<string>();

  // 1. Registered subcommands: one entrypoint each, seeded with the function
  //    the registration hands the runner where it names one.
  for (const m of source.matchAll(COMMAND_REGISTRATION)) {
    const name = m[1]!.trim().split(/\s+/)[0]!;
    if (!name || name.startsWith('<') || name.startsWith('[') || seen.has(name)) continue;
    seen.add(name);
    const after = source.slice(m.index + m[0].length, m.index + m[0].length + ACTION_LOOKAHEAD);
    const actionName = COMMAND_ACTION.exec(after)?.[1];
    const handler = actionName ? resolveCommandHandler(fa, relativePath, actionName, byPath) : undefined;
    found.push({
      nodeStableKey: relativePath,
      kind: 'cli_command',
      routePattern: name,
      filePath: relativePath,
      ...(handler
        ? { symbolName: handler.symbolName, symbolStableKey: symbolKey(handler.filePath, handler.symbolName) }
        : {}),
    });
    if (found.length >= MAX_CLI_COMMANDS_PER_FILE) break;
  }
  if (found.length > 0) return found;

  // 2. No registrations, but the manifest or the directory says this file's
  //    exports ARE commands — the `commands/<verb>.ts` shape, where the old
  //    "first exported symbol" rule dropped everything after the first and
  //    could pick a type alias. A file known only by its `#!` is excluded:
  //    being executable does not make each of its exports a subcommand, and
  //    treating a shebanged helper that way turned p-limit's benchmark script
  //    into four commands.
  const callables = declaresCommands ? fa.symbols.filter((s) => s.exported && isCallable(s)) : [];
  if (callables.length > 0) {
    const ordered = [...callables].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    for (const [i, sym] of ordered.slice(0, MAX_CLI_COMMANDS_PER_FILE).entries()) {
      found.push({
        nodeStableKey: relativePath,
        kind: 'cli_command',
        // A `bin` name IS the command a user types; only the first exported
        // callable can claim it, the rest are named by their symbol.
        ...(i === 0 && binNames?.[0] ? { routePattern: binNames[0] } : {}),
        filePath: relativePath,
        symbolName: sym.name,
        symbolStableKey: symbolKey(relativePath, sym.name),
      });
    }
    return found;
  }

  // 3. A script that exports nothing and just runs. It is still a command —
  //    the one the manifest installs, or the file itself.
  for (const name of binNames ?? [relativePath.split('/').pop()!.replace(SOURCE_EXT, '')]) {
    found.push({ nodeStableKey: relativePath, kind: 'cli_command', routePattern: name, filePath: relativePath });
  }
  return found;
}

// ─── Public API (library archetype) ──────────────────────────────────────────
//
// For a library the public API IS the workflow set: there is no route to call
// and no page to open, so the exported surface is the entire thing a newcomer
// can act on. Detection used to stop at "`index.ts` exists, emit one `export`
// entrypoint", which workflow traversal then fanned out to three arbitrary
// seeds — a 40-export package reported three flows, all of them guesses.
//
// The set is resolved from the manifest's entry files THROUGH re-export
// barrels, so what lands here is what a consumer can actually import, not every
// `export` in the repo (an internal helper exported for a sibling module is not
// public API and must not become a workflow).

/** Cap on the published surface. An inventory of the API, not of the repo. */
const MAX_PUBLIC_API_ENTRYPOINTS = 40;
/** Barrel chains are shallow in practice; this stops a cyclic one. */
const MAX_BARREL_DEPTH = 6;
/**
 * Entry kinds that mean this repo is run rather than imported.
 *
 * `cli_command` is deliberately absent: almost every published package ships an
 * executable `scripts/` helper, and letting one disqualify the whole archetype
 * cost p-limit — a five-file library — its entire public API. What makes a repo
 * a command-line tool is the manifest declaring `bin`, which the gate checks
 * separately.
 *
 * `event_handler` counts only for socket and queue events, which ARE a server's
 * entry surface. A DOM listener is not: `ky` registers one `abort` listener
 * inside a delay utility, and that alone was enough to hide all thirteen of its
 * published symbols. Same principle as the page-inventory gate below — a
 * listener is an interaction inside something, never a published entry.
 */
const APPLICATION_KINDS = new Set<DetectedEntrypoint['kind']>([
  'http_route', 'ui_route', 'ui_action', 'event_handler', 'cron_job', 'message_consumer',
]);

interface PublicSymbol {
  filePath: string;
  sym: SymbolInfo;
  /** Reached through a barrel re-export rather than declared in the entry file. */
  reExported: boolean;
}

/** `./x` relative to `from`, resolved against the files that were parsed. */
function resolveRelativeModule(spec: string, from: string, byPath: Map<string, FileAnalysis>): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)).replace(/^\.\//, '');
  const bare = base.replace(SOURCE_EXT, '');
  for (const candidate of [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
    .flatMap((ext) => [`${bare}${ext}`, `${bare}/index${ext}`])]) {
    if (byPath.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Every symbol an importer of `entryFiles` can reach, following `export * from`
 * and `export { x } from` to the file that declares each one. Named re-exports
 * are followed BY NAME so a barrel chain contributes only the names it actually
 * forwards, not the whole of every file it touches.
 */
function collectPublicApi(entryFiles: Iterable<string>, byPath: Map<string, FileAnalysis>): PublicSymbol[] {
  const out: PublicSymbol[] = [];
  const claimed = new Set<string>();

  const record = (filePath: string, sym: SymbolInfo, reExported: boolean): void => {
    const key = symbolKey(filePath, sym.name);
    if (claimed.has(key)) return;
    claimed.add(key);
    out.push({ filePath, sym, reExported });
  };

  /** One named export, chased through however many barrels forward it. */
  const findNamed = (filePath: string, localName: string, depth: number): boolean => {
    const fa = byPath.get(filePath);
    if (!fa || depth > MAX_BARREL_DEPTH) return false;
    const direct = (fa.symbols ?? []).find((s) =>
      s.name === localName || (localName === 'default' && s.isDefault));
    if (direct) { record(filePath, direct, depth > 0); return true; }
    for (const exp of fa.exports ?? []) {
      if (!exp.isReExport || !exp.sourceSpecifier) continue;
      const target = resolveRelativeModule(exp.sourceSpecifier, filePath, byPath);
      if (!target) continue;
      const idx = exp.namedExports.indexOf(localName);
      if (idx >= 0) { if (findNamed(target, exp.localBindings?.[idx] ?? localName, depth + 1)) return true; }
      else if (exp.namedExports.length === 0 && findNamed(target, localName, depth + 1)) return true;
    }
    return false;
  };

  const visited = new Set<string>();
  const visit = (filePath: string, depth: number): void => {
    if (visited.has(filePath) || depth > MAX_BARREL_DEPTH) return;
    visited.add(filePath);
    const fa = byPath.get(filePath);
    if (!fa) return;
    for (const sym of fa.symbols ?? []) if (sym.exported) record(filePath, sym, depth > 0);
    for (const exp of fa.exports ?? []) {
      if (!exp.isReExport || !exp.sourceSpecifier) continue;
      const target = resolveRelativeModule(exp.sourceSpecifier, filePath, byPath);
      if (!target) continue;
      if (exp.namedExports.length === 0) visit(target, depth + 1);      // export * from
      else exp.namedExports.forEach((name, i) => findNamed(target, exp.localBindings?.[i] ?? name, depth + 1));
    }
  };

  for (const entry of entryFiles) visit(entry, 0);
  return out;
}

/**
 * Rank within the published surface. A library's headline API is the thing you
 * call: callables outrank values, the default export outranks its siblings, a
 * symbol that takes arguments and delegates outranks a constant, and a name a
 * barrel deliberately forwards outranks one that is merely `export`ed. Pure
 * type declarations are dropped — they are public API but they are not
 * behaviour, and a workflow traced from an `interface` has nothing in it.
 */
function publicApiScore(p: PublicSymbol): number {
  const s = p.sym;
  let score = s.kind === 'class' ? 4 : isCallable(s) ? 3 : 1;
  if (s.isDefault) score += 2;
  if ((s.parameters?.length ?? 0) > 0) score += 1;
  score += Math.min(2, Math.floor((s.callsSymbols?.length ?? 0) / 3));
  score += Math.min(2, Math.floor((s.methods?.length ?? 0) / 4));
  if (p.reExported) score += 1;
  return score;
}

const TYPE_ONLY_KINDS = new Set<SymbolInfo['kind']>(['interface', 'type']);

function detectPublicApi(
  byPath: Map<string, FileAnalysis>,
  entryFiles: Set<string>,
): DetectedEntrypoint[] {
  const ranked = collectPublicApi(entryFiles, byPath)
    .filter((p) => !isTestOrFixturePath(p.filePath) && !TYPE_ONLY_KINDS.has(p.sym.kind))
    .sort((a, b) =>
      publicApiScore(b) - publicApiScore(a)
      || a.filePath.localeCompare(b.filePath)
      || a.sym.name.localeCompare(b.sym.name))
    .slice(0, MAX_PUBLIC_API_ENTRYPOINTS);
  return ranked.map((p) => ({
    nodeStableKey: p.filePath,
    kind: 'export' as const,
    filePath: p.filePath,
    symbolName: p.sym.name,
    symbolStableKey: symbolKey(p.filePath, p.sym.name),
  }));
}

export function detectEntrypoints(fileAnalyses: FileAnalysis[]): DetectedEntrypoint[] {
  const entrypoints: DetectedEntrypoint[] = [];
  const mountPrefixes = buildMountPrefixes(fileAnalyses);
  // Manifest-declared surfaces (`main`/`module`/`exports`, `bin`) and `#!`
  // scripts. Both are read once, before the per-file loop that consumes them.
  const repoRoot = repoRootOf(fileAnalyses);
  const manifest = readManifestSurface(fileAnalyses, repoRoot);
  const analysesByPath = new Map(fileAnalyses.map((fa) => [normalizePath(fa.relativePath ?? ''), fa]));
  // Which symbols actually do something, by bare name — the one-hop reachability
  // check for UI actions. Detection is regex-only, so this second pass is cheap.
  const detected = detectSideEffects(fileAnalyses);
  const effectfulSymbolNames = new Set<string>();
  const effectfulByFile = new Map<string, Set<string>>();
  for (const eff of detected) {
    // `unknown_external` is the honesty fallback for any unrecognised package —
    // counting it would make every component that imports a UI library look
    // like it performs work.
    if (eff.kind === 'unknown_external' || !eff.symbolName) continue;
    effectfulSymbolNames.add(eff.symbolName);
    const perFile = effectfulByFile.get(eff.filePath);
    if (perFile) perFile.add(eff.symbolName);
    else effectfulByFile.set(eff.filePath, new Set([eff.symbolName]));
  }
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

    // DOM/platform event listeners. Registered BEFORE the path guess below so
    // that a file which demonstrably listens for events can never be reported
    // as an endpoint: `addEventListener` is direct evidence of the trigger
    // kind, and a directory name is not evidence of anything.
    const domListeners = detectDomListeners(fa, relativePath);
    for (const listener of domListeners) {
      entrypoints.push(listener);
      foundEntrypoint = true;
    }

    // Routes/controllers by convention only when nothing was AST-detected.
    // (Test/fixture paths were already skipped at the top of the loop.)
    // JSX files are excluded: `routes/` is also where Remix and SvelteKit put
    // page components, and calling those HTTP handlers put phantom endpoints
    // in the workflow list for every frontend route.
    // `/controller/i` matched any path CONTAINING the word, so
    // `src/game/InputController.ts` — a keyboard handler — shipped as an HTTP
    // route and its keypress workflows were titled "HTTP …". Both halves are
    // now directory segments, which is what the convention actually is; a file
    // merely named after a controller is not an endpoint.
    if (
      !foundEntrypoint &&
      !JSX_EXT.test(relativePath) &&
      /(^|\/)(routes?|controllers?)\//i.test(relativePath)
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

    // UI action handlers — the interaction surface of a client-side app.
    for (const action of detectUiActions(
      fa, relativePath, effectfulSymbolNames, effectfulByFile.get(relativePath) ?? new Set(),
    )) {
      entrypoints.push(action);
      foundEntrypoint = true;
    }

    // CLI entrypoints: a file the manifest installs as a `bin`, a file the OS
    // would execute (`#!`), or the directory convention — then one entrypoint
    // per COMMAND inside it rather than one per file.
    const binNames = manifest.binByFile.get(relativePath);
    // `bin` and `commands/` both assert that this file's exports are commands.
    // A `#!` only asserts that the file is executed.
    const declaresCommands = binNames !== undefined || CLI_DIR_RE.test(relativePath);
    if (
      declaresCommands ||
      (typeof fa.filePath === 'string' && fa.filePath !== '' && hasShebang(fa.filePath))
    ) {
      for (const command of detectCliCommands(fa, relativePath, binNames, analysesByPath, declaresCommands)) {
        entrypoints.push(command);
        foundEntrypoint = true;
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

  // One entrypoint per COMMAND, not per file. A handler that a registration
  // already named (`taskr build` -> commands/build.ts#runBuild) is picked up a
  // second time by the `commands/` directory convention; the named one wins
  // because it carries the string the user actually types.
  const namedCliHandlers = new Set(
    entrypoints
      .filter((e) => e.kind === 'cli_command' && e.routePattern && e.symbolStableKey)
      .map((e) => e.symbolStableKey!),
  );
  for (let i = entrypoints.length - 1; i >= 0; i--) {
    const e = entrypoints[i]!;
    if (e.kind === 'cli_command' && !e.routePattern && e.symbolStableKey && namedCliHandlers.has(e.symbolStableKey)) {
      entrypoints.splice(i, 1);
    }
  }

  // Effect-free / router-less repos: a static site or a component library has
  // no route table, no server and no writes, so every branch above declines and
  // the product renders as a blank list. Its rendering units ARE its structure,
  // and an honest inventory of them beats nothing. Applied only when no real
  // entry surface was found anywhere — where one was, this would bury it.
  //
  // A DOM listener does not count as that entry surface. It is an interaction
  // WITHIN a rendering unit, not a place a person can be, so it cannot stand in
  // for the page inventory: when the listener detection above was allowed to
  // satisfy this gate, kuankongy.github.io went from 25 rendering units to 13
  // keyboard and pointer events and lost its entire component surface.
  const hasRealEntry = entrypoints.some((e) => e.kind !== 'export' && !isDomEvent(e));
  if (!hasRealEntry) {
    for (const fa of fileAnalyses) {
      const relativePath = normalizePath(fa.relativePath);
      if (!JSX_EXT.test(relativePath) || isTestOrFixturePath(relativePath)) continue;
      const unit = pageComponentOf(fa);
      if (!unit) continue;
      entrypoints.push({
        nodeStableKey: relativePath,
        kind: 'ui_route',
        filePath: relativePath,
        symbolName: unit.name,
        symbolStableKey: symbolKey(relativePath, unit.name),
      });
      if (entrypoints.length >= MAX_FALLBACK_UNITS) break;
    }
  }

  // Library archetype: nothing above claimed a route, a page, a CLI or an
  // event, so every entry this repo has is an export — it is imported, not run.
  // Its public API is therefore its whole entry surface, and the file-level
  // `export` guess above was standing in for up to forty published symbols.
  // Runs last so it can see what the other branches concluded, and declines the
  // moment any of them found an application surface.
  if (
    manifest.binByFile.size === 0 &&
    !entrypoints.some((e) => APPLICATION_KINDS.has(e.kind) && !isDomEvent(e))
  ) {
    // The manifest is authoritative about what is published; where there is
    // none in scope, the `index`/`main` files the loop already flagged are the
    // only entry claim available.
    const entryFiles = manifest.entryFiles.size > 0
      ? manifest.entryFiles
      : new Set(entrypoints.filter((e) => e.kind === 'export').map((e) => e.filePath));
    const publicApi = detectPublicApi(analysesByPath, entryFiles);
    if (publicApi.length > 0) {
      // The named surface supersedes the file-level guesses it was standing in
      // for. Leaving them would list each entry module twice AND keep the
      // symbol-less seed whose three-way fan-out is the under-report being
      // fixed — a barrel declares no symbols of its own, so its file entry can
      // only ever be traced by guesswork.
      const kept = entrypoints.filter((e) => !(e.kind === 'export' && !e.symbolName));
      return [...kept, ...publicApi];
    }
  }

  return entrypoints;
}

/** Cap for the router-less fallback above — an inventory, not an explosion. */
const MAX_FALLBACK_UNITS = 40;

// Maps detector kinds onto the entrypoints.trigger_type enum. Exported so a
// verification probe can report the persisted trigger types without re-deriving
// (and possibly disagreeing with) the mapping the writer actually uses.
export const TRIGGER_TYPE_BY_KIND: Record<DetectedEntrypoint['kind'], string> = {
  http_route: 'http_route',
  ui_route: 'ui_route',
  // A UI action is an interaction listener; the enum already has the concept.
  ui_action: 'event_listener',
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
    // No ON CONFLICT, but still safe to repeat: this runs in autocommit, and a
    // 57014 cancels the statement and rolls its implicit transaction back — so
    // nothing from the cancelled attempt survives to be duplicated. The caller
    // has already DELETEd this snapshot's entrypoints in the persist-results
    // transaction, so the retry re-inserts into the same empty set.
    const result = await withStatementTimeoutRetry('persistEntrypoints/insert', () => query(
      `INSERT INTO entrypoints (snapshot_id, node_id, trigger_type, method, route_path, metadata)
       VALUES ${tuples.join(', ')}
       RETURNING id`,
      values,
    ));
    const rows = result.rows as Array<{ id: string }>;
    if (rows.length !== part.length) {
      throw new Error(`persistEntrypoints: inserted ${rows.length} rows for ${part.length} entrypoints`);
    }
    rows.forEach((row, j) => idMap.set(part[j]!.ep, row.id));
  }
  return idMap;
}
