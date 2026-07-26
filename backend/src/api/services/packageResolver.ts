/**
 * Central package/snapshot resolution for project-scoped reads. Every feature
 * endpoint (onboarding reader, graph, architecture, classes, capabilities,
 * workflows, tutorials, export/validate/staleness, ask) resolves what to show
 * through this one fallback chain instead of its own "latest wins" query:
 *
 *   explicit ?package_id=  →  caller's member default  →  latest complete snapshot
 *                                                       →  latest STOPPED snapshot
 *
 * An explicit package_id that doesn't exist in the project is a 404, never a
 * silent fallback — pinning a package must not quietly show something else.
 *
 * "Latest" means newest by PUSH recency on the wanted branch, not newest row —
 * see lib/snapshotOrdering.ts for why `created_at DESC` was wrong and why
 * branch is a sort preference rather than a `WHERE` clause.
 *
 * The last rung is the #77/#80 fix. A package generation that paused left its
 * snapshot on 'paused', the chain ended at "latest complete", found none, and
 * every tab 404'd on a project whose extraction had completed. Degrading is
 * never silent: `servingOlderSnapshot` / `snapshotStatus` come back with the
 * context so a caller can say which analysis it is looking at.
 */

import type { Request, Response } from 'express';
import { query } from '../../lib/db.js';
import { latestSnapshotOrderSql } from '../../lib/snapshotOrdering.js';

export interface ResolvedPackageContext {
  /** Null when resolution landed on a bare snapshot with no package (e.g. generation still running). */
  packageId: string | null;
  snapshotId: string;
  scopeId: string | null;
  role: string | null;
  /** The package's branch when a package resolved; snapshot provenance branch otherwise. */
  branch: string | null;
  commitHash: string | null;
  source: 'explicit' | 'member_default' | 'latest';
  /**
   * Status of the snapshot actually being served ('complete' | 'paused' |
   * 'failed' | …). Null only for pre-existing callers that pinned a package
   * whose snapshot row has since been deleted.
   */
  snapshotStatus: string | null;
  /**
   * True when this project has a NEWER snapshot that could not be served
   * because its run did not finish. Set on the "latest" fallback only — an
   * explicit or pinned package is what the caller asked for, whatever else
   * exists. Responses expose it as `servingOlderSnapshot` so a tab can say
   * "this is the last good analysis" instead of silently showing stale data.
   */
  servingOlderSnapshot: boolean;
  /** Status of the newer snapshot that was skipped; null when none was. */
  newerSnapshotStatus: string | null;
}

export class PackageNotFoundError extends Error {}
export class BadPackageParamError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validated package id from a query/body value. undefined = absent. */
export function readPackageParam(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw new BadPackageParamError('package_id must be a UUID');
  }
  return raw;
}

const PACKAGE_CONTEXT_SELECT = `
  SELECT op.id AS package_id, op.snapshot_id, op.scope_id, op.role, op.branch,
         op.analyzed_commit AS commit_hash, s.status AS snapshot_status
  FROM onboarding_packages op
  JOIN analysis_snapshots s ON s.id = op.snapshot_id`;

/**
 * Statuses whose snapshot is trustworthy enough to serve as "the latest".
 * Everything else is a run that stopped, and is only served as a last resort.
 */
const SERVABLE_SNAPSHOT_STATUS = 'complete';

export async function resolvePackageContext(opts: {
  projectId: string;
  userId?: string | null;
  packageId?: string | null;
  /** Role hint for the best-effort package pick on the "latest" fallback. */
  role?: string | null;
  /**
   * Branch to scope the "latest" fallback to. Null = the project's default
   * branch. It is a sort preference, not a filter (lib/snapshotOrdering.ts), so
   * a branch with no analysis still resolves to whatever else exists.
   */
  branch?: string | null;
}): Promise<ResolvedPackageContext | null> {
  type PkgRow = {
    package_id: string; snapshot_id: string; scope_id: string | null;
    role: string | null; branch: string | null; commit_hash: string | null;
    snapshot_status: string | null;
  };

  if (opts.packageId) {
    const row = (await query(
      `${PACKAGE_CONTEXT_SELECT} WHERE op.id = $1 AND op.project_id = $2`,
      [opts.packageId, opts.projectId],
    )).rows[0] as PkgRow | undefined;
    if (!row) throw new PackageNotFoundError('Package not found');
    return { packageId: row.package_id, snapshotId: row.snapshot_id, scopeId: row.scope_id,
      role: row.role, branch: row.branch, commitHash: row.commit_hash, source: 'explicit',
      snapshotStatus: row.snapshot_status ?? null, servingOlderSnapshot: false, newerSnapshotStatus: null };
  }

  if (opts.userId) {
    const row = (await query(
      `${PACKAGE_CONTEXT_SELECT}
       JOIN project_members pm ON pm.default_package_id = op.id
       WHERE pm.project_id = $1 AND pm.user_id = $2 AND op.project_id = $1`,
      [opts.projectId, opts.userId],
    )).rows[0] as PkgRow | undefined;
    if (row) {
      return { packageId: row.package_id, snapshotId: row.snapshot_id, scopeId: row.scope_id,
        role: row.role, branch: row.branch, commitHash: row.commit_hash, source: 'member_default',
        snapshotStatus: row.snapshot_status ?? null, servingOlderSnapshot: false, newerSnapshotStatus: null };
    }
  }

  // Bugs #77 / #80: this used to be a single `status = 'complete'` query, so a
  // project whose newest snapshot was left 'paused' by an unfinished package
  // generation resolved to NOTHING and every tab 404'd — over a snapshot that
  // held 71 entrypoints, 71 workflows, 6 clusters and 4 capabilities. Take the
  // newest few and pick deliberately: the newest complete one wins; if none is
  // complete, the newest stopped one is still served (its extracted data is
  // real) and the caller is told the run did not finish.
  type SnapRow = {
    id: string; scope_id: string | null; branch: string | null;
    commit_hash: string | null; status: string;
  };
  // "Newest" is push recency scoped to the branch, never row-insertion order —
  // see lib/snapshotOrdering.ts. The branch preference sorts rather than
  // filters, so this list is never emptier than it used to be and the #80
  // fallback below still has the same rows to choose from.
  const snapshots = (await query(
    `SELECT id, scope_id, branch, commit_hash, status FROM analysis_snapshots s
     WHERE project_id = $1 AND status <> 'pending'
     ORDER BY ${latestSnapshotOrderSql('s', '$2::varchar')} LIMIT 10`,
    [opts.projectId, opts.branch ?? null],
  )).rows as SnapRow[];
  if (snapshots.length === 0) return null;

  const newest = snapshots[0]!;
  const latestComplete = snapshots.find((s) => s.status === SERVABLE_SNAPSHOT_STATUS);
  // A 'running' snapshot has no persisted graph yet; a stopped one does.
  const snap = latestComplete ?? snapshots.find((s) => s.status !== 'running') ?? newest;
  const servingOlderSnapshot = snap.id !== newest.id;

  const pkg = (await query(
    `SELECT id, role, branch FROM onboarding_packages
     WHERE snapshot_id = $1 AND ($2::varchar IS NULL OR role = $2)
     ORDER BY created_at DESC LIMIT 1`,
    [snap.id, opts.role ?? null],
  )).rows[0] as { id: string; role: string | null; branch: string | null } | undefined;

  return {
    packageId: pkg?.id ?? null,
    snapshotId: snap.id,
    scopeId: snap.scope_id,
    role: pkg?.role ?? null,
    branch: pkg?.branch ?? snap.branch,
    commitHash: snap.commit_hash,
    source: 'latest',
    snapshotStatus: snap.status,
    servingOlderSnapshot,
    newerSnapshotStatus: servingOlderSnapshot ? newest.status : null,
  };
}

/**
 * The freshness half of a resolved context, shaped for a JSON response.
 *
 * A one-line spread (`...packageContextMeta(ctx)`) so every tab can start
 * telling the reader "this is the last good analysis, the newest run is
 * paused" without each route re-deriving it. Nothing consumes it yet — the
 * frontend adopts it in a later pass.
 */
export function packageContextMeta(ctx: ResolvedPackageContext): {
  snapshotStatus: string | null;
  servingOlderSnapshot: boolean;
  newerSnapshotStatus: string | null;
} {
  return {
    snapshotStatus: ctx.snapshotStatus,
    servingOlderSnapshot: ctx.servingOlderSnapshot,
    newerSnapshotStatus: ctx.newerSnapshotStatus,
  };
}

/**
 * Express adapter: resolve from ?package_id= + the authenticated member.
 * Returns `false` when the response was already written (400 bad param /
 * 404 unknown package), `null` when the project has nothing analyzed yet.
 */
export async function resolveForRequest(
  req: Request,
  res: Response,
  opts: { role?: string | null; branch?: string | null } = {},
): Promise<ResolvedPackageContext | null | false> {
  try {
    const packageId = readPackageParam(req.query.package_id);
    const branchParam = typeof req.query.branch === 'string' && req.query.branch !== ''
      ? req.query.branch : null;
    return await resolvePackageContext({
      projectId: String(req.params.id),
      userId: req.user?.id ?? null,
      packageId,
      role: opts.role ?? null,
      branch: opts.branch ?? branchParam,
    });
  } catch (err) {
    if (err instanceof BadPackageParamError) {
      res.status(400).json({ error: err.message });
      return false;
    }
    if (err instanceof PackageNotFoundError) {
      res.status(404).json({ error: 'Package not found' });
      return false;
    }
    throw err;
  }
}
