import { expect } from 'chai';
import {
  rankModel, selectModel, overridesForSelection, isAutoSelection,
  __resetSelectionCacheForTests, type EndpointStat,
} from '../modelSelector';

/**
 * Auto model rotation (user directive 2026-07-24): privacy first (server-
 * enforced data_collection deny), then live throughput. These tests pin the
 * ranking constraints and the record-cache stickiness.
 */

const ep = (over: Partial<EndpointStat>): EndpointStat => ({
  tag: 'prov', providerName: 'Prov', contextLength: 1_000_000,
  throughputP50: 100, uptime30m: 99, status: 0, structuredOutputs: true,
  ...over,
});

describe('modelSelector', () => {
  beforeEach(() => __resetSelectionCacheForTests());

  it('ranks by best eligible endpoint and excludes non-structured/low-context providers', () => {
    const r = rankModel({ id: 'm', label: 'M' }, [
      ep({ tag: 'fast-no-struct', throughputP50: 300, structuredOutputs: false }),
      ep({ tag: 'small-ctx', throughputP50: 250, contextLength: 131_072 }),
      ep({ tag: 'good', throughputP50: 120 }),
      ep({ tag: 'slower', throughputP50: 60 }),
    ]);
    expect(r.score).to.equal(120);
    expect(r.providerOrder).to.deep.equal(['good', 'slower']);
  });

  it('a model with no eligible endpoint is excluded with a reason', () => {
    const r = rankModel({ id: 'm', label: 'M' }, [
      ep({ structuredOutputs: false, throughputP50: 400 }),
    ]);
    expect(r.score).to.equal(null);
    expect(r.excludedReason).to.contain('structured-output');
  });

  it('picks the fastest model across candidates', async () => {
    const fetchImpl = fetchFor({
      'google/gemini-2.5-flash-lite': [ep({ throughputP50: 140, tag: 'vertex' })],
      'deepseek/deepseek-v4-flash': [ep({ throughputP50: 80, tag: 'baidu' })],
      'meta-llama/llama-4-scout': [ep({ throughputP50: 60, tag: 'kluster' })],
    });
    const sel = await selectModel({ fetchImpl, incumbent: null });
    expect(sel.model).to.equal('google/gemini-2.5-flash-lite');
    expect(sel.providerOrder[0]).to.equal('vertex');
    expect(sel.sticky).to.equal(false);
  });

  it('stickiness: the incumbent keeps the slot unless a rival is 1.25x faster', async () => {
    const fetchImpl = fetchFor({
      'google/gemini-2.5-flash-lite': [ep({ throughputP50: 110 })],
      'deepseek/deepseek-v4-flash': [ep({ throughputP50: 100 })],
      'meta-llama/llama-4-scout': [],
    });
    const sel = await selectModel({ fetchImpl, incumbent: 'deepseek/deepseek-v4-flash' });
    expect(sel.model).to.equal('deepseek/deepseek-v4-flash');
    expect(sel.sticky).to.equal(true);

    __resetSelectionCacheForTests();
    const fetchImpl2 = fetchFor({
      'google/gemini-2.5-flash-lite': [ep({ throughputP50: 200 })],
      'deepseek/deepseek-v4-flash': [ep({ throughputP50: 100 })],
      'meta-llama/llama-4-scout': [],
    });
    const sel2 = await selectModel({ fetchImpl: fetchImpl2, incumbent: 'deepseek/deepseek-v4-flash' });
    expect(sel2.model).to.equal('google/gemini-2.5-flash-lite');
    expect(sel2.sticky).to.equal(false);
  });

  it('falls back to the env default when every probe fails, without throwing', async () => {
    const fetchImpl = async () => { throw new Error('network down'); };
    const sel = await selectModel({ fetchImpl: fetchImpl as never, incumbent: null });
    expect(sel.model).to.be.a('string').and.not.equal('auto');
    expect(sel.rankings.every((r) => r.score === null)).to.equal(true);
  });

  it('overridesForSelection puts the winner first with ranked fallbacks on both tiers', async () => {
    const fetchImpl = fetchFor({
      'google/gemini-2.5-flash-lite': [ep({ throughputP50: 90 })],
      'deepseek/deepseek-v4-flash': [ep({ throughputP50: 140 })],
      'meta-llama/llama-4-scout': [ep({ throughputP50: 50 })],
    });
    const sel = await selectModel({ fetchImpl, incumbent: null });
    const o = overridesForSelection(sel);
    expect(o.cheap[0]).to.equal('deepseek/deepseek-v4-flash');
    expect(o.cheap).to.deep.equal(o.strong);
    expect(o.cheap).to.include('meta-llama/llama-4-scout');
  });

  it('isAutoSelection: missing, empty, and "auto" all rotate; explicit pins do not', () => {
    expect(isAutoSelection(undefined)).to.equal(true);
    expect(isAutoSelection({})).to.equal(true);
    expect(isAutoSelection({ cheap: ['auto'], strong: ['auto'] })).to.equal(true);
    expect(isAutoSelection({ cheap: ['google/gemini-2.5-flash-lite'] })).to.equal(false);
  });
});

function fetchFor(byModel: Record<string, EndpointStat[]>) {
  return async (url: string) => {
    const model = Object.keys(byModel).find((m) => url.includes(m));
    if (!model) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          endpoints: byModel[model]!.map((e) => ({
            tag: e.tag, provider_name: e.providerName, context_length: e.contextLength,
            throughput_last_30m: e.throughputP50 != null ? { p50: e.throughputP50 } : undefined,
            uptime_last_30m: e.uptime30m, status: e.status,
            supported_parameters: e.structuredOutputs ? ['structured_outputs'] : [],
          })),
        },
      }),
    };
  };
}
