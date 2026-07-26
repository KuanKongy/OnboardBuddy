import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester.js';
import { createProgram, parseSourceFile } from '../astParser.js';
import { extractFileAnalysis } from '../symbolExtractor.js';
import type { FileAnalysis } from '../../types/analysis.js';

/**
 * `get x()` / `set x(v)` used to be dropped: class members were filtered by
 * `isMethodDeclaration` alone, so an accessor produced no symbol, no calls
 * edges, and nothing a workflow trace could follow through.
 */
describe('symbolExtractor — class accessors', () => {
  let analyses: FileAnalysis[];
  let dir: string;

  before(async function () {
    this.timeout(30000); // real ts.Program construction
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obb-accessors-'));
    fs.writeFileSync(
      path.join(dir, 'db.ts'),
      'export function readRow(){ return 1; }\nexport function writeRow(v: number){ return v; }\n',
    );
    fs.writeFileSync(
      path.join(dir, 'store.ts'),
      `import { readRow, writeRow } from './db.js';

export class SessionStore {
  private cached: number | null = null;

  get current(): number {
    return readRow();
  }

  set current(v: number) {
    writeRow(v);
  }

  plainMethod(): number {
    return 42;
  }
}
`,
    );

    const index = await buildRepoIndex(dir);
    const tsFiles = filterByLanguage(index, 'typescript');
    const program = createProgram(tsFiles, dir);
    analyses = tsFiles.map((entry) =>
      extractFileAnalysis(parseSourceFile(program, entry.absolutePath), dir),
    );
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function storeClass() {
    const fa = analyses.find((a) => a.relativePath.endsWith('store.ts'))!;
    return fa.symbols.find((s) => s.name === 'SessionStore')!;
  }

  it('extracts both the getter and the setter as methods', () => {
    const names = (storeClass().methods ?? []).map((m) => m.name);
    expect(names).to.include('get current');
    expect(names).to.include('set current');
    expect(names).to.include('plainMethod');
  });

  it('keeps getter and setter distinct so they cannot collapse into one graph node', () => {
    const names = (storeClass().methods ?? []).map((m) => m.name);
    // A shared name would produce one `store.ts#SessionStore.current` key and
    // the setter would silently overwrite the getter.
    expect(new Set(names).size).to.equal(names.length);
  });

  it('captures calls made inside accessors, so flow through them stays traceable', () => {
    const methods = storeClass().methods ?? [];
    const getter = methods.find((m) => m.name === 'get current')!;
    const setter = methods.find((m) => m.name === 'set current')!;

    expect(getter.callsSymbols ?? []).to.include('readRow');
    expect(setter.callsSymbols ?? []).to.include('writeRow');

    // Resolved through the TypeChecker to the real declaring file — this is
    // what becomes a `calls` edge in the graph.
    expect((getter.resolvedCalls ?? []).map((c) => c.targetName)).to.include('readRow');
    expect((setter.resolvedCalls ?? []).map((c) => c.targetName)).to.include('writeRow');
  });

  it('records accessor identity: line numbers, snippet and body hash', () => {
    const getter = (storeClass().methods ?? []).find((m) => m.name === 'get current')!;
    expect(getter.lineStart).to.be.a('number').greaterThan(0);
    expect(getter.lineEnd).to.be.a('number').greaterThan(0);
    expect(getter.snippet).to.contain('readRow');
    expect(getter.bodyHash).to.be.a('string').with.length.greaterThan(0);
  });

  it('gives the getter and setter different signature hashes', () => {
    const methods = storeClass().methods ?? [];
    const getter = methods.find((m) => m.name === 'get current')!;
    const setter = methods.find((m) => m.name === 'set current')!;
    expect(getter.signatureHash).to.not.equal(setter.signatureHash);
  });
});
