/**
 * The semantic pipeline's concurrent tail.
 *
 * semantic_ranking and embeddings are write-disjoint (criticality_scores vs
 * embeddings) and neither reads the other's output, so they run side by side
 * instead of head to tail — embeddings was 673s of a 15-minute job on snapshot
 * 252239a3 while the reranker sat idle behind it. Re-serializing them would be
 * invisible in the output, which is what these two tests pin: that both phases
 * are in flight at once, and that the pair's failure bookkeeping still matches
 * the sequential loop's (a budget degrade skips the phase that tripped and
 * keeps what its sibling produced).
 */

import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import { BudgetExceededError } from '../../ai/budgetEnforcer.js';
import { runSemanticPipeline } from '../semanticPipeline.js';
import type { SemanticContext } from '../context.js';
import type { SemanticRecordBody } from '../recordTypes.js';

interface PhaseMark { phase: string; status: string; reason?: string }

/** Renders to non-empty view text, so the embedding pass has real work to do. */
const EMBEDDABLE_BODY: SemanticRecordBody = {
  purpose: 'Authenticates users.',
  behavior: 'Validates credentials then signs a token.',
  responsibilities: ['authentication'],
  business_concepts: ['user login'],
  side_effects: [],
  inputs_outputs: null,
  dependencies_narrative: 'Delegates persistence to the session store.',
  design_patterns: [],
  risks_invariants: ['Never log credentials.'],
  confidence: 'high',
  claims: [],
  failure_modes: [],
};

interface Harness {
  ctx: SemanticContext;
  marks: PhaseMark[];
  seen: string[];
  embedCalls: number;
}

/** The reranker's first read; the embedding pass never issues this one. */
const RERANK_FIRST_READ = 'SELECT cm.stable_key FROM capability_members cm';
/** The embedding pass's first read. */
const EMBED_FIRST_READ = 'JOIN semantic_records sr ON sr.id = ssr.record_id';

function harness(opts: {
  /** Held open so the reranker cannot finish before we look. */
  gateRerank?: Promise<void>;
  /** Rows the embedding pass will try to embed (0 = it no-ops). */
  embedRecords?: number;
  onEmbed?: () => void;
} = {}): Harness {
  const marks: PhaseMark[] = [];
  const seen: string[] = [];
  const state = { embedCalls: 0 };

  const embedRows = Array.from({ length: opts.embedRecords ?? 0 }, (_, i) => ({
    record_id: `rec-${i}`, stable_key: `src/a${i}.ts#fn`, record_level: 'symbol',
    facts_only: true, record: EMBEDDABLE_BODY,
    node_type: 'function', node_name: `fn${i}`, file_path: `src/a${i}.ts`,
  }));

  __setQueryForTests(async (text, params) => {
    if (text.includes('INSERT INTO snapshot_phases')) {
      marks.push({
        phase: String(params?.[1]), status: String(params?.[2]),
        reason: (JSON.parse(String(params?.[3] ?? '{}')) as { reason?: string }).reason,
      });
      return { rows: [] } as never;
    }
    if (text.includes(RERANK_FIRST_READ)) {
      seen.push('rerank');
      await opts.gateRerank;
      return { rows: [] } as never;
    }
    if (text.includes('SELECT e.record_id, e.view_type FROM embeddings e')) return { rows: [] } as never;
    if (text.includes('INSERT INTO semantic_records')) return { rows: [{ id: 'rec-new' }] } as never;
    if (text.includes(EMBED_FIRST_READ)) {
      seen.push('embeddings');
      return { rows: embedRows } as never;
    }
    return { rows: [] } as never;
  });

  const ai = {
    embeddingModel: 'text-embedding-3-small',
    budget: { flush: async () => {} },
    embed: async (inputs: string[]) => {
      state.embedCalls += 1;
      opts.onEmbed?.();
      return { vectors: inputs.map(() => [0.1, 0.2]) };
    },
    // Nothing in an empty pipeline should reach the provider; make it loud.
    call: async () => { throw new Error('unexpected LLM call'); },
  } as unknown as SemanticContext['ai'];

  const ctx = {
    ai, projectId: 'proj-1', snapshotId: 'snap-1', commitHash: 'abc123',
    depth: 'standard', privacyMode: 'full_ai',
    modelFamily: { cheap: 'cheap-model', strong: 'strong-model' },
    graph: { nodes: [], edges: [] }, nodeIdMap: new Map(),
    entrypoints: [], sideEffects: [], workflows: [], workflowIdMap: new Map(),
    architecture: { clusters: [], edges: [] }, rankings: [],
    gating: { selected: [], factsOnly: [] },
    inventory: { packages: [], configs: [], dockerServices: [], detectedFrameworks: [] },
  } as unknown as SemanticContext;

  return { ctx, marks, seen, get embedCalls() { return state.embedCalls; } };
}

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 20); });

describe('semantic pipeline — semantic_ranking and embeddings run concurrently', () => {
  afterEach(() => __setQueryForTests(null));

  it('starts both tail phases before either finishes', async () => {
    let release!: () => void;
    const gateRerank = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ gateRerank });

    const done = runSemanticPipeline(h.ctx);
    await settle();

    // The reranker is parked inside its first read. Sequentially the embedding
    // pass would not have issued a single statement yet.
    expect(h.seen, 'reads issued while semantic_ranking is still blocked').to.include('embeddings');
    const tailMarks = h.marks
      .filter((m) => m.phase === 'semantic_ranking' || m.phase === 'embeddings')
      .map((m) => `${m.phase}:${m.status}`);
    expect(tailMarks[0], 'the reranker is marked running first').to.equal('semantic_ranking:running');
    expect(tailMarks, 'embeddings started anyway').to.include('embeddings:running');
    expect(tailMarks, 'and did so before its sibling finished').to.not.include('semantic_ranking:complete');

    release();
    const outcome = await done;
    expect(outcome.status).to.equal('complete');
    expect(h.marks).to.deep.include({ phase: 'semantic_ranking', status: 'complete', reason: undefined });
    expect(h.marks).to.deep.include({ phase: 'embeddings', status: 'complete', reason: undefined });
  });

  it('a budget degrade in one tail phase skips only that phase; the sibling still completes', async () => {
    const degrade = new BudgetExceededError('degrade', 'llmCalls', {} as never);
    const h = harness({
      embedRecords: 1,
      onEmbed: () => { throw degrade; },
    });

    const outcome = await runSemanticPipeline(h.ctx);

    expect(outcome.status).to.equal('degraded');
    expect(h.marks).to.deep.include({ phase: 'embeddings', status: 'skipped', reason: 'budget_degraded' });
    expect(h.marks).to.deep.include({ phase: 'semantic_ranking', status: 'complete', reason: undefined });
    expect(h.marks.some((m) => m.phase === 'embeddings' && m.status === 'complete'), 'embeddings must not be marked complete').to.equal(false);
  });
});
