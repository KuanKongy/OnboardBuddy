/**
 * Symbol co-batching: a nested handler's code is already inside its
 * container's snippet, so sending both in one batch paid for the same lines
 * twice. The pass now keeps a family (container + its `Container.inner`
 * children) in one batch and replaces the child's code fence with a line-range
 * pointer into the container's fence.
 *
 * What is pinned here is what a run cannot show you: that the pointer is
 * TRUE. A pointer to lines the model never received, or to the wrong lines,
 * produces a confidently wrong record with a valid-looking receipt — the
 * failure mode this whole feature can introduce and nothing downstream would
 * catch. Hence: the arithmetic is checked against the real extractor, the
 * container's cap is respected, and a child batched away from its container
 * still carries its own code.
 */

import { expect } from 'chai';
import * as path from 'path';
import { __setQueryForTests } from '../../../lib/db.js';
import { installFakeDb, makeClient, recordStoreRoutes, type QueryLogEntry } from '../../../../test/helpers/aiHarness.js';
import { buildRepoIndex, filterByLanguage } from '../../engine/repoIngester.js';
import { createProgram, parseSourceFile } from '../../engine/astParser.js';
import { extractFileAnalysis } from '../../engine/symbolExtractor.js';
import { MAX_SYMBOLS_PER_CALL } from '../../engine/budgets.js';
import type {
  AiProvider, CompletionResult, StructuredRequest, StructuredResult,
} from '../../ai/provider.js';
import { planBatches, planSnippetDedupe, runSymbolPass } from '../symbolPass.js';
import type { SemanticContext } from '../context.js';
import type { EvidenceNode } from '../../types/analysis.js';

/** Keeps every prompt that left the process and answers for the keys it sees. */
class CapturingProvider implements AiProvider {
  readonly id = 'openrouter';
  readonly prompts: string[] = [];

  async complete(): Promise<CompletionResult> {
    throw new Error('symbol batches are structured calls');
  }

  async completeStructured<T>(req: StructuredRequest): Promise<StructuredResult<T>> {
    const user = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    this.prompts.push(user);
    // Line-anchored: a pointer line MENTIONS `### Symbol <container>` mid-line
    // and must not be mistaken for a section of its own.
    const keys = [...user.matchAll(/^### Symbol (\S+)/gm)].map((m) => m[1]!);
    return {
      value: { records: keys.map(recordFor) } as T,
      usage: { inputTokens: 100, outputTokens: 20 },
      usedSchemaFallback: false,
    };
  }

  async embed(): Promise<{ vectors: number[][]; usage: { inputTokens: number; outputTokens: number } }> {
    throw new Error('unexpected embedding call');
  }

  /** The prompt section rendered for one symbol, without its `### Symbol` header. */
  sectionFor(stableKey: string): string {
    const prompt = this.prompts.find((p) => p.includes(`### Symbol ${stableKey}  `));
    expect(prompt, `no prompt carried ${stableKey}`).to.be.a('string');
    return prompt!
      .split(`### Symbol ${stableKey}  `)[1]!
      .split(/^### Symbol /m)[0]!;
  }
}

function recordFor(stableKey: string) {
  return {
    stable_key: stableKey,
    purpose: 'p', behavior: 'b', responsibilities: [], business_concepts: [], side_effects: [],
    inputs_outputs: null, dependencies_narrative: 'none', design_patterns: [],
    risks_invariants: [], confidence: 'high', claims: [],
  };
}

/** 60-char lines, so exactly 200 of them fill the 12,000-char snippet cap. */
function numberedLines(count: number, tag: string): string {
  return Array.from({ length: count }, (_, i) => `${tag}-line-${String(i + 1).padStart(4, '0')}`.padEnd(59, '.')).join('\n');
}

function node(overrides: Partial<EvidenceNode> & Pick<EvidenceNode, 'stableKey'>): EvidenceNode {
  return {
    type: 'function', name: overrides.stableKey.split('#')[1]!, filePath: overrides.stableKey.split('#')[0]!,
    trustLevel: 'code', exported: false, hash: `h-${overrides.stableKey}`,
    signatureHash: 's', bodyHash: 'b', snippet: 'function x() { return 1; }',
    metadata: {},
    ...overrides,
  } as EvidenceNode;
}

/** container + `count` nested children, all inside the container's line span. */
function family(file: string, containerName: string, count: number, containerLines = 400): EvidenceNode[] {
  const containerKey = `${file}#${containerName}`;
  return [
    node({
      stableKey: containerKey, name: containerName, lineStart: 1, lineEnd: containerLines,
      snippet: numberedLines(containerLines, containerName),
    }),
    ...Array.from({ length: count }, (_, i) => node({
      stableKey: `${file}#${containerName}.child${i}`, name: `${containerName}.child${i}`,
      lineStart: 10 + i * 2, lineEnd: 11 + i * 2,
      snippet: `const child${i} = () => { OWN_SNIPPET_${containerName}_${i}(); };`,
      metadata: { container: containerName, signature: `child${i}(): void` },
    })),
  ];
}

function makeCtx(ai: SemanticContext['ai'], nodes: EvidenceNode[]): SemanticContext {
  return {
    ai,
    projectId: 'proj-1', snapshotId: 'snap-1', commitHash: 'abc123',
    depth: 'standard', privacyMode: 'full_ai',
    modelFamily: { cheap: 'test/cheap', strong: 'test/strong' },
    graph: { nodes, edges: [] },
    nodeIdMap: new Map(), sideEffects: [],
    gating: { selected: nodes.map((n) => n.stableKey), factsOnly: [] },
  } as unknown as SemanticContext;
}

async function runWith(nodes: EvidenceNode[]): Promise<{ provider: CapturingProvider; log: QueryLogEntry[] }> {
  const log = installFakeDb({ extra: recordStoreRoutes() });
  const provider = new CapturingProvider();
  const result = await runSymbolPass(makeCtx(makeClient(provider as never, { models: { cheap: ['test/cheap'] } }), nodes));
  expect(result.llmRecords, 'every symbol still got an LLM record').to.equal(nodes.length);
  return { provider, log };
}

describe('symbol pass — co-batched families (input dedupe)', () => {
  before(() => { process.env.OPENROUTER_API_KEY = 'server-key'; });
  after(() => { delete process.env.OPENROUTER_API_KEY; });
  afterEach(() => __setQueryForTests(null));

  it('keeps a family in one batch and leaves unrelated symbols packing as before', () => {
    const nodes = [
      ...family('src/big.ts', 'Big', 3),
      ...Array.from({ length: 9 }, (_, i) => node({ stableKey: `src/solo.ts#s${i}`, lineStart: i })),
    ];
    const batches = planBatches(nodes);
    expect(batches.flat().length, 'nothing dropped').to.equal(13);
    for (const batch of batches) expect(batch.length).to.be.at.most(MAX_SYMBOLS_PER_CALL);
    // The 4-member family would straddle the cap if packed symbol by symbol
    // (4 + 9 = 13 > 10); it must sit whole in one batch, container first.
    const withContainer = batches.find((b) => b.some((n) => n.stableKey === 'src/big.ts#Big'))!;
    expect(withContainer.map((n) => n.stableKey).slice(0, 4)).to.deep.equal([
      'src/big.ts#Big', 'src/big.ts#Big.child0', 'src/big.ts#Big.child1', 'src/big.ts#Big.child2',
    ]);
  });

  it('splits a family larger than the call cap, and the split-off members keep their own code', async () => {
    const nodes = family('src/split.ts', 'Split', 12); // 13 members > MAX_SYMBOLS_PER_CALL
    const batches = planBatches(nodes);
    expect(batches.map((b) => b.length)).to.deep.equal([10, 3]);
    expect(batches[0]![0]!.stableKey).to.equal('src/split.ts#Split');

    const { provider } = await runWith(nodes);
    const orphaned = provider.prompts.find((p) => !/^### Symbol src\/split\.ts#Split {2}/m.test(p))!;
    expect(orphaned, 'the split-off members were sent without their container').to.be.a('string');
    expect(orphaned).to.not.include('source: lines');
    for (const i of [9, 10, 11]) expect(orphaned).to.include(`OWN_SNIPPET_Split_${i}`);
  });

  it('points a co-batched child at the container fence, keeps its own facts, and keeps its receipt snippet', async () => {
    const nodes = [
      ...family('src/big.ts', 'Big', 1),
      // Declared past the container's 12,000-char cut: those lines never reach
      // the model, so a pointer at them would be a citation to nothing.
      node({
        stableKey: 'src/big.ts#Big.pastCap', name: 'Big.pastCap', lineStart: 300, lineEnd: 310,
        snippet: 'const pastCap = () => { OWN_SNIPPET_PAST_CAP(); };',
        metadata: { container: 'Big', signature: 'pastCap(): void' },
      }),
    ];
    expect(planBatches(nodes)).to.have.length(1); // one batch: pointers are only ever within a call
    const { provider, log } = await runWith(nodes);

    const child = provider.sectionFor('src/big.ts#Big.child0');
    expect(child).to.include('source: lines 10-11 of the snippet under "### Symbol src/big.ts#Big" above (file lines 10-11)');
    expect(child, 'the code fence is what dedupe removes').to.not.include('```');
    expect(child, 'and only the code fence').to.include('signature: child0(): void');
    expect(child).to.include('called by: (none detected)');
    expect(child).to.include('calls: (none detected)');
    // Two fences for three symbols: the container's and the out-of-window
    // child's. The co-batched child's copy is the one that disappeared.
    expect(provider.prompts[0]!.split('```')).to.have.length(5);
    expect(provider.prompts[0]!.split('Big-line-0010'), 'container body sent once').to.have.length(2);

    // Out of the sent window -> unchanged behaviour, its own snippet.
    const pastCap = provider.sectionFor('src/big.ts#Big.pastCap');
    expect(pastCap).to.not.include('source: lines');
    expect(pastCap).to.include('OWN_SNIPPET_PAST_CAP');

    // Receipts are evidence, not prompt input: the deduped child's receipt must
    // still carry its own snippet or the graph panel would cite the container.
    const receipts = log.find((q) => q.text.includes('INSERT INTO source_receipts'))!;
    expect(receipts.params!.some((p) => String(p).includes('OWN_SNIPPET_Big_0'))).to.equal(true);
  });

  it('pointer line numbers select the child\'s real source in the container snippet', async function () {
    this.timeout(30_000); // real ts.Program construction
    const dir = path.resolve(__dirname, '../../fixtures/nested');
    const files = filterByLanguage(await buildRepoIndex(dir), 'typescript');
    const fa = extractFileAnalysis(parseSourceFile(createProgram(files, dir), files[0]!.absolutePath), dir);
    const asNode = (name: string): EvidenceNode => {
      const sym = fa.symbols.find((s) => s.name === name)!;
      return node({
        stableKey: sym.stableKey!, name, lineStart: sym.start.line, lineEnd: sym.end.line,
        snippet: sym.snippet!, metadata: sym.containerName ? { container: sym.containerName } : {},
      });
    };
    const container = asNode('Panel');
    const child = asNode('Panel.applyChange');

    const pointer = planSnippetDedupe([container, child]).get(child.stableKey)!;
    expect(pointer, 'a real extracted nested function is a dedupe candidate').to.not.equal(undefined);
    // The whole feature rests on snippet line 1 == node.lineStart (snippetOf
    // uses getText, getNodeLocation uses getStart — both skip leading trivia).
    // If that ever drifts, the pointer silently cites the wrong lines.
    const cited = container.snippet!.split('\n').slice(pointer.fromLine - 1, pointer.toLine).join('\n');
    expect(cited).to.include('const applyChange = (next: number): number => {');
    expect(cited.trimEnd().endsWith('};'), `cited block ends at the child: ${cited}`).to.equal(true);
    expect(cited).to.include(child.snippet!.split('\n')[1]!.trim());
  });

  it('sends no pointer when snippets are withheld by privacy mode', async () => {
    installFakeDb({ extra: recordStoreRoutes() });
    const provider = new CapturingProvider();
    const nodes = family('src/big.ts', 'Big', 1);
    const ctx = makeCtx(makeClient(provider as never, { models: { cheap: ['test/cheap'] } }), nodes);
    await runSymbolPass({ ...ctx, privacyMode: 'metadata_only' } as SemanticContext);
    // Nothing to point AT — the container's code was never sent either.
    expect(provider.prompts[0]).to.not.include('source: lines');
    expect(provider.prompts[0]).to.include('withheld by privacy settings');
  });
});
