import { expect } from 'chai';
import { checkDocHealth } from '../docHealthCheck';
import type { EvidenceNode } from '../../types/analysis';
import type { DetectedEntrypoint } from '../entrypointDetector';

/**
 * Doc-vs-code staleness (step-3 trust overlay): deterministic comparison of
 * doc claims (routes, env names) against extracted facts.
 */

const doc = (path: string, snippet: string): EvidenceNode => ({
  stableKey: `doc:${path}`, type: 'doc', name: path, filePath: path,
  trustLevel: 'docs', snippet, metadata: {},
});

const route = (routePattern: string): DetectedEntrypoint => ({
  nodeStableKey: 'src/api/routes/x.ts', kind: 'http_route',
  routePattern, filePath: 'src/api/routes/x.ts', method: 'GET',
});

describe('docHealthCheck (doc-vs-code staleness)', () => {
  it('flags documented routes that no longer exist, param-insensitively', () => {
    const conflicts = checkDocHealth({
      docNodes: [doc('README.md', 'Call `/api/projects/:id/analyze` to start; the old `/api/scan/:id` is gone.')],
      entrypoints: [route('/api/projects/:projectId/analyze')],
      envVarNames: [],
    });
    expect(conflicts).to.have.length(1);
    expect(conflicts[0]!.claim).to.equal('/api/scan/:id');
    expect(conflicts[0]!.class).to.equal('route');
  });

  it('flags documented env vars missing from templates, only in config context', () => {
    const conflicts = checkDocHealth({
      docNodes: [doc('doc/SETUP.md', 'Set LEGACY_TOKEN_SECRET= in your .env. The HTTP_STATUS enum is unrelated.')],
      entrypoints: [route('/api/x')],
      envVarNames: ['DATABASE_URL', 'QUEUE_SUFFIX'],
    });
    expect(conflicts.map((c) => c.claim)).to.deep.equal(['LEGACY_TOKEN_SECRET']);
    expect(conflicts[0]!.class).to.equal('env');
  });

  it('never flags file paths or bare version prefixes as route claims', () => {
    const conflicts = checkDocHealth({
      docNodes: [doc('doc/DEVOPS.md', 'See `/api/routes/projects.ts` and `/api/server.ts`; the base is /api/v1 for now.')],
      entrypoints: [route('/api/projects')],
      envVarNames: [],
    });
    expect(conflicts).to.deep.equal([]);
  });

  it('never flags anything when the fact side is empty (nothing checkable)', () => {
    const conflicts = checkDocHealth({
      docNodes: [doc('README.md', '`/api/whatever` and SOME_ENV_VAR= here')],
      entrypoints: [],
      envVarNames: [],
    });
    expect(conflicts).to.deep.equal([]);
  });

  it('caps output and dedupes repeated claims', () => {
    const text = Array.from({ length: 30 }, (_, i) => `\`/api/ghost/${i}\``).join(' ');
    const conflicts = checkDocHealth({
      docNodes: [doc('README.md', text), doc('doc/API.md', text)],
      entrypoints: [route('/api/real')],
      envVarNames: [],
    });
    expect(conflicts.length).to.be.at.most(8);
  });
});
