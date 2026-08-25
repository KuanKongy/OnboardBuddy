import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester';
import { createProgram, parseSourceFile } from '../astParser';
import { extractFileAnalysis } from '../symbolExtractor';
import { detectEntrypoints } from '../entrypointDetector';
import type { FileAnalysis } from '../../types/analysis';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/simple');

async function analyzeFixture(dir: string): Promise<FileAnalysis[]> {
  const index = await buildRepoIndex(dir);
  const tsFiles = filterByLanguage(index, 'typescript');
  const program = createProgram(tsFiles, dir);
  return tsFiles.map((entry) => extractFileAnalysis(parseSourceFile(program, entry.absolutePath), dir));
}

let fileAnalyses: FileAnalysis[];

before(async () => {
  fileAnalyses = await analyzeFixture(FIXTURE_DIR);
});

describe('entrypointDetector', () => {
  it('detects index.ts as an export entrypoint', () => {
    const eps = detectEntrypoints(fileAnalyses);
    const indexEp = eps.find((e) => e.filePath === 'index.ts');
    expect(indexEp).to.exist;
    expect(indexEp!.kind).to.equal('export');
  });

  it('does not detect utility files as entrypoints', () => {
    const eps = detectEntrypoints(fileAnalyses);
    const jwtEp = eps.find((e) => e.filePath === path.join('utils', 'jwtUtil.ts'));
    expect(jwtEp).to.not.exist;
  });

  it('returns at least one entrypoint for the fixture', () => {
    const eps = detectEntrypoints(fileAnalyses);
    expect(eps.length).to.be.greaterThan(0);
  });

  it('each entrypoint has a valid kind', () => {
    const eps = detectEntrypoints(fileAnalyses);
    const validKinds = new Set(['http_route', 'cli_command', 'event_handler', 'cron_job', 'message_consumer', 'export']);
    for (const ep of eps) {
      expect(validKinds.has(ep.kind)).to.be.true;
    }
  });
});

/**
 * The two archetypes none of the 11 calibration repos covers. Anyone can
 * point the product at any repository, and until now a published library
 * reported one `index.ts` and a command-line tool reported one symbol per file.
 */
describe('entrypointDetector — library and CLI archetypes', () => {
  it('reports a library’s public API, resolved through the manifest and its barrel', async () => {
    // `main`/`module`/`exports` all point into ./dist, which does not exist in
    // a source tree; the barrel forwards thirteen values and deliberately
    // withholds `codec.ts#debugDump` and everything under `internal/`, so this
    // list is what a consumer can actually import — not every `export`.
    const eps = detectEntrypoints(await analyzeFixture(path.resolve(__dirname, '../../fixtures/pureLibrary')));
    expect(eps.map((e) => e.symbolStableKey).sort()).to.deep.equal([
      'src/core/codec.ts#parseEntry',
      'src/core/codec.ts#serializeEntry',
      'src/core/ledger.ts#EMPTY_BALANCE',
      'src/core/ledger.ts#Ledger',
      'src/core/ledger.ts#isBalanced',
      'src/core/ledger.ts#mergeLedgers',
      'src/core/ledger.ts#normalizePosting',
      'src/core/money.ts#ZERO',
      'src/core/money.ts#add',
      'src/core/money.ts#allocate',
      'src/core/money.ts#formatMoney',
      'src/core/money.ts#subtract',
      'src/factory.ts#createLedger',
    ]);
  });

  it('reports one entrypoint per CLI command, seeded with the handler it runs', async () => {
    // One `bin` file registering five subcommands. The commands/ directory
    // contributes no second copy of a handler a registration already named.
    const eps = detectEntrypoints(await analyzeFixture(path.resolve(__dirname, '../../fixtures/pureCli')));
    expect(eps.map((e) => `${e.routePattern} -> ${e.symbolStableKey}`)).to.deep.equal([
      'init -> src/commands/init.ts#runInit',
      'build -> src/commands/build.ts#runBuild',
      'watch -> src/commands/watch.ts#runWatch',
      'clean -> src/commands/clean.ts#runClean',
      'report -> src/report.ts#printReport',
    ]);
  });
});

describe('entrypointDetector — trigger types', () => {
  it('types a DOM handler as an event listener even inside controllers/', () => {
    // kuankongy.github.io shipped `HTTP InputController.onKeyDown`: a keyboard
    // handler classified as an endpoint because a path convention was the only
    // branch that claimed the file. Evidence of a listener now outranks it, and
    // the thin bound wrapper resolves to the method it forwards to.
    const fa = {
      relativePath: 'src/controllers/InputController.ts',
      symbols: [{
        name: 'InputController', kind: 'class', exported: true,
        snippet: 'export class InputController {\n  constructor() { window.addEventListener("keydown", this.boundKeyDown); }\n}',
        methods: [
          { name: 'boundKeyDown', snippet: 'private boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);' },
          { name: 'onKeyDown', snippet: 'private onKeyDown(e: KeyboardEvent) { this.queue.push(e); }' },
        ],
      }],
    } as unknown as FileAnalysis;
    expect(detectEntrypoints([fa]).map((e) => [e.kind, e.routePattern, e.symbolStableKey])).to.deep.equal([
      ['event_handler', 'dom:keydown', 'src/controllers/InputController.ts#InputController.onKeyDown'],
    ]);
  });
});

/**
 * A page is a claim about routing, and only the repo may make it.
 *
 * A router-less fallback used to sweep every JSX file holding an exported
 * PascalCase function and report it as `ui_route`. On a one-page club website
 * that produced 19 "pages" — `Page: MicroscopeIcon`, `Page: Sparkle`,
 * `Page: BlobLayer`, `Page: Footer` — and on a static portfolio site, 25.
 */
describe('entrypointDetector — a component is not a page (F4 over-fire)', () => {
  const component = (relativePath: string, name: string): FileAnalysis => ({
    relativePath,
    symbols: [{
      name, kind: 'function', exported: true, isDefault: true,
      snippet: `export default function ${name}() { return <div/>; }`,
    }],
  } as unknown as FileAnalysis);

  it('reports zero entrypoints for a router-less site of plain components', () => {
    const eps = detectEntrypoints([
      component('src/components/icons/index.tsx', 'MicroscopeIcon'),
      component('src/components/shared/Sparkle.tsx', 'Sparkle'),
      component('src/components/shared/BlobLayer.tsx', 'BlobLayer'),
      component('src/components/layout/Footer.tsx', 'Footer'),
      component('src/components/sections/About.tsx', 'About'),
    ]);
    // Zero is the honest answer for a static site: no router registers these,
    // no file-based router directory holds them, nothing else can be traced.
    expect(eps.filter((e) => e.kind === 'ui_route')).to.deep.equal([]);
  });

  it('still reports a page the repo itself declares, even with no resolved URL', () => {
    // `pages/` IS the repo saying "this is a page". MasterPokedex's
    // PokemonList.tsx lives there and no <Route> references it; the truth
    // fixture asserts it is a ui_route with a null path, so the tightening
    // must not reach it.
    const eps = detectEntrypoints([
      component('src/pages/PokemonList.tsx', 'PokemonList'),
      component('src/components/ui/Badge.tsx', 'Badge'),
    ]);
    expect(eps.filter((e) => e.kind === 'ui_route').map((e) => [e.filePath, e.routePattern ?? null]))
      .to.deep.equal([['src/pages/PokemonList.tsx', null]]);
  });

  it('does not expand an unpublished index.tsx barrel into a library API', () => {
    // With no `main`/`module`/`exports` in scope, the library archetype used to
    // fall back to whatever `index.*` file the loop flagged — which on the club
    // website was `src/components/icons/index.tsx`, so four SVG icons became
    // the product's entire entry surface.
    const barrel = {
      relativePath: 'src/components/icons/index.tsx',
      symbols: ['LeafIcon', 'TrophyIcon', 'PeopleIcon'].map((name) => ({
        name, kind: 'function', exported: true,
        snippet: `export function ${name}() { return <svg/>; }`,
      })),
    } as unknown as FileAnalysis;
    expect(detectEntrypoints([barrel]).map((e) => [e.kind, e.symbolName ?? null]))
      .to.deep.equal([['export', null]]);
  });
});

describe('entrypointDetector — BullMQ queue consumers (audit P2 §15)', () => {
  const synthetic = (initializer: string): FileAnalysis[] => [
    {
      relativePath: 'backend/src/worker/index.ts',
      symbols: [{ name: 'worker', kind: 'variable', exported: false, initializer, snippet: initializer }],
    } as unknown as FileAnalysis,
  ];

  it('detects `new Worker<T>(QUEUE_CONST, closure)` as a message_consumer', () => {
    const eps = detectEntrypoints(
      synthetic(`new Worker<AnalysisJobData>(ANALYSIS_QUEUE, async (job) => { await processAnalysisJob(job); })`),
    );
    const consumer = eps.find((e) => e.kind === 'message_consumer');
    expect(consumer, 'consumer entrypoint').to.exist;
    expect(consumer!.routePattern).to.equal('ANALYSIS_QUEUE');
    expect(consumer!.symbolStableKey).to.equal('backend/src/worker/index.ts#worker');
  });

  it('detects string-literal queue names and ignores worker_threads script paths', () => {
    const eps = detectEntrypoints(synthetic(`new Worker('analysis', handler)`));
    expect(eps.find((e) => e.kind === 'message_consumer')?.routePattern).to.equal('analysis');

    const threads = detectEntrypoints(synthetic(`new Worker('./scripts/crunch.js', { workerData })`));
    expect(threads.find((e) => e.kind === 'message_consumer')).to.not.exist;
  });
});
