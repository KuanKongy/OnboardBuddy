import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import { settlePackageStaleness } from '../../incrementalAnalyzer.js';
import { regenerateOneTutorial } from '../tutorialGenerator.js';

interface QueryLogEntry { text: string; params?: unknown[] }

/**
 * Serves rows by matching the statement text, so a test can say "this snapshot
 * still has the workflow" without standing up a database.
 */
function stubQueries(rowsFor: (text: string) => unknown[] | undefined): QueryLogEntry[] {
  const log: QueryLogEntry[] = [];
  __setQueryForTests(async (text, params) => {
    log.push({ text, params });
    return { rows: rowsFor(text) ?? [] } as never;
  });
  return log;
}

const PARAMS = {
  ai: null,
  snapshotId: 'snap-2',
  projectId: 'proj-1',
  packageId: 'pkg-1',
  role: 'backend' as const,
  commitHash: 'b'.repeat(40),
  projections: [],
  privacyMode: 'ai_disabled' as const,
};

/**
 * Bug #36 — "stale tutorials cannot be regenerated individually".
 *
 * Incremental analysis flags a tutorial stale when a file its steps cite
 * changes (incrementalAnalyzer `markStale`), but regeneration only ever existed
 * per SECTION — so the tab showed a stale badge with nothing to press, and the
 * only remedy was regenerating the whole package: every section and every other
 * tutorial, paid for again.
 */
describe('single-tutorial regeneration (bug #36)', () => {
  afterEach(() => __setQueryForTests(null));

  it('reports "workflow_gone" when the flow no longer exists in the new snapshot', async () => {
    // No workflows at all in this snapshot: selection yields no candidate and
    // the existence probe finds nothing either.
    stubQueries(() => []);

    const outcome = await regenerateOneTutorial(PARAMS, 'tut:workflow:checkout');

    expect(outcome.ok).to.equal(false);
    expect(outcome.miss).to.equal('workflow_gone');
  });

  it('distinguishes "no longer eligible" — the flow is there but yields no procedure', async () => {
    // The flow row still exists; selection still produced no candidate for it
    // (its traced effect is gone, so there is no procedure to build). Telling
    // these apart matters: one is "your repo changed shape", the other is
    // "this walkthrough's subject was deleted".
    stubQueries((text) =>
      text.includes('FROM workflows WHERE snapshot_id') ? [{ '?column?': 1 }] : []);

    const outcome = await regenerateOneTutorial(PARAMS, 'tut:workflow:checkout');

    expect(outcome.ok).to.equal(false);
    expect(outcome.miss).to.equal('no_longer_eligible');
  });

  it('asks selection for an unbounded set — the cap must not refuse a refresh', async () => {
    const log = stubQueries(() => []);

    await regenerateOneTutorial(PARAMS, 'tut:workflow:checkout');

    // The reader already HAS this tutorial and is asking for it to be
    // refreshed; "it lost a slot to a higher-ranked flow this time" would be a
    // silent, inexplicable refusal. The selection query is snapshot-scoped and
    // unfiltered by rank, and the cap is applied by the caller, so the guard
    // here is simply that selection ran against the target snapshot.
    const selection = log.find((q) => q.text.includes('FROM workflows w'));
    expect(selection, 'selection must be re-run against the new snapshot').to.exist;
    expect(selection!.params).to.deep.equal(['snap-2']);
  });
});

/**
 * The other half of #36. `markStale` flags sections AND tutorials, and marks
 * the package stale if either is hit — but `settlePackageStaleness` only ever
 * asked about sections. A package whose only stale content was a tutorial
 * could therefore be declared fresh by an unrelated section regeneration.
 */
describe('settlePackageStaleness counts stale tutorials (bug #36)', () => {
  afterEach(() => __setQueryForTests(null));

  it('keeps the package stale while a stale tutorial remains', async () => {
    const log = stubQueries((text) =>
      text.includes('UPDATE onboarding_packages') ? [{ status: 'stale' }] : []);

    const result = await settlePackageStaleness('pkg-1');

    const write = log[0]!;
    expect(write.text).to.include('FROM package_sections ps');
    // The missing half: without this the predicate disagreed with the one that
    // SET the flag in the first place.
    expect(write.text, 'stale tutorials must keep the package stale').to.include('FROM tutorials t');
    expect(write.text).to.include("t.status = 'stale'");
    expect(result.stale).to.equal(true);
    // Still stale, so the package-level flags must NOT be resolved.
    expect(log.some((q) => q.text.includes('UPDATE stale_flags'))).to.equal(false);
  });

  it('resolves the package flags once nothing stale is left', async () => {
    const log = stubQueries((text) =>
      text.includes('UPDATE onboarding_packages') ? [{ status: 'draft' }] : []);

    const result = await settlePackageStaleness('pkg-1');

    expect(result.stale).to.equal(false);
    const resolve = log.find((q) => q.text.includes('UPDATE stale_flags'));
    expect(resolve).to.exist;
    expect(resolve!.text).to.include('resolved_at = NOW()');
  });
});
