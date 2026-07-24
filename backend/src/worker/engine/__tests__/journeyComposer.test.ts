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
import { composeJourneys } from '../journeyComposer';
import { validateGoldenJourneys } from '../journeyGate';
import type { DetectedEntrypoint } from '../entrypointDetector';
import type { DetectedSideEffect } from '../sideEffectDetector';

const SIMPLE_DIR = path.resolve(__dirname, '../../fixtures/simple');

/**
 * Journey composition + golden gate (ONBOARDING_UX_GOALS.md items 3 and 7):
 * deterministic stitching across queue boundaries and route groups, and the
 * shape-conditional assertion that detectable journeys actually composed.
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
  };
}

describe('journeyComposer', () => {
  it('stitches enqueue -> consumer -> chained consumer into one pipeline journey', () => {
    const analyzeRoute = wf({
      stableKey: 'wf:routes/projects.ts:analyzeHandler',
      title: 'POST /api/projects/:id/analyze',
      entrypoint: { kind: 'http_route', method: 'POST', routePattern: '/api/projects/:id/analyze' },
      steps: [
        { stepKind: 'trigger', nodeStableKey: 'routes/projects.ts#analyzeHandler' },
        { stepKind: 'async_work', nodeStableKey: 'routes/projects.ts#analyzeHandler' },
      ],
      importanceScore: 3,
      purpose: 'Handles POST analyze (repository analysis): enqueues async work',
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
      purpose: 'Handles message consumer (repository analysis): writes data',
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
      purpose: 'Handles message consumer (onboarding generation): writes data',
    });
    const sideEffects: DetectedSideEffect[] = [
      {
        nodeStableKey: 'routes/projects.ts', symbolStableKey: 'routes/projects.ts#analyzeHandler',
        filePath: 'routes/projects.ts', kind: 'message_publish', target: 'analyze_scope', queueHint: 'analysi',
      },
      {
        nodeStableKey: 'worker/index.ts', symbolStableKey: 'worker/index.ts#processAnalysisJob',
        filePath: 'worker/index.ts', kind: 'message_publish', target: 'generate_summary', queueHint: 'summary',
      },
    ];

    const journeys = composeJourneys({
      workflows: [analyzeRoute, analysisConsumer, summaryConsumer],
      sideEffects,
    });
    const pipeline = journeys.find((j) =>
      (j.metadata?.journey as { golden_kind?: string }).golden_kind === 'pipeline');
    expect(pipeline, 'pipeline journey').to.exist;
    expect(pipeline!.triggerType).to.equal('journey');
    const members = (pipeline!.metadata!.journey as { members: string[] }).members;
    expect(members).to.deep.equal([
      'wf:routes/projects.ts:analyzeHandler',
      'wf:worker/index.ts:worker',
      'wf:worker/summaryWorker.ts:processSummaryJob',
    ]);
    // Two queue boundaries, annotated as steps.
    const boundarySteps = pipeline!.steps.filter((s) => s.metadata?.journeyBoundary === 'queue');
    expect(boundarySteps).to.have.length(2);
    expect(pipeline!.title).to.equal('Analysis → onboarding generation pipeline');
    // Ranks above its best member.
    expect(pipeline!.importanceScore).to.be.greaterThan(4.6);
  });

  it('groups auth routes into a User authentication journey in canonical order', () => {
    const mk = (key: string, method: string, route: string) => wf({
      stableKey: `wf:auth:${key}`, title: `${method} ${route}`,
      entrypoint: { kind: 'http_route', method, routePattern: route },
      steps: [{ stepKind: 'trigger' }, { stepKind: 'auth_guard' }],
    });
    const journeys = composeJourneys({
      workflows: [
        mk('me', 'GET', '/api/auth/me'),
        mk('logout', 'POST', '/api/auth/logout'),
        mk('signup', 'POST', '/api/auth/signup'),
        mk('login', 'POST', '/api/auth/login'),
      ],
      sideEffects: [],
    });
    const auth = journeys.find((j) =>
      (j.metadata?.journey as { golden_kind?: string }).golden_kind === 'auth');
    expect(auth, 'auth journey').to.exist;
    expect(auth!.title).to.equal('User authentication');
    const members = (auth!.metadata!.journey as { member_titles: string[] }).member_titles;
    expect(members).to.deep.equal([
      'POST /api/auth/signup', 'POST /api/auth/login', 'GET /api/auth/me', 'POST /api/auth/logout',
    ]);
  });

  it('chains OAuth start -> callback -> link and appends the terminal project-create POST', () => {
    const journeys = composeJourneys({
      workflows: [
        wf({
          stableKey: 'wf:gh:complete', title: 'POST /api/github/oauth/complete',
          entrypoint: { kind: 'http_route', method: 'POST', routePattern: '/api/github/oauth/complete' },
        }),
        wf({
          stableKey: 'wf:gh:start', title: 'GET /api/github/oauth/start',
          entrypoint: { kind: 'http_route', method: 'GET', routePattern: '/api/github/oauth/start' },
        }),
        wf({
          stableKey: 'wf:gh:link', title: 'POST /api/github/installations/link',
          entrypoint: { kind: 'http_route', method: 'POST', routePattern: '/api/github/installations/link' },
        }),
        wf({
          stableKey: 'wf:projects:create', title: 'POST /api/projects',
          entrypoint: { kind: 'http_route', method: 'POST', routePattern: '/api/projects' },
          steps: [{ stepKind: 'trigger' }, { stepKind: 'data_write' }],
          purpose: 'Handles POST /api/projects (github integration): writes data',
        }),
      ],
      sideEffects: [],
    });
    const imp = journeys.find((j) =>
      (j.metadata?.journey as { golden_kind?: string }).golden_kind === 'import');
    expect(imp, 'import journey').to.exist;
    const members = (imp!.metadata!.journey as { member_titles: string[] }).member_titles;
    expect(members).to.deep.equal([
      'GET /api/github/oauth/start',
      'POST /api/github/oauth/complete',
      'POST /api/github/installations/link',
      'POST /api/projects',
    ]);
    const boundaries = (imp!.metadata!.journey as { boundaries: Array<{ kind: string }> }).boundaries;
    expect(boundaries[0]!.kind).to.equal('redirect');
  });

  it('composes the queue pipeline on the simple fixture end-to-end', async () => {
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
    const journeys = composeJourneys({ workflows, sideEffects });

    const pipeline = journeys.find((j) =>
      (j.metadata?.journey as { golden_kind?: string }).golden_kind === 'pipeline');
    expect(pipeline, 'fixture pipeline journey (enqueueReportHandler -> reports consumer)').to.exist;
    const memberTitles = (pipeline!.metadata!.journey as { member_titles: string[] }).member_titles;
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

  it('passes when the pipeline journey spans the queue', () => {
    const journey = wf({
      stableKey: 'journey:pipeline:analysi', title: 'Analysis pipeline',
      entrypoint: { kind: 'http_route', routePattern: '/x' },
    });
    journey.triggerType = 'journey';
    journey.metadata = {
      journey: {
        golden_kind: 'pipeline',
        members: [],
        boundaries: [{ after: 0, kind: 'queue', detail: "job 'analyze_scope' crosses queue 'analysi' to Queue consumer: ANALYSIS_QUEUE" }],
      },
    };
    const result = validateGoldenJourneys({
      workflows: [journey], entrypoints: [consumerEp], sideEffects: [enqueueEffect], hasCompose: false,
    });
    expect(result.passes).to.include('queue_pipeline:analysi');
    expect(result.gaps).to.deep.equal([]);
  });

  it('requires an auth journey only when auth routes exist, and a dev journey only with compose', () => {
    const authWf = wf({
      stableKey: 'wf:a', title: 'POST /api/auth/login',
      entrypoint: { kind: 'http_route', method: 'POST', routePattern: '/api/auth/login' },
    });
    const authWf2 = wf({
      stableKey: 'wf:b', title: 'POST /api/auth/signup',
      entrypoint: { kind: 'http_route', method: 'POST', routePattern: '/api/auth/signup' },
    });
    const result = validateGoldenJourneys({
      workflows: [authWf, authWf2], entrypoints: [], sideEffects: [], hasCompose: true,
    });
    expect(result.gaps.some((g) => g.expected === 'auth')).to.equal(true);
    expect(result.gaps.some((g) => g.expected === 'local_dev')).to.equal(true);

    const clean = validateGoldenJourneys({
      workflows: [], entrypoints: [], sideEffects: [], hasCompose: false,
    });
    expect(clean.gaps).to.deep.equal([]);
  });
});
