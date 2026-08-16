import { expect } from 'chai';
import { __setQueryForTests } from '../../lib/db.js';
import { AiPausedError } from '../ai/aiClient.js';
import {
  claimRateLimitResume,
  isRateLimitPause,
  type RateLimitResumeClaim,
} from '../rateLimitResume.js';

interface QueryLogEntry { text: string; params?: unknown[] }

/**
 * Both workers construct BullMQ consumers at module load, so — same rule as
 * runStatus.test.ts and restartResilience.test.ts — the policy and the claim
 * are asserted through `rateLimitResume.ts`, the module the catch sites call,
 * with the database stubbed. The catch-site wiring itself (the delayed
 * re-enqueue) is not reachable from a test without opening Redis.
 */
function stubDb(rows: Array<Partial<RateLimitResumeClaim>>): QueryLogEntry[] {
  const log: QueryLogEntry[] = [];
  __setQueryForTests(async (text, params) => {
    log.push({ text, params });
    return { rows, rowCount: rows.length } as never;
  });
  return log;
}

describe('rate-limit auto-resume', () => {
  afterEach(() => __setQueryForTests(null));

  it('only a 429-caused pause qualifies', () => {
    expect(isRateLimitPause(new AiPausedError('provider rate limited', { rateLimited: true }))).to.equal(true);
    // A budget trip or a broken call pauses for a reason waiting cannot fix;
    // auto-resuming those would spend the cap re-failing identically.
    expect(isRateLimitPause(new AiPausedError('call budget exhausted'))).to.equal(false);
    expect(isRateLimitPause(new AiPausedError('x', { rateLimited: false }))).to.equal(false);
    // Name-matched, so the module needs no AI-layer import — but the flag is
    // still required, or any error someone names 'AiPausedError' would resume.
    const fieldless = new Error('LLM work paused: rate limited');
    fieldless.name = 'AiPausedError';
    expect(isRateLimitPause(fieldless)).to.equal(false);
    expect(isRateLimitPause(new Error('boom'))).to.equal(false);
    expect(isRateLimitPause(null)).to.equal(false);
    expect(isRateLimitPause({ name: 'AiPausedError', rateLimited: true })).to.equal(false);
  });

  it('claims one bounded resume in a single atomic statement', async () => {
    const log = stubDb([{
      id: 'job-1', project_id: 'proj-1', snapshot_id: 'snap-1', job_type: 'analyze_scope',
      scope_id: 'scope-1', branch: 'main', commit_hash: 'a'.repeat(40),
      semantic_depth: 'standard', role: 'general', requested_by: 'user-1', attempt: 2,
    }]);

    const claim = await claimRateLimitResume('job-1', 3);

    // The count comes back AFTER the increment, so the caller can log 2/3.
    expect(claim?.attempt).to.equal(2);
    // Everything needed to rebuild the enqueue payload rides on the claim.
    expect(claim?.commit_hash).to.equal('a'.repeat(40));
    expect(claim?.semantic_depth).to.equal('standard');
    expect(log).to.have.length(1);

    const sql = log[0]!.text;
    // One statement, predicate and write together, is what makes a concurrent
    // kill switch or a double catch unable to double-enqueue: the loser
    // re-evaluates this against the committed row and finds it 'queued'.
    expect(sql).to.include("WHERE id = $1 AND status = 'running'");
    expect(sql).to.include("COALESCE((checkpoint->>'rateLimitResumes')::int, 0) < $2");
    // Durable and incremented BY the claim, before the job goes back on the
    // queue — BullMQ's attemptsMade resets on re-enqueue and cannot bound this.
    expect(sql).to.include('jsonb_set(');
    expect(sql).to.include("'{rateLimitResumes}'");
    expect(sql).to.include("SET status = 'queued'");
    expect(log[0]!.params).to.deep.equal(['job-1', 3, '5 min']);
  });

  it('returns null when the cap is spent or the row already left running', async () => {
    const log = stubDb([]);

    expect(await claimRateLimitResume('job-1', 3)).to.equal(null);
    // No second statement: a lost claim writes nothing at all, so the caller
    // falls through to the ordinary pause with the row untouched.
    expect(log).to.have.length(1);
  });
});
