import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import 'dotenv/config';

dns.setDefaultResultOrder('ipv4first');

import { Worker, Job } from 'bullmq';
import { ANALYSIS_QUEUE, connection } from '../lib/queue.js';
import type { AnalysisJobData } from '../lib/queue.js';
import { getInstallationToken } from '../lib/github.js';
import { cloneRepo } from './engine/repoIngester.js';
import { runAnalysis } from './engine/analysisRunner.js';
import { slimSnapshot } from './engine/serializer.js';
import { query } from '../lib/db.js';

async function processAnalysisJob(job: Job<AnalysisJobData>): Promise<void> {
  const { jobId, projectId, triggeredBy, repoOwner, repoName, branch, installationId } = job.data;

  const updateStep = (step: string) =>
    query(
      `UPDATE analysis_jobs SET current_step = $1 WHERE id = $2`,
      [step, jobId],
    );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `onboardbuddy-${projectId}-`));

  try {
    await updateStep('Cloning repository');
    const token = await getInstallationToken(installationId);
    const cloneUrl = `https://x-access-token:${token}@github.com/${repoOwner}/${repoName}.git`;
    await cloneRepo(cloneUrl, tmpDir);

    await updateStep('Analyzing codebase');
    const snapshot = await runAnalysis({
      projectId,
      triggeredBy,
      repoPath: tmpDir,
    });

    await updateStep('Persisting results');
    const slim = slimSnapshot(snapshot);

    await query(
      `INSERT INTO analysis_snapshots (project_id, triggered_by, snapshot, duration_ms, errors)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, triggeredBy, JSON.stringify(slim), snapshot.durationMs, JSON.stringify(snapshot.errors)],
    );

    await query(
      `UPDATE projects SET status = 'ready', last_analyzed_at = NOW() WHERE id = $1`,
      [projectId],
    );

    await query(
      `UPDATE analysis_jobs SET status = 'done', current_step = 'Complete', finished_at = NOW() WHERE id = $1`,
      [jobId],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await query(
      `UPDATE analysis_jobs SET status = 'failed', current_step = $1, finished_at = NOW() WHERE id = $2`,
      [`Failed: ${message}`, jobId],
    );

    await query(
      `UPDATE projects SET status = 'error' WHERE id = $1`,
      [projectId],
    );

    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const worker = new Worker<AnalysisJobData>(
  ANALYSIS_QUEUE,
  processAnalysisJob,
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  },
);

worker.on('completed', (job) => {
  console.log(`[worker] job ${job.id} completed (project=${job.data.projectId})`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed (project=${job?.data.projectId}):`, err.message);
});

console.log(`[worker] listening on queue "${ANALYSIS_QUEUE}"`);
