import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester.js';
import { createProgram, parseSourceFile } from '../astParser.js';
import { extractFileAnalysis } from '../symbolExtractor.js';
import { buildMountPrefixes, detectEntrypoints, joinRoutePaths } from '../entrypointDetector.js';
import type { FileAnalysis } from '../../types/analysis.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/mounts');

describe('router mount resolution', () => {
  let fileAnalyses: FileAnalysis[];

  before(async function () {
    this.timeout(30000); // real ts.Program construction
    const index = await buildRepoIndex(FIXTURE_DIR);
    const tsFiles = filterByLanguage(index, 'typescript');
    const program = createProgram(tsFiles, FIXTURE_DIR);
    fileAnalyses = tsFiles.map((entry) =>
      extractFileAnalysis(parseSourceFile(program, entry.absolutePath), FIXTURE_DIR),
    );
  });

  it('extracts use() mounts with prefixes and resolved target files', () => {
    const appFa = fileAnalyses.find((fa) => fa.relativePath.endsWith('app.ts'))!;
    expect(appFa.routerMounts).to.deep.include({
      prefix: '/api',
      targetRelativePath: 'routes/index.ts',
      line: 4,
    });
    const indexFa = fileAnalyses.find((fa) => fa.relativePath.endsWith('routes/index.ts'))!;
    // Middleware args must not shadow the router: the LAST resolvable arg wins.
    expect(indexFa.routerMounts).to.deep.include({
      prefix: '/projects/:id/child',
      targetRelativePath: 'routes/child.ts',
      line: 5,
    });
  });

  it('chains mount prefixes across files', () => {
    const prefixes = buildMountPrefixes(fileAnalyses);
    expect(prefixes.get('routes/index.ts')).to.equal('/api');
    expect(prefixes.get('routes/child.ts')).to.equal('/api/projects/:id/child');
  });

  it('emits FULL route paths on http entrypoints — never a bare sub-router path', () => {
    const eps = detectEntrypoints(fileAnalyses).filter((e) => e.kind === 'http_route');
    const patterns = eps.map((e) => `${e.method} ${e.routePattern}`);
    expect(patterns).to.include('GET /api/projects/:id/child');
    expect(patterns).to.include('GET /api/projects/:id/child/:itemId');
    expect(patterns.some((p) => p === 'GET /')).to.equal(false);
  });
});

describe('entrypointDetector fixture/test exclusion', () => {
  const routeFa = (relativePath: string): FileAnalysis => ({
    filePath: `/repo/${relativePath}`,
    relativePath,
    symbols: [],
    imports: [],
    exports: [],
    routeRegistrations: [{ method: 'PUT', routePath: '/dataset/:id/:kind', line: 1 }],
    hasParseErrors: false,
    parseErrors: [],
  });

  it('never seeds entrypoints from fixture or test files (any branch)', () => {
    const eps = detectEntrypoints([
      routeFa('src/worker/fixtures/classServer/src/rest/Server.ts'),
      routeFa('test/api/thing.test.ts'),
      routeFa('src/pages/__tests__/Page.tsx'),
    ]);
    expect(eps).to.deep.equal([]);
  });

  it('still detects the same registration in product code', () => {
    const eps = detectEntrypoints([routeFa('src/rest/Server.ts')]);
    expect(eps).to.have.length(1);
    expect(eps[0]!.routePattern).to.equal('/dataset/:id/:kind');
  });
});

describe('joinRoutePaths', () => {
  it('joins prefixes and normalizes slashes', () => {
    expect(joinRoutePaths('/api', '/health')).to.equal('/api/health');
    expect(joinRoutePaths('/api/projects/:id/onboarding', '/')).to.equal('/api/projects/:id/onboarding');
    expect(joinRoutePaths('', '/')).to.equal('/');
    expect(joinRoutePaths('', '/x')).to.equal('/x');
  });
});
