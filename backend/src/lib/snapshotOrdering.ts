/**
 * ONE definition of "the latest analysis snapshot", shared by every route,
 * service and worker that resolves what to show. Before this module the idiom
 * `ORDER BY created_at DESC LIMIT 1` was copy-pasted across ~11 call sites and
 * every one of them was wrong in the same two ways.
 *
 * ── Why not `analysis_snapshots.created_at` ─────────────────────────────────
 * That column is stamped when the run reaches `persistResults` (worker/index.ts
 * "INSERT INTO analysis_snapshots"), i.e. a few seconds after the run STARTS.
 * It therefore orders snapshots by *when their analysis got to run*, which is
 * not the order the commits were pushed. Two ways they diverge:
 *
 *   - queue delay: push A is seen first but waits behind other work, push B is
 *     seen second and starts immediately. B's snapshot row lands first, so
 *     created_at claims A is newer than B. It is not.
 *   - retried / resumed runs: a second pass over the same (scope, commit)
 *     upserts the SAME snapshot row, so ordering has to key off the push that
 *     first requested it, not the pass that happened to touch it last.
 *
 * So the ordering key is `pushedAtSql()` — the earliest analyze/incremental
 * job that asked for this snapshot, i.e. when the push was first SEEN. It
 * falls back to the snapshot's own created_at so snapshots with no surviving
 * job row (analysis_jobs.snapshot_id is ON DELETE SET NULL) keep their place
 * instead of sorting to the bottom.
 *
 * KNOWN LIMIT — this key cannot fix one variant, and no stored column can.
 * If the webhook for an OLDER commit is *delivered late* (manual redelivery, a
 * delivery that timed out and was replayed), its job row is created after the
 * newer commit's, so both `analysis_jobs.created_at` and
 * `analysis_snapshots.created_at` rank the older commit first. Ordering the
 * rows we store cannot detect that; only push provenance from GitHub can
 * (record the push payload's `before` SHA, or the commit's position on the
 * branch, at webhook time). See the report accompanying this change.
 *
 * ── Why branch is a PREFERENCE, not a filter ────────────────────────────────
 * The queries used to ignore branch completely, so a project with analyses on
 * two branches served whichever ran most recently. A hard `AND branch = $n`
 * fixes that but can return NOTHING — a scope with no analysis on the asked-for
 * branch would blank every tab, which is worse than the staleness it fixes.
 * `branchRankSql()` sorts the wanted branch first instead: it can never shrink
 * the result set, so it degrades to today's behaviour exactly when there is
 * nothing on that branch, and is otherwise a strict branch scope.
 */

/** analysis_jobs rows that represent "a push/commit was requested for analysis". */
const ANALYSIS_JOB_TYPES = `('analyze_scope', 'incremental_update')`;

/**
 * When the push behind this snapshot was first seen, as a SQL expression.
 * `alias` is the alias `analysis_snapshots` carries in the enclosing query.
 */
export function pushedAtSql(alias = 's'): string {
  return `COALESCE(
    (SELECT MIN(pj.created_at) FROM analysis_jobs pj
      WHERE pj.snapshot_id = ${alias}.id
        AND pj.job_type IN ${ANALYSIS_JOB_TYPES}),
    ${alias}.created_at)`;
}

/**
 * Branch preference as a boolean SQL expression (true sorts first under DESC).
 *
 * `branchExpr` is the SQL for the wanted branch — usually a bind placeholder
 * like `$2`. A NULL/empty wanted branch means "caller did not scope", and a
 * NULL/empty snapshot branch means "row predates branch stamping": both are
 * treated as a match so neither can demote a row that is all we have.
 */
export function branchRankSql(alias = 's', branchExpr = 'NULL'): string {
  return `(COALESCE(${branchExpr}, '') = ''
        OR COALESCE(${alias}.branch, '') = ''
        OR ${alias}.branch = ${branchExpr})`;
}

/** SQL for the project's own default branch — the fallback scope when a caller names none. */
export function projectBranchSql(alias = 's'): string {
  return `(SELECT pb.branch FROM projects pb WHERE pb.id = ${alias}.project_id)`;
}

/**
 * The branch to scope to: what the caller asked for, else the project's own
 * default branch. `paramExpr` must be cast (`$2::varchar`) so Postgres can type
 * a NULL bind.
 */
export function wantedBranchSql(alias = 's', paramExpr?: string): string {
  return paramExpr ? `COALESCE(${paramExpr}, ${projectBranchSql(alias)})` : projectBranchSql(alias);
}

/**
 * The complete ORDER BY (without the `ORDER BY` keyword) that every
 * "latest snapshot" query must use: wanted branch first, then push recency,
 * then the snapshot's own created_at as a stable final tiebreak.
 */
export function latestSnapshotOrderSql(alias = 's', branchParamExpr?: string): string {
  const branch = wantedBranchSql(alias, branchParamExpr);
  return `${branchRankSql(alias, branch)} DESC, ${pushedAtSql(alias)} DESC, ${alias}.created_at DESC`;
}
