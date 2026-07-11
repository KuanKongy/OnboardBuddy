/**
 * Generation worker (doc/Pipeline.md "Generation"): builds onboarding
 * packages per (scope, role, commit) — request-flow tutorials first, then
 * the eleven sections one at a time, each with its own deterministic
 * query, semantic retrieval bundle, strong-tier call, and inline
 * trust-aware citation validation. Also serves `regenerate_section` jobs:
 * rebuild that section's bundle against the same snapshot, regenerate,
 * revalidate, replace content, keep the old generation run for audit.
 */

import { Worker, Job } from 'bullmq';
import { SUMMARY_QUEUE, connection, getSummaryQueue } from '../lib/queue.js';
import type { SummaryJobData } from '../lib/queue.js';
import { query } from '../lib/db.js';
import { AiClient, AiPausedError } from './ai/aiClient.js';
import { BudgetEnforcer, BudgetExceededError, KillSwitchError } from './ai/budgetEnforcer.js';
import { resolveTierConfig } from './ai/modelTiers.js';
import { markPhase } from './ai/checkpoints.js';
import type { PrivacyMode } from './ai/privacy.js';
import type { SemanticDepth } from './engine/budgets.js';
import type { DeveloperRole } from './semantic/projections.js';
import { settlePackageStaleness } from './incrementalAnalyzer.js';
import { SECTION_TYPES, buildSectionDeps, type SectionType } from './generation/sectionSpecs.js';
import { generateSection } from './generation/sectionGenerator.js';
import { generateTutorials } from './generation/tutorialGenerator.js';

// ── Snapshot + settings ──────────────────────────────────────────────────────

interface SnapRow {
  commit_hash: string;
  project_id: string;
  scope_id: string;
  role: DeveloperRole;
  semantic_depth: SemanticDepth;
  privacy_mode: PrivacyMode;
  budget_overrides: unknown;
  budget_stop_behavior: 'fail' | 'pause' | 'degrade';
  model_failure_behavior: unknown;
  model_tier_overrides: unknown;
}

async function loadSnapshot(snapshotId: string): Promise<SnapRow> {
  const row = (await query(
    `SELECT s.commit_hash, s.project_id, s.scope_id, s.semantic_depth, s.privacy_mode,
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

const ALL_ROLES: DeveloperRole[] = ['backend', 'frontend', 'devops', 'qa', 'general'];

async function processSummaryJob(job: Job<SummaryJobData>): Promise<void> {
  const { jobId, snapshotId, projectId, triggeredBy, role: requestedRole, sectionType: regenerateSectionType } = job.data;

  const updateJob = (status: string, step: string, pct: number, errorMsg?: string) => {
    const finishedAt = status === 'complete' || status === 'failed' || status === 'paused' ? new Date() : null;
    return query(
      `UPDATE analysis_jobs
       SET status = $1, current_step = $2, progress_pct = $3,
           started_at = COALESCE(started_at, NOW()),
           error_message = $4, finished_at = $6,
           step_log = step_log || $7::jsonb
       WHERE id = $5`,
      [status, step, pct, errorMsg ?? null, jobId, finishedAt,
       JSON.stringify([{ step, pct, ts: new Date().toISOString() }])],
    );
  };

  try {
    await updateJob('running', 'Loading snapshot', 5);
    const snap = await loadSnapshot(snapshotId);

    if (snap.privacy_mode === 'ai_disabled') {
      await markPhase(snapshotId, 'generation', 'skipped', { reason: 'ai_disabled' });
      await markPhase(snapshotId, 'validation', 'skipped', { reason: 'ai_disabled' });
      await updateJob('complete', 'AI disabled — deterministic outputs only', 100);
      return;
    }
    const privacyMode = snap.privacy_mode as 'full_ai' | 'facts_only_ai';
    const role = (requestedRole as DeveloperRole | undefined) ?? snap.role;

    const budget = await new BudgetEnforcer({
      snapshotId, jobId,
      depth: snap.semantic_depth,
      budgetOverrides: snap.budget_overrides,
      stopBehavior: snap.budget_stop_behavior,
    }).load();
    const ai = new AiClient({
      projectId, snapshotId, privacyMode, budget,
      tierConfig: resolveTierConfig({
        modelTierOverrides: snap.model_tier_overrides,
        modelFailureBehavior: snap.model_failure_behavior,
      }),
    });

    // Package row per (scope, role, commit). Regenerate jobs target the
    // section's existing package (possibly built from an older commit) so a
    // stale section rebuilt against a newer snapshot lands in place instead
    // of spawning a fresh one-section package for the new commit.
    const packageId = job.data.packageId ?? ((await query(
      `INSERT INTO onboarding_packages
         (snapshot_id, project_id, scope_id, role, status, generated_by, analyzed_commit)
       VALUES ($1, $2, $3, $4, 'generating', $5, $6)
       ON CONFLICT (project_id, scope_id, role, analyzed_commit) DO UPDATE
         SET snapshot_id = EXCLUDED.snapshot_id, status = 'generating', updated_at = NOW()
       RETURNING id`,
      [snapshotId, projectId, snap.scope_id, role, triggeredBy, snap.commit_hash],
    )).rows[0] as { id: string }).id;

    const deps = await buildSectionDeps(snapshotId, projectId, role);
    const sectionMetrics: Record<string, unknown> = {};

    if (regenerateSectionType) {
      // ── regenerate_section: one section, same snapshot, replace content ──
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
      console.log(`[summary-worker] regenerated ${regenerateSectionType} (section=${result.sectionId}, issues=${result.validation.issues.length})`);
      return;
    }

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

    // ── tutorials first (role_path sections reference them) ────────────────
    let budgetDegraded = false;
    if (!tutorialsDone) {
      await updateJob('running', 'Generating request-flow tutorials', 12);
      try {
        const tutorialResult = await generateTutorials({
          ai, snapshotId, projectId, packageId, role,
          commitHash: snap.commit_hash, projections: deps.projections,
        });
        sectionMetrics.tutorials = tutorialResult;
        // Walkthrough UI enrichment: tutorial step explanations map 1:1 onto
        // workflow steps — copy them over instead of paying for a second pass.
        await query(
          `UPDATE workflow_steps ws SET explanation = ts.explanation
           FROM tutorial_steps ts
           JOIN tutorials t ON t.id = ts.tutorial_id
           JOIN workflows w ON w.id = t.workflow_id
           WHERE t.package_id = $1 AND ws.workflow_id = w.id AND ws.step_order = ts.step_order
             AND ts.explanation <> ''`,
          [packageId],
        );
        tutorialsDone = true;
        await saveCheckpoint();
      } catch (err) {
        if (err instanceof BudgetExceededError && err.behavior === 'degrade') budgetDegraded = true;
        else throw err;
      }
    }

    // ── sections, one at a time (spec: never one giant call) ───────────────
    const pending = SECTION_TYPES.filter((t) => !completedSections.has(t));
    for (let i = 0; i < pending.length && !budgetDegraded; i++) {
      const sectionType = pending[i]!;
      await updateJob('running', `Generating: ${sectionType}`, 15 + Math.floor(((i + 1) / pending.length) * 75));
      try {
        const result = await generateSection({
          ai, snapshotId, projectId, packageId, role, sectionType,
          privacyMode, commitHash: snap.commit_hash, deps,
        });
        sectionMetrics[sectionType] = {
          confidence: result.validation.confidence,
          issues: result.validation.issues.length,
          retried: result.retried,
        };
        completedSections.add(sectionType);
        await saveCheckpoint();
      } catch (err) {
        if (err instanceof BudgetExceededError && err.behavior === 'degrade') {
          budgetDegraded = true; // keep what exists, stop LLM work
        } else {
          throw err;
        }
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

    // Fan out the remaining roles (only from the settings-default role job).
    if (!requestedRole) {
      for (const nextRole of ALL_ROLES.filter((r) => r !== role)) {
        const roleJobId = ((await query(
          `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, role, status, current_step)
           VALUES ($1, $2, $3, 'generate_package', $4, 'queued', 'Waiting for worker')
           RETURNING id`,
          [projectId, snapshotId, triggeredBy, nextRole],
        )).rows[0] as { id: string }).id;
        await getSummaryQueue().add(`generate_summary_${nextRole}`, {
          jobId: roleJobId, snapshotId, projectId, triggeredBy, role: nextRole,
        } satisfies SummaryJobData, {
          attempts: 2,
          backoff: { type: 'fixed', delay: 3000 },
          removeOnComplete: { count: 10 },
          removeOnFail: { count: 10 },
        });
      }
    }

    await updateJob('complete', 'Onboarding package ready', 100);
    console.log(`[summary-worker] job ${job.id} complete — package=${packageId} (role=${role}) sections=${completedSections.size}`);
  } catch (err) {
    if (err instanceof AiPausedError || (err instanceof BudgetExceededError && err.behavior === 'pause')) {
      const message = err.message.slice(0, 200);
      await markPhase(snapshotId, 'generation', 'paused', {}, { errorMessage: message }).catch(() => {});
      await query(`UPDATE analysis_snapshots SET status = 'paused' WHERE id = $1`, [snapshotId]).catch(() => {});
      await updateJob('paused', `Paused: ${message}`, 0).catch(() => {});
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
    await query(
      `UPDATE onboarding_packages SET status = 'failed', updated_at = NOW()
       WHERE project_id = $1 AND analyzed_commit = (
         SELECT commit_hash FROM analysis_snapshots WHERE id = $2
       )`,
      [projectId, snapshotId],
    ).catch(() => {});
    console.error(`[summary-worker] job ${job.id} failed:`, message);
    throw err;
  }
}

export const summaryWorker = new Worker<SummaryJobData>(
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

summaryWorker.on('completed', (job: Job<SummaryJobData>) => {
  console.log(`[summary-worker] completed job ${job.id}`);
});

summaryWorker.on('failed', (job: Job<SummaryJobData> | undefined, err: Error) => {
  console.error(`[summary-worker] failed job ${job?.id}:`, err.message);
});

console.log(`[summary-worker] listening on queue "${SUMMARY_QUEUE}"`);
