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
import { startQueueWatchdog } from '../lib/queueWatchdog.js';
import { SUMMARY_QUEUE, connection, getSummaryQueue, idleBlockSeconds } from '../lib/queue.js';
import type { SummaryJobData } from '../lib/queue.js';
import { query } from '../lib/db.js';
import { envInt } from '../lib/env.js';
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
import { trackInFlightJob } from './jobRecovery.js';
import {
  MAX_RATE_LIMIT_RESUMES,
  RATE_LIMIT_RESUME_DELAY_MS,
  claimRateLimitResume,
  isRateLimitPause,
} from './rateLimitResume.js';
import { recordJobFailure } from './retryPolicy.js';
import { SECTION_SPECS, SECTION_TITLES, SECTION_TYPES, buildSectionDeps, type SectionType } from './generation/sectionSpecs.js';
import { generateSection } from './generation/sectionGenerator.js';
import { generateDeterministicSection } from './generation/deterministicSectionGenerator.js';
import {
  generateDeterministicTutorials,
  generateTutorials,
  regenerateOneTutorial,
  type RegenerateOneResult,
} from './generation/tutorialGenerator.js';
import {
  isRunControlError,
  recordFailedSectionGap,
  recordMissingSection,
  restoreSnapshotAfterGeneration,
  settleStoppedPackage,
} from './runStatus.js';

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

/**
 * Bug #36: terminal write for a single-tutorial regeneration, shared by the AI
 * and ai_disabled paths.
 *
 * A miss is reported as a FAILED job with the reason, never as a quiet success.
 * "Regenerate did nothing and the tutorial is still marked stale" is precisely
 * the dead end this feature exists to remove, and the two ways it can miss —
 * the flow is gone, or it no longer yields a procedure — are real answers about
 * the repository that the reader is entitled to.
 */
async function finishTutorialRegeneration(
  outcome: RegenerateOneResult,
  ctx: {
    packageId: string;
    projectId: string;
    /** The tutorial stable key, for the log line. */
    jobId: string;
    updateJob: (status: string, step: string, pct: number, errorMsg?: string) => Promise<void>;
  },
): Promise<void> {
  if (!outcome.ok) {
    const why = outcome.miss === 'workflow_gone'
      ? 'The flow this walkthrough followed no longer exists in the latest analysis, so there is nothing to rebuild. Regenerate the package to get the current set.'
      : `This flow no longer supports a step-by-step procedure${outcome.detail ? ` (${outcome.detail})` : ''}. The Tutorials tab lists why under "not shown".`;
    await ctx.updateJob('failed', 'Cannot regenerate this tutorial', 100, why);
    await recomputeProjectStatus(ctx.projectId).catch(() => {});
    console.warn(`[summary-worker] tutorial ${ctx.jobId} not regenerated: ${outcome.miss}`);
    return;
  }
  // The package leaves 'stale' once nothing stale is left in it — sections AND
  // tutorials, which is why settlePackageStaleness had to learn about the
  // latter (incrementalAnalyzer.ts).
  await settlePackageStaleness(ctx.packageId);
  await ctx.updateJob('complete', outcome.cached ? 'Tutorial unchanged (reused)' : 'Regenerated tutorial', 100);
  await recomputeProjectStatus(ctx.projectId);
  console.log(`[summary-worker] regenerated tutorial ${ctx.jobId} (steps=${outcome.steps}, cached=${outcome.cached === true})`);
}

async function processSummaryJob(job: Job<SummaryJobData>): Promise<void> {
  const {
    jobId, snapshotId, projectId, triggeredBy, role: requestedRole,
    sectionType: regenerateSectionType,
    // Bug #36: single-tutorial regeneration, the mirror of regenerate_section.
    tutorialStableKey: regenerateTutorialKey,
  } = job.data;

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
    // GREATEST, not assignment: a run recovered after a worker restart is a
    // NEW BullMQ job whose attemptsMade is back at 0, and the attempt count
    // the UI shows must not walk backwards on what is really the third try.
    await query(`UPDATE analysis_jobs SET attempt = GREATEST(attempt, $2) WHERE id = $1`, [jobId, job.attemptsMade + 1]);
    await updateJob('running', 'Loading snapshot', 5);
    const snap = await loadSnapshot(snapshotId);
    const role = (requestedRole as DeveloperRole | undefined) ?? snap.role;
    // Branch is package identity; the snapshot's branch is only provenance
    // from whichever run analyzed this (scope, commit) first.
    const branch = job.data.branch ?? snap.branch;

    // The job row's checkpoint, read once up here because it carries two
    // different things: the resume cursor used far below, and this job's
    // FLAGS. Job recovery (jobRecovery.ts) rebuilds SummaryJobData from the
    // row, so on a resumed run the checkpoint is the only surviving copy of
    // "this was an only-stale rebuild of package X" — reading the flags from
    // job.data alone would silently turn a resume into a full generation.
    const checkpointRes = await query(`SELECT checkpoint FROM analysis_jobs WHERE id = $1`, [jobId]);
    const checkpoint = (checkpointRes.rows[0] as {
      checkpoint?: {
        completedSections?: string[]; tutorialsDone?: boolean;
        onlyStale?: boolean; packageId?: string;
      };
    } | undefined)?.checkpoint;
    const onlyStale = job.data.onlyStale === true || checkpoint?.onlyStale === true;
    const targetPackageId = job.data.packageId ?? checkpoint?.packageId ?? null;

    // Package row per (scope, role, commit, branch). Regenerate jobs target
    // the section's existing package (possibly built from an older commit) so
    // a stale section rebuilt against a newer snapshot lands in place instead
    // of spawning a fresh one-section package for the new commit.
    //
    // CRITICAL: every regeneration — one section, one tutorial, or the
    // only-stale rebuild below — MUST resolve to an existing package and never
    // reach this upsert. It keys on (project, scope, role, analyzed_commit,
    // branch), and a stale rebuild runs against a NEWER commit by definition,
    // so the upsert would mint a fresh package identity: the repair would land
    // in a new near-empty package while the one the user is looking at stayed
    // stale forever.
    const packageId = targetPackageId ?? ((await query(
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

    if (onlyStale) {
      // ── only-stale rebuild: exactly the sections and tutorials this package
      //    has flagged stale, against the snapshot this job targets (the API
      //    and the auto-regen enqueue both point it at the newest complete
      //    analysis of the package's scope+branch). Everything still current
      //    is left alone and unpaid for — the whole reason this path exists
      //    beside the full package regeneration.
      //    Sits ABOVE the ai_disabled branch because it serves both modes:
      //    with AI off the same stale sections rebuild deterministically.
      const allStaleTypes = ((await query(
        `SELECT type FROM package_sections
         WHERE package_id = $1 AND review_status = 'stale'
         ORDER BY type`,
        [packageId],
      )).rows as Array<{ type: string }>).map((r) => r.type);
      // Pre-Diátaxis section types have no spec to regenerate from (same rule
      // the per-section route enforces with a hard failure). Here they are
      // skipped rather than fatal — one legacy row must not block the repair
      // of eleven current ones — and counted, so the package staying stale
      // afterwards has a stated reason in the step message.
      const staleSectionTypes = allStaleTypes.filter((t): t is SectionType => t in SECTION_SPECS);
      const legacySkipped = allStaleTypes.length - staleSectionTypes.length;
      const staleTutorialKeys = ((await query(
        `SELECT stable_key FROM tutorials
         WHERE package_id = $1 AND status = 'stale'
         ORDER BY stable_key`,
        [packageId],
      )).rows as Array<{ stable_key: string }>).map((r) => r.stable_key);

      // Budget + client built here rather than by restructuring the mainline:
      // the full path constructs these AFTER the ai_disabled early return, and
      // moving that construction up would change budget and model resolution
      // for every job in order to serve this one branch.
      let staleAi: AiClient | null = null;
      if (snap.effective_privacy_mode !== 'ai_disabled') {
        const budget = await new BudgetEnforcer({
          snapshotId, jobId,
          depth: snap.semantic_depth,
          budgetOverrides: snap.budget_overrides,
          stopBehavior: snap.budget_stop_behavior,
        }).load();
        budgetRef = budget;
        let staleOverrides: unknown = snap.model_tier_overrides;
        if (isAutoSelection(staleOverrides)) {
          const selection = await selectModel({ projectId });
          if (selection.rankings.length > 0) staleOverrides = overridesForSelection(selection);
        }
        staleAi = new AiClient({
          projectId, snapshotId, jobId,
          privacyMode: snap.effective_privacy_mode as 'full_ai' | 'facts_only_ai',
          budget,
          tierConfig: resolveTierConfig({
            modelTierOverrides: staleOverrides,
            modelFailureBehavior: snap.model_failure_behavior,
          }),
        });
      }

      const total = staleSectionTypes.length + staleTutorialKeys.length;
      let rebuilt = 0;
      const advance = async (label: string) => {
        rebuilt += 1;
        await updateJob('running', `${label} (${rebuilt}/${total})`, 10 + Math.floor((rebuilt / total) * 85));
      };
      await updateJob('running', `Regenerating ${total} stale item(s)`, 10);
      // No per-section rescue here (unlike the full generation, which records
      // a gap and ships the rest): a section that fails to rebuild stays
      // 'stale', which is both the truth and the exact state a retry needs.
      // Errors — run-control or otherwise — go to the catch below.
      await mapLimit(staleSectionTypes, envInt('SECTION_CONCURRENCY', 12), async (sectionType) => {
        if (staleAi) {
          await generateSection({
            ai: staleAi, snapshotId, projectId, packageId, role, sectionType,
            privacyMode: snap.effective_privacy_mode as 'full_ai' | 'facts_only_ai',
            commitHash: snap.commit_hash, deps,
          });
        } else {
          await generateDeterministicSection({
            snapshotId, packageId, role, sectionType, commitHash: snap.commit_hash, deps,
          });
        }
        await advance(`Regenerated section: ${sectionType}`);
      });

      let tutorialsRebuilt = 0;
      const tutorialMisses: string[] = [];
      for (const stableKey of staleTutorialKeys) {
        const outcome = await regenerateOneTutorial({
          ai: staleAi, snapshotId, projectId, packageId, role,
          commitHash: snap.commit_hash, projections: deps.projections,
          privacyMode: snap.effective_privacy_mode,
        }, stableKey);
        // A miss is an ANSWER about the repository (the flow is gone, or it no
        // longer yields a procedure), not a failure of this run. The
        // single-tutorial route can fail its job over one miss because that
        // miss IS the whole job; failing here would throw away every section
        // and tutorial this run just rebuilt. The tutorial stays stale and the
        // count says so.
        if (outcome.ok) tutorialsRebuilt += 1;
        else tutorialMisses.push(stableKey);
        await advance(outcome.ok ? 'Regenerated tutorial' : 'Tutorial no longer applies');
      }

      await settlePackageStaleness(packageId);
      const summary = [`Regenerated ${staleSectionTypes.length} stale section(s)`];
      if (tutorialsRebuilt > 0) summary.push(`${tutorialsRebuilt} tutorial(s)`);
      if (tutorialMisses.length > 0) summary.push(`${tutorialMisses.length} tutorial(s) no longer applicable`);
      if (legacySkipped > 0) summary.push(`${legacySkipped} section(s) from a previous layout need a full regeneration`);
      await updateJob('complete', summary.join(' · '), 100);
      await recomputeProjectStatus(projectId);
      console.log(`[summary-worker] only-stale rebuild of package ${packageId}: sections=${staleSectionTypes.length} tutorials=${tutorialsRebuilt} misses=${tutorialMisses.length} legacySkipped=${legacySkipped}`);
      return;
    }

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
      // Bug #36 under ai_disabled: the walkthrough skeleton is computed from
      // the trace, so a single tutorial still rebuilds with zero LLM calls —
      // `ai: null` is the same switch the full deterministic path uses.
      if (regenerateTutorialKey) {
        await updateJob('running', `Regenerating tutorial (deterministic)`, 40);
        const outcome = await regenerateOneTutorial({
          ai: null, snapshotId, projectId, packageId, role,
          commitHash: snap.commit_hash, projections: deps.projections,
          privacyMode: 'ai_disabled',
        }, regenerateTutorialKey);
        await finishTutorialRegeneration(outcome, {
          packageId, projectId, jobId: regenerateTutorialKey, updateJob,
        });
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
      // Tutorials are NOT an AI feature: the walkthrough skeleton — order,
      // files, line spans, snippets, highlights, phases, hand-off targets, the
      // entry statement, the landing facts — is computed from the trace, and a
      // model only annotates it. Deleting them above and writing none back left
      // the tab blank, which read as "switching AI off removed a feature".
      let deterministicTutorials = 0;
      try {
        const built = await generateDeterministicTutorials({
          snapshotId, projectId, packageId, role,
          commitHash: snap.commit_hash, projections: deps.projections,
        });
        deterministicTutorials = built.tutorials;
      } catch (err) {
        console.warn('[summaryWorker] deterministic tutorials failed:', err instanceof Error ? err.message : err);
      }
      await query(`UPDATE onboarding_packages SET status = 'draft', updated_at = NOW() WHERE id = $1`, [packageId]);
      // Same #80(c) rule as the AI path: a finished generation un-pauses its
      // own snapshot, so a project that paused under full_ai and was then
      // regenerated with AI off does not stay stuck on 'paused'.
      await restoreSnapshotAfterGeneration(snapshotId).catch(() => {});
      await markPhase(snapshotId, 'generation', 'complete', { sections: SECTION_TYPES.length, tutorials: deterministicTutorials, mode: 'deterministic' });
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
        await updateJob('failed', `Section type "${regenerateSectionType}" is from a previous layout. Regenerate the whole package instead.`, 100);
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

    if (regenerateTutorialKey) {
      // ── Bug #36: regenerate ONE tutorial, same contract as a section ──
      // Rebuilt against the snapshot this job targets (the API points a stale
      // tutorial at the newest complete snapshot of its scope), replacing the
      // row in place. Everything else in the package is untouched and unpaid
      // for — which is the entire point of per-tutorial granularity.
      await updateJob('running', 'Regenerating tutorial', 40);
      const outcome = await regenerateOneTutorial({
        ai, snapshotId, projectId, packageId, role,
        commitHash: snap.commit_hash, projections: deps.projections, privacyMode,
      }, regenerateTutorialKey);
      await finishTutorialRegeneration(outcome, {
        packageId, projectId, jobId: regenerateTutorialKey, updateJob,
      });
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

    // Resume support: a retry of this job row skips work it already persisted
    // (the checkpoint itself was read at the top of the run).
    const completedSections = new Set<string>(checkpoint?.completedSections ?? []);
    let tutorialsDone = checkpoint?.tutorialsDone === true;

    const saveCheckpoint = async () => {
      const cursor = { completedSections: [...completedSections], tutorialsDone };
      // MERGE, never overwrite: the checkpoint blob also holds this run's
      // budget baseline (and `sectionType` for regenerations). A blind
      // `SET checkpoint = $2` wiped the baseline mid-run, so a retry
      // re-baselined and silently granted itself a second full allowance.
      await query(
        `UPDATE analysis_jobs SET checkpoint = COALESCE(checkpoint, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
        [jobId, JSON.stringify(cursor)],
      );
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
    const sectionConcurrency = envInt('SECTION_CONCURRENCY', 12);
    let done = 0;
    // Sections that hard-failed on their own merits. Kept out of
    // `completedSections` so a resumed run retries them, and reported as
    // package gaps so the shipped package says what is missing (#77).
    const failedSections: Array<{ sectionType: SectionType; reason: string }> = [];
    const runSection = async (sectionType: SectionType): Promise<void> => {
      let result;
      try {
        result = await generateSection({
          ai, snapshotId, projectId, packageId, role, sectionType,
          privacyMode, commitHash: snap.commit_hash, deps,
        });
      } catch (err) {
        // Bug #77: one section's hard failure must not strand the other
        // eleven. Structured-output truncation, a schema mismatch, a provider
        // 5xx — all of it is this section's problem. Run-control signals still
        // propagate: pause/kill/budget/AI-disabled mean the whole run stops,
        // and swallowing them would keep spending after being told not to.
        if (isRunControlError(err)) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        failedSections.push({ sectionType, reason });
        sectionMetrics[sectionType] = { failed: true, reason: reason.slice(0, 300) };
        await recordMissingSection({
          packageId, snapshotId, sectionType, role, reason,
          title: SECTION_TITLES[sectionType] ?? sectionType,
          commitHash: snap.commit_hash,
        }).catch((persistErr) => {
          console.error(`[summary-worker] could not record missing section ${sectionType}:`,
            persistErr instanceof Error ? persistErr.message : persistErr);
        });
        done += 1;
        await updateJob('running', `Section failed: ${sectionType} (${done}/${pending.length})`, 15 + Math.floor((done / pending.length) * 75));
        console.warn(`[summary-worker] section ${sectionType} failed, package continues:`, reason);
        return;
      }
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
    // A partial package is a package with a recorded gap, not a silent one (#77).
    await recordFailedSectionGap(snapshotId, failedSections).catch(() => {});

    // 'draft', never 'generating' — the run is over either way, and a package
    // wedged on 'generating' is what blanked every tab in #80.
    await query(`UPDATE onboarding_packages SET status = 'draft', updated_at = NOW() WHERE id = $1`, [packageId]);
    // #80(c): a generation that paused parked the snapshot on 'paused' and
    // nothing ever moved it back, so two tabs stayed empty indefinitely on a
    // project whose package had since finished.
    await restoreSnapshotAfterGeneration(snapshotId).catch(() => {});
    await markPhase(snapshotId, 'generation', 'complete', {
      sections: completedSections.size,
      failedSections: failedSections.map((f) => ({ type: f.sectionType, reason: f.reason.slice(0, 300) })),
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

    await updateJob(
      'complete',
      failedSections.length > 0
        ? `Onboarding package ready with ${failedSections.length} section(s) missing: ${failedSections.map((f) => f.sectionType).join(', ')}`
        : 'Onboarding package ready',
      100,
    );
    await setMemberDefaultPackage(projectId, triggeredBy, packageId);
    await recomputeProjectStatus(projectId);
    console.log(`[summary-worker] job ${job.id} complete — package=${packageId} (role=${role}) sections=${completedSections.size} failed=${failedSections.length}`);
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
      // Provider rate limiting is the one pause that resolves by waiting, so it
      // schedules its own resume rather than parking the package for a human.
      // Bounded and atomic (rateLimitResume.ts): a null claim means the cap is
      // spent or the row already left 'running', and the pause below stands.
      if (isRateLimitPause(err)) {
        const claim = await claimRateLimitResume(jobId).catch(() => null);
        if (claim) {
          // The same job data: the checkpoint carries the resume cursor and the
          // run's flags, so the re-run skips every section already written.
          // attempts: 1 because the durable resume count is the bound here —
          // BullMQ retries on top of it would multiply the cap.
          await getSummaryQueue().add(job.name, job.data, {
            attempts: 1,
            delay: RATE_LIMIT_RESUME_DELAY_MS,
            removeOnComplete: { count: 10 },
            removeOnFail: { count: 10 },
          });
          // None of the pause bookkeeping below applies to a run that is coming
          // back: the snapshot is not paused (it would blank two tabs under a
          // queued job), the package is not stopping so `settleStoppedPackage`
          // would demote a live 'generating' row to 'draft'/'failed', and the
          // generation phase is left mid-flight rather than marked 'paused' —
          // the resumed run finishes it and writes the real terminal state.
          console.warn(`[summary-worker] rate-limited pause on job ${jobId} — auto-resume `
            + `${claim.attempt}/${MAX_RATE_LIMIT_RESUMES} in ~${Math.round(RATE_LIMIT_RESUME_DELAY_MS / 1000)}s`);
          return;
        }
      }
      const message = err.message.slice(0, 200);
      await markPhase(snapshotId, 'generation', 'paused', {}, { errorMessage: message }).catch(() => {});
      await query(`UPDATE analysis_snapshots SET status = 'paused' WHERE id = $1`, [snapshotId]).catch(() => {});
      await settleStoppedPackage(failedPackageId).catch(() => {});
      // The message now carries the numbers ("used N of M calls this run
      // (lifetime across runs: L)"); persisting it as error_message too is
      // what puts them in the paused-run banner, which renders that field.
      await updateJob('paused', `Paused: ${message}`, 0, message).catch(() => {});
      await recomputeProjectStatus(projectId).catch(() => {});
      console.warn(`[summary-worker] job ${job.id} paused:`, message);
      return; // resumable — a retry would just re-pause
    }
    if (err instanceof KillSwitchError) {
      await markPhase(snapshotId, 'generation', 'paused', {}, { errorMessage: err.message }).catch(() => {});
      await settleStoppedPackage(failedPackageId).catch(() => {});
      console.warn(`[summary-worker] job ${job.id} stopped by kill switch (job status: ${err.jobStatus})`);
      return; // status was already set from the API
    }
    if (err instanceof BudgetExceededError && err.behavior === 'fail') {
      await query(`UPDATE analysis_snapshots SET status = 'failed' WHERE id = $1`, [snapshotId]).catch(() => {});
    }

    const message = err instanceof Error ? err.message : String(err);
    // Bug #69(2): 'failed' only on the LAST attempt. Writing it on the first
    // one made this worker's own `attempts: 2` a no-op — `updateJob('running')`
    // is guarded on `status NOT IN ('paused','failed')`, so the redelivery
    // threw KillSwitchError on its first line and exited before doing anything.
    // Generation is the likeliest place to meet a transient provider error, so
    // it is also where a working retry is worth the most.
    const { retrying } = await recordJobFailure(job, jobId, err, message)
      .catch(() => ({ retrying: false }));
    if (retrying) {
      // Deliberately NOT marking the phase or the package failed: the run is
      // going to happen again in a few seconds, and a package that flickers
      // 'failed' between attempts is the same lie in miniature. Sections
      // already written stay; the resume checkpoint makes the retry skip them.
      console.warn(`[summary-worker] job ${job.id} failed (attempt ${job.attemptsMade + 1}), retrying:`, message);
      throw err;
    }
    await markPhase(snapshotId, 'generation', 'failed', {}, { errorMessage: message.slice(0, 500) }).catch(() => {});
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
    async (job: Job<SummaryJobData>) => {
      // Registered for the shutdown handoff (jobRecovery.ts): if the drain
      // grace period expires we know exactly which rows we abandoned.
      const release = trackInFlightJob(job.data.jobId);
      try {
        await processSummaryJob(job);
      } finally {
        release();
      }
    },
    {
      connection,
      // Parallel package generations. Its OWN knob: this worker is hosted in
      // the analysis worker's process (worker/index.ts imports this module),
      // and it used to read WORKER_CONCURRENCY too — so raising analysis
      // parallelism raised generation parallelism by the same factor and both
      // drew on one pg pool. Each job additionally fans out SECTION_CONCURRENCY
      // sections internally; pool sizing for the combination: src/lib/db.ts.
      concurrency: envInt('SUMMARY_CONCURRENCY', 4),
      // SECONDS — BullMQ's drainDelay unit (see lib/queue.ts); the old
      // hard-coded "5000ms" actually meant 83 minutes.
      drainDelay: idleBlockSeconds(),
      stalledInterval: 300_000,
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

/**
 * The CURRENT consumer. The watchdog replaces `summaryWorker` in place, so
 * `worker/index.ts` must resolve it at shutdown time rather than capture it
 * at import time.
 */
export function getSummaryWorker(): Worker<SummaryJobData> {
  return summaryWorker;
}

// Dead-consumer self-heal (see lib/queueWatchdog.ts): recreate the consumer
// in-process when queued jobs sit while nothing is active. Samples through
// the shared getSummaryQueue() handle — every BullMQ Queue opens its own
// Redis connection (same reasoning as worker/index.ts).
export const stopSummaryWatchdog = startQueueWatchdog({
  queueName: SUMMARY_QUEUE,
  sample: async () => {
    // One getJobCounts = 4 Redis commands vs 7 for the two count calls; 'wait'
    // skips the paused list, which this app never uses (no queue.pause()).
    const counts = await getSummaryQueue().getJobCounts('wait', 'active');
    return { waiting: counts.wait ?? 0, active: counts.active ?? 0 };
  },
  recreate: async () => {
    await summaryWorker.close().catch(() => {});
    summaryWorker = createSummaryWorker();
  },
});

console.log(
  `[summary-worker] listening on queue "${SUMMARY_QUEUE}" ` +
  `(concurrency=${envInt('SUMMARY_CONCURRENCY', 4)}, sections/job=${envInt('SECTION_CONCURRENCY', 12)})`,
);
