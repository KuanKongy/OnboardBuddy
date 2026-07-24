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
import { getCommitSha, downloadZipball, getInstallationToken, getRepo } from '../lib/github.js';
import { runAnalysis } from './engine/analysisRunner.js';
import { detectEntrypoints, persistEntrypoints } from './engine/entrypointDetector.js';
import { detectSideEffects, persistSideEffects } from './engine/sideEffectDetector.js';
import { extractWorkflowsDetailed, persistWorkflows } from './engine/workflowExtractor.js';
import {
  rankCandidates,
  persistCandidateRankings,
  gateSymbolsForDepth,
} from './engine/candidateRanker.js';
import { fetchChurnSignals, persistChurn, type ChurnStats } from './engine/churnService.js';
import { clusterArchitecture, persistArchitecture } from './engine/architectureClusterer.js';
import { scanConfigNodes } from './engine/configScanner.js';
import { extractConfigFlows } from './engine/configFlowExtractor.js';
import { composeJourneys } from './engine/journeyComposer.js';
import { validateGoldenJourneys } from './engine/journeyGate.js';
import { selectModel, isAutoSelection, overridesForSelection } from './ai/modelSelector.js';
import { checkDocHealth } from './engine/docHealthCheck.js';
import { ingestDocs } from './engine/docsIngester.js';
import {
  buildEvidenceGraph,
  persistEvidenceGraph,
  persistRepositoryFiles,
} from './engine/evidenceGraphBuilder.js';
import { runPreflight } from './engine/preflightService.js';
import { markPhase } from './ai/checkpoints.js';
import { capturePriorSymbolRecords } from './semantic/recordStore.js';
import { AiClient, AiPausedError } from './ai/aiClient.js';
import { BudgetEnforcer, BudgetExceededError, KillSwitchError } from './ai/budgetEnforcer.js';
import { resolveTierConfig } from './ai/modelTiers.js';
import { runSemanticPipeline, SEMANTIC_PHASES } from './semantic/semanticPipeline.js';
import { findPreviousSnapshot, runIncrementalDiff } from './incrementalAnalyzer.js';
import type { SemanticContext } from './semantic/context.js';
import type { SemanticDepth } from './engine/budgets.js';
import { query, pool } from '../lib/db.js';
import { recomputeProjectStatus } from '../lib/projectStatus.js';

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
  budget_overrides: unknown;
  budget_stop_behavior: 'fail' | 'pause' | 'degrade';
  model_failure_behavior: unknown;
  model_tier_overrides: unknown;
}

async function loadProject(projectId: string): Promise<ProjectRow> {
  const projectResult = await query(
    `SELECT p.user_id, p.repo_owner, p.repo_name, p.branch, p.github_installation_id,
            ps.ignored_paths, ps.file_limit,
            COALESCE(ps.analysis_depth, 'standard') AS analysis_depth,
            COALESCE(ps.privacy_mode, 'full_ai') AS privacy_mode,
            COALESCE(ps.budget_overrides, '{}'::jsonb) AS budget_overrides,
            COALESCE(ps.budget_stop_behavior, 'pause') AS budget_stop_behavior,
            COALESCE(ps.model_failure_behavior, '{}'::jsonb) AS model_failure_behavior,
            COALESCE(ps.model_tier_overrides, '{}'::jsonb) AS model_tier_overrides
     FROM projects p
     LEFT JOIN project_settings ps ON ps.project_id = p.id
     WHERE p.id = $1`,
    [projectId],
  );
  if (projectResult.rows.length === 0) throw new Error(`Project not found: ${projectId}`);
  return projectResult.rows[0] as ProjectRow;
}

/**
 * Downloads and extracts the repo zipball; returns the extracted repo root.
 * `requestedCommit` pins the analysis to an exact SHA (the GitHub zipball
 * API accepts any ref); omitted = head of `requestedBranch` (per-run choice),
 * falling back to the project's default branch.
 */
async function fetchRepoToTmp(project: ProjectRow, projectId: string, tmpDir: string, requestedCommit?: string, requestedBranch?: string): Promise<{ repoRoot: string; commitHash: string; token: string }> {
  if (!project.github_installation_id) {
    throw new Error(`No GitHub App installation linked to project: ${projectId}. Re-import the repo.`);
  }
  const token = await getInstallationToken(Number(project.github_installation_id));

  // Keep the dashboard-card repo metadata fresh while we're here (each run
  // already holds a token). Fire-and-forget: a metadata hiccup never fails a run.
  refreshRepoMetadata(projectId, project, token).catch((err) =>
    console.warn(`[worker] repo metadata refresh failed for ${projectId}:`, err instanceof Error ? err.message : err),
  );

  const zipPath = path.join(tmpDir, 'repo.zip');
  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir);

  const branch = requestedBranch ?? project.branch;
  // Always record the full 40-char SHA: a short requested SHA stored verbatim
  // forks the (scope, commit) snapshot identity — the same commit gets two
  // snapshot rows and incremental diffs compare the wrong pair.
  const commitHash = requestedCommit && /^[0-9a-f]{40}$/i.test(requestedCommit)
    ? requestedCommit
    : (await getCommitSha(token, project.repo_owner, project.repo_name, requestedCommit ?? branch)).trim();
  await downloadZipball(token, project.repo_owner, project.repo_name, requestedCommit ?? branch, zipPath);
  await execFileAsync('unzip', ['-q', zipPath, '-d', extractDir]);
  const entries = fs.readdirSync(extractDir);
  return { repoRoot: path.join(extractDir, entries[0]!), commitHash, token };
}

/** GitHub-side repo metadata shown on dashboard cards (description/language/pushed_at). */
async function refreshRepoMetadata(projectId: string, project: ProjectRow, token: string): Promise<void> {
  const repo = await getRepo(token, project.repo_owner, project.repo_name);
  await query(
    `UPDATE projects SET repo_description = $1, primary_language = $2, repo_pushed_at = $3 WHERE id = $4`,
    [repo.description?.slice(0, 350) ?? null, repo.language ?? null, repo.pushed_at ?? null, projectId],
  );
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
    const { repoRoot, commitHash } = await fetchRepoToTmp(project, projectId, tmpDir, job.data.commit, job.data.branch);

    await update('Building analysis preview', 70);
    const preview = await runPreflight(repoRoot, {
      pathPrefix: scope.pathPrefix,
      ignoredPaths: project.ignored_paths ?? undefined,
      depth: job.data.depth ?? project.analysis_depth,
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

/**
 * Insert the generate_package job row and enqueue it. requestedBy is the user
 * who asked for the ANALYSIS (not the project owner) — their member default
 * package is set when the generated package completes.
 */
async function enqueueSummaryGeneration(opts: {
  projectId: string;
  snapshotId: string;
  requestedBy: string;
  role?: string | null;
  branch?: string | null;
  commitHash?: string | null;
  scopeId?: string | null;
}): Promise<string> {
  const result = await query(
    `INSERT INTO analysis_jobs
       (project_id, snapshot_id, requested_by, job_type, status, current_step, role, branch, commit_hash, scope_id)
     VALUES ($1, $2, $3, 'generate_package', 'queued', 'Waiting for worker', $4, $5, $6, $7)
     RETURNING id`,
    [opts.projectId, opts.snapshotId, opts.requestedBy, opts.role ?? null,
     opts.branch ?? null, opts.commitHash ?? null, opts.scopeId ?? null],
  );
  const summaryJobId = (result.rows[0] as { id: string }).id;
  await getSummaryQueue().add('generate_summary', {
    jobId: summaryJobId,
    snapshotId: opts.snapshotId,
    projectId: opts.projectId,
    triggeredBy: opts.requestedBy,
    role: opts.role ?? undefined,
    branch: opts.branch ?? undefined,
  } satisfies SummaryJobData, {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  });
  return summaryJobId;
}

// ─── Analysis job ────────────────────────────────────────────────────────────

async function processAnalysisJob(job: Job<AnalysisJobData>): Promise<void> {
  const { jobId, projectId } = job.data;

  const updateStep = async (step: string, pct = 0) => {
    const result = await query(
      `UPDATE analysis_jobs
       SET current_step = $1,
           progress_pct = $2,
           status = 'running',
           started_at = COALESCE(started_at, NOW()),
           last_heartbeat_at = NOW(),
           step_log = step_log || $4::jsonb
       WHERE id = $3 AND status NOT IN ('paused', 'failed')
       RETURNING id`,
      [step, pct, jobId, JSON.stringify([{ step, pct, ts: new Date().toISOString() }])],
    );
    // Paused/stopped from the API between steps: honor it instead of
    // stomping the user's status back to 'running'.
    if (result.rows.length === 0) {
      const row = (await query(`SELECT status FROM analysis_jobs WHERE id = $1`, [jobId])).rows[0] as { status?: string } | undefined;
      throw new KillSwitchError(row?.status === 'paused' ? 'paused' : 'failed');
    }
  };

  // 1. Look up project + settings + scope. Branch and depth are per-run
  //    choices (job.data) falling back to project defaults.
  await query(`UPDATE analysis_jobs SET attempt = $2 WHERE id = $1`, [jobId, job.attemptsMade + 1]);
  await updateStep('Loading project', 5);
  const project = await loadProject(projectId);
  const { user_id, branch, ignored_paths, file_limit, analysis_depth, privacy_mode } = {
    user_id: project.user_id,
    branch: job.data.branch ?? project.branch,
    ignored_paths: project.ignored_paths,
    file_limit: project.file_limit,
    analysis_depth: job.data.depth ?? project.analysis_depth,
    privacy_mode: project.privacy_mode,
  };
  const scope = await resolveScope(projectId, job.data.scopeId);
  // Attribute the whole run (and the chained package generation) to whoever
  // requested it — NOT the project owner. Their member default package is
  // set when the package completes.
  const requester = ((await query(
    `SELECT requested_by FROM analysis_jobs WHERE id = $1`, [jobId],
  )).rows[0] as { requested_by: string | null } | undefined)?.requested_by ?? user_id;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `onboardbuddy-${projectId}-`));

  // Liveness: a running job with a stale heartbeat is presumed dead and gets
  // reconciled — stamp it independently of step progress (LLM phases can sit
  // on one step for minutes).
  const heartbeat = setInterval(() => {
    query(`UPDATE analysis_jobs SET last_heartbeat_at = NOW() WHERE id = $1 AND status = 'running'`, [jobId])
      .catch(() => {});
  }, 15_000);

  try {
    // 2. Download + extract zipball at the requested commit (default: branch head)
    await updateStep('Downloading repository', 10);
    const { repoRoot, commitHash, token } = await fetchRepoToTmp(project, projectId, tmpDir, job.data.commit, job.data.branch);

    // 2b. Stamp the resolved identity: head runs only resolve to a commit
    //     here, and the duplicate guard + run history need the real
    //     (scope, commit, branch) on the job row.
    await query(
      `UPDATE analysis_jobs SET commit_hash = $2, scope_id = $3, branch = $4 WHERE id = $1`,
      [jobId, commitHash, scope.scopeId, branch],
    );

    // Concurrent-duplicate guard: two head runs can pass the API's tuple
    // check and resolve to the same (scope, commit). The older one wins;
    // this one bows out before touching the shared snapshot row.
    const twin = await query(
      `SELECT id FROM analysis_jobs
       WHERE project_id = $1 AND id <> $2 AND status IN ('queued', 'running')
         AND job_type IN ('analyze_scope', 'incremental_update')
         AND scope_id = $3 AND commit_hash = $4
         AND created_at < (SELECT created_at FROM analysis_jobs WHERE id = $2)
       LIMIT 1`,
      [projectId, jobId, scope.scopeId, commitHash],
    );
    if (twin.rows.length > 0) {
      await query(
        `UPDATE analysis_jobs
         SET status = 'failed', current_step = 'Duplicate run', finished_at = NOW(),
             error_message = 'This scope and commit are already being analyzed by another run.'
         WHERE id = $1`,
        [jobId],
      );
      await recomputeProjectStatus(projectId);
      return;
    }

    // 2c. Snapshot reuse: snapshots are content-addressed per (scope, commit)
    //     while branch is package identity — a branch cut from an analyzed
    //     head skips re-analysis and jumps straight to generating its own
    //     package (LLM work would be cache hits anyway). `force` re-analyzes.
    if (!job.data.force) {
      const existing = (await query(
        `SELECT id FROM analysis_snapshots
         WHERE scope_id = $1 AND commit_hash = $2 AND status = 'complete'`,
        [scope.scopeId, commitHash],
      )).rows[0] as { id: string } | undefined;
      if (existing) {
        await updateStep('Reusing existing analysis for this commit', 70);
        await query(
          `UPDATE analysis_jobs
           SET status = 'complete', snapshot_id = $1, current_step = 'Complete (analysis reused)',
               progress_pct = 100, finished_at = NOW(), step_log = step_log || $3::jsonb
           WHERE id = $2`,
          [existing.id, jobId,
           JSON.stringify([{ step: 'Complete (analysis reused)', pct: 100, ts: new Date().toISOString() }])],
        );
        // Webhook runs set autoGenerate=false: an already-analyzed commit
        // (e.g. a redelivered push) must not silently pay for a package.
        if (job.data.autoGenerate !== false) {
          await enqueueSummaryGeneration({
            projectId, snapshotId: existing.id, requestedBy: requester,
            role: job.data.role, branch, commitHash, scopeId: scope.scopeId,
          });
        }
        await recomputeProjectStatus(projectId);
        return;
      }
    }

    // 3. Deterministic analysis: inventory, language guardrail input, AST,
    //    symbol extraction, dependency graph — scope-bounded
    await updateStep('Analyzing codebase', 22);
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
    await updateStep('Detecting entrypoints and side effects', 34);
    const entrypoints = detectEntrypoints(snapshot.fileAnalyses);
    const sideEffects = detectSideEffects(snapshot.fileAnalyses);
    const configNodes = scanConfigNodes(snapshot.fileRecords, snapshot.inventory);
    // Config-as-flow (DETECTION_COVERAGE.md §3): compose/CI/env/scripts parsed
    // into topology + dev journeys; annotates configNodes before graph build
    // so the topology rides in the compose node's metadata.
    const configFlows = extractConfigFlows({
      fileRecords: snapshot.fileRecords,
      inventory: snapshot.inventory,
      configNodes,
    });
    const knownPaths = new Set(snapshot.fileRecords.map((r) => r.relativePath));
    const docs = ingestDocs(snapshot.fileRecords, knownPaths);

    // 7. Build the full evidence graph
    await updateStep('Building evidence graph', 40);
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
    await updateStep('Persisting results', 46);
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

    // Link the job to its snapshot as soon as it exists — the overview's
    // unified run panel reads phase rows by the job's snapshot_id live.
    await query(`UPDATE analysis_jobs SET snapshot_id = $2 WHERE id = $1`, [jobId, snapshotId]);

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
    await updateStep('Persisting entrypoints and side effects', 54);
    const entrypointIdMap = await persistEntrypoints(snapshotId, entrypoints, nodeIdMap);
    await persistSideEffects(snapshotId, sideEffects, nodeIdMap);

    await updateStep('Extracting workflows', 57);
    const extraction = extractWorkflowsDetailed({ graph: evidence, entrypoints, sideEffects });
    // Journey composition: stitch route workflows across queue boundaries,
    // OAuth chains, and capability groups into the product journeys; config
    // journeys (compose up, one-command tests, CI) persist beside them and
    // rank through the same machinery.
    const journeys = composeJourneys({ workflows: extraction.workflows, sideEffects });
    const workflows = [...extraction.workflows, ...configFlows.workflows, ...journeys];
    const workflowIdMap = await persistWorkflows(snapshotId, workflows, nodeIdMap, entrypointIdMap);
    await query(
      `UPDATE analysis_snapshots SET workflow_count = $2 WHERE id = $1`,
      [snapshotId, workflows.length],
    );
    // Golden-journey gate: detectable shapes (queue+consumer pairs, auth
    // routes, oauth chains, compose) must have composed into journeys.
    const gate = validateGoldenJourneys({
      workflows, entrypoints, sideEffects,
      hasCompose: configFlows.topology !== null,
    });
    await markPhase(snapshotId, 'workflows', 'complete', {
      workflows: workflows.length,
      journeys: journeys.length,
      configJourneys: configFlows.workflows.length,
      deadEnds: extraction.deadEnds.length,
      journeyGatePasses: gate.passes,
      journeyGaps: gate.gaps.length,
    });
    if (workflows.length === 0) {
      await query(
        `UPDATE analysis_snapshots SET unknowns = unknowns || '[{"kind": "no_workflows_found"}]'::jsonb WHERE id = $1`,
        [snapshotId],
      );
    }
    // Honesty rule: traces that died, calls into unmodeled packages, and
    // golden-journey gaps are findable work, surfaced in snapshot unknowns
    // (trust panel reads them).
    const honestyUnknowns: Array<Record<string, unknown>> = [...gate.gaps];
    if (extraction.deadEnds.length > 0) {
      honestyUnknowns.push({
        kind: 'trace_dead_ends',
        count: extraction.deadEnds.length,
        examples: extraction.deadEnds.slice(0, 5),
      });
    }
    const unknownExternalPkgs = [...new Set(
      sideEffects.filter((e) => e.kind === 'unknown_external').map((e) => e.target ?? 'unknown'),
    )];
    if (unknownExternalPkgs.length > 0) {
      honestyUnknowns.push({
        kind: 'unknown_external_calls',
        packages: unknownExternalPkgs.slice(0, 15),
        count: unknownExternalPkgs.length,
      });
    }
    // Doc-vs-code staleness (step 3 trust-panel overlay): docs claiming
    // routes or env vars the extraction can't find are flagged, not ignored.
    const docConflicts = checkDocHealth({
      docNodes: docs.nodes,
      entrypoints,
      envVarNames: configFlows.envVars.flatMap((f) => f.vars.map((v) => v.name)),
    });
    honestyUnknowns.push(...docConflicts.map((c) => ({ ...c })));
    if (honestyUnknowns.length > 0) {
      await query(
        `UPDATE analysis_snapshots SET unknowns = unknowns || $2::jsonb WHERE id = $1`,
        [snapshotId, JSON.stringify(honestyUnknowns)],
      );
    }

    // 10. Churn (GitHub API, degrades to 0-weight on any failure), then
    //     Phase A candidate ranking + depth gating
    await updateStep('Fetching churn signals', 59);
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

    await updateStep('Ranking candidates', 61);
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
    await updateStep('Clustering architecture', 63);
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

    // 11.5 Incremental diff (spec "Incremental Updates"): when this scope was
    //      analyzed before at a different commit, diff files/symbols, insert
    //      stale flags, and mark affected sections/tutorials/packages stale.
    //      Downstream, content addressing makes unchanged symbols cache hits.
    const previous = await findPreviousSnapshot(scope.scopeId, snapshotId);
    const isIncremental = previous !== null && previous.commitHash !== commitHash;
    if (isIncremental) {
      await updateStep('Diffing against previous snapshot', 65);
      await query(`UPDATE analysis_snapshots SET trigger_type = 'incremental' WHERE id = $1`, [snapshotId]);
      const diff = await runIncrementalDiff({
        projectId,
        scopeId: scope.scopeId,
        snapshotId,
        commitHash,
        prevSnapshotId: previous.snapshotId,
        prevCommitHash: previous.commitHash,
        graph: evidence,
        sideEffects,
        architecture,
        inventory: snapshot.inventory,
      });
      await markPhase(snapshotId, 'incremental_diff', 'complete', diff.metrics);
    } else {
      await markPhase(snapshotId, 'incremental_diff', 'skipped', {
        reason: previous ? 'same_commit_rescan' : 'no_previous_snapshot',
      });
    }

    // 12. Semantic pipeline (phases 7-12): symbol records -> synthesis ->
    //     capabilities -> refinement -> critique -> Phase B reranking.
    if (privacy_mode === 'ai_disabled') {
      for (const phase of SEMANTIC_PHASES) {
        await markPhase(snapshotId, phase, 'skipped', { reason: 'ai_disabled' });
      }
    } else {
      await updateStep('Semantic analysis (LLM)', 66);
      // Track E: capture the previous mapping's record identity BEFORE the
      // delete — unchanged symbols then re-map in bulk with zero lookups
      // and zero LLM calls (the gate re-checks evidence/prompt/model/depth).
      const priorSymbolRecords = await capturePriorSymbolRecords(snapshotId, previous?.snapshotId ?? null);
      // Clear snapshot-scoped semantic rows from a previous scan of this
      // commit (project-scoped semantic_records stay — they are the cache).
      await query(`DELETE FROM snapshot_semantic_records WHERE snapshot_id = $1`, [snapshotId]);
      await query(`DELETE FROM capabilities WHERE snapshot_id = $1`, [snapshotId]);

      // Auto model rotation (user directive 2026-07-24): unless the project
      // pins a model, probe OpenRouter's per-provider endpoints and pick the
      // fastest structured-output-capable model right now — privacy is
      // enforced request-side via provider.data_collection='deny'.
      let modelTierOverrides: unknown = project.model_tier_overrides;
      if (isAutoSelection(modelTierOverrides)) {
        const selection = await selectModel({ projectId });
        if (selection.rankings.length > 0) {
          modelTierOverrides = overridesForSelection(selection);
          await updateStep(`Model: ${selection.model.split('/')[1] ?? selection.model} (live throughput pick)`, 64);
        }
      }
      const tierConfig = resolveTierConfig({
        modelTierOverrides,
        modelFailureBehavior: project.model_failure_behavior,
      });
      const budget = await new BudgetEnforcer({
        snapshotId,
        jobId,
        depth: analysis_depth,
        budgetOverrides: project.budget_overrides,
        stopBehavior: project.budget_stop_behavior,
      }).load();
      const ai = new AiClient({ projectId, snapshotId, jobId, privacyMode: privacy_mode, budget, tierConfig });

      // Track F: semantic sub-phases own the 66→98 progress band with real
      // batch counters — the job used to sit at a static percentage for the
      // entire LLM phase. Throttled to ~1 write/1.5s; updateStep doubles as
      // the kill-switch check, so pause responsiveness improves too.
      const SEMANTIC_PCT_BAND: Record<string, [number, number]> = {
        semantic_symbols: [66, 84], synthesis: [84, 90], capabilities: [90, 91],
        refinement: [91, 92], critique: [92, 96], semantic_ranking: [96, 97], embeddings: [97, 98],
      };
      let lastProgressWriteMs = 0;
      const onProgress = async (info: { phase: string; done: number; total: number; detail?: string }): Promise<void> => {
        const nowMs = Date.now();
        const atBoundary = info.done === 0 || info.done >= info.total;
        if (!atBoundary && nowMs - lastProgressWriteMs < 1_500) return;
        lastProgressWriteMs = nowMs;
        const [lo, hi] = SEMANTIC_PCT_BAND[info.phase] ?? [66, 98];
        const frac = info.total > 0 ? Math.min(1, info.done / info.total) : 0;
        const pct = Math.min(98, Math.round(lo + (hi - lo) * frac));
        const label = info.detail ?? `Semantic: ${info.phase.replace(/_/g, ' ')} (${info.done}/${info.total})`;
        await updateStep(label, pct);
      };

      const semanticCtx: SemanticContext = {
        ai,
        projectId,
        snapshotId,
        commitHash,
        depth: analysis_depth,
        privacyMode: privacy_mode,
        modelFamily: { cheap: tierConfig.models.cheap[0]!, strong: tierConfig.models.strong[0]! },
        graph: evidence,
        nodeIdMap,
        entrypoints,
        sideEffects,
        workflows,
        workflowIdMap,
        architecture,
        rankings,
        gating,
        inventory: snapshot.inventory,
        priorSymbolRecords,
        onProgress,
      };

      try {
        const outcome = await runSemanticPipeline(semanticCtx);
        if (outcome.status === 'degraded') {
          await query(
            `UPDATE analysis_snapshots SET unknowns = unknowns || '[{"kind": "budget_degraded", "phase": "semantic"}]'::jsonb WHERE id = $1`,
            [snapshotId],
          );
        }
      } catch (err) {
        // Amortized counters must survive every terminal path (Track C).
        await budget.flush().catch(() => {});
        if (err instanceof AiPausedError || (err instanceof BudgetExceededError && err.behavior === 'pause')) {
          // Resumable: checkpointed phases + content-addressed records make
          // a re-run skip everything already paid for.
          await query(`UPDATE analysis_snapshots SET status = 'paused' WHERE id = $1`, [snapshotId]);
          await query(
            `UPDATE analysis_jobs SET status = 'paused', current_step = $2, finished_at = NOW() WHERE id = $1`,
            [jobId, `Paused: ${err.message.slice(0, 120)}`],
          );
          console.warn(`[worker] semantic pipeline paused (project=${projectId}):`, err.message);
          return;
        }
        if (err instanceof KillSwitchError) {
          console.warn(`[worker] semantic pipeline stopped by kill switch (project=${projectId})`);
          return; // job status was already set from the API
        }
        if (err instanceof BudgetExceededError && err.behavior === 'fail') {
          await query(`UPDATE analysis_snapshots SET status = 'failed' WHERE id = $1`, [snapshotId]);
        }
        throw err;
      }
      await budget.flush().catch(() => {});
    }

    // 13. Mark job complete
    await query(
      `UPDATE analysis_jobs
       SET status = 'complete', snapshot_id = $1, scope_id = $4, current_step = 'Complete', progress_pct = 100, finished_at = NOW(),
           step_log = step_log || $3::jsonb
       WHERE id = $2`,
      [snapshotId, jobId, JSON.stringify([{ step: 'Complete', pct: 100, ts: new Date().toISOString() }]), scope.scopeId],
    );
    await query(`UPDATE projects SET last_analyzed_at = NOW() WHERE id = $1`, [projectId]);

    // Enqueue summary generation. Incremental runs skip this: existing
    // packages were stale-flagged where affected, and stale sections/
    // tutorials are regenerated on request against this snapshot instead of
    // paying for a full package rebuild. ai_disabled projects get a
    // deterministic (LLM-free) package — the summary worker picks the path.
    if (!isIncremental) {
      await enqueueSummaryGeneration({
        projectId, snapshotId, requestedBy: requester,
        role: job.data.role, branch, commitHash, scopeId: scope.scopeId,
      });
    }
    // After the enqueue: a queued generation keeps the project 'analyzing'.
    await recomputeProjectStatus(projectId);
  } catch (err) {
    if (err instanceof KillSwitchError) {
      // Paused/stopped from the API between steps — the status was already
      // set there; leaving quietly keeps it (and the checkpoints) intact.
      console.warn(`[worker] job ${jobId} stopped by kill switch (status: ${err.jobStatus})`);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE analysis_jobs SET status = 'failed', current_step = 'Failed', error_message = $1, finished_at = NOW(),
           step_log = step_log || $3::jsonb
       WHERE id = $2`,
      [message, jobId, JSON.stringify([{ step: `Failed: ${message.slice(0, 100)}`, pct: 0, ts: new Date().toISOString() }])],
    );
    // A failing run must not stomp the scalar while a sibling is still live.
    await recomputeProjectStatus(projectId);
    throw err;
  } finally {
    clearInterval(heartbeat);
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

// Connection-level errors were invisible — a dead blocking socket looked like
// an idle worker. Log them so "listening but deaf" is diagnosable.
worker.on('error', (err: Error) => {
  console.error('[worker] worker error:', err.message);
});

/**
 * Orphan reconciliation: a DB job stuck 'running' whose worker died (restart,
 * crash, lost Redis connection) would show a progress bar over nothing,
 * forever. Heartbeats stamp every ~15s, so 3 minutes of silence means the
 * run is dead — mark it honestly and free the project for a retry.
 */
async function reconcileOrphanedJobs(): Promise<void> {
  try {
    const orphans = (await query(
      `UPDATE analysis_jobs
       SET status = 'failed', finished_at = NOW(),
           error_message = 'Worker lost this run (restart or crash). Completed phases are checkpointed — run Analyze… again to resume from cache.'
       WHERE status = 'running'
         AND COALESCE(last_heartbeat_at, started_at, created_at) < NOW() - INTERVAL '3 minutes'
       RETURNING id, project_id, snapshot_id`,
    )).rows as Array<{ id: string; project_id: string; snapshot_id: string | null }>;
    for (const row of orphans) {
      if (row.snapshot_id) {
        await query(
          `UPDATE analysis_snapshots SET status = 'failed' WHERE id = $1 AND status IN ('running', 'pending')`,
          [row.snapshot_id],
        ).catch(() => {});
      }
      await recomputeProjectStatus(row.project_id).catch(() => {});
      console.warn(`[worker] reconciled orphaned job ${row.id} (no heartbeat for 3+ minutes)`);
    }
  } catch (err) {
    console.error('[worker] orphan reconciliation failed:', err instanceof Error ? err.message : err);
  }
}
void reconcileOrphanedJobs();
setInterval(() => void reconcileOrphanedJobs(), 120_000);

console.log(`[worker] listening on queue "${ANALYSIS_QUEUE}"`);
