import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import 'dotenv/config';

dns.setDefaultResultOrder('ipv4first');

import { Worker, Job } from 'bullmq';
import { ANALYSIS_QUEUE, connection, getSummaryQueue } from '../lib/queue.js';
import type { AnalysisJobData, SummaryJobData } from '../lib/queue.js';
import './summaryWorker.js';
import { getCommitSha, downloadZipball, getInstallationToken } from '../lib/github.js';
import { runAnalysis } from './engine/analysisRunner.js';
import { detectEntrypoints, persistEntrypoints } from './engine/entrypointDetector.js';
import { detectSideEffects, persistSideEffects } from './engine/sideEffectDetector.js';
import { extractWorkflows, persistWorkflows } from './engine/workflowExtractor.js';
import {
  rankCandidates,
  persistCandidateRankings,
  gateSymbolsForDepth,
} from './engine/candidateRanker.js';
import { fetchChurnSignals, persistChurn, type ChurnStats } from './engine/churnService.js';
import { clusterArchitecture, persistArchitecture } from './engine/architectureClusterer.js';
import { scanConfigNodes } from './engine/configScanner.js';
import { ingestDocs } from './engine/docsIngester.js';
import {
  buildEvidenceGraph,
  persistEvidenceGraph,
  persistRepositoryFiles,
} from './engine/evidenceGraphBuilder.js';
import { runPreflight } from './engine/preflightService.js';
import { markPhase } from './ai/checkpoints.js';
import type { SemanticDepth } from './engine/budgets.js';
import { query, pool } from '../lib/db.js';

const execFileAsync = promisify(execFile);

// ─── Shared job helpers ──────────────────────────────────────────────────────

interface ProjectRow {
  user_id: string;
  repo_owner: string;
  repo_name: string;
  branch: string;
  github_installation_id: string | null;
  ignored_paths: string[] | null;
  file_limit: number | null;
  analysis_depth: SemanticDepth;
  privacy_mode: 'full_ai' | 'facts_only_ai' | 'ai_disabled';
}

async function loadProject(projectId: string): Promise<ProjectRow> {
  const projectResult = await query(
    `SELECT p.user_id, p.repo_owner, p.repo_name, p.branch, p.github_installation_id,
            ps.ignored_paths, ps.file_limit,
            COALESCE(ps.analysis_depth, 'standard') AS analysis_depth,
            COALESCE(ps.privacy_mode, 'full_ai') AS privacy_mode
     FROM projects p
     LEFT JOIN project_settings ps ON ps.project_id = p.id
     WHERE p.id = $1`,
    [projectId],
  );
  if (projectResult.rows.length === 0) throw new Error(`Project not found: ${projectId}`);
  return projectResult.rows[0] as ProjectRow;
}

/** Downloads and extracts the repo zipball; returns the extracted repo root. */
async function fetchRepoToTmp(project: ProjectRow, projectId: string, tmpDir: string): Promise<{ repoRoot: string; commitHash: string; token: string }> {
  if (!project.github_installation_id) {
    throw new Error(`No GitHub App installation linked to project: ${projectId}. Re-import the repo.`);
  }
  const token = await getInstallationToken(Number(project.github_installation_id));

  const zipPath = path.join(tmpDir, 'repo.zip');
  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir);

  const commitHash = (await getCommitSha(token, project.repo_owner, project.repo_name, project.branch)).trim();
  await downloadZipball(token, project.repo_owner, project.repo_name, project.branch, zipPath);
  await execFileAsync('unzip', ['-q', zipPath, '-d', extractDir]);
  const entries = fs.readdirSync(extractDir);
  return { repoRoot: path.join(extractDir, entries[0]!), commitHash, token };
}

/** Resolves the job's scope (path prefix); defaults to the whole-repo scope. */
async function resolveScope(projectId: string, scopeId?: string): Promise<{ scopeId: string; pathPrefix: string }> {
  if (scopeId) {
    const result = await query(
      `SELECT id, path_prefix FROM analysis_scopes WHERE id = $1 AND project_id = $2`,
      [scopeId, projectId],
    );
    if (result.rows.length === 0) throw new Error(`Scope not found: ${scopeId}`);
    const row = result.rows[0] as { id: string; path_prefix: string };
    return { scopeId: row.id, pathPrefix: row.path_prefix };
  }
  const result = await query(
    `INSERT INTO analysis_scopes (project_id, path_prefix, display_name, kind, detected_from)
     VALUES ($1, '', 'Whole repository', 'whole_repo', 'default')
     ON CONFLICT (project_id, path_prefix) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [projectId],
  );
  return { scopeId: (result.rows[0] as { id: string }).id, pathPrefix: '' };
}

// ─── Preflight job ───────────────────────────────────────────────────────────

async function processPreflightJob(job: Job<AnalysisJobData>): Promise<void> {
  const { jobId, projectId, scopeId } = job.data;

  const update = (step: string, pct: number) =>
    query(
      `UPDATE analysis_jobs SET current_step = $1, progress_pct = $2, status = 'running',
              started_at = COALESCE(started_at, NOW())
       WHERE id = $3`,
      [step, pct, jobId],
    );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `onboardbuddy-preflight-${projectId}-`));
  try {
    await update('Loading project', 10);
    const project = await loadProject(projectId);
    const scope = scopeId ? await resolveScope(projectId, scopeId) : { scopeId: null, pathPrefix: '' };

    await update('Downloading repository', 30);
    const { repoRoot, commitHash } = await fetchRepoToTmp(project, projectId, tmpDir);

    await update('Building analysis preview', 70);
    const preview = await runPreflight(repoRoot, {
      pathPrefix: scope.pathPrefix,
      ignoredPaths: project.ignored_paths ?? undefined,
      depth: project.analysis_depth,
      privacyMode: project.privacy_mode,
    });

    // The preview lands on the job's checkpoint; /analysis-status returns it.
    await query(
      `UPDATE analysis_jobs
       SET status = 'complete', current_step = 'Preview ready', progress_pct = 100,
           finished_at = NOW(), checkpoint = $1
       WHERE id = $2`,
      [JSON.stringify({ preview, commitHash }), jobId],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE analysis_jobs SET status = 'failed', current_step = 'Failed', error_message = $1, finished_at = NOW() WHERE id = $2`,
      [message, jobId],
    );
    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Analysis job ────────────────────────────────────────────────────────────

async function processAnalysisJob(job: Job<AnalysisJobData>): Promise<void> {
  const { jobId, projectId } = job.data;

  const updateStep = (step: string, pct = 0) =>
    query(
      `UPDATE analysis_jobs
       SET current_step = $1,
           progress_pct = $2,
           status = 'running',
           started_at = COALESCE(started_at, NOW()),
           step_log = step_log || $4::jsonb
       WHERE id = $3`,
      [step, pct, jobId, JSON.stringify([{ step, pct, ts: new Date().toISOString() }])],
    );

  // 1. Look up project + settings + scope
  await updateStep('Loading project', 5);
  const project = await loadProject(projectId);
  const { user_id, branch, ignored_paths, file_limit, analysis_depth, privacy_mode } = {
    user_id: project.user_id,
    branch: project.branch,
    ignored_paths: project.ignored_paths,
    file_limit: project.file_limit,
    analysis_depth: project.analysis_depth,
    privacy_mode: project.privacy_mode,
  };
  const scope = await resolveScope(projectId, job.data.scopeId);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `onboardbuddy-${projectId}-`));

  try {
    // 2. Download + extract zipball at the branch head commit
    await updateStep('Downloading repository', 15);
    const { repoRoot, commitHash, token } = await fetchRepoToTmp(project, projectId, tmpDir);

    // 3. Deterministic analysis: inventory, language guardrail input, AST,
    //    symbol extraction, dependency graph — scope-bounded
    await updateStep('Analyzing codebase', 40);
    const snapshot = await runAnalysis({
      projectId,
      triggeredBy: user_id,
      repoPath: repoRoot,
      ignoredPaths: ignored_paths ?? undefined,
      fileLimit: file_limit ?? undefined,
      pathPrefix: scope.pathPrefix,
    });

    // 4. Upsert proposed scopes so the UI can offer them next time
    for (const proposal of snapshot.scopeProposals) {
      await query(
        `INSERT INTO analysis_scopes (project_id, path_prefix, display_name, kind, detected_from)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (project_id, path_prefix) DO NOTHING`,
        [projectId, proposal.pathPrefix, proposal.displayName, proposal.kind, proposal.detectedFrom],
      );
    }

    const unknowns: Array<Record<string, unknown>> = [];
    if (snapshot.languageInventory.unsupportedFileCount > 0) {
      unknowns.push({
        kind: 'unsupported_languages',
        detail: Object.keys(snapshot.languageInventory.unsupported).join(', '),
        fileCount: snapshot.languageInventory.unsupportedFileCount,
      });
    }

    // 5. Language guardrail: nothing parseable -> fail transparently.
    if (snapshot.languageInventory.supportedFileCount === 0) {
      unknowns.push({ kind: 'unsupported_only_repo' });
      await query(
        `INSERT INTO analysis_snapshots
           (project_id, scope_id, commit_hash, branch, status, semantic_depth, privacy_mode,
            language_inventory, unknowns, warnings)
         VALUES ($1, $2, $3, $4, 'failed', $5, $6, $7, $8, '[]')
         ON CONFLICT (scope_id, commit_hash) DO UPDATE
           SET status = 'failed', language_inventory = EXCLUDED.language_inventory,
               unknowns = EXCLUDED.unknowns`,
        [projectId, scope.scopeId, commitHash, branch, analysis_depth, privacy_mode,
         JSON.stringify(snapshot.languageInventory), JSON.stringify(unknowns)],
      );
      throw new Error(
        `No supported source files in scope '${scope.pathPrefix || 'whole repo'}'. ` +
        `Found: ${Object.keys(snapshot.languageInventory.unsupported).join(', ') || 'no source files'}. ` +
        `OnboardBuddy currently parses TypeScript/JavaScript only.`,
      );
    }

    // 6. Detectors + evidence-node scanners (symbol-level)
    await updateStep('Detecting entrypoints and side effects', 55);
    const entrypoints = detectEntrypoints(snapshot.fileAnalyses);
    const sideEffects = detectSideEffects(snapshot.fileAnalyses);
    const configNodes = scanConfigNodes(snapshot.fileRecords, snapshot.inventory);
    const knownPaths = new Set(snapshot.fileRecords.map((r) => r.relativePath));
    const docs = ingestDocs(snapshot.fileRecords, knownPaths);

    // 7. Build the full evidence graph
    await updateStep('Building evidence graph', 65);
    const evidence = buildEvidenceGraph({
      fileAnalyses: snapshot.fileAnalyses,
      fileRecords: snapshot.fileRecords,
      entrypoints,
      sideEffects,
      configNodes,
      docs,
      rootPath: repoRoot,
    });

    // 8. Persist snapshot + files + graph in one transaction
    await updateStep('Persisting results', 75);
    const fileCount = snapshot.fileRecords.length;
    const symbolCount = snapshot.fileAnalyses.reduce((n, fa) => n + fa.symbols.length, 0);

    let snapshotId = '';
    let nodeIdMap = new Map<string, string>();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const snapResult = await client.query<{ id: string }>(
        `INSERT INTO analysis_snapshots
           (project_id, scope_id, commit_hash, branch, file_count, symbol_count, workflow_count,
            status, semantic_depth, privacy_mode, language_inventory, unknowns, warnings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'complete', $8, $9, $10, $11, $12)
         ON CONFLICT (scope_id, commit_hash) DO UPDATE
           SET file_count = EXCLUDED.file_count,
               symbol_count = EXCLUDED.symbol_count,
               workflow_count = EXCLUDED.workflow_count,
               status = 'complete',
               semantic_depth = EXCLUDED.semantic_depth,
               privacy_mode = EXCLUDED.privacy_mode,
               language_inventory = EXCLUDED.language_inventory,
               unknowns = EXCLUDED.unknowns,
               warnings = EXCLUDED.warnings
         RETURNING id`,
        [projectId, scope.scopeId, commitHash, branch, fileCount, symbolCount, 0 /* set after extraction */,
         analysis_depth, privacy_mode,
         JSON.stringify(snapshot.languageInventory), JSON.stringify(unknowns), JSON.stringify(snapshot.errors)],
      );
      snapshotId = snapResult.rows[0]!.id;

      // Clear stale data from a previous scan of the same commit
      await client.query(`DELETE FROM workflows WHERE snapshot_id = $1`, [snapshotId]);
      await client.query(`DELETE FROM entrypoints WHERE snapshot_id = $1`, [snapshotId]);
      await client.query(`DELETE FROM side_effects WHERE snapshot_id = $1`, [snapshotId]);
      await client.query(`DELETE FROM criticality_scores WHERE snapshot_id = $1`, [snapshotId]);
      await client.query(`DELETE FROM architecture_edges WHERE snapshot_id = $1`, [snapshotId]);
      await client.query(`DELETE FROM architecture_clusters WHERE snapshot_id = $1`, [snapshotId]);
      await client.query(`DELETE FROM graph_edges WHERE snapshot_id = $1`, [snapshotId]);
      await client.query(`DELETE FROM graph_nodes WHERE snapshot_id = $1`, [snapshotId]);
      await client.query(`DELETE FROM repository_files WHERE snapshot_id = $1`, [snapshotId]);

      await persistRepositoryFiles(client, snapshotId, snapshot.fileRecords);
      nodeIdMap = await persistEvidenceGraph(client, snapshotId, evidence);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await markPhase(snapshotId, 'ingest', 'complete', {
      files: fileCount,
      supportedFiles: snapshot.languageInventory.supportedFileCount,
      unsupportedFiles: snapshot.languageInventory.unsupportedFileCount,
    });
    await markPhase(snapshotId, 'parse', 'complete', {
      parsedFiles: snapshot.fileAnalyses.length,
      symbols: symbolCount,
      parseErrors: snapshot.errors.length,
    });
    await markPhase(snapshotId, 'graph', 'complete', {
      nodes: evidence.nodes.length,
      edges: evidence.edges.length,
      docNodes: docs.nodes.length,
      configNodes: configNodes.length,
    });

    // 9. Entrypoints, side effects, workflows (call-graph traversal)
    await updateStep('Persisting entrypoints and side effects', 82);
    const entrypointIdMap = await persistEntrypoints(snapshotId, entrypoints, nodeIdMap);
    await persistSideEffects(snapshotId, sideEffects, nodeIdMap);

    await updateStep('Extracting workflows', 86);
    const workflows = extractWorkflows({ graph: evidence, entrypoints, sideEffects });
    const workflowIdMap = await persistWorkflows(snapshotId, workflows, nodeIdMap, entrypointIdMap);
    await query(
      `UPDATE analysis_snapshots SET workflow_count = $2 WHERE id = $1`,
      [snapshotId, workflows.length],
    );
    await markPhase(snapshotId, 'workflows', 'complete', { workflows: workflows.length });
    if (workflows.length === 0) {
      await query(
        `UPDATE analysis_snapshots SET unknowns = unknowns || '[{"kind": "no_workflows_found"}]'::jsonb WHERE id = $1`,
        [snapshotId],
      );
    }

    // 10. Churn (GitHub API, degrades to 0-weight on any failure), then
    //     Phase A candidate ranking + depth gating
    await updateStep('Fetching churn signals', 89);
    let churn = new Map<string, ChurnStats>();
    try {
      // Preliminary churn-free ranking picks the top files worth a per-file
      // churn request; dirs give everything else a coarse fallback signal.
      const preliminary = rankCandidates({ graph: evidence, entrypoints, sideEffects, workflows });
      const topFiles = preliminary
        .filter((r) => r.targetType === 'file')
        .slice(0, 20)
        .map((r) => r.stableKey);
      const topLevelDirs = [...new Set(
        snapshot.fileRecords
          .filter((r) => r.relativePath.includes('/'))
          .map((r) => r.relativePath.split('/')[0]!),
      )].slice(0, 10);
      churn = await fetchChurnSignals({
        token,
        owner: project.repo_owner,
        repo: project.repo_name,
        branch,
        topLevelDirs,
        topFiles,
      });
      await persistChurn(snapshotId, churn, new Set(snapshot.fileRecords.map((r) => r.relativePath)));
    } catch (err) {
      console.warn(`[worker] churn fetch failed (project=${projectId}):`, err instanceof Error ? err.message : err);
    }

    await updateStep('Ranking candidates', 93);
    const rankings = rankCandidates({ graph: evidence, entrypoints, sideEffects, workflows, churn });
    const rankedTargets = await persistCandidateRankings(snapshotId, rankings, nodeIdMap, workflowIdMap);
    const gating = gateSymbolsForDepth(analysis_depth, rankings, { graph: evidence, entrypoints, workflows });
    await markPhase(snapshotId, 'candidate_ranking', 'complete', {
      rankedTargets,
      churnPathsFetched: churn.size,
      depth: analysis_depth,
      symbolsSelectedForLlm: gating.selected.length,
      symbolsFactsOnly: gating.factsOnly.length,
    });

    // 11. Deterministic architecture clustering
    await updateStep('Clustering architecture', 96);
    const architecture = clusterArchitecture({
      graph: evidence,
      inventory: snapshot.inventory,
      workflows,
      rankings,
    });
    await persistArchitecture(snapshotId, architecture, nodeIdMap);
    await markPhase(snapshotId, 'clustering', 'complete', {
      clusters: architecture.clusters.length,
      clusterEdges: architecture.edges.length,
    });

    // 12. Mark job complete
    await query(
      `UPDATE analysis_jobs
       SET status = 'complete', snapshot_id = $1, scope_id = $4, current_step = 'Complete', progress_pct = 100, finished_at = NOW(),
           step_log = step_log || $3::jsonb
       WHERE id = $2`,
      [snapshotId, jobId, JSON.stringify([{ step: 'Complete', pct: 100, ts: new Date().toISOString() }]), scope.scopeId],
    );
    await query(
      `UPDATE projects SET status = 'complete', last_analyzed_at = NOW() WHERE id = $1`,
      [projectId],
    );

    // Enqueue summary generation job (only if AI is enabled)
    if (privacy_mode !== 'ai_disabled') {
      const summaryJobResult = await query(
        `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, status, current_step)
         VALUES ($1, $2, $3, 'generate_package', 'queued', 'Waiting for worker')
         RETURNING id`,
        [projectId, snapshotId, user_id],
      );
      const summaryDbJobId: string = summaryJobResult.rows[0].id;
      await getSummaryQueue().add('generate_summary', {
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
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE analysis_jobs SET status = 'failed', current_step = 'Failed', error_message = $1, finished_at = NOW(),
           step_log = step_log || $3::jsonb
       WHERE id = $2`,
      [message, jobId, JSON.stringify([{ step: `Failed: ${message.slice(0, 100)}`, pct: 0, ts: new Date().toISOString() }])],
    );
    await query(`UPDATE projects SET status = 'failed' WHERE id = $1`, [projectId]);
    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const worker = new Worker<AnalysisJobData>(
  ANALYSIS_QUEUE,
  async (job: Job<AnalysisJobData>) => {
    if (job.data.task === 'preflight') {
      await processPreflightJob(job);
    } else {
      await processAnalysisJob(job);
    }
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
    drainDelay: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 30000),
    stalledInterval: 120_000,
    lockDuration: 600_000,
    removeOnComplete: { count: 5 },
    removeOnFail: { count: 5 },
  },
);

worker.on('completed', (job: Job<AnalysisJobData>) => {
  console.log(`[worker] job ${job.id} completed (project=${job.data.projectId})`);
});

worker.on('failed', (job: Job<AnalysisJobData> | undefined, err: Error) => {
  console.error(`[worker] job ${job?.id} failed (project=${job?.data.projectId}):`, err.message);
});

console.log(`[worker] listening on queue "${ANALYSIS_QUEUE}"`);
