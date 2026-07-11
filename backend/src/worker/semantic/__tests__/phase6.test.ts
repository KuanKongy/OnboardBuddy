import { expect } from 'chai';
import { viewsForRecord, renderView, viewsForIntent, ALL_VIEWS, type ViewRenderContext } from '../embeddingViews.js';
import { buildFactsOnlyBody } from '../symbolPass.js';
import type { SemanticRecordBody } from '../recordTypes.js';

const body: SemanticRecordBody = {
  purpose: 'Authenticates users.',
  behavior: 'Validates credentials then signs a token.',
  responsibilities: ['authentication', 'session issuing'],
  business_concepts: ['user login'],
  side_effects: [{ kind: 'database_write', description: 'stores sessions', mergedWithDeterministic: true }],
  inputs_outputs: null,
  dependencies_narrative: 'Delegates persistence to the session store.',
  design_patterns: ['service'],
  risks_invariants: ['Never log credentials.'],
  confidence: 'high',
  claims: [],
  failure_modes: ['invalid credentials rejected'],
};

const ctx: ViewRenderContext = {
  name: 'AuthService.login',
  kind: 'method',
  filePath: 'services/authService.ts',
  callerNames: ['routes/authRoutes.ts#loginHandler'],
  calleeNames: ['utils/jwtUtil.ts#signToken'],
  capabilityNames: ['User Authentication'],
};

describe('phase 6 — view selection', () => {
  it('LLM records embed all four views; facts-only records skip domain', () => {
    expect(viewsForRecord({ factsOnly: false })).to.deep.equal(ALL_VIEWS);
    expect(viewsForRecord({ factsOnly: true })).to.deep.equal(['purpose', 'dependency', 'operations']);
  });

  it('query intents map to the spec views', () => {
    expect(viewsForIntent('what_does')).to.deep.equal(['purpose']);
    expect(viewsForIntent('what_handles')).to.deep.equal(['domain']);
    expect(viewsForIntent('what_uses')).to.deep.equal(['dependency']);
    expect(viewsForIntent('what_breaks')).to.deep.equal(['operations']);
  });
});

describe('phase 6 — deterministic view renderers', () => {
  it('purpose view follows the spec template', () => {
    const text = renderView('purpose', body, ctx);
    expect(text).to.include('method AuthService.login in services/authService.ts.');
    expect(text).to.include('Purpose: Authenticates users.');
    expect(text).to.include('Behavior: Validates credentials');
    expect(text).to.include('Responsibilities: authentication, session issuing');
  });

  it('domain view carries business concepts and capability names', () => {
    const text = renderView('domain', body, ctx);
    expect(text).to.include('Business concepts: user login');
    expect(text).to.include('Capabilities: User Authentication');
  });

  it('dependency view lists narrative plus caller/callee names', () => {
    const text = renderView('dependency', body, ctx);
    expect(text).to.include('Dependencies: Delegates persistence');
    expect(text).to.include('Calls: utils/jwtUtil.ts#signToken');
    expect(text).to.include('Called by: routes/authRoutes.ts#loginHandler');
  });

  it('operations view carries side effects, risks, and failure modes', () => {
    const text = renderView('operations', body, ctx);
    expect(text).to.include('database_write (stores sessions)');
    expect(text).to.include('Risks and invariants: Never log credentials.');
    expect(text).to.include('Failure modes: invalid credentials rejected');
  });

  it('rendering is deterministic and capped', () => {
    const big = { ...body, purpose: 'x'.repeat(5000) };
    expect(renderView('purpose', body, ctx)).to.equal(renderView('purpose', body, ctx));
    expect(renderView('purpose', big, ctx).length).to.be.at.most(2000);
  });

  it('facts-only records render meaningful purpose/operations text', () => {
    const factsBody = buildFactsOnlyBody(
      { graph: { nodes: [], edges: [] }, sideEffects: [{ nodeStableKey: 'a.ts', symbolStableKey: 'a.ts#fn', kind: 'database_write', target: 'sessions', filePath: 'a.ts' }] },
      { stableKey: 'a.ts#fn', type: 'function', name: 'fn', filePath: 'a.ts', trustLevel: 'code', metadata: {} },
    );
    const text = renderView('operations', factsBody, { ...ctx, name: 'fn', kind: 'function' });
    expect(text).to.include('database_write');
  });
});
