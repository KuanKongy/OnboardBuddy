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

  /**
   * CONTRACT CHANGE: the penalty is on the SHARE of the trace that only shapes
   * data, not on raw length. The old form charged `steps - 8` up to a flat
   * −0.2, which billed a 20-step pipeline writing rows in eight modules exactly
   * what it billed a 20-step wander through formatting helpers. Length is not
   * the tell — the ratio is. What this test asserts is unchanged (a sprawling
   * trace scores below a tight one); only the reason string moves, from
   * "long traces drift" to a count of the drifting steps.
   */
  it('penalises a trace that keeps going past the point of meaning', () => {
    const tight = rank(ep('http_route', '/a'), steps('trigger', 'auth_guard', 'data_write', 'response'));
    const sprawling = rank(
      ep('http_route', '/a'),
      steps('trigger', 'auth_guard', 'data_write', ...Array(14).fill('transform') as WorkflowStepKind[], 'response'),
    );
    expect(sprawling.score).to.be.lessThan(tight.score);
    expect(sprawling.reasons.join(' ')).to.contain('14 of 18 steps only shape data');
  });

  it('charges drift by share, so a long flow doing real work keeps its score', () => {
    // The reason the penalty moved off length. Both traces are 18 steps; only
    // one of them spent them wandering.
    const working = rank(
      ep('http_route', '/a'),
      steps('trigger', ...Array(17).fill('data_write') as WorkflowStepKind[]),
    );
    const drifting = rank(
      ep('http_route', '/a'),
      steps('trigger', 'data_write', ...Array(16).fill('transform') as WorkflowStepKind[]),
    );
    expect(working.score).to.be.greaterThan(drifting.score);
    expect(working.reasons.join(' '), 'no drift charge for a trace that keeps working')
      .to.not.contain('only shape data');
  });

  it('leaves ordinary plumbing alone: a few transform steps are not drift', () => {
    // A short trace can read as mostly-transform (4 of 7) without having gone
    // anywhere, so the charge is gated on an absolute count as well as a share.
    const ordinary = rank(
      ep('ui_action'),
      steps('trigger', 'data_write', 'transform', 'transform', 'transform', 'transform', 'side_effect'),
    );
    expect(ordinary.reasons.join(' ')).to.not.contain('only shape data');
  });

  /**
   * A consumer is never triggered by a person, so `userTriggered && persists`
   * could never make one `core` — NO async worker could reach that tier, no
   * matter how much of the system it owned. Measured on this tool's own
   * repository: the analysis and generation pipelines both tiered `supporting`
   * while a settings DELETE was the #1 core flow.
   *
   * Eligibility came first: a reached consumer becomes eligible for the
   * `userTriggered` term that already existed. Fan-in is now scored on top of
   * it — see the `inboundHandoffs` case below.
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

    /**
     * CONTRACT CHANGE: `inboundHandoffs` used to carry zero weight, and this
     * test pinned the zero — eligibility was allowed to be the only difference
     * between a reached consumer and an unreached one, deliberately, so that a
     * ranking already verified across the calibration fleet would not move.
     *
     * That fleet has now been re-measured end to end, and the zero is wrong on
     * the merits: how many distinct flows route work through a consumer is the
     * clearest evidence available that it is load-bearing. On this repository
     * the analysis and generation consumers own the whole pipeline and had four
     * and three producers each, yet ranked 55th and 57th of 58 core flows —
     * below a single-row settings delete. The term is bounded (four hand-offs)
     * so a fan-in hub cannot run away with the list.
     */
    it('lifts a consumer that many flows hand work to, in bounded steps', () => {
      const reached = rank(ep('message_consumer', 'q'), consumer(), false, false, { reachedFromUser: true });
      const fedByFour = rank(ep('message_consumer', 'q'), consumer(), false, false, { reachedFromUser: true, inboundHandoffs: 4 });
      expect(fedByFour.score).to.be.greaterThan(reached.score);
      expect(fedByFour.reasons.join(' ')).to.contain('4 other flows hand work to it');

      // Bounded: past the cap, more producers add nothing.
      const fedByTwenty = rank(ep('message_consumer', 'q'), consumer(), false, false, { reachedFromUser: true, inboundHandoffs: 20 });
      expect(fedByTwenty.score).to.equal(fedByFour.score);

      // And a single producer is worth strictly less than four.
      const fedByOne = rank(ep('message_consumer', 'q'), consumer(), false, false, { reachedFromUser: true, inboundHandoffs: 1 });
      expect(fedByOne.score).to.be.greaterThan(reached.score);
      expect(fedByOne.score).to.be.lessThan(fedByFour.score);
      expect(fedByOne.reasons.join(' ')).to.contain('1 other flow hands work to it');
    });

    it('ranks the pipeline consumer above a single-row settings delete', () => {
      // The regression in one line: what the reweight exists to fix.
      const pipeline = rank(
        ep('message_consumer', 'ANALYSIS_QUEUE'),
        [...steps('trigger', 'data_read', 'data_write', 'side_effect')]
          .map((s, i) => ({ ...s, filePath: `src/worker/stage${i}.ts` })),
        false, false, { reachedFromUser: true, inboundHandoffs: 4 },
      );
      const settingsDelete = rank(ep('http_route', '/ranking-weights/:role'), steps('trigger', 'data_write', 'response'));
      expect(pipeline.tier).to.equal('core');
      expect(pipeline.score).to.be.greaterThan(settingsDelete.score);
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
