import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, scanRepositoryFiles, detectRepoInventory } from '../repoIngester';
import { typescriptParser } from '../parserInterface';
import { detectEntrypoints } from '../entrypointDetector';
import { detectSideEffects } from '../sideEffectDetector';
import { scanConfigNodes } from '../configScanner';
import { ingestDocs } from '../docsIngester';
import { buildEvidenceGraph } from '../evidenceGraphBuilder';
import { extractWorkflows, type ExtractedWorkflow, type WorkflowStep } from '../workflowExtractor';
import { composeJourneys, composeJourneysDetailed } from '../journeyComposer';
import { validateGoldenJourneys } from '../journeyGate';
import type { DetectedEntrypoint } from '../entrypointDetector';
import type { DetectedSideEffect } from '../sideEffectDetector';

const SIMPLE_DIR = path.resolve(__dirname, '../../fixtures/simple');

/**
 * Journey composition + golden gate (TUTORIAL_REDESIGN.md §1, OWNER_FEEDBACK_M4
 * A1). CONTRACT CHANGE from the recipe era: journeys are no longer categories
 * (`golden_kind: 'pipeline' | 'auth' | 'import'`) matched by route-name regexes.
 * They are chains linked by typed, receipted continuation boundaries, so these
 * fixtures assert boundary KINDS and their guards instead of category names —
 * the auth-route-group and oauth-route-chain fixtures are gone with the recipes
 * they tested, and the gate no longer penalizes a repo for owning routes whose
 * names look like a login.
 */

function wf(over: {
  stableKey: string;
  title: string;
  entrypoint: Partial<DetectedEntrypoint>;
  steps?: Array<Partial<WorkflowStep> & { stepKind: WorkflowStep['stepKind'] }>;
  importanceScore?: number;
  purpose?: string;
}): ExtractedWorkflow {
  const filePath = over.entrypoint.filePath ?? 'src/api/routes/x.ts';
  return {
    title: over.title,
    triggerType: over.entrypoint.kind === 'http_route' ? `HTTP ${over.entrypoint.method ?? 'GET'}` : (over.entrypoint.kind ?? 'http_route'),
    purpose: over.purpose ?? over.title,
    stableKey: over.stableKey,
    confidence: 'high',
    entrypoint: {
      nodeStableKey: filePath,
      kind: 'http_route',
      filePath,
      ...over.entrypoint,
    } as DetectedEntrypoint,
    steps: (over.steps ?? [{ stepKind: 'trigger' }]).map((s, i) => ({
      stepOrder: i + 1,
      nodeStableKey: s.nodeStableKey ?? `${filePath}#h${i}`,
      filePath,
      stepKind: s.stepKind,
      deterministicDescription: s.deterministicDescription ?? `${s.stepKind} step`,
      ...(s.metadata ? { metadata: s.metadata } : {}),
    })),
    importanceScore: over.importanceScore ?? 1,
    externalDependencies: [],
  } as ExtractedWorkflow;
}

const boundaryKinds = (j: ExtractedWorkflow): string[] =>
  ((j.metadata!.journey as { boundaries: Array<{ kind: string }> }).boundaries).map((b) => b.kind);

describe('journeyComposer', () => {
  it('chains publish -> consumer -> chained consumer as async_token boundaries', () => {
    const analyzeRoute = wf({
      stableKey: 'wf:routes/projects.ts:analyzeHandler',
      title: 'POST /api/projects/:id/analyze',
      entrypoint: { kind: 'http_route', method: 'POST', routePattern: '/api/projects/:id/analyze', filePath: 'routes/projects.ts' },
      steps: [
        { stepKind: 'trigger', nodeStableKey: 'routes/projects.ts#analyzeHandler' },
        { stepKind: 'async_work', nodeStableKey: 'routes/projects.ts#analyzeHandler' },
      ],
      importanceScore: 3,
    });
    const analysisConsumer = wf({
      stableKey: 'wf:worker/index.ts:worker',
      title: 'Queue consumer: ANALYSIS_QUEUE',
      entrypoint: { kind: 'message_consumer', routePattern: 'ANALYSIS_QUEUE', filePath: 'worker/index.ts' },
      steps: [
        { stepKind: 'trigger', nodeStableKey: 'worker/index.ts#worker' },
        { stepKind: 'data_write', nodeStableKey: 'worker/index.ts#processAnalysisJob' },
      ],
      importanceScore: 4.6,
    });
    const summaryConsumer = wf({
      stableKey: 'wf:worker/summaryWorker.ts:processSummaryJob',
      title: 'Queue consumer: SUMMARY_QUEUE',
      entrypoint: { kind: 'message_consumer', routePattern: 'SUMMARY_QUEUE', filePath: 'worker/summaryWorker.ts' },
      steps: [
        { stepKind: 'trigger', nodeStableKey: 'worker/summaryWorker.ts#processSummaryJob' },
        { stepKind: 'data_write', nodeStableKey: 'worker/summaryWorker.ts#processSummaryJob' },
      ],
      importanceScore: 4,
    });
    const sideEffects: DetectedSideEffect[] = [
      {
        nodeStableKey: 'routes/projects.ts', symbolStableKey: 'routes/projects.ts#analyzeHandler',
        filePath: 'routes/projects.ts', kind: 'message_publish', target: 'analyze_scope',
        queueHint: 'analysi', evidence: 'getAnalysisQueue().add',
      },
      {
        nodeStableKey: 'worker/index.ts', symbolStableKey: 'worker/index.ts#processAnalysisJob',
        filePath: 'worker/index.ts', kind: 'message_publish', target: 'generate_summary',
        queueHint: 'summary', evidence: 'getSummaryQueue().add',
      },
    ];

    const journeys = composeJourneys({
      workflows: [analyzeRoute, analysisConsumer, summaryConsumer],
      sideEffects,
    });
    expect((journeys[0]!.metadata!.journey as { members: string[] }).members).to.deep.equal([
      'wf:routes/projects.ts:analyzeHandler',
      'wf:worker/index.ts:worker',
      'wf:worker/summaryWorker.ts:processSummaryJob',
    ]);
    expect(boundaryKinds(journeys[0]!)).to.deep.equal(['async_token', 'async_token']);
  });

  it('forms no boundary when a hand-off token matches two consumer registrations', () => {
    const publisher = wf({
      stableKey: 'wf:pub', title: 'POST /api/jobs',
      entrypoint: { kind: 'http_route', method: 'POST', routePattern: '/api/jobs', filePath: 'routes/jobs.ts' },
      steps: [{ stepKind: 'trigger', nodeStableKey: 'routes/jobs.ts#create' }],
    });
    const mkConsumer = (key: string, file: string) => wf({
      stableKey: key, title: `Queue consumer: ${key}`,
      entrypoint: { kind: 'message_consumer', routePattern: 'REPORTS_QUEUE', filePath: file },
      steps: [{ stepKind: 'trigger', nodeStableKey: `${file}#run` }],
    });
    const { journeys, unknowns } = composeJourneysDetailed({
      workflows: [publisher, mkConsumer('wf:c1', 'worker/a.ts'), mkConsumer('wf:c2', 'worker/b.ts')],
      sideEffects: [{
        nodeStableKey: 'routes/jobs.ts', symbolStableKey: 'routes/jobs.ts#create',
        filePath: 'routes/jobs.ts', kind: 'message_publish', queueHint: 'report', evidence: 'reportQueue.add',
      }],
    });
    expect(journeys).to.deep.equal([]);
    expect(unknowns[0]!.kind).to.equal('ambiguous_handoff_token');
  });

  it('links a creator to an id-addressed operator, and refuses it once the target has many writers', () => {
    const write = (key: string, symbol: string): DetectedSideEffect => ({
      nodeStableKey: 'routes/projects.ts', symbolStableKey: symbol, filePath: 'routes/projects.ts',
      kind: 'database_write', target: 'projects', evidence: '.insertOne(', confidence: 'high',
    });
    const creator = wf({
      stableKey: 'wf:create', title: 'POST /api/projects',
      entrypoint: { kind: 'http_route', method: 'POST', routePattern: '/api/projects', filePath: 'routes/projects.ts' },
      steps: [{ stepKind: 'trigger', nodeStableKey: 'routes/projects.ts#create' },
              { stepKind: 'data_write', nodeStableKey: 'routes/projects.ts#create' }],
    });
    const operator = wf({
      stableKey: 'wf:get', title: 'GET /api/projects/:id',
      entrypoint: { kind: 'http_route', method: 'GET', routePattern: '/api/projects/:id', filePath: 'routes/projects.ts' },
      steps: [{ stepKind: 'trigger', nodeStableKey: 'routes/projects.ts#getOne' },
              { stepKind: 'data_read', nodeStableKey: 'routes/projects.ts#getOne' }],
    });
    const readEffect: DetectedSideEffect = {
      nodeStableKey: 'routes/projects.ts', symbolStableKey: 'routes/projects.ts#getOne',
      filePath: 'routes/projects.ts', kind: 'database_read', target: 'projects', evidence: '.findOne(',
    };
    const linked = composeJourneys({
      workflows: [creator, operator],
      sideEffects: [write('wf:create', 'routes/projects.ts#create'), readEffect],
    });

    // Same shape, but four distinct flows write the target: an entity everything
    // touches is not one entity's lifecycle (§1.1 guard).
    const crowd = ['a', 'b', 'c'].map((n) => wf({
      stableKey: `wf:${n}`, title: `POST /api/${n}`,
      entrypoint: { kind: 'http_route', method: 'POST', routePattern: `/api/${n}`, filePath: 'routes/projects.ts' },
      steps: [{ stepKind: 'data_write', nodeStableKey: `routes/projects.ts#${n}` }],
    }));
    const crowded = composeJourneys({
      workflows: [creator, operator, ...crowd],
      sideEffects: [
        write('wf:create', 'routes/projects.ts#create'), readEffect,
        ...['a', 'b', 'c'].map((n) => write(`wf:${n}`, `routes/projects.ts#${n}`)),
      ],
    });

    expect(linked.map(boundaryKinds)).to.deep.equal([['resource_lifecycle']]);
    expect(crowded).to.deep.equal([]);
  });

  it('composes the hand-off chain on the simple fixture end-to-end', async () => {
    const records = await scanRepositoryFiles(SIMPLE_DIR);
    const inventory = await detectRepoInventory(SIMPLE_DIR, records);
    const index = await buildRepoIndex(SIMPLE_DIR);
    const ctx = await typescriptParser.createContext(index.files, SIMPLE_DIR);
    const fileAnalyses = index.files.map((f) => typescriptParser.parseFile(ctx, f));
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const configNodes = scanConfigNodes(records, inventory);
    const docs = ingestDocs(records, new Set(records.map((r) => r.relativePath)));
    const graph = buildEvidenceGraph({
      fileAnalyses, fileRecords: records, entrypoints, sideEffects, configNodes, docs, rootPath: SIMPLE_DIR,
    });
    const workflows = extractWorkflows({ graph, entrypoints, sideEffects });
    const journeys = composeJourneys({ workflows, sideEffects, nodes: graph.nodes });

    const chain = journeys.find((j) => boundaryKinds(j).includes('async_token'));
    expect(chain, 'fixture hand-off journey (enqueueReportHandler -> reports consumer)').to.exist;
    const memberTitles = (chain!.metadata!.journey as { member_titles: string[] }).member_titles;
    expect(memberTitles.some((t) => t === 'Queue consumer: reports')).to.equal(true);
  });
});

describe('journeyGate (golden-journey validation)', () => {
  const consumerEp: DetectedEntrypoint = {
    nodeStableKey: 'worker/index.ts', kind: 'message_consumer',
    routePattern: 'ANALYSIS_QUEUE', filePath: 'worker/index.ts',
  };
  const enqueueEffect: DetectedSideEffect = {
    nodeStableKey: 'routes/projects.ts', filePath: 'routes/projects.ts',
    kind: 'message_publish', target: 'analyze_scope', queueHint: 'analysi',
  };

  it('flags a detectable queue pair with no spanning journey as a gap', () => {
    const result = validateGoldenJourneys({
      workflows: [], entrypoints: [consumerEp], sideEffects: [enqueueEffect], hasCompose: false,
    });
    expect(result.gaps.some((g) => g.expected === 'queue_pipeline')).to.equal(true);
  });

  it('passes when a journey spans the token', () => {
    const journey = wf({
      stableKey: 'journey:routes/projects.ts:analyze', title: 'Analysis pipeline',
      entrypoint: { kind: 'http_route', routePattern: '/x' },
    });
    journey.triggerType = 'journey';
    journey.metadata = {
      journey: {
        members: [],
        // CONTRACT CHANGE: the spanned token is a field now, not prose to regex.
        boundaries: [{ after: 0, kind: 'async_token', token: 'analysi', detail: "token 'analysi' crosses", receipts: [] }],
      },
    };
    const result = validateGoldenJourneys({
      workflows: [journey], entrypoints: [consumerEp], sideEffects: [enqueueEffect], hasCompose: false,
    });
    expect(result.passes).to.include('queue_pipeline:analysi');
    expect(result.gaps).to.deep.equal([]);
  });

  it('never asks for a journey a repo has no boundary evidence for, and still requires the dev journey with compose', () => {
    // CONTRACT CHANGE: two routes whose paths read like a login used to be
    // enough to demand an "auth" journey. Now only detected boundary evidence
    // (issuance + guard, a matched token, a lifecycle) can demand a chain.
    const authish = ['/api/auth/login', '/api/auth/signup'].map((route, i) => wf({
      stableKey: `wf:${i}`, title: `POST ${route}`,
      entrypoint: { kind: 'http_route', method: 'POST', routePattern: route },
    }));
    const result = validateGoldenJourneys({
      workflows: authish, entrypoints: [], sideEffects: [], hasCompose: true,
    });
    expect(result.gaps).to.deep.equal([{ kind: 'journey_gap', expected: 'local_dev' }]);

    const clean = validateGoldenJourneys({
      workflows: [], entrypoints: [], sideEffects: [], hasCompose: false,
    });
    expect(clean.gaps).to.deep.equal([]);
  });
});
