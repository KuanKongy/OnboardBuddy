import { expect } from 'chai';
import { __setQueryForTests } from '../../lib/db.js';
import {
  isRecoverable,
  reconcileOrphanedJobs,
  type OrphanedJob,
} from '../jobRecovery.js';
import { drainWorkers, type ClosableWorker } from '../shutdown.js';

interface QueryLogEntry { text: string; params?: unknown[] }

/**
 * Both workers construct BullMQ consumers at module load, so — same rule as
 * runStatus.test.ts — the behavior is asserted through the modules the worker
 * calls, with the database stubbed and the enqueues injected.
 */
function stubDb(claimed: Partial<OrphanedJob>[]): QueryLogEntry[] {
  const log: QueryLogEntry[] = [];
  let firstUpdate = true;
  __setQueryForTests(async (text, params) => {
    log.push({ text, params });
    // The claim is the first statement of a sweep; everything after it
    // (terminal writes, snapshot correction, project rollup) returns nothing.
    if (firstUpdate && text.includes("SET status = 'queued'")) {
      firstUpdate = false;
      return { rows: claimed, rowCount: claimed.length } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  });
  return log;
}

const orphan = (over: Partial<OrphanedJob> = {}): Partial<OrphanedJob> => ({
  id: 'job-1',
  project_id: 'proj-1',
  snapshot_id: 'snap-1',
  job_type: 'analyze_scope',
  scope_id: 'scope-1',
  branch: 'main',
  commit_hash: 'a'.repeat(40),
  semantic_depth: 'standard',
  role: 'general',
  requested_by: 'user-1',
  recovery_attempts: 1,
  ...over,
});

describe('restart resilience — orphan recovery and graceful shutdown', () => {
  afterEach(() => __setQueryForTests(null));

  it('re-queues a resumable orphan on the same job row, with a durable bounded attempt count', async () => {
    const log = stubDb([orphan()]);
    const enqueued: OrphanedJob[] = [];

    const result = await reconcileOrphanedJobs({
      log: () => {},
      requeueAnalysis: async (job) => { enqueued.push(job); },
      requeueGeneration: async () => { throw new Error('wrong queue'); },
    });

    // The point of the change: a run killed by a deploy comes BACK, it is not
    // marked failed for a human to notice and press Analyze… again.
    expect(result.requeued).to.deep.equal(['job-1']);
    expect(result.failed).to.be.empty;
    expect(enqueued).to.have.length(1);
    // Same row id ⇒ the phase checkpoints, the budget baseline and the
    // content-addressed record cache are all still in scope on the re-run.
    expect(enqueued[0]!.id).to.equal('job-1');

    const claim = log[0]!;
    // Bounded-retry safety lives in the claim itself: the counter is durable
    // (checkpoint jsonb, no new column) and is incremented BEFORE the job goes
    // back on the queue, so a job that kills the process on sight has still
    // been counted. BullMQ's own attemptsMade resets on re-enqueue and cannot
    // do this.
    expect(claim.text).to.include("'{recovery}'");
    expect(claim.text).to.include("COALESCE((checkpoint #>> '{recovery,attempts}')::int, 0) + 1");
    // Claim and predicate in ONE statement is what makes two replicas safe:
    // the loser re-evaluates `status = 'running'` and finds the row taken.
    expect(claim.text).to.include("WHERE status = 'running'");
    // Nothing was failed, and the snapshot this run persisted is left alone —
    // the re-run owns it again (and is enqueued with force, so the 'complete'
    // written at 46% cannot short-circuit the six phases that follow).
    expect(log.some((q) => q.text.includes("SET status = 'failed'"))).to.equal(false);
    expect(log.some((q) => q.text.includes('UPDATE analysis_snapshots'))).to.equal(false);
  });

  it('a job that has exhausted its attempts is failed, and stays failed', async () => {
    // Third orphaning of the same row: the claim returns attempts = 3 with a
    // cap of 2, so this is a poison job, not an interrupted one.
    const log = stubDb([orphan({ recovery_attempts: 3 })]);
    let enqueues = 0;

    const result = await reconcileOrphanedJobs({
      log: () => {},
      maxAttempts: 2,
      requeueAnalysis: async () => { enqueues += 1; },
      requeueGeneration: async () => { enqueues += 1; },
    });

    expect(enqueues).to.equal(0);                       // no more LLM budget burned
    expect(result.failed).to.deep.equal(['job-1']);
    expect(result.requeued).to.be.empty;

    const fail = log.find((q) => q.text.includes("SET status = 'failed'"))!;
    expect(fail.text).to.include('UPDATE analysis_jobs');
    expect(String(fail.params![1])).to.include('lost this run 3 times');
    // Bug #75's crash variant still gets corrected: the snapshot must not keep
    // the optimistic 'complete' the persistence step wrote at 46%.
    expect(log.some((q) => q.text.includes('UPDATE analysis_snapshots'))).to.equal(true);

    // "Stays failed" is structural, from both ends: the sweep only ever claims
    // rows that are 'running', and the durable count keeps saying no even if
    // something put the row back.
    expect(log[0]!.text).to.include("WHERE status = 'running'");
    expect(isRecoverable('analyze_scope', 3, 2)).to.equal(false);
    expect(isRecoverable('analyze_scope', 2, 2)).to.equal(true);
    // Cheap, foreground, one-click job types are never silently auto-retried.
    expect(isRecoverable('preflight', 1, 2)).to.equal(false);
    expect(isRecoverable('regenerate_section', 1, 2)).to.equal(false);
  });

  /**
   * #74/B5. The 'running' claim cannot see a submission that never landed —
   * there is no heartbeat to go dead — so the row sat 'queued' forever behind
   * the concurrency guard. Both halves matter: aged AND absent from the queue.
   */
  describe("stranded 'queued' rows", () => {
    /** Claim returns nothing; the stranded SELECT returns `candidates`. */
    function stubStrandedDb(candidates: Array<{ id: string; project_id: string }>): QueryLogEntry[] {
      const log: QueryLogEntry[] = [];
      __setQueryForTests(async (text, params) => {
        log.push({ text, params });
        if (text.includes("SELECT id, project_id FROM analysis_jobs")) {
          return { rows: candidates, rowCount: candidates.length } as never;
        }
        // Terminal write: one row moved.
        if (text.includes("SET status = 'failed'")) return { rows: [], rowCount: 1 } as never;
        return { rows: [], rowCount: 0 } as never;
      });
      return log;
    }

    it('fails an aged row the queue has never heard of, and says so to the user', async () => {
      const log = stubStrandedDb([{ id: 'job-stranded', project_id: 'proj-1' }]);

      const result = await reconcileOrphanedJobs({
        log: () => {},
        requeueAnalysis: async () => { throw new Error('must not re-enqueue a stranded row'); },
        requeueGeneration: async () => { throw new Error('must not re-enqueue a stranded row'); },
        liveQueuedJobIds: async () => new Set<string>(),
        strandedAfterSeconds: 300,
      });

      expect(result.failed).to.deep.equal(['job-stranded']);
      expect(result.requeued).to.be.empty;

      const select = log.find((q) => q.text.includes('SELECT id, project_id FROM analysis_jobs'))!;
      expect(select.text).to.include("status = 'queued'");
      // Same COALESCE idiom as the running sweep, so a row this sweep just
      // re-queued (fresh heartbeat) is not mistaken for a stranded one.
      expect(select.text).to.include('COALESCE(last_heartbeat_at, started_at, created_at)');
      expect(select.params).to.deep.equal([300]);

      const fail = log.find((q) => q.text.includes("SET status = 'failed'"))!;
      expect(fail.params![0]).to.equal('job-stranded');
      expect(String(fail.params![1])).to.include('never reached the job queue');
      // Guarded, so a worker that picked it up mid-sweep is not stomped.
      expect(fail.text).to.include("WHERE id = $1 AND status = 'queued'");
      // The card must stop claiming an analysis that does not exist.
      expect(log.some((q) => q.text.includes('UPDATE projects'))).to.equal(true);
    });

    it('leaves an aged row alone while it is still on the queue', async () => {
      const log = stubStrandedDb([{ id: 'job-backlogged', project_id: 'proj-1' }]);

      const result = await reconcileOrphanedJobs({
        log: () => {},
        requeueAnalysis: async () => {},
        requeueGeneration: async () => {},
        // Waiting behind a backlog is not the same as never submitted, and a
        // long queue is normal here — analyses take minutes.
        liveQueuedJobIds: async () => new Set(['job-backlogged']),
      });

      expect(result.failed).to.be.empty;
      expect(log.some((q) => q.text.includes("SET status = 'failed'"))).to.equal(false);
    });

    it('does nothing at all when queue liveness cannot be established', async () => {
      const log = stubStrandedDb([{ id: 'job-unknown', project_id: 'proj-1' }]);
      const lines: string[] = [];

      const result = await reconcileOrphanedJobs({
        log: (m) => lines.push(m),
        requeueAnalysis: async () => {},
        requeueGeneration: async () => {},
        liveQueuedJobIds: async () => { throw new Error('ECONNREFUSED 127.0.0.1:6379'); },
      });

      expect(result.failed).to.be.empty;
      expect(log.some((q) => q.text.includes("SET status = 'failed'"))).to.equal(false);
      expect(lines.join('\n')).to.include('stranded-queued sweep failed');
    });
  });

  it('shutdown finishes an in-flight job instead of dropping it, and reports a blown grace period', async () => {
    let jobFinished = false;
    // BullMQ's close(false) resolves only once active jobs are done.
    const drainingWorker: ClosableWorker = {
      close: async () => {
        await new Promise((r) => setTimeout(r, 30));
        jobFinished = true;
      },
    };
    const clean = await drainWorkers({ workers: [drainingWorker], graceMs: 1_000 });
    expect(clean.drained).to.equal(true);
    expect(jobFinished).to.equal(true);   // the deploy waited for the run

    // A run that cannot finish inside the grace period is abandoned, not
    // waited on forever — the caller then hands it to the recovery sweep.
    const stuckWorker: ClosableWorker = { close: () => new Promise<void>(() => {}) };
    const expired = await drainWorkers({ workers: [stuckWorker], graceMs: 20 });
    expect(expired.drained).to.equal(false);
  });
});
