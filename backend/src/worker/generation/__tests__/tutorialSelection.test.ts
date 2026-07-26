import { expect } from 'chai';
import { pickDiverseWorkflows, workflowFamily } from '../tutorialGenerator.js';
import { attemptTraceProcedure, buildRunEnvironment, type TraceInput } from '../tutorialProcedure.js';

/**
 * Audit §5.3: tutorial selection filled every slot with trivial reads. The
 * dogfood failure shape — five GETs outscoring the write/enqueue flows —
 * must never fully occupy the selection again.
 */
describe('tutorialGenerator.pickDiverseWorkflows', () => {
  const wf = (title: string, score: number, trigger: string) => ({
    row: title,
    score,
    family: workflowFamily(trigger),
  });

  it('caps read-only families at two and pulls writes up', () => {
    const picked = pickDiverseWorkflows(
      [
        wf('GET a', 0.9, 'HTTP GET'),
        wf('GET b', 0.8, 'HTTP GET'),
        wf('GET c', 0.7, 'HTTP GET'),
        wf('GET d', 0.6, 'HTTP GET'),
        wf('POST analyze', 0.5, 'HTTP POST'),
        wf('page render', 0.4, 'UI page'),
      ],
      4,
    );
    expect(picked).to.deep.equal(['GET a', 'GET b', 'POST analyze', 'page render']);
  });

  it('backfills past the cap when nothing else is left', () => {
    const picked = pickDiverseWorkflows(
      [wf('GET a', 0.9, 'HTTP GET'), wf('GET b', 0.8, 'HTTP GET'), wf('GET c', 0.7, 'HTTP GET')],
      3,
    );
    expect(picked).to.deep.equal(['GET a', 'GET b', 'GET c']);
  });

  it('families: GETs and pages are capped, verbs and jobs are not', () => {
    expect(workflowFamily('HTTP GET')).to.equal('read_route');
    expect(workflowFamily('UI page')).to.equal('ui');
    expect(workflowFamily('HTTP POST')).to.equal('write_route');
    expect(workflowFamily('worker_job')).to.equal('worker_job');
  });

  it('journeys and dev commands form their own uncapped families (journey-first selection)', () => {
    expect(workflowFamily('journey')).to.equal('journey');
    expect(workflowFamily('dev_command')).to.equal('dev_command');
  });
});

/**
 * The two gates that keep this tab from sliding back into being a second
 * sections tab. Both failures are SILENT: loosen either one and the generator
 * still emits four confident-looking tutorials — which is exactly the graded
 * defect ("no difference with writing sections", four "Trace the X page UI
 * flow" essays). Nothing else fails when they regress, so they are tested here.
 */
describe('tutorialProcedure — a procedure needs something to do and something to check', () => {
  const runnable = buildRunEnvironment(
    {
      topology: null, testTopology: null, envFiles: [], ci: [],
      packageScripts: [{ path: 'package.json', scripts: { dev: 'node server.js' } }],
    },
    'npm',
  );
  const nothingRunnable = buildRunEnvironment(
    { topology: null, testTopology: null, envFiles: [], ci: [], packageScripts: [] },
    'npm',
  );
  const flow = (over: Partial<TraceInput> = {}): TraceInput => ({
    title: 'GET /api/pokemon',
    purpose: 'list pokemon',
    tier: 'core',
    triggerType: 'HTTP GET',
    routePath: '/api/pokemon',
    httpMethod: 'GET',
    coveringTests: [],
    steps: [{
      order: 1, filePath: 'src/routes/pokemon.ts', symbolName: 'listPokemon',
      lineStart: 12, lineEnd: 30, stepKind: 'data_read', description: 'reads the pokemon table',
      nodeId: 'n1', nodeHash: 'h1', snippet: null,
    }],
    ...over,
  });

  it('a flow with no traced effects yields no tutorial, with the reason recorded', () => {
    const attempt = attemptTraceProcedure(flow({ tier: 'surface' }), runnable);
    expect(attempt.ok, 'a surface flow must never produce a procedure').to.equal(false);
    if (attempt.ok) return;
    expect(attempt.skip.reason).to.equal('surface_tier_no_traced_effects');
  });

  it('a repo with no way to run it yields no tutorial, however good the flow is', () => {
    const attempt = attemptTraceProcedure(flow(), nothingRunnable);
    expect(attempt.ok, 'no command means no step the reader can execute').to.equal(false);
    if (attempt.ok) return;
    expect(attempt.skip.reason).to.equal('no_runnable_command');
  });

  it('a real flow in a runnable repo produces action + expected + verify on every step', () => {
    const attempt = attemptTraceProcedure(flow(), runnable);
    expect(attempt.ok).to.equal(true);
    if (!attempt.ok) return;
    for (const step of attempt.draft.steps) {
      expect(step.action, `step ${step.order} action`).to.have.length.greaterThan(0);
      expect(step.expected, `step ${step.order} expected`).to.have.length.greaterThan(0);
      expect(step.verify, `step ${step.order} verify`).to.have.length.greaterThan(0);
      expect(step.filePath, `step ${step.order} location`).to.have.length.greaterThan(0);
    }
  });
});
