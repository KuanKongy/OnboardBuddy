import { expect } from 'chai';
import { rankCandidates } from '../candidateRanker.js';
import type { DetectedEntrypoint } from '../entrypointDetector.js';
import type { EvidenceGraph, EvidenceNode } from '../../types/analysis.js';

const node = (stableKey: string, filePath: string): EvidenceNode => ({
  stableKey,
  type: 'function',
  name: stableKey.split('#')[1] ?? stableKey,
  filePath,
  trustLevel: 'code',
  exported: true,
  metadata: {},
});

const graph: EvidenceGraph = {
  nodes: [
    node('frontend/src/pages/Home.tsx#Home', 'frontend/src/pages/Home.tsx'),
    node('backend/src/api/routes/r.ts#GET /x', 'backend/src/api/routes/r.ts'),
    node('backend/test/api/r.test.ts#helper', 'backend/test/api/r.test.ts'),
    node('backend/src/worker/fixtures/app/s.ts#fx', 'backend/src/worker/fixtures/app/s.ts'),
  ],
  edges: [],
};

const entrypoints: DetectedEntrypoint[] = [
  {
    nodeStableKey: 'frontend/src/pages/Home.tsx',
    kind: 'ui_route',
    filePath: 'frontend/src/pages/Home.tsx',
    symbolName: 'Home',
    symbolStableKey: 'frontend/src/pages/Home.tsx#Home',
  },
  {
    nodeStableKey: 'backend/src/api/routes/r.ts',
    kind: 'http_route',
    method: 'GET',
    routePattern: '/x',
    filePath: 'backend/src/api/routes/r.ts',
    symbolName: 'GET /x',
    symbolStableKey: 'backend/src/api/routes/r.ts#GET /x',
  },
];

describe('candidateRanker damping & exclusion', () => {
  const rankings = rankCandidates({ graph, entrypoints, sideEffects: [], workflows: [] });

  it('never ranks test or fixture files as targets', () => {
    const keys = rankings.map((r) => r.stableKey);
    expect(keys.some((k) => k.includes('test'))).to.equal(false);
    expect(keys.some((k) => k.includes('fixtures'))).to.equal(false);
  });

  it('gives ui_route-only symbols half entrypoint credit vs real route handlers', () => {
    const page = rankings.find((r) => r.stableKey === 'frontend/src/pages/Home.tsx#Home')!;
    const route = rankings.find((r) => r.stableKey === 'backend/src/api/routes/r.ts#GET /x')!;
    expect(route.breakdown.entrypointParticipation).to.equal(1);
    expect(page.breakdown.entrypointParticipation).to.equal(0.5);
    expect(page.reasons).to.include('Entry point (UI page, reduced weight)');
    expect(route.reasons).to.include('Entry point');
  });
});
