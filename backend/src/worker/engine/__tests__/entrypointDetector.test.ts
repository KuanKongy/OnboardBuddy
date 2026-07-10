import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester';
import { createProgram, parseSourceFile } from '../astParser';
import { extractFileAnalysis } from '../symbolExtractor';
import { detectEntrypoints } from '../entrypointDetector';
import type { FileAnalysis } from '../../types/analysis';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/simple');

let fileAnalyses: FileAnalysis[];

before(async () => {
  const index = await buildRepoIndex(FIXTURE_DIR);
  const tsFiles = filterByLanguage(index, 'typescript');
  const program = createProgram(tsFiles, FIXTURE_DIR);
  fileAnalyses = tsFiles.map((entry) => {
    const parsed = parseSourceFile(program, entry.absolutePath);
    return extractFileAnalysis(parsed, FIXTURE_DIR);
  });
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
