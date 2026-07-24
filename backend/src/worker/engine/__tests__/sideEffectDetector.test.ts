import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester';
import { createProgram, parseSourceFile } from '../astParser';
import { extractFileAnalysis } from '../symbolExtractor';
import { detectSideEffects } from '../sideEffectDetector';
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

describe('sideEffectDetector', () => {
  it('returns an array (possibly empty for the simple fixture)', () => {
    const effects = detectSideEffects(fileAnalyses);
    expect(effects).to.be.an('array');
  });

  it('each effect has a valid kind', () => {
    const effects = detectSideEffects(fileAnalyses);
    const validKinds = new Set([
      'database_write', 'http_call', 'file_write', 'message_publish', 'email_send', 'cache_write',
      'auth_call', 'external_service', 'process_exec', 'unknown_external',
    ]);
    for (const eff of effects) {
      expect(validKinds.has(eff.kind)).to.be.true;
    }
  });

  it('each effect includes filePath', () => {
    const effects = detectSideEffects(fileAnalyses);
    for (const eff of effects) {
      expect(eff.filePath).to.be.a('string');
      expect(eff.filePath.length).to.be.greaterThan(0);
    }
  });
});
