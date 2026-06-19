import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import 'dotenv/config';

dns.setDefaultResultOrder('ipv4first');

import { Worker, Job } from 'bullmq';
import { ANALYSIS_QUEUE, connection, summaryQueue } from '../lib/queue.js';
import type { AnalysisJobData, SummaryJobData } from '../lib/queue.js';
import './summaryWorker.js';
import { getCommitSha, downloadZipball } from '../lib/github.js';
import { decrypt } from '../lib/encryption.js';
import { runAnalysis } from './engine/analysisRunner.js';
import { query, pool } from '../lib/db.js';
import { glob } from 'glob';

const execFileAsync = promisify(execFile);

function stableHash(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 16);
}

async function processAnalysisJob(job: Job<AnalysisJobData>): Promise<void> {
  const { jobId, projectId } = job.data;

  const updateStep = (step: string, pct = 0) =>
    query(
      `UPDATE analysis_jobs SET current_step = $1, progress_pct = $2, status = 'running', started_at = COALESCE(started_at, NOW()) WHERE id = $3`,
      [step, pct, jobId],
    );

  // 1. Look up project
  await updateStep('Loading project', 5);
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

  // 2. Fetch OAuth token
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
    await updateStep('Fetching commit info', 10);
    const commitHash = (await getCommitSha(token, repo_owner, repo_name, branch)).trim();

    // 4. Download zipball
    await updateStep('Downloading repository', 20);
    await downloadZipball(token, repo_owner, repo_name, branch, zipPath);

    // 5. Extract
    await updateStep('Extracting archive', 35);
    await execFileAsync('unzip', ['-q', zipPath, '-d', extractDir]);
    const entries = fs.readdirSync(extractDir);
    const repoRoot = path.join(extractDir, entries[0]!);

    // 6. Run AST analysis
    await updateStep('Analyzing codebase', 50);
    const snapshot = await runAnalysis({ projectId, triggeredBy: user_id, repoPath: repoRoot });

    // 7. Count workflow files
    const workflowFiles = await glob('**/*.{yml,yaml}', {
      cwd: path.join(repoRoot, '.github', 'workflows'),
      absolute: false,
    }).catch(() => []);

    // 8. Persist everything in a transaction
    await updateStep('Persisting results', 80);
    const fileCount = snapshot.repoIndex.files.length;
    const symbolCount = snapshot.fileAnalyses.reduce((n, fa) => n + fa.symbols.length, 0);

    let snapshotId = '';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert snapshot row — re-analyze same commit overwrites counts
      const snapResult = await client.query<{ id: string }>(
        `INSERT INTO analysis_snapshots
           (project_id, commit_hash, branch, file_count, symbol_count, workflow_count, status, warnings)
         VALUES ($1, $2, $3, $4, $5, $6, 'complete', $7)
         ON CONFLICT (project_id, commit_hash) DO UPDATE
           SET file_count = EXCLUDED.file_count,
               symbol_count = EXCLUDED.symbol_count,
               workflow_count = EXCLUDED.workflow_count,
               status = 'complete',
               warnings = EXCLUDED.warnings
         RETURNING id`,
        [projectId, commitHash, branch, fileCount, symbolCount, workflowFiles.length, JSON.stringify(snapshot.errors)],
      );
      snapshotId = snapResult.rows[0]!.id;

      // Clear stale graph data from previous scan of same commit
      await client.query(`DELETE FROM graph_edges WHERE snapshot_id = $1`, [snapshotId]);
      await client.query(`DELETE FROM graph_nodes WHERE snapshot_id = $1`, [snapshotId]);

      // Insert graph_nodes (one per file module)
      const nodeIdMap = new Map<string, string>(); // relativePath → DB id
      for (const node of snapshot.graph.nodes) {
        const exportedSymbols = node.metadata.exportedSymbols;
        const nodeHash = stableHash(JSON.stringify(exportedSymbols));
        const nodeResult = await client.query<{ id: string }>(
          `INSERT INTO graph_nodes (snapshot_id, stable_key, type, name, file_path, hash, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            snapshotId,
            node.id,
            node.kind,
            node.label,
            node.id,
            nodeHash,
            JSON.stringify({ exportedSymbols, importCount: node.metadata.importCount, dependentCount: node.metadata.dependentCount }),
          ],
        );
        nodeIdMap.set(node.id, nodeResult.rows[0]!.id);
      }

      // Insert graph_edges
      for (const edge of snapshot.graph.edges) {
        const sourceId = nodeIdMap.get(edge.source);
        const targetId = nodeIdMap.get(edge.target);
        if (!sourceId || !targetId) continue;
        await client.query(
          `INSERT INTO graph_edges (snapshot_id, source_node_id, target_node_id, type, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [snapshotId, sourceId, targetId, edge.kind, JSON.stringify({ weight: edge.weight })],
        );
      }

      // Link job to snapshot + mark complete
      await client.query(
        `UPDATE analysis_jobs
         SET status = 'complete', snapshot_id = $1, current_step = 'Complete', progress_pct = 100, finished_at = NOW()
         WHERE id = $2`,
        [snapshotId, jobId],
      );

      await client.query(
        `UPDATE projects SET status = 'complete', last_analyzed_at = NOW() WHERE id = $1`,
        [projectId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Enqueue summary generation job
    const summaryJobResult = await query(
      `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, status, current_step)
       VALUES ($1, $2, $3, 'generate_onboarding', 'queued', 'Waiting for worker')
       RETURNING id`,
      [projectId, snapshotId, user_id],
    );
    const summaryDbJobId: string = summaryJobResult.rows[0].id;
    await summaryQueue.add('generate_summary', {
      jobId: summaryDbJobId,
      snapshotId,
      projectId,
      triggeredBy: user_id,
    } satisfies SummaryJobData, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE analysis_jobs SET status = 'failed', current_step = 'Failed', error_message = $1, finished_at = NOW() WHERE id = $2`,
      [message, jobId],
    );
    await query(`UPDATE projects SET status = 'failed' WHERE id = $1`, [projectId]);
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
