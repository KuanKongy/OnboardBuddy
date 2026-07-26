import { expect } from 'chai';
import { pickDiverseWorkflows, workflowFamily } from '../tutorialGenerator.js';
import {
  attemptTraceProcedure,
  attemptWalkthrough,
  buildRunEnvironment,
  MAX_PROCEDURE_STEPS,
  type TraceInput,
  type TraceStep,
} from '../tutorialProcedure.js';

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

  /**
   * Composed journeys are the only candidate that spans the stack, and losing
   * them is silent: the tab still shows six confident tutorials, just of
   * `resume-job` and `GET /installations` instead of the analysis pipeline.
   * Two ways they used to die, both pinned here — the journey's own trigger
   * type is the word "journey", which matches neither `/^HTTP/` nor "UI page";
   * and 14 stitched steps do not fit an 8-step budget without cutting the
   * revert step off the end and leaving the reader's marker in their tree.
   */
  it('a composed journey is triggered by its first member and walks its boundaries', () => {
    const step = (over: Partial<TraceInput['steps'][number]>): TraceInput['steps'][number] => ({
      order: 1, filePath: 'backend/src/api/routes/projects.ts', symbolName: 'analyze',
      lineStart: 10, lineEnd: 20, stepKind: 'trigger', description: 'entry',
      nodeId: null, nodeHash: null, snippet: null, ...over,
    });
    const attempt = attemptTraceProcedure(flow({
      title: 'Analysis → onboarding generation pipeline',
      triggerType: 'journey',
      entryTriggerType: 'HTTP POST',
      routePath: '/api/projects/:id/analyze',
      httpMethod: 'POST',
      steps: [
        step({ order: 1, metadata: { journeyMember: 'wf:analyze' } }),
        step({ order: 2, stepKind: 'async_work', description: 'enqueues', metadata: { journeyMember: 'wf:analyze' } }),
        step({ order: 3, filePath: 'backend/src/worker/index.ts', symbolName: 'worker', lineStart: 629,
               stepKind: 'async_work', description: "Boundary: job crosses queue 'analysis'",
               metadata: { journeyBoundary: 'queue' } }),
        step({ order: 4, filePath: 'backend/src/worker/summaryWorker.ts', symbolName: 'processSummaryJob',
               lineStart: 68, stepKind: 'data_write', description: 'writes sections',
               metadata: { journeyMember: 'wf:summary' } }),
      ],
    }), runnable);
    expect(attempt.ok, 'a journey with a routed first member has a trigger').to.equal(true);
    if (!attempt.ok) return;
    expect(attempt.draft.steps.length).to.be.at.most(MAX_PROCEDURE_STEPS);
    // The reader must be told to send the FIRST MEMBER's request, not "journey".
    const trigger = attempt.draft.steps.find((s) => s.kind === 'trigger')!;
    expect(trigger.command).to.contain('POST');
    expect(trigger.command).to.contain('/api/projects/:id/analyze');
    // The hand-off is a step of its own, with the consumer's real file:line …
    expect(attempt.draft.steps.map((s) => s.filePath)).to.include('backend/src/worker/index.ts');
    // … the marker lands past the queue, because a job crosses it …
    const marker = attempt.draft.steps.find((s) => s.kind === 'edit')!;
    expect(marker.filePath).to.equal('backend/src/worker/summaryWorker.ts');
    // … and the tree is still left clean.
    expect(attempt.draft.steps[attempt.draft.steps.length - 1]!.kind).to.equal('revert');
  });
});

/**
 * The completeness invariant (doc/TUTORIAL_REDESIGN.md §3.2), which is the
 * whole answer to the owner's A5/A2: *"the onboarding package generation is
 * just 2 steps. Maybe you should think about it as a pipeline."*
 *
 * v3 compressed a journey to "trigger + one effect per member" and then cut
 * THAT to fit an 8-step budget, so a multi-stage pipeline rendered as two
 * cards. The failure is silent — the tab still shows a confident tutorial —
 * which is why the invariant is pinned here: every member becomes a phase and
 * every crossing becomes a connector, and folding may never drop either.
 */
describe('tutorialProcedure — a pipeline walkthrough shows the whole pipeline', () => {
  const step = (order: number, over: Partial<TraceStep> = {}): TraceStep => ({
    order, filePath: 'src/a.ts', symbolName: 'a', lineStart: 1, lineEnd: 20,
    stepKind: 'transform', description: 'does a thing',
    nodeId: null, nodeHash: null, snippet: null, ...over,
  });
  const members = ['wf:api', 'wf:worker', 'wf:summary'];
  const attempt = attemptWalkthrough({
    title: 'Accept the request → write the package',
    purpose: 'p', tier: 'core', triggerType: 'journey', entryTriggerType: 'HTTP POST',
    routePath: '/api/x', httpMethod: 'POST', coveringTests: [],
    // The composer's compressed spine — two steps for a three-leg chain. This
    // is exactly the input that used to become a two-step tutorial.
    steps: [
      step(1, { metadata: { journeyMember: 'wf:api' } }),
      step(2, { metadata: { journeyMember: 'wf:summary' } }),
    ],
    journey: {
      members,
      memberTitles: ['Accept the request', 'Run the work', 'Write the package'],
      boundaries: [
        { after: 0, kind: 'async_token', detail: "job 'a' crosses queue 'first'" },
        { after: 1, kind: 'async_token', detail: "job 'b' crosses queue 'second'" },
      ],
    },
    memberSteps: new Map(members.map((m, i) => [m, [
      step(1, { filePath: `src/${i}.ts`, symbolName: `entry${i}` }),
      step(2, { filePath: `src/${i}.ts`, symbolName: `write${i}`, stepKind: 'data_write' }),
      step(3, { filePath: `src/${i}.ts`, symbolName: `helper${i}` }),
      step(4, { filePath: `src/${i}.ts`, symbolName: `tail${i}` }),
    ]])),
  });

  it('gives every member its own phase, walked from that member\'s own trace', () => {
    expect(attempt.ok ? [...new Set(attempt.draft.steps.map((s) => s.phase?.member))] : [])
      .to.deep.equal(members);
  });

  it('renders every crossing as a connector rather than compressing it away', () => {
    expect(attempt.ok ? attempt.draft.steps.filter((s) => s.boundary !== null).length : 0)
      .to.equal(2);
  });
});

/**
 * A socket handler is not reached by a request (task #41.1).
 *
 * The detector now finds `socket:*` registrations, so a realtime repo finally
 * produces walkthroughs — and a walkthrough of one used to render identically
 * to a walkthrough of a route, leaving the reader to assume a door that does
 * not exist. The entry statement is the correction, and it must never carry a
 * command: for an event handler there is nothing to send.
 */
describe('tutorialProcedure — the entry statement names the real trigger', () => {
  const step = (over: Partial<TraceStep> = {}): TraceStep => ({
    order: 1, filePath: 'server/src/handlers.js', symbolName: 'on create-room',
    lineStart: 40, lineEnd: 54, stepKind: 'data_write', description: 'writes',
    nodeId: null, nodeHash: null, snippet: null, ...over,
  });
  const socket = attemptWalkthrough({
    title: 'event handler: on create-room', purpose: 'p', tier: 'core',
    triggerType: 'event_handler', routePath: 'socket:create-room', httpMethod: null,
    coveringTests: [], steps: [step()],
    emitSites: [
      // The class body contains the method's literal too; the narrower node wins.
      { filePath: 'src/services/socket.ts', symbolName: 'SocketService', lineStart: 13, lineEnd: 130 },
      { filePath: 'src/services/socket.ts', symbolName: 'SocketService.createRoom', lineStart: 87, lineEnd: 90 },
      { filePath: 'server/src/handlers.js', symbolName: 'on connection', lineStart: 36, lineEnd: 182 },
    ],
  });

  it('states the emitting call site and prints no request to send', () => {
    const entry = socket.ok ? socket.draft.steps[0]!.entry : null;
    expect({ kind: entry?.kind, command: entry?.command, at: entry?.emitters?.[0]?.lineStart })
      .to.deep.equal({ kind: 'event', command: undefined, at: 87 });
  });

  it('one card per place in the code, not one per traced step', () => {
    // Same node, three effect rows: the extractor's shape, which used to render
    // as three cards of byte-identical lines.
    const merged = attemptWalkthrough({
      title: 'f', purpose: 'p', tier: 'core', triggerType: 'event_handler',
      routePath: 'socket:x', httpMethod: null, coveringTests: [],
      steps: [
        step({ order: 1, nodeId: 'n1', stepKind: 'trigger', description: 'entry' }),
        step({ order: 2, nodeId: 'n1', description: 'writes' }),
        step({ order: 3, nodeId: 'n1', stepKind: 'async_work', description: 'enqueues' }),
        step({ order: 4, nodeId: 'n2', filePath: 'server/src/roomManager.js', symbolName: 'create', description: 'persists' }),
      ],
    });
    expect(merged.ok ? merged.draft.steps.map((s) => s.symbolName) : [])
      .to.deep.equal(['on create-room', 'create']);
  });
});
