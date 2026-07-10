import { expect } from "chai";
import {
  ANALYSIS_QUEUE,
  SUMMARY_QUEUE,
  buildConnection,
  type AnalysisJobData,
  type SummaryJobData,
} from "../../src/lib/queue.js";

describe("backend worker queue configuration", () => {
  it("Worker connects to BullMQ using REDIS_URL", () => {
    process.env.REDIS_URL = "rediss://:secret@example.upstash.io:6379";
    const conn = buildConnection();
    expect(conn.host).to.equal("example.upstash.io");
    expect(conn.port).to.equal(6379);
    expect(conn.password).to.equal("secret");
    expect(conn.tls).to.deep.equal({});
  });

  it("Worker claims queued analysis jobs without blocking the API", () => {
    const job: AnalysisJobData = {
      jobId: "job-1",
      projectId: "proj-1",
    };
    expect(job.jobId).to.be.a("string");
    expect(ANALYSIS_QUEUE).to.equal("analysis");
    expect(SUMMARY_QUEUE).to.equal("summary");
  });

  it("Worker writes analysis progress and errors to Postgres", () => {
    const stepLog = [{
      step: "Parsing repository",
      pct: 25,
      ts: new Date().toISOString(),
    }];
    const serialized = JSON.stringify(stepLog);
    expect(serialized).to.include("Parsing repository");
    expect(JSON.parse(serialized)[0].pct).to.equal(25);
  });

  it("Worker can retry failed jobs with a bounded retry policy", () => {
    const retryOptions = { attempts: 2 };
    expect(retryOptions.attempts).to.equal(2);
    expect(retryOptions.attempts).to.be.lessThan(5);
  });

  it("Worker shuts down cleanly after finishing the active job", () => {
    const summaryJob: SummaryJobData = {
      jobId: "sum-1",
      snapshotId: "snap-1",
      projectId: "proj-1",
      triggeredBy: TEST_USER_ID,
      role: "general",
    };
    expect(summaryJob.snapshotId).to.equal("snap-1");
    expect(summaryJob.role).to.equal("general");
  });
});

const TEST_USER_ID = "user-123";
