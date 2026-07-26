import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex } from '../../src/worker/engine/repoIngester';
import { typescriptParser } from '../../src/worker/engine/parserInterface';
import { createProgram, parseSourceFile } from '../../src/worker/engine/astParser';
import { extractFileAnalysis } from '../../src/worker/engine/symbolExtractor';
import { detectEntrypoints } from '../../src/worker/engine/entrypointDetector';
import type { FileAnalysis, SymbolInfo } from '../../src/worker/types/analysis';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/worker/fixtures/exportStyles');

/**
 * `isExported()` reads `ts.getModifiers()` only, so a symbol exported by a
 * separate statement stayed `exported: false`. Detectors gate on that flag,
 * which is why two projects with identical `src/pages/` layouts reported
 * opposite `ui_route` counts depending purely on which export style the
 * authors happened to use.
 */
describe('export reconciliation', () => {
  let fileAnalyses: FileAnalysis[];

  const uiRouteFiles = (): string[] =>
    detectEntrypoints(fileAnalyses)
      .filter((e) => e.kind === 'ui_route')
      .map((e) => normalize(e.filePath))
      .sort();

  const symbolIn = (file: string, name: string): SymbolInfo => {
    const fa = fileAnalyses.find((f) => f.relativePath.replace(/\\/g, '/').endsWith(file));
    expect(fa, `fixture file ${file} was not parsed`).to.not.equal(undefined);
    const sym = fa!.symbols.find((s) => s.name === name);
    expect(sym, `symbol ${name} not found in ${file}`).to.not.equal(undefined);
    return sym!;
  };

  before(async function () {
    // Building a real ts.Program loads lib.d.ts — routinely >2s cold.
    this.timeout(30000);
    const index = await buildRepoIndex(FIXTURE_DIR);
    // Mirrors analysisRunner.ts:61. `filterByLanguage(index, 'typescript')`
    // — which most other suites use — drops every .js/.jsx/.mjs/.cjs file,
    // because repoIngester's own TS_EXTENSIONS is `.ts`/`.tsx` only while the
    // parser's covers all six. Production uses the parser's, so a suite
    // filtering by language silently cannot see a JS regression.
    const tsFiles = index.files.filter((f) => typescriptParser.supports(f.absolutePath));
    const program = createProgram(tsFiles, FIXTURE_DIR);
    fileAnalyses = tsFiles.map((entry) =>
      extractFileAnalysis(parseSourceFile(program, entry.absolutePath), FIXTURE_DIR),
    );
  });

  it('marks `const X = …; export default X` as an exported default', () => {
    const index = symbolIn('pages/Index.tsx', 'Index');
    expect(index.exported).to.equal(true);
    expect(index.isDefault).to.equal(true);
  });

  it('still marks the inline-modifier style (regression guard)', () => {
    const dashboard = symbolIn('pages/Dashboard.tsx', 'Dashboard');
    expect(dashboard.exported).to.equal(true);
    expect(dashboard.isDefault).to.equal(true);
  });

  it('marks a symbol exported by a later `export { … }` clause', () => {
    expect(symbolIn('pages/Profile.tsx', 'Profile').exported).to.equal(true);
  });

  it('unwraps a single-argument HOC in a default export', () => {
    const settings = symbolIn('pages/Settings.tsx', 'Settings');
    expect(settings.exported).to.equal(true);
    expect(settings.isDefault).to.equal(true);
  });

  it('resolves the LOCAL name of an aliased export, and keeps the public name', () => {
    expect(symbolIn('lib/helpers.ts', 'loadSummaryImpl').exported).to.equal(true);

    const helpers = fileAnalyses.find((f) => f.relativePath.endsWith('helpers.ts'))!;
    const clause = helpers.exports.find((e) => e.namedExports.length > 0)!;
    expect(clause.namedExports).to.deep.equal(['loadSummary']);
    expect(clause.localBindings).to.deep.equal(['loadSummaryImpl']);
  });

  it('leaves an unexported helper private', () => {
    expect(symbolIn('lib/helpers.ts', 'internalOnly').exported).to.equal(false);
  });

  it('detects every page as a ui_route regardless of export style', () => {
    const files = uiRouteFiles();
    for (const page of [
      'src/pages/Dashboard.tsx',
      'src/pages/Index.tsx',
      'src/pages/Profile.tsx',
      'src/pages/Settings.tsx',
    ]) {
      expect(files, `${page} should be a ui_route`).to.include(page);
    }
  });

  it('emits exactly one ui_route per page file', () => {
    const files = uiRouteFiles();
    expect(files.length).to.equal(new Set(files).size);
  });

  it('does not promote a lib file to a ui_route', () => {
    expect(uiRouteFiles().some((f) => f.includes('/lib/'))).to.equal(false);
  });

  // ── framework layouts that were previously invisible ──────────────────────

  it('detects a Next App Router page and a Remix-style routes/ page', () => {
    const files = uiRouteFiles();
    expect(files).to.include('app/dashboard/page.tsx');
    expect(files).to.include('src/routes/billing.tsx');
  });

  it('does not treat a colocated app/ component as a route', () => {
    expect(uiRouteFiles()).to.not.include('app/dashboard/widget.tsx');
  });

  it('keeps server files out of the UI bucket even in shared directories', () => {
    // `app/**/route.ts` is a Next API handler and `routes/*.ts` is an Express
    // handler — both sit in directories that also hold pages.
    const files = uiRouteFiles();
    expect(files).to.not.include('app/api/health/route.ts');
    expect(files).to.not.include('src/routes/authRoutes.ts');
  });

  // ── router-config declarations ────────────────────────────────────────────

  it('extracts declared paths from a JSX router config, parent-joining nested routes', () => {
    const router = fileAnalyses.find((f) => f.relativePath.endsWith('router.tsx'))!;
    const declared = (router.uiRouteDeclarations ?? []).map((d) => d.routePath).sort();
    expect(declared).to.deep.equal(['/', '/app', '/app/settings', '/billing', '/profile/:userId']);
  });

  it('extracts an object-literal router config and joins its children', () => {
    const data = fileAnalyses.find((f) => f.relativePath.endsWith('dataRouter.ts'))!;
    const byPath = new Map((data.uiRouteDeclarations ?? []).map((d) => [d.routePath, d.componentName]));
    expect([...byPath.keys()].sort()).to.deep.equal(['/reports', '/reports/:reportId']);
    expect(byPath.get('/reports')).to.equal('Reports');
    expect(byPath.get('/reports/:reportId')).to.equal('ReportDetail');
  });

  it('does not read a config object with a path but no element as a route', () => {
    const data = fileAnalyses.find((f) => f.relativePath.endsWith('dataRouter.ts'))!;
    const paths = (data.uiRouteDeclarations ?? []).map((d) => d.routePath);
    expect(paths).to.not.include('/var/tmp/uploads');
  });

  it('gives ui_route entrypoints the path their router config declares', () => {
    const routes = detectEntrypoints(fileAnalyses).filter((e) => e.kind === 'ui_route');
    const profile = routes.find((e) => e.symbolName === 'Profile');
    expect(profile?.routePattern).to.equal('/profile/:userId');
  });

  it('finds a page named only by the router config, outside any page directory', () => {
    const routes = detectEntrypoints(fileAnalyses).filter((e) => e.kind === 'ui_route');
    const billing = routes.find((e) => normalize(e.filePath).includes('features/billing'));
    expect(billing, 'BillingScreen should be a ui_route via the router config').to.not.equal(undefined);
    expect(billing!.routePattern).to.equal('/billing');
  });

  // ── Socket.IO events ──────────────────────────────────────────────────────

  it('detects socket events registered inside the connection callback', () => {
    const socketFile = fileAnalyses.find((f) => f.relativePath.endsWith('socketServer.js'));
    expect(socketFile, 'the .js fixture must be parsed at all').to.not.equal(undefined);
    const events = (socketFile!.socketHandlers ?? []).map((h) => h.event).sort();
    expect(events).to.deep.equal(['chat-message', 'connection', 'create-room', 'disconnect']);
  });

  it('ignores EventEmitter and process listeners, inside the callback and out', () => {
    const socketFile = fileAnalyses.find((f) => f.relativePath.endsWith('socketServer.js'))!;
    const events = (socketFile.socketHandlers ?? []).map((h) => h.event);
    // `bus.on('room-updated')` sits INSIDE the connection callback and must
    // still be ignored — the receiver is not the socket parameter.
    for (const decoy of ['internal-tick', 'SIGTERM', 'room-updated']) {
      expect(events, `${decoy} must not be treated as a socket event`).to.not.include(decoy);
    }
  });

  it('synthesizes a traceable symbol for an inline socket handler', () => {
    // Workflow tracing seeds from a symbol with a body; without this the
    // events would be detected but every trace would dead-end immediately.
    const socketFile = fileAnalyses.find((f) => f.relativePath.endsWith('socketServer.js'))!;
    const created = socketFile.socketHandlers!.find((h) => h.event === 'create-room')!;
    expect(created.handlerSymbolName).to.equal('on create-room');
    const sym = socketFile.symbols.find((s) => s.name === 'on create-room');
    expect(sym, 'synthesized handler symbol').to.not.equal(undefined);
    expect(sym!.callsSymbols ?? []).to.include('saveRoom');
  });

  it('surfaces socket events as event_handler entrypoints with their event name', () => {
    const socket = detectEntrypoints(fileAnalyses)
      .filter((e) => e.kind === 'event_handler' && (e.routePattern ?? '').startsWith('socket:'));
    const patterns = socket.map((e) => e.routePattern).sort();
    expect(patterns).to.deep.equal([
      'socket:chat-message',
      'socket:connection',
      'socket:create-room',
      'socket:disconnect',
    ]);
  });

  it('still routes a non-JSX routes/ file to http_route, not ui_route', () => {
    const http = detectEntrypoints(fileAnalyses)
      .filter((e) => e.kind === 'http_route')
      .map((e) => normalize(e.filePath));
    expect(http).to.include('src/routes/authRoutes.ts');
    expect(http).to.not.include('src/routes/billing.tsx');
  });
});

const normalize = (p: string): string => p.replace(/\\/g, '/');
