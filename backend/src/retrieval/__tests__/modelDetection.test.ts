/**
 * Per-snapshot embedding-model detection + the seeds `e.model` filter.
 *
 * Both exist for one reason: for the whole of M5 the embeddings table holds
 * vectors from two models (M4 keeps writing text-embedding-3-small rows into
 * the same frozen schema). Without the filter, retrieval compares a query
 * vector against vectors from a different model — which does not fail, it
 * just returns confident nonsense, so no runtime signal would ever surface
 * it. These tests pin the two halves that make that impossible.
 */

import { expect } from 'chai';
import { __setQueryForTests } from '../../lib/db.js';
import { retrieve, __resetEmbeddingModelCacheForTests } from '../retrievalService.js';

const SNAPSHOT = 'snap-model-detection';
const PPLX = 'perplexity/pplx-embed-v1-4b';
const OPENAI = 'text-embedding-3-small';

const META_ROW = {
  repo_owner: 'acme', repo_name: 'app', branch: 'main', commit_hash: 'abc123',
  scope_id: 'scope-1', path_prefix: '', display_name: 'Whole repo',
};

interface Harness {
  seeds: { text: string; params: unknown[] } | null;
  embeddedWith: string[];
}

/** Routes only what retrieve() needs; everything else answers zero rows. */
function install(modelRows: Array<{ model: string; n: number }>): Harness {
  const harness: Harness = { seeds: null, embeddedWith: [] };
  __setQueryForTests(async (text, params) => {
    // Detection runs against the same table as the seeds query — match it first.
    if (text.includes('GROUP BY e.model')) return { rows: modelRows } as never;
    if (text.includes('FROM analysis_snapshots')) return { rows: [META_ROW] } as never;
    if (text.includes('FROM embeddings e')) {
      harness.seeds = { text, params: params ?? [] };
      return { rows: [] } as never;
    }
    return { rows: [] } as never;
  });
  return harness;
}

async function run(harness: Harness): Promise<void> {
  await retrieve({
    snapshotId: SNAPSHOT,
    projectId: 'proj-1',
    task: 'how does auth work',
    privacyMode: 'full_ai',
    embedQuery: async (_text, model) => {
      harness.embeddedWith.push(model);
      return [0.1, 0.2];
    },
  });
}

describe('retrieval — snapshot embedding-model detection', () => {
  const savedModel = process.env.EMBEDDINGS_MODEL;

  beforeEach(() => {
    __resetEmbeddingModelCacheForTests();
    // The deployment state under test: config already flipped to pplx.
    process.env.EMBEDDINGS_MODEL = PPLX;
  });
  afterEach(() => {
    __setQueryForTests(null);
    __resetEmbeddingModelCacheForTests();
    if (savedModel === undefined) delete process.env.EMBEDDINGS_MODEL;
    else process.env.EMBEDDINGS_MODEL = savedModel;
  });

  it('queries an M4 snapshot with the model that wrote it, not the configured one', async () => {
    const harness = install([{ model: OPENAI, n: 4200 }]);
    await run(harness);

    expect(harness.embeddedWith).to.deep.equal([OPENAI]);
    expect(harness.seeds!.text).to.include('e.model = $5');
    expect(harness.seeds!.params[4]).to.equal(OPENAI);
  });

  it('prefers the configured model on a snapshot holding both', async () => {
    // Mid-flip snapshot: the old rows still outnumber the new ones, but the
    // new ones are the space a re-analysis is filling in.
    const harness = install([{ model: OPENAI, n: 4200 }, { model: PPLX, n: 12 }]);
    await run(harness);

    expect(harness.embeddedWith).to.deep.equal([PPLX]);
    expect(harness.seeds!.params[4]).to.equal(PPLX);
  });

  it('falls back to the configured model on a snapshot with no vectors, and still filters', async () => {
    const harness = install([]);
    await run(harness);

    expect(harness.embeddedWith).to.deep.equal([PPLX]);
    expect(harness.seeds!.text).to.include('e.model = $5');
    expect(harness.seeds!.params[4]).to.equal(PPLX);
  });

  it('caches detection per snapshot (one detection query for two retrievals)', async () => {
    let detections = 0;
    __setQueryForTests(async (text) => {
      if (text.includes('GROUP BY e.model')) {
        detections += 1;
        return { rows: [{ model: OPENAI, n: 7 }] } as never;
      }
      if (text.includes('FROM analysis_snapshots')) return { rows: [META_ROW] } as never;
      return { rows: [] } as never;
    });
    const harness: Harness = { seeds: null, embeddedWith: [] };
    await run(harness);
    await run(harness);

    expect(detections).to.equal(1);
    expect(harness.embeddedWith).to.deep.equal([OPENAI, OPENAI]);
  });
});
