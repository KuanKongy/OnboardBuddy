import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import 'dotenv/config';

dns.setDefaultResultOrder('ipv4first');

import { Worker, Job } from 'bullmq';
import { ANALYSIS_QUEUE, connection } from '../lib/queue.js';
import type { AnalysisJobData } from '../lib/queue.js';
import { getCommitSha, downloadZipball } from '../lib/github.js';
import { decrypt } from '../lib/encryption.js';
import { runAnalysis } from './engine/analysisRunner.js';
import { slimSnapshot } from './engine/serializer.js';
import { query } from '../lib/db.js';
import { glob } from 'glob';

const execFileAsync = promisify(execFile);

async function processAnalysisJob(job: Job<AnalysisJobData>): Promise<void> {
  const { jobId, projectId } = job.data;

  const updateStep = (step: string) =>
    query(`UPDATE analysis_jobs SET current_step = $1 WHERE id = $2`, [step, jobId]);

  // 1. Look up project
  await updateStep('Loading project');
  const projectResult = await query(
    `SELECT user_id, repo_owner, repo_name, branch FROM projects WHERE id = $1`,
    [projectId],
  );
  if (projectResult.rows.length === 0) throw new Error(`Project not found: ${projectId}`);

  const { user_id, repo_owner, repo_name, branch } = projectResult.rows[0] as {
    user_id: string;
    repo_owner: string;
    repo_name: string;
    branch: string;
  };

  // 2. Fetch OAuth token from github_connections
  const connResult = await query(
    `SELECT access_token_encrypted FROM github_connections WHERE user_id = $1`,
    [user_id],
  );
  if (connResult.rows.length === 0) throw new Error(`No GitHub connection for user: ${user_id}`);

  const token = decrypt(connResult.rows[0].access_token_encrypted as string);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `onboardbuddy-${projectId}-`));
  const zipPath = path.join(tmpDir, 'repo.zip');
  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir);

  try {
    // 3. Get commit SHA
    await updateStep('Fetching commit info');
    const commitHash = (await getCommitSha(token, repo_owner, repo_name, branch)).trim();

    // 4. Download zipball
    await updateStep('Downloading repository');
    await downloadZipball(token, repo_owner, repo_name, branch, zipPath);

    // 5. Extract zip — GitHub archives have a single top-level subfolder
    await updateStep('Extracting archive');
    await execFileAsync('unzip', ['-q', zipPath, '-d', extractDir]);
    const entries = fs.readdirSync(extractDir);
    const repoRoot = path.join(extractDir, entries[0]!);

    // 6. Run AST analysis
    await updateStep('Analyzing codebase');
    const snapshot = await runAnalysis({ projectId, triggeredBy: user_id, repoPath: repoRoot });
    const slim = slimSnapshot(snapshot);

    // 7. Count workflows
    const workflowFiles = await glob('**/*.{yml,yaml}', {
      cwd: path.join(repoRoot, '.github', 'workflows'),
      absolute: false,
    }).catch(() => []);

    // 8. Persist snapshot with correct schema
    await updateStep('Persisting results');
    const fileCount = snapshot.repoIndex.files.length;
    const symbolCount = snapshot.fileAnalyses.reduce((n, fa) => n + fa.symbols.length, 0);

    await query(
      `INSERT INTO analysis_snapshots
         (project_id, commit_hash, branch, file_count, symbol_count, workflow_count, status, warnings, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, 'complete', $7, $8)`,
      [
        projectId,
        commitHash,
        branch,
        fileCount,
        symbolCount,
        workflowFiles.length,
        JSON.stringify(snapshot.errors),
        JSON.stringify(slim),
      ],
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

    await query(`UPDATE projects SET status = 'error' WHERE id = $1`, [projectId]);

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
