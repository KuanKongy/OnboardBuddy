import { expect } from 'chai';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { __setQueryForTests } from '../../lib/db.js';
import {
  isPermanentFailure,
  recordJobFailure,
  retryStepLabel,
  shouldRetry,
  willBullmqRetry,
} from '../retryPolicy.js';
import {
  __setQueuePublishForTests,
  enqueueAnalysisRun,
  failUnsubmittedJob,
} from '../../api/services/analysisStarter.js';

interface QueryLogEntry { text: string; params?: unknown[] }

function captureQueries(rowsFor?: (text: string) => unknown[]): QueryLogEntry[] {
  const log: QueryLogEntry[] = [];
  __setQueryForTests(async (text, params) => {
    log.push({ text, params });
    return { rows: rowsFor?.(text) ?? [] } as never;
  });
  return log;
}

/** The two fields the policy reads, in the shape BullMQ hands the processor. */
function fakeJob(attemptsMade: number, attempts: number): Pick<Job, 'attemptsMade' | 'opts'> {
  return { attemptsMade, opts: { attempts } } as Pick<Job, 'attemptsMade' | 'opts'>;
}

/**
 * Bug #69(2) — "the retry policy is a no-op".
 *
 * Both workers enqueue with `attempts: 2` and both guard their progress writes
 * with `status NOT IN ('paused','failed')`. Writing 'failed' on the FIRST
 * failure therefore made the redelivery throw `KillSwitchError('failed')` on
 * its first step and exit having done nothing — a configured retry that could
 * never run. These assert the row is only terminal on the last attempt.
 */
describe('retryPolicy — a transient failure is actually retried (bug #69)', () => {
  afterEach(() => __setQueryForTests(null));

  it('mirrors BullMQ: a redelivery is pending while attemptsMade + 1 < opts.attempts', () => {
    const transient = new Error('OpenRouter upstream returned 502');
    // First delivery of a 2-attempt job: one more is coming.
    expect(willBullmqRetry(fakeJob(0, 2), transient)).to.equal(true);
    // Second (last) delivery: nothing follows it.
    expect(willBullmqRetry(fakeJob(1, 2), transient)).to.equal(false);
    // attempts: 1 is "deliver once" — never retried.
    expect(willBullmqRetry(fakeJob(0, 1), transient)).to.equal(false);
    // An explicit UnrecoverableError stops BullMQ dead regardless of the count.
    expect(willBullmqRetry(fakeJob(0, 2), new UnrecoverableError('bad input'))).to.equal(false);
  });

  it('retries the transient and gives up immediately on the permanent', () => {
    // The failures worth another attempt — exactly the ones the bug says
    // "surface as hard failures needing a manual resume".
    for (const message of [
      'OpenRouter upstream returned 502',
      'fetch failed',
      'canceling statement due to statement timeout',
      'socket hang up',
      'GitHub API error (503): unavailable',
    ]) {
      expect(isPermanentFailure(new Error(message)), message).to.equal(false);
      expect(shouldRetry(fakeJob(0, 2), new Error(message)), message).to.equal(true);
    }

    // A second attempt cannot make these true, so retrying only delays an
    // honest message by one backoff.
    for (const message of [
      'Project not found: 5f0c…',
      'Scope not found: 91ab…',
      'No GitHub App installation linked to project: 5f0c…. Re-import the repo.',
      "No supported source files in scope 'backend'. Found: python.",
      'This scope and commit are already being analyzed by another run.',
    ]) {
      expect(isPermanentFailure(new Error(message)), message).to.equal(true);
      expect(shouldRetry(fakeJob(0, 2), new Error(message)), message).to.equal(false);
    }

    // Anchored, so an upstream error that merely QUOTES one of those strings
    // is still retried rather than being mistaken for our own diagnosis.
    expect(isPermanentFailure(new Error('502 from provider: "Project not found"'))).to.equal(false);
  });

  it('writes queued (not failed) on a non-final attempt, so the redelivery can run', async () => {
    const log = captureQueries();

    const outcome = await recordJobFailure(fakeJob(0, 2), 'job-1', new Error('upstream 502'), 'upstream 502');

    expect(outcome.retrying).to.equal(true);
    expect(log).to.have.length(1);
    const [write] = log;
    // The bug in one assertion: this write used to say 'failed', which is the
    // one status the step guards refuse to overwrite.
    expect(write!.text).to.include("SET status = 'queued'");
    expect(write!.text).to.not.include("status = 'failed'");
    // finished_at must be cleared too — a queued row with a finish time reads
    // as a completed run in the history panel.
    expect(write!.text).to.include('finished_at = NULL');
    // A pause clicked while this attempt was dying is the user's decision and
    // outranks the retry; a completed row is never walked backwards.
    expect(write!.text).to.include("status NOT IN ('paused', 'complete')");
    expect(write!.params?.[1]).to.equal(retryStepLabel(fakeJob(0, 2), 'upstream 502'));
    expect(String(write!.params?.[1])).to.include('attempt 1 of 2');
  });

  it('writes failed on the final attempt', async () => {
    const log = captureQueries();

    const outcome = await recordJobFailure(fakeJob(1, 2), 'job-1', new Error('upstream 502'), 'upstream 502');

    expect(outcome.retrying).to.equal(false);
    expect(log).to.have.length(1);
    expect(log[0]!.text).to.include("SET status = 'failed'");
    expect(log[0]!.text).to.include('finished_at = NOW()');
  });

  it('writes failed on the first attempt when the error can never succeed', async () => {
    const log = captureQueries();

    const outcome = await recordJobFailure(
      fakeJob(0, 2), 'job-1',
      new Error('No GitHub App installation linked to project: p1. Re-import the repo.'),
      'No GitHub App installation linked to project: p1. Re-import the repo.',
    );

    expect(outcome.retrying).to.equal(false);
    expect(log[0]!.text).to.include("SET status = 'failed'");
  });
});

/**
 * Bug #69(1) — "a job whose queue submission failed stays queued forever".
 *
 * Submission happens after COMMIT, so a Redis outage left a committed 'queued'
 * row that no worker would ever see: the project stayed 'analyzing', the UI
 * polled "waiting for worker" indefinitely, and the per-tuple concurrency guard
 * rejected every retry as "already being analyzed" — on a phantom. The worker's
 * orphan sweep cannot help: it only claims rows already 'running'.
 */
describe('analysisStarter — a failed submission fails its row (bug #69)', () => {
  afterEach(() => {
    __setQueryForTests(null);
    __setQueuePublishForTests(null);
  });

  it('fails the queued row and recomputes the project status when the queue is unreachable', async () => {
    const log = captureQueries();

    await failUnsubmittedJob('job-1', 'proj-1', new Error('ECONNREFUSED 127.0.0.1:6379'));

    const failWrite = log.find((q) => q.text.includes('UPDATE analysis_jobs'));
    expect(failWrite, 'the stuck row must be reconciled').to.exist;
    expect(failWrite!.text).to.include("SET status = 'failed'");
    // Guarded on 'queued': a worker that DID pick the job up despite the error
    // (an ack lost on the way back) must never be stomped mid-run.
    expect(failWrite!.text).to.include("AND status = 'queued'");
    // The reason has to reach the user — "waiting for worker" forever is the
    // whole complaint.
    expect(String(failWrite!.params?.[1])).to.include('ECONNREFUSED');
    expect(String(failWrite!.params?.[1])).to.include('Press Analyze again');

    // The route set projects.status='analyzing' inside the transaction; with
    // nothing queued the card would claim an analysis that does not exist.
    expect(log.some((q) => q.text.includes('UPDATE projects')), 'project scalar must be recomputed').to.equal(true);
  });

  it('enqueueAnalysisRun reconciles the row and still surfaces the error to the caller', async () => {
    const log = captureQueries();
    __setQueuePublishForTests(async () => {
      throw new Error('Stream isn\'t writeable and enableOfflineQueue options is false');
    });

    let threw: unknown;
    try {
      await enqueueAnalysisRun('job-1', { jobId: 'job-1', projectId: 'proj-1' });
    } catch (err) {
      threw = err;
    }

    expect(threw, 'the caller must still see the failure (a 500, not a silent 202)').to.exist;
    const failWrite = log.find((q) => q.text.includes("SET status = 'failed'"));
    expect(failWrite, 'the row must not be left on queued').to.exist;
    expect(failWrite!.params?.[0]).to.equal('job-1');
  });

  it('a submission that succeeds leaves the row exactly as the transaction wrote it', async () => {
    const log = captureQueries();
    const published: Array<{ name: string; opts: Record<string, unknown> }> = [];
    __setQueuePublishForTests(async (name, _data, opts) => { published.push({ name, opts }); });

    await enqueueAnalysisRun('job-1', { jobId: 'job-1', projectId: 'proj-1' });

    expect(published).to.have.length(1);
    expect(published[0]!.name).to.equal('analyze_scope');
    // The retry budget the worker-side policy above is written against.
    expect(published[0]!.opts.attempts).to.equal(2);
    expect(log, 'the happy path must not touch the row').to.have.length(0);
  });
});
