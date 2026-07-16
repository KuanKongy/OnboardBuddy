import { query } from './db.js';

/**
 * Recompute the project's scalar status from its jobs and snapshots. With
 * concurrent runs, no single job may write a terminal project status blindly
 * (a failing run would stomp 'analyzing' while a sibling is still live) —
 * every terminal path funnels through this single self-consistent UPDATE:
 * any active job ⇒ analyzing; else anything ever completed ⇒ complete;
 * else any failed job ⇒ failed; else idle.
 */
export async function recomputeProjectStatus(projectId: string): Promise<void> {
  await query(
    `UPDATE projects SET status = CASE
       WHEN EXISTS (SELECT 1 FROM analysis_jobs
                    WHERE project_id = $1 AND status IN ('queued', 'running')) THEN 'analyzing'
       WHEN EXISTS (SELECT 1 FROM analysis_snapshots
                    WHERE project_id = $1 AND status = 'complete') THEN 'complete'
       WHEN EXISTS (SELECT 1 FROM analysis_jobs
                    WHERE project_id = $1 AND status = 'failed') THEN 'failed'
       ELSE 'idle' END
     WHERE id = $1`,
    [projectId],
  );
}
