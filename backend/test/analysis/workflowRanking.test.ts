import { expect } from 'chai';
import { rankWorkflow, type HandoffContext, type WorkflowStep, type WorkflowStepKind } from '../../src/worker/engine/workflowExtractor';
import type { DetectedEntrypoint } from '../../src/worker/engine/entrypointDetector';

/**
 * The old score was `(steps * 0.1 + effectSteps * 0.2)` — a length measurement
 * wearing an importance label. A 20-step trace through shared helpers beat a
 * 4-step login every time, so the top of the Workflows list was whatever
 * happened to trace deepest.
 */

const ep = (kind: DetectedEntrypoint['kind'], routePattern?: string): DetectedEntrypoint => ({
  nodeStableKey: 'src/x.ts',
  kind,
  filePath: 'src/x.ts',
  ...(routePattern ? { routePattern } : {}),
});

const steps = (...kinds: WorkflowStepKind[]): WorkflowStep[] =>
  kinds.map((stepKind, i) => ({
    stepOrder: i + 1,
    nodeStableKey: `src/x.ts#s${i}`,
    filePath: 'src/x.ts',
    stepKind,
    deterministicDescription: stepKind,
  }));

const rank = (
  e: DetectedEntrypoint,
  s: WorkflowStep[],
  surface = false,
  unknownOnly = false,
  handoff: HandoffContext = {},
) => rankWorkflow(e, s, surface, unknownOnly, handoff);

describe('workflow ranking', () => {
  it('puts a short user-triggered write above a long trace with no effects', () => {
    // The exact inversion that motivated the rework.
    const login = rank(ep('http_route', '/login'), steps('trigger', 'auth_guard', 'data_write', 'response'));
    const wander = rank(
      ep('http_route', '/report'),
      steps('trigger', ...Array(18).fill('transform') as WorkflowStepKind[], 'response'),
      true,
    );
    expect(login.tier).to.equal('core');
    expect(wander.tier).to.equal('surface');
    expect(login.score).to.be.greaterThan(wander.score);
  });

  it('rewards breadth of effects, not the number of steps', () => {
    const broad = rank(ep('http_route', '/a'), steps('trigger', 'data_write', 'async_work', 'side_effect'));
    const repetitive = rank(
      ep('http_route', '/b'),
      steps('trigger', 'data_write', 'data_write', 'data_write', 'data_write', 'data_write'),
    );
    // Longer, but it only ever does one kind of thing — under the old
    // step-count score it would have won.
    expect(broad.score).to.be.greaterThan(repetitive.score);
    expect(broad.reasons.join(' ')).to.contain('3 kinds of side effect');
  });

  it('penalises a trace that keeps going past the point of meaning', () => {
    const tight = rank(ep('http_route', '/a'), steps('trigger', 'auth_guard', 'data_write', 'response'));
    const sprawling = rank(
      ep('http_route', '/a'),
      steps('trigger', 'auth_guard', 'data_write', ...Array(14).fill('transform') as WorkflowStepKind[], 'response'),
    );
    expect(sprawling.score).to.be.lessThan(tight.score);
    expect(sprawling.reasons.join(' ')).to.contain('long traces drift');
  });

  /**
   * A consumer is never triggered by a person, so `userTriggered && persists`
   * could never make one `core` — NO async worker could reach that tier, no
   * matter how much of the system it owned. Measured on this tool's own
   * repository: the analysis and generation pipelines both tiered `supporting`
   * while a settings DELETE was the #1 core flow.
   *
   * The fix is eligibility only. Nothing here changes a weight: a reached
   * consumer becomes eligible for the `userTriggered` term that already
   * existed, and its position then falls out of the same arithmetic as
   * everything else.
   */
  describe('async hand-offs', () => {
    const consumer = () => steps('trigger', 'data_read', 'data_write');

    it('tiers a consumer a user path feeds as core, and says why', () => {
      const fed = rank(ep('message_consumer', 'analysis'), consumer(), false, false, { reachedFromUser: true });
      expect(fed.tier).to.equal('core');
      expect(fed.reasons.join(' ')).to.contain('across an async hand-off');
    });

    it('leaves a consumer nobody publishes to as supporting', () => {
      // A cron janitor or a queue fed by an external system is genuinely
      // supporting; the fix must be reachability, not a blanket promotion.
      expect(rank(ep('message_consumer', 'nightly'), consumer()).tier).to.equal('supporting');
    });

    it('scores a reached consumer exactly as the same shape with a user trigger', () => {
      // The guard against reweighting: eligibility must be the ONLY difference.
      const reached = rank(ep('message_consumer', 'q'), consumer(), false, false, { reachedFromUser: true });
      const direct = rank(ep('message_consumer', 'q'), consumer(), false, false, { reachedFromUser: true, inboundHandoffs: 4 });
      expect(direct.score).to.equal(reached.score);
    });
  });

  it('tiers a background job as supporting, not core', () => {
    const job = rank(ep('message_consumer'), steps('trigger', 'data_read', 'data_write'));
    expect(job.tier).to.equal('supporting');
    const userFlow = rank(ep('http_route', '/a'), steps('trigger', 'data_write'));
    expect(userFlow.tier).to.equal('core');
  });

  it('treats a UI page that writes as a core user flow', () => {
    // The old blanket uiPenalty halved these, burying real user journeys.
    const page = rank(ep('ui_route', '/checkout'), steps('trigger', 'data_write', 'response'));
    expect(page.tier).to.equal('core');
    const serverEquivalent = rank(ep('http_route', '/checkout'), steps('trigger', 'data_write', 'response'));
    expect(page.score).to.be.greaterThan(serverEquivalent.score * 0.8);
  });

  it('tiers an entry point with no traced effects as surface, and says so', () => {
    const bare = rank(ep('http_route', '/health'), steps('trigger'), true);
    expect(bare.tier).to.equal('surface');
    expect(bare.reasons.join(' ')).to.contain('no side effects traced');
  });

  it('orders surface entries by how well the entry point is known', () => {
    const declared = rank(ep('http_route', '/health'), steps('trigger'), true);
    const guessed = rank(ep('export'), steps('trigger'), true);
    expect(declared.score).to.be.greaterThan(guessed.score);
  });

  it('discounts a flow whose effects were only inferred', () => {
    const s = steps('trigger', 'data_write', 'response');
    expect(rank(ep('http_route', '/a'), s, false, true).score)
      .to.be.lessThan(rank(ep('http_route', '/a'), s, false, false).score);
  });

  it('gives auth-guarded flows a lift over unguarded ones', () => {
    const guarded = rank(ep('http_route', '/a'), steps('trigger', 'auth_guard', 'data_write'));
    const open = rank(ep('http_route', '/a'), steps('trigger', 'data_write'));
    expect(guarded.score).to.be.greaterThan(open.score);
    expect(guarded.reasons.join(' ')).to.contain('auth');
  });

  it('never returns a negative score', () => {
    const brutal = rank(
      ep('export'),
      steps('trigger', ...Array(40).fill('transform') as WorkflowStepKind[]),
      false,
      true,
    );
    expect(brutal.score).to.be.at.least(0);
  });
});
