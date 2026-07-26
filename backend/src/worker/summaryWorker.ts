/**
 * Generation worker (doc/Pipeline.md "Generation"): builds onboarding
 * packages per (scope, role, commit) — request-flow tutorials first, then
 * the eleven sections one at a time, each with its own deterministic
 * query, semantic retrieval bundle, strong-tier call, and inline
 * trust-aware citation validation. Also serves `regenerate_section` jobs:
 * rebuild that section's bundle against the same snapshot, regenerate,
 * revalidate, replace content, keep the old generation run for audit.
 */

import { Worker, Job, Queue } from 'bullmq';
import { startQueueWatchdog } from '../lib/queueWatchdog.js';
import { SUMMARY_QUEUE, connection } from '../lib/queue.js';
import type { SummaryJobData } from '../lib/queue.js';
import { query } from '../lib/db.js';
import { recomputeProjectStatus } from '../lib/projectStatus.js';
import { mapLimit } from '../lib/parallel.js';
import { AiClient, AiPausedError } from './ai/aiClient.js';
import { BudgetEnforcer, BudgetExceededError, KillSwitchError } from './ai/budgetEnforcer.js';
import { resolveTierConfig } from './ai/modelTiers.js';
import { selectModel, isAutoSelection, overridesForSelection } from './ai/modelSelector.js';
import { markPhase } from './ai/checkpoints.js';
import type { PrivacyMode } from './ai/privacy.js';
import type { SemanticDepth } from './engine/budgets.js';
import type { DeveloperRole } from './semantic/projections.js';
import { settlePackageStaleness } from './incrementalAnalyzer.js';
import { SECTION_SPECS, SECTION_TYPES, buildSectionDeps, type SectionType } from './generation/sectionSpecs.js';
import { generateSection } from './generation/sectionGenerator.js';
import { generateDeterministicSection } from './generation/deterministicSectionGenerator.js';
import { generateTutorials } from './generation/tutorialGenerator.js';

// ── Snapshot + settings ──────────────────────────────────────────────────────

interface SnapRow {
  commit_hash: string;
  /** Provenance only (first analysis that produced this snapshot) — the
   * package's branch comes from the job data when present. */
  branch: string;
  project_id: string;
  scope_id: string;
  role: DeveloperRole;
  semantic_depth: SemanticDepth;
  privacy_mode: PrivacyMode;
  /** Live settings value — generation follows the CURRENT setting, not the
   * mode copied onto the snapshot when the analysis ran (changing AI &
   * privacy must change how packages generate without a re-analysis). */
  effective_privacy_mode: PrivacyMode;
  budget_overrides: unknown;
  budget_stop_behavior: 'fail' | 'pause' | 'degrade';
  model_failure_behavior: unknown;
  model_tier_overrides: unknown;
}

async function loadSnapshot(snapshotId: string): Promise<SnapRow> {
  const row = (await query(
    `SELECT s.commit_hash, s.branch, s.project_id, s.scope_id, s.semantic_depth, s.privacy_mode,
            COALESCE(ps.privacy_mode, s.privacy_mode) AS effective_privacy_mode,
            COALESCE(ps.default_developer_role, 'general') AS role,
            COALESCE(ps.budget_overrides, '{}'::jsonb) AS budget_overrides,
            COALESCE(ps.budget_stop_behavior, 'pause') AS budget_stop_behavior,
            COALESCE(ps.model_failure_behavior, '{}'::jsonb) AS model_failure_behavior,
            COALESCE(ps.model_tier_overrides, '{}'::jsonb) AS model_tier_overrides
     FROM analysis_snapshots s
     LEFT JOIN project_settings ps ON ps.project_id = s.project_id
     WHERE s.id = $1`,
    [snapshotId],
  )).rows[0] as SnapRow | undefined;
  if (!row) throw new Error(`Snapshot not found: ${snapshotId}`);
  return row;
}

// ── Worker ───────────────────────────────────────────────────────────────────

/**
 * A finished FULL generation becomes the requester's default package — their
 * sidebar selection follows the package they asked for. Regenerations of an
 * existing package never change anyone's default. Best-effort: a failed
 * default write must not fail a finished package.
 */
async function setMemberDefaultPackage(projectId: string, userId: string, packageId: string): Promise<void> {
  try {
    await query(
      `UPDATE project_members SET default_package_id = $3 WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId, packageId],
    );
  } catch (err) {
    console.warn(`[summary-worker] could not set member default package:`, err instanceof Error ? err.message : err);
  }
}

async function processSummaryJob(job: Job<SummaryJobData>): Promise<void> {
  const { jobId, snapshotId, projectId, triggeredBy, role: requestedRole, sectionType: regenerateSectionType } = job.data;

  const updateJob = async (status: string, step: string, pct: number, errorMsg?: string) => {
    const finishedAt = status === 'complete' || status === 'failed' || status === 'paused' ? new Date() : null;
    // Progress updates must not stomp a user-set pause/stop; terminal writes
    // always apply (a run finishing beats a just-clicked pause).
    const guard = status === 'running' ? `AND status NOT IN ('paused', 'failed')` : '';
    const result = await query(
      `UPDATE analysis_jobs
       SET status = $1, current_step = $2, progress_pct = $3,
           started_at = COALESCE(started_at, NOW()),
           last_heartbeat_at = NOW(),
           error_message = $4, finished_at = $6,
           step_log = step_log || $7::jsonb
       WHERE id = $5 ${guard}
       RETURNING id`,
      [status, step, pct, errorMsg ?? null, jobId, finishedAt,
       JSON.stringify([{ step, pct, ts: new Date().toISOString() }])],
    );
    if (status === 'running' && result.rows.length === 0) {
      const row = (await query(`SELECT status FROM analysis_jobs WHERE id = $1`, [jobId])).rows[0] as { status?: string } | undefined;
      throw new KillSwitchError(row?.status === 'paused' ? 'paused' : 'failed');
    }
  };

  const heartbeat = setInterval(() => {
    query(`UPDATE analysis_jobs SET last_heartbeat_at = NOW() WHERE id = $1 AND status = 'running'`, [jobId])
      .catch(() => {});
  }, 15_000);

  // Hoisted so the failure path can scope its package update to THIS run's
  // package — concurrent sibling generations must never be marked failed.
  let failedPackageId: string | null = null;
  // Hoisted so the finally path can flush amortized budget counters.
  let budgetRef: BudgetEnforcer | null = null;

  try {
    await query(`UPDATE analysis_jobs SET attempt = $2 WHERE id = $1`, [jobId, job.attemptsMade + 1]);
    await updateJob('running', 'Loading snapshot', 5);
    const snap = await loadSnapshot(snapshotId);
    const role = (requestedRole as DeveloperRole | undefined) ?? snap.role;
    // Branch is package identity; the snapshot's branch is only provenance
    // from whichever run analyzed this (scope, commit) first.
    const branch = job.data.branch ?? snap.branch;

    // Package row per (scope, role, commit, branch). Regenerate jobs target
    // the section's existing package (possibly built from an older commit) so
    // a stale section rebuilt against a newer snapshot lands in place instead
    // of spawning a fresh one-section package for the new commit.
    const packageId = job.data.packageId ?? ((await query(
      `INSERT INTO onboarding_packages
         (snapshot_id, project_id, scope_id, role, status, generated_by, analyzed_commit, branch)
       VALUES ($1, $2, $3, $4, 'generating', $5, $6, $7)
       ON CONFLICT (project_id, scope_id, role, analyzed_commit, branch) DO UPDATE
         SET snapshot_id = EXCLUDED.snapshot_id, status = 'generating', updated_at = NOW()
       RETURNING id`,
      [snapshotId, projectId, snap.scope_id, role, triggeredBy, snap.commit_hash, branch],
    )).rows[0] as { id: string }).id;
    failedPackageId = packageId;

    const deps = await buildSectionDeps(snapshotId, projectId, role);

    if (snap.effective_privacy_mode === 'ai_disabled') {
      // Spec: ai_disabled = deterministic-only outputs — the package still
      // exists, built from extracted facts, with zero LLM calls. Tutorials
      // are skipped (the Tutorials tab falls back to raw workflow steps).
      if (regenerateSectionType) {
        await updateJob('running', `Regenerating (deterministic): ${regenerateSectionType}`, 40);
        await generateDeterministicSection({
          snapshotId, packageId, role,
          sectionType: regenerateSectionType as SectionType,
          commitHash: snap.commit_hash, deps,
        });
        await settlePackageStaleness(packageId);
        await updateJob('complete', `Regenerated ${regenerateSectionType} (AI disabled)`, 100);
        await recomputeProjectStatus(projectId);
        return;
      }
      // A package row is reused across regenerations (ON CONFLICT above), so a
      // package first built under full_ai keeps whatever this branch does not
      // replace. Sections are replaced type-by-type below, but tutorials and
      // legacy-layout sections are not written at all here — without these
      // deletes the reader still showed the PREVIOUS run's AI-written
      // tutorials after the owner switched to ai_disabled, which is precisely
      // "changing to no-AI made no difference to my package".
      await query(
        `DELETE FROM package_sections WHERE package_id = $1 AND NOT (type = ANY($2))`,
        [packageId, [...SECTION_TYPES]],
      );
      await query(`DELETE FROM tutorials WHERE package_id = $1`, [packageId]);
      let done = 0;
      for (const sectionType of SECTION_TYPES) {
        await generateDeterministicSection({
          snapshotId, packageId, role, sectionType, commitHash: snap.commit_hash, deps,
        });
        done += 1;
        await updateJob('running', `Generated section: ${sectionType} (${done}/${SECTION_TYPES.length})`, 10 + Math.floor((done / SECTION_TYPES.length) * 85));
      }
      await query(`UPDATE onboarding_packages SET status = 'draft', updated_at = NOW() WHERE id = $1`, [packageId]);
      await markPhase(snapshotId, 'generation', 'complete', { sections: SECTION_TYPES.length, mode: 'deterministic' });
      await markPhase(snapshotId, 'validation', 'skipped', { reason: 'ai_disabled' });
      await updateJob('complete', 'Deterministic onboarding package ready (AI disabled)', 100);
      await setMemberDefaultPackage(projectId, triggeredBy, packageId);
      await recomputeProjectStatus(projectId);
      return;
    }
    const privacyMode = snap.effective_privacy_mode as 'full_ai' | 'facts_only_ai';

    const budget = await new BudgetEnforcer({
      snapshotId, jobId,
      depth: snap.semantic_depth,
      budgetOverrides: snap.budget_overrides,
      stopBehavior: snap.budget_stop_behavior,
    }).load();
    budgetRef = budget;
    // Auto model rotation: generation follows the same live-throughput pick
    // as analysis (5-min selection cache keeps a chained analyze→generate
    // run on one model).
    let generationOverrides: unknown = snap.model_tier_overrides;
    if (isAutoSelection(generationOverrides)) {
      const selection = await selectModel({ projectId });
      if (selection.rankings.length > 0) generationOverrides = overridesForSelection(selection);
    }
    const ai = new AiClient({
      projectId, snapshotId, jobId, privacyMode, budget,
      tierConfig: resolveTierConfig({
        modelTierOverrides: generationOverrides,
        modelFailureBehavior: snap.model_failure_behavior,
      }),
    });

    const sectionMetrics: Record<string, unknown> = {};

    if (regenerateSectionType) {
      // ── regenerate_section: one section, same snapshot, replace content ──
      // Legacy section types (pre-Diátaxis packages) have no spec anymore —
      // regenerating them individually is impossible; the whole package
      // regenerates into the new 12-section layout instead.
      if (!(regenerateSectionType in SECTION_SPECS)) {
        await updateJob('failed', `Section type "${regenerateSectionType}" is from a previous layout — regenerate the whole package instead`, 100);
        return;
      }
      await updateJob('running', `Regenerating: ${regenerateSectionType}`, 40);
      const result = await generateSection({
        ai, snapshotId, projectId, packageId, role,
        sectionType: regenerateSectionType as SectionType,
        privacyMode, commitHash: snap.commit_hash, deps,
      });
      // The package stays 'stale' while any other section still is; its
      // stale flags resolve once the last stale section is regenerated.
      await settlePackageStaleness(packageId);
      await updateJob('complete', `Regenerated ${regenerateSectionType}`, 100);
      await recomputeProjectStatus(projectId);
      console.log(`[summary-worker] regenerated ${regenerateSectionType} (section=${result.sectionId}, issues=${result.validation.issues.length})`);
      return;
    }

    // Layout migration: full generation replaces the package wholesale —
    // section rows from a previous layout and tutorials orphaned by workflow
    // re-extraction (workflow_id nulled by ON DELETE SET NULL) would
    // otherwise accumulate beside the fresh set. Idempotent on resume.
    await query(
      `DELETE FROM package_sections WHERE package_id = $1 AND NOT (type = ANY($2))`,
      [packageId, [...SECTION_TYPES]],
    );
    await query(`DELETE FROM tutorials WHERE package_id = $1 AND workflow_id IS NULL`, [packageId]);

    // Resume support: a retry of this job row skips work it already persisted.
    const checkpointRes = await query(`SELECT checkpoint FROM analysis_jobs WHERE id = $1`, [jobId]);
    const checkpoint = (checkpointRes.rows[0] as { checkpoint?: { completedSections?: string[]; tutorialsDone?: boolean } } | undefined)?.checkpoint;
    const completedSections = new Set<string>(checkpoint?.completedSections ?? []);
    let tutorialsDone = checkpoint?.tutorialsDone === true;

    const saveCheckpoint = async () => {
      const cursor = { completedSections: [...completedSections], tutorialsDone };
      await query(`UPDATE analysis_jobs SET checkpoint = $2 WHERE id = $1`, [jobId, JSON.stringify(cursor)]);
      await markPhase(snapshotId, 'generation', 'running', {}, { checkpoint: cursor });
    };
    await markPhase(snapshotId, 'generation', 'running', {}, {
      checkpoint: { completedSections: [...completedSections], tutorialsDone },
    });

    // ── tutorials ∥ sections (Track D): no section reads tutorials anymore
    //    (role_path retired by the Diátaxis redesign; the reading-order
    //    overlay replaces it in step 3), so all sections generate fully
    //    concurrent with the tutorial pass.
    let budgetDegraded = false;
    const tutorialsPromise: Promise<void> = tutorialsDone
      ? Promise.resolve()
      : (async () => {
          await updateJob('running', 'Generating request-flow tutorials', 12);
          const tutorialResult = await generateTutorials({
            ai, snapshotId, projectId, packageId, role, privacyMode,
            commitHash: snap.commit_hash, projections: deps.projections,
          });
          sectionMetrics.tutorials = tutorialResult;
          // Walkthrough UI enrichment: copy a tutorial step's note onto the
          // workflow step it came from, instead of paying for a second pass.
          // Joined on `metadata->>'workflow_step_order'`, NOT on step_order:
          // a tutorial is now a procedure (start the app, plant a marker,
          // trigger it, revert), so its step 4 is not the flow's step 4 and
          // position-matching would file notes against the wrong code. Only
          // steps that really mirror a traced step carry the key.
          await query(
            `UPDATE workflow_steps ws SET explanation = ts.explanation
             FROM tutorial_steps ts
             JOIN tutorials t ON t.id = ts.tutorial_id
             JOIN workflows w ON w.id = t.workflow_id
             WHERE t.package_id = $1 AND ws.workflow_id = w.id
               AND ws.step_order = (ts.metadata->>'workflow_step_order')::int
               AND ts.explanation <> ''`,
            [packageId],
          );
          tutorialsDone = true;
          await saveCheckpoint();
        })();
    // Mark the rejection handled the moment the promise exists: if TUTORIALS
    // trip the budget while sections are still in flight, the rejection
    // otherwise reaches end-of-turn unhandled and Node kills the whole
    // worker (observed live: exit 1 on BudgetExceededError). The real await
    // below still observes the error for pause/degrade handling.
    tutorialsPromise.catch(() => {});

    // ── sections: one call each (spec: never one giant call), generated
    //    concurrently — each persists as soon as it finishes, so the reader
    //    can show sections while the rest are still generating.
    const pending = SECTION_TYPES.filter((t) => !completedSections.has(t));
    const sectionConcurrency = Number(process.env.SECTION_CONCURRENCY ?? 12);
    let done = 0;
    const runSection = async (sectionType: SectionType): Promise<void> => {
      const result = await generateSection({
        ai, snapshotId, projectId, packageId, role, sectionType,
        privacyMode, commitHash: snap.commit_hash, deps,
      });
      sectionMetrics[sectionType] = {
        confidence: result.validation.confidence,
        issues: result.validation.issues.length,
        retried: result.retried,
        cached: result.cached === true,
      };
      completedSections.add(sectionType);
      done += 1;
      await updateJob('running', `Generated section: ${sectionType}${result.cached ? ' (cached)' : ''} (${done}/${pending.length})`, 15 + Math.floor((done / pending.length) * 75));
      await saveCheckpoint();
    };
    try {
      if (pending.length > 0) {
        await updateJob('running', `Generating sections (0/${pending.length})`, 15);
        await mapLimit(pending, sectionConcurrency, runSection);
      }
      await tutorialsPromise;
    } catch (err) {
      // The tutorials promise must not dangle as an unhandled rejection
      // when a section throws first.
      await tutorialsPromise.catch(() => {});
      if (err instanceof BudgetExceededError && err.behavior === 'degrade') {
        budgetDegraded = true; // keep what exists, stop LLM work
      } else {
        throw err;
      }
    }
    if (budgetDegraded) {
      await query(
        `UPDATE analysis_snapshots SET unknowns = unknowns || '[{"kind": "budget_degraded", "phase": "generation"}]'::jsonb WHERE id = $1`,
        [snapshotId],
      );
    }

    await query(`UPDATE onboarding_packages SET status = 'draft', updated_at = NOW() WHERE id = $1`, [packageId]);
    await markPhase(snapshotId, 'generation', 'complete', {
      sections: completedSections.size,
      budgetDegraded,
      llmCalls: ai.stats.calls,
      cacheHits: ai.stats.cacheHits,
      inputTokens: ai.stats.inputTokens,
      outputTokens: ai.stats.outputTokens,
      estimatedCostUsd: Math.round(ai.stats.estimatedCostUsd * 1e6) / 1e6,
      perSection: sectionMetrics,
    });

    // ── validation phase: aggregate re-check over persisted sections ───────
    await updateJob('running', 'Validating citations', 93);
    const validationStats = (await query(
      `SELECT confidence, count(*)::int AS n,
              count(*) FILTER (WHERE (SELECT count(*) FROM source_receipts r WHERE r.section_id = ps.id) = 0)::int AS unreceipted
       FROM package_sections ps WHERE ps.package_id = $1 GROUP BY confidence`,
      [packageId],
    )).rows;
    await markPhase(snapshotId, 'validation', 'complete', {
      sectionsByConfidence: validationStats,
      tutorials: sectionMetrics.tutorials ?? null,
    });

    // Other roles are generated on demand (POST /onboarding/generate) — a
    // full 5-role fan-out here paid 5x LLM cost for packages nobody may open
    // (bug #17).

    await updateJob('complete', 'Onboarding package ready', 100);
    await setMemberDefaultPackage(projectId, triggeredBy, packageId);
    await recomputeProjectStatus(projectId);
    console.log(`[summary-worker] job ${job.id} complete — package=${packageId} (role=${role}) sections=${completedSections.size}`);
  } catch (err) {
    // A failed/paused regenerate must not leave the section stuck in
    // 'regenerate_requested' (write-only state nothing resets): mark it
    // stale so the old content stays visible and the Regenerate button
    // comes back instead of the job silently vanishing.
    if (regenerateSectionType && job.data.packageId) {
      await query(
        `UPDATE package_sections SET review_status = 'stale'
         WHERE package_id = $1 AND type = $2 AND review_status = 'regenerate_requested'`,
        [job.data.packageId, regenerateSectionType],
      ).catch(() => {});
    }
    if (err instanceof AiPausedError || (err instanceof BudgetExceededError && err.behavior === 'pause')) {
      const message = err.message.slice(0, 200);
      await markPhase(snapshotId, 'generation', 'paused', {}, { errorMessage: message }).catch(() => {});
      await query(`UPDATE analysis_snapshots SET status = 'paused' WHERE id = $1`, [snapshotId]).catch(() => {});
      await updateJob('paused', `Paused: ${message}`, 0).catch(() => {});
      await recomputeProjectStatus(projectId).catch(() => {});
      console.warn(`[summary-worker] job ${job.id} paused:`, message);
      return; // resumable — a retry would just re-pause
    }
    if (err instanceof KillSwitchError) {
      await markPhase(snapshotId, 'generation', 'paused', {}, { errorMessage: err.message }).catch(() => {});
      console.warn(`[summary-worker] job ${job.id} stopped by kill switch (job status: ${err.jobStatus})`);
      return; // status was already set from the API
    }
    if (err instanceof BudgetExceededError && err.behavior === 'fail') {
      await query(`UPDATE analysis_snapshots SET status = 'failed' WHERE id = $1`, [snapshotId]).catch(() => {});
    }

    const message = err instanceof Error ? err.message : String(err);
    await markPhase(snapshotId, 'generation', 'failed', {}, { errorMessage: message.slice(0, 500) }).catch(() => {});
    await updateJob('failed', 'Failed', 0, message).catch(() => {});
    // Scope the failure to THIS run's package — concurrent sibling packages
    // at the same commit (other roles/branches) stay untouched.
    if (failedPackageId) {
      await query(
        `UPDATE onboarding_packages SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [failedPackageId],
      ).catch(() => {});
    }
    await recomputeProjectStatus(projectId).catch(() => {});
    console.error(`[summary-worker] job ${job.id} failed:`, message);
    throw err;
  } finally {
    clearInterval(heartbeat);
    // Terminal flush: amortized counters must not trail the run (Track C).
    await budgetRef?.flush().catch(() => {});
  }
}

function createSummaryWorker(): Worker<SummaryJobData> {
  const w = new Worker<SummaryJobData>(
    SUMMARY_QUEUE,
    processSummaryJob,
    {
      connection,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
      drainDelay: 5000,
      stalledInterval: 120_000,
      lockDuration: 600_000,
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 5 },
    },
  );

  w.on('completed', (job: Job<SummaryJobData>) => {
    console.log(`[summary-worker] completed job ${job.id}`);
  });

  w.on('failed', (job: Job<SummaryJobData> | undefined, err: Error) => {
    console.error(`[summary-worker] failed job ${job?.id}:`, err.message);
  });

  // Connection-level errors were invisible — a dead blocking socket looked like
  // an idle worker. Log them so "listening but deaf" is diagnosable.
  w.on('error', (err: Error) => {
    console.error('[summary-worker] worker error:', err.message);
  });
  return w;
}

export let summaryWorker = createSummaryWorker();

// Dead-consumer self-heal (see lib/queueWatchdog.ts): recreate the consumer
// in-process when queued jobs sit while nothing is active.
const summaryQueueForWatchdog = new Queue(SUMMARY_QUEUE, { connection });
startQueueWatchdog({
  queueName: SUMMARY_QUEUE,
  sample: async () => ({
    waiting: await summaryQueueForWatchdog.getWaitingCount(),
    active: await summaryQueueForWatchdog.getActiveCount(),
  }),
  recreate: async () => {
    await summaryWorker.close().catch(() => {});
    summaryWorker = createSummaryWorker();
  },
});

console.log(`[summary-worker] listening on queue "${SUMMARY_QUEUE}"`);
