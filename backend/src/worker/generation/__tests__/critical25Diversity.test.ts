import { expect } from 'chai';
import { critical25, type ProjectedTarget } from '../roleProjection.js';

const t = (stableKey: string, score: number, targetType = 'symbol'): ProjectedTarget => ({
  targetType,
  stableKey,
  score,
  reasons: [],
  viewScores: {},
});

describe('critical25 area diversity cap', () => {
  it('breaks a single-directory monopoly — the dogfood failure shape', () => {
    // 12 page symbols out-scoring 8 worker/api symbols (the real bias shape:
    // role=general's top-12 were ALL frontend pages).
    const pages = Array.from({ length: 12 }, (_, i) =>
      t(`frontend/src/pages/Page${i}.tsx#Page${i}`, 1 - i * 0.01),
    );
    const backend = [
      t('backend/src/worker/index.ts#runJob', 0.7),
      t('backend/src/worker/semantic/semanticPipeline.ts#run', 0.69),
      t('backend/src/api/routes/projects.ts#POST /', 0.68),
      t('backend/src/lib/db.ts#query', 0.67),
      ...Array.from({ length: 4 }, (_, i) => t(`backend/src/worker/engine/e${i}.ts#f${i}`, 0.6 - i * 0.01)),
    ];
    const picked = critical25([...pages, ...backend].sort((a, b) => b.score - a.score)).get('symbol')!;

    // take = ceil(20 * .25) = 5; cap = 40% -> max 2 pages, rest from elsewhere.
    expect(picked).to.have.length(5);
    const pageCount = picked.filter((p) => p.stableKey.startsWith('frontend/src/pages/')).length;
    expect(pageCount).to.be.at.most(2);
    expect(picked.some((p) => p.stableKey.startsWith('backend/src/worker'))).to.equal(true);
  });

  it('keeps pure top-N when diversity is already present', () => {
    const targets = [
      t('backend/src/api/a.ts#x', 0.9),
      t('backend/src/lib/b.ts#y', 0.8),
      t('frontend/src/pages/C.tsx#C', 0.7),
      t('backend/src/worker/d.ts#z', 0.6),
    ];
    const picked = critical25(targets).get('symbol')!;
    expect(picked.map((p) => p.score)).to.deep.equal([0.9, 0.8, 0.7]);
  });

  it('backfills from the capped area rather than under-filling', () => {
    // Only one area exists — the cap must not shrink the selection.
    const targets = Array.from({ length: 12 }, (_, i) =>
      t(`frontend/src/pages/P${i}.tsx#P${i}`, 1 - i * 0.01),
    );
    const picked = critical25(targets).get('symbol')!;
    expect(picked).to.have.length(3); // ceil(12*.25)=3, all from the only area
  });

  it('leaves workflow/cluster target types untouched', () => {
    const targets = [
      t('wf:a', 0.9, 'workflow'),
      t('wf:b', 0.8, 'workflow'),
      t('wf:c', 0.7, 'workflow'),
      t('wf:d', 0.6, 'workflow'),
    ];
    const picked = critical25(targets).get('workflow')!;
    expect(picked.map((p) => p.stableKey)).to.deep.equal(['wf:a', 'wf:b', 'wf:c']);
  });
});
