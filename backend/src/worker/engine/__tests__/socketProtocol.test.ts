import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester.js';
import { createProgram, parseSourceFile } from '../astParser.js';
import { extractFileAnalysis } from '../symbolExtractor.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/socketProtocol');

describe('socket protocol anchor', () => {
  it('reads the `connect` alias as a server protocol, and a channel-less `connect` as not one', async function () {
    this.timeout(30000); // real ts.Program construction
    const index = await buildRepoIndex(FIXTURE_DIR);
    const files = filterByLanguage(index, 'typescript');
    const program = createProgram(files, FIXTURE_DIR);
    const fa = extractFileAnalysis(parseSourceFile(program, files[0]!.absolutePath), FIXTURE_DIR);
    expect((fa.socketHandlers ?? []).map((h) => h.event)).to.deep.equal([
      'connect', 'message', 'disconnect',
    ]);
  });
});
