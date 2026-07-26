import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import type { EvidenceGraph, EvidenceNode } from '../../types/analysis.js';
import { evidenceHashForSymbol, evidenceHashForChildren, depthLookupOrder, insertRecord, lookupRecord } from '../recordStore.js';
import { planBatches, buildFactsOnlyBody } from '../symbolPass.js';
import { MAX_SYMBOLS_PER_CALL } from '../../engine/budgets.js';
import { groupClustersIntoServices } from '../synthesisPass.js';
import { deriveCapabilities, slugify } from '../capabilityPass.js';
import type { ExtractedWorkflow, WorkflowStep } from '../../engine/workflowExtractor.js';
import { DEFAULT_ROLE_WEIGHTS, SEMANTIC_VIEWS, projectRoleScore, resolveRoleWeights } from '../projections.js';
import { deterministicViewScores, deterministicRoleScores, selectRerankTargets, type RerankTarget } from '../semanticReranker.js';
import { schemaForLevel, batchedSymbolSchema, batchedLevelSchema, renderSummary, PROMPT_VERSIONS } from '../recordTypes.js';
import { validateAgainstSchema } from '../../ai/jsonSchemaValidator.js';

function makeNode(overrides: Partial<EvidenceNode> = {}): EvidenceNode {
  return {
    stableKey: 'a.ts#fn', type: 'function', name: 'fn', filePath: 'a.ts',
    trustLevel: 'code', exported: true, hash: 'h1', signatureHash: 's1', bodyHash: 'b1',
    snippet: 'function fn() { return 1; }', metadata: {},
    ...overrides,
  };
}

function makeGraph(nodes: EvidenceNode[], edges: EvidenceGraph['edges'] = []): EvidenceGraph {
  return { nodes, edges };
}

describe('phase 5 — evidence hashing', () => {
  it('is stable regardless of edge insertion order', () => {
    const node = makeNode();
    const other = makeNode({ stableKey: 'b.ts#g', name: 'g', filePath: 'b.ts', hash: 'h2' });
    const third = makeNode({ stableKey: 'c.ts#h', name: 'h', filePath: 'c.ts', hash: 'h3' });
    const edges: EvidenceGraph['edges'] = [
      { sourceKey: 'b.ts#g', targetKey: 'a.ts#fn', type: 'calls', confidence: 'high', metadata: {} },
      { sourceKey: 'c.ts#h', targetKey: 'a.ts#fn', type: 'calls', confidence: 'high', metadata: {} },
    ];
    const h1 = evidenceHashForSymbol(node, makeGraph([node, other, third], edges), []);
    const h2 = evidenceHashForSymbol(node, makeGraph([node, other, third], [...edges].reverse()), []);
    expect(h1).to.equal(h2);
  });

  it('changes when the body, callers, or side effects change', () => {
    const node = makeNode();
    const graph = makeGraph([node]);
    const base = evidenceHashForSymbol(node, graph, []);
    expect(evidenceHashForSymbol(makeNode({ bodyHash: 'b2' }), graph, [])).to.not.equal(base);
    expect(evidenceHashForSymbol(node, makeGraph([node], [
      { sourceKey: 'x.ts#y', targetKey: 'a.ts#fn', type: 'calls', confidence: 'high', metadata: {} },
    ]), [])).to.not.equal(base);
    expect(evidenceHashForSymbol(node, graph, [
      { nodeStableKey: 'a.ts', symbolStableKey: 'a.ts#fn', kind: 'database_write', filePath: 'a.ts' },
    ])).to.not.equal(base);
  });

  it('children hash is order-independent and sensitive to child evidence', () => {
    const a = { id: 'r1', evidenceHash: 'e1' };
    const b = { id: 'r2', evidenceHash: 'e2' };
    expect(evidenceHashForChildren([a, b])).to.equal(evidenceHashForChildren([b, a]));
    expect(evidenceHashForChildren([a, { ...b, evidenceHash: 'e3' }])).to.not.equal(evidenceHashForChildren([a, b]));
  });
});

describe('phase 5 — depth-layered cache lookup', () => {
  afterEach(() => __setQueryForTests(null));

  it('lookup order per spec: higher depth substitutes for lower, never the reverse', () => {
    expect(depthLookupOrder('full')).to.deep.equal(['full']);
    expect(depthLookupOrder('standard')).to.deep.equal(['full', 'standard']);
    expect(depthLookupOrder('cheap')).to.deep.equal(['full', 'standard', 'cheap']);
  });

  it('lookupRecord queries with the layered depth list and skips superseded rows', async () => {
    let captured: { text: string; params?: unknown[] } | null = null;
    __setQueryForTests(async (text, params) => {
      captured = { text, params };
      return { rows: [] } as never;
    });
    await lookupRecord({
      projectId: 'p', stableKey: 'a.ts#fn', level: 'symbol', evidenceHash: 'e',
      promptVersion: 'symbol-record-v1', depth: 'standard', modelFamily: 'm',
    });
    expect(captured!.text).to.include("status <> 'superseded'");
    expect(captured!.params?.[6]).to.deep.equal(['full', 'standard']);
  });

  it('insertRecord supersedes same-depth records with a different content key', async () => {
    const statements: string[] = [];
    __setQueryForTests(async (text) => {
      statements.push(text);
      return { rows: [{ id: 'new-record' }] } as never;
    });
    await insertRecord({
      key: { projectId: 'p', stableKey: 'a.ts#fn', level: 'symbol', evidenceHash: 'e2', promptVersion: 'v', depth: 'standard', modelFamily: 'm' },
      record: buildFactsOnlyBody({ graph: makeGraph([makeNode()]), sideEffects: [] }, makeNode()),
      summary: 's', confidence: 'medium', factsOnly: true, status: 'usable',
    });
    const supersede = statements.find((s) => s.includes("SET status = 'superseded'"));
    expect(supersede).to.include('semantic_depth = $4'); // never across depths
  });
});

describe('phase 5 — symbol batching (cross-file, 1M-context sizing)', () => {
  it('packs across files up to the symbol cap, keeping file locality', () => {
    // 20 + 3 + 20 symbols across three files: per-file batching would make
    // 4+ calls; cross-file packing fills every batch to the cap.
    const nodes = [
      ...Array.from({ length: 20 }, (_, i) => makeNode({ stableKey: `a.ts#f${i}`, name: `f${i}`, lineStart: i })),
      ...Array.from({ length: 3 }, (_, i) => makeNode({ stableKey: `b.ts#g${i}`, name: `g${i}`, filePath: 'b.ts', lineStart: i })),
      ...Array.from({ length: 20 }, (_, i) => makeNode({ stableKey: `c.ts#h${i}`, name: `h${i}`, filePath: 'c.ts', lineStart: i })),
    ];
    const batches = planBatches(nodes);
    expect(batches.length).to.equal(Math.ceil(43 / MAX_SYMBOLS_PER_CALL));
    expect(batches.flat().length).to.equal(43); // nothing dropped
    for (const batch of batches) expect(batch.length).to.be.at.most(MAX_SYMBOLS_PER_CALL);
    // Locality: symbols are sorted by file, so each file occupies a run of
    // CONSECUTIVE batches and files never interleave.
    for (const file of ['a.ts', 'b.ts', 'c.ts']) {
      const inBatches = batches
        .map((batch, idx) => (batch.some((n) => n.filePath === file) ? idx : -1))
        .filter((i) => i !== -1);
      expect(inBatches.length).to.be.greaterThan(0);
      expect(inBatches[inBatches.length - 1]! - inBatches[0]! + 1).to.equal(inBatches.length);
    }
  });

  it('splits batches when estimated input tokens exceed the request cap', () => {
    const bigSnippet = 'x'.repeat(48_000); // ~12k tokens each (capped at MAX_SNIPPET_CHARS)
    const nodes = Array.from({ length: 40 }, (_, i) => makeNode({ stableKey: `a.ts#f${i}`, name: `f${i}`, snippet: bigSnippet, lineStart: i }));
    const batches = planBatches(nodes);
    expect(batches.length).to.be.greaterThan(1);
    expect(batches.flat().length).to.equal(40); // nothing dropped
    for (const batch of batches) expect(batch.length).to.be.at.most(MAX_SYMBOLS_PER_CALL);
  });
});

describe('phase 5 — facts-only records', () => {
  it('renders purpose, callee narrative, and deterministic side effects', () => {
    const node = makeNode({ metadata: { purposeSignals: ['auth'] } });
    const graph = makeGraph([node], [
      { sourceKey: 'a.ts#fn', targetKey: 'b.ts#save', type: 'calls', confidence: 'high', metadata: {} },
    ]);
    const body = buildFactsOnlyBody({ graph, sideEffects: [
      { nodeStableKey: 'a.ts', symbolStableKey: 'a.ts#fn', kind: 'database_write', target: 'sessions', filePath: 'a.ts' },
    ] }, node);
    expect(body.purpose).to.include('auth');
    expect(body.dependencies_narrative).to.include('b.ts#save');
    expect(body.side_effects[0]).to.deep.include({ kind: 'database_write', mergedWithDeterministic: true });
    expect(body.claims).to.deep.equal([]);
    expect(renderSummary('fn', body)).to.include('fn:');
  });
});

describe('phase 5 — record schemas', () => {
  it('level schemas accept a conforming record and reject a broken one', () => {
    const body = buildFactsOnlyBody({ graph: makeGraph([makeNode()]), sideEffects: [] }, makeNode());
    expect(validateAgainstSchema(body, schemaForLevel('symbol'))).to.deep.equal([]);
    const fileBody = { ...body, key_symbols: ['a'], file_role: 'service' };
    expect(validateAgainstSchema(fileBody, schemaForLevel('file'))).to.deep.equal([]);
    expect(validateAgainstSchema({ ...body, confidence: 'certain' }, schemaForLevel('symbol'))).to.not.deep.equal([]);
  });

  it('batched symbol schema requires stable_key per record', () => {
    const schema = batchedSymbolSchema();
    const body = buildFactsOnlyBody({ graph: makeGraph([makeNode()]), sideEffects: [] }, makeNode());
    expect(validateAgainstSchema({ records: [{ ...body, stable_key: 'a.ts#fn' }] }, schema)).to.deep.equal([]);
    const missing = validateAgainstSchema({ records: [body] }, schema);
    expect(missing.some((v) => v.path.includes('stable_key'))).to.equal(true);
  });

  it('batched level schema carries the level extras plus stable_key (file batches)', () => {
    const schema = batchedLevelSchema('file');
    const body = buildFactsOnlyBody({ graph: makeGraph([makeNode()]), sideEffects: [] }, makeNode());
    const fileRecord = { ...body, key_symbols: ['a'], file_role: 'service', stable_key: 'a.ts' };
    expect(validateAgainstSchema({ records: [fileRecord] }, schema)).to.deep.equal([]);
    // Missing the file-level extras fails — the batch wrapper must not
    // loosen the per-level contract.
    const missingExtras = validateAgainstSchema({ records: [{ ...body, stable_key: 'a.ts' }] }, schema);
    expect(missingExtras.length).to.be.greaterThan(0);
  });
});

describe('phase 5 — services grouping and slugs', () => {
  const cluster = (key: string, member: string) => ({
    stableKey: key, label: key, kind: 'api_layer' as const, criticalScore: 0.5,
    deterministicSummary: '', members: [{ nodeStableKey: member, reason: '' }], metadata: {},
  });

  it('single-package repos get one app service holding every cluster', () => {
    const services = groupClustersIntoServices({
      inventory: { packages: [], configs: [], dockerServices: [], detectedFrameworks: [] },
      architecture: { clusters: [cluster('cluster:a', 'src/a.ts'), cluster('cluster:b', 'src/b.ts')], edges: [] },
    });
    expect(services).to.have.length(1);
    expect(services[0]!.clusterKeys).to.have.length(2);
  });

  it('workspace packages become services; unmatched clusters land in root', () => {
    const services = groupClustersIntoServices({
      inventory: {
        packages: [
          { root: 'backend', packageJsonPath: 'backend/package.json', name: '@x/backend', scripts: {}, dependencies: [], devDependencies: [], workspaces: [] },
        ],
        configs: [], dockerServices: [], detectedFrameworks: [],
      },
      architecture: { clusters: [cluster('cluster:api', 'backend/src/api.ts'), cluster('cluster:docs', 'scripts/x.ts')], edges: [] },
    });
    const backend = services.find((s) => s.stableKey === 'service:backend')!;
    const root = services.find((s) => s.stableKey === 'service:root')!;
    expect(backend.name).to.equal('@x/backend');
    expect(backend.clusterKeys).to.deep.equal(['cluster:api']);
    expect(root.clusterKeys).to.deep.equal(['cluster:docs']);
  });

  it('slugify produces stable keys', () => {
    expect(slugify('Team Management & Invitations!')).to.equal('team-management-invitations');
    expect(slugify('---')).to.equal('unnamed');
  });
});

/**
 * The regression this file exists to catch is silent: a capability that binds
 * to nothing still renders as a confident card, and nobody notices until a
 * reviewer opens the tab and asks what "Core Application Structure and
 * Utilities" is. The count is the assertion.
 */
describe('phase 5 — capability derivation binds or emits nothing', () => {
  const step = (order: number, key: string, kind: WorkflowStep['stepKind']): WorkflowStep => ({
    stepOrder: order, nodeStableKey: key, filePath: key.split('#')[0]!,
    symbolName: key.split('#')[1], stepKind: kind, deterministicDescription: `step ${order}`,
  });

  const flow = (over: Partial<ExtractedWorkflow> & { key: string; route?: string }): ExtractedWorkflow => ({
    title: over.title ?? over.key,
    triggerType: 'HTTP GET',
    purpose: 'p',
    stableKey: `wf:${over.key}`,
    confidence: 'high',
    entrypoint: {
      nodeStableKey: `src/${over.key}.ts`, kind: 'http_route',
      filePath: `src/${over.key}.ts`, symbolName: 'handler',
      symbolStableKey: `src/${over.key}.ts#handler`,
      ...(over.route ? { routePattern: over.route } : {}),
    },
    steps: over.steps ?? [step(1, `src/${over.key}.ts#handler`, 'trigger'), step(2, `src/${over.key}.ts#helper`, 'transform')],
    tier: over.tier ?? 'core',
    importanceScore: over.importanceScore ?? 0.5,
    rankingReasons: [], externalDependencies: [],
  });

  it('emits nothing when traced flows reach no schema table and no named service', () => {
    const derived = deriveCapabilities({
      // Two real routes, each traced past its trigger — but every effect they
      // reach is an unrecognized npm package, which is the honesty fallback,
      // not a service. v4 would have named 2-8 capabilities out of this.
      workflows: [flow({ key: 'pokedex', route: '/pokemon' }), flow({ key: 'filter', route: '/pokemon-filter' })],
      sideEffects: [
        { nodeStableKey: 'src/pokedex.ts', symbolStableKey: 'src/pokedex.ts#helper', kind: 'unknown_external', target: 'class-variance-authority', filePath: 'src/pokedex.ts' },
      ],
      graph: { nodes: [], edges: [] },
      architecture: { clusters: [], edges: [] },
    });
    expect(derived.capabilities).to.have.length(0);
    expect(derived.unbound.map((u) => u.missing)).to.deep.equal([
      'no schema table or external service reached',
      'no schema table or external service reached',
    ]);
    expect(derived.totals.consideredFlows).to.equal(2);
  });

  it('emits one capability per bound group, keyed on the table it writes', () => {
    const derived = deriveCapabilities({
      workflows: [
        flow({
          key: 'createProject', route: '/api/projects',
          steps: [
            step(1, 'src/createProject.ts#handler', 'trigger'),
            step(2, 'src/store.ts#insert', 'data_write'),
            step(3, 'schema:projects', 'data_write'),
          ],
        }),
        // Same table, different route: one capability, two flows.
        flow({
          key: 'deleteProject', route: '/api/projects/:id',
          steps: [
            step(1, 'src/deleteProject.ts#handler', 'trigger'),
            step(2, 'schema:projects', 'data_write'),
          ],
        }),
        // A page that reaches nothing stays out, and says why.
        flow({ key: 'about', route: '/about', tier: 'surface', steps: [step(1, 'src/about.ts#handler', 'trigger')] }),
      ],
      sideEffects: [],
      graph: {
        nodes: [{ stableKey: 'schema:projects', type: 'schema', name: 'projects', filePath: 'db/schema.sql', trustLevel: 'code', metadata: {} }],
        edges: [],
      },
      architecture: { clusters: [], edges: [] },
    });
    expect(derived.capabilities).to.have.length(1);
    const cap = derived.capabilities[0]!;
    expect(cap.key).to.equal('project');
    expect(cap.schemas).to.deep.equal(['projects']);
    expect(cap.flows.map((f) => f.stableKey)).to.deep.equal(['wf:createProject', 'wf:deleteProject']);
    // The seam is the effect site, not the file the capability was named for.
    expect(cap.whereToStart[0]!.stable_key).to.equal('src/createProject.ts#handler');
    expect(cap.whereToStart[1]!.stable_key).to.equal('src/store.ts#insert');
    expect(derived.unbound.map((u) => u.title)).to.deep.equal(['about']);
  });
});

describe('phase 5 — role projections', () => {
  afterEach(() => __setQueryForTests(null));

  it('every default role weight column sums to 1.0', () => {
    for (const [role, weights] of Object.entries(DEFAULT_ROLE_WEIGHTS)) {
      const sum = SEMANTIC_VIEWS.reduce((s, v) => s + weights[v], 0);
      expect(sum, role).to.be.closeTo(1.0, 1e-9);
    }
  });

  it('projects view scores through the weight table', () => {
    const scores = Object.fromEntries(SEMANTIC_VIEWS.map((v) => [v, 1])) as Record<(typeof SEMANTIC_VIEWS)[number], number>;
    expect(projectRoleScore(scores, DEFAULT_ROLE_WEIGHTS.backend)).to.be.closeTo(1.0, 1e-9);
    expect(projectRoleScore({ critical_for_runtime: 1 }, DEFAULT_ROLE_WEIGHTS.backend)).to.be.closeTo(0.2, 1e-9);
  });

  it('custom ranking_weight_configs override defaults per view', async () => {
    __setQueryForTests(async () => ({ rows: [{ weights: { critical_for_runtime: 0.9, bogus_view: 5 } }] }) as never);
    const weights = await resolveRoleWeights('p', 'backend');
    expect(weights.critical_for_runtime).to.equal(0.9);
    expect(weights.critical_for_business).to.equal(DEFAULT_ROLE_WEIGHTS.backend.critical_for_business);
    expect('bogus_view' in weights).to.equal(false);
  });
});

describe('phase 5 — deterministic rerank features', () => {
  const target: RerankTarget = {
    targetType: 'symbol', stableKey: 'routes/auth.ts#login', name: 'login', summary: 'login handler',
    candidateBreakdown: { sideEffects: 1, entrypointParticipation: 1, fanCentrality: 0.5, workflowParticipation: 1, churn: 0.4, routeSchemaOwnership: 1, configRelevance: 0, testProximity: 0.2 },
    candidateScore: 0.8, record: null, inCapability: true,
  };

  it('view features stay in [0,1] and reflect their signals', () => {
    const views = deterministicViewScores(target);
    for (const value of Object.values(views)) {
      expect(value).to.be.at.least(0).and.at.most(1);
    }
    expect(views.critical_for_workflow).to.equal(1);
    expect(views.critical_for_business).to.equal(0.5); // capability member, no record concepts
  });

  it('role features follow path/signal heuristics', () => {
    const roles = deterministicRoleScores(target);
    expect(roles.backend).to.be.greaterThan(roles.frontend);
    expect(roles.general).to.be.closeTo(0.8, 1e-9);
    const uiTarget = { ...target, stableKey: 'components/Button.tsx#Button', candidateBreakdown: {} };
    expect(deterministicRoleScores(uiTarget).frontend).to.be.greaterThan(0.5);
  });

  it('selects only targets covered by the semantic pass, capped to the top slice', () => {
    const record = {
      id: 'r1', stableKey: 'a.ts#fn', recordLevel: 'symbol' as const, semanticDepth: 'standard' as const,
      evidenceHash: 'e', promptVersion: PROMPT_VERSIONS.symbol, record: {} as never, summary: 's',
      confidence: 'medium' as const, factsOnly: false, status: 'usable' as const, receiptIds: [],
    };
    const targets = selectRerankTargets(
      {
        rankings: [
          { targetType: 'symbol', stableKey: 'a.ts#fn', score: 0.9, breakdown: {} as never, raw: {} as never, reasons: [] },
          { targetType: 'symbol', stableKey: 'b.ts#no-record', score: 0.8, breakdown: {} as never, raw: {} as never, reasons: [] },
        ],
        workflows: [], architecture: { clusters: [], edges: [] },
      },
      new Map([['a.ts#fn', record]]),
      { fileRecords: new Map(), moduleRecords: new Map(), serviceRecords: new Map(), systemRecord: null, workflowRecords: new Map(), cacheHits: 0, llmRecords: 0 },
      new Set(),
    );
    expect(targets.map((t) => t.stableKey)).to.deep.equal(['a.ts#fn']);
  });
});
