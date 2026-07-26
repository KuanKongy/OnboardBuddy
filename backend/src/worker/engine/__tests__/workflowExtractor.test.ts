import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, scanRepositoryFiles, detectRepoInventory } from '../repoIngester';
import { typescriptParser } from '../parserInterface';
import { detectEntrypoints } from '../entrypointDetector';
import { detectSideEffects } from '../sideEffectDetector';
import { scanConfigNodes } from '../configScanner';
import { ingestDocs } from '../docsIngester';
import { buildEvidenceGraph } from '../evidenceGraphBuilder';
import { extractWorkflows, extractWorkflowsDetailed, type ExtractedWorkflow } from '../workflowExtractor';
import type { EvidenceGraph } from '../../types/analysis';
import type { DetectedEntrypoint } from '../entrypointDetector';
import type { DetectedSideEffect } from '../sideEffectDetector';

const SIMPLE_DIR = path.resolve(__dirname, '../../fixtures/simple');
const MIXED_DIR = path.resolve(__dirname, '../../fixtures/mixed');
const CLASS_SERVER_DIR = path.resolve(__dirname, '../../fixtures/classServer');

async function buildFixtureGraph(dir: string): Promise<{
  graph: EvidenceGraph;
  entrypoints: DetectedEntrypoint[];
  sideEffects: DetectedSideEffect[];
}> {
  const records = await scanRepositoryFiles(dir);
  const inventory = await detectRepoInventory(dir, records);
  const index = await buildRepoIndex(dir);
  const ctx = await typescriptParser.createContext(index.files, dir);
  const fileAnalyses = index.files.map((f) => typescriptParser.parseFile(ctx, f));
  const entrypoints = detectEntrypoints(fileAnalyses);
  const sideEffects = detectSideEffects(fileAnalyses);
  const configNodes = scanConfigNodes(records, inventory);
  const docs = ingestDocs(records, new Set(records.map((r) => r.relativePath)));
  const graph = buildEvidenceGraph({
    fileAnalyses, fileRecords: records, entrypoints, sideEffects, configNodes, docs, rootPath: dir,
  });
  return { graph, entrypoints, sideEffects };
}

describe('workflowExtractor (call-graph traversal)', () => {
  let workflows: ExtractedWorkflow[];

  before(async () => {
    const { graph, entrypoints, sideEffects } = await buildFixtureGraph(SIMPLE_DIR);
    workflows = extractWorkflows({ graph, entrypoints, sideEffects });
  });

  it('extracts workflows from route entrypoints', () => {
    expect(workflows.length).to.be.greaterThan(0);
    const login = workflows.find((w) => w.stableKey.endsWith(':loginHandler'));
    expect(login, 'login workflow').to.exist;
  });

  it('first step of each workflow is a trigger with sequential step order', () => {
    for (const wf of workflows) {
      expect(wf.steps[0]!.stepKind).to.equal('trigger');
      wf.steps.forEach((s, i) => expect(s.stepOrder).to.equal(i + 1));
    }
  });

  it('traces the login flow through auth, persistence, schema, and response', () => {
    const login = workflows.find((w) => w.stableKey.endsWith(':loginHandler'))!;
    const kinds = login.steps.map((s) => s.stepKind);
    expect(kinds).to.include('auth_guard');    // AuthService.login
    expect(kinds).to.include('data_write');    // saveSession INSERT + sessions table
    expect(kinds[kinds.length - 1]).to.equal('response');

    const authStep = login.steps.find((s) => s.stepKind === 'auth_guard');
    expect(authStep!.symbolName).to.contain('login');
    const schemaStep = login.steps.find((s) => s.nodeStableKey.startsWith('schema:'));
    expect(schemaStep, 'schema table step').to.exist;
    expect(schemaStep!.deterministicDescription).to.contain('sessions');
  });

  it('collapses trivial helpers (signToken, formatLabel) out of the steps', () => {
    const login = workflows.find((w) => w.stableKey.endsWith(':loginHandler'))!;
    const symbols = login.steps.map((s) => s.symbolName ?? '');
    expect(symbols.join(' ')).to.not.contain('signToken');
    expect(symbols.join(' ')).to.not.contain('formatLabel');
  });

  it('classifies purpose deterministically from trigger and outcomes', () => {
    const login = workflows.find((w) => w.stableKey.endsWith(':loginHandler'))!;
    expect(login.purpose).to.contain('writes data');
    expect(login.purpose).to.contain('responds to the caller');
    expect(login.triggerType).to.contain('HTTP');
  });

  /**
   * Purpose used to carry a domain phrase from a seven-row table keyed on path
   * and symbol substrings — this product's own vocabulary, stamped onto every
   * repo analysed. A student club's marketing site was told its About page
   * existed for "onboarding generation" (`src/components/sections/`), its Team
   * page for "project management", and `Toaster` for "repository analysis"
   * (`/ast/` inside to·ast·er). The subject now comes from the flow's own
   * evidence or it is absent.
   */
  it('names only what the flow itself reaches, never a product-domain phrase', () => {
    const login = workflows.find((w) => w.stableKey.endsWith(':loginHandler'))!;
    // `sessions` is this fixture's own table, from its own migration.
    expect(login.purpose).to.contain('on sessions');

    const domainPhrases = [
      'onboarding generation', 'project management', 'repository analysis',
      'github integration', 'authentication', 'configuration', '(ui)',
    ];
    for (const wf of workflows) {
      for (const phrase of domainPhrases) {
        expect(wf.purpose.toLowerCase(), `"${wf.purpose}" must not assert a domain`).to.not.contain(phrase);
      }
    }
  });

  it('says nothing about a subject when the flow reaches no named resource', () => {
    const logout = workflows.find((w) => w.stableKey.endsWith(':logoutHandler'))!;
    expect(logout.purpose).to.not.contain(' on ');
    expect(logout.purpose).to.not.contain(' against ');
  });

  it('sorts workflows by importance score descending', () => {
    for (let i = 1; i < workflows.length; i++) {
      expect(workflows[i]!.importanceScore).to.be.at.most(workflows[i - 1]!.importanceScore);
    }
  });

  it('never claims effects it did not trace (mixed fixture)', async () => {
    // Previously this asserted the list was EMPTY. Dropping these hid real
    // entry points: a repo with forty routes and no traceable effects reported
    // no workflows at all, which reads as "this system does nothing". They are
    // listed now — but as `surface`, explicitly labelled as having no traced
    // effects. The honesty guarantee is that nothing is *invented*, not that
    // nothing is shown.
    const { graph, entrypoints, sideEffects } = await buildFixtureGraph(MIXED_DIR);
    const mixedWorkflows = extractWorkflows({ graph, entrypoints, sideEffects });

    for (const wf of mixedWorkflows) {
      expect(wf.tier, `${wf.title} should be surface`).to.equal('surface');
      const effectKinds = wf.steps.map((s) => s.stepKind)
        .filter((k) => ['data_read', 'data_write', 'async_work', 'side_effect'].includes(k));
      expect(effectKinds, `${wf.title} must not claim effects`).to.deep.equal([]);
    }
  });

  it('records dead-ends alongside the surface entries they describe (honesty rule)', async () => {
    const { graph, entrypoints, sideEffects } = await buildFixtureGraph(MIXED_DIR);
    const { workflows: mixedWorkflows, deadEnds } = extractWorkflowsDetailed({ graph, entrypoints, sideEffects });

    expect(deadEnds.length, 'dead ends recorded').to.be.greaterThan(0);
    for (const de of deadEnds) {
      expect(de.reason).to.be.oneOf(['no_calls_traced', 'no_effects_reached']);
      expect(de.entrypoint).to.be.a('string').and.not.equal('');
    }
    // Listing the entry point and recording why its trace died are no longer
    // mutually exclusive — the trust panel keeps its input either way.
    expect(mixedWorkflows.every((w) => w.tier === 'surface')).to.equal(true);
  });

  it('seeds bare-reference queue consumers at the referenced handler (SUMMARY-consumer regression)', () => {
    const wf = workflows.find((w) => w.title === 'Queue consumer: SUMMARY_QUEUE');
    expect(wf, 'summary consumer workflow').to.exist;
    // The trace must run through the referenced handler's real call flow.
    expect(wf!.steps.map((s) => s.stepKind)).to.include('data_write');
    expect(wf!.steps[0]!.nodeStableKey).to.contain('#processSummaryJob');
    expect(wf!.triggerType).to.equal('message_consumer');
  });

  it('keeps auth workflows whose only effects are identity-SDK calls (User Auth journey)', () => {
    const login = workflows.find((w) => w.stableKey.endsWith(':supabaseLoginHandler'));
    expect(login, 'supabase login workflow').to.exist;
    const kinds = login!.steps.map((s) => s.stepKind);
    expect(kinds).to.include('auth_guard');
    const authStep = login!.steps.find((s) => s.stepKind === 'auth_guard')!;
    expect(authStep.deterministicDescription).to.contain('supabase.auth');

    const logout = workflows.find((w) => w.stableKey.endsWith(':supabaseLogoutHandler'));
    expect(logout, 'supabase logout workflow').to.exist;
  });

  it('tiers an identity-SDK login as core: authentication state IS state', () => {
    // Contract change. The test above only guaranteed these workflows EXIST;
    // their tier was `supporting`, because effect accounting counted rows,
    // jobs and outbound calls and nothing else. That put every login and
    // signup below read-only endpoints in the rail and out of reach of the
    // tutorial selector, which is silent — the flows are still listed, just
    // mis-ranked — so it is pinned here.
    const login = workflows.find((w) => w.stableKey.endsWith(':supabaseLoginHandler'))!;
    expect(login.tier, 'a user-triggered flow whose effect is auth state is core').to.equal('core');
    expect(login.rankingReasons.join(' ')).to.contain('changes who is signed in');
    expect(login.rankingReasons.join(' '), 'must not claim it traced no effects')
      .to.not.contain('no side effects traced');
  });

  it('traces queue-consumer registrations into pipeline workflows (audit P2 §15)', () => {
    const wf = workflows.find((w) => w.title === 'Queue consumer: reports');
    expect(wf, 'queue consumer workflow').to.exist;
    // The closure's call flow (saveSession -> sessions table) must trace.
    expect(wf!.steps.map((s) => s.stepKind)).to.include('data_write');
    expect(wf!.triggerType).to.equal('message_consumer');
  });

  it("surfaces the seed handler's own writes and enqueues as explicit steps (audit §5.4)", () => {
    const wf = workflows.find((w) => w.stableKey.endsWith(':enqueueReportHandler'));
    expect(wf, 'enqueueReport workflow').to.exist;
    const kinds = wf!.steps.map((s) => s.stepKind);
    // The INSERT and the queue.add live in the trigger's own body — they
    // used to vanish behind the 'trigger' step kind.
    expect(kinds).to.include('data_write');
    expect(kinds).to.include('async_work');
    expect(wf!.steps.some((s) => s.metadata?.syntheticSeedEffect)).to.equal(true);
    expect(kinds[0]).to.equal('trigger');
  });
});

describe('workflowExtractor (class-method route handlers — CourseInsights regression)', () => {
  let workflows: ExtractedWorkflow[];
  let entrypoints: DetectedEntrypoint[];

  before(async () => {
    const built = await buildFixtureGraph(CLASS_SERVER_DIR);
    entrypoints = built.entrypoints;
    workflows = extractWorkflows({ graph: built.graph, entrypoints, sideEffects: built.sideEffects });
  });

  it('resolves class-method handlers to class-qualified symbol keys', () => {
    const echo = entrypoints.find((e) => e.routePattern === '/echo/:msg');
    expect(echo, 'echo entrypoint').to.exist;
    expect(echo!.symbolStableKey).to.equal('src/rest/Server.ts#Server.echo');
    const put = entrypoints.find((e) => e.routePattern === '/dataset/:id/:kind');
    expect(put, 'addDataset entrypoint').to.exist;
    expect(put!.symbolStableKey).to.equal('src/controller/InsightFacade.ts#InsightFacade.addDataset');
  });

  it('does not turn test/controller spec files into route entrypoints', () => {
    const testEps = entrypoints.filter((e) => e.filePath.startsWith('test/'));
    expect(testEps).to.deep.equal([]);
  });

  it('extracts a workflow for a route handled by a facade method', () => {
    const put = workflows.find((w) => w.title.includes('/dataset/:id/:kind'));
    expect(put, 'PUT /dataset workflow').to.exist;
    const keys = put!.steps.map((s) => s.nodeStableKey);
    expect(keys[0]).to.equal('src/controller/InsightFacade.ts#InsightFacade.addDataset');
    expect(keys).to.include('src/datasetProcessor/DatasetProcessor.ts#DatasetProcessor.processAddDataset');
  });

  it('extracts a workflow for a route handled by a static class method', () => {
    const echo = workflows.find((w) => w.title.includes('/echo/:msg'));
    expect(echo, 'GET /echo workflow').to.exist;
    expect(echo!.steps[0]!.nodeStableKey).to.equal('src/rest/Server.ts#Server.echo');
  });

  it('extracts a workflow for a route handled by an arrow-property class member', () => {
    const post = entrypoints.find((e) => e.routePattern === '/query');
    expect(post, 'performQuery entrypoint').to.exist;
    expect(post!.symbolStableKey).to.equal('src/rest/Server.ts#Server.performQuery');
    const query = workflows.find((w) => w.title.includes('POST /query'));
    expect(query, 'POST /query workflow').to.exist;
    expect(query!.steps[0]!.nodeStableKey).to.equal('src/rest/Server.ts#Server.performQuery');
    expect(query!.steps.map((s) => s.nodeStableKey)).to.include('src/queryProcessor/QueryRunner.ts#QueryRunner.runQuery');
  });
});
