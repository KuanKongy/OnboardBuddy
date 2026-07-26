/**
 * Truthful terminal status writes for a run (REWORK_PLAN.md Phase 8,
 * "Resilience"). Every function here answers the same question — *what does
 * the database say when a run does NOT finish cleanly?* — because the audit
 * found four different wrong answers to it:
 *
 *   #75  a failed analysis left its snapshot marked 'complete'
 *   #77  one invalid section discarded the other eleven
 *   #80  a paused package wedged on 'generating' and blanked every tab
 *
 * Deliberately dependency-free (only `lib/db`): both workers construct BullMQ
 * consumers at module load, so nothing in `worker/index.ts` or
 * `summaryWorker.ts` can be imported by a test without opening a Redis
 * connection. Keeping these writes here is what makes them assertable.
 */

import { query } from '../lib/db.js';

/**
 * Run-control signals: these mean "this RUN must stop", not "this unit of work
 * is bad", so no per-item guard may absorb them — swallowing a pause, a kill
 * switch or a budget trip would keep spending after the run was told to stop,
 * and swallowing `AiDisabledError` would let a privacy guard fire and vanish.
 *
 * Matched by name rather than by class so this module stays free of the AI
 * layer's imports; same rule as `sectionGenerator.isControlError`.
 */
export function isRunControlError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'AiPausedError' || name === 'KillSwitchError'
    || name === 'BudgetExceededError' || name === 'AiDisabledError';
}

/**
 * Bug #75. The snapshot row is written 'complete' at the persistence step
 * (~46% progress) because the graph it holds really is complete there — but
 * six phases still follow. When one died (both live cases: a statement timeout
 * at 98%) only `analysis_jobs` was marked failed, so `projectStatus`'s
 * "anything ever completed ⇒ complete" rule propagated a success to the
 * project card over a project whose tabs were empty.
 *
 * Never downgrades a row another path already marked 'paused': a pause is
 * resumable and carries its own reason, a failure is neither.
 */
export async function markSnapshotFailed(snapshotId: string, reason: string): Promise<void> {
  await query(
    `UPDATE analysis_snapshots
     SET status = 'failed',
         unknowns = unknowns || jsonb_build_array(
           jsonb_build_object('kind', 'analysis_incomplete', 'detail', $2::text))
     WHERE id = $1 AND status <> 'paused'`,
    [snapshotId, reason.slice(0, 300)],
  );
}

/**
 * Bug #80(c). A generation that paused parked the snapshot on 'paused' and
 * nothing ever moved it back, so Workflows and Capabilities stayed empty
 * indefinitely on a project whose package had since finished with all twelve
 * sections. A completed generation returns its own snapshot to 'complete';
 * 'failed' is left alone, because that verdict belongs to the analysis.
 */
export async function restoreSnapshotAfterGeneration(snapshotId: string): Promise<void> {
  await query(
    `UPDATE analysis_snapshots SET status = 'complete' WHERE id = $1 AND status = 'paused'`,
    [snapshotId],
  );
}

/**
 * Bug #80, the wedge. A paused or kill-switched generation used to leave its
 * package row on 'generating' forever — nothing else ever writes it — which
 * reads as "still in progress" over a snapshot full of extracted data.
 *
 * What survived on disk decides the honest status: sections present ⇒ 'draft'
 * (a partial package a reader can open), nothing at all ⇒ 'failed'. Neither
 * blocks a resume — the job's ON CONFLICT upsert puts it back to 'generating'
 * when the run is retried.
 */
export async function settleStoppedPackage(packageId: string | null): Promise<void> {
  if (!packageId) return;
  await query(
    `UPDATE onboarding_packages op
     SET status = CASE
           WHEN EXISTS (SELECT 1 FROM package_sections ps WHERE ps.package_id = op.id) THEN 'draft'
           ELSE 'failed'
         END,
         updated_at = NOW()
     WHERE op.id = $1 AND op.status = 'generating'`,
    [packageId],
  );
}

/**
 * Bug #77. Records a section that could not be generated as a NAMED GAP
 * instead of a hole. FloowForge's `architecture_deep` blew the output-token
 * ceiling mid-JSON, the generate job paused, and all twelve sections were lost
 * with it; the package shipped at 0%.
 *
 * The row is deliberately real: the reader, the provenance panel and the
 * export all enumerate `package_sections`, so an ABSENT row reads as "this
 * package has eleven sections" while this one reads as "this section failed,
 * here is why". `generation_context.status = 'missing'` is the machine-
 * readable marker; the prose is what a reader sees on the tab.
 */
export async function recordMissingSection(params: {
  packageId: string;
  snapshotId: string;
  sectionType: string;
  title: string;
  commitHash: string;
  role: string;
  reason: string;
}): Promise<void> {
  const reason = params.reason.slice(0, 500);
  await query(
    `DELETE FROM package_sections WHERE package_id = $1 AND type = $2`,
    [params.packageId, params.sectionType],
  );
  await query(
    `INSERT INTO package_sections
       (package_id, snapshot_id, generation_run_id, type, title, content, diagrams,
        confidence, review_status, analyzed_commit, role, unknowns, generation_context)
     VALUES ($1, $2, NULL, $3, $4, $5, '[]'::jsonb, 'low', 'draft', $6, $7, $8, $9)`,
    [
      params.packageId, params.snapshotId, params.sectionType, params.title,
      `> **This section could not be generated.** ${reason}\n\n`
        + 'Every other section in this package generated normally. Regenerate this one to try again.',
      params.commitHash, params.role,
      JSON.stringify([{ kind: 'section_generation_failed', detail: reason }]),
      JSON.stringify({ status: 'missing', reason, failed_at: new Date().toISOString() }),
    ],
  );
}

/**
 * Bug #77, the package-level half: a partial package is a package with a
 * RECORDED gap, not a silent one. Uses the same honest-unknown shape as
 * `budget_degraded`, so every existing reader of `analysis_snapshots.unknowns`
 * picks it up without changes.
 */
export async function recordFailedSectionGap(
  snapshotId: string,
  failures: Array<{ sectionType: string; reason: string }>,
): Promise<void> {
  if (failures.length === 0) return;
  const detail = failures
    .map((f) => `${f.sectionType}: ${f.reason.slice(0, 160)}`)
    .join(' | ')
    .slice(0, 500);
  await query(
    `UPDATE analysis_snapshots
     SET unknowns = unknowns || jsonb_build_array(
       jsonb_build_object('kind', 'sections_failed', 'phase', 'generation', 'detail', $2::text))
     WHERE id = $1`,
    [snapshotId, detail],
  );
}
