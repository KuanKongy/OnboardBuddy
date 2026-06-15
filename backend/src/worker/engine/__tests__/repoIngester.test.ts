import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/simple');

describe('repoIngester', () => {
  describe('buildRepoIndex', () => {
    it('returns a RepoIndex with rootPath set to resolved absolute path', async () => {
      const index = await buildRepoIndex(FIXTURE_DIR);
      expect(index.rootPath).to.equal(FIXTURE_DIR);
    });

    it('finds all .ts files in fixture directory', async () => {
      const index = await buildRepoIndex(FIXTURE_DIR);
      const relPaths = index.files.map((f) => f.relativePath);
      expect(relPaths).to.include('index.ts');
      expect(relPaths).to.include(path.join('services', 'authService.ts'));
      expect(relPaths).to.include(path.join('utils', 'jwtUtil.ts'));
    });

    it('marks all fixture files as typescript', async () => {
      const index = await buildRepoIndex(FIXTURE_DIR);
      for (const f of index.files) {
        expect(f.language).to.equal('typescript');
      }
    });

    it('detectedLanguage is typescript for an all-TS repo', async () => {
      const index = await buildRepoIndex(FIXTURE_DIR);
      expect(index.detectedLanguage).to.equal('typescript');
    });

    it('each FileEntry has a positive sizeBytes', async () => {
      const index = await buildRepoIndex(FIXTURE_DIR);
      for (const f of index.files) {
        expect(f.sizeBytes).to.be.greaterThan(0);
      }
    });

    it('absolutePath on each entry is resolvable and matches rootPath prefix', async () => {
      const index = await buildRepoIndex(FIXTURE_DIR);
      for (const f of index.files) {
        expect(f.absolutePath.startsWith(index.rootPath)).to.be.true;
      }
    });

    it('throws when path does not exist', async () => {
      try {
        await buildRepoIndex('/nonexistent/path/xyz');
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('does not exist');
      }
    });
  });

  describe('filterByLanguage', () => {
    it('returns only typescript entries when language is typescript', async () => {
      const index = await buildRepoIndex(FIXTURE_DIR);
      const ts = filterByLanguage(index, 'typescript');
      expect(ts).to.have.length(index.files.length);
      for (const f of ts) {
        expect(f.language).to.equal('typescript');
      }
    });

    it('returns empty array when no files match language', async () => {
      const index = await buildRepoIndex(FIXTURE_DIR);
      const js = filterByLanguage(index, 'javascript');
      expect(js).to.have.length(0);
    });
  });
});
