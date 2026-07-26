import { expect } from 'chai';
import { __setQueryForTests } from '../../lib/db.js';
import {
  isRunControlError,
  markSnapshotFailed,
  recordMissingSection,
  restoreSnapshotAfterGeneration,
  settleStoppedPackage,
} from '../runStatus.js';

interface QueryLogEntry { text: string; params?: unknown[] }

function captureQueries(): QueryLogEntry[] {
  const log: QueryLogEntry[] = [];
  __setQueryForTests(async (text, params) => {
    log.push({ text, params });
    return { rows: [] } as never;
  });
  return log;
}

/**
 * Phase 8 resilience (REWORK_PLAN.md). Both workers build BullMQ consumers at
 * module load, so these writes are asserted through `runStatus.ts` — the
 * module they actually call — rather than by importing a worker.
 */
describe('runStatus — truthful terminal status (bugs #75 / #77 / #80)', () => {
  afterEach(() => __setQueryForTests(null));

  it('#75: a run that dies after persistence marks its snapshot failed, and never stomps a pause', async () => {
    const log = captureQueries();

    await markSnapshotFailed('snap-1', 'canceling statement due to statement timeout');

    expect(log).to.have.length(1);
    const [write] = log;
    expect(write!.text).to.include('UPDATE analysis_snapshots');
    expect(write!.text).to.include("SET status = 'failed'");
    // The whole point of the bug: the row was left on the 'complete' the
    // persistence step wrote at 46%, so the correction must be unconditional
    // on the current status — except for 'paused', which is resumable and owns
    // its own reason.
    expect(write!.text).to.include("WHERE id = $1 AND status <> 'paused'");
    expect(write!.text).to.not.include("status IN ('running'");
    // The failure reason rides along as an honest unknown, so a reader is not
    // left with a failed snapshot and no explanation.
    expect(write!.text).to.include("'analysis_incomplete'");
    expect(write!.params).to.deep.equal(['snap-1', 'canceling statement due to statement timeout']);
  });

  it('#77: a plain section failure becomes a recorded gap; a run-control signal is never absorbed', async () => {
    // The guard's contract, both directions. A truncated structured output is
    // this section's problem — the other eleven must survive it — while a
    // pause/kill/budget/AI-disabled signal means the whole run stops.
    expect(isRunControlError(Object.assign(new Error('paused'), { name: 'AiPausedError' }))).to.equal(true);
    expect(isRunControlError(Object.assign(new Error('killed'), { name: 'KillSwitchError' }))).to.equal(true);
    expect(isRunControlError(Object.assign(new Error('over'), { name: 'BudgetExceededError' }))).to.equal(true);
    expect(isRunControlError(Object.assign(new Error('off'), { name: 'AiDisabledError' }))).to.equal(true);
    expect(isRunControlError(new Error("structured output invalid: Expected ',' or ']' at position 8439"))).to.equal(false);

    const log = captureQueries();
    await recordMissingSection({
      packageId: 'pkg-1',
      snapshotId: 'snap-1',
      sectionType: 'architecture_deep',
      title: 'Architecture in Depth',
      commitHash: 'abc1234',
      role: 'general',
      reason: "structured output failed validation after retry: Expected ',' or ']' at position 8439",
    });

    // Only this section's row is replaced — the eleven that succeeded are not
    // in the DELETE's scope.
    expect(log).to.have.length(2);
    expect(log[0]!.text).to.include('DELETE FROM package_sections WHERE package_id = $1 AND type = $2');
    expect(log[0]!.params).to.deep.equal(['pkg-1', 'architecture_deep']);

    // The gap is a real row, so the reader enumerates twelve sections with one
    // of them explaining itself, not eleven with a silent hole.
    expect(log[1]!.text).to.include('INSERT INTO package_sections');
    expect(log[1]!.text).to.include("'low', 'draft'");
    const params = log[1]!.params as unknown[];
    const unknowns = JSON.parse(String(params[7])) as Array<{ kind: string; detail: string }>;
    const context = JSON.parse(String(params[8])) as { status: string; reason: string };
    expect(unknowns[0]!.kind).to.equal('section_generation_failed');
    expect(context.status).to.equal('missing');
    expect(context.reason).to.include('position 8439');
  });

  it('#80: a stopped generation never wedges on "generating", and a finished one un-pauses its snapshot', async () => {
    const log = captureQueries();

    await settleStoppedPackage('pkg-1');
    await restoreSnapshotAfterGeneration('snap-1');

    // Sections on disk ⇒ 'draft' (openable, partial); nothing ⇒ 'failed'.
    // Either way the row leaves 'generating', which is what left NationalPokedex
    // reporting "in progress" over 71 workflows forever.
    expect(log[0]!.text).to.include('UPDATE onboarding_packages');
    expect(log[0]!.text).to.include("THEN 'draft'");
    expect(log[0]!.text).to.include("ELSE 'failed'");
    expect(log[0]!.text).to.include("WHERE op.id = $1 AND op.status = 'generating'");

    // #80(c): the paused snapshot returns to 'complete' when the generation
    // finishes; a 'failed' verdict belongs to the analysis and is left alone.
    expect(log[1]!.text).to.include("SET status = 'complete' WHERE id = $1 AND status = 'paused'");
  });

  it('settleStoppedPackage is a no-op when the run never created a package', async () => {
    const log = captureQueries();
    await settleStoppedPackage(null);
    expect(log).to.have.length(0);
  });
});
