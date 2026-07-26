import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester.js';
import { createProgram, parseSourceFile } from '../astParser.js';
import { extractFileAnalysis } from '../symbolExtractor.js';
import { detectSideEffects } from '../sideEffectDetector.js';
import type { FileAnalysis } from '../../types/analysis.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/nested');

describe('nested handlers and instance-field state', () => {
  let fa: FileAnalysis;

  before(async function () {
    this.timeout(30000); // real ts.Program construction
    const index = await buildRepoIndex(FIXTURE_DIR);
    const files = filterByLanguage(index, 'typescript');
    const program = createProgram(files, FIXTURE_DIR);
    fa = extractFileAnalysis(parseSourceFile(program, files[0]!.absolutePath), FIXTURE_DIR);
  });

  it('emits a referenced nested function as `Container.inner`, and drops the unreferenced one', () => {
    const nested = fa.symbols.filter((s) => s.containerName);
    expect(nested.map((s) => ({ key: s.stableKey, container: s.containerName, line: s.start.line }))).to.deep.equal([
      { key: 'sample.ts#Panel.applyChange', container: 'Panel', line: 9 },
    ]);
  });

  it('reports `this.<field>` mutation in a class method as low-confidence state with no target', () => {
    const eff = detectSideEffects([fa]).find((e) => e.symbolStableKey === 'sample.ts#Store.advance');
    expect({ kind: eff?.kind, confidence: eff?.confidence, target: eff?.target }).to.deep.equal({
      kind: 'database_write', confidence: 'low', target: undefined,
    });
  });
});
